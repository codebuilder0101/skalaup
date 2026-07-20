import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { notify } from "../notify.js";
import {
  weekdayOf, isWeekendMandatory, resolveShiftTimes, precedingWeekendShifts,
} from "../scheduleRules.js";
import { canEditRestaurant } from "../access.js";
import { openVagaForSlot, openVagasForCycle } from "../demand.js";

// Schedule assignments — the escala (§3.3). Coordinators/administrators manage any
// restaurant; restaurant_managers may fill/publish their OWN restaurant's shifts.
const router = Router();
router.use(requireAuth);
// Roles allowed to build the schedule. Restaurant scope is enforced per-request
// (a manager may only touch their own restaurant — see canEditRestaurant).
const requireSchedulers = requireRole("coordinator", "administrator", "restaurant_manager");

const COLS = `id, cycle_id as "cycleId", restaurant_id as "restaurantId",
  user_id as "userId", date::text as date, shift_type as "shiftType",
  start_time as "startTime", end_time as "endTime", status,
  is_weekend_mandatory as "isWeekendMandatory", pay_rate_applied as "payRateApplied",
  bonus_applied as "bonusApplied", assigned_via as "assignedVia",
  created_by as "createdBy", published_at as "publishedAt",
  notify_pending as "notifyPending",
  created_at as "createdAt", updated_at as "updatedAt"`;

// GET /api/assignments?date=&restaurantId=&userId=&cycleId=&status=
router.get("/", async (req, res) => {
  const { date, restaurantId, userId, cycleId, status } = req.query;
  const conds = [];
  const vals = [];
  let i = 1;
  // Freelancers/visitors may only ever see their OWN schedule — enforced here, not
  // trusted from the client's userId param, so a freelancer can never read the whole
  // board. Schedulers (coordinator/administrator/manager) keep full visibility.
  const selfOnly = req.user.role === "freelancer" || req.user.role === "visitor";
  if (selfOnly) { conds.push(`user_id = $${i++}`); vals.push(req.user.sub); }
  if (date) { conds.push(`date = $${i++}`); vals.push(date); }
  if (restaurantId) { conds.push(`restaurant_id = $${i++}`); vals.push(restaurantId); }
  if (userId && !selfOnly) { conds.push(`user_id = $${i++}`); vals.push(userId); }
  if (cycleId) { conds.push(`cycle_id = $${i++}`); vals.push(cycleId); }
  if (status) { conds.push(`status = $${i++}`); vals.push(status); }
  const where = conds.length ? `where ${conds.join(" and ")}` : "";
  const { rows } = await pool.query(
    `select ${COLS} from public.schedule_assignments ${where} order by date asc, shift_type asc`,
    vals,
  );
  res.json(rows);
});

