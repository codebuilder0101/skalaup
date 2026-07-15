import { Router } from "express";
import { pool, one } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { notify, coordinatorIds } from "../notify.js";
import { isOps, managerRestaurantIds } from "../access.js";
import { getScorePoints } from "../scoreConfig.js";
import {
  latenessFromMinutes, countsAsLate, LATE_SCORE_EVENT_TYPES,
} from "../attendanceRules.js";
import {
  monthRefOf, ensurePayrollPeriod, resolvePaySettings, noShowDiscountAmount,
} from "../payroll.js";

// Check-in / check-out (§4), lateness (§4.1, §6) and no-shows / furos (§5).
// No geolocation: check-ins are recorded manually with the server timestamp.
const router = Router();
router.use(requireAuth);
const requireOps = requireRole("coordinator", "administrator");

// --- shared SQL ------------------------------------------------------------
// One attendance/assignment row joined for the list & detail views.
const LIST_SELECT = `
  select a.id as "assignmentId", a.user_id as "userId", a.restaurant_id as "restaurantId",
         a.date::text as date, a.shift_type as "shiftType",
         a.start_time as "startTime", a.end_time as "endTime", a.status,
         u.name as "freelancerName", r.name as "restaurantName",
         att.checkin_at as "checkinAt", att.checkout_at as "checkoutAt",
         att.lateness_minutes as "latenessMinutes", att.lateness_category as "latenessCategory",
         att.no_show as "noShow", att.edited_by_coordinator as "editedByCoordinator",
         ab.id as "absenceId", ab.type as "absenceType",
         ab.occurrence_in_month as "occurrenceInMonth",
         ab.coordinator_decision as "coordinatorDecision",
         ab.justification_text as "justificationText", ab.certificate_url as "certificateUrl"
    from public.schedule_assignments a
    join public.users u on u.id = a.user_id
    join public.restaurants r on r.id = a.restaurant_id
    left join public.shift_attendance att on att.assignment_id = a.id
    left join public.absences ab on ab.assignment_id = a.id`;

function rowByAssignment(assignmentId) {
  return one(`${LIST_SELECT} where a.id = $1`, [assignmentId]);
}

// Recompute the cached current_score (sum of non-voided events) for a user.
async function recomputeScore(userId) {
  await pool.query(
    `update public.freelancer_profiles
        set current_score = coalesce(
          (select sum(points) from public.score_events where user_id = $1 and is_voided = false), 0)
      where user_id = $1`,
    [userId],
  );
}

// Override the lateness penalty points with the editable config value (R1/R7).
// The category/boundaries stay fixed (business rule); only the points are tunable.
async function withConfiguredPoints(late) {
  if (late.eventType) {
    const p = await getScorePoints();
    if (Number.isFinite(Number(p[late.eventType]))) late.points = Number(p[late.eventType]);
  }
  return late;
}

// Void any existing lateness score events for an assignment, then add the new one
// (idempotent — a coordinator edit can change the category, or clear it entirely).
async function applyLatenessScore({ assignmentId, userId, date, eventType, points, createdBy }) {
  await pool.query(
    `update public.score_events set is_voided = true
      where reference_type = 'assignment' and reference_id = $1
        and event_type = any($2) and is_voided = false`,
    [assignmentId, LATE_SCORE_EVENT_TYPES],
  );
  if (eventType) {
    await pool.query(
      `insert into public.score_events
         (user_id, event_type, points, reference_type, reference_id, occurred_on, month_ref, created_by)
       values ($1, $2, $3, 'assignment', $4, $5, $6, $7)`,
      [userId, eventType, points, assignmentId, date, monthRefOf(date), createdBy ?? null],
    );
  }
  await recomputeScore(userId);
}

// Count this user's recorded latenesses in the month containing `date`.
async function lateCountInMonth(userId, date) {
  const monthRef = monthRefOf(date);
  const row = await one(
    `select count(*)::int as n from public.shift_attendance
      where user_id = $1
        and lateness_category in ('light','moderate','severe','critical')
        and scheduled_start >= $2::date
        and scheduled_start < ($2::date + interval '1 month')`,
    [userId, monthRef],
  );
  return row.n;
}

