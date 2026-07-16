import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth } from "../auth.js";
import { isOps, managerRestaurantIds, canEditRestaurant } from "../access.js";
import { weekdayOf, isWeekendMandatory, resolveShiftTimes } from "../scheduleRules.js";
import { notify, coordinatorIds } from "../notify.js";

// Extra shifts ("turno extra"). A restaurant manager requests a shift beyond the base
// schedule; coordination is notified and either (a) INVITES a freelancer directly — who
// must ACCEPT within 24h — or (b) opens it as a vaga for freelancers to claim. The
// manager is only confirmed ("aprovado", no freelancer name) once someone actually
// commits: accepts the invite or claims the vaga. Whoever works an is_extra shift earns
// the furo-cover reward on checkout (see attendance.js).
const router = Router();
router.use(requireAuth);

const isFreela = (role) => role === "freelancer" || role === "visitor";
const today = () => new Date().toISOString().slice(0, 10);
const shiftPt = (s) => (s === "lunch" ? "almoço" : "janta");

// Manager-facing columns never expose who was invited/assigned (the person can change;
// the manager only ever sees the status). Ops get the assignee + deadline too.
const REQ_BASE = `
  e.id, e.restaurant_id as "restaurantId", r.name as "restaurantName",
  e.date::text as date, e.shift_type as "shiftType", e.headcount, e.reason,
  e.status, e.requested_by as "requestedBy", req.name as "requestedByName",
  e.created_at as "createdAt", e.decided_at as "decidedAt"`;
const REQ_SELECT_OPS = `${REQ_BASE},
  e.assigned_user_id as "assignedUserId", au.name as "assignedUserName",
  e.accept_deadline as "acceptDeadline"`;
const REQ_FROM = `
  from public.extra_shift_requests e
  left join public.restaurants r on r.id = e.restaurant_id
  left join public.users req on req.id = e.requested_by
  left join public.users au on au.id = e.assigned_user_id`;

// Flip any awaiting-accept invites whose 24h window elapsed back to 'pending' and tell
// coordination to reassign. Atomic + concurrency-safe (skip-locked) so it can run from
// both the hourly cron and lazily on the ops list without double-notifying.
export async function expireExtraShiftInvites() {
  const { rows } = await pool.query(
    `with expiring as (
       select e.id, e.date::text as date, e.shift_type as st, au.name as freela
         from public.extra_shift_requests e
         left join public.users au on au.id = e.assigned_user_id
        where e.status = 'awaiting_accept'
          and e.accept_deadline is not null and e.accept_deadline < now()
        for update of e skip locked
     ), upd as (
       update public.extra_shift_requests t
          set status='pending', assigned_user_id=null, assigned_at=null,
              accept_deadline=null, updated_at=now()
         from expiring where t.id = expiring.id
     )
     select id, date, st as "shiftType", freela from expiring`,
  );
  if (rows.length === 0) return 0;
  const coords = await coordinatorIds();
  for (const e of rows) {
    for (const cid of coords) {
      await notify({
        recipientUserId: cid, type: "coverage_deficit",
        title: "Turno extra sem aceite",
        body: `${e.freela || "O freelancer"} não aceitou o turno extra de ${shiftPt(e.shiftType)} em ${e.date} no prazo. Escale outra pessoa.`,
        data: { extraShiftId: e.id, path: "/extra-shifts" },
      }).catch(() => {});
    }
  }
  return rows.length;
}