// POST /api/assignments — assign a freelancer to a slot.
// Enforces restaurant scope (managers → own restaurant) and the schedule-conflict
// rule (§3.3), and flags weekend-mandatory shifts (§8.2); returns a non-blocking
// weekday-eligibility warning (§8.3). No per-slot capacity cap (§3.5).
router.post("/", requireSchedulers, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.restaurantId || !b.userId || !b.date || !b.shiftType) {
      return res.status(400).json({ error: "restaurantId, userId, date and shiftType are required" });
    }
    if (!["lunch", "dinner"].includes(b.shiftType)) {
      return res.status(400).json({ error: "Invalid shiftType" });
    }

    // Restaurant scope: a manager may only assign to their own restaurant.
    if (!(await canEditRestaurant(req.user, b.restaurantId))) {
      return res.status(403).json({
        error: "forbidden_restaurant",
        message: "Você só pode editar a escala do seu cliente.",
      });
    }

    // Conflict (§3.3): same freelancer already on this date+shift (any restaurant).
    const clash = await one(
      `select a.id, r.name as "restaurantName"
         from public.schedule_assignments a
         left join public.restaurants r on r.id = a.restaurant_id
        where a.user_id = $1 and a.date = $2 and a.shift_type = $3 and a.status <> 'cancelled'`,
      [b.userId, b.date, b.shiftType],
    );
    if (clash) {
      return res.status(409).json({
        error: "schedule_conflict",
        message: `Conflito de escala: já alocado neste turno${clash.restaurantName ? ` em ${clash.restaurantName}` : ""}.`,
        conflictRestaurant: clash.restaurantName ?? null,
      });
    }

    const weekday = weekdayOf(b.date);
    const weekendMandatory = isWeekendMandatory(weekday, b.shiftType);
    const times = b.startTime && b.endTime
      ? { startTime: b.startTime, endTime: b.endTime }
      : await resolveShiftTimes(b.restaurantId, b.shiftType);

    // Attribution (§3.4): managers → 'manager'; an explicit value wins; otherwise
    // an assignment made after the cycle is published is a waiting-list pull into an
    // opened vacancy ('waiting_list'), while building the draft is 'coordinator'.
    let assignedVia;
    if (req.user.role === "restaurant_manager") {
      assignedVia = "manager";
    } else if (b.assignedVia) {
      assignedVia = b.assignedVia;
    } else {
      const cyc = b.cycleId
        ? await one(`select status from public.availability_cycles where id = $1`, [b.cycleId])
        : null;
      assignedVia = cyc && cyc.status === "published" ? "waiting_list" : "coordinator";
    }

    // The shift is live immediately (published) so the coordinator sees the result,
    // but the affected freelancer is NOT notified now (client 2026-07-20): the change
    // is marked notify_pending and the alert is batched to the next publish, which
    // notifies ONLY the freelancers who actually changed. (Bulk auto-generate still
    // creates drafts, which publish flips to published + notifies.)
    const row = await one(
      `insert into public.schedule_assignments
         (cycle_id, restaurant_id, user_id, date, shift_type, start_time, end_time,
          status, is_weekend_mandatory, assigned_via, created_by, published_at, notify_pending)
       values ($1,$2,$3,$4,$5,$6,$7,'published',$8,$9,$10, now(), true)
       returning ${COLS}`,
      [
        b.cycleId ?? null, b.restaurantId, b.userId, b.date, b.shiftType,
        times.startTime, times.endTime, weekendMandatory,
        assignedVia, req.user.sub,
      ],
    );

    // Weekday eligibility (§8.3): weekday shifts (Mon–Thu) require all 4 weekend
    // mandatory shifts of the preceding weekend — warn only, never block.
    let eligibilityWarning = false;
    if (weekday >= 1 && weekday <= 4) {
      const needed = precedingWeekendShifts(b.date);
      const { rows: have } = await pool.query(
        `select date, shift_type as "shiftType" from public.schedule_assignments
           where user_id = $1 and status <> 'cancelled'
             and (date, shift_type) in (${needed.map((_, k) => `($${k * 2 + 2}, $${k * 2 + 3})`).join(", ")})`,
        [b.userId, ...needed.flatMap((n) => [n.date, n.shiftType])],
      );
      eligibilityWarning = have.length < needed.length;
      if (eligibilityWarning) {
        await notify({
          recipientUserId: req.user.sub,
          type: "weekday_eligibility",
          title: "Elegibilidade de turno de semana",
          body: "Freelancer alocado em turno de semana sem os 4 turnos do fim de semana anterior confirmados.",
          data: { userId: b.userId, date: b.date, shiftType: b.shiftType },
        });
      }
    }

    res.status(201).json({ ...row, eligibilityWarning });
  } catch (e) {
    // Unique-constraint race (same user, same slot) → treat as conflict, else 500.
    if (String(e.code) === "23505") {
      return res.status(409).json({ error: "schedule_conflict", message: "Conflito de escala: já alocado neste turno." });
    }
    console.error("Assign error:", e.message);
    res.status(500).json({ error: "Falha ao alocar. Tente novamente." });
  }
});

