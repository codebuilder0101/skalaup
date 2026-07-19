import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";

const router = Router();
router.use(requireAuth);
const requireOps = requireRole("coordinator", "administrator");

// A user may access their own record; coordinators/administrators may access anyone's.
function canAccessUser(req) {
  return req.user.role === "coordinator" || req.user.role === "administrator" || req.user.sub === req.params.id;
}

// 8-char readable temporary password for coordinator-created accounts.
const tempPassword = () => crypto.randomBytes(4).toString("hex");

// Replace a member's client (restaurant) links (§3 — gates participation). `ids`
// is an array of restaurant ids; an empty array clears all links.
async function replaceMemberClients(userId, ids) {
  await pool.query(`delete from public.member_clients where member_user_id = $1`, [userId]);
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length) {
    await pool.query(
      `insert into public.member_clients (member_user_id, restaurant_id)
       select $1, unnest($2::uuid[])
       on conflict (member_user_id, restaurant_id) do nothing`,
      [userId, unique],
    );
  }
}

// Returns users with role freelancer/visitor plus their profile, shaped to the
// frontend FreelancerWithProfile type (profile nested or null).
const SELECT = `
  select u.id, u.name, u.email, u.phone, u.role, u.status,
         u.visitor_expires_at as "visitorExpiresAt",
         u.promoted_to_member_at as "promotedToMemberAt",
         u.created_at as "createdAt", u.updated_at as "updatedAt",
         case when p.id is null then null else json_build_object(
           'id', p.id, 'userId', p.user_id, 'memberType', p.member_type,
           'photoUrl', p.photo_url,
           'cpf', p.cpf, 'pixKey', p.pix_key, 'bankName', p.bank_name,
           'birthDate', p.birth_date, 'whatsapp', p.whatsapp,
           'homeAddress', p.home_address, 'homeCep', p.home_cep,
           'homeLatitude', p.home_latitude, 'homeLongitude', p.home_longitude,
           'transport', p.transport, 'experience', p.experience,
           'hireDate', p.hire_date, 'currentScore', p.current_score,
           'currentLevel', p.current_level, 'notes', p.notes,
           'publicRatingToken', p.public_rating_token,
           'createdAt', p.created_at, 'updatedAt', p.updated_at
         ) end as profile,
         coalesce((
           select json_agg(json_build_object('id', r.id, 'name', r.name) order by r.name)
             from public.member_clients mc
             join public.restaurants r on r.id = mc.restaurant_id
            where mc.member_user_id = u.id
         ), '[]'::json) as clients
  from public.users u
  left join public.freelancer_profiles p on p.user_id = u.id`;

// --- Freelancer self-registration allow-list (client 2026-07-19) ---
// An admin/coordinator pre-registers a freelancer's email here; the freelancer then
// self-registers with that email on the public /register page (auth.js). These routes
// MUST stay above the "/:id" routes so "authorized-emails" is not read as an id.
router.get("/authorized-emails", requireOps, async (_req, res) => {
  const { rows } = await pool.query(
    `select a.id, a.email, a.created_at as "createdAt", a.claimed_at as "claimedAt",
            u.id as "userId", u.name as "userName", u.status as "userStatus"
       from public.authorized_freelancer_emails a
       left join public.users u on lower(u.email) = a.email
      order by a.created_at desc`,
  );
  res.json(rows);
});

router.post("/authorized-emails", requireOps, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "E-mail inválido." });
  }
  try {
    const row = await one(
      `insert into public.authorized_freelancer_emails (email, created_by)
       values ($1, $2)
       returning id, email, created_at as "createdAt", claimed_at as "claimedAt"`,
      [email, req.user.sub],
    );
    res.status(201).json(row);
  } catch (e) {
    if (String(e.code) === "23505") return res.status(409).json({ error: "Este e-mail já está na lista." });
    res.status(500).json({ error: e.message });
  }
});

