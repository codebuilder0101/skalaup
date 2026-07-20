import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";

const router = Router();
router.use(requireAuth);
// Reads are open to any authenticated user; writes are coordinator/administrator only.
const requireOps = requireRole("coordinator", "administrator");

const SCALAR_COLS = `id, name, address, cep, cnpj, latitude, longitude,
  geofence_radius_m as "geofenceRadiusM", timezone,
  base_pay_per_shift as "basePayPerShift", bonus_pay_per_shift as "bonusPayPerShift",
  base_pay_lunch as "basePayLunch", bonus_pay_lunch as "bonusPayLunch",
  base_pay_dinner as "basePayDinner", bonus_pay_dinner as "bonusPayDinner",
  late_discount_amount as "lateDiscountAmount", no_show_discount_mode as "noShowDiscountMode",
  no_show_custom_amount as "noShowCustomAmount", weekend_bonus_enabled as "weekendBonusEnabled",
  active, created_at as "createdAt", updated_at as "updatedAt"`;

const SHIFT_TYPES = ["lunch", "dinner"];
const NO_SHOW_MODES = ["highest_shift", "base_shift", "custom"];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:MM, 24h
const NUM_KEYS = ["basePayPerShift", "bonusPayPerShift", "lateDiscountAmount", "noShowCustomAmount",
  "basePayLunch", "bonusPayLunch", "basePayDinner", "bonusPayDinner"];

// Load shift templates for a set of restaurants, grouped by restaurant id.
// `q` is a pg client or the pool (both expose .query).
async function templatesFor(q, restaurantIds) {
  if (!restaurantIds.length) return {};
  const { rows } = await q.query(
    `select restaurant_id as "restaurantId", shift_type as "shiftType", label,
       to_char(start_time, 'HH24:MI') as "startTime",
       to_char(end_time, 'HH24:MI') as "endTime"
     from public.shift_templates
     where restaurant_id = any($1::uuid[])
     order by shift_type asc, start_time asc`,
    [restaurantIds],
  );
  const map = {};
  for (const r of rows) {
    (map[r.restaurantId] ||= []).push({ shiftType: r.shiftType, label: r.label, startTime: r.startTime, endTime: r.endTime });
  }
  return map;
}

// Load linked member (freelancer/visitor) ids per restaurant, grouped by id.
async function membersFor(q, restaurantIds) {
  if (!restaurantIds.length) return {};
  const { rows } = await q.query(
    `select restaurant_id as "restaurantId", member_user_id as "memberUserId"
       from public.member_clients where restaurant_id = any($1::uuid[])`,
    [restaurantIds],
  );
  const map = {};
  for (const r of rows) (map[r.restaurantId] ||= []).push(r.memberUserId);
  return map;
}

async function withTemplates(q, rows) {
  const ids = rows.map((r) => r.id);
  const [tpl, mem] = await Promise.all([templatesFor(q, ids), membersFor(q, ids)]);
  return rows.map((r) => ({ ...r, shiftTemplates: tpl[r.id] || [], memberUserIds: mem[r.id] || [] }));
}

// Replace the full set of linked members for a restaurant (mirror of the
// freelancer-side replaceMemberClients). Lets a coordinator link collaborators
// straight from the restaurant form so new restaurants show up on their
// "Minha Disponibilidade" without editing each freelancer.
async function replaceRestaurantMembers(client, restaurantId, userIds) {
  await client.query(`delete from public.member_clients where restaurant_id = $1`, [restaurantId]);
  const unique = [...new Set((userIds || []).filter(Boolean))];
  if (unique.length) {
    await client.query(
      `insert into public.member_clients (member_user_id, restaurant_id)
       select unnest($2::uuid[]), $1
       on conflict (member_user_id, restaurant_id) do nothing`,
      [restaurantId, unique],
    );
  }
}

// Empty string from a form means "clear / inherit global" → null.
function normalize(b) {
  for (const k of NUM_KEYS) if (b[k] === "") b[k] = null;
  if (b.noShowDiscountMode === "") b.noShowDiscountMode = null;
}

