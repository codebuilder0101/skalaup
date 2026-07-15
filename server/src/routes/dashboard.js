import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth } from "../auth.js";
import { isOps, managerRestaurantIds } from "../access.js";

// Role-aware dashboard aggregates.
//  - coordinator/administrator: whole-operation overview (restaurants, freelancer
//    subscribers, today's schedule + swaps, feedback, finances…).
//  - restaurant_manager: their own restaurant(s) — subscribers + today's schedule.
const router = Router();
router.use(requireAuth);

const GLOBAL_BASE_PAY = 60; // §8.1 default base pay per shift

// Distinct freelancers who submitted availability in the latest cycle = "subscribers".
const LATEST_CYCLE = `(select id from public.availability_cycles order by reference_month desc limit 1)`;

async function coordinatorDashboard(role) {
  const restaurants = await one(
    `select count(*)::int as total, count(*) filter (where active)::int as active
       from public.restaurants`,
  );

  const freelancers = await one(
    `select count(*) filter (where role in ('freelancer','visitor'))::int as total,
            count(*) filter (where role in ('freelancer','visitor') and status = 'active')::int as active,
            count(*) filter (where role in ('freelancer','visitor') and status = 'pending')::int as pending
       from public.users`,
  );

  const subscribers = await one(
    `select count(distinct user_id)::int as n
       from public.availability_submissions
      where status = 'submitted' and cycle_id = ${LATEST_CYCLE}`,
  );

  const today = await one(
    `select count(*) filter (where status <> 'cancelled')::int as total,
            count(*) filter (where status = 'published')::int as published,
            count(distinct user_id) filter (where status <> 'cancelled')::int as freelancers
       from public.schedule_assignments where date = current_date`,
  );

  const swaps = await one(
    `select count(*)::int as pending from public.shift_swap_requests
      where status in ('pending_target','pending_coordinator')`,
  );

  const feedback = await one(
    `select count(*)::int as pending from public.manager_feedback where status = 'pending_validation'`,
  );

  // Evaluations received this month (client item 9): gestor feedback via the app
  // + client ratings via the public QR page. A volume metric ("quantas por mês").
  const evaluations = await one(
    `select (
       (select count(*) from public.manager_feedback
          where date_trunc('month', created_at) = date_trunc('month', current_date))
     + (select count(*) from public.public_ratings
          where date_trunc('month', created_at) = date_trunc('month', current_date))
     )::int as month`,
  );

  const approvals = await one(
    `select count(*)::int as pending from public.users where status = 'pending'`,
  );

  // Extra shifts (R18): pending requests need coordinator action now; the
  // month breakdown counts requests whose shift date falls in the current month.
  const extraRow = await one(
    `select count(*) filter (where status = 'pending')::int as pending,
            count(*) filter (where date_trunc('month', date) = date_trunc('month', current_date))::int as "monthRequested",
            count(*) filter (where status = 'assigned'
                              and date_trunc('month', date) = date_trunc('month', current_date))::int as "monthAssigned",
            count(*) filter (where status = 'opened'
                              and date_trunc('month', date) = date_trunc('month', current_date))::int as "monthOpen"
       from public.extra_shift_requests`,
  );

  // Availability trend (R19): distinct submitters in the latest cycle vs the
  // previous one. `cycleCount` disambiguates "prior cycle had 0 subscribers"
  // from "there is no prior cycle" (in which case there is nothing to compare).
  const availRow = await one(
    `with recent as (
       select id, reference_month
         from public.availability_cycles
        order by reference_month desc
        limit 2
     )
     select
       coalesce((select count(distinct s.user_id)::int from public.availability_submissions s
                  where s.status = 'submitted'
                    and s.cycle_id = (select id from recent order by reference_month desc limit 1)), 0) as current,
       coalesce((select count(distinct s.user_id)::int from public.availability_submissions s
                  where s.status = 'submitted'
                    and s.cycle_id = (select id from recent order by reference_month desc offset 1 limit 1)), 0) as "previousRaw",
       (select count(*)::int from recent) as "cycleCount"`,
  );
  const hasPrev = availRow.cycleCount >= 2;
  const availPrevious = hasPrev ? availRow.previousRaw : null;
  const availPctChange = availPrevious && availPrevious > 0
    ? Math.round(((availRow.current - availPrevious) / availPrevious) * 1000) / 10
    : null;

  const finance = await one(
    `select count(*)::int as shifts,
            coalesce(sum(coalesce(a.pay_rate_applied, r.base_pay_per_shift, ${GLOBAL_BASE_PAY})), 0)::float as estimated,
            count(*) filter (where a.is_weekend_mandatory)::int as "weekendShifts"
       from public.schedule_assignments a
       left join public.restaurants r on r.id = a.restaurant_id
      where a.status = 'published'
        and date_trunc('month', a.date) = date_trunc('month', current_date)`,
  );

  const { rows: todaySchedule } = await pool.query(
    `select a.id, a.shift_type as "shiftType", a.start_time as "startTime", a.end_time as "endTime",
            a.status, u.name as "freelancerName", r.name as "restaurantName"
       from public.schedule_assignments a
       join public.users u on u.id = a.user_id
       join public.restaurants r on r.id = a.restaurant_id
      where a.date = current_date and a.status <> 'cancelled'
      order by r.name asc, a.shift_type asc, u.name asc`,
  );

  // Last 14 days of scheduling activity (zero-filled so the chart has no gaps).
  const { rows: shiftsTrend } = await pool.query(
    `select to_char(g.day::date, 'YYYY-MM-DD') as date,
            coalesce(s.total, 0)::int as total,
            coalesce(s.published, 0)::int as published
       from generate_series(current_date - interval '13 days', current_date, interval '1 day') as g(day)
       left join (
         select date,
                count(*) filter (where status <> 'cancelled')::int as total,
                count(*) filter (where status = 'published')::int as published
           from public.schedule_assignments
          where date >= current_date - interval '13 days'
          group by date
       ) s on s.date = g.day::date
      order by g.day asc`,
  );

  // Team performance distribution by accumulated score (§9), bucketed and
  // zero-filled so every band shows even when empty.
  const { rows: scoreBuckets } = await pool.query(
    `select b.label, coalesce(c.count, 0)::int as count
       from (values (1,'0'),(2,'1-9'),(3,'10-24'),(4,'25-49'),(5,'50+')) as b(ord, label)
       left join (
         select case
                  when current_score <= 0 then '0'
                  when current_score < 10 then '1-9'
                  when current_score < 25 then '10-24'
                  when current_score < 50 then '25-49'
                  else '50+'
                end as label,
                count(*)::int as count
           from public.freelancer_profiles
          group by 1
       ) c on c.label = b.label
      order by b.ord asc`,
  );

  return {
    role,
    restaurants,
    freelancers,
    subscribers: subscribers.n,
    today,
    swaps: swaps.pending,
    feedback: feedback.pending,
    evaluations: evaluations.month,
    approvals: approvals.pending,
    extraShifts: {
      pending: extraRow.pending,
      monthRequested: extraRow.monthRequested,
      monthAssigned: extraRow.monthAssigned,
      monthOpen: extraRow.monthOpen,
    },
    availability: {
      current: availRow.current,
      previous: availPrevious,
      pctChange: availPctChange,
    },
    finance,
    todaySchedule,
    shiftsTrend,
    scoreBuckets,
  };
}

