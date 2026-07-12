import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth } from "../auth.js";
import { isOps, managerRestaurantIds, canEditRestaurant } from "../access.js";
import { weekdayOf, isWeekendMandatory, resolveShiftTimes } from "../scheduleRules.js";
import { notify, coordinatorIds } from "../notify.js";

// Extra shifts ("turno extra", R9). A restaurant manager requests a shift beyond
// the base schedule; coordination is notified and either (a) assigns a freelancer
// directly, or (b) opens it as a vaga for freelancers to claim (via an is_extra
// demand override). Whoever works an is_extra shift earns the furo-cover reward
// on checkout (see attendance.js).
const router = Router();
router.use(requireAuth);

const isFreela = (role) => role === "freelancer" || role === "visitor";
const today = () => new Date().toISOString().slice(0, 10);

const REQ_SELECT = `
  e.id, e.restaurant_id as "restaurantId", r.name as "restaurantName",
  e.date::text as date, e.shift_type as "shiftType", e.headcount, e.reason,
  e.status, e.requested_by as "requestedBy", req.name as "requestedByName",
  e.created_at as "createdAt", e.decided_at as "decidedAt"`;
const REQ_FROM = `
  from public.extra_shift_requests e
  left join public.restaurants r on r.id = e.restaurant_id
  left join public.users req on req.id = e.requested_by`;

// GET /api/extra-shifts — ops see all (pending first); managers see their own.
router.get("/", async (req, res) => {
  try {
    if (isOps(req.user.role)) {
      const { rows } = await pool.query(
        `select ${REQ_SELECT} ${REQ_FROM}
          order by (e.status = 'pending') desc, e.created_at desc limit 100`,
      );
      return res.json(rows);
    }
    if (req.user.role === "restaurant_manager") {
      const { rows } = await pool.query(
        `select ${REQ_SELECT} ${REQ_FROM}
          where e.requested_by = $1 order by e.created_at desc limit 100`,
        [req.user.sub],
      );
      return res.json(rows);
    }
    res.json([]);
  } catch (e) {
    console.error("extra-shifts list error:", e.message);
    res.status(500).json({ error: "Falha ao carregar turnos extras." });
  }
});

