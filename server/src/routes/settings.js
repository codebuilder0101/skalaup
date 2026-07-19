import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { DEFAULT_SCORE_POINTS, DEFAULT_STAR_CUTOFFS, getScorePoints } from "../scoreConfig.js";

// Editable scoring configuration (R1/R7). Coordinators/admins edit point values
// and star-level cutoffs. Three point values are backed by dedicated app_settings
// columns the scoring engine already reads (flexible availability, weekend target,
// furo cover); the rest live in app_settings.score_points (jsonb). This route
// presents one unified `points` map and routes each key to the right store on save.
const router = Router();
router.use(requireAuth);
const requireOps = requireRole("coordinator", "administrator");

// eventType -> dedicated app_settings column (source of truth the code reads).
const COLUMN_POINTS = {
  flexible_availability: "flexible_availability_points",
  target_10_shifts: "weekend_target_points",
  furo_covered: "furo_cover_points",
};

async function readConfig() {
  const s = await one(
    `select flexible_availability_points as fa, weekend_target_points as wt,
            furo_cover_points as fc, monthly_target_shifts as mts, swap_scoring_cap as cap,
            manual_score_monthly_cap as mscap, late_discount_amount as ldc,
            base_pay_per_shift as bp, bonus_pay_per_shift as bnp, weekend_bonus_enabled as wbe,
            checkin_geofence_enabled as cge, checkin_radius_m as crm,
            star_cutoffs as cutoffs, custom_score_criteria as criteria
       from public.app_settings where id = 1`,
  );
  const points = await getScorePoints(); // defaults + jsonb overrides (non-column keys)
  // The three column-backed values are the real source — reflect them.
  points.flexible_availability = Number(s?.fa ?? DEFAULT_SCORE_POINTS.flexible_availability);
  points.target_10_shifts = Number(s?.wt ?? DEFAULT_SCORE_POINTS.target_10_shifts);
  points.furo_covered = Number(s?.fc ?? DEFAULT_SCORE_POINTS.furo_covered);
  const cutoffs = Array.isArray(s?.cutoffs) && s.cutoffs.length === 4
    ? s.cutoffs.map(Number) : [...DEFAULT_STAR_CUTOFFS];
  const customCriteria = (Array.isArray(s?.criteria) ? s.criteria : [])
    .filter((c) => c && typeof c.id === "string" && typeof c.label === "string")
    .map((c) => ({ id: c.id, label: c.label, points: Number(c.points) || 0, active: c.active !== false }));
  return {
    points,
    starCutoffs: cutoffs,
    monthlyTargetShifts: Number(s?.mts ?? 10),
    swapScoringCap: Number(s?.cap ?? 3),
    manualScoreMonthlyCap: Number(s?.mscap ?? 10),
    // Global 3rd-late discount (R20 F5): same for all clients, edited here only.
    lateDiscountAmount: Number(s?.ldc ?? 0),
    // Global pay defaults — the fallback a restaurant uses when its own field is blank.
    basePayPerShift: Number(s?.bp ?? 60),
    bonusPayPerShift: Number(s?.bnp ?? 75),
    weekendBonusEnabled: (s?.wbe ?? true) !== false,
    // Geolocation check-in (client round 2026-07-19): global on/off + radius (m).
    checkinGeofenceEnabled: (s?.cge ?? true) !== false,
    checkinRadiusM: Number(s?.crm ?? 150),
    customCriteria,
  };
}

// GET /api/settings/score
router.get("/score", requireOps, async (_req, res) => {
  try {
    res.json(await readConfig());
  } catch (e) {
    console.error("settings get error:", e.message);
    res.status(500).json({ error: "Falha ao carregar as configurações." });
  }
});

const isNum = (v) => v != null && Number.isFinite(Number(v));

