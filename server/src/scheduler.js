// Monthly availability-cycle automation (§3.1):
//   • Days 20–25 window: remind all freelancers to submit availability (once/day).
//   • After the window (closes_at passed): auto-close the cycle (stop receiving).
// Driven by a daily cron job; also exposed as runCycleMaintenance() for manual runs.
import cron from "node-cron";
import { pool, one } from "./db.js";
import { notify, coordinatorIds } from "./notify.js";
import { weekdayOf } from "./scheduleRules.js";

// Feedback 40% coverage (§10.3): ensure each freelancer gets feedback requests for
// ~40% of their published shifts this month, each assigned to the manager of that
// shift's restaurant (preferring different managers). Idempotent — only tops up the
// gap to target, never duplicates a request for the same assignment.
export async function generateFeedbackRequests() {
  const monthRef = `${new Date().toISOString().slice(0, 7)}-01`;
  const pctRow = await one(`select feedback_coverage_pct as pct from public.app_settings where id = 1`);
  const pct = Number(pctRow?.pct ?? 0.4);
  let created = 0;

  // Published shifts this month with a manager available for the restaurant.
  const { rows: shifts } = await pool.query(
    `select a.id as assignment_id, a.user_id as freelancer_user_id, a.restaurant_id,
            ma.manager_user_id
       from public.schedule_assignments a
       join lateral (
         select manager_user_id from public.manager_assignments m
          where m.restaurant_id = a.restaurant_id limit 1
       ) ma on true
      where a.status = 'published'
        and a.date >= $1::date and a.date < ($1::date + interval '1 month')
        and not exists (select 1 from public.feedback_requests fr where fr.assignment_id = a.id)
      order by a.user_id, a.restaurant_id`,
    [monthRef],
  );

  // Group candidate shifts by freelancer.
  const byFreelancer = new Map();
  for (const s of shifts) {
    const arr = byFreelancer.get(s.freelancer_user_id) ?? [];
    arr.push(s);
    byFreelancer.set(s.freelancer_user_id, arr);
  }

  for (const [freelancerId, cand] of byFreelancer) {
    const totalRow = await one(
      `select count(*)::int as n from public.schedule_assignments
        where user_id = $1 and status = 'published'
          and date >= $2::date and date < ($2::date + interval '1 month')`,
      [freelancerId, monthRef],
    );
    const existsRow = await one(
      `select count(*)::int as n from public.feedback_requests
        where freelancer_user_id = $1 and month_ref = $2`,
      [freelancerId, monthRef],
    );
    const target = Math.ceil(Number(totalRow.n) * pct);
    let need = target - Number(existsRow.n);
    if (need <= 0) continue;

    // Prefer spreading across distinct managers/restaurants (§10.3).
    const seenManager = new Set();
    const ordered = [
      ...cand.filter((s) => { if (seenManager.has(s.manager_user_id)) return false; seenManager.add(s.manager_user_id); return true; }),
      ...cand.filter((s) => seenManager.has(s.manager_user_id)),
    ];
    for (const s of ordered) {
      if (need <= 0) break;
      await pool.query(
        `insert into public.feedback_requests
           (restaurant_id, manager_user_id, freelancer_user_id, assignment_id, month_ref, status)
         values ($1,$2,$3,$4,$5,'pending')`,
        [s.restaurant_id, s.manager_user_id, freelancerId, s.assignment_id, monthRef],
      );
      await notify({
        recipientUserId: s.manager_user_id, type: "feedback_request",
        title: "Avalie um freelancer",
        body: "Há um pedido de feedback pendente para um freelancer do seu restaurante.",
        data: { freelancerUserId: freelancerId, assignmentId: s.assignment_id },
      });
      created++;
      need--;
    }
  }
  return created;
}

// Compute slots where the available freelancers fall short of demand (§3.5).
// "Available" = distinct freelancers who submitted availability for that slot.
async function computeCycleDeficits(cycle) {
  const ym = String(cycle.reference_month).slice(0, 7); // "2026-06"
  const [y, m] = ym.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(daysInMonth).padStart(2, "0")}`;

  const [rests, base, ovr, avail] = await Promise.all([
    pool.query(`select id, name from public.restaurants where active = true`),
    pool.query(`select restaurant_id as r, weekday as w, shift_type as s, required_count as n
                  from public.restaurant_demand`),
    pool.query(`select restaurant_id as r, date::text as d, shift_type as s, required_count as n
                  from public.demand_overrides where date between $1 and $2`, [monthStart, monthEnd]),
    pool.query(`select restaurant_id as r, date::text as d, shift_type as s, count(distinct user_id)::int as n
                  from public.availability_submissions
                 where cycle_id = $1 and status = 'submitted'
                 group by restaurant_id, date, shift_type`, [cycle.id]),
  ]);

  const baseMap = new Map(base.rows.map((x) => [`${x.r}|${x.w}|${x.s}`, x.n]));
  const ovrMap = new Map(ovr.rows.map((x) => [`${x.r}|${x.d}|${x.s}`, x.n]));
  const availMap = new Map(avail.rows.map((x) => [`${x.r}|${x.d}|${x.s}`, x.n]));
  const SHIFTS = ["lunch", "dinner"];
  const out = [];

  for (const r of rests.rows) {
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${ym}-${String(day).padStart(2, "0")}`;
      const wd = weekdayOf(date);
      for (const shift of SHIFTS) {
        const demand = ovrMap.has(`${r.id}|${date}|${shift}`)
          ? ovrMap.get(`${r.id}|${date}|${shift}`)
          : (baseMap.get(`${r.id}|${wd}|${shift}`) ?? 0);
        if (demand <= 0) continue;
        const available = availMap.get(`${r.id}|${date}|${shift}`) || 0;
        if (available < demand) out.push({ restaurantName: r.name, date, shiftType: shift, demand, available });
      }
    }
  }
  out.sort((a, b) => (b.demand - b.available) - (a.demand - a.available));
  return out;
}