router.delete("/authorized-emails/:id", requireOps, async (req, res) => {
  await pool.query(`delete from public.authorized_freelancer_emails where id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// Roster — coordinator or administrator (§2.4).
router.get("/", requireRole("coordinator", "administrator"), async (_req, res) => {
  const { rows } = await pool.query(
    `${SELECT} where u.role in ('freelancer','visitor') order by u.name asc`,
  );
  res.json(rows);
});

router.get("/:id", async (req, res) => {
  if (!canAccessUser(req)) return res.status(403).json({ error: "Forbidden" });
  const row = await one(`${SELECT} where u.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Create a freelancer (or visitor) — coordinator/administrator only. Creates the
// user account + profile "ficha" in one step. A temporary password is generated
// and returned once so the coordinator can share it (login is by email).
router.post("/", requireOps, async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  if (!name || !email) return res.status(400).json({ error: "Name and email are required" });
  const role = b.role === "visitor" ? "visitor" : "freelancer";
  const password = b.password ? String(b.password) : tempPassword();
  const hash = await bcrypt.hash(password, 10);
  // Auto-generated temp passwords must be changed on first login (FR-B4).
  const mustChange = !b.password;
  try {
    const u = await one(
      `insert into public.users (name, email, password, role, status, phone, must_change_password)
       values ($1,$2,$3,$4,'active',$5,$6) returning id`,
      [name, email, hash, role, b.phone ? String(b.phone).trim() : null, mustChange],
    );
    await pool.query(
      `insert into public.freelancer_profiles
         (user_id, member_type, cpf, pix_key, bank_name, birth_date, whatsapp, home_address, home_cep)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (user_id) do update set
         cpf = excluded.cpf, pix_key = excluded.pix_key, bank_name = excluded.bank_name,
         birth_date = excluded.birth_date, whatsapp = excluded.whatsapp,
         home_address = excluded.home_address, home_cep = excluded.home_cep`,
      [u.id, role === "visitor" ? "visitor" : "member",
       b.cpf ?? null, b.pixKey ?? null, b.bankName ?? null, b.birthDate ?? null,
       b.whatsapp ?? null, b.homeAddress ?? null, b.homeCep ?? null],
    );
    // Link the member to the selected clients (§3) — gates their participation.
    if (Array.isArray(b.restaurantIds)) await replaceMemberClients(u.id, b.restaurantIds);
    const row = await one(`${SELECT} where u.id = $1`, [u.id]);
    res.status(201).json({ ...row, tempPassword: b.password ? undefined : password });
  } catch (e) {
    if (String(e.code) === "23505") return res.status(409).json({ error: "Email already exists" });
    res.status(500).json({ error: e.message });
  }
});

// Update a freelancer's account name/phone + profile ficha in one call.
router.put("/:id", async (req, res) => {
  if (!canAccessUser(req)) return res.status(403).json({ error: "Forbidden" });
  const b = req.body || {};

  const uSets = [];
  const uVals = [];
  let i = 1;
  if (b.name !== undefined) { uSets.push(`name = $${i++}`); uVals.push(String(b.name).trim()); }
  if (b.phone !== undefined) { uSets.push(`phone = $${i++}`); uVals.push(b.phone ? String(b.phone).trim() : null); }
  if (uSets.length) {
    uVals.push(req.params.id);
    await pool.query(`update public.users set ${uSets.join(", ")} where id = $${i}`, uVals);
  }

  // Only touch the profile when at least one ficha field is present (avoid wiping).
  const profileKeys = ["cpf", "pixKey", "bankName", "birthDate", "whatsapp", "homeAddress", "homeCep"];
  if (profileKeys.some((k) => k in b)) {
    await pool.query(
      `insert into public.freelancer_profiles
         (user_id, member_type, cpf, pix_key, bank_name, birth_date, whatsapp, home_address, home_cep)
       values ($1,
               coalesce((select member_type from public.freelancer_profiles where user_id = $1), 'member'),
               $2,$3,$4,$5,$6,$7,$8)
       on conflict (user_id) do update set
         cpf = excluded.cpf, pix_key = excluded.pix_key, bank_name = excluded.bank_name,
         birth_date = excluded.birth_date, whatsapp = excluded.whatsapp,
         home_address = excluded.home_address, home_cep = excluded.home_cep`,
      [req.params.id, b.cpf ?? null, b.pixKey ?? null, b.bankName ?? null, b.birthDate ?? null,
       b.whatsapp ?? null, b.homeAddress ?? null, b.homeCep ?? null],
    );
  }

  // Replace client links only when the field is sent (avoid clearing on partial edits).
  if (Array.isArray(b.restaurantIds)) await replaceMemberClients(req.params.id, b.restaurantIds);

  const row = await one(`${SELECT} where u.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// GET /:id/ratings — public (QR) rating summary for a freelancer (R2 item 5).
// Informational only (never affects the score). Own profile or coordinator.
router.get("/:id/ratings", async (req, res) => {
  if (!canAccessUser(req)) return res.status(403).json({ error: "Forbidden" });
  try {
    const summary = await one(
      `select count(*)::int as count,
              coalesce(round(avg(stars)::numeric, 2), 0)::float8 as average
         from public.public_ratings where freelancer_user_id = $1`,
      [req.params.id],
    );
    const { rows: recent } = await pool.query(
      `select id, stars, comment, created_at as "createdAt"
         from public.public_ratings where freelancer_user_id = $1
        order by created_at desc limit 20`,
      [req.params.id],
    );
    res.json({ count: summary.count, average: summary.average, recent });
  } catch (e) {
    console.error("freelancer ratings error:", e.message);
    res.status(500).json({ error: "Falha ao carregar avaliações." });
  }
});

// PUT /:id/status { status } — coordinator activates/deactivates a freelancer.
// Reactivation path for auto-inactivated profiles (R2 item 7).
router.put("/:id/status", requireOps, async (req, res) => {
  const status = (req.body || {}).status;
  if (!["active", "inactive"].includes(status)) {
    return res.status(400).json({ error: "status must be 'active' or 'inactive'" });
  }
  await pool.query(
    `update public.users set status = $2 where id = $1 and role in ('freelancer','visitor')`,
    [req.params.id, status],
  );
  const row = await one(`${SELECT} where u.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Delete a freelancer/visitor (cascades to the profile) — coordinator only.
router.delete("/:id", requireOps, async (req, res) => {
  try {
    await pool.query(
      `delete from public.users where id = $1 and role in ('freelancer','visitor')`,
      [req.params.id],
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Upsert the profile "ficha" — own profile or coordinator.
router.put("/:id/profile", async (req, res) => {
  if (!canAccessUser(req)) return res.status(403).json({ error: "Forbidden" });
  const b = req.body || {};
  const row = await one(
    `insert into public.freelancer_profiles
       (user_id, member_type, photo_url, cpf, pix_key, bank_name, birth_date, whatsapp,
        home_address, home_cep, home_latitude, home_longitude,
        transport, experience, hire_date, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (user_id) do update set
       member_type = excluded.member_type, photo_url = excluded.photo_url,
       cpf = excluded.cpf, pix_key = excluded.pix_key, bank_name = excluded.bank_name,
       birth_date = excluded.birth_date, whatsapp = excluded.whatsapp,
       home_address = excluded.home_address, home_cep = excluded.home_cep,
       home_latitude = excluded.home_latitude, home_longitude = excluded.home_longitude,
       transport = excluded.transport, experience = excluded.experience,
       hire_date = excluded.hire_date, notes = excluded.notes
     returning id`,
    [
      req.params.id, b.memberType ?? "member", b.photoUrl ?? null,
      b.cpf ?? null, b.pixKey ?? null, b.bankName ?? null, b.birthDate ?? null, b.whatsapp ?? null,
      b.homeAddress ?? null, b.homeCep ?? null, b.homeLatitude ?? null, b.homeLongitude ?? null,
      b.transport ?? null, b.experience ?? null, b.hireDate ?? null, b.notes ?? null,
    ],
  );
  res.json(row);
});

export default router;
