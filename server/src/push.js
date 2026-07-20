import webpush from "web-push";
import { pool } from "./db.js";

// Web push (R13). VAPID keys come from env; if absent, push is silently disabled
// so the app keeps working (in-app notifications are unaffected).
const PUB = process.env.VAPID_PUBLIC_KEY;
const PRIV = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@skalaup.com.br";

let configured = false;
if (PUB && PRIV) {
  try {
    webpush.setVapidDetails(SUBJECT, PUB, PRIV);
    configured = true;
  } catch (e) {
    console.warn("Web push disabled — invalid VAPID config:", e.message);
  }
} else {
  console.warn("Web push disabled — VAPID keys not set.");
}

export const pushPublicKey = configured ? PUB : null;

// Send a push to all of a user's web subscriptions. Best-effort; prunes dead subs
// (404/410 = subscription gone; 403 = VAPID mismatch, e.g. keys rotated — the sub
// can't be delivered to with the current keys, so drop it and let the user re-enable).
// Never throws to the caller.
export async function sendPush(userId, payload) {
  if (!configured) return;
  try {
    const { rows } = await pool.query(
      `select token from public.device_tokens where user_id = $1 and platform = 'web'`,
      [userId],
    );
    const body = JSON.stringify(payload);
    await Promise.all(rows.map(async ({ token }) => {
      let sub;
      try { sub = JSON.parse(token); } catch { return; }
      try {
        await webpush.sendNotification(sub, body);
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410 || e.statusCode === 403) {
          await pool.query(`delete from public.device_tokens where token = $1`, [token]).catch(() => {});
        } else {
          console.error("push send failed:", e.statusCode, e.message);
        }
      }
    }));
  } catch (e) {
    console.error("sendPush error:", e.message);
  }
}