// Notify coordinators of availability deficits for a cycle (§3.5). Best-effort.
export async function notifyCycleDeficits(cycleId) {
  const cycle = await one(
    `select id, reference_month::text as reference_month from public.availability_cycles where id = $1`,
    [cycleId],
  );
  if (!cycle) return { deficitSlots: 0 };
  const deficits = await computeCycleDeficits(cycle);
  if (deficits.length === 0) return { deficitSlots: 0 };
  const top = deficits.slice(0, 3)
    .map((d) => `${d.restaurantName} ${d.date} ${d.shiftType === "lunch" ? "almoço" : "janta"} (${d.available}/${d.demand})`)
    .join("; ");
  for (const cid of await coordinatorIds()) {
    await notify({
      recipientUserId: cid,
      type: "coverage_deficit",
      title: "Déficit de disponibilidade",
      body: `${deficits.length} turno(s) com menos disponíveis que a demanda. Ex.: ${top}.`,
      data: { cycleId, deficitSlots: deficits.length },
    });
  }
  return { deficitSlots: deficits.length };
}

// Active freelancers/visitors — the people who submit availability.
async function availabilityUserIds() {
  const { rows } = await pool.query(
    `select id from public.users
      where role in ('freelancer','visitor') and status = 'active'`,
  );
  return rows.map((r) => r.id);
}

// Has an availability reminder for this cycle already gone out in the last ~20h?
async function remindedRecently(cycleId) {
  const { rows } = await pool.query(
    `select 1 from public.notifications
      where type = 'availability_reminder'
        and data->>'cycleId' = $1
        and sent_at > now() - interval '20 hours'
      limit 1`,
    [cycleId],
  );
  return rows.length > 0;
}

// Auto-open next month's availability cycle once the configured open day arrives
// (§3.1 "Dias 20–25: app notifica todos os freelancers"). Window comes from
// app_settings.availability_open_day/close_day. Idempotent: does nothing if a cycle
// for that month already exists (e.g. a coordinator created one manually).
async function ensureUpcomingCycle() {
  const { rows } = await pool.query(
    `with s as (
       select availability_open_day as od, availability_close_day as cd
         from public.app_settings where id = 1
     )
     insert into public.availability_cycles (reference_month, opens_at, closes_at, status)
     select (date_trunc('month', now()) + interval '1 month')::date,
            date_trunc('month', now()) + ((s.od - 1) || ' days')::interval,
            date_trunc('month', now()) + ((s.cd - 1) || ' days')::interval
              + interval '23 hours 59 minutes 59 seconds',
            'open'
       from s
      where now() >= date_trunc('month', now()) + ((s.od - 1) || ' days')::interval
        and now() <= date_trunc('month', now()) + ((s.cd - 1) || ' days')::interval
              + interval '23 hours 59 minutes 59 seconds'
     on conflict (reference_month) do nothing
     returning id`,
  );
  return rows.length; // 1 when a new cycle was opened this run
}

export async function runCycleMaintenance() {
  const summary = { cyclesOpened: 0, remindersSent: 0, cyclesClosed: 0, deficitSlots: 0 };

  // 0) Open next month's cycle when we reach the configured open day (§3.1).
  summary.cyclesOpened = await ensureUpcomingCycle();

  // 1) Auto-close cycles whose submission window has passed (§3.1 "Dia 25: fechamento"),
  //    then alert coordinators about availability deficits for each (§3.5).
  const { rows: closed } = await pool.query(
    `update public.availability_cycles
        set status = 'closed'
      where status = 'open' and closes_at < now()
      returning id`,
  );
  summary.cyclesClosed = closed.length;
  for (const c of closed) {
    const { deficitSlots } = await notifyCycleDeficits(c.id);
    summary.deficitSlots += deficitSlots;
  }

  // 2) Remind freelancers while a cycle is open and inside its window (days 20–25).
  const { rows: openCycles } = await pool.query(
    `select id, reference_month from public.availability_cycles
      where status = 'open' and now() between opens_at and closes_at`,
  );
  for (const c of openCycles) {
    if (await remindedRecently(c.id)) continue;
    const ids = await availabilityUserIds();
    const month = new Date(c.reference_month).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
    for (const uid of ids) {
      await notify({
        recipientUserId: uid,
        type: "availability_reminder",
        title: "Lance sua disponibilidade",
        body: `Período aberto para lançar disponibilidade de ${month}. Marque seus turnos antes do fechamento.`,
        data: { cycleId: c.id },
      });
      summary.remindersSent++;
    }
  }

  // 3) Top up feedback requests toward the 40% coverage target (§10.3).
  try {
    summary.feedbackRequests = await generateFeedbackRequests();
  } catch (e) {
    console.error("[scheduler] feedback requests failed:", e.message);
    summary.feedbackRequests = 0;
  }

  return summary;
}

export function startScheduler() {
  // Once a day at 09:00 (server timezone). node-cron keeps it inside the pm2 process.
  cron.schedule("0 9 * * *", () => {
    runCycleMaintenance()
      .then((s) => console.log(`[scheduler] maintenance: ${JSON.stringify(s)}`))
      .catch((e) => console.error("[scheduler] maintenance failed:", e.message));
  });
  console.log("[scheduler] cycle maintenance scheduled (daily 09:00)");
}
