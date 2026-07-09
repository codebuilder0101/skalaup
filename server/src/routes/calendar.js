import { Router } from "express";
import crypto from "node:crypto";
import { pool, one } from "../db.js";
import { requireAuth } from "../auth.js";
import { buildCalendar } from "../ics.js";

// Google Calendar export (spec §2.1, §14). A freelancer generates a personal,
// unguessable subscription URL; calendar clients re-poll it, so published-schedule
// changes auto-sync. The feed route is PUBLIC (calendar apps cannot send a JWT) —
// security relies on the high-entropy token plus the `revoked` flag.
const router = Router();

// Rolling window served by the feed: keeps it small while covering the useful range.
const WINDOW_PAST_DAYS = 31;
const WINDOW_FUTURE_DAYS = 92;

// Only freelancers/visitors own a personal schedule to export.
function canExport(role) {
  return role === "freelancer" || role === "visitor";
}

// Absolute base for generated links: PUBLIC_API_URL (prod) or derived from the request.
function publicApiBase(req) {
  const env = process.env.PUBLIC_API_URL;
  if (env) return env.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.get("host");
  return `${proto}://${host}/api`;
}

function feedUrl(req, token) {
  return `${publicApiBase(req)}/calendar/feed/${token}.ics`;
}

const SHIFT_LABEL = { lunch: "Almoço", dinner: "Janta" };

// ---------------------------------------------------------------------------
// PUBLIC — declared before requireAuth so the feed is reachable without a token.
// GET /api/calendar/feed/:token.ics
// ---------------------------------------------------------------------------
router.get("/feed/:token.ics", async (req, res) => {
  try {
    const { token } = req.params;
    const tok = await one(
      `select user_id as "userId" from public.calendar_export_tokens
        where token = $1 and revoked = false`,
      [token],
    );
    if (!tok) return res.status(404).type("text/plain").send("Not found");

    const { rows } = await pool.query(
      `select a.id, a.date::text as date,
              to_char(a.start_time, 'HH24:MI') as "startTime",
              to_char(a.end_time, 'HH24:MI')   as "endTime",
              a.shift_type as "shiftType", a.status,
              a.is_weekend_mandatory as "isWeekendMandatory",
              r.name as "restaurantName", r.address as "restaurantAddress",
              r.cep as "restaurantCep"
         from public.schedule_assignments a
         join public.restaurants r on r.id = a.restaurant_id
        where a.user_id = $1
          and a.status in ('published', 'cancelled')
          and a.date between (current_date - ($2 || ' days')::interval)
                         and (current_date + ($3 || ' days')::interval)
        order by a.date, a.start_time`,
      [tok.userId, WINDOW_PAST_DAYS, WINDOW_FUTURE_DAYS],
    );

    const events = rows.map((r) => {
      const shift = SHIFT_LABEL[r.shiftType] || r.shiftType;
      const locationParts = [r.restaurantName, r.restaurantAddress, r.restaurantCep].filter(Boolean);
      const descParts = [`Turno: ${shift}`];
      if (r.isWeekendMandatory) descParts.push("Turno de bônus de fim de semana");
      descParts.push("Check-in abre 15 min antes do início.");
      return {
        uid: `${r.id}@skalaup`,
        date: r.date,
        startTime: r.startTime,
        endTime: r.endTime,
        summary: `Turno ${shift} — ${r.restaurantName}`,
        location: locationParts.join(", "),
        description: descParts.join(" "),
        cancelled: r.status === "cancelled",
      };
    });

    const ics = buildCalendar({ calName: "Escala SkalaUp", now: new Date(), events });
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", 'inline; filename="skalaup.ics"');
    res.set("Cache-Control", "private, max-age=0, no-cache");
    return res.send(ics);
  } catch (e) {
    console.error("calendar feed failed:", e.message);
    return res.status(500).type("text/plain").send("Internal error");
  }
});

// ---------------------------------------------------------------------------
// Everything below requires authentication.
// ---------------------------------------------------------------------------
router.use(requireAuth);

// GET /api/calendar/token — current active link (or { url: null }).
router.get("/token", async (req, res) => {
  if (!canExport(req.user.role)) return res.status(403).json({ error: "Forbidden" });
  const tok = await one(
    `select token from public.calendar_export_tokens
      where user_id = $1 and revoked = false
      order by created_at desc limit 1`,
    [req.user.sub],
  );
  res.json({ url: tok ? feedUrl(req, tok.token) : null });
});

// POST /api/calendar/token — generate (or regenerate, revoking the old) token.
router.post("/token", async (req, res) => {
  if (!canExport(req.user.role)) return res.status(403).json({ error: "Forbidden" });
  const userId = req.user.sub;
  await pool.query(
    `update public.calendar_export_tokens set revoked = true
      where user_id = $1 and revoked = false`,
    [userId],
  );
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `insert into public.calendar_export_tokens (user_id, token) values ($1, $2)`,
    [userId, token],
  );
  res.json({ url: feedUrl(req, token) });
});

// DELETE /api/calendar/token — revoke the active token (link stops working).
router.delete("/token", async (req, res) => {
  if (!canExport(req.user.role)) return res.status(403).json({ error: "Forbidden" });
  await pool.query(
    `update public.calendar_export_tokens set revoked = true
      where user_id = $1 and revoked = false`,
    [req.user.sub],
  );
  res.json({ ok: true });
});

export default router;
