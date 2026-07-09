// Lateness categorisation (§4.1) and no-show helpers (§5).
//
// The operation requires arrival 10 minutes BEFORE the shift start. `minutes` is
// the signed delay relative to the scheduled start (negative = arrived early,
// positive = arrived late). Category boundaries (§4.1 + §9.1 "gravíssimo"):
//
//   minutes <= -10            → none      (met the 10-min-early requirement)
//   -10 <  minutes <= 0       → light     −0.5  (between 10 min early and on time)
//   0   <  minutes <= 10      → moderate  −2
//   10  <  minutes <= 30      → severe    −4
//   minutes > 30              → critical  −8

export const EARLY_TARGET_MIN = 10;

const LATE_EVENT = {
  light: { eventType: "late_light", points: -0.5 },
  moderate: { eventType: "late_moderate", points: -2 },
  severe: { eventType: "late_severe", points: -4 },
  critical: { eventType: "late_critical", points: -8 },
};

// Returns { category, eventType, points }. `eventType`/`points` are null/0 for "none".
export function latenessFromMinutes(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= -EARLY_TARGET_MIN) {
    return { category: "none", eventType: null, points: 0 };
  }
  let category;
  if (m <= 0) category = "light";
  else if (m <= 10) category = "moderate";
  else if (m <= 30) category = "severe";
  else category = "critical";
  return { category, ...LATE_EVENT[category] };
}

// A lateness category that counts toward the monthly "3rd late" discount (§6).
// Every recorded lateness (light and worse) counts — only "none" is on time.
export function countsAsLate(category) {
  return category != null && category !== "none";
}

export const LATE_SCORE_EVENT_TYPES = [
  "late_light", "late_moderate", "late_severe", "late_critical",
];
