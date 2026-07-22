// Financial module — monthly payroll computation & reporting (§8, §12).
//
// The automatic *discount* entries (late_discount, no_show_discount) are written
// live by attendance.js. This module computes the *pay* side — `shift_pay` for
// every worked shift plus the `weekend_bonus` delta (§8.2) — and aggregates the
// whole `payroll_entries` ledger into the report the coordinator reviews & closes.
//
// Weekend bonus (§8.2): a freelancer who works the 4 mandatory weekend shifts of a
// week (Fri dinner, Sat lunch, Sat dinner, Sun lunch — week starts Monday) has ALL
// their shifts that week paid at the bonus rate instead of base. We model this as a
// base `shift_pay` for every worked shift + a separate `weekend_bonus` line carrying
// the (bonus − base) delta on each worked shift of an eligible week, so the total
// nets to bonus/shift while pay and bonus stay discriminated by restaurant (§12).
import { pool, one } from "./db.js";
import { ensurePayrollPeriod, resolvePaySettings } from "./payroll.js";
import { weekdayOf, isWeekendMandatory } from "./scheduleRules.js";

const num = (v) => (v == null ? 0 : Number(v));
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// --- date helpers (all UTC so weekdays never drift) ------------------------
function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
// Monday (ISO week start) of the week containing `dateStr`.
function mondayOf(dateStr) {
  const w = weekdayOf(dateStr);          // 0=Sun..6=Sat
  const isoDow = w === 0 ? 7 : w;        // 1=Mon..7=Sun
  return addDays(dateStr, -(isoDow - 1));
}
// Accept "YYYY-MM" or "YYYY-MM-DD"; return the first-of-month "YYYY-MM-01" or null.
export function normalizeMonthRef(m) {
  if (!m) return null;
  const mm = String(m).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mm)) return null;
  return `${mm}-01`;
}
function nextMonth(monthRef) {
  const d = new Date(`${monthRef}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

// Per-restaurant, per-shift-type pay settings, cached for one generation run.
async function settingsResolver() {
  const cache = new Map();
  return async (restaurantId, shiftType) => {
    const key = `${restaurantId ?? "__global__"}|${shiftType ?? "__any__"}`;
    if (!cache.has(key)) cache.set(key, await resolvePaySettings(restaurantId, shiftType));
    return cache.get(key);
  };
}

// ---------------------------------------------------------------------------
// generateMonthPay(monthRef) — (re)compute shift_pay + weekend_bonus for the
// month. Idempotent and transactional: it locks the period, wipes only the pay
// lines it owns (never the live discount/manual entries), and rebuilds them.
// No-op when the period is already closed (a closed folha is a frozen snapshot).
// Returns { status }.
// ---------------------------------------------------------------------------
export async function generateMonthPay(monthRefRaw) {
  const monthRef = normalizeMonthRef(monthRefRaw);
  if (!monthRef) throw new Error("Invalid month");

  await ensurePayrollPeriod(monthRef); // make sure the row exists before we lock it

  const client = await pool.connect();
  try {
    await client.query("begin");
    // Serialize concurrent generations for this month (e.g. two dashboard loads).
    const period = (await client.query(
      `select id, status from public.payroll_periods where reference_month = $1 for update`,
      [monthRef],
    )).rows[0];
    if (!period) { await client.query("rollback"); throw new Error("Period missing"); }
    if (period.status !== "open") { await client.query("commit"); return { status: period.status }; }

    // Load every published shift in the month AND the ±6 days around it, so a week
    // straddling the month boundary is fully visible for bonus eligibility. We only
    // *pay* the in-month shifts; each shift is paid in the month it occurs.
    const from = addDays(monthRef, -6);
    const to = addDays(nextMonth(monthRef), 6);
    const { rows } = await client.query(
      `select a.id, a.user_id as "userId", a.restaurant_id as "restaurantId",
              a.date::text as date, a.shift_type as "shiftType",
              to_char(a.start_time, 'HH24:MI') as "startTime",
              to_char(a.end_time, 'HH24:MI') as "endTime",
              coalesce(a.bonus_applied, false) as "bonusApplied",
              att.checkin_at as "checkinAt",
              coalesce(att.no_show, false) as "noShow", ab.type as "absenceType"
         from public.schedule_assignments a
         left join public.shift_attendance att on att.assignment_id = a.id
         left join public.absences ab on ab.assignment_id = a.id
        where a.status = 'published' and a.date >= $1::date and a.date <= $2::date`,
      [from, to],
    );

    // A shift counts as WORKED only when it has a real check-in (att.checkin_at) —
    // which the coordinator also sets when recording attendance by hand for a
    // dead-battery / app-down case (§4 OBS). Being merely scheduled (published) is
    // NOT enough: the pay must follow the worked schedule, not the planned one.
    const wasWorked = (r) => !!r.checkinAt && !r.noShow && !r.absenceType;

    // Bonus (client 2026-07-23): the coordinator decides, per shift, whether it pays the
    // bonus value — stored as schedule_assignments.bonus_applied. The old §8.2 weekend
    // auto-rule is gone. A shift pays its bonus value only when the coordinator marked it
    // AND the restaurant has bonus enabled. Payroll no longer overwrites bonus_applied.
    const shiftGetsBonus = (r, bonusEnabled) => bonusEnabled && r.bonusApplied === true;

    // Build the pay lines for in-month WORKED shifts. Worked = has a real check-in and
    // is not a no-show/absence. A shift that was only planned (published) but never
    // checked in is NOT paid — this is the fix for paying the planned instead of the
    // worked schedule.
    const monthEnd = nextMonth(monthRef);
    const resolve = await settingsResolver();
    // Per-slot pay (client 2026-07-22): a worked shift is matched to its restaurant's
    // named shift template by (shift_type, start, end); that template's own base/bonus
    // wins over the restaurant/global default. Cached once per restaurant.
    const tplCache = new Map();
    const templatePay = async (restaurantId, shiftType, startTime, endTime) => {
      if (!restaurantId) return { base: null, bonus: null };
      let m = tplCache.get(restaurantId);
      if (!m) {
        m = new Map();
        const { rows: ts } = await client.query(
          `select shift_type, to_char(start_time,'HH24:MI') as st, to_char(end_time,'HH24:MI') as et,
                  base_pay as "base", bonus_pay as "bonus"
             from public.shift_templates where restaurant_id = $1`,
          [restaurantId],
        );
        for (const t of ts) {
          m.set(`${t.shift_type}|${t.st}|${t.et}`, {
            base: t.base == null ? null : Number(t.base),
            bonus: t.bonus == null ? null : Number(t.bonus),
          });
        }
        tplCache.set(restaurantId, m);
      }
      return m.get(`${shiftType}|${startTime}|${endTime}`) ?? { base: null, bonus: null };
    };
    const ent = { user: [], rest: [], type: [], ref: [], amount: [], shiftCount: [], notes: [] };
    const asg = { id: [], rate: [] };

    for (const r of rows) {
      const inMonth = r.date >= monthRef && r.date < monthEnd;
      if (!inMonth || !wasWorked(r)) continue;

      const s = await resolve(r.restaurantId, r.shiftType);
      const tpl = await templatePay(r.restaurantId, r.shiftType, r.startTime, r.endTime);
      // Per-slot value wins; fall back to the restaurant/global resolution.
      const basePay = tpl.base != null ? tpl.base : s.basePay;
      const bonusPay = tpl.bonus != null ? tpl.bonus : s.bonusPay;
      const bonus = shiftGetsBonus(r, s.bonusEnabled);
      const appliedRate = round2(bonus ? bonusPay : basePay);

      ent.user.push(r.userId); ent.rest.push(r.restaurantId); ent.type.push("shift_pay");
      ent.ref.push(r.id); ent.amount.push(round2(basePay)); ent.shiftCount.push(1); ent.notes.push(null);

      if (bonus) {
        const delta = round2(bonusPay - basePay);
        if (delta > 0) {
          ent.user.push(r.userId); ent.rest.push(r.restaurantId); ent.type.push("weekend_bonus");
          ent.ref.push(r.id); ent.amount.push(delta); ent.shiftCount.push(null);
          ent.notes.push("Bônus do turno (marcado na escala)");
        }
      }

      asg.rate.push(appliedRate); asg.id.push(r.id);
    }

    // Replace only the pay lines we own; keep discounts & manual adjustments intact.
    await client.query(
      `delete from public.payroll_entries
        where period_id = $1 and type in ('shift_pay','weekend_bonus')`,
      [period.id],
    );
    if (ent.user.length > 0) {
      await client.query(
        `insert into public.payroll_entries
           (period_id, user_id, restaurant_id, type, reference_id, amount, shift_count, notes)
         select $1, u, r, t, ref, amt, sc, note
           from unnest($2::uuid[], $3::uuid[], $4::text[], $5::uuid[],
                       $6::numeric[], $7::int[], $8::text[]) as x(u, r, t, ref, amt, sc, note)`,
        [period.id, ent.user, ent.rest, ent.type, ent.ref, ent.amount, ent.shiftCount, ent.notes],
      );
    }
    // Sync only the resolved pay rate (feeds the no-show "highest shift" rule §5).
    // bonus_applied is the coordinator's choice now — payroll must NOT overwrite it.
    if (asg.id.length > 0) {
      await client.query(
        `update public.schedule_assignments a
            set pay_rate_applied = v.rate
           from unnest($1::uuid[], $2::numeric[]) as v(id, rate)
          where a.id = v.id`,
        [asg.id, asg.rate],
      );
    }

    await client.query("commit");
    return { status: "open" };
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// getMonthReport(monthRef) — aggregate the ledger into the coordinator's view:
// per-freelancer totals, each broken down by restaurant (§12). Reads only; call
// generateMonthPay first when the period is open to refresh the pay lines.
// ---------------------------------------------------------------------------
const ZERO = () => ({
  shiftPay: 0, weekendBonus: 0, lateDiscount: 0, noShowDiscount: 0,
  manualAdjustment: 0, manualAddition: 0, manualDeduction: 0, shiftCount: 0, net: 0,
});
function addEntry(bucket, type, amount, shiftCount) {
  if (type === "shift_pay") { bucket.shiftPay += amount; bucket.shiftCount += shiftCount; }
  else if (type === "weekend_bonus") bucket.weekendBonus += amount;
  else if (type === "late_discount") bucket.lateDiscount += amount;
  else if (type === "no_show_discount") bucket.noShowDiscount += amount;
  else if (type === "manual_adjustment") {
    bucket.manualAdjustment += amount;
    // Split the signed adjustment so the UI can show acréscimos and descontos apart.
    if (amount >= 0) bucket.manualAddition += amount;
    else bucket.manualDeduction += amount;
  }
  bucket.net += amount;
}
const MONEY_KEYS = ["shiftPay", "weekendBonus", "lateDiscount", "noShowDiscount", "manualAdjustment", "manualAddition", "manualDeduction", "net"];
function finalize(bucket) {
  // Round only the money fields — never the id/name/shiftCount fields on a line.
  for (const k of MONEY_KEYS) bucket[k] = round2(bucket[k]);
  return bucket;
}

export async function getMonthReport(monthRefRaw) {
  const monthRef = normalizeMonthRef(monthRefRaw);
  if (!monthRef) throw new Error("Invalid month");

  const period = await one(
    `select p.id, p.reference_month::text as "referenceMonth", p.status,
            p.closed_at as "closedAt", cu.name as "closedByName",
            p.paid_at as "paidAt", pu.name as "paidByName"
       from public.payroll_periods p
       left join public.users cu on cu.id = p.closed_by
       left join public.users pu on pu.id = p.paid_by
      where p.reference_month = $1`,
    [monthRef],
  );

  const totals = ZERO();
  const byUser = new Map();
  if (period) {
    const { rows } = await pool.query(
      `select e.user_id as "userId", u.name as "userName",
              fp.pix_key as "pixKey", fp.bank_name as "bankName",
              e.restaurant_id as "restaurantId", r.name as "restaurantName",
              e.type, e.amount::float8 as amount, coalesce(e.shift_count, 0)::int as "shiftCount"
         from public.payroll_entries e
         join public.users u on u.id = e.user_id
         left join public.freelancer_profiles fp on fp.user_id = e.user_id
         left join public.restaurants r on r.id = e.restaurant_id
        where e.period_id = $1`,
      [period.id],
    );

    for (const e of rows) {
      let fr = byUser.get(e.userId);
      if (!fr) {
        fr = {
          userId: e.userId, name: e.userName,
          pixKey: e.pixKey ?? null, bankName: e.bankName ?? null,
          totals: ZERO(), byRestaurant: new Map(),
        };
        byUser.set(e.userId, fr);
      }
      const restKey = e.restaurantId ?? "__none__";
      let rb = fr.byRestaurant.get(restKey);
      if (!rb) {
        rb = { restaurantId: e.restaurantId, restaurantName: e.restaurantName ?? "—", ...ZERO() };
        fr.byRestaurant.set(restKey, rb);
      }
      const amount = num(e.amount);
      addEntry(fr.totals, e.type, amount, e.shiftCount);
      addEntry(rb, e.type, amount, e.shiftCount);
      addEntry(totals, e.type, amount, e.shiftCount);
    }
  }

  const freelancers = [...byUser.values()]
    .map((fr) => ({
      userId: fr.userId,
      name: fr.name,
      pixKey: fr.pixKey,
      bankName: fr.bankName,
      totals: finalize(fr.totals),
      byRestaurant: [...fr.byRestaurant.values()]
        .map((rb) => finalize(rb))
        .sort((a, b) => a.restaurantName.localeCompare(b.restaurantName)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    period: period
      ? {
          referenceMonth: monthRef,
          status: period.status,
          closedAt: period.closedAt,
          closedByName: period.closedByName,
          paidAt: period.paidAt,
          paidByName: period.paidByName,
        }
      : {
          referenceMonth: monthRef, status: "open",
          closedAt: null, closedByName: null, paidAt: null, paidByName: null,
        },
    totals: finalize(totals),
    freelancerCount: freelancers.length,
    freelancers,
  };
}
