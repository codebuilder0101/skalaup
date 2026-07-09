import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { ensurePayrollPeriod } from "../payroll.js";
import { generateMonthPay, getMonthReport, normalizeMonthRef } from "../payrollReport.js";

// Financial module (§8, §12) — monthly payroll close & report. Coordinator/admin only.
const router = Router();
router.use(requireAuth);
const requireOps = requireRole("coordinator", "administrator");
router.use(requireOps);

// Read the report for a month; refresh the pay lines first when the period is open.
async function buildReport(monthRefRaw) {
  const monthRef = normalizeMonthRef(monthRefRaw);
  if (!monthRef) return null;
  await generateMonthPay(monthRef); // no-op when the period is closed (frozen)
  return getMonthReport(monthRef);
}

// GET /api/payroll/periods — list every payroll period (most recent first).
router.get("/periods", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select p.reference_month::text as "referenceMonth", p.status,
              p.closed_at as "closedAt", u.name as "closedByName"
         from public.payroll_periods p
         left join public.users u on u.id = p.closed_by
        order by p.reference_month desc`,
    );
    res.json(rows);
  } catch (e) {
    console.error("Payroll periods error:", e.message);
    res.status(500).json({ error: "Falha ao carregar períodos." });
  }
});

// GET /api/payroll/summary?month=YYYY-MM — the monthly report (auto-refreshed if open).
router.get("/summary", async (req, res) => {
  try {
    const report = await buildReport(req.query.month);
    if (!report) return res.status(400).json({ error: "Informe um mês válido (YYYY-MM)." });
    res.json(report);
  } catch (e) {
    console.error("Payroll summary error:", e.message);
    res.status(500).json({ error: "Falha ao calcular a folha." });
  }
});

// POST /api/payroll/recompute { month } — force a recomputation (open periods only).
router.post("/recompute", async (req, res) => {
  try {
    const report = await buildReport((req.body || {}).month);
    if (!report) return res.status(400).json({ error: "Informe um mês válido (YYYY-MM)." });
    res.json(report);
  } catch (e) {
    console.error("Payroll recompute error:", e.message);
    res.status(500).json({ error: "Falha ao recalcular a folha." });
  }
});

// POST /api/payroll/close { month } — freeze the folha for the month (§13).
router.post("/close", async (req, res) => {
  try {
    const monthRef = normalizeMonthRef((req.body || {}).month);
    if (!monthRef) return res.status(400).json({ error: "Informe um mês válido (YYYY-MM)." });

    await generateMonthPay(monthRef); // final snapshot before freezing
    const period = await one(
      `update public.payroll_periods
          set status = 'closed', closed_at = now(), closed_by = $2
        where reference_month = $1 and status = 'open'
        returning id`,
      [monthRef, req.user.sub],
    );
    if (!period) {
      const cur = await one(`select status from public.payroll_periods where reference_month = $1`, [monthRef]);
      if (cur?.status === "closed") return res.status(409).json({ message: "A folha deste mês já está fechada." });
    }
    res.json(await getMonthReport(monthRef));
  } catch (e) {
    console.error("Payroll close error:", e.message);
    res.status(500).json({ error: "Falha ao fechar a folha." });
  }
});

// POST /api/payroll/reopen { month } — reopen a closed folha for corrections.
router.post("/reopen", async (req, res) => {
  try {
    const monthRef = normalizeMonthRef((req.body || {}).month);
    if (!monthRef) return res.status(400).json({ error: "Informe um mês válido (YYYY-MM)." });
    await pool.query(
      `update public.payroll_periods
          set status = 'open', closed_at = null, closed_by = null
        where reference_month = $1`,
      [monthRef],
    );
    const report = await buildReport(monthRef);
    res.json(report);
  } catch (e) {
    console.error("Payroll reopen error:", e.message);
    res.status(500).json({ error: "Falha ao reabrir a folha." });
  }
});

// GET /api/payroll/entries?month=YYYY-MM&userId= — raw line items for a drill-down.
router.get("/entries", async (req, res) => {
  try {
    const monthRef = normalizeMonthRef(req.query.month);
    if (!monthRef) return res.status(400).json({ error: "Informe um mês válido (YYYY-MM)." });
    const userId = req.query.userId || null;
    const { rows } = await pool.query(
      `select e.id, e.user_id as "userId", u.name as "userName",
              e.restaurant_id as "restaurantId", r.name as "restaurantName",
              e.type, e.amount::float8 as amount, e.shift_count as "shiftCount",
              e.notes, e.created_at as "createdAt"
         from public.payroll_entries e
         join public.payroll_periods p on p.id = e.period_id
         join public.users u on u.id = e.user_id
         left join public.restaurants r on r.id = e.restaurant_id
        where p.reference_month = $1 and ($2::uuid is null or e.user_id = $2::uuid)
        order by u.name asc, e.type asc, e.created_at asc`,
      [monthRef, userId],
    );
    res.json(rows);
  } catch (e) {
    console.error("Payroll entries error:", e.message);
    res.status(500).json({ error: "Falha ao carregar lançamentos." });
  }
});

// POST /api/payroll/entries { month, userId, restaurantId?, amount, notes } — manual
// adjustment (§8.4 manual_adjustment). Positive to add, negative to deduct. Open only.
router.post("/entries", async (req, res) => {
  try {
    const b = req.body || {};
    const monthRef = normalizeMonthRef(b.month);
    if (!monthRef) return res.status(400).json({ error: "Informe um mês válido (YYYY-MM)." });
    if (!b.userId) return res.status(400).json({ error: "userId é obrigatório." });
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ message: "Informe um valor diferente de zero." });
    }

    const period = await ensurePayrollPeriod(monthRef);
    if (period.status !== "open") {
      return res.status(409).json({ message: "A folha deste mês está fechada. Reabra para ajustar." });
    }
    const u = await one(`select 1 from public.users where id = $1`, [b.userId]);
    if (!u) return res.status(404).json({ error: "Freelancer não encontrado." });

    const row = await one(
      `insert into public.payroll_entries
         (period_id, user_id, restaurant_id, type, amount, notes)
       values ($1, $2, $3, 'manual_adjustment', $4, $5)
       returning id`,
      [period.id, b.userId, b.restaurantId || null, Math.round(amount * 100) / 100, b.notes || null],
    );
    res.status(201).json({ id: row.id, ...(await getMonthReport(monthRef)) });
  } catch (e) {
    console.error("Payroll add entry error:", e.message);
    res.status(500).json({ error: "Falha ao adicionar ajuste." });
  }
});

// DELETE /api/payroll/entries/:id — remove a manual adjustment (open period only).
router.delete("/entries/:id", async (req, res) => {
  try {
    const row = await one(
      `select e.id, e.type, p.reference_month::text as "monthRef", p.status
         from public.payroll_entries e
         join public.payroll_periods p on p.id = e.period_id
        where e.id = $1`,
      [req.params.id],
    );
    if (!row) return res.status(404).json({ error: "Lançamento não encontrado." });
    if (row.type !== "manual_adjustment") {
      return res.status(400).json({ message: "Apenas ajustes manuais podem ser removidos." });
    }
    if (row.status !== "open") {
      return res.status(409).json({ message: "A folha deste mês está fechada. Reabra para ajustar." });
    }
    await pool.query(`delete from public.payroll_entries where id = $1`, [req.params.id]);
    res.json(await getMonthReport(row.monthRef));
  } catch (e) {
    console.error("Payroll delete entry error:", e.message);
    res.status(500).json({ error: "Falha ao remover ajuste." });
  }
});

export default router;
