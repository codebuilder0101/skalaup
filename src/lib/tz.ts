// Timezone-aware conversion between wall-clock times and UTC instants.
//
// Shift check-in/out times must always be read in the RESTAURANT's timezone, not
// the browser's. Otherwise a coordinator editing times from a different timezone
// binds the typed wall-clock to the wrong instant, and the server's lateness calc
// (which anchors the schedule to the restaurant timezone) reports a phantom delay
// equal to the offset difference. All three helpers below take the restaurant's
// IANA timezone so the frontend stays symmetric with the backend.

export const DEFAULT_TZ = "America/Sao_Paulo";

// Offset (ms) of `timeZone` from UTC at the given instant: zoneWallClock - utc.
function tzOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const f: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") f[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return asUTC - date.getTime();
}

// "YYYY-MM-DDTHH:MM" (wall-clock in `timeZone`) -> UTC ISO instant, or null.
export function zonedInputToUTC(wall: string, timeZone: string): string | null {
  if (!wall) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!m) return null;
  const guess = Date.UTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]),
  );
  // First correction from the guessed instant, then settle at the corrected one so
  // DST-changing zones resolve correctly (a no-op for fixed-offset zones like BR).
  const offset1 = tzOffsetMs(timeZone, new Date(guess));
  let utc = guess - offset1;
  const offset2 = tzOffsetMs(timeZone, new Date(utc));
  if (offset2 !== offset1) utc = guess - offset2;
  return new Date(utc).toISOString();
}

// UTC ISO instant -> "YYYY-MM-DDTHH:MM" wall-clock in `timeZone` (for <input datetime-local>).
export function utcToZonedInput(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const f: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) {
    if (p.type !== "literal") f[p.type] = p.value;
  }
  return `${f.year}-${f.month}-${f.day}T${f.hour}:${f.minute}`;
}
