import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { notify, coordinatorIds } from "../notify.js";
import { weekdayOf, isWeekendMandatory } from "../scheduleRules.js";
import { monthRefOf } from "../payroll.js";
import { getScorePoints } from "../scoreConfig.js";

// Shift swaps (§7). State machine:
//   pending_target → (target accepts) approved   ← auto-approved on acceptance
//   any party can short-circuit to rejected/cancelled.
// When the target accepts, the swap is applied straight away: the shift is
// reassigned to the target (assigned_via='swap'). Scoring follows the "cobrir furo"
// rule: the requester takes the −1 swap_requested penalty immediately, while the
// accepter — who is covering the requester's furo by taking a shift that wasn't
// theirs — earns the furo-cover reward (+3) LATER, on checkout, and only if they
// actually work the shift (see awardSwapCoverIfWorked in attendance.js). Coordination
// is notified and may REPROVAR an approved swap while the shift is still upcoming —
// that reverses the reassignment and voids the swap scoring (status → rejected). The
// old 'pending_coordinator' gate is retired: coordinators only veto after the fact.
const router = Router();
router.use(requireAuth);
const requireOps = requireRole("coordinator", "administrator");
const isOpsRole = (role) => role === "coordinator" || role === "administrator";

const SWAP_POINTS = { swap_requested: -1 };

// Enriched columns for a swap row + its shift/people context.
const SWAP_SELECT = `
  s.id, s.assignment_id as "assignmentId", s.requester_user_id as "requesterUserId",
  s.target_user_id as "targetUserId", s.status,
  s.affects_weekend_bonus as "affectsWeekendBonus",
  s.bonus_loss_acknowledged as "bonusLossAcknowledged",
  s.created_at as "createdAt", s.target_responded_at as "targetRespondedAt",
  s.coordinator_decision_at as "coordinatorDecisionAt",
  a.date::text as date, a.shift_type as "shiftType",
  a.start_time as "startTime", a.end_time as "endTime",
  a.restaurant_id as "restaurantId", r.name as "restaurantName",
  req.name as "requesterName", tgt.name as "targetName"`;

const SWAP_FROM = `
  from public.shift_swap_requests s
  join public.schedule_assignments a on a.id = s.assignment_id
  left join public.restaurants r on r.id = a.restaurant_id
  left join public.users req on req.id = s.requester_user_id
  left join public.users tgt on tgt.id = s.target_user_id`;

async function recomputeScore(userId) {
  await pool.query(
    `update public.freelancer_profiles
       set current_score = coalesce(
         (select sum(points) from public.score_events where user_id = $1 and is_voided = false), 0)
     where user_id = $1`,
    [userId],
  );
}

async function addScore({ userId, eventType, points, occurredOn, referenceId }) {
  await pool.query(
    `insert into public.score_events
       (user_id, event_type, points, reference_type, reference_id, occurred_on, month_ref, created_by, notes)
     values ($1,$2,$3,'swap',$4,$5,$6,null,$7)`,
    [userId, eventType, points, referenceId, occurredOn, monthRefOf(occurredOn), `swap ${eventType}`],
  );
  await recomputeScore(userId);
}

// Apply an accepted swap: reassign the shift to the target and take the requester's
// −1 swap_requested penalty. The accepter earns nothing here — the furo-cover reward
// (+3) is granted later, on checkout, only if they actually work the covered shift
// (awardSwapCoverIfWorked in attendance.js), mirroring the vaga/waiting-list rule.
async function applySwapAndScore(s) {
  const cfgPoints = await getScorePoints();
  await pool.query(
    `update public.schedule_assignments
        set user_id=$2, assigned_via='swap', updated_at=now() where id=$1`,
    [s.assignmentId, s.targetUserId],
  );
  await addScore({
    userId: s.requesterUserId, eventType: "swap_requested",
    points: cfgPoints.swap_requested ?? SWAP_POINTS.swap_requested, occurredOn: s.date, referenceId: s.id,
  });
}

// Reverse an approved swap: give the shift back to the requester and void the swap's
// score events for both parties — including any furo-cover reward the accepter may
// have earned by working the swapped shift before it was reproved.
async function reverseSwap(s) {
  await pool.query(
    `update public.schedule_assignments
        set user_id=$2, assigned_via='coordinator', updated_at=now() where id=$1`,
    [s.assignmentId, s.requesterUserId],
  );
  await pool.query(
    `update public.score_events set is_voided=true
      where reference_type='swap' and reference_id=$1 and is_voided=false`,
    [s.id],
  );
  await pool.query(
    `update public.score_events set is_voided=true
      where reference_type='assignment' and reference_id=$1
        and event_type='furo_covered' and is_voided=false`,
    [s.assignmentId],
  );
  await recomputeScore(s.requesterUserId);
  await recomputeScore(s.targetUserId);
}