// On the 3rd lateness of the month: warn the freelancer and apply the configured
// payroll discount once (§6, §8.4). Idempotent — the discount is inserted only if
// no late_discount entry exists for this user/period yet.
async function handleLateThreshold({ userId, restaurantId, date }) {
  const count = await lateCountInMonth(userId, date);
  if (count < 3) return { lateCount: count, discountApplied: false };

  const monthRef = monthRefOf(date);
  const settings = await resolvePaySettings(restaurantId);
  const period = await ensurePayrollPeriod(monthRef);

  let discountApplied = false;
  if (period.status === "open" && settings.lateDiscount > 0) {
    const exists = await one(
      `select 1 from public.payroll_entries
        where period_id = $1 and user_id = $2 and type = 'late_discount' limit 1`,
      [period.id, userId],
    );
    if (!exists) {
      await pool.query(
        `insert into public.payroll_entries (period_id, user_id, restaurant_id, type, amount, notes)
         values ($1, $2, $3, 'late_discount', $4, $5)`,
        [period.id, userId, restaurantId, -Math.abs(settings.lateDiscount), "3º atraso no mês (§6)"],
      );
      discountApplied = true;
    }
  }

  // Notify exactly when the 3rd lateness is reached (avoids re-spamming on edits).
  if (count === 3) {
    await notify({
      recipientUserId: userId,
      type: "third_late",
      title: "Aviso de desconto por atraso",
      body: "Você atingiu 3 atrasos neste mês. Um desconto será aplicado na folha do mês.",
      data: { monthRef },
    });
  }
  return { lateCount: count, discountApplied };
}

// ---------------------------------------------------------------------------
// GET /api/attendance?date=&restaurantId=&userId=  — coordinator/manager board.
// Managers are scoped to their own restaurants.
router.get("/", async (req, res) => {
  try {
    const { date, restaurantId, userId } = req.query;
    const conds = ["a.status <> 'cancelled'"];
    const vals = [];
    let i = 1;
    if (date) { conds.push(`a.date = $${i++}`); vals.push(date); }
    if (restaurantId) { conds.push(`a.restaurant_id = $${i++}`); vals.push(restaurantId); }
    if (userId) { conds.push(`a.user_id = $${i++}`); vals.push(userId); }

    if (req.user.role === "restaurant_manager") {
      const ids = await managerRestaurantIds(req.user.sub);
      if (ids.length === 0) return res.json([]);
      conds.push(`a.restaurant_id = any($${i++})`); vals.push(ids);
    } else if (!isOps(req.user.role)) {
      // freelancers/visitors may only read their own rows
      conds.push(`a.user_id = $${i++}`); vals.push(req.user.sub);
    }

    const { rows } = await pool.query(
      `${LIST_SELECT} where ${conds.join(" and ")} order by a.date asc, a.shift_type asc, u.name asc`,
      vals,
    );
    res.json(rows);
  } catch (e) {
    console.error("Attendance list error:", e.message);
    res.status(500).json({ error: "Falha ao carregar presença." });
  }
});

// GET /api/attendance/mine?from=&to=  — the signed-in freelancer's own shifts with
// attendance, for the date range (defaults to today..+7 days). Published only.
router.get("/mine", async (req, res) => {
  try {
    const from = req.query.from || null;
    const to = req.query.to || null;
    const { rows } = await pool.query(
      `${LIST_SELECT}
        where a.user_id = $1 and a.status = 'published'
          and a.date >= coalesce($2::date, current_date)
          and a.date <= coalesce($3::date, current_date + 7)
        order by a.date asc, a.shift_type asc`,
      [req.user.sub, from, to],
    );
    res.json(rows);
  } catch (e) {
    console.error("Attendance mine error:", e.message);
    res.status(500).json({ error: "Falha ao carregar seus turnos." });
  }
});

