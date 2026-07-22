import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { notify, notifyMany, coordinatorIds } from "../notify.js";
import { runCycleMaintenance, notifyCycleDeficits } from "../scheduler.js";

// Availability cycles + submissions (§2.1, §2.2, §3.1, §3.2).
const router = Router();
router.use(requireAuth);
const requireOps = requireRole("coordinator", "administrator");
// Who may build the schedule (and therefore see the candidate pool for a slot).
const requireSchedulers = requireRole("coordinator", "administrator", "restaurant_manager");

const CYCLE_COLS = `id, reference_month::text as "referenceMonth",
  opens_at as "opensAt", closes_at as "closesAt", status, reopened,
  published_at as "publishedAt", created_at as "createdAt", updated_at as "updatedAt"`;

const SUB_COLS = `id, cycle_id as "cycleId", user_id as "userId", date::text as date,
  shift_type as "shiftType", restaurant_id as "restaurantId",
  preference_rank as "preferenceRank", status, cancelled_at as "cancelledAt",
  created_at as "createdAt"`;

// Recompute the cached current_score (sum of non-voided events) for a user.
async function recomputeScore(userId) {
  await pool.query(
    `update public.freelancer_profiles set current_score = coalesce(
       (select sum(points) from public.score_events where user_id = $1 and is_voided = false), 0)
     where user_id = $1`,
    [userId],
  );
}

// Reward flexibility (§ reward those with no restaurant preference): once per cycle,
// a freelancer with at least one active "any restaurant" (restaurant_id null)
// submission earns the configured points. Idempotent — adds the event when it's
// due and none exists, voids it when they no longer offer any flexible slot.
async function syncFlexibleScore(userId, cycleId) {
  const cyc = await one(
    `select reference_month::text as "monthRef" from public.availability_cycles where id = $1`,
    [cycleId],
  );
  if (!cyc) return;
  const has = await one(
    `select 1 from public.availability_submissions
      where cycle_id = $1 and user_id = $2 and restaurant_id is null and status = 'submitted' limit 1`,
    [cycleId, userId],
  );
  const existing = await one(
    `select id from public.score_events
      where user_id = $1 and event_type = 'flexible_availability'
        and reference_type = 'engagement' and reference_id = $2 and is_voided = false limit 1`,
    [userId, cycleId],
  );
  if (has && !existing) {
    const cfg = await one(`select flexible_availability_points as p from public.app_settings where id = 1`);
    const points = Number(cfg?.p ?? 2);
    if (points !== 0) {
      await pool.query(
        `insert into public.score_events
           (user_id, event_type, points, reference_type, reference_id, occurred_on, month_ref, notes)
         values ($1, 'flexible_availability', $2, 'engagement', $3, $4, $4, $5)`,
        [userId, points, cycleId, cyc.monthRef, "Disponibilidade sem preferência de restaurante"],
      );
      await recomputeScore(userId);
    }
  } else if (!has && existing) {
    await pool.query(`update public.score_events set is_voided = true where id = $1`, [existing.id]);
    await recomputeScore(userId);
  }
}