// GET /api/extra-shifts/invites — a freelancer's pending extra-shift invites (accept/decline).
router.get("/invites", async (req, res) => {
  try {
    if (!isFreela(req.user.role)) return res.json([]);
    const { rows } = await pool.query(
      `select e.id, e.restaurant_id as "restaurantId", r.name as "restaurantName",
              e.date::text as date, e.shift_type as "shiftType", e.reason,
              e.accept_deadline as "acceptDeadline"
         from public.extra_shift_requests e
         left join public.restaurants r on r.id = e.restaurant_id
        where e.status = 'awaiting_accept' and e.assigned_user_id = $1
          and (e.accept_deadline is null or e.accept_deadline > now())
        order by e.accept_deadline asc nulls last`,
      [req.user.sub],
    );
    res.json(rows);
  } catch (e) {
    console.error("extra-shift invites error:", e.message);
    res.status(500).json({ error: "Falha ao carregar convites." });
  }
});

// GET /api/extra-shifts — ops see all (pending first); managers see their own (no names).
router.get("/", async (req, res) => {
  try {
    if (isOps(req.user.role)) {
      await expireExtraShiftInvites().catch(() => {}); // keep the queue fresh
      const { rows } = await pool.query(
        `select ${REQ_SELECT_OPS} ${REQ_FROM}
          order by (e.status = 'pending') desc, e.created_at desc limit 100`,
      );
      return res.json(rows);
    }
    if (req.user.role === "restaurant_manager") {
      const { rows } = await pool.query(
        `select ${REQ_BASE} ${REQ_FROM}
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

    // Block requests with less than 48h lead time to the shift start (restaurant tz).
    const startTimes = await resolveShiftTimes(restaurantId, b.shiftType);
    const lead = await one(
      `select extract(epoch from (
         (($1::date + $2::time) at time zone coalesce((select timezone from public.restaurants where id = $3), 'America/Sao_Paulo'))
         - now())) as secs`,
      [b.date, startTimes.startTime, restaurantId],
    );
    if (Number(lead?.secs ?? 0) < 48 * 3600) {
      return res.status(400).json({ error: "lead_time", message: "Turnos extras exigem no mínimo 48h de antecedência." });
    }

    const row = await one(
      `insert into public.extra_shift_requests
         (restaurant_id, date, shift_type, headcount, reason, requested_by)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [restaurantId, b.date, b.shiftType, headcount, b.reason || null, req.user.sub],
    );

    for (const cid of await coordinatorIds()) {
      await notify({
        recipientUserId: cid, type: "coverage_deficit",
        title: "Pedido de turno extra",
        body: `${req.user.name || "Um gestor"} pediu um turno extra (${shiftPt(b.shiftType)}) em ${b.date}.`,
        data: { extraShiftId: row.id, path: "/extra-shifts" },
      });
    }
    res.status(201).json({ id: row.id, status: "pending" });
  } catch (e) {
    console.error("extra-shift create error:", e.message);
    res.status(500).json({ error: "Falha ao solicitar turno extra." });
  }
});

// Load a request in a required status or send the proper error; returns the row or null.
async function loadIn(req, res, requiredStatus) {
  if (!isOps(req.user.role)) { res.status(403).json({ error: "Forbidden" }); return null; }
  const e = await one(
    `select id, restaurant_id as "restaurantId", date::text as date, shift_type as "shiftType",
            headcount, status, requested_by as "requestedBy", assigned_user_id as "assignedUserId"
       from public.extra_shift_requests where id = $1`,
    [req.params.id],
  );
  if (!e) { res.status(404).json({ error: "Not found" }); return null; }
  if (e.status !== requiredStatus) {
    res.status(400).json({ error: "bad_state", message: "Este pedido já foi resolvido." });
    return null;
  }
  return e;
}

// POST /api/extra-shifts/:id/assign { userId } — coordinator INVITES a freelancer.
// The invite must be accepted within 24h; the manager is NOT confirmed yet.
router.post("/:id/assign", async (req, res) => {
  try {
    const e = await loadIn(req, res, "pending");
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

    await pool.query(
      `update public.extra_shift_requests
          set status='awaiting_accept', assigned_user_id=$2, assigned_at=now(),
              accept_deadline = now() + interval '24 hours',
              decided_by=$3, decided_at=now(), updated_at=now()
        where id=$1`,
      [e.id, userId, req.user.sub],
    );

    await notify({
      recipientUserId: userId, type: "extra_shift_invite",
      title: "Convite de turno extra",
      body: `Você foi convidado para um turno extra de ${shiftPt(e.shiftType)} em ${e.date}. Aceite em até 24h na tela de Vagas.`,
      data: { extraShiftId: e.id, path: "/vagas" },
    });
    res.status(201).json({ status: "awaiting_accept" });
  } catch (e2) {
    console.error("extra-shift assign error:", e2.message);
    res.status(500).json({ error: "Falha ao convidar o freelancer." });
  }
});

// POST /api/extra-shifts/:id/cancel-invite — coordinator withdraws a pending invite,
// returning the request to 'pending' so someone else can be scheduled.
router.post("/:id/cancel-invite", async (req, res) => {
  try {
    const e = await loadIn(req, res, "awaiting_accept");
    if (!e) return;
    await pool.query(
      `update public.extra_shift_requests
          set status='pending', assigned_user_id=null, assigned_at=null,
              accept_deadline=null, updated_at=now() where id=$1`,
      [e.id],
    );
    if (e.assignedUserId) {
      await notify({
        recipientUserId: e.assignedUserId, type: "extra_shift_invite",
        title: "Convite de turno extra cancelado",
        body: `O convite para o turno extra de ${shiftPt(e.shiftType)} em ${e.date} foi cancelado pela coordenação.`,
        data: { extraShiftId: e.id, path: "/vagas" },
      });
    }
    res.json({ status: "pending" });
  } catch (e2) {
    console.error("extra-shift cancel-invite error:", e2.message);
    res.status(500).json({ error: "Falha ao cancelar o convite." });
  }
});

// POST /api/extra-shifts/:id/accept — the invited freelancer accepts (within 24h).
router.post("/:id/accept", async (req, res) => {
  try {
    if (!isFreela(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    const e = await one(
      `select id, restaurant_id as "restaurantId", date::text as date, shift_type as "shiftType",
              status, requested_by as "requestedBy", assigned_user_id as "assignedUserId",
              accept_deadline as "acceptDeadline"
         from public.extra_shift_requests where id = $1`,
      [req.params.id],
    );
    if (!e) return res.status(404).json({ error: "Not found" });
    if (e.assignedUserId !== req.user.sub || e.status !== "awaiting_accept") {
      return res.status(400).json({ error: "bad_state", message: "Este convite não está mais disponível." });
    }
    if (e.acceptDeadline && new Date(e.acceptDeadline).getTime() < Date.now()) {
      return res.status(409).json({ error: "expired", message: "O prazo para aceitar este convite expirou." });
    }
    if (e.date < today()) return res.status(400).json({ error: "past_date", message: "Este turno já passou." });
    const clash = await one(
      `select 1 from public.schedule_assignments
        where user_id = $1 and date = $2 and shift_type = $3 and status <> 'cancelled'`,
      [req.user.sub, e.date, e.shiftType],
    );
    if (clash) return res.status(409).json({ error: "clash", message: "Você já está escalado neste turno." });

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
       values ($1,$2,$3,$4,$5,$6,$7,'published',$8,true,'coordinator',$3, now())
       returning id`,
      [cyc?.id ?? null, e.restaurantId, req.user.sub, e.date, e.shiftType, times.startTime, times.endTime, weekendMandatory],
    );
    await pool.query(
      `update public.extra_shift_requests set status='filled', updated_at=now() where id=$1`, [e.id],
    );

    // Manager: confirm as "aprovado" WITHOUT naming the freelancer (they may change).
    if (e.requestedBy) {
      await notify({
        recipientUserId: e.requestedBy, type: "coverage_deficit",
        title: "Turno extra aprovado",
        body: `Seu turno extra de ${shiftPt(e.shiftType)} em ${e.date} foi aprovado.`,
        data: { extraShiftId: e.id, path: "/extra-shifts" },
      });
    }
    // Coordination: they DO see who accepted.
    for (const cid of await coordinatorIds()) {
      await notify({
        recipientUserId: cid, type: "schedule_published",
        title: "Turno extra aceito",
        body: `${req.user.name || "O freelancer"} aceitou o turno extra de ${shiftPt(e.shiftType)} em ${e.date}.`,
        data: { extraShiftId: e.id, assignmentId: a.id },
      });
    }
    res.status(201).json({ status: "filled", assignmentId: a.id });
  } catch (e2) {
    console.error("extra-shift accept error:", e2.message);
    res.status(500).json({ error: "Falha ao aceitar o turno extra." });
  }
});

// POST /api/extra-shifts/:id/decline — the invited freelancer declines; back to 'pending'.
router.post("/:id/decline", async (req, res) => {
  try {
    if (!isFreela(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    const e = await one(
      `select id, date::text as date, shift_type as "shiftType", status, assigned_user_id as "assignedUserId"
         from public.extra_shift_requests where id = $1`,
      [req.params.id],
    );
    if (!e) return res.status(404).json({ error: "Not found" });
    if (e.assignedUserId !== req.user.sub || e.status !== "awaiting_accept") {
      return res.status(400).json({ error: "bad_state", message: "Este convite não está mais disponível." });
    }
    await pool.query(
      `update public.extra_shift_requests
          set status='pending', assigned_user_id=null, assigned_at=null,
              accept_deadline=null, updated_at=now() where id=$1`,
      [e.id],
    );
    for (const cid of await coordinatorIds()) {
      await notify({
        recipientUserId: cid, type: "coverage_deficit",
        title: "Turno extra recusado",
        body: `${req.user.name || "O freelancer"} recusou o turno extra de ${shiftPt(e.shiftType)} em ${e.date}. Escale outra pessoa.`,
        data: { extraShiftId: e.id, path: "/extra-shifts" },
      });
    }
    res.json({ status: "pending" });
  } catch (e2) {
    console.error("extra-shift decline error:", e2.message);
    res.status(500).json({ error: "Falha ao recusar o turno extra." });
  }
});

// POST /api/extra-shifts/:id/open — coordinator opens it as a vaga (is_extra demand override).
router.post("/:id/open", async (req, res) => {
  try {
    const e = await loadIn(req, res, "pending");
    if (!e) return;
    if (e.date < today()) return res.status(400).json({ error: "past_date", message: "Este turno já passou." });

    // How many are already scheduled for this slot? Add headcount on top so the
    // vaga system exposes exactly the extra openings.
    const filled = (await one(
      `select count(*)::int as n from public.schedule_assignments
        where restaurant_id = $1 and date = $2 and shift_type = $3 and status <> 'cancelled'`,
      [e.restaurantId, e.date, e.shiftType])).n;
    // Link the override back to this request (so the vaga-claim path can confirm the manager).
    await pool.query(
      `insert into public.demand_overrides (restaurant_id, date, shift_type, required_count, reason, is_extra, extra_shift_request_id, created_by)
       values ($1,$2,$3,$4,$5,true,$6,$7)
       on conflict (restaurant_id, date, shift_type) do update set
         required_count = greatest(public.demand_overrides.required_count, excluded.required_count),
         is_extra = true, reason = coalesce(excluded.reason, public.demand_overrides.reason),
         extra_shift_request_id = coalesce(excluded.extra_shift_request_id, public.demand_overrides.extra_shift_request_id)`,
      [e.restaurantId, e.date, e.shiftType, filled + e.headcount, e.reason || "Turno extra", e.id, req.user.sub],
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

// POST /api/extra-shifts/:id/reject — coordinator declines the manager's request.
router.post("/:id/reject", async (req, res) => {
  try {
    const e = await loadIn(req, res, "pending");
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
