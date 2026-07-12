import { one } from "./db.js";

// Editable scoring config (R1/R7). Point values live in code as defaults and can
// be overridden per event_type via app_settings.score_points (jsonb). Star levels
// derive from current_score using app_settings.star_cutoffs (see the DB trigger
// skala_set_current_level). This module is the single source the scoring code
// reads point values from, so editing them in Settings actually takes effect.

export const DEFAULT_SCORE_POINTS = {
  target_10_shifts: 5, swap_accepted: 2, meeting: 2, online_training: 2,
  innovation_video: 2, charity_event: 3, inperson_training: 4,
  feedback_fundamentos: 1, feedback_proatividade: 2, feedback_encantamento: 3,
  feedback_extraordinario: 5, late_light: -0.5, late_moderate: -2, late_severe: -4,
  late_critical: -8, swap_requested: -1, no_show_unjustified: -5, manual_adjustment: 0,
  flexible_availability: 2, furo_covered: 3,
};

export const DEFAULT_STAR_CUTOFFS = [10, 25, 50, 100];

// Merged point map (DB overrides on top of defaults). Only numeric overrides win.
export async function getScorePoints() {
  const row = await one(`select score_points from public.app_settings where id = 1`);
  const merged = { ...DEFAULT_SCORE_POINTS };
  const over = row?.score_points;
  if (over && typeof over === "object") {
    for (const [k, v] of Object.entries(over)) {
      if (k in merged && v != null && Number.isFinite(Number(v))) merged[k] = Number(v);
    }
  }
  return merged;
}

// Point value for one event type (falls back to default, then 0).
export async function pointsFor(eventType) {
  const p = await getScorePoints();
  return p[eventType] ?? DEFAULT_SCORE_POINTS[eventType] ?? 0;
}

export async function getStarCutoffs() {
  const row = await one(`select star_cutoffs from public.app_settings where id = 1`);
  const c = row?.star_cutoffs;
  return Array.isArray(c) && c.length === 4 && c.every((n) => Number.isFinite(Number(n)))
    ? c.map(Number) : [...DEFAULT_STAR_CUTOFFS];
}

// level 1..5 = 1 + number of cutoffs the score meets (mirrors the DB trigger).
export function levelFromScore(score, cutoffs = DEFAULT_STAR_CUTOFFS) {
  let lvl = 1;
  for (const c of cutoffs) if (Number(score) >= Number(c)) lvl++;
  return Math.min(5, lvl);
}