// ---------------------------------------------------------------------------
// GET /api/swaps — role-scoped lists.
//   freelancer/visitor → { incoming, outgoing }
//   coordinator/admin  → { queue, recent }
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    if (isOpsRole(req.user.role)) {
      const today = new Date().toISOString().slice(0, 10);
      // Reviewable = auto-approved swaps whose shift is still upcoming (can be reproved).
      const { rows: queue } = await pool.query(
        `select ${SWAP_SELECT} ${SWAP_FROM}
          where s.status = 'approved' and a.date >= $1::date
          order by a.date asc`,
        [today],
      );
      // History = everything else recent (reproved/cancelled, or already-worked approvals).
      const { rows: recent } = await pool.query(
        `select ${SWAP_SELECT} ${SWAP_FROM}
          where s.status in ('rejected','cancelled')
             or (s.status = 'approved' and a.date < $1::date)
          order by s.updated_at desc limit 30`,
        [today],
      );
      return res.json({ queue, recent });
    }
    const me = req.user.sub;
    const { rows: incoming } = await pool.query(
      `select ${SWAP_SELECT} ${SWAP_FROM}
        where s.target_user_id = $1 and s.status = 'pending_target'
        order by s.created_at asc`,
      [me],
    );
    const { rows: outgoing } = await pool.query(
      `select ${SWAP_SELECT} ${SWAP_FROM}
        where s.requester_user_id = $1
        order by s.created_at desc limit 50`,
      [me],
    );
    res.json({ incoming, outgoing });
  } catch (e) {
    console.error("swaps list error:", e.message);
    res.status(500).json({ error: "Falha ao carregar trocas." });
  }
});

// GET /api/swaps/eligible?assignmentId= — freelancers free for that slot (§7).
router.get("/eligible", async (req, res) => {
  try {
    const { assignmentId } = req.query;
    if (!assignmentId) return res.status(400).json({ error: "assignmentId is required" });
    const a = await one(
      `select user_id as "userId", date::text as date, shift_type as "shiftType"
         from public.schedule_assignments where id = $1`,
      [assignmentId],
    );
    if (!a) return res.status(404).json({ error: "Assignment not found" });
    // Only the shift owner may look up swap candidates for it.
    if (a.userId !== req.user.sub && !isOpsRole(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    // Active freelancers/visitors not already scheduled that date+shift, excluding owner.
    const { rows } = await pool.query(
      `select u.id, u.name, coalesce(fp.current_score, 0) as score
         from public.users u
         left join public.freelancer_profiles fp on fp.user_id = u.id
        where u.role in ('freelancer','visitor') and u.status = 'active'
          and u.id <> $1
          and not exists (
            select 1 from public.schedule_assignments x
             where x.user_id = u.id and x.date = $2 and x.shift_type = $3
               and x.status <> 'cancelled')
        order by score desc, u.name asc`,
      [a.userId, a.date, a.shiftType],
    );
    res.json(rows.map((r) => ({ id: r.id, name: r.name, score: Number(r.score) })));
  } catch (e) {
    console.error("swaps eligible error:", e.message);
    res.status(500).json({ error: "Falha ao carregar candidatos." });
  }
});

// POST /api/swaps { assignmentId, targetUserId, bonusLossAcknowledged }
router.post("/", async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.assignmentId || !b.targetUserId) {
      return res.status(400).json({ error: "assignmentId and targetUserId are required" });
    }
    const a = await one(
      `select id, user_id as "userId", date::text as date, shift_type as "shiftType", status
         from public.schedule_assignments where id = $1`,
      [b.assignmentId],
    );
    if (!a) return res.status(404).json({ error: "Assignment not found" });
    if (a.userId !== req.user.sub) {
      return res.status(403).json({ error: "forbidden", message: "Você só pode trocar seus próprios turnos." });
    }
    if (a.status !== "published") {
      return res.status(400).json({ error: "not_published", message: "Apenas turnos publicados podem ser trocados." });
    }
    if (a.date < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: "past_shift", message: "Este turno já passou." });
    }
    if (b.targetUserId === req.user.sub) {
      return res.status(400).json({ error: "self_target", message: "Escolha outro freelancer." });
    }
    const target = await one(
      `select id, name, status, role from public.users where id = $1`, [b.targetUserId],
    );
    if (!target || !["freelancer", "visitor"].includes(target.role) || target.status !== "active") {
      return res.status(400).json({ error: "invalid_target", message: "Freelancer indisponível." });
    }
    // Target must not already be scheduled that slot.
    const targetClash = await one(
      `select 1 from public.schedule_assignments
        where user_id = $1 and date = $2 and shift_type = $3 and status <> 'cancelled'`,
      [b.targetUserId, a.date, a.shiftType],
    );
    if (targetClash) {
      return res.status(409).json({ error: "target_busy", message: "Este freelancer já está escalado neste turno." });
    }
    // No other active swap already awaiting a target for this shift.
    const existing = await one(
      `select 1 from public.shift_swap_requests
        where assignment_id = $1 and status = 'pending_target'`,
      [b.assignmentId],
    );
    if (existing) {
      return res.status(409).json({ error: "swap_in_flight", message: "Já existe uma troca em andamento para este turno." });
    }

    // Weekend bonus-loss gate (§7.1): require explicit acknowledgement.
    const affectsBonus = isWeekendMandatory(weekdayOf(a.date), a.shiftType);
    if (affectsBonus && !b.bonusLossAcknowledged) {
      return res.status(409).json({
        error: "bonus_ack_required",
        affectsWeekendBonus: true,
        message: "Trocar este turno cancela o bônus da semana. Confirme para continuar.",
      });
    }

    const row = await one(
      `insert into public.shift_swap_requests
         (assignment_id, requester_user_id, target_user_id, target_restaurant_id,
          status, affects_weekend_bonus, bonus_loss_acknowledged)
       values ($1,$2,$3,(select restaurant_id from public.schedule_assignments where id = $1),
               'pending_target',$4,$5)
       returning id`,
      [b.assignmentId, req.user.sub, b.targetUserId, affectsBonus, !!b.bonusLossAcknowledged],
    );

    await notify({
      recipientUserId: b.targetUserId,
      type: "swap_request",
      title: "Pedido de troca de turno",
      body: `${req.user.name || "Um colega"} quer passar um turno para você. Aceitar?`,
      data: { swapId: row.id, assignmentId: b.assignmentId },
    });

    res.status(201).json({ id: row.id, status: "pending_target" });
  } catch (e) {
    console.error("swap create error:", e.message);
    res.status(500).json({ error: "Falha ao solicitar troca." });
  }
});