async function managerDashboard(uid) {
  const { rows: restaurants } = await pool.query(
    `select r.id, r.name, r.address
       from public.restaurants r
       join public.manager_assignments m on m.restaurant_id = r.id
      where m.manager_user_id = $1
      order by r.name asc`,
    [uid],
  );
  const ids = restaurants.map((r) => r.id);

  const empty = { role: "restaurant_manager", restaurants, subscribers: 0,
    today: { total: 0, published: 0, freelancers: 0 }, todaySchedule: [], feedback: 0 };
  if (ids.length === 0) return empty;

  const subscribers = await one(
    `select count(distinct user_id)::int as n from public.availability_submissions
      where status = 'submitted' and restaurant_id = any($1) and cycle_id = ${LATEST_CYCLE}`,
    [ids],
  );

  const today = await one(
    `select count(*) filter (where status <> 'cancelled')::int as total,
            count(*) filter (where status = 'published')::int as published,
            count(distinct user_id) filter (where status <> 'cancelled')::int as freelancers
       from public.schedule_assignments where date = current_date and restaurant_id = any($1)`,
    [ids],
  );

  const { rows: todaySchedule } = await pool.query(
    `select a.id, a.shift_type as "shiftType", a.start_time as "startTime", a.end_time as "endTime",
            a.status, u.name as "freelancerName", r.name as "restaurantName",
            att.checkin_at as "checkinAt", att.checkout_at as "checkoutAt"
       from public.schedule_assignments a
       join public.users u on u.id = a.user_id
       join public.restaurants r on r.id = a.restaurant_id
       left join public.shift_attendance att on att.assignment_id = a.id
      where a.date = current_date and a.restaurant_id = any($1) and a.status <> 'cancelled'
      order by a.shift_type asc, u.name asc`,
    [ids],
  );

  const feedback = await one(
    `select count(*)::int as pending from public.manager_feedback
      where manager_user_id = $1 and status = 'pending_validation'`,
    [uid],
  );

  return {
    role: "restaurant_manager",
    restaurants,
    subscribers: subscribers.n,
    today,
    todaySchedule,
    feedback: feedback.pending,
  };
}

