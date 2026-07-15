import { Router } from "express";
import { pool, one } from "../db.js";

// Public (UNAUTHENTICATED) per-employee rating via QR (R2 item 5). A customer scans
// the freelancer's QR, lands on /rate/:token and rates 1–5 stars + optional comment.
// Ratings are INFORMATIONAL ONLY — they never touch the freelancer's score. Anti-spam
// (client decision): one rating per device per freelancer per day, enforced by the
// partial unique index idx_public_ratings_daily. This router intentionally does NOT
// use requireAuth, so it must never expose anything beyond the rating surface.
const router = Router();

// Resolve an active freelancer from a public token (or null).
async function freelancerByToken(token) {
  if (!token) return null;
  return one(
    `select u.id as "userId", u.name, p.photo_url as "photoUrl"
       from public.freelancer_profiles p
       join public.users u on u.id = p.user_id
      where p.public_rating_token = $1 and u.status = 'active'`,
    [token],
  );
}

// GET /api/public/ratings/:token — freelancer identity for the rating page.
router.get("/ratings/:token", async (req, res) => {
  try {
    const fr = await freelancerByToken(req.params.token);
    if (!fr) return res.status(404).json({ error: "not_found", message: "Link de avaliação inválido." });
    res.json({ name: fr.name, photoUrl: fr.photoUrl });
  } catch (e) {
    console.error("public rating get error:", e.message);
    res.status(500).json({ error: "Falha ao carregar." });
  }
});

// POST /api/public/ratings/:token { stars, comment?, deviceHash? }
router.post("/ratings/:token", async (req, res) => {
  try {
    const b = req.body || {};
    const stars = Math.round(Number(b.stars));
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: "invalid_stars", message: "Escolha de 1 a 5 estrelas." });
    }
    const fr = await freelancerByToken(req.params.token);
    if (!fr) return res.status(404).json({ error: "not_found", message: "Link de avaliação inválido." });

    const comment = b.comment ? String(b.comment).trim().slice(0, 1000) || null : null;
    const deviceHash = b.deviceHash ? String(b.deviceHash).slice(0, 128) : null;
    try {
      await pool.query(
        `insert into public.public_ratings (freelancer_user_id, stars, comment, device_hash)
         values ($1, $2, $3, $4)`,
        [fr.userId, stars, comment, deviceHash],
      );
    } catch (e) {
      // Daily per-device unique violation → already rated today.
      if (String(e.code) === "23505") {
        return res.status(409).json({ error: "already_rated", message: "Você já avaliou este profissional hoje. Obrigado!" });
      }
      throw e;
    }
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error("public rating post error:", e.message);
    res.status(500).json({ error: "Falha ao enviar avaliação." });
  }
});

export default router;
