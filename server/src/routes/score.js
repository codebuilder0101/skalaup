import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";

// Score events (§9). Canonical point values mirror the frontend SCORE_POINTS map;
// the coordinator may override per-event via an explicit `points` value (§9.1 OBS).
const router = Router();
router.use(requireAuth);
const requireOps = requireRole("coordinator", "administrator");

const SCORE_POINTS = {
  target_10_shifts: 5, swap_accepted: 2, meeting: 2, online_training: 2,
  innovation_video: 2, charity_event: 3, inperson_training: 4,
  feedback_fundamentos: 1, feedback_proatividade: 2, feedback_encantamento: 3,
  feedback_extraordinario: 5, late_light: -0.5, late_moderate: -2, late_severe: -4,
  late_critical: -8, swap_requested: -1, no_show_unjustified: -5, manual_adjustment: 0,
};

const COLS = `id, user_id as "userId", event_type as "eventType", points,
  reference_type as "referenceType", reference_id as "referenceId",
  occurred_on as "occurredOn", month_ref as "monthRef", created_by as "createdBy",
  is_voided as "isVoided", notes, created_at as "createdAt"`;

// Recompute the cached current_score (sum of non-voided events) for a user.
async function recomputeScore(userId) {
  await pool.query(
    `update public.freelancer_profiles
       set current_score = coalesce(
         (select sum(points) from public.score_events where user_id = $1 and is_voided = false), 0)
     where user_id = $1`,
    [userId],
  );
}

function monthRefOf(dateStr) {
  return `${dateStr.slice(0, 7)}-01`; // first day of the occurred-on month
}

// GET /api/score/events?userId=
router.get("/events", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId is required" });
  const isSelf = userId === req.user.sub;
  const isOps = req.user.role === "coordinator" || req.user.role === "administrator";
  if (!isSelf && !isOps) return res.status(403).json({ error: "Forbidden" });
  const { rows } = await pool.query(
    `select ${COLS} from public.score_events where user_id = $1 order by occurred_on desc, created_at desc`,
    [userId],
  );
  res.json(rows);
});

// GET /api/score/accumulated?userId=  → { total }
router.get("/accumulated", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId is required" });
  const row = await one(
    `select coalesce(sum(points), 0) as total from public.score_events
       where user_id = $1 and is_voided = false`,
    [userId],
  );
  res.json({ total: Number(row.total) });
});

// POST /api/score/events — coordinator/administrator only.
router.post("/events", requireOps, async (req, res) => {
  const b = req.body || {};
  if (!b.userId || !b.eventType || !b.occurredOn) {
    return res.status(400).json({ error: "userId, eventType and occurredOn are required" });
  }
  if (!(b.eventType in SCORE_POINTS)) return res.status(400).json({ error: "Invalid eventType" });
  const points = b.points ?? SCORE_POINTS[b.eventType];
  const row = await one(
    `insert into public.score_events
       (user_id, event_type, points, reference_type, reference_id, occurred_on, month_ref, created_by, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${COLS}`,
    [
      b.userId, b.eventType, points, b.referenceType ?? "manual", b.referenceId ?? null,
      b.occurredOn, monthRefOf(b.occurredOn), b.createdBy ?? req.user.sub, b.notes ?? null,
    ],
  );
  await recomputeScore(b.userId);
  res.status(201).json(row);
});

// PUT /api/score/events/:id/void — coordinator removes a penalty/event (§9.1 OBS).
router.put("/events/:id/void", requireOps, async (req, res) => {
  const row = await one(
    `update public.score_events set is_voided = true where id = $1 returning ${COLS}`,
    [req.params.id],
  );
  if (!row) return res.status(404).json({ error: "Not found" });
  await recomputeScore(row.userId);
  res.json(row);
});

export default router;
