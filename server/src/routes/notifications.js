// Notification center (§11/§14). Rows are written by notify.js at many call
// sites (feedback, swaps, vacancies, scheduler…); this router exposes them so
// the bell and the /notifications page can read + mark them read. All routes
// are scoped to the authenticated recipient — a user only ever sees/updates
// their own notifications.
import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth } from "../auth.js";

const router = Router();
router.use(requireAuth);

async function unreadCount(userId) {
  const row = await one(
    `select count(*)::int as n from public.notifications
      where recipient_user_id = $1 and read_at is null`,
    [userId],
  );
  return row?.n ?? 0;
}

// GET /api/notifications?limit= → { items, unreadCount }
router.get("/", async (req, res) => {
  try {
    const me = req.user.sub;
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const { rows: items } = await pool.query(
      `select id, type, title, body, data,
              read_at as "readAt", created_at as "createdAt"
         from public.notifications
        where recipient_user_id = $1
        order by created_at desc
        limit $2`,
      [me, limit],
    );
    res.json({ items, unreadCount: await unreadCount(me) });
  } catch (e) {
    console.error("notifications list error:", e.message);
    res.status(500).json({ error: "Falha ao carregar notificações." });
  }
});

// GET /api/notifications/unread-count → { unreadCount }  (cheap polling endpoint)
router.get("/unread-count", async (req, res) => {
  try {
    res.json({ unreadCount: await unreadCount(req.user.sub) });
  } catch (e) {
    console.error("notifications count error:", e.message);
    res.status(500).json({ error: "Falha ao carregar notificações." });
  }
});

// POST /api/notifications/read-all → mark every unread notification as read
router.post("/read-all", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `update public.notifications set read_at = now()
        where recipient_user_id = $1 and read_at is null`,
      [req.user.sub],
    );
    res.json({ ok: true, updated: rowCount, unreadCount: 0 });
  } catch (e) {
    console.error("notifications read-all error:", e.message);
    res.status(500).json({ error: "Falha ao atualizar notificações." });
  }
});

// POST /api/notifications/:id/read → mark one as read (own only, idempotent)
router.post("/:id/read", async (req, res) => {
  try {
    const me = req.user.sub;
    const { rowCount } = await pool.query(
      `update public.notifications set read_at = now()
        where id = $1 and recipient_user_id = $2 and read_at is null`,
      [req.params.id, me],
    );
    res.json({ ok: true, updated: rowCount, unreadCount: await unreadCount(me) });
  } catch (e) {
    // A malformed UUID would throw here; treat as "nothing to update" rather than 500.
    if (/invalid input syntax for type uuid/i.test(e.message)) {
      return res.status(400).json({ error: "Notificação inválida." });
    }
    console.error("notification read error:", e.message);
    res.status(500).json({ error: "Falha ao atualizar notificação." });
  }
});

export default router;