// Returns an error string, or null when the (possibly partial) payload is valid.
function validateConfig(b) {
  for (const k of NUM_KEYS) {
    if (b[k] === undefined || b[k] === null) continue;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < 0) return `Invalid amount for ${k}`;
  }
  if (b.noShowDiscountMode != null && !NO_SHOW_MODES.includes(b.noShowDiscountMode)) {
    return "Invalid no-show discount mode";
  }
  if (b.weekendBonusEnabled != null && typeof b.weekendBonusEnabled !== "boolean") {
    return "Invalid weekend bonus flag";
  }
  if (b.noShowDiscountMode === "custom") {
    const n = Number(b.noShowCustomAmount);
    if (b.noShowCustomAmount == null || !Number.isFinite(n) || n < 0) {
      return "Custom no-show amount is required when mode is 'custom'";
    }
  }
  if (b.shiftTemplates !== undefined) {
    if (!Array.isArray(b.shiftTemplates)) return "shiftTemplates must be an array";
    const byType = { lunch: [], dinner: [] };
    for (const t of b.shiftTemplates) {
      if (!t || !SHIFT_TYPES.includes(t.shiftType)) return "Invalid shift type";
      if (!TIME_RE.test(t.startTime || "") || !TIME_RE.test(t.endTime || "")) return "Invalid shift time (expected HH:MM)";
      if (t.endTime <= t.startTime) return "Shift end time must be after start time";
      byType[t.shiftType].push(t);
    }
    // Multiple staggered slots per meal period are allowed and MAY overlap
    // (e.g. 12:00–16:00 and 13:00–17:00). Only exact duplicates are rejected.
    for (const type of SHIFT_TYPES) {
      const seen = new Set();
      for (const s of byType[type]) {
        const key = `${s.startTime}-${s.endTime}`;
        if (seen.has(key)) return "Duplicate shift times within the same period";
        seen.add(key);
      }
    }
  }
  return null;
}

// Replace the full set of shift templates for a restaurant inside a transaction.
async function replaceTemplates(client, restaurantId, templates) {
  await client.query(`delete from public.shift_templates where restaurant_id = $1`, [restaurantId]);
  for (const t of templates) {
    await client.query(
      `insert into public.shift_templates (restaurant_id, shift_type, label, start_time, end_time)
       values ($1, $2, $3, $4, $5)`,
      [restaurantId, t.shiftType, (t.label && String(t.label).trim()) || null, t.startTime, t.endTime],
    );
  }
}

// GET /api/restaurants?activeOnly=1
// Members (freelancer/visitor) only see the clients they're linked to (§3 — gates
// participation); ops/managers see all.
router.get("/", async (req, res) => {
  const activeOnly = req.query.activeOnly === "1" || req.query.activeOnly === "true";
  const isMember = req.user.role === "freelancer" || req.user.role === "visitor";
  const conds = [];
  const vals = [];
  let i = 1;
  if (activeOnly) conds.push("active = true");
  if (isMember) {
    conds.push(`id in (select restaurant_id from public.member_clients where member_user_id = $${i++})`);
    vals.push(req.user.sub);
  }
  const where = conds.length ? `where ${conds.join(" and ")}` : "";
  const { rows } = await pool.query(
    `select ${SCALAR_COLS} from public.restaurants ${where} order by name asc`,
    vals,
  );
  res.json(await withTemplates(pool, rows));
});