// POST /api/attendance/checkin { assignmentId }  — freelancer self check-in (or ops).
router.post("/checkin", async (req, res) => {
  try {
    const { assignmentId } = req.body || {};
    if (!assignmentId) return res.status(400).json({ error: "assignmentId is required" });

    const a = await one(
      `select a.id, a.user_id as "userId", a.restaurant_id as "restaurantId",
              a.date::text as date, a.status,
              ((a.date + a.start_time) at time zone coalesce(r.timezone, 'America/Sao_Paulo')) as "scheduledStart",
              extract(epoch from (now() - ((a.date + a.start_time) at time zone coalesce(r.timezone, 'America/Sao_Paulo')))) / 60.0 as "lateMin"
         from public.schedule_assignments a
         left join public.restaurants r on r.id = a.restaurant_id
        where a.id = $1`,
      [assignmentId],
    );
    if (!a) return res.status(404).json({ error: "Not found" });

    const self = a.userId === req.user.sub;
    if (!self && !isOps(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    if (self && a.status !== "published") {
      return res.status(400).json({ message: "Este turno ainda não foi publicado." });
    }

    // Self check-in respects the opening window (§4); ops may record any time.
    if (self) {
      const cfg = await one(`select checkin_open_minutes_before as m from public.app_settings where id = 1`);
      const openBefore = Number(cfg?.m ?? 15);
      if (Number(a.lateMin) < -openBefore) {
        return res.status(400).json({ message: `O check-in abre ${openBefore} min antes do início do turno.` });
      }
    }

    const existing = await one(
      `select checkin_at as "checkinAt" from public.shift_attendance where assignment_id = $1`,
      [assignmentId],
    );
    if (existing?.checkinAt && self) {
      return res.status(409).json({ message: "Check-in já registrado." });
    }

    const minutes = Math.round(Number(a.lateMin));
    const late = await withConfiguredPoints(latenessFromMinutes(minutes));

    await pool.query(
      `insert into public.shift_attendance
         (assignment_id, user_id, restaurant_id, scheduled_start, checkin_at,
          checkin_method, lateness_minutes, lateness_category, no_show)
       values ($1,$2,$3,$4, now(), 'manual', $5, $6, false)
       on conflict (assignment_id) do update set
         checkin_at = now(), checkin_method = 'manual',
         lateness_minutes = $5, lateness_category = $6, no_show = false`,
      [assignmentId, a.userId, a.restaurantId, a.scheduledStart, minutes, late.category],
    );

    await applyLatenessScore({
      assignmentId, userId: a.userId, date: a.date,
      eventType: late.eventType, points: late.points, createdBy: req.user.sub,
    });

    let lateInfo = { lateCount: 0, discountApplied: false };
    if (countsAsLate(late.category)) {
      lateInfo = await handleLateThreshold({ userId: a.userId, restaurantId: a.restaurantId, date: a.date });
    }

    const row = await rowByAssignment(assignmentId);
    res.json({ ...row, ...lateInfo });
  } catch (e) {
    console.error("Check-in error:", e.message);
    res.status(500).json({ error: "Falha ao registrar check-in." });
  }
});

// Award the furo/vaga cover reward once the turno is actually WORKED (§ "só ganha os
// pontos depois que trabalha"). Only for shifts the freelancer self-assumed from the
// waiting list, and only if they hit the monthly 10-turno availability target for that
// cycle (§ gate). Idempotent — one furo_covered per covered assignment.
async function awardFuroCoverIfEarned(assignmentId) {
  const a = await one(
    `select a.user_id as "userId", a.cycle_id as "cycleId", a.assigned_via as "assignedVia",
            a.date::text as date
       from public.schedule_assignments a where a.id = $1`,
    [assignmentId],
  );
  if (!a || a.assignedVia !== "waiting_list" || !a.cycleId) return;
  const met = await one(
    `select 1 from public.score_events
      where user_id = $1 and event_type = 'target_10_shifts' and reference_type = 'engagement'
        and reference_id = $2 and is_voided = false limit 1`,
    [a.userId, a.cycleId],
  );
  if (!met) return; // did not meet the 10-turno availability target this month
  await grantFuroCoverOnce(a.userId, assignmentId, a.date, "Cobriu uma vaga/furo assumida pelo app");
}

// Insert the furo-cover reward once per assignment (idempotent) and recompute the
// score. Shared by the waiting-list furo path and the extra-shift path.
async function grantFuroCoverOnce(userId, assignmentId, date, note) {
  const existing = await one(
    `select 1 from public.score_events
      where user_id = $1 and event_type = 'furo_covered' and reference_type = 'assignment'
        and reference_id = $2 and is_voided = false limit 1`,
    [userId, assignmentId],
  );
  if (existing) return;
  const cfg = await one(`select furo_cover_points as p from public.app_settings where id = 1`);
  const points = Number(cfg?.p ?? 3);
  if (points === 0) return;
  await pool.query(
    `insert into public.score_events
       (user_id, event_type, points, reference_type, reference_id, occurred_on, month_ref, notes)
     values ($1,'furo_covered',$2,'assignment',$3,$4,$5,$6)`,
    [userId, points, assignmentId, date, monthRefOf(date), note],
  );
  await pool.query(
    `update public.freelancer_profiles set current_score = coalesce(
       (select sum(points) from public.score_events where user_id = $1 and is_voided = false), 0)
     where user_id = $1`,
    [userId],
  );
}

// Worked an extra shift ("turno extra", R9) → furo-cover reward, ungated (an
// extra shift is unplanned by definition). Idempotent per assignment.
async function awardExtraShiftIfWorked(assignmentId) {
  const a = await one(
    `select user_id as "userId", date::text as date, is_extra as "isExtra"
       from public.schedule_assignments where id = $1`,
    [assignmentId],
  );
  if (!a || !a.isExtra) return;
  await grantFuroCoverOnce(a.userId, assignmentId, a.date, "Trabalhou um turno extra (não previsto na escala)");
}

// Worked a shift taken over via a swap (troca) → furo-cover reward, ungated. The
// accepter covered the requester's furo by taking a shift that wasn't theirs (client
// rule), and is rewarded once the shift is actually worked. Idempotent per assignment.
async function awardSwapCoverIfWorked(assignmentId) {
  const a = await one(
    `select user_id as "userId", date::text as date, assigned_via as "assignedVia"
       from public.schedule_assignments where id = $1`,
    [assignmentId],
  );
  if (!a || a.assignedVia !== "swap") return;
  await grantFuroCoverOnce(a.userId, assignmentId, a.date, "Cobriu um furo assumido por troca de turno");
}

// POST /api/attendance/checkout { assignmentId }
router.post("/checkout", async (req, res) => {
  try {
    const { assignmentId } = req.body || {};
    if (!assignmentId) return res.status(400).json({ error: "assignmentId is required" });

    const att = await one(
      `select att.user_id as "userId", att.checkin_at as "checkinAt", att.checkout_at as "checkoutAt"
         from public.shift_attendance att where att.assignment_id = $1`,
      [assignmentId],
    );
    if (!att) return res.status(400).json({ message: "Faça o check-in antes do check-out." });

    const self = att.userId === req.user.sub;
    if (!self && !isOps(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    if (!att.checkinAt) return res.status(400).json({ message: "Faça o check-in antes do check-out." });
    if (att.checkoutAt && self) return res.status(409).json({ message: "Check-out já registrado." });

    await pool.query(
      `update public.shift_attendance set checkout_at = now() where assignment_id = $1`,
      [assignmentId],
    );
    // Worked a self-assumed vaga/furo → grant the cover reward (gated). Best-effort.
    await awardFuroCoverIfEarned(assignmentId).catch((e) => console.error("furo reward failed:", e.message));
    // Worked an extra shift → grant the cover reward (ungated). Best-effort.
    await awardExtraShiftIfWorked(assignmentId).catch((e) => console.error("extra reward failed:", e.message));
    // Worked a shift taken over via a swap → grant the furo-cover reward (ungated). Best-effort.
    await awardSwapCoverIfWorked(assignmentId).catch((e) => console.error("swap cover reward failed:", e.message));
    res.json(await rowByAssignment(assignmentId));
  } catch (e) {
    console.error("Check-out error:", e.message);
    res.status(500).json({ error: "Falha ao registrar check-out." });
  }
});

// PUT /api/attendance/:assignmentId/edit { checkinAt, checkoutAt, reason }
// Coordinator override of check-in/out times (§4 OBS: dead battery, app down).
// checkinAt/checkoutAt are ISO strings, or null to clear.
router.put("/:assignmentId/edit", requireOps, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const b = req.body || {};
    const checkinAt = b.checkinAt ?? null;
    const checkoutAt = b.checkoutAt ?? null;

    const a = await one(
      `select a.user_id as "userId", a.restaurant_id as "restaurantId", a.date::text as date,
              ((a.date + a.start_time) at time zone coalesce(r.timezone, 'America/Sao_Paulo')) as "scheduledStart",
              case when $2::timestamptz is null then null
                   else extract(epoch from ($2::timestamptz - ((a.date + a.start_time) at time zone coalesce(r.timezone, 'America/Sao_Paulo')))) / 60.0 end as "lateMin"
         from public.schedule_assignments a
         left join public.restaurants r on r.id = a.restaurant_id
        where a.id = $1`,
      [assignmentId, checkinAt],
    );
    if (!a) return res.status(404).json({ error: "Not found" });
    if (checkinAt && checkoutAt && new Date(checkoutAt) < new Date(checkinAt)) {
      return res.status(400).json({ message: "O check-out deve ser após o check-in." });
    }

    const minutes = a.lateMin == null ? null : Math.round(Number(a.lateMin));
    const late = minutes == null
      ? { category: "none", eventType: null, points: 0 }
      : await withConfiguredPoints(latenessFromMinutes(minutes));

    await pool.query(
      `insert into public.shift_attendance
         (assignment_id, user_id, restaurant_id, scheduled_start, checkin_at, checkout_at,
          checkin_method, lateness_minutes, lateness_category, no_show,
          edited_by_coordinator, edited_by, edit_reason)
       values ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,
               case when $5::timestamptz is null then null else 'manual' end,
               $7,$8, false, true, $9, $10)
       on conflict (assignment_id) do update set
         checkin_at = $5::timestamptz, checkout_at = $6::timestamptz,
         lateness_minutes = $7, lateness_category = $8, no_show = false,
         edited_by_coordinator = true, edited_by = $9, edit_reason = $10`,
      [assignmentId, a.userId, a.restaurantId, a.scheduledStart, checkinAt, checkoutAt,
       minutes, late.category, req.user.sub, b.reason ?? null],
    );

    await applyLatenessScore({
      assignmentId, userId: a.userId, date: a.date,
      eventType: late.eventType, points: late.points, createdBy: req.user.sub,
    });

    let lateInfo = { lateCount: 0, discountApplied: false };
    if (countsAsLate(late.category)) {
      lateInfo = await handleLateThreshold({ userId: a.userId, restaurantId: a.restaurantId, date: a.date });
    }
    const row = await rowByAssignment(assignmentId);
    res.json({ ...row, ...lateInfo });
  } catch (e) {
    console.error("Attendance edit error:", e.message);
    res.status(500).json({ error: "Falha ao editar presença." });
  }
});

// Count this user's UNJUSTIFIED absences in the month containing `date`.
async function unjustifiedCountInMonth(userId, date) {
  const monthRef = monthRefOf(date);
  const row = await one(
    `select count(*)::int as n from public.absences ab
       join public.schedule_assignments a on a.id = ab.assignment_id
      where ab.user_id = $1 and ab.type = 'no_show_unjustified'
        and a.date >= $2::date and a.date < ($2::date + interval '1 month')`,
    [userId, monthRef],
  );
  return row.n;
}

// POST /api/attendance/no-show { assignmentId, type, justificationText?, certificateUrl? }
// Coordinator records a furo (§5). type = 'no_show_unjustified' | 'justified'.
router.post("/no-show", requireOps, async (req, res) => {
  try {
    const b = req.body || {};
    const { assignmentId } = b;
    const type = b.type === "justified" ? "justified" : "no_show_unjustified";
    if (!assignmentId) return res.status(400).json({ error: "assignmentId is required" });

    const a = await one(
      `select a.user_id as "userId", a.restaurant_id as "restaurantId", a.date::text as date,
              ((a.date + a.start_time) at time zone coalesce(r.timezone, 'America/Sao_Paulo')) as "scheduledStart"
         from public.schedule_assignments a
         left join public.restaurants r on r.id = a.restaurant_id
        where a.id = $1`,
      [assignmentId],
    );
    if (!a) return res.status(404).json({ error: "Not found" });

    // Mark attendance as a no-show (clears any prior check-in/lateness).
    await pool.query(
      `insert into public.shift_attendance
         (assignment_id, user_id, restaurant_id, scheduled_start, no_show,
          lateness_category, checkin_at, checkout_at, edited_by_coordinator, edited_by)
       values ($1,$2,$3,$4, true, 'none', null, null, true, $5)
       on conflict (assignment_id) do update set
         no_show = true, lateness_category = 'none', lateness_minutes = null,
         checkin_at = null, checkout_at = null,
         edited_by_coordinator = true, edited_by = $5`,
      [assignmentId, a.userId, a.restaurantId, a.scheduledStart, req.user.sub],
    );

    // Clear any lateness score from a previous check-in on this shift.
    await applyLatenessScore({
      assignmentId, userId: a.userId, date: a.date, eventType: null, points: 0, createdBy: req.user.sub,
    });

    // Upsert the absence record (one per assignment).
    const existing = await one(`select id from public.absences where assignment_id = $1`, [assignmentId]);
    let absenceId;
    if (existing) {
      absenceId = existing.id;
      await pool.query(
        `update public.absences set type = $2, justification_text = $3, certificate_url = $4
           where id = $1`,
        [absenceId, type, b.justificationText ?? null, b.certificateUrl ?? null],
      );
    } else {
      const ins = await one(
        `insert into public.absences
           (assignment_id, user_id, type, justification_text, certificate_url, created_by)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [assignmentId, a.userId, type, b.justificationText ?? null, b.certificateUrl ?? null, req.user.sub],
      );
      absenceId = ins.id;
    }

    // Always void any prior no-show penalty for this assignment; re-add only if unjustified.
    await pool.query(
      `update public.score_events set is_voided = true
        where reference_type = 'absence' and reference_id = $1
          and event_type = 'no_show_unjustified' and is_voided = false`,
      [absenceId],
    );

    const monthRef = monthRefOf(a.date);
    let occurrence = null;
    let result = { discountApplied: false, coordinatorPrompted: false };

    if (type === "justified") {
      // §5: justified (atestado) — no discount, no score impact, decision reset.
      await pool.query(
        `update public.absences set occurrence_in_month = null, coordinator_decision = 'none' where id = $1`,
        [absenceId],
      );
      // Reverse a previously-applied no-show discount that referenced this absence.
      await pool.query(
        `delete from public.payroll_entries
          where type = 'no_show_discount' and reference_id = $1
            and period_id in (select id from public.payroll_periods where reference_month = $2 and status = 'open')`,
        [absenceId, monthRef],
      );
    } else {
      occurrence = await unjustifiedCountInMonth(a.userId, a.date);
      await pool.query(`update public.absences set occurrence_in_month = $2 where id = $1`, [absenceId, occurrence]);

      // Score penalty for an unjustified no-show (§9.1) — points from config.
      const noShowPts = (await getScorePoints()).no_show_unjustified;
      await pool.query(
        `insert into public.score_events
           (user_id, event_type, points, reference_type, reference_id, occurred_on, month_ref, created_by)
         values ($1, 'no_show_unjustified', $6, 'absence', $2, $3, $4, $5)`,
        [a.userId, absenceId, a.date, monthRef, req.user.sub, noShowPts],
      );

      // 1st furo → discount of one (highest) shift, once per user per period (§5/§8.4).
      const settings = await resolvePaySettings(a.restaurantId);
      const period = await ensurePayrollPeriod(monthRef);
      if (period.status === "open") {
        const hasDiscount = await one(
          `select 1 from public.payroll_entries
            where period_id = $1 and user_id = $2 and type = 'no_show_discount' limit 1`,
          [period.id, a.userId],
        );
        if (!hasDiscount) {
          const amount = await noShowDiscountAmount({
            userId: a.userId, restaurantId: a.restaurantId, monthRef, settings,
          });
          if (amount > 0) {
            await pool.query(
              `insert into public.payroll_entries
                 (period_id, user_id, restaurant_id, type, reference_id, amount, shift_count, notes)
               values ($1,$2,$3,'no_show_discount',$4,$5,1,$6)`,
              [period.id, a.userId, a.restaurantId, absenceId, -Math.abs(amount), "1º furo sem justificativa (§5)"],
            );
            result.discountApplied = true;
          }
        }
      }

      // 2nd furo → ask the coordinator whether to cancel the remaining shifts (§5).
      if (occurrence >= 2) {
        result.coordinatorPrompted = true;
        const u = await one(`select name from public.users where id = $1`, [a.userId]);
        for (const cid of await coordinatorIds()) {
          await notify({
            recipientUserId: cid,
            type: "second_no_show",
            title: "2º furo sem justificativa",
            body: `${u?.name ?? "Freelancer"} acumulou ${occurrence} furos neste mês. Deseja cancelar os turnos restantes?`,
            data: { absenceId, userId: a.userId, occurrence },
          });
        }
      }
    }

    await recomputeScore(a.userId);
    const row = await rowByAssignment(assignmentId);
    res.json({ ...row, occurrence, ...result });
  } catch (e) {
    console.error("No-show error:", e.message);
    res.status(500).json({ error: "Falha ao registrar furo." });
  }
});

// DELETE /api/attendance/:assignmentId/no-show — undo a furo (coordinator).
router.delete("/:assignmentId/no-show", requireOps, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const ab = await one(
      `select id, user_id as "userId" from public.absences where assignment_id = $1`,
      [assignmentId],
    );
    if (ab) {
      await pool.query(
        `update public.score_events set is_voided = true
          where reference_type = 'absence' and reference_id = $1 and is_voided = false`,
        [ab.id],
      );
      await pool.query(
        `delete from public.payroll_entries
          where type = 'no_show_discount' and reference_id = $1
            and period_id in (select id from public.payroll_periods where status = 'open')`,
        [ab.id],
      );
      await pool.query(`delete from public.absences where id = $1`, [ab.id]);
      await recomputeScore(ab.userId);
    }
    await pool.query(
      `update public.shift_attendance set no_show = false where assignment_id = $1`,
      [assignmentId],
    );
    res.json(await rowByAssignment(assignmentId));
  } catch (e) {
    console.error("Undo no-show error:", e.message);
    res.status(500).json({ error: "Falha ao desfazer furo." });
  }
});

// GET /api/attendance/absences/pending — unjustified furos (2nd+) awaiting a decision (§5).
router.get("/absences/pending", requireOps, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select ab.id as "absenceId", ab.user_id as "userId", ab.occurrence_in_month as "occurrenceInMonth",
              ab.created_at as "createdAt", u.name as "freelancerName",
              a.date::text as date, a.shift_type as "shiftType", r.name as "restaurantName"
         from public.absences ab
         join public.users u on u.id = ab.user_id
         join public.schedule_assignments a on a.id = ab.assignment_id
         join public.restaurants r on r.id = a.restaurant_id
        where ab.type = 'no_show_unjustified'
          and coalesce(ab.occurrence_in_month, 0) >= 2
          and ab.coordinator_decision = 'none'
        order by ab.created_at desc`,
    );
    res.json(rows);
  } catch (e) {
    console.error("Pending absences error:", e.message);
    res.status(500).json({ error: "Falha ao carregar pendências." });
  }
});

// POST /api/attendance/absences/:id/decision { decision }  — forgive | cancel_remaining (§5).
router.post("/absences/:id/decision", requireOps, async (req, res) => {
  try {
    const decision = (req.body || {}).decision;
    if (!["forgive", "cancel_remaining"].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'forgive' or 'cancel_remaining'" });
    }
    const ab = await one(
      `select ab.id, ab.user_id as "userId" from public.absences ab where ab.id = $1`,
      [req.params.id],
    );
    if (!ab) return res.status(404).json({ error: "Not found" });

    await pool.query(
      `update public.absences set coordinator_decision = $2, created_by = coalesce(created_by, $3) where id = $1`,
      [ab.id, decision, req.user.sub],
    );

    let cancelledCount = 0;
    if (decision === "cancel_remaining") {
      const { rows } = await pool.query(
        `update public.schedule_assignments set status = 'cancelled'
          where user_id = $1 and status <> 'cancelled' and date >= current_date
          returning id`,
        [ab.userId],
      );
      cancelledCount = rows.length;
      await notify({
        recipientUserId: ab.userId,
        type: "second_no_show",
        title: "Escala cancelada",
        body: "Devido a furos sem justificativa, o restante da sua escala foi cancelado. Fale com a coordenadora.",
        data: { absenceId: ab.id, cancelledCount },
      });
    }
    res.json({ ok: true, decision, cancelledCount });
  } catch (e) {
    console.error("Absence decision error:", e.message);
    res.status(500).json({ error: "Falha ao registrar decisão." });
  }
});

export default router;