// Monthly weekend-availability target (§8 "10 turnos"): a freelancer earns the
// target bonus by MARKING availability for at least `monthly_target_shifts` (default
// 10) of the FOUR mandatory weekend turnos — Fri dinner, Sat lunch, Sat dinner, Sun
// lunch — in the cycle, even if never scheduled. Counted per DISTINCT (date, turno),
// so marking the same slot for several restaurants (or "any restaurant") does NOT
// inflate the count. Fri lunch and Sun dinner never count. Idempotent, once per
// cycle, auto-voided if they later drop below the threshold — mirrors the flexible
// reward. Uses the existing 'target_10_shifts' event, tagged engagement/cycle so it
// never collides with a coordinator's manual adjustment.
async function syncWeekendTargetScore(userId, cycleId) {
  const cyc = await one(
    `select reference_month::text as "monthRef" from public.availability_cycles where id = $1`,
    [cycleId],
  );
  if (!cyc) return;
  const cfg = await one(
    `select monthly_target_shifts as threshold, weekend_target_points as points
       from public.app_settings where id = 1`,
  );
  const threshold = Number(cfg?.threshold ?? 10);
  const points = Number(cfg?.points ?? 5);
  const cnt = await one(
    `select count(distinct (date::text || '|' || shift_type)) as n
       from public.availability_submissions
      where cycle_id = $1 and user_id = $2 and status = 'submitted'
        and date >= $3::date and date < ($3::date + interval '1 month')  -- only this month's turnos
        and (
          (extract(dow from date) = 5 and shift_type = 'dinner') or   -- Friday dinner
          (extract(dow from date) = 6 and shift_type in ('lunch','dinner')) or -- Saturday
          (extract(dow from date) = 0 and shift_type = 'lunch')       -- Sunday lunch
        )`,
    [cycleId, userId, cyc.monthRef],
  );
  const qualifies = Number(cnt?.n ?? 0) >= threshold;
  const existing = await one(
    `select id from public.score_events
      where user_id = $1 and event_type = 'target_10_shifts'
        and reference_type = 'engagement' and reference_id = $2 and is_voided = false limit 1`,
    [userId, cycleId],
  );
  if (qualifies && !existing) {
    if (points !== 0) {
      await pool.query(
        `insert into public.score_events
           (user_id, event_type, points, reference_type, reference_id, occurred_on, month_ref, notes)
         values ($1, 'target_10_shifts', $2, 'engagement', $3, $4, $4, $5)`,
        [userId, points, cycleId, cyc.monthRef,
         `Disponibilidade de ${threshold}+ turnos de fim de semana no mês`],
      );
      await recomputeScore(userId);
    }
  } else if (!qualifies && existing) {
    await pool.query(`update public.score_events set is_voided = true where id = $1`, [existing.id]);
    await recomputeScore(userId);
  }
}

// ---- Cycles ---------------------------------------------------------------

// GET /api/availability/cycles?month=YYYY-MM-DD  (null when none — 200, not 404)
router.get("/cycles", async (req, res) => {
  const month = req.query.month;
  if (month) {
    const row = await one(`select ${CYCLE_COLS} from public.availability_cycles where reference_month = $1`, [month]);
    return res.json(row);
  }
  const { rows } = await pool.query(`select ${CYCLE_COLS} from public.availability_cycles order by reference_month desc`);
  res.json(rows);
});

router.post("/cycles", requireOps, async (req, res) => {
  const b = req.body || {};
  if (!b.referenceMonth || !b.opensAt || !b.closesAt) {
    return res.status(400).json({ error: "referenceMonth, opensAt and closesAt are required" });
  }
  const row = await one(
    `insert into public.availability_cycles (reference_month, opens_at, closes_at, status)
     values ($1, $2, $3, 'open')
     on conflict (reference_month) do update set opens_at = excluded.opens_at, closes_at = excluded.closes_at
     returning ${CYCLE_COLS}`,
    [b.referenceMonth, b.opensAt, b.closesAt],
  );
  res.status(201).json(row);
});