router.get("/:id", async (req, res) => {
  const row = await one(`select ${SCALAR_COLS} from public.restaurants where id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json((await withTemplates(pool, [row]))[0]);
});

router.post("/", requireOps, async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "Name required" });
  normalize(b);
  const err = validateConfig(b);
  if (err) return res.status(400).json({ error: err });

  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `insert into public.restaurants
        (name, address, cep, cnpj, latitude, longitude, geofence_radius_m, timezone,
         base_pay_per_shift, bonus_pay_per_shift, late_discount_amount, no_show_discount_mode,
         no_show_custom_amount, weekend_bonus_enabled, active,
         base_pay_lunch, bonus_pay_lunch, base_pay_dinner, bonus_pay_dinner)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning ${SCALAR_COLS}`,
      [
        b.name, b.address ?? null, b.cep ?? null, b.cnpj ?? null,
        b.latitude ?? null, b.longitude ?? null,
        b.geofenceRadiusM ?? 150, b.timezone ?? "America/Sao_Paulo",
        b.basePayPerShift ?? null, b.bonusPayPerShift ?? null,
        b.lateDiscountAmount ?? null, b.noShowDiscountMode ?? null,
        b.noShowCustomAmount ?? null, b.weekendBonusEnabled ?? null, b.active ?? true,
        b.basePayLunch ?? null, b.bonusPayLunch ?? null,
        b.basePayDinner ?? null, b.bonusPayDinner ?? null,
      ],
    );
    const row = rows[0];
    if (Array.isArray(b.shiftTemplates)) await replaceTemplates(client, row.id, b.shiftTemplates);
    if (Array.isArray(b.memberUserIds)) await replaceRestaurantMembers(client, row.id, b.memberUserIds);
    await client.query("commit");
    res.status(201).json((await withTemplates(pool, [row]))[0]);
  } catch (e) {
    await client.query("rollback");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.put("/:id", requireOps, async (req, res) => {
  const b = req.body || {};
  normalize(b);
  const err = validateConfig(b);
  if (err) return res.status(400).json({ error: err });

  const map = {
    name: "name", address: "address", cep: "cep", cnpj: "cnpj",
    latitude: "latitude", longitude: "longitude",
    geofenceRadiusM: "geofence_radius_m", timezone: "timezone",
    basePayPerShift: "base_pay_per_shift", bonusPayPerShift: "bonus_pay_per_shift",
    basePayLunch: "base_pay_lunch", bonusPayLunch: "bonus_pay_lunch",
    basePayDinner: "base_pay_dinner", bonusPayDinner: "bonus_pay_dinner",
    lateDiscountAmount: "late_discount_amount", noShowDiscountMode: "no_show_discount_mode",
    noShowCustomAmount: "no_show_custom_amount", weekendBonusEnabled: "weekend_bonus_enabled",
    active: "active",
  };
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [k, col] of Object.entries(map)) {
    if (b[k] !== undefined) { sets.push(`${col} = $${i++}`); vals.push(b[k]); }
  }
  const touchesTemplates = Array.isArray(b.shiftTemplates);
  const touchesMembers = Array.isArray(b.memberUserIds);
  if (sets.length === 0 && !touchesTemplates && !touchesMembers) return res.status(400).json({ error: "No fields" });

  const client = await pool.connect();
  try {
    await client.query("begin");
    let row;
    if (sets.length > 0) {
      const r = await client.query(
        `update public.restaurants set ${sets.join(", ")} where id = $${i} returning ${SCALAR_COLS}`,
        [...vals, req.params.id],
      );
      row = r.rows[0];
    } else {
      row = await one(`select ${SCALAR_COLS} from public.restaurants where id = $1`, [req.params.id]);
    }
    if (!row) { await client.query("rollback"); return res.status(404).json({ error: "Not found" }); }
    if (touchesTemplates) await replaceTemplates(client, req.params.id, b.shiftTemplates);
    if (Array.isArray(b.memberUserIds)) await replaceRestaurantMembers(client, req.params.id, b.memberUserIds);
    await client.query("commit");
    res.json((await withTemplates(pool, [row]))[0]);
  } catch (e) {
    await client.query("rollback");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Hard-delete a restaurant. Every table that references restaurants cascades or
// nulls on delete EXCEPT schedule_assignments, whose FK is `on delete restrict`
// (schema §schedule_assignments) — that guard is what blocks a plain delete. We
// remove those assignments first inside a transaction; their own children
// (shift_attendance, absences, swaps) cascade, and payroll_entries keep their
// history with restaurant_id set to null. Then the restaurant delete succeeds and
// the remaining cascade FKs clean up the rest.
router.delete("/:id", requireOps, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`delete from public.schedule_assignments where restaurant_id = $1`, [req.params.id]);
    const { rowCount } = await client.query(`delete from public.restaurants where id = $1`, [req.params.id]);
    await client.query("commit");
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    await client.query("rollback");
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

export default router;
