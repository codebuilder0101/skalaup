import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth } from "../auth.js";
import { resolveDemand } from "../demand.js";
import { weekdayOf, isWeekendMandatory, resolveShiftTimes } from "../scheduleRules.js";
import { notify, coordinatorIds } from "../notify.js";

// Open vagas / furos that a freelancer can SELF-ACCEPT (§ client flow). Priority is
// score-based: while a vaga is fresh (within `vaga_priority_window_minutes`) only the
// freelancers who made themselves available for it — enrolled in waiting_list, ranked
// by score — may claim it; once the window elapses (or nobody was available) it opens
// to everyone. Accepting schedules the person immediately, no coordinator approval.
const router = Router();
router.use(requireAuth);

const isFreela = (role) => role === "freelancer" || role === "visitor";

async function priorityWindowMin() {
  const row = await one(`select vaga_priority_window_minutes as w from public.app_settings where id = 1`);
  return Number(row?.w ?? 30);
}

// GET /api/vacancies/open — vagas the current freelancer may claim right now.
router.get("/open", async (req, res) => {
  try {
    if (!isFreela(req.user.role)) return res.json([]); // only freelancers claim vagas
    const uid = req.user.sub;
    const win = await priorityWindowMin();
    const { rows } = await pool.query(
      `with pub as (
         select id as cycle_id, reference_month from public.availability_cycles where status = 'published'
       ),
       days as (
         select pub.cycle_id, d::date as date, extract(dow from d)::int as weekday
           from pub, generate_series(pub.reference_month,
                                     (pub.reference_month + interval '1 month' - interval '1 day'),
                                     interval '1 day') d
          where d::date >= current_date
       ),
       rests as (select id as restaurant_id, name from public.restaurants where active),
       shifts as (select unnest(array['lunch','dinner']) as shift_type),
       slots as (
         select days.cycle_id, rests.restaurant_id, rests.name as restaurant_name,
                days.date, days.weekday, shifts.shift_type,
                coalesce(ov.required_count, base.required_count, 0) as required
           from days cross join rests cross join shifts
           left join public.demand_overrides ov
             on ov.restaurant_id = rests.restaurant_id and ov.date = days.date and ov.shift_type = shifts.shift_type
           left join public.restaurant_demand base
             on base.restaurant_id = rests.restaurant_id and base.weekday = days.weekday and base.shift_type = shifts.shift_type
       )
       select s.cycle_id as "cycleId", s.restaurant_id as "restaurantId", s.restaurant_name as "restaurantName",
              s.date::text as date, s.shift_type as "shiftType",
              (s.required - (select count(*) from public.schedule_assignments a
                              where a.restaurant_id = s.restaurant_id and a.date = s.date
                                and a.shift_type = s.shift_type and a.status <> 'cancelled'))::int as "openCount",
              wl.opened_at as "openedAt",
              (mine.uid is not null) as "hasPriority"
         from slots s
         left join lateral (
           select min(created_at) as opened_at from public.waiting_list w
            where w.cycle_id = s.cycle_id and w.restaurant_id = s.restaurant_id
              and w.date = s.date and w.shift_type = s.shift_type
         ) wl on true
         left join lateral (
           select 1 as uid from public.waiting_list w
            where w.cycle_id = s.cycle_id and w.restaurant_id = s.restaurant_id
              and w.date = s.date and w.shift_type = s.shift_type and w.user_id = $1 limit 1
         ) mine on true
        where s.required > 0
          and s.required > (select count(*) from public.schedule_assignments a
                             where a.restaurant_id = s.restaurant_id and a.date = s.date
                               and a.shift_type = s.shift_type and a.status <> 'cancelled')
          and not exists (select 1 from public.schedule_assignments a2
                           where a2.user_id = $1 and a2.date = s.date
                             and a2.shift_type = s.shift_type and a2.status <> 'cancelled')
          and (
            wl.opened_at is null                                        -- nobody had priority → open to all
            or extract(epoch from (now() - wl.opened_at)) / 60 >= $2    -- priority window elapsed → open to all
            or mine.uid is not null                                     -- still fresh, but this user has priority
          )
        order by s.date asc, s.shift_type asc`,
      [uid, win],
    );
    res.json(rows);
  } catch (e) {
    console.error("vacancies open error:", e.message);
    res.status(500).json({ error: "Falha ao carregar as vagas." });
  }
});

