// Notification helper — writes rows into public.notifications so the SkalaUp
// notification system keeps working (the in-app Notifications *tab* is hidden in
// the UI, but the feature stays live; push delivery — §11/§14 — consumes these).
//
// Every insert is best-effort: a notification failure must never break the
// business action that triggered it, so callers `await notify(...)` inside a
// try/catch-free path and we swallow errors here.
import { pool } from "./db.js";

/**
 * Insert one notification. Returns the row id, or null on failure.
 * @param {{recipientUserId: string, type: string, title: string, body?: string, data?: object}} n
 */
export async function notify({ recipientUserId, type, title, body = null, data = {} }) {
  try {
    const { rows } = await pool.query(
      `insert into public.notifications (recipient_user_id, type, title, body, data, sent_at)
       values ($1, $2, $3, $4, $5::jsonb, now()) returning id`,
      [recipientUserId, type, title, body, JSON.stringify(data ?? {})],
    );
    return rows[0]?.id ?? null;
  } catch (e) {
    console.error(`notify(${type}) failed:`, e.message);
    return null;
  }
}

/** Fan-out the same notification to many recipients (e.g. schedule published). */
export async function notifyMany(recipientUserIds, build) {
  const ids = [...new Set(recipientUserIds)].filter(Boolean);
  await Promise.all(ids.map((uid) => notify({ recipientUserId: uid, ...build(uid) })));
  return ids.length;
}

/** All coordinators + administrators — the recipients for coordinator-facing alerts. */
export async function coordinatorIds() {
  const { rows } = await pool.query(
    `select id from public.users where role in ('coordinator','administrator') and status = 'active'`,
  );
  return rows.map((r) => r.id);
}
