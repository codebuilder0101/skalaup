// RFC 5545 iCalendar builder (dependency-free).
// Produces a VCALENDAR text suitable for a subscription feed (Google/Apple/Outlook).
//
// Timezone: all restaurants operate in Brazil, which no longer observes DST, so the
// offset is a fixed -03:00. We convert each shift's wall-clock (date + start/end time
// in restaurant-local time) to UTC by applying the offset and emit with a `Z` suffix.
// This avoids shipping a VTIMEZONE block. The offset is parameterised so a future
// per-restaurant `restaurants.timezone` can be wired in without touching this logic.

const DEFAULT_TZ = "America/Sao_Paulo";
const DEFAULT_OFFSET_MINUTES = -180; // -03:00

// Escape TEXT values per RFC 5545 §3.3.11 (backslash, semicolon, comma, newlines).
function escapeText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

// Fold content lines to <=75 octets per RFC 5545 §3.1 (continuation starts with a space).
function foldLine(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const chunks = [];
  let buf = "";
  let len = 0;
  for (const ch of line) {
    const chLen = Buffer.byteLength(ch, "utf8");
    // First line caps at 75 octets; continuation lines at 74 (+1 for the leading space).
    const cap = chunks.length === 0 ? 75 : 74;
    if (len + chLen > cap) {
      chunks.push(buf);
      buf = "";
      len = 0;
    }
    buf += ch;
    len += chLen;
  }
  if (buf) chunks.push(buf);
  return chunks.map((c, i) => (i === 0 ? c : ` ${c}`)).join("\r\n");
}

// Format a JS Date as a UTC iCal timestamp: YYYYMMDDTHHMMSSZ.
function toUtcStamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

// Combine a date string (YYYY-MM-DD) and time string (HH:MM[:SS]) interpreted in a
// fixed-offset local timezone, returning the corresponding UTC Date.
function localToUtc(dateStr, timeStr, offsetMinutes) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const [hh = 0, mm = 0, ss = 0] = String(timeStr).split(":").map(Number);
  // Date.UTC treats the components as UTC; subtract the local offset to get true UTC.
  // local = UTC + offset  =>  UTC = local - offset.
  return new Date(Date.UTC(y, m - 1, d, hh, mm, ss) - offsetMinutes * 60_000);
}

/**
 * Build a VCALENDAR string.
 * @param {object} opts
 * @param {string} opts.calName        Calendar display name (X-WR-CALNAME).
 * @param {Date}   opts.now            Current time, for DTSTAMP.
 * @param {number} [opts.offsetMinutes] Local UTC offset in minutes (default -180).
 * @param {string} [opts.tzName]       IANA tz label for X-WR-TIMEZONE (display only).
 * @param {Array<{
 *   uid: string, date: string, startTime: string, endTime: string,
 *   summary: string, location?: string, description?: string, cancelled?: boolean,
 * }>} opts.events
 */
export function buildCalendar({
  calName,
  now,
  offsetMinutes = DEFAULT_OFFSET_MINUTES,
  tzName = DEFAULT_TZ,
  events = [],
}) {
  const dtstamp = toUtcStamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SkalaUp//Escala//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calName)}`,
    `X-WR-TIMEZONE:${tzName}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];

  for (const ev of events) {
    const start = localToUtc(ev.date, ev.startTime, offsetMinutes);
    const end = localToUtc(ev.date, ev.endTime, offsetMinutes);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${toUtcStamp(start)}`);
    lines.push(`DTEND:${toUtcStamp(end)}`);
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    lines.push(`STATUS:${ev.cancelled ? "CANCELLED" : "CONFIRMED"}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
