// Schedule time-conflict helpers — the browser twin of server/src/conflicts.js and
// public.assignment_window() in the schema.
//
// A shift's meal label ("almoço"/"janta") says nothing about the clock: a restaurant
// may run a 14:00–22:00 lunch, which collides with another restaurant's 18:00–22:00
// dinner. Conflicts are therefore decided by overlapping TIME WINDOWS, never by
// shift_type.
import type { BusyWindow } from "./scheduling";

export interface TimeWindow { startTime: string; endTime: string }

const toMinutes = (t: string) => {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

// Minute range within its own day; an end that is not after the start crosses
// midnight and extends past 24h.
export function windowRange(w: TimeWindow): [number, number] {
  const start = toMinutes(w.startTime);
  let end = toMinutes(w.endTime);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

// Half-open, so touching windows (12:00–17:00 then 17:00–22:00) do NOT conflict.
export function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  const [aStart, aEnd] = windowRange(a);
  const [bStart, bEnd] = windowRange(b);
  return aStart < bEnd && bStart < aEnd;
}

// The freelancer's booked window that collides with `slot`, or undefined.
export function findBusyConflict(
  windows: BusyWindow[], userId: string, slot: TimeWindow,
): BusyWindow | undefined {
  return windows.find((w) => w.userId === userId && windowsOverlap(w, slot));
}