// GET /api/extra-shifts/:id/eligible — freelancers free for the request's slot.
router.get("/:id/eligible", async (req, res) => {
  try {
    if (!isOps(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    const e = await one(
      `select restaurant_id as "restaurantId", date::text as date, shift_type as "shiftType"
         from public.extra_shift_requests where id = $1`,
      [req.params.id],
    );
    if (!e) return res.status(404).json({ error: "Not found" });
    const { rows } = await pool.query(
      `select u.id, u.name, coalesce(fp.current_score, 0) as score
         from public.users u
         left join public.freelancer_profiles fp on fp.user_id = u.id
        where u.role in ('freelancer','visitor') and u.status = 'active'
          and not exists (
            select 1 from public.schedule_assignments x
             where x.user_id = u.id and x.date = $1 and x.shift_type = $2
               and x.status <> 'cancelled')
        order by score desc, u.name asc`,
      [e.date, e.shiftType],
    );
    res.json(rows.map((r) => ({ id: r.id, name: r.name, score: Number(r.score) })));
  } catch (e) {
    console.error("extra-shifts eligible error:", e.message);
    res.status(500).json({ error: "Falha ao carregar candidatos." });
  }
});

// POST /api/extra-shifts { restaurantId?, date, shiftType, headcount?, reason? }
// Manager (own restaurant) or ops (any) requests an extra shift.
router.post("/", async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.date || !["lunch", "dinner"].includes(b.shiftType)) {
      return res.status(400).json({ error: "date and shiftType are required" });
    }
    if (b.date < today()) {
      return res.status(400).json({ error: "past_date", message: "Escolha uma data futura." });
    }
    const headcount = Math.max(1, Number(b.headcount) || 1);

    // Resolve the restaurant: managers default to their linked one and may only
    // request for restaurants they manage; ops must pass a restaurantId.
    let restaurantId = b.restaurantId || null;
    if (req.user.role === "restaurant_manager") {
      const mine = await managerRestaurantIds(req.user.sub);
      if (mine.length === 0) {
        return res.status(400).json({ error: "no_restaurant", message: "Você não está vinculado a um restaurante." });
      }
      restaurantId = restaurantId && mine.includes(restaurantId) ? restaurantId : mine[0];
    } else if (!isOps(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!restaurantId) {
      return res.status(400).json({ error: "restaurant_required", message: "Selecione um restaurante." });
    }
    if (!(await canEditRestaurant(req.user, restaurantId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const row = await one(
      `insert into public.extra_shift_requests
         (restaurant_id, date, shift_type, headcount, reason, requested_by)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [restaurantId, b.date, b.shiftType, headcount, b.reason || null, req.user.sub],
    );

    const shiftPt = b.shiftType === "lunch" ? "almoço" : "janta";
    for (const cid of await coordinatorIds()) {
      await notify({
        recipientUserId: cid, type: "coverage_deficit",
        title: "Pedido de turno extra",
        body: `${req.user.name || "Um gestor"} pediu um turno extra (${shiftPt}) em ${b.date}.`,
        data: { extraShiftId: row.id, path: "/extra-shifts" },
      });
    }
    res.status(201).json({ id: row.id, status: "pending" });
  } catch (e) {
    console.error("extra-shift create error:", e.message);
    res.status(500).json({ error: "Falha ao solicitar turno extra." });
  }
});

// Load a pending request or send the proper error; returns the row or null (after responding).
async function loadPending(req, res) {
  if (!isOps(req.user.role)) { res.status(403).json({ error: "Forbidden" }); return null; }
  const e = await one(
    `select id, restaurant_id as "restaurantId", date::text as date, shift_type as "shiftType",
            headcount, status, requested_by as "requestedBy"
       from public.extra_shift_requests where id = $1`,
    [req.params.id],
  );
  if (!e) { res.status(404).json({ error: "Not found" }); return null; }
  if (e.status !== "pending") {
    res.status(400).json({ error: "bad_state", message: "Este pedido já foi resolvido." });
    return null;
  }
  return e;
}

// POST /api/extra-shifts/:id/assign { userId } — coordinator schedules someone directly.
router.post("/:id/assign", async (req, res) => {
  try {
    const e = await loadPending(req, res);
    if (!e) return;
    const userId = (req.body || {}).userId;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (e.date < today()) return res.status(400).json({ error: "past_date", message: "Este turno já passou." });

    const u = await one(`select id, name, role, status from public.users where id = $1`, [userId]);
    if (!u || !isFreela(u.role) || u.status !== "active") {
      return res.status(400).json({ error: "invalid_user", message: "Freelancer indisponível." });
    }
    const clash = await one(
      `select 1 from public.schedule_assignments
        where user_id = $1 and date = $2 and shift_type = $3 and status <> 'cancelled'`,
      [userId, e.date, e.shiftType],
    );
    if (clash) return res.status(409).json({ error: "user_busy", message: "Este freelancer já está escalado neste turno." });

    const times = await resolveShiftTimes(e.restaurantId, e.shiftType);
    const weekendMandatory = isWeekendMandatory(weekdayOf(e.date), e.shiftType);
    const cyc = await one(
      `select id from public.availability_cycles
        where reference_month = date_trunc('month', $1::date)::date order by created_at desc limit 1`,
      [e.date],
    );
    const a = await one(
      `insert into public.schedule_assignments
         (cycle_id, restaurant_id, user_id, date, shift_type, start_time, end_time,
          status, is_weekend_mandatory, is_extra, assigned_via, created_by, published_at)
       values ($1,$2,$3,$4,$5,$6,$7,'published',$8,true,'coordinator',$9, now())
       returning id`,
      [cyc?.id ?? null, e.restaurantId, userId, e.date, e.shiftType, times.startTime, times.endTime,
       weekendMandatory, req.user.sub],
    );
    await pool.query(
      `update public.extra_shift_requests
          set status='assigned', decided_by=$2, decided_at=now(), updated_at=now() where id=$1`,
      [e.id, req.user.sub],
    );

    const shiftPt = e.shiftType === "lunch" ? "almoço" : "janta";
    await notify({
      recipientUserId: userId, type: "schedule_published",
      title: "Você foi escalado em um turno extra",
      body: `Turno extra de ${shiftPt} em ${e.date}. Os pontos entram após você trabalhar o turno.`,
      data: { assignmentId: a.id, date: e.date, shiftType: e.shiftType },
    });
    res.status(201).json({ status: "assigned", assignmentId: a.id });
  } catch (e2) {
    console.error("extra-shift assign error:", e2.message);
    res.status(500).json({ error: "Falha ao escalar o turno extra." });
  }
});

// POST /api/extra-shifts/:id/open — coordinator opens it as a vaga (is_extra demand override).
router.post("/:id/open", async (req, res) => {
  try {
    const e = await loadPending(req, res);
    if (!e) return;
    if (e.date < today()) return res.status(400).json({ error: "past_date", message: "Este turno já passou." });

    // How many are already scheduled for this slot? Add headcount on top so the
    // vaga system exposes exactly the extra openings.
    const filled = (await one(
      `select count(*)::int as n from public.schedule_assignments
        where restaurant_id = $1 and date = $2 and shift_type = $3 and status <> 'cancelled'`,
      [e.restaurantId, e.date, e.shiftType])).n;
    await pool.query(
      `insert into public.demand_overrides (restaurant_id, date, shift_type, required_count, reason, is_extra, created_by)
       values ($1,$2,$3,$4,$5,true,$6)
       on conflict (restaurant_id, date, shift_type) do update set
         required_count = greatest(public.demand_overrides.required_count, excluded.required_count),
         is_extra = true, reason = coalesce(excluded.reason, public.demand_overrides.reason)`,
      [e.restaurantId, e.date, e.shiftType, filled + e.headcount, e.reason || "Turno extra", req.user.sub],
    );
    await pool.query(
      `update public.extra_shift_requests
          set status='opened', decided_by=$2, decided_at=now(), updated_at=now() where id=$1`,
      [e.id, req.user.sub],
    );
    res.json({ status: "opened" });
  } catch (e2) {
    console.error("extra-shift open error:", e2.message);
    res.status(500).json({ error: "Falha ao abrir a vaga." });
  }
});

// POST /api/extra-shifts/:id/reject — coordinator declines the request.
router.post("/:id/reject", async (req, res) => {
  try {
    const e = await loadPending(req, res);
    if (!e) return;
    await pool.query(
      `update public.extra_shift_requests
          set status='rejected', decided_by=$2, decided_at=now(), updated_at=now() where id=$1`,
      [e.id, req.user.sub],
    );
    if (e.requestedBy) {
      await notify({
        recipientUserId: e.requestedBy, type: "coverage_deficit",
        title: "Turno extra recusado",
        body: `A coordenação recusou o pedido de turno extra de ${e.date}.`,
        data: { extraShiftId: e.id, path: "/extra-shifts" },
      });
    }
    res.json({ status: "rejected" });
  } catch (e2) {
    console.error("extra-shift reject error:", e2.message);
    res.status(500).json({ error: "Falha ao recusar." });
  }
});

// DELETE /api/extra-shifts/:id — the requesting manager cancels a still-pending request.
router.delete("/:id", async (req, res) => {
  try {
    const e = await one(
      `select id, requested_by as "requestedBy", status from public.extra_shift_requests where id = $1`,
      [req.params.id],
    );
    if (!e) return res.status(404).json({ error: "Not found" });
    if (e.requestedBy !== req.user.sub && !isOps(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    if (e.status !== "pending") {
      return res.status(400).json({ error: "bad_state", message: "Este pedido não pode mais ser cancelado." });
    }
    await pool.query(
      `update public.extra_shift_requests set status='cancelled', updated_at=now() where id=$1`, [e.id],
    );
    res.json({ status: "cancelled" });
  } catch (e2) {
    console.error("extra-shift cancel error:", e2.message);
    res.status(500).json({ error: "Falha ao cancelar." });
  }
});

export default router;