// POST /api/vacancies/claim { cycleId, restaurantId, date, shiftType }
// Atomically assign the current freelancer to an open vaga. Concurrency-safe via a
// per-slot advisory lock so two people can never over-fill the same slot.
router.post("/claim", async (req, res) => {
  if (!isFreela(req.user.role)) return res.status(403).json({ error: "Forbidden" });
  const b = req.body || {};
  const { cycleId, restaurantId, date, shiftType } = b;
  if (!cycleId || !restaurantId || !date || !["lunch", "dinner"].includes(shiftType)) {
    return res.status(400).json({ error: "cycleId, restaurantId, date and shiftType are required" });
  }
  const uid = req.user.sub;
  const win = await priorityWindowMin();

  const client = await pool.connect();
  try {
    await client.query("begin");
    // Serialize all claims on THIS slot.
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`,
      [`vaga:${restaurantId}:${date}:${shiftType}`]);

    const cyc = (await client.query(
      `select status from public.availability_cycles where id = $1`, [cycleId])).rows[0];
    const cur = (await client.query(`select current_date::text as d`)).rows[0].d;
    if (!cyc || cyc.status !== "published" || date < cur) {
      await client.query("rollback"); client.release();
      return res.status(409).json({ error: "unavailable", message: "Esta vaga não está mais disponível." });
    }

    // Still a real vacancy?
    const required = await resolveDemand(restaurantId, date, shiftType);
    const filled = (await client.query(
      `select count(*)::int as n from public.schedule_assignments
        where restaurant_id = $1 and date = $2 and shift_type = $3 and status <> 'cancelled'`,
      [restaurantId, date, shiftType])).rows[0].n;
    if (required <= filled) {
      await client.query("rollback"); client.release();
      return res.status(409).json({ error: "filled", message: "Essa vaga acabou de ser preenchida." });
    }

    // No clash: not already scheduled that date+shift anywhere.
    const clash = (await client.query(
      `select 1 from public.schedule_assignments
        where user_id = $1 and date = $2 and shift_type = $3 and status <> 'cancelled' limit 1`,
      [uid, date, shiftType])).rows[0];
    if (clash) {
      await client.query("rollback"); client.release();
      return res.status(409).json({ error: "clash", message: "Você já está escalado neste turno." });
    }

    // Priority gate: within the fresh window, only enrolled (available) users may claim.
    const wl = (await client.query(
      `select min(created_at) as opened_at,
              bool_or(user_id = $5) as mine
         from public.waiting_list
        where cycle_id = $1 and restaurant_id = $2 and date = $3 and shift_type = $4`,
      [cycleId, restaurantId, date, shiftType, uid])).rows[0];
    if (wl.opened_at) {
      const ageMin = (Date.now() - new Date(wl.opened_at).getTime()) / 60000;
      if (ageMin < win && !wl.mine) {
        await client.query("rollback"); client.release();
        return res.status(403).json({
          error: "priority_window",
          message: "Esta vaga está reservada por alguns minutos a quem se disponibilizou. Tente novamente em breve.",
        });
      }
    }

    const weekendMandatory = isWeekendMandatory(weekdayOf(date), shiftType);
    const times = await resolveShiftTimes(restaurantId, shiftType);
    const row = (await client.query(
      `insert into public.schedule_assignments
         (cycle_id, restaurant_id, user_id, date, shift_type, start_time, end_time,
          status, is_weekend_mandatory, assigned_via, created_by, published_at)
       values ($1,$2,$3,$4,$5,$6,$7,'published',$8,'waiting_list',$3, now())
       returning id`,
      [cycleId, restaurantId, uid, date, shiftType, times.startTime, times.endTime, weekendMandatory])).rows[0];

    // If this slot exists only because of an extra-shift override (no base demand),
    // flag the assignment as extra so working it earns the furo-cover reward (R9).
    const extra = (await client.query(
      `select 1 from public.demand_overrides ov
        where ov.restaurant_id=$1 and ov.date=$2 and ov.shift_type=$3 and ov.is_extra
          and coalesce((select rd.required_count from public.restaurant_demand rd
                         where rd.restaurant_id=$1 and rd.weekday=$4 and rd.shift_type=$3), 0) = 0
        limit 1`,
      [restaurantId, date, shiftType, weekdayOf(date)])).rows[0];
    if (extra) {
      await client.query(`update public.schedule_assignments set is_extra=true where id=$1`, [row.id]);
    }

    // Mark the claimer promoted (create the row if they weren't enrolled), and if the
    // slot is now full, expire the rest of the waiting list for it.
    const score = (await client.query(
      `select coalesce(current_score,0) as s from public.freelancer_profiles where user_id=$1`, [uid])).rows[0]?.s ?? 0;
    await client.query(
      `insert into public.waiting_list
         (cycle_id, restaurant_id, date, shift_type, user_id, score_snapshot, status)
       values ($1,$2,$3,$4,$5,$6,'promoted')
       on conflict (cycle_id, date, shift_type, restaurant_id, user_id)
         do update set status = 'promoted'`,
      [cycleId, restaurantId, date, shiftType, uid, score]);
    if (required <= filled + 1) {
      await client.query(
        `update public.waiting_list set status = 'expired'
          where cycle_id=$1 and restaurant_id=$2 and date=$3 and shift_type=$4 and status = 'waiting'`,
        [cycleId, restaurantId, date, shiftType]);
    }

    await client.query("commit");
    client.release();

    // Best-effort notifications (never block the claim).
    const shiftPt = shiftType === "lunch" ? "almoço" : "janta";
    notify({
      recipientUserId: uid, type: "schedule_published", title: "Vaga confirmada",
      body: `Você assumiu o ${shiftPt} de ${date}. Já está na escala! Os pontos entram após você trabalhar o turno.`,
      data: { assignmentId: row.id, cycleId, restaurantId, date, shiftType },
    }).catch(() => {});
    coordinatorIds().then((ids) => ids.forEach((cid) => notify({
      recipientUserId: cid, type: "schedule_published", title: "Vaga assumida",
      body: `${req.user.name || "Um freelancer"} assumiu uma vaga de ${shiftPt} em ${date}.`,
      data: { assignmentId: row.id, date, shiftType },
    }).catch(() => {}))).catch(() => {});

    // R20 E3: if this vaga came from a manager's extra-shift request, confirm to that
    // manager now that it's actually filled, and advance the request to 'filled'.
    pool.query(
      `select e.id, e.requested_by as "requestedBy"
         from public.demand_overrides ov
         join public.extra_shift_requests e on e.id = ov.extra_shift_request_id
        where ov.restaurant_id = $1 and ov.date = $2 and ov.shift_type = $3 and e.status = 'opened'
        limit 1`,
      [restaurantId, date, shiftType],
    ).then(async ({ rows: er }) => {
      const ereq = er[0];
      if (!ereq?.requestedBy) return;
      await pool.query(`update public.extra_shift_requests set status='filled', updated_at=now() where id=$1`, [ereq.id]);
      await notify({
        recipientUserId: ereq.requestedBy, type: "coverage_deficit", title: "Turno extra confirmado",
        body: `${req.user.name || "Um freelancer"} assumiu seu turno extra de ${shiftPt} em ${date}.`,
        data: { extraShiftId: ereq.id, path: "/extra-shifts" },
      });
    }).catch(() => {});

    res.status(201).json({ ok: true, assignmentId: row.id });
  } catch (e) {
    try { await client.query("rollback"); } catch { /* ignore */ }
    client.release();
    console.error("vaga claim error:", e.message);
    res.status(500).json({ error: "Falha ao assumir a vaga. Tente novamente." });
  }
});

export default router;
