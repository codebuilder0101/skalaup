// Payroll helpers for the automatic discounts (§5, §6, §8.4).
//
// Discounts are written as negative `payroll_entries` rows against the month's
// `payroll_periods` row. Pay/discount settings cascade: a restaurant value
// overrides the global `app_settings` default; null inherits the global.
import { pool, one } from "./db.js";

// First day of the month for a YYYY-MM-DD date (matches score_events.month_ref).
export function monthRefOf(dateStr) {
  return `${String(dateStr).slice(0, 7)}-01`;
}

const num = (v) => (v == null ? null : Number(v));

// Ensure an OPEN payroll period exists for the month; returns { id, status }.
export async function ensurePayrollPeriod(monthRef) {
  await pool.query(
    `insert into public.payroll_periods (reference_month) values ($1)
       on conflict (reference_month) do nothing`,
    [monthRef],
  );
  return one(
    `select id, status from public.payroll_periods where reference_month = $1`,
    [monthRef],
  );
}

// Resolve effective pay/discount settings for a restaurant, optionally for a
// specific shift type. Pay cascades: per-shift-type restaurant value → the
// restaurant's general value → the global default. `shiftType` is optional; when
// omitted the per-type override is skipped (used by month-level discounts).
export async function resolvePaySettings(restaurantId, shiftType) {
  const g = await one(
    `select base_pay_per_shift as "basePay", bonus_pay_per_shift as "bonusPay",
            late_discount_amount as "lateDiscount", no_show_discount_mode as "noShowMode",
            no_show_custom_amount as "noShowCustom", weekend_bonus_enabled as "bonusEnabled"
       from public.app_settings where id = 1`,
  );
  let r = null;
  if (restaurantId) {
    r = await one(
      `select base_pay_per_shift as "basePay", bonus_pay_per_shift as "bonusPay",
              base_pay_lunch as "baseLunch", bonus_pay_lunch as "bonusLunch",
              base_pay_dinner as "baseDinner", bonus_pay_dinner as "bonusDinner",
              late_discount_amount as "lateDiscount", no_show_discount_mode as "noShowMode",
              no_show_custom_amount as "noShowCustom", weekend_bonus_enabled as "bonusEnabled"
         from public.restaurants where id = $1`,
      [restaurantId],
    );
  }
  const typeBase = shiftType === "lunch" ? r?.baseLunch : shiftType === "dinner" ? r?.baseDinner : null;
  const typeBonus = shiftType === "lunch" ? r?.bonusLunch : shiftType === "dinner" ? r?.bonusDinner : null;
  return {
    basePay: num(typeBase) ?? num(r?.basePay) ?? num(g?.basePay) ?? 60,
    bonusPay: num(typeBonus) ?? num(r?.bonusPay) ?? num(g?.bonusPay) ?? 75,
    // Late discount is GLOBAL only (R20 F5): the 3rd-late penalty is the same for
    // every client, configured in Settings → Pontuação. Per-restaurant values are ignored.
    lateDiscount: num(g?.lateDiscount) ?? 0,
    noShowMode: r?.noShowMode ?? g?.noShowMode ?? "highest_shift",
    noShowCustom: num(r?.noShowCustom) ?? num(g?.noShowCustom) ?? null,
    // Weekend bonus (§8.2) is on by default; a restaurant/global `false` disables it.
    bonusEnabled: (r?.bonusEnabled ?? g?.bonusEnabled) !== false,
  };
}

// Did the freelancer work any bonus-rate shift in the month? (§5: "se a pessoa
// fez algum turno bonificado, é ele que é descontado".)
async function workedBonusShiftInMonth(userId, monthRef) {
  const row = await one(
    `select 1 from public.schedule_assignments
      where user_id = $1 and bonus_applied = true and status <> 'cancelled'
        and date >= $2::date and date < ($2::date + interval '1 month') limit 1`,
    [userId, monthRef],
  );
  return !!row;
}

// The amount (positive number) to deduct for a 1st unjustified no-show (§5/§8.4).
export async function noShowDiscountAmount({ userId, restaurantId, monthRef, settings }) {
  const s = settings ?? (await resolvePaySettings(restaurantId));
  if (s.noShowMode === "custom") return Math.max(0, s.noShowCustom ?? 0);
  if (s.noShowMode === "base_shift") return Math.max(0, s.basePay);
  // highest_shift (default): the bonus rate when a bonus shift was worked, else base.
  const hasBonus = await workedBonusShiftInMonth(userId, monthRef);
  return Math.max(0, hasBonus ? s.bonusPay : s.basePay);
}