// POST /api/swaps/:id/respond { accept } — target accepts/declines (§7).
// On accept the swap is applied immediately and coordination is notified (it can
// still reprovar). No separate coordinator approval step.
router.post("/:id/respond", async (req, res) => {
  try {
    const accept = !!(req.body || {}).accept;
    const s = await one(
      `select s.id, s.assignment_id as "assignmentId", s.requester_user_id as "requesterUserId",
              s.target_user_id as "targetUserId", s.status,
              a.date::text as date, a.shift_type as "shiftType"
         from public.shift_swap_requests s
         join public.schedule_assignments a on a.id = s.assignment_id
        where s.id = $1`,
      [req.params.id],
    );
    if (!s) return res.status(404).json({ error: "Not found" });
    if (s.targetUserId !== req.user.sub) return res.status(403).json({ error: "Forbidden" });
    if (s.status !== "pending_target") {
      return res.status(400).json({ error: "bad_state", message: "Esta troca não está mais aguardando você." });
    }

    if (!accept) {
      await pool.query(
        `update public.shift_swap_requests set status='rejected', target_responded_at=now() where id=$1`,
        [s.id],
      );
      await notify({
        recipientUserId: s.requesterUserId, type: "swap_request",
        title: "Troca recusada", body: `${req.user.name || "O colega"} recusou sua troca de turno.`,
        data: { swapId: s.id },
      });
      return res.json({ status: "rejected" });
    }

    // Accept → re-validate the target (me) is still free for this slot, then apply.
    const clash = await one(
      `select 1 from public.schedule_assignments
        where user_id = $1 and date = $2 and shift_type = $3 and status <> 'cancelled'
          and id <> $4`,
      [s.targetUserId, s.date, s.shiftType, s.assignmentId],
    );
    if (clash) {
      return res.status(409).json({ error: "target_busy", message: "Você já está escalado neste turno." });
    }

    await applySwapAndScore(s);
    await pool.query(
      `update public.shift_swap_requests set status='approved', target_responded_at=now() where id=$1`,
      [s.id],
    );

    // Both freelancers: the swap is done.
    for (const uid of [s.requesterUserId, s.targetUserId]) {
      await notify({
        recipientUserId: uid, type: "swap_request",
        title: "Troca de turno realizada",
        body: `${req.user.name || "O colega"} aceitou a troca — o turno já foi transferido.`,
        data: { swapId: s.id, assignmentId: s.assignmentId },
      });
    }
    // Coordination: informed, with the option to reprovar.
    for (const cid of await coordinatorIds()) {
      await notify({
        recipientUserId: cid, type: "swap_request",
        title: "Troca de turno realizada",
        body: "Uma troca foi aceita e já vale. Você pode reprovar se necessário.",
        data: { swapId: s.id },
      });
    }
    res.json({ status: "approved" });
  } catch (e) {
    console.error("swap respond error:", e.message);
    res.status(500).json({ error: "Falha ao responder." });
  }
});