// PUT /api/settings/score { points?, starCutoffs?, monthlyTargetShifts?, swapScoringCap?, manualScoreMonthlyCap? }
router.put("/score", requireOps, async (req, res) => {
  try {
    const b = req.body || {};

    // Validate star cutoffs: exactly 4, finite, strictly ascending.
    let cutoffs = null;
    if (b.starCutoffs !== undefined) {
      const c = b.starCutoffs;
      if (!Array.isArray(c) || c.length !== 4 || !c.every(isNum)) {
        return res.status(400).json({ error: "starCutoffs must be 4 numbers." });
      }
      cutoffs = c.map(Number);
      for (let i = 1; i < 4; i++) {
        if (cutoffs[i] <= cutoffs[i - 1]) {
          return res.status(400).json({ error: "starCutoffs must be strictly ascending." });
        }
      }
    }

    // Validate custom scoring criteria (R15): array of { id, label, points, active }.
    // Points may be negative (penalties). Labels are required and trimmed; each id
    // is stable (client-generated) and de-duplicated.
    let criteria = null;
    if (b.customCriteria !== undefined) {
      if (!Array.isArray(b.customCriteria)) {
        return res.status(400).json({ error: "customCriteria must be an array." });
      }
      const seen = new Set();
      criteria = [];
      for (const c of b.customCriteria) {
        if (!c || typeof c !== "object") continue;
        const label = String(c.label ?? "").trim();
        const id = String(c.id ?? "").trim();
        if (!id || !label || seen.has(id) || !isNum(c.points)) continue;
        seen.add(id);
        criteria.push({ id, label, points: Number(c.points), active: c.active !== false });
      }
    }

    // Split incoming point edits into column-backed vs jsonb-backed.
    const colUpdates = {}; // app_settings column -> value
    const jsonUpdates = {}; // event_type -> value (for score_points jsonb)
    if (b.points && typeof b.points === "object") {
      for (const [k, v] of Object.entries(b.points)) {
        if (!(k in DEFAULT_SCORE_POINTS) || !isNum(v)) continue;
        if (COLUMN_POINTS[k]) colUpdates[COLUMN_POINTS[k]] = Number(v);
        else jsonUpdates[k] = Number(v);
      }
    }
    if (isNum(b.monthlyTargetShifts)) colUpdates.monthly_target_shifts = Math.max(0, Math.round(Number(b.monthlyTargetShifts)));
    if (isNum(b.swapScoringCap)) colUpdates.swap_scoring_cap = Math.max(0, Math.round(Number(b.swapScoringCap)));
    if (isNum(b.manualScoreMonthlyCap)) colUpdates.manual_score_monthly_cap = Math.max(0, Number(b.manualScoreMonthlyCap));
    if (isNum(b.lateDiscountAmount)) colUpdates.late_discount_amount = Math.max(0, Number(b.lateDiscountAmount));
    if (isNum(b.basePayPerShift)) colUpdates.base_pay_per_shift = Math.max(0, Number(b.basePayPerShift));
    if (isNum(b.bonusPayPerShift)) colUpdates.bonus_pay_per_shift = Math.max(0, Number(b.bonusPayPerShift));
    if (typeof b.weekendBonusEnabled === "boolean") colUpdates.weekend_bonus_enabled = b.weekendBonusEnabled;
    if (typeof b.checkinGeofenceEnabled === "boolean") colUpdates.checkin_geofence_enabled = b.checkinGeofenceEnabled;
    if (isNum(b.checkinRadiusM)) colUpdates.checkin_radius_m = Math.max(1, Math.round(Number(b.checkinRadiusM)));

    // Merge jsonb overrides on top of what's stored.
    const existing = (await one(`select score_points from public.app_settings where id = 1`))?.score_points || {};
    const mergedJson = { ...existing, ...jsonUpdates };

    // Build one UPDATE.
    const sets = ["updated_at = now()", "score_points = $1::jsonb"];
    const vals = [JSON.stringify(mergedJson)];
    if (cutoffs) { vals.push(JSON.stringify(cutoffs)); sets.push(`star_cutoffs = $${vals.length}::jsonb`); }
    if (criteria) { vals.push(JSON.stringify(criteria)); sets.push(`custom_score_criteria = $${vals.length}::jsonb`); }
    for (const [col, v] of Object.entries(colUpdates)) { vals.push(v); sets.push(`${col} = $${vals.length}`); }
    await pool.query(`update public.app_settings set ${sets.join(", ")} where id = 1`, vals);

    // If cutoffs changed, recompute every freelancer's level (fires the trigger).
    if (cutoffs) await pool.query(`update public.freelancer_profiles set current_score = current_score`);

    res.json(await readConfig());
  } catch (e) {
    console.error("settings put error:", e.message);
    res.status(500).json({ error: "Falha ao salvar as configurações." });
  }
});

export default router;