// PUT /api/availability/cycles/:id/status  { status }
router.put("/cycles/:id/status", requireOps, async (req, res) => {
  const status = (req.body || {}).status;
  if (!["open", "closed", "published"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const reopened = status === "open";
  const row = await one(
    `update public.availability_cycles
       set status = $1,
           reopened = case when $2 then true else reopened end,
           published_at = case when $1 = 'published' then now() else published_at end
     where id = $3 returning ${CYCLE_COLS}`,
    [status, reopened, req.params.id],
  );
  if (!row) return res.status(404).json({ error: "Not found" });
  // Closing the cycle → alert coordinators about availability deficits (§3.5). Best-effort.
  if (status === "closed") notifyCycleDeficits(req.params.id).catch(() => {});
  res.json(row);
});

// ---- Granular reopen exceptions (§3.1) ------------------------------------
// Reopen a closed cycle for ONE restaurant or ONE freelancer.

// GET /api/availability/cycles/:id/reopens
router.get("/cycles/:id/reopens", requireOps, async (req, res) => {
  const { rows } = await pool.query(
    `select r.id, r.cycle_id as "cycleId", r.restaurant_id as "restaurantId",
            r.user_id as "userId", r.created_at as "createdAt",
            rest.name as "restaurantName", u.name as "userName"
       from public.availability_reopens r
       left join public.restaurants rest on rest.id = r.restaurant_id
       left join public.users u on u.id = r.user_id
      where r.cycle_id = $1 order by r.created_at desc`,
    [req.params.id],
  );
  res.json(rows);
});

// POST /api/availability/cycles/:id/reopens  { restaurantId } | { userId }
router.post("/cycles/:id/reopens", requireOps, async (req, res) => {
  const b = req.body || {};
  const restaurantId = b.restaurantId || null;
  const userId = b.userId || null;
  if ((restaurantId === null) === (userId === null)) {
    return res.status(400).json({ error: "Provide exactly one of restaurantId or userId" });
  }
  try {
    const row = await one(
      `insert into public.availability_reopens (cycle_id, restaurant_id, user_id, created_by)
       values ($1,$2,$3,$4) on conflict do nothing returning id`,
      [req.params.id, restaurantId, userId, req.user.sub],
    );
    res.status(201).json(row ?? { ok: true, duplicate: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/availability/reopens/:id
router.delete("/reopens/:id", requireOps, async (req, res) => {
  await pool.query(`delete from public.availability_reopens where id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// POST /api/availability/run-maintenance — manually trigger the daily cycle job
// (reminders + auto-close) for testing/ops. Coordinator/administrator only.
router.post("/run-maintenance", requireOps, async (_req, res) => {
  try {
    const summary = await runCycleMaintenance();
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Submissions ----------------------------------------------------------

// GET /api/availability/submissions?cycleId=&userId=
router.get("/submissions", async (req, res) => {
  const { cycleId, userId } = req.query;
  const conds = [];
  const vals = [];
  let i = 1;
  // A freelancer/visitor may only read their OWN availability — never anyone else's.
  const selfOnly = req.user.role === "freelancer" || req.user.role === "visitor";
  if (selfOnly) { conds.push(`user_id = $${i++}`); vals.push(req.user.sub); }
  if (cycleId) { conds.push(`cycle_id = $${i++}`); vals.push(cycleId); }
  if (userId && !selfOnly) { conds.push(`user_id = $${i++}`); vals.push(userId); }
  const where = conds.length ? `where ${conds.join(" and ")}` : "";
  const { rows } = await pool.query(
    `select ${SUB_COLS} from public.availability_submissions ${where} order by date asc, shift_type asc`,
    vals,
  );
  res.json(rows);
});

// GET /api/availability/submissions/slot?cycleId=&date=&shiftType=&restaurantId=
// Candidate pool for a slot in the schedule builder (§3.3). A freelancer who marked
// availability for this date+shift can be assigned to ANY restaurant, regardless of
// where they registered — so the pool is NOT filtered by restaurant. Freelancers
// registered to this restaurant (linked as a client OR who chose it for this slot)
// are flagged `registeredHere` and sorted to the top. One row per freelancer.
router.get("/submissions/slot", requireSchedulers, async (req, res) => {
  const { cycleId, date, shiftType, restaurantId } = req.query;
  if (!cycleId || !date || !shiftType) {
    return res.status(400).json({ error: "cycleId, date and shiftType are required" });
  }
  const { rows } = await pool.query(
    `select min(s.id::text) as id, s.cycle_id as "cycleId", s.user_id as "userId",
            $2::date as date, s.shift_type as "shiftType", u.name,
            coalesce(p.current_score, 0) as score, p.current_level as level,
            p.transport, p.experience, p.home_address as "homeAddress",
            bool_or(s.restaurant_id is null) as flexible,
            (coalesce(bool_or(s.restaurant_id = $4), false)
             or bool_or(s.restaurant_id is null)
             or exists (select 1 from public.member_clients mc
                         where mc.member_user_id = s.user_id and mc.restaurant_id = $4)) as "registeredHere"
       from public.availability_submissions s
       join public.users u on u.id = s.user_id
       left join public.freelancer_profiles p on p.user_id = s.user_id
      where s.cycle_id = $1 and s.date = $2 and s.shift_type = $3 and s.status = 'submitted'
      group by s.cycle_id, s.user_id, s.shift_type, u.name,
               p.current_score, p.current_level, p.transport, p.experience, p.home_address
      order by "registeredHere" desc, score desc, u.name asc`,
    [cycleId, date, shiftType, restaurantId ?? null],
  );
  res.json(rows);
});

// POST /api/availability/submissions
router.post("/submissions", async (req, res) => {
  const b = req.body || {};
  // A freelancer submits their own availability; coordinators may submit for anyone.
  const targetUser = b.userId || req.user.sub;
  const isSelf = targetUser === req.user.sub;
  const isOps = req.user.role === "coordinator" || req.user.role === "administrator";
  if (!isSelf && !isOps) return res.status(403).json({ error: "Forbidden" });
  // R16: coordination does not register its OWN availability (they build the
  // schedule, they are not scheduled). Submitting on behalf of a freelancer
  // (targetUser !== self) is still allowed as an ops override.
  if (isSelf && isOps) {
    return res.status(403).json({ error: "ops_no_self_availability", message: "Coordenação não registra a própria disponibilidade." });
  }
  if (!b.cycleId || !b.date || !b.shiftType) {
    return res.status(400).json({ error: "cycleId, date and shiftType are required" });
  }
  // restaurantId omitted / null = "any restaurant / no preference" (§3.2).
  const restaurantId = b.restaurantId ?? null;

  // Cycle must be open to receive availability (§3.1 "Dia 25: encerra recebimento").
  // Coordinators/administrators may always submit (they build & reopen schedules).
  // A closed cycle still accepts submissions for a restaurant/freelancer that the
  // coordinator has individually reopened (§3.1 "pode reabrir para um restaurante
  // ou para algum freelancer").
  if (!isOps) {
    // No client-link requirement (client 2026-07-22): a freelancer may offer any active
    // restaurant. A specific-restaurant offer must simply point to an active restaurant.
    if (restaurantId) {
      const active = await one(
        `select 1 from public.restaurants where id = $1 and active = true`, [restaurantId],
      );
      if (!active) {
        return res.status(400).json({ error: "invalid_restaurant", message: "Restaurante inválido ou inativo." });
      }
    }
    const cyc = await one(`select status from public.availability_cycles where id = $1`, [b.cycleId]);
    if (!cyc) return res.status(404).json({ error: "Cycle not found" });
    if (cyc.status !== "open") {
      const reopen = await one(
        `select 1 from public.availability_reopens
          where cycle_id = $1 and (restaurant_id = $2 or user_id = $3) limit 1`,
        [b.cycleId, restaurantId, targetUser],
      );
      if (!reopen) {
        return res.status(403).json({
          error: "cycle_closed",
          message: "O período de disponibilidade está encerrado. Fale com a coordenadora para reabrir.",
        });
      }
    }
  }

  // The conflict target differs: specific rows use the named unique, "any" rows use
  // the partial unique index (restaurant_id is null).
  const row = restaurantId
    ? await one(
        `insert into public.availability_submissions
           (cycle_id, user_id, date, shift_type, restaurant_id, preference_rank, status)
         values ($1, $2, $3, $4, $5, $6, 'submitted')
         on conflict (cycle_id, user_id, date, shift_type, restaurant_id)
           do update set status = 'submitted', cancelled_at = null,
                         preference_rank = excluded.preference_rank
         returning ${SUB_COLS}`,
        [b.cycleId, targetUser, b.date, b.shiftType, restaurantId, b.preferenceRank ?? null],
      )
    : await one(
        `insert into public.availability_submissions
           (cycle_id, user_id, date, shift_type, restaurant_id, preference_rank, status)
         values ($1, $2, $3, $4, null, $5, 'submitted')
         on conflict (cycle_id, user_id, date, shift_type) where restaurant_id is null
           do update set status = 'submitted', cancelled_at = null,
                         preference_rank = excluded.preference_rank
         returning ${SUB_COLS}`,
        [b.cycleId, targetUser, b.date, b.shiftType, b.preferenceRank ?? null],
      );

  // Keep the availability-based rewards in sync: flexibility (§ no-preference) and
  // the monthly weekend-turno target (§8 "10 turnos").
  await syncFlexibleScore(targetUser, b.cycleId);
  await syncWeekendTargetScore(targetUser, b.cycleId);
  res.status(201).json(row);
});

// PUT /api/availability/submissions/bulk — reconcile a freelancer's WHOLE
// availability for a cycle in one atomic shot (§ "Enviar minha disponibilidade").
// Body: { cycleId, userId?, slots: [{ date, shiftType, restaurantId|null }] }.
// Every slot in `slots` becomes submitted; any currently-submitted slot NOT in the
// list is cancelled. Same gates as the single submit (window open, client links).
router.put("/submissions/bulk", async (req, res) => {
  const b = req.body || {};
  const targetUser = b.userId || req.user.sub;
  const isSelf = targetUser === req.user.sub;
  const isOps = req.user.role === "coordinator" || req.user.role === "administrator";
  if (!isSelf && !isOps) return res.status(403).json({ error: "Forbidden" });
  // R16: coordination does not register its OWN availability (see POST /submissions).
  if (isSelf && isOps) {
    return res.status(403).json({ error: "ops_no_self_availability", message: "Coordenação não registra a própria disponibilidade." });
  }
  if (!b.cycleId || !Array.isArray(b.slots)) {
    return res.status(400).json({ error: "cycleId and slots[] are required" });
  }

  const keyOf = (s) => `${String(s.date).slice(0, 10)}|${s.shiftType}|${s.restaurantId ?? "ANY"}`;
  // Normalise + de-dupe the desired set.
  const desired = new Map();
  for (const s of b.slots) {
    if (!s || !s.date || !["lunch", "dinner"].includes(s.shiftType)) continue;
    desired.set(keyOf(s), {
      date: String(s.date).slice(0, 10), shiftType: s.shiftType, restaurantId: s.restaurantId ?? null,
    });
  }

  const cyc = await one(`select status from public.availability_cycles where id = $1`, [b.cycleId]);
  if (!cyc) return res.status(404).json({ error: "Cycle not found" });

  if (!isOps) {
    // Window must be open (freelancers submit during the open window).
    if (cyc.status !== "open") {
      const reopen = await one(
        `select 1 from public.availability_reopens where cycle_id = $1 and user_id = $2 limit 1`,
        [b.cycleId, targetUser],
      );
      if (!reopen) {
        return res.status(403).json({
          error: "cycle_closed",
          message: "O período de disponibilidade está encerrado. Fale com a coordenadora para reabrir.",
        });
      }
    }
    // No client-link requirement (client 2026-07-22): a freelancer may offer any active
    // restaurant. Only validate that specific choices point to active restaurants.
    const restIds = [...new Set([...desired.values()].map((s) => s.restaurantId).filter(Boolean))];
    if (restIds.length) {
      const { rows: act } = await pool.query(
        `select id from public.restaurants where id = any($1::uuid[]) and active = true`, [restIds],
      );
      const activeSet = new Set(act.map((r) => r.id));
      for (const id of restIds) {
        if (!activeSet.has(id)) {
          return res.status(400).json({ error: "invalid_restaurant", message: "Um dos restaurantes selecionados é inválido ou inativo." });
        }
      }
    }
  }

  const removed = []; // previously-submitted slots this edit cancels (for the alert below)
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows: cur } = await client.query(
      `select id, date::text as date, shift_type as "shiftType", restaurant_id as "restaurantId"
         from public.availability_submissions
        where cycle_id = $1 and user_id = $2 and status = 'submitted'`,
      [b.cycleId, targetUser],
    );
    const curByKey = new Map(cur.map((r) => [keyOf(r), r]));

    // Cancel submitted slots no longer desired — collect them so coordination can be
    // alerted (client 2026-07-21: a freelancer who removes an already-submitted day
    // during the open window changes the availability counts the coordinator relies on).
    for (const [k, row] of curByKey) {
      if (!desired.has(k)) {
        await client.query(
          `update public.availability_submissions set status='cancelled', cancelled_at=now() where id=$1`,
          [row.id],
        );
        removed.push({ date: row.date, shiftType: row.shiftType, restaurantId: row.restaurantId });
      }
    }
    // Submit (or re-activate) desired slots not already submitted.
    for (const [k, s] of desired) {
      if (curByKey.has(k)) continue;
      if (s.restaurantId) {
        await client.query(
          `insert into public.availability_submissions (cycle_id,user_id,date,shift_type,restaurant_id,status)
           values ($1,$2,$3,$4,$5,'submitted')
           on conflict (cycle_id,user_id,date,shift_type,restaurant_id)
             do update set status='submitted', cancelled_at=null`,
          [b.cycleId, targetUser, s.date, s.shiftType, s.restaurantId],
        );
      } else {
        await client.query(
          `insert into public.availability_submissions (cycle_id,user_id,date,shift_type,restaurant_id,status)
           values ($1,$2,$3,$4,null,'submitted')
           on conflict (cycle_id,user_id,date,shift_type) where restaurant_id is null
             do update set status='submitted', cancelled_at=null`,
          [b.cycleId, targetUser, s.date, s.shiftType],
        );
      }
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    client.release();
    console.error("bulk availability error:", e.message);
    return res.status(500).json({ error: "Falha ao enviar disponibilidade." });
  }
  client.release();

  await syncFlexibleScore(targetUser, b.cycleId);
  await syncWeekendTargetScore(targetUser, b.cycleId);

  // Alert coordination when a freelancer removed days they had already submitted, so a
  // drop in availability (e.g. many people pulling out of Father's Day) never goes
  // unnoticed. One summary notification per edit; only for the freelancer's own edits.
  if (removed.length && isSelf) {
    try {
      const me = await one(`select name from public.users where id = $1`, [targetUser]);
      const restIds = [...new Set(removed.map((r) => r.restaurantId).filter(Boolean))];
      const restMap = new Map();
      if (restIds.length) {
        const { rows: rr } = await pool.query(
          `select id, name from public.restaurants where id = any($1::uuid[])`, [restIds],
        );
        rr.forEach((r) => restMap.set(r.id, r.name));
      }
      const label = (r) =>
        `${r.date.slice(8, 10)}/${r.date.slice(5, 7)} ${r.shiftType === "lunch" ? "almoço" : "janta"}` +
        (r.restaurantId && restMap.get(r.restaurantId) ? ` (${restMap.get(r.restaurantId)})` : "");
      const list = removed.map(label).join(", ");
      await notifyMany(await coordinatorIds(), () => ({
        type: "availability_cancelled",
        title: "Disponibilidade alterada",
        body: `${me?.name ?? "Um freelancer"} retirou da disponibilidade: ${list}`,
        data: { path: "/availability", userId: targetUser, cycleId: b.cycleId, removed: removed.length },
      }));
    } catch (e) {
      console.error("availability removal notify error:", e.message);
    }
  }

  const { rows } = await pool.query(
    `select ${SUB_COLS} from public.availability_submissions
      where cycle_id = $1 and user_id = $2 and status = 'submitted' order by date asc, shift_type asc`,
    [b.cycleId, targetUser],
  );
  res.json(rows);
});

// DELETE /api/availability/submissions/:id — cancel a submission; coordinator is
// notified immediately (§3.2 / §11 "availability_cancelled").
router.delete("/submissions/:id", async (req, res) => {
  const sub = await one(
    `select s.id, s.cycle_id as "cycleId", s.user_id as "userId", s.date, s.shift_type as "shiftType",
            s.restaurant_id as "restaurantId", u.name, r.name as "restaurantName"
       from public.availability_submissions s
       join public.users u on u.id = s.user_id
       left join public.restaurants r on r.id = s.restaurant_id
      where s.id = $1`,
    [req.params.id],
  );
  if (!sub) return res.status(404).json({ error: "Not found" });
  const isSelf = sub.userId === req.user.sub;
  const isOps = req.user.role === "coordinator" || req.user.role === "administrator";
  if (!isSelf && !isOps) return res.status(403).json({ error: "Forbidden" });

  await pool.query(
    `update public.availability_submissions set status = 'cancelled', cancelled_at = now() where id = $1`,
    [req.params.id],
  );
  // A cancelled row may end the flexibility reward and/or drop them below the
  // monthly weekend-turno target for this cycle.
  await syncFlexibleScore(sub.userId, sub.cycleId);
  await syncWeekendTargetScore(sub.userId, sub.cycleId);

  for (const cid of await coordinatorIds()) {
    await notify({
      recipientUserId: cid,
      type: "availability_cancelled",
      title: "Disponibilidade cancelada",
      body: `${sub.name} cancelou ${sub.shiftType === "lunch" ? "almoço" : "janta"} de ${sub.date}` +
            (sub.restaurantName ? ` (${sub.restaurantName})` : ""),
      data: { submissionId: sub.id, userId: sub.userId, date: sub.date, shiftType: sub.shiftType },
    });
  }
  res.json({ ok: true });
});

// GET /api/availability/my-clients — the active restaurants a freelancer may offer
// availability for. Since 2026-07-22 that is every active restaurant (no link needed).
router.get("/my-clients", async (_req, res) => {
  try {
    // Client 2026-07-22: a freelancer may offer availability for ANY active restaurant
    // (no client link required) and picks it right here on the availability screen.
    const { rows } = await pool.query(
      `select id, name from public.restaurants where active = true order by name`,
    );
    res.json(rows);
  } catch (e) {
    console.error("my-clients error:", e.message);
    res.status(500).json({ error: "Falha ao carregar seus clientes." });
  }
});

// GET /api/availability/vacancies?month=YYYY-MM-01
// Vacancies per (date, shift, restaurant) for the month, pulled from the base
// schedule (restaurant_demand per weekday) with per-date overrides applied (§3.5).
// Freelancers/visitors see only the clients they're linked to; ops see all active.
router.get("/vacancies", async (req, res) => {
  try {
    const month = req.query.month;
    if (!month || !/^\d{4}-\d{2}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: "month (YYYY-MM-01) is required" });
    }
    const isOps = req.user.role === "coordinator" || req.user.role === "administrator";
    const restsSql = isOps
      ? `select id as restaurant_id from public.restaurants where active = true`
      : `select restaurant_id from public.member_clients where member_user_id = $2`;
    const params = isOps ? [month] : [month, req.user.sub];
    const { rows } = await pool.query(
      `with days as (
         select d::date as date, extract(dow from d)::int as weekday
           from generate_series($1::date, ($1::date + interval '1 month' - interval '1 day'), interval '1 day') d
       ),
       rests as (${restsSql}),
       shifts as (select unnest(array['lunch','dinner']) as shift_type)
       select rests.restaurant_id as "restaurantId", days.date::text as date,
              shifts.shift_type as "shiftType",
              coalesce(ov.required_count, base.required_count, 0)::int as required
         from rests
         cross join days
         cross join shifts
         left join public.demand_overrides ov
           on ov.restaurant_id = rests.restaurant_id and ov.date = days.date
              and ov.shift_type = shifts.shift_type
         left join public.restaurant_demand base
           on base.restaurant_id = rests.restaurant_id and base.weekday = days.weekday
              and base.shift_type = shifts.shift_type
        where coalesce(ov.required_count, base.required_count, 0) > 0`,
      params,
    );
    res.json(rows);
  } catch (e) {
    console.error("vacancies error:", e.message);
    res.status(500).json({ error: "Falha ao carregar as vagas." });
  }
});

export default router;
