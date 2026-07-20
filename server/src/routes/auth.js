import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool, one } from "../db.js";
import { signToken, requireAuth } from "../auth.js";

const router = Router();

const SAFE_USER = `id, name, email, phone, role, status,
  must_change_password as "mustChangePassword",
  visitor_expires_at as "visitorExpiresAt",
  promoted_to_member_at as "promotedToMemberAt",
  created_at as "createdAt", updated_at as "updatedAt"`;

// Nobody picks their own role at sign-up (client 2026-07-20). The role is decided by
// an administrator when they authorize the email (authorized_freelancer_emails.role)
// and is simply applied here — an unlisted email cannot register at all.

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) return res.status(400).json({ error: "Missing credentials" });

  try {
    const row = await one(
      `select id, name, email, role, status, password,
              must_change_password as "mustChangePassword"
         from public.users where lower(email) = $1`,
      [email],
    );
    if (!row) return res.status(401).json({ error: "Invalid credentials" });
    if (row.status === "pending") return res.status(403).json({ error: "auth.pending", code: "pending" });
    if (row.status === "rejected") return res.status(403).json({ error: "auth.rejected", code: "rejected" });
    if (row.status !== "active") return res.status(403).json({ error: "auth.inactive", code: "inactive" });

    // Stored as bcrypt hash; also tolerate a legacy plaintext match for first-run convenience.
    const stored = String(row.password || "");
    const ok = stored.startsWith("$2")
      ? await bcrypt.compare(password, stored)
      : stored === password;
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const user = { id: row.id, name: row.name, email: row.email, role: row.role };
    res.json({ token: signToken(user), user: { ...user, mustChangePassword: !!row.mustChangePassword } });
  } catch (e) {
    // Never let a DB/query error crash the process — return JSON so the client can show a real message.
    console.error("Login error:", e.message);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

// POST /api/auth/change-password — set a new password for the logged-in user and
// clear the "must change" flag (FR-B4). `currentPassword` is verified when sent.
router.post("/change-password", requireAuth, async (req, res) => {
  const next = String(req.body?.newPassword || "");
  if (next.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  const row = await one(`select password from public.users where id = $1`, [req.user.sub]);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (req.body?.currentPassword !== undefined && req.body.currentPassword !== "") {
    const stored = String(row.password || "");
    const ok = stored.startsWith("$2")
      ? await bcrypt.compare(String(req.body.currentPassword), stored)
      : stored === String(req.body.currentPassword);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });
  }
  const hash = await bcrypt.hash(next, 10);
  await pool.query(
    `update public.users set password = $1, must_change_password = false where id = $2`,
    [hash, req.user.sub],
  );
  res.json({ ok: true });
});

// POST /api/auth/register  — public self sign-up, invitation-only.
// The email must have been pre-authorized by an administrator, and THAT record decides
// the role — a `role` sent by the client is ignored (client 2026-07-20). An unlisted
// email is rejected outright.
// Freelancer/visitor: created ACTIVE and auto-logged-in (a token is returned) to go
// straight to completing their ficha in /profile.
// Coordinator / restaurant_manager: created `pending`, no token — an administrator
// still confirms the elevated account in /approvals before it can log in.
router.post("/register", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  // Optional freelancer registration "ficha" fields (kept for backward compat; the
  // simplified sign-up no longer sends them — the freelancer fills the ficha in /profile).
  const phone = req.body?.phone ? String(req.body.phone).trim() : null;
  const cpf = req.body?.cpf ? String(req.body.cpf).trim() : null;
  const pixKey = req.body?.pixKey ? String(req.body.pixKey).trim() : null;
  const whatsapp = req.body?.whatsapp ? String(req.body.whatsapp).trim() : null;
  const homeAddress = req.body?.homeAddress ? String(req.body.homeAddress).trim() : null;
  const homeCep = req.body?.homeCep ? String(req.body.homeCep).trim() : null;

  if (!name || !email || !password) return res.status(400).json({ error: "Missing fields" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  // The allow-list is the single source of truth for BOTH "may they register" and
  // "as what". No entry → no account, whatever role they claim to be.
  const authorized = await one(
    `select id, role, restaurant_ids as "restaurantIds"
       from public.authorized_freelancer_emails where email = $1`,
    [email],
  );
  if (!authorized) return res.status(403).json({ error: "auth.notAuthorized", code: "not_authorized" });

  const role = authorized.role;
  const isTeam = role === "freelancer" || role === "visitor";
  // Elevated roles still pass through /approvals as a second pair of eyes.
  const status = isTeam ? "active" : "pending";

  const hash = await bcrypt.hash(password, 10);
  try {
    const row = await one(
      `insert into public.users (name, email, password, role, status, phone)
       values ($1,$2,$3,$4,$5,$6) returning ${SAFE_USER}`,
      [name, email, hash, role, status, phone],
    );
    if (isTeam) {
      // Seed an (empty-by-default) ficha row so they can complete it in /profile.
      await pool.query(
        `insert into public.freelancer_profiles
           (user_id, member_type, cpf, pix_key, whatsapp, home_address, home_cep)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (user_id) do update set
           cpf = excluded.cpf, pix_key = excluded.pix_key, whatsapp = excluded.whatsapp,
           home_address = excluded.home_address, home_cep = excluded.home_cep`,
        [row.id, role === "visitor" ? "visitor" : "member", cpf, pixKey, whatsapp, homeAddress, homeCep],
      );
    }

    // Apply the restaurant links the administrator already chose in the invitation. Without
    // this an approved manager would land with no restaurant at all (manager_assignments
    // had no write path before) and see an empty app.
    // (A coordinator sees every restaurant, so links are meaningless for that role.)
    const restaurantIds = role === "coordinator"
      ? []
      : [...new Set((authorized.restaurantIds || []).filter(Boolean))];
    if (restaurantIds.length) {
      const table = role === "restaurant_manager"
        ? { name: "manager_assignments", col: "manager_user_id" }
        : { name: "member_clients", col: "member_user_id" };
      await pool.query(
        `insert into public.${table.name} (${table.col}, restaurant_id)
         select $1, unnest($2::uuid[])
         on conflict (${table.col}, restaurant_id) do nothing`,
        [row.id, restaurantIds],
      );
    }

    await pool.query(
      `update public.authorized_freelancer_emails set claimed_at = now() where id = $1`,
      [authorized.id],
    );

    if (isTeam) {
      // Active + authorized → auto-login so they land in the app to finish their ficha.
      const user = { id: row.id, name: row.name, email: row.email, role: row.role };
      return res.status(201).json({ token: signToken(user), user: { ...user, mustChangePassword: false } });
    }
    res.status(201).json({ pending: true, user: row });
  } catch (e) {
    if (String(e.code) === "23505") return res.status(409).json({ error: "Email already exists" });
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/auth/me — update own basic account fields (name, phone).
router.put("/me", requireAuth, async (req, res) => {
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : undefined;
  const phone = req.body?.phone !== undefined ? String(req.body.phone).trim() : undefined;
  const sets = [];
  const vals = [];
  let i = 1;
  if (name !== undefined) { sets.push(`name = $${i++}`); vals.push(name); }
  if (phone !== undefined) { sets.push(`phone = $${i++}`); vals.push(phone || null); }
  if (sets.length === 0) return res.status(400).json({ error: "No fields" });
  vals.push(req.user.sub);
  const row = await one(
    `update public.users set ${sets.join(", ")} where id = $${i} returning ${SAFE_USER}`,
    vals,
  );
  res.json(row);
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  const row = await one(`select ${SAFE_USER} from public.users where id = $1`, [req.user.sub]);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

export default router;