// PUT /api/assignments/:id/cancel — managers may cancel only their restaurant's.
router.put("/:id/cancel", requireSchedulers, async (req, res) => {
  try {
    const target = await one(
      `select cycle_id as "cycleId", restaurant_id as "restaurantId", date::text as date,
              shift_type as "shiftType", status, user_id as "userId", notify_pending as "notifyPending",
              to_char(start_time, 'HH24:MI') as "startTime", to_char(end_time, 'HH24:MI') as "endTime"
         from public.schedule_assignments where id = $1`,
      [req.params.id],
    );
    if (!target) return res.status(404).json({ error: "Not found" });
    if (!(await canEditRestaurant(req.user, target.restaurantId))) {
      return res.status(403).json({ error: "forbidden_restaurant", message: "Você só pode editar a escala do seu cliente." });
    }
    // A removal is only ANNOUNCED (notify_pending) when it undoes a change the
    // freelancer was already told about — i.e. an already-notified published shift.
    // Removing a shift the freelancer never heard about (a still-pending add, or a
    // draft) clears the pending flag so the batched publish stays silent for them.
    const announceRemoval = target.status === "published" && !target.notifyPending;
    const row = await one(
      `update public.schedule_assignments set status = 'cancelled', notify_pending = $2
         where id = $1 returning ${COLS}`,
      [req.params.id, announceRemoval],
    );
    // Genuine removal of an announced shift: open a vacancy → alert the waiting list
    // (§3.4). The affected freelancer is notified on the next publish, not now.
    if (announceRemoval) {
      openVagaForSlot({
        cycleId: target.cycleId, restaurantId: target.restaurantId,
        date: target.date, shiftType: target.shiftType,
      }).catch((e) => console.error("waitlist notify failed:", e.message));
    }
    res.json(row);
  } catch (e) {
    console.error("Cancel error:", e.message);
    res.status(500).json({ error: "Falha ao remover. Tente novamente." });
  }
});

// DELETE /api/assignments/:id — hard-remove a draft assignment (un-assign).
router.delete("/:id", requireSchedulers, async (req, res) => {
  try {
    const target = await one(
      `select restaurant_id as "restaurantId" from public.schedule_assignments where id = $1 and status = 'draft'`,
      [req.params.id],
    );
    if (target && !(await canEditRestaurant(req.user, target.restaurantId))) {
      return res.status(403).json({ error: "forbidden_restaurant", message: "Você só pode editar a escala do seu cliente." });
    }
    await pool.query(
      `delete from public.schedule_assignments where id = $1 and status = 'draft'`,
      [req.params.id],
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("Delete error:", e.message);
    res.status(500).json({ error: "Falha ao remover. Tente novamente." });
  }
});

// POST /api/assignments/publish { cycleId } — publish/flush the cycle's escala (§3.1).
// The button is ALWAYS available (client 2026-07-20): the first publish flips the
// draft escala to published; a re-publish flushes the changes made since the last
// publish. Either way it notifies ONLY the freelancers who actually changed — every
// row carrying an un-sent change (notify_pending) — and never anyone unchanged.
// Coordinators/administrators and restaurant_managers may publish.
router.post("/publish", requireSchedulers, async (req, res) => {
  const cycleId = (req.body || {}).cycleId;
  if (!cycleId) return res.status(400).json({ error: "cycleId is required" });

  // Any draft rows (bulk auto-generate) become published and get queued for notify.
  await pool.query(
    `update public.schedule_assignments
       set status = 'published', published_at = now(), notify_pending = true
     where cycle_id = $1 and status = 'draft'`,
    [cycleId],
  );

  await pool.query(
    `update public.availability_cycles set status = 'published', published_at = now() where id = $1`,
    [cycleId],
  );

  // Everyone with a pending change: additions (now published) and/or removals
  // (cancelled + announceable). Unchanged freelancers have no pending rows → silent.
  const { rows: changed } = await pool.query(
    `select user_id as "userId",
            count(*) filter (where status = 'published') as added,
            count(*) filter (where status = 'cancelled') as removed
       from public.schedule_assignments
      where cycle_id = $1 and notify_pending = true
      group by user_id`,
    [cycleId],
  );

  for (const c of changed) {
    const added = Number(c.added), removed = Number(c.removed);
    let body;
    if (added && removed) body = `Sua escala foi atualizada: ${added} novo(s) turno(s) e ${removed} removido(s).`;
    else if (removed) body = `Sua escala foi atualizada: ${removed} turno(s) removido(s).`;
    else body = `Sua escala foi publicada com ${added} turno(s).`;
    await notify({
      recipientUserId: c.userId,
      type: "schedule_published",
      title: "Escala atualizada",
      body,
      data: { cycleId, path: "/my-schedule" },
    });
  }

  // Clear the queue so a later re-publish only touches the NEXT round of changes.
  await pool.query(
    `update public.schedule_assignments set notify_pending = false
      where cycle_id = $1 and notify_pending = true`,
    [cycleId],
  );

  // Publishing with gaps is allowed (§ trainees / not enough people yet). Any slot
  // still short of demand opens a vaga the waiting list can self-assume. Best-effort.
  openVagasForCycle(cycleId).catch((e) => console.error("open vagas on publish failed:", e.message));

  res.json({ ok: true, notifiedUsers: changed.length });
});

export default router;
