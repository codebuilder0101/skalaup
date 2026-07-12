import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";
import { pushPublicKey } from "../push.js";

// Web push subscription management (R13). The public VAPID key is readable
// without auth (the client needs it before subscribing); subscribe/unsubscribe
// require auth and are scoped to the current user.
const router = Router();

router.get("/public-key", (_req, res) => res.json({ key: pushPublicKey }));

router.use(requireAuth);

// POST /api/push/subscribe { subscription } — store a PushSubscription.
router.post("/subscribe", async (req, res) => {
  try {
    const sub = (req.body || {}).subscription;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: "subscription is required" });
    const token = JSON.stringify(sub);
    await pool.query(
      `insert into public.device_tokens (user_id, token, platform, last_seen_at)
       values ($1, $2, 'web', now())
       on conflict (token) do update set user_id = excluded.user_id, last_seen_at = now()`,
      [req.user.sub, token],
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error("push subscribe error:", e.message);
    res.status(500).json({ error: "Falha ao registrar notificações." });
  }
});

// POST /api/push/unsubscribe { endpoint } — remove this device's subscription.
router.post("/unsubscribe", async (req, res) => {
  try {
    const endpoint = (req.body || {}).endpoint;
    if (!endpoint) return res.status(400).json({ error: "endpoint is required" });
    const { rows } = await pool.query(
      `select token from public.device_tokens where user_id = $1 and platform = 'web'`,
      [req.user.sub],
    );
    for (const r of rows) {
      try {
        if (JSON.parse(r.token).endpoint === endpoint) {
          await pool.query(`delete from public.device_tokens where token = $1`, [r.token]);
        }
      } catch { /* skip malformed */ }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("push unsubscribe error:", e.message);
    res.status(500).json({ error: "Falha ao desativar notificações." });
  }
});

export default router;
