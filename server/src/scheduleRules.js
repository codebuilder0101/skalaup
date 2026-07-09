// Shared scheduling business rules (§3.3, §8.2, §8.3).
import { one } from "./db.js";

// Default shift hours when a restaurant has no shift_templates row (§8.1).
const DEFAULT_TIMES = {
  lunch: { start: "12:00", end: "16:00" },
  dinner: { start: "18:00", end: "22:00" },
};

// 0 = Sunday … 6 = Saturday. Parse as UTC midnight so the weekday never drifts.
export function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

// The 4 mandatory weekend bonus shifts (§8.2): Fri dinner, Sat lunch, Sat dinner, Sun lunch.
export function isWeekendMandatory(weekday, shiftType) {
  return (
    (weekday === 5 && shiftType === "dinner") || // Friday dinner
    (weekday === 6 && shiftType === "lunch") ||  // Saturday lunch
    (weekday === 6 && shiftType === "dinner") || // Saturday dinner
    (weekday === 0 && shiftType === "lunch")     // Sunday lunch
  );
}

// Resolve the primary (earliest) slot's start/end time from shift_templates — a
// meal period may now have several staggered slots — else fall back to defaults.
export async function resolveShiftTimes(restaurantId, shiftType) {
  const tpl = await one(
    `select start_time as "startTime", end_time as "endTime"
       from public.shift_templates where restaurant_id = $1 and shift_type = $2
      order by start_time asc limit 1`,
    [restaurantId, shiftType],
  );
  if (tpl) return { startTime: tpl.startTime, endTime: tpl.endTime };
  const d = DEFAULT_TIMES[shiftType];
  return { startTime: d.start, endTime: d.end };
}

function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// The 4 mandatory shifts of the weekend immediately preceding `dateStr`'s week
// (week starts Monday). Returns [{date, shiftType}] for Fri/Sat/Sat/Sun.
export function precedingWeekendShifts(dateStr) {
  const w = weekdayOf(dateStr);            // 0=Sun..6=Sat
  const isoDow = w === 0 ? 7 : w;          // 1=Mon..7=Sun
  const monday = addDays(dateStr, -(isoDow - 1));
  const friday = addDays(monday, -3);
  const saturday = addDays(monday, -2);
  const sunday = addDays(monday, -1);
  return [
    { date: friday, shiftType: "dinner" },
    { date: saturday, shiftType: "lunch" },
    { date: saturday, shiftType: "dinner" },
    { date: sunday, shiftType: "lunch" },
  ];
}
