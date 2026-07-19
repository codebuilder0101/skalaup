import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { notify } from "../notify.js";

// Customer-rating validation queue (client 2026-07-19). A QR rating from a customer
// lands 'pending' and scores nothing until a coordinator validates it here and picks
// a rating TYPE (configurable in app_settings.rating_types). The type's points — which
// may be negative for a bad review — are then awarded via a 'customer_rating'
// score_event, linked on the rating so a later reject can void it. Coordinator/admin only.
const router = Router();
router.use(requireAuth);
const requireOps = requireRole("coordinator", "administrator");

const monthRefOf = (dateStr) => `${String(dateStr).slice(0, 7)}-01`;

async function recompute(client, userId) {
  await client.query(
    `update public.freelancer_profiles
        set current_score = coalesce(
          (select sum(points) from public.score_events where user_id = $1 and is_voided = false), 0)
      where user_id = $1`,
    [userId],
  );
}

const RATING_COLS = `r.id, r.stars, r.comment, r.status,
  r.rating_type_id as "ratingTypeId", r.created_at as "createdAt", r.rated_on::text as "ratedOn",
  r.reviewed_at as "reviewedAt", r.freelancer_user_id as "freelancerId",
  u.name as "freelancerName", ru.name as "reviewedByName"`;

// GET /api/ratings?status=pending  (default pending) — the validation queue.
router.get("/", requireOps, async (req, res) => {
  const status = ["pending", "approved", "rejected"].includes(String(req.query.status))
    ? String(req.query.status) : "pending";
  const { rows } = await pool.query(
    `select ${RATING_COLS}
       from public.public_ratings r
       join public.users u on u.id = r.freelancer_user_id
       left join public.users ru on ru.id = r.reviewed_by
      where r.status = $1
      order by r.created_at desc
      limit 200`,
    [status],
  );
  res.json(rows);
});

// GET /api/ratings/pending/count — badge for the queue.
router.get("/pending/count", requireOps, async (_req, res) => {
  const row = await one(`select count(*)::int as c from public.public_ratings where status = 'pending'`);
  res.json({ count: row.c });
});

async function ratingTypeById(id) {
  const cfg = await one(`select rating_types as t from public.app_settings where id = 1`);
  const list = Array.isArray(cfg?.t) ? cfg.t : [];
  return list.find((x) => x && x.id === id) || null;
}

// POST /api/ratings/:id/approve { ratingTypeId } — classify + award the type's points.
router.post("/:id/approve", requireOps, async (req, res) => {
  const ratingTypeId = String(req.body?.ratingTypeId || "");
  const type = await ratingTypeById(ratingTypeId);
  if (!type) return res.status(400).json({ error: "invalid_type", message: "Tipo de avaliação não encontrado." });
  if (type.active === false) return res.status(400).json({ error: "inactive_type", message: "Este tipo está inativo." });
  const points = Number(type.points);
  if (!Number.isFinite(points)) return res.status(400).json({ error: "invalid_points", message: "Pontuação do tipo inválida." });

  const client = await pool.connect();
  try {
    await client.query("begin");
    const r = (await client.query(
      `select id, freelancer_user_id as "freelancerId", stars, comment, rated_on::text as "ratedOn",
              status, score_event_id as "scoreEventId"
         from public.public_ratings where id = $1 for update`,
      [req.params.id],
    )).rows[0];
    if (!r) { await client.query("rollback"); return res.status(404).json({ error: "Not found" }); }

    // Re-approval: void any previously awarded event before creating the new one.
    if (r.scoreEventId) {
      await client.query(`update public.score_events set is_voided = true where id = $1`, [r.scoreEventId]);
    }

    const notes = `Avaliação do cliente (${r.stars}★): ${type.label}` + (r.comment ? ` — “${r.comment}”` : "");
    const ev = (await client.query(
      `insert into public.score_events
         (user_id, event_type, points, reference_type, reference_id, occurred_on, month_ref, created_by, notes)
       values ($1,'customer_rating',$2,'public_rating',$3,$4,$5,$6,$7) returning id`,
      [r.freelancerId, points, r.id, r.ratedOn, monthRefOf(r.ratedOn), req.user.sub, notes],
    )).rows[0];

    await client.query(
      `update public.public_ratings
          set status = 'approved', rating_type_id = $2, reviewed_by = $3, reviewed_at = now(), score_event_id = $4
        where id = $1`,
      [r.id, ratingTypeId, req.user.sub, ev.id],
    );
    await recompute(client, r.freelancerId);
    await client.query("commit");

    // Tell the freelancer their rating was validated (best-effort).
    const sign = points >= 0 ? `+${points}` : `${points}`;
    notify({
      recipientUserId: r.freelancerId, type: "customer_rating",
      title: "Avaliação de cliente validada",
      body: `Uma avaliação sua foi validada: ${type.label} (${sign} ponto(s)).`,
      data: { path: "/performance" },
    }).catch(() => {});

    res.json({ ok: true, points });
  } catch (e) {
    await client.query("rollback");
    console.error("rating approve error:", e.message);
    res.status(500).json({ error: "Falha ao aprovar a avaliação." });
  } finally {
    client.release();
  }
});

// POST /api/ratings/:id/reject — discard; void any awarded points if it was approved.
router.post("/:id/reject", requireOps, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const r = (await client.query(
      `select id, freelancer_user_id as "freelancerId", score_event_id as "scoreEventId"
         from public.public_ratings where id = $1 for update`,
      [req.params.id],
    )).rows[0];
    if (!r) { await client.query("rollback"); return res.status(404).json({ error: "Not found" }); }

    if (r.scoreEventId) {
      await client.query(`update public.score_events set is_voided = true where id = $1`, [r.scoreEventId]);
    }
    await client.query(
      `update public.public_ratings
          set status = 'rejected', reviewed_by = $2, reviewed_at = now(), score_event_id = null
        where id = $1`,
      [r.id, req.user.sub],
    );
    if (r.scoreEventId) await recompute(client, r.freelancerId);
    await client.query("commit");
    res.json({ ok: true });
  } catch (e) {
    await client.query("rollback");
    console.error("rating reject error:", e.message);
    res.status(500).json({ error: "Falha ao rejeitar a avaliação." });
  } finally {
    client.release();
  }
});

export default router;