// GET /api/dashboard/schedule-performance?month=YYYY-MM&restaurantId=
// Operational KPIs over the shifts that were SUPPOSED to happen in the month
// (published, date <= today): % fulfilled (checked in), % no-show (furo),
// % late. Ops see the whole operation (optionally filtered by client);
// managers see only their restaurant(s).
router.get("/schedule-performance", async (req, res) => {
  try {
    const monthOk = /^\d{4}-\d{2}$/.test(String(req.query.month || ""));
    const monthStart = monthOk ? `${req.query.month}-01` : null;

    const vals = [];
    let where = "a.status = 'published' and a.date <= current_date";
    if (monthStart) {
      vals.push(monthStart);
      where += ` and date_trunc('month', a.date) = date_trunc('month', $${vals.length}::date)`;
    } else {
      where += " and date_trunc('month', a.date) = date_trunc('month', current_date)";
    }

    // Restaurant scoping: managers are restricted to their own restaurant(s).
    if (req.user.role === "restaurant_manager") {
      const ids = await managerRestaurantIds(req.user.sub);
      if (ids.length === 0) return res.json({ total: 0, fulfilled: 0, noShow: 0, late: 0, fulfilledPct: 0, noShowPct: 0, latePct: 0 });
      vals.push(ids);
      where += ` and a.restaurant_id = any($${vals.length})`;
    } else if (!isOps(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    // Optional client filter (ops or a manager narrowing within their own).
    if (req.query.restaurantId) {
      vals.push(req.query.restaurantId);
      where += ` and a.restaurant_id = $${vals.length}`;
    }

    const row = await one(
      `select count(*)::int as total,
              count(*) filter (where att.no_show)::int as "noShow",
              count(*) filter (where att.checkin_at is not null and not coalesce(att.no_show, false))::int as fulfilled,
              count(*) filter (where att.checkin_at is not null and not coalesce(att.no_show, false)
                                and coalesce(att.lateness_category, 'none') <> 'none')::int as late
         from public.schedule_assignments a
         left join public.shift_attendance att on att.assignment_id = a.id
        where ${where}`,
      vals,
    );
    const total = row.total || 0;
    const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
    res.json({
      total,
      fulfilled: row.fulfilled, noShow: row.noShow, late: row.late,
      fulfilledPct: pct(row.fulfilled), noShowPct: pct(row.noShow), latePct: pct(row.late),
    });
  } catch (e) {
    console.error("schedule-performance error:", e.message);
    res.status(500).json({ error: "Falha ao carregar o desempenho da escala." });
  }
});

// GET /api/dashboard — shape depends on the requesting user's role.
router.get("/", async (req, res) => {
  try {
    if (req.user.role === "restaurant_manager") {
      return res.json(await managerDashboard(req.user.sub));
    }
    return res.json(await coordinatorDashboard(req.user.role));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
