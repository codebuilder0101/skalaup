import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";

const router = Router();
router.use(requireAuth, requireRole("administrator")); // user approvals are administrator-only

const COLS = `id, name, email, phone, role, status,
  created_at as "createdAt", updated_at as "updatedAt"`;

// GET /api/users?status=pending  (status optional: pending|active|rejected|inactive|all)
router.get("/", async (req, res) => {
  const status = String(req.query.status || "all");
  if (status === "all") {
    const { rows } = await pool.query(`select ${COLS} from public.users order by created_at desc`);
    return res.json(rows);
  }
  const { rows } = await pool.query(
    `select ${COLS} from public.users where status = $1 order by created_at desc`, [status],
  );
  res.json(rows);
});

// GET /api/users/pending/count  — handy badge counter
router.get("/pending/count", async (_req, res) => {
  const row = await one(`select count(*)::int as count from public.users where status = 'pending'`);
  res.json({ count: row.count });
});

async function setStatus(req, res, status) {
  const row = await one(
    `update public.users set status = $1 where id = $2 returning ${COLS}`,
    [status, req.params.id],
  );
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
}

// PUT /api/users/:id/approve  → status active
router.put("/:id/approve", (req, res) => setStatus(req, res, "active"));
// PUT /api/users/:id/reject   → status rejected
router.put("/:id/reject", (req, res) => setStatus(req, res, "rejected"));

export default router;
