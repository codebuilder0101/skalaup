import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { weekdayOf, isWeekendMandatory, resolveShiftTimes } from "../scheduleRules.js";
import { isOps, managerRestaurantIds } from "../access.js";
import { openVagaForSlot } from "../demand.js";

// Demand configuration (§3.5) + the aggregated builder board read by the Schedule
// Builder screen. Reads are open to coordinator/administrator AND restaurant_manager;
// demand writes (below) stay coordinator/administrator only.
const router = Router();
router.use(requireAuth);
const requireOps = requireRole("coordinator", "administrator");
router.use(requireRole("coordinator", "administrator", "restaurant_manager"));

const SHIFTS = ["lunch", "dinner"];

// GET /api/scheduling/my-scope — what the current user may edit on the board.
// Ops edit everything; a manager only their linked restaurant(s).
router.get("/my-scope", async (req, res) => {
  try {
    if (isOps(req.user.role)) return res.json({ canEditAll: true, restaurantIds: [] });
    const restaurantIds = await managerRestaurantIds(req.user.sub);
    res.json({ canEditAll: false, restaurantIds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Base demand per weekday/shift (§3.5) ---------------------------------

// GET /api/scheduling/demand?restaurantId=
router.get("/demand", async (req, res) => {
  const { restaurantId } = req.query;
  const vals = [];
  let where = "";
  if (restaurantId) { where = "where restaurant_id = $1"; vals.push(restaurantId); }
  const { rows } = await pool.query(
    `select id, restaurant_id as "restaurantId", weekday, shift_type as "shiftType",
            required_count as "requiredCount"
       from public.restaurant_demand ${where}
      order by weekday asc, shift_type asc`,
    vals,
  );
  res.json(rows);
});

// PUT /api/scheduling/demand  { restaurantId, weekday, shiftType, requiredCount }
router.put("/demand", requireOps, async (req, res) => {
  const b = req.body || {};
  if (!b.restaurantId || b.weekday == null || !b.shiftType || b.requiredCount == null) {
    return res.status(400).json({ error: "restaurantId, weekday, shiftType and requiredCount are required" });
  }
  const row = await one(
    `insert into public.restaurant_demand (restaurant_id, weekday, shift_type, required_count)
     values ($1,$2,$3,$4)
     on conflict (restaurant_id, weekday, shift_type)
       do update set required_count = excluded.required_count
     returning id, restaurant_id as "restaurantId", weekday, shift_type as "shiftType",
               required_count as "requiredCount"`,
    [b.restaurantId, b.weekday, b.shiftType, b.requiredCount],
  );
  res.json(row);
});

// ---- Per-date demand overrides — holidays / extra events (§3.5) -----------

// GET /api/scheduling/overrides?restaurantId=&date=
router.get("/overrides", async (req, res) => {
  const { restaurantId, date } = req.query;
  const conds = [];
  const vals = [];
  let i = 1;
  if (restaurantId) { conds.push(`restaurant_id = $${i++}`); vals.push(restaurantId); }
  if (date) { conds.push(`date = $${i++}`); vals.push(date); }
  const where = conds.length ? `where ${conds.join(" and ")}` : "";
  const { rows } = await pool.query(
    `select id, restaurant_id as "restaurantId", date::text as date, shift_type as "shiftType",
            required_count as "requiredCount", reason
       from public.demand_overrides ${where} order by date asc`,
    vals,
  );
  res.json(rows);
});

// PUT /api/scheduling/overrides  { restaurantId, date, shiftType, requiredCount, reason }
router.put("/overrides", requireOps, async (req, res) => {
  const b = req.body || {};
  if (!b.restaurantId || !b.date || !b.shiftType || b.requiredCount == null) {
    return res.status(400).json({ error: "restaurantId, date, shiftType and requiredCount are required" });
  }
  // Previous demand for this slot — used to detect an increase (a vacancy opening).
  const prev = await one(
    `select required_count as n from public.demand_overrides
       where restaurant_id = $1 and date = $2 and shift_type = $3`,
    [b.restaurantId, b.date, b.shiftType],
  );
  const row = await one(
    `insert into public.demand_overrides (restaurant_id, date, shift_type, required_count, reason, created_by)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (restaurant_id, date, shift_type)
       do update set required_count = excluded.required_count, reason = excluded.reason
     returning id, restaurant_id as "restaurantId", date::text as date, shift_type as "shiftType",
               required_count as "requiredCount", reason`,
    [b.restaurantId, b.date, b.shiftType, b.requiredCount, b.reason ?? null, req.user.sub],
  );

  // Raising demand for a special day can open vacancies on an already-published
  // schedule → alert that slot's waiting list (§3.4/§3.5). Only on a real increase.
  if (!prev || b.requiredCount > prev.n) {
    const cyc = await one(
      `select id, status from public.availability_cycles
         where reference_month = date_trunc('month', $1::date)::date`,
      [b.date],
    );
    if (cyc && cyc.status === "published") {
      openVagaForSlot({
        cycleId: cyc.id, restaurantId: b.restaurantId, date: b.date, shiftType: b.shiftType,
      }).catch((e) => console.error("waitlist notify failed:", e.message));
    }
  }
  res.json(row);
});

router.delete("/overrides/:id", requireOps, async (req, res) => {
  await pool.query(`delete from public.demand_overrides where id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// ---- Builder board (§3.3, §3.4, §3.5) -------------------------------------

// Resolve required count for a slot: date override → weekday base → 0.
async function requiredFor(restaurantId, date, weekday, shiftType) {
  const ov = await one(
    `select required_count as n from public.demand_overrides
       where restaurant_id = $1 and date = $2 and shift_type = $3`,
    [restaurantId, date, shiftType],
  );
  if (ov) return { required: ov.n, source: "override" };
  const base = await one(
    `select required_count as n from public.restaurant_demand
       where restaurant_id = $1 and weekday = $2 and shift_type = $3`,
    [restaurantId, weekday, shiftType],
  );
  if (base) return { required: base.n, source: "base" };
  return { required: 0, source: "none" };
}

// GET /api/scheduling/board?cycleId=&date=YYYY-MM-DD&restaurantId=
// One call returns everything the builder needs for a day at a restaurant.
router.get("/board", async (req, res) => {
  const { cycleId, date, restaurantId } = req.query;
  if (!date || !restaurantId) {
    return res.status(400).json({ error: "date and restaurantId are required" });
  }
  const weekday = weekdayOf(date);
  const shifts = [];

  for (const shiftType of SHIFTS) {
    const times = await resolveShiftTimes(restaurantId, shiftType);
    const { required, source } = await requiredFor(restaurantId, date, weekday, shiftType);

    // Assigned to THIS restaurant/slot.
    const { rows: assigned } = await pool.query(
      `select a.id as "assignmentId", a.user_id as "userId", u.name, a.status,
              a.assigned_via as "assignedVia", a.is_weekend_mandatory as "isWeekendMandatory",
              coalesce(p.current_score, 0) as score, p.current_level as level
         from public.schedule_assignments a
         join public.users u on u.id = a.user_id
         left join public.freelancer_profiles p on p.user_id = a.user_id
        where a.restaurant_id = $1 and a.date = $2 and a.shift_type = $3 and a.status <> 'cancelled'
        order by score desc, u.name asc`,
      [restaurantId, date, shiftType],
    );
    const assignedIds = new Set(assigned.map((a) => a.userId));

    // Candidates = anyone who marked availability for this date+shift (ANY restaurant),
    // not already assigned here — a freelancer can be assigned to any restaurant (§3.3).
    // Those registered to this restaurant (linked client OR chose it) are flagged
    // `registeredHere` and sorted to the top. `conflicted` flags anyone already booked
    // in this date+shift elsewhere (§3.3). One row per freelancer.
    const { rows: candidates } = await pool.query(
      `select min(s.id::text) as "submissionId", s.user_id as "userId", u.name,
              coalesce(p.current_score, 0) as score, p.current_level as level,
              p.transport, p.experience, p.home_address as "homeAddress",
              bool_or(s.restaurant_id is null) as flexible,
              (coalesce(bool_or(s.restaurant_id = $4), false)
               or bool_or(s.restaurant_id is null)
               or exists (select 1 from public.member_clients mc
                           where mc.member_user_id = s.user_id and mc.restaurant_id = $4)) as "registeredHere",
              exists (
                select 1 from public.schedule_assignments c
                 where c.user_id = s.user_id and c.date = $2
                   and c.shift_type = $3 and c.status <> 'cancelled'
              ) as conflicted
         from public.availability_submissions s
         join public.users u on u.id = s.user_id
         left join public.freelancer_profiles p on p.user_id = s.user_id
        where s.cycle_id = $1 and s.date = $2 and s.shift_type = $3 and s.status = 'submitted'
        group by s.user_id, u.name, p.current_score, p.current_level,
                 p.transport, p.experience, p.home_address
        order by "registeredHere" desc, score desc, u.name asc`,
      [cycleId ?? null, date, shiftType, restaurantId],
    );

    shifts.push({
      shiftType,
      startTime: times.startTime,
      endTime: times.endTime,
      isWeekendMandatory: isWeekendMandatory(weekday, shiftType),
      required,
      requiredSource: source,
      assignedCount: assigned.length,
      deficit: required - assigned.length,
      assigned,
      candidates: candidates.filter((c) => !assignedIds.has(c.userId)),
    });
  }

  res.json({ date, restaurantId, weekday, cycleId: cycleId ?? null, shifts });
});

// GET /api/scheduling/members?date=&shiftType=&restaurantId=
// Fallback pool for the builder: ALL active freelancers/visitors (not only those
// who submitted availability), so the coordinator can staff a slot even when nobody
// declared availability. Same row shape as board candidates; `registeredHere`
// (linked/registered to this restaurant) sorts to the top, `conflicted` flags
// anyone already booked that date+shift elsewhere (§3.3).
router.get("/members", async (req, res) => {
  const { date, shiftType, restaurantId } = req.query;
  if (!date || !shiftType || !restaurantId) {
    return res.status(400).json({ error: "date, shiftType and restaurantId are required" });
  }
  const { rows } = await pool.query(
    `select u.id as "userId", u.name,
            coalesce(p.current_score, 0) as score, p.current_level as level,
            p.transport, p.experience, p.home_address as "homeAddress",
            exists (select 1 from public.member_clients mc
                     where mc.member_user_id = u.id and mc.restaurant_id = $3) as "registeredHere",
            exists (
              select 1 from public.schedule_assignments c
               where c.user_id = u.id and c.date = $1
                 and c.shift_type = $2 and c.status <> 'cancelled'
            ) as conflicted
       from public.users u
       left join public.freelancer_profiles p on p.user_id = u.id
      where u.role in ('freelancer','visitor') and u.status = 'active'
      order by "registeredHere" desc, score desc, u.name asc`,
    [date, shiftType, restaurantId],
  );
  res.json(rows.map((r) => ({ id: r.userId, ...r })));
});

// ---- Weekly grid (§3.3) — rows grouped Shift → Restaurant, 7-day columns -----

function addDaysUTC(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Inclusive day count between two date-only strings (b - a).
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// Resolve the board's date range from query/body: explicit rangeStart+rangeEnd
// (normalized and capped) or a legacy 7-day weekStart. Returns null on bad input.
// The cap only guards against absurd/accidental multi-year spans; any realistic
// custom range (e.g. a couple of months) is honored in full (§R2).
const MAX_RANGE_DAYS = 366;
function resolveRange({ weekStart, rangeStart, rangeEnd }) {
  let start, end;
  if (rangeStart && rangeEnd) {
    start = rangeStart < rangeEnd ? rangeStart : rangeEnd;
    end = rangeStart < rangeEnd ? rangeEnd : rangeStart;
    if (daysBetween(start, end) + 1 > MAX_RANGE_DAYS) end = addDaysUTC(start, MAX_RANGE_DAYS - 1);
  } else if (weekStart) {
    start = weekStart;
    end = addDaysUTC(weekStart, 6);
  } else {
    return null;
  }
  return { start, end };
}

// Resolve required for a slot from preloaded base/override maps (no per-cell query).
function requiredFromMaps(baseMap, overrideMap, restaurantId, date, weekday, shiftType) {
  const ov = overrideMap.get(`${restaurantId}|${date}|${shiftType}`);
  if (ov !== undefined) return { required: ov, source: "override" };
  const base = baseMap.get(`${restaurantId}|${weekday}|${shiftType}`);
  if (base !== undefined) return { required: base, source: "base" };
  return { required: 0, source: "none" };
}

// GET /api/scheduling/week?cycleId=&restaurantId=
//   &weekStart=YYYY-MM-DD                  (legacy 7-day week), or
//   &rangeStart=YYYY-MM-DD&rangeEnd=YYYY-MM-DD  (any range, e.g. a whole month — §R2)
// The grid renders one column per day, so the same shape serves week/month/custom.
router.get("/week", async (req, res) => {
  const { cycleId, restaurantId } = req.query;
  const range = resolveRange(req.query);
  if (!range) return res.status(400).json({ error: "weekStart or rangeStart+rangeEnd are required" });
  const { start: weekStart, end: weekEnd } = range;
  const span = daysBetween(weekStart, weekEnd) + 1;
  const days = Array.from({ length: span }, (_, i) => {
    const date = addDaysUTC(weekStart, i);
    return { date, weekday: weekdayOf(date) };
  });

  // Restaurants in scope.
  const restWhere = restaurantId ? "where id = $1" : "where active = true";
  const restVals = restaurantId ? [restaurantId] : [];
  const { rows: restaurants } = await pool.query(
    `select id, name from public.restaurants ${restWhere} order by name asc`, restVals,
  );
  if (restaurants.length === 0) return res.json({ weekStart, weekEnd, cycleId: cycleId ?? null, days, shifts: [] });
  const restIds = restaurants.map((r) => r.id);

  // Preload everything for the week in a few queries, assemble in JS.
  const [tpl, base, overrides, assigned, subs] = await Promise.all([
    pool.query(
      `select restaurant_id as "restaurantId", shift_type as "shiftType", label,
              to_char(start_time, 'HH24:MI') as "startTime", to_char(end_time, 'HH24:MI') as "endTime"
         from public.shift_templates where restaurant_id = any($1)
        order by start_time asc`, [restIds]),
    pool.query(
      `select restaurant_id as "restaurantId", weekday, shift_type as "shiftType", required_count as n
         from public.restaurant_demand where restaurant_id = any($1)`, [restIds]),
    pool.query(
      `select restaurant_id as "restaurantId", date::text as date, shift_type as "shiftType", required_count as n
         from public.demand_overrides where restaurant_id = any($1) and date between $2 and $3`,
      [restIds, weekStart, weekEnd]),
    pool.query(
      `select a.id as "assignmentId", a.restaurant_id as "restaurantId", a.date::text as date,
              a.shift_type as "shiftType", a.user_id as "userId", u.name, a.status,
              a.assigned_via as "assignedVia", coalesce(p.current_score,0) as score, p.current_level as level
         from public.schedule_assignments a
         join public.users u on u.id = a.user_id
         left join public.freelancer_profiles p on p.user_id = a.user_id
        where a.restaurant_id = any($1) and a.date between $2 and $3 and a.status <> 'cancelled'`,
      [restIds, weekStart, weekEnd]),
    cycleId
      ? pool.query(
          // Include "any restaurant" (restaurant_id null) offers — they count as a
          // candidate for every restaurant's slot on that date+shift.
          `select restaurant_id as "restaurantId", date::text as date, shift_type as "shiftType", user_id as "userId"
             from public.availability_submissions
            where cycle_id = $1 and status = 'submitted' and date between $3 and $4
              and (restaurant_id = any($2) or restaurant_id is null)`,
          [cycleId, restIds, weekStart, weekEnd])
      : Promise.resolve({ rows: [] }),
  ]);

  const tplByKey = new Map(); // `${restaurantId}|${shiftType}` -> [{label,startTime,endTime}]
  for (const r of tpl.rows) {
    const k = `${r.restaurantId}|${r.shiftType}`;
    if (!tplByKey.has(k)) tplByKey.set(k, []);
    tplByKey.get(k).push({ label: r.label, startTime: r.startTime, endTime: r.endTime });
  }
  const baseMap = new Map(base.rows.map((r) => [`${r.restaurantId}|${r.weekday}|${r.shiftType}`, r.n]));
  const overrideMap = new Map(overrides.rows.map((r) => [`${r.restaurantId}|${r.date}|${r.shiftType}`, r.n]));

  const assignedBySlot = new Map(); // `${r}|${date}|${shift}` -> [assigned]
  for (const a of assigned.rows) {
    const k = `${a.restaurantId}|${a.date}|${a.shiftType}`;
    if (!assignedBySlot.has(k)) assignedBySlot.set(k, []);
    assignedBySlot.get(k).push(a);
  }
  const subsBySlot = new Map();     // `${r}|${date}|${shift}` -> Set(userId), restaurant-specific
  const anyByDateShift = new Map();  // `${date}|${shift}` -> Set(userId), "any restaurant" offers
  for (const s of subs.rows) {
    if (s.restaurantId == null) {
      const k = `${s.date}|${s.shiftType}`;
      if (!anyByDateShift.has(k)) anyByDateShift.set(k, new Set());
      anyByDateShift.get(k).add(s.userId);
    } else {
      const k = `${s.restaurantId}|${s.date}|${s.shiftType}`;
      if (!subsBySlot.has(k)) subsBySlot.set(k, new Set());
      subsBySlot.get(k).add(s.userId);
    }
  }

  const SHIFTS = ["lunch", "dinner"];
  const DEFAULT_TIMES = { lunch: { s: "12:00", e: "16:00" }, dinner: { s: "18:00", e: "22:00" } };

  const shifts = SHIFTS.map((shiftType) => ({
    shiftType,
    restaurants: restaurants.map((r) => {
      const slotsRaw = tplByKey.get(`${r.id}|${shiftType}`) || [];
      const slots = slotsRaw.length
        ? slotsRaw
        : [{ label: null, startTime: DEFAULT_TIMES[shiftType].s, endTime: DEFAULT_TIMES[shiftType].e }];
      const startTime = slots[0].startTime;
      const endTime = slots[0].endTime;
      const cells = days.map(({ date, weekday }) => {
        const slotKey = `${r.id}|${date}|${shiftType}`;
        const cellAssigned = (assignedBySlot.get(slotKey) || [])
          .slice()
          .sort((a, b) => Number(b.score) - Number(a.score));
        const assignedIds = new Set(cellAssigned.map((a) => a.userId));
        const subSet = subsBySlot.get(slotKey) || new Set();
        const anySet = anyByDateShift.get(`${date}|${shiftType}`) || new Set();
        // Union of restaurant-specific + "any restaurant" offers, minus those already assigned here.
        const candidateSet = new Set([...subSet, ...anySet]);
        let candidateCount = 0;
        for (const uid of candidateSet) if (!assignedIds.has(uid)) candidateCount++;
        const { required, source } = requiredFromMaps(baseMap, overrideMap, r.id, date, weekday, shiftType);
        return {
          date, weekday,
          required, requiredSource: source,
          isWeekendMandatory: isWeekendMandatory(weekday, shiftType),
          assignedCount: cellAssigned.length,
          deficit: required - cellAssigned.length,
          candidateCount,
          assigned: cellAssigned,
        };
      });
      return { restaurantId: r.id, restaurantName: r.name, startTime, endTime, slots, cells };
    }),
  }));

  res.json({ weekStart, weekEnd, cycleId: cycleId ?? null, days, shifts });
});

// POST /api/scheduling/autofill { cycleId, weekStart, restaurantId? }
// Greedy: fill each deficit with the highest-scored available, non-conflicting
// freelancer (§3.3 conflict, §8.2 weekend bonus). Draft only — never publishes.
router.post("/autofill", requireOps, async (req, res) => {
  const { cycleId, restaurantId } = req.body || {};
  const range = resolveRange(req.body || {});
  if (!cycleId || !range) return res.status(400).json({ error: "cycleId and weekStart (or rangeStart+rangeEnd) are required" });
  const { start: weekStart, end: weekEnd } = range;

  const restWhere = restaurantId ? "where id = $1" : "where active = true";
  const { rows: restaurants } = await pool.query(
    `select id, name from public.restaurants ${restWhere} order by name asc`,
    restaurantId ? [restaurantId] : [],
  );
  if (restaurants.length === 0) return res.json({ filledSlots: 0, assignmentsCreated: 0, stillShort: 0, skippedConflicts: 0 });
  const restIds = restaurants.map((r) => r.id);

  const [base, overrides, assigned, subs, mc] = await Promise.all([
    pool.query(`select restaurant_id as "restaurantId", weekday, shift_type as "shiftType", required_count as n
                  from public.restaurant_demand where restaurant_id = any($1)`, [restIds]),
    pool.query(`select restaurant_id as "restaurantId", date::text as date, shift_type as "shiftType", required_count as n
                  from public.demand_overrides where restaurant_id = any($1) and date between $2 and $3`,
      [restIds, weekStart, weekEnd]),
    pool.query(`select restaurant_id as "restaurantId", date::text as date, shift_type as "shiftType", user_id as "userId"
                  from public.schedule_assignments
                 where restaurant_id = any($1) and date between $2 and $3 and status <> 'cancelled'`,
      [restIds, weekStart, weekEnd]),
    // Broadened pool (§3.3): availability for the week across ALL restaurants, so a
    // freelancer can be autofilled into any restaurant regardless of where they registered.
    pool.query(`select s.restaurant_id as "restaurantId", s.date::text as date, s.shift_type as "shiftType",
                       s.user_id as "userId", coalesce(p.current_score,0) as score
                  from public.availability_submissions s
                  left join public.freelancer_profiles p on p.user_id = s.user_id
                 where s.cycle_id = $1 and s.status = 'submitted' and s.date between $2 and $3`,
      [cycleId, weekStart, weekEnd]),
    // Client links for the restaurants in scope → "registered here" priority.
    pool.query(`select member_user_id as "userId", restaurant_id as "restaurantId"
                  from public.member_clients where restaurant_id = any($1)`, [restIds]),
  ]);

  const baseMap = new Map(base.rows.map((r) => [`${r.restaurantId}|${r.weekday}|${r.shiftType}`, r.n]));
  const overrideMap = new Map(overrides.rows.map((r) => [`${r.restaurantId}|${r.date}|${r.shiftType}`, r.n]));

  // Count of current assignments per slot + "busy" set (userId|date|shift) for conflict.
  const assignedCount = new Map();
  const busy = new Set();
  for (const a of assigned.rows) {
    assignedCount.set(`${a.restaurantId}|${a.date}|${a.shiftType}`, (assignedCount.get(`${a.restaurantId}|${a.date}|${a.shiftType}`) || 0) + 1);
    busy.add(`${a.userId}|${a.date}|${a.shiftType}`);
  }
  // member_clients: userId → Set(restaurantId in scope).
  const mcByUser = new Map();
  for (const m of mc.rows) {
    if (!mcByUser.has(m.userId)) mcByUser.set(m.userId, new Set());
    mcByUser.get(m.userId).add(m.restaurantId);
  }
  // Available freelancers per date+shift (deduped per user), each tracking which
  // restaurants they chose for that slot (for the "registered here" sort).
  const availBySlot = new Map(); // `${date}|${shift}` -> Map(userId -> {score, restSet})
  for (const s of subs.rows) {
    const k = `${s.date}|${s.shiftType}`;
    if (!availBySlot.has(k)) availBySlot.set(k, new Map());
    const byUser = availBySlot.get(k);
    if (!byUser.has(s.userId)) byUser.set(s.userId, { userId: s.userId, score: Number(s.score), restSet: new Set() });
    byUser.get(s.userId).restSet.add(s.restaurantId);
  }
  // Candidates for a restaurant slot: registered-here first, then score desc.
  const candidatesFor = (restaurantId, date, shiftType) => {
    const byUser = availBySlot.get(`${date}|${shiftType}`);
    if (!byUser) return [];
    return [...byUser.values()]
      .map((c) => ({
        userId: c.userId,
        score: c.score,
        registeredHere: c.restSet.has(restaurantId) || (mcByUser.get(c.userId)?.has(restaurantId) ?? false),
      }))
      .sort((a, b) => (Number(b.registeredHere) - Number(a.registeredHere)) || (b.score - a.score));
  };

  const days = Array.from({ length: daysBetween(weekStart, weekEnd) + 1 }, (_, i) => addDaysUTC(weekStart, i));
  const SHIFTS = ["lunch", "dinner"];
  let filledSlots = 0, assignmentsCreated = 0, stillShort = 0, skippedConflicts = 0;

  for (const r of restaurants) {
    for (const shiftType of SHIFTS) {
      const times = await resolveShiftTimes(r.id, shiftType);
      for (const date of days) {
        const weekday = weekdayOf(date);
        const { required } = requiredFromMaps(baseMap, overrideMap, r.id, date, weekday, shiftType);
        if (required <= 0) continue;
        const slotKey = `${r.id}|${date}|${shiftType}`;
        let have = assignedCount.get(slotKey) || 0;
        if (have >= required) { filledSlots++; continue; }
        const cands = candidatesFor(r.id, date, shiftType);
        const weekendMandatory = isWeekendMandatory(weekday, shiftType);
        for (const c of cands) {
          if (have >= required) break;
          const conflictKey = `${c.userId}|${date}|${shiftType}`;
          if (busy.has(conflictKey)) { skippedConflicts++; continue; }
          try {
            await pool.query(
              `insert into public.schedule_assignments
                 (cycle_id, restaurant_id, user_id, date, shift_type, start_time, end_time,
                  status, is_weekend_mandatory, assigned_via, created_by)
               values ($1,$2,$3,$4,$5,$6,$7,'draft',$8,'coordinator',$9)`,
              [cycleId, r.id, c.userId, date, shiftType, times.startTime, times.endTime, weekendMandatory, req.user.sub],
            );
            busy.add(conflictKey);
            have++;
            assignmentsCreated++;
          } catch { /* unique conflict — skip */ }
        }
        assignedCount.set(slotKey, have);
        if (have >= required) filledSlots++; else stillShort += (required - have);
      }
    }
  }

  res.json({ filledSlots, assignmentsCreated, stillShort, skippedConflicts });
});

export default router;