// POST /api/swaps/:id/decision { approve } — coordinator veto over an already-
// approved swap. approve=true is a no-op confirm; approve=false REPROVES it,
// reversing the reassignment and voiding the swap scoring, while the shift is
// still upcoming.
router.post("/:id/decision", requireOps, async (req, res) => {
  try {
    const approve = !!(req.body || {}).approve;
    const s = await one(
      `select s.id, s.assignment_id as "assignmentId", s.requester_user_id as "requesterUserId",
              s.target_user_id as "targetUserId", s.status,
              a.date::text as date, a.shift_type as "shiftType"
         from public.shift_swap_requests s
         join public.schedule_assignments a on a.id = s.assignment_id
        where s.id = $1`,
      [req.params.id],
    );
    if (!s) return res.status(404).json({ error: "Not found" });
    if (s.status !== "approved") {
      return res.status(400).json({ error: "bad_state", message: "Só é possível reprovar uma troca já realizada." });
    }

    // approve=true: nothing to do (the swap already applied on acceptance).
    if (approve) return res.json({ status: "approved" });

    // Reprovar is only allowed while the shift is still upcoming.
    if (s.date < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: "past_shift", message: "Este turno já passou e não pode ser reprovado." });
    }
    // The requester must still be free to take the shift back.
    const clash = await one(
      `select 1 from public.schedule_assignments
        where user_id = $1 and date = $2 and shift_type = $3 and status <> 'cancelled'
          and id <> $4`,
      [s.requesterUserId, s.date, s.shiftType, s.assignmentId],
    );
    if (clash) {
      return res.status(409).json({ error: "requester_busy", message: "O solicitante já está escalado neste turno; não é possível reverter." });
    }

    await reverseSwap(s);
    await pool.query(
      `update public.shift_swap_requests
          set status='rejected', coordinator_decision_by=$2, coordinator_decision_at=now() where id=$1`,
      [s.id, req.user.sub],
    );
    for (const uid of [s.requesterUserId, s.targetUserId]) {
      await notify({ recipientUserId: uid, type: "swap_request",
        title: "Troca reprovada", body: "A coordenação reprovou a troca — o turno voltou para o solicitante.", data: { swapId: s.id } });
    }
    res.json({ status: "rejected" });
  } catch (e) {
    console.error("swap decision error:", e.message);
    res.status(500).json({ error: "Falha ao decidir." });
  }
});

// DELETE /api/swaps/:id — requester cancels while still pending.
router.delete("/:id", async (req, res) => {
  try {
    const s = await one(
      `select id, requester_user_id as "requesterUserId", target_user_id as "targetUserId", status
         from public.shift_swap_requests where id = $1`,
      [req.params.id],
    );
    if (!s) return res.status(404).json({ error: "Not found" });
    if (s.requesterUserId !== req.user.sub) return res.status(403).json({ error: "Forbidden" });
    if (s.status !== "pending_target") {
      return res.status(400).json({ error: "bad_state", message: "Esta troca não pode mais ser cancelada." });
    }
    await pool.query(`update public.shift_swap_requests set status='cancelled' where id=$1`, [s.id]);
    if (s.targetUserId) {
      await notify({ recipientUserId: s.targetUserId, type: "swap_request",
        title: "Troca cancelada", body: "O colega cancelou o pedido de troca.", data: { swapId: s.id } });
    }
    res.json({ status: "cancelled" });
  } catch (e) {
    console.error("swap cancel error:", e.message);
    res.status(500).json({ error: "Falha ao cancelar." });
  }
});

export default router;
