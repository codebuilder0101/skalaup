// Schedule time-conflict rule (client 2026-09-01).
//
// The escala used to guard conflicts with `user_id + date + shift_type`: it compared
// the LABEL of the meal period, never the clock. A restaurant may run a 14:00–22:00
// "lunch" (MANÉ BSB, slot "Freela 3"), which overlaps another restaurant's
// 18:00–22:00 "dinner" — different shift_type, so every check passed and the same
// freelancer was scheduled at two addresses at once.
//
// The rule here is the real one: for one person on one date, two assignments may
// never occupy overlapping CLOCK WINDOWS, whatever their shift_type or restaurant.
// Adjacent windows (12:00–17:00 then 17:00–22:00) do not overlap and stay allowed —
// a minimum gap between restaurants is a separate, still-undecided rule.
//
// `public.assignment_window()` in the schema is the SQL twin of this logic and backs
// the exclusion constraint, so the database refuses an overlap even if a future code
// path forgets to call findTimeConflict().
import { pool } from "./db.js";

const toMinutes = (t) => {
  const [h, m] = String(t).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

// Minute range of a window within its own day; an end that is not after the start
// crosses midnight and extends past 24h. Mirrors public.assignment_window().
export function windowRange(startTime, endTime) {
  const start = toMinutes(startTime);
  let end = toMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

// Do two windows on the SAME date intersect? Half-open, so touching ends are fine.
export function windowsOverlap(a, b) {
  const [aStart, aEnd] = windowRange(a.startTime, a.endTime);
  const [bStart, bEnd] = windowRange(b.startTime, b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

// The freelancer's first assignment on `date` whose hours collide with the given
// window, or null. Pass a transaction client as `q` to check under the same lock
// that will do the insert.
export async function findTimeConflict(
  { userId, date, startTime, endTime, excludeAssignmentId = null }, q = pool,
) {
  const { rows } = await q.query(
    `select a.id, a.shift_type as "shiftType", r.name as "restaurantName",
            to_char(a.start_time, 'HH24:MI') as "startTime",
            to_char(a.end_time, 'HH24:MI') as "endTime"
       from public.schedule_assignments a
       left join public.restaurants r on r.id = a.restaurant_id
      where a.user_id = $1 and a.date = $2::date and a.status <> 'cancelled'
        and ($5::uuid is null or a.id <> $5::uuid)
        and public.assignment_window(a.date, a.start_time, a.end_time)
            && public.assignment_window($2::date, $3::time, $4::time)
      order by a.start_time asc
      limit 1`,
    [userId, date, startTime, endTime, excludeAssignmentId],
  );
  return rows[0] ?? null;
}

// Human message naming the shift that is in the way, so the coordinator knows what
// to move instead of just being told "no".
export function conflictMessage(clash, subject = "Você já está") {
  const where = clash.restaurantName ? ` no ${clash.restaurantName}` : "";
  return `Conflito de horário: ${subject} escalado das ${clash.startTime} às ${clash.endTime}${where} neste dia.`;
}

// PostgreSQL rejected the write on one of the schedule guards. 23P01 is the overlap
// exclusion constraint; 23505 is the retired one-per-(user,date,shift_type) unique
// index, still handled for databases migrated before the overlap rule installed.
export function isConflictCode(err) {
  return String(err?.code) === "23P01" || String(err?.code) === "23505";
}

// Every pair of overlapping assignments still in the table — legacy rows created
// before this rule existed. Powers GET /api/assignments/conflicts.
export async function listOverlaps(q = pool) {
  const { rows } = await q.query(
    `select a.user_id as "userId", u.name as "userName", a.date::text as date,
            a.id as "assignmentId", ra.name as "restaurantName",
            to_char(a.start_time, 'HH24:MI') as "startTime",
            to_char(a.end_time, 'HH24:MI') as "endTime",
            a.shift_type as "shiftType", a.status,
            b.id as "otherAssignmentId", rb.name as "otherRestaurantName",
            to_char(b.start_time, 'HH24:MI') as "otherStartTime",
            to_char(b.end_time, 'HH24:MI') as "otherEndTime",
            b.shift_type as "otherShiftType", b.status as "otherStatus"
       from public.schedule_assignments a
       join public.schedule_assignments b
         on b.user_id = a.user_id and b.date = a.date and b.id > a.id
        and b.status <> 'cancelled'
        and public.assignment_window(a.date, a.start_time, a.end_time)
            && public.assignment_window(b.date, b.start_time, b.end_time)
       join public.users u on u.id = a.user_id
       left join public.restaurants ra on ra.id = a.restaurant_id
       left join public.restaurants rb on rb.id = b.restaurant_id
      where a.status <> 'cancelled'
      order by a.date asc, u.name asc`,
  );
  return rows;
}
