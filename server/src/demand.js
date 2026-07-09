// Demand resolution shared by waiting-list / deficit logic.
import { pool, one } from "./db.js";
import { notify } from "./notify.js";
import { weekdayOf } from "./scheduleRules.js";

// Required headcount for a single slot: date override → weekday base → 0.
export async function resolveDemand(restaurantId, date, shiftType) {
  const ov = await one(
    `select required_count as n from public.demand_overrides
      where restaurant_id = $1 and date = $2 and shift_type = $3`,
    [restaurantId, date, shiftType],
  );
  if (ov) return ov.n;
  const base = await one(
    `select required_count as n from public.restaurant_demand
      where restaurant_id = $1 and weekday = $2 and shift_type = $3`,
    [restaurantId, weekdayOf(date), shiftType],
  );
  return base ? base.n : 0;
}

// Waiting list (§3.4): when a vacancy opens on a slot — a published shift is
// cancelled, or its demand is raised for a special day — notify the freelancers
// who made themselves available for that slot but aren't scheduled, ranked by
// score, but only while the slot is actually short of its demand. Returns how
// many were notified. Best-effort: callers swallow errors.
export async function notifyWaitlistForSlot({ cycleId, restaurantId, date, shiftType }) {
  if (!cycleId) return 0; // waiting list is availability-based; needs a cycle
  const demand = await resolveDemand(restaurantId, date, shiftType);
  const cnt = await one(
    `select count(*)::int as n from public.schedule_assignments
      where restaurant_id = $1 and date = $2 and shift_type = $3 and status <> 'cancelled'`,
    [restaurantId, date, shiftType],
  );
  if (cnt.n >= demand) return 0; // no real vacancy

  const { rows } = await pool.query(
    `select s.user_id as "userId"
       from public.availability_submissions s
       left join public.freelancer_profiles p on p.user_id = s.user_id
      where s.cycle_id = $1 and s.restaurant_id = $2 and s.date = $3
        and s.shift_type = $4 and s.status = 'submitted'
        and not exists (
          select 1 from public.schedule_assignments a
           where a.user_id = s.user_id and a.date = s.date
             and a.shift_type = s.shift_type and a.status <> 'cancelled')
      order by coalesce(p.current_score, 0) desc`,
    [cycleId, restaurantId, date, shiftType],
  );
  if (rows.length === 0) return 0;

  const rest = await one(`select name from public.restaurants where id = $1`, [restaurantId]);
  const shiftPt = shiftType === "lunch" ? "almoço" : "janta";
  for (const w of rows) {
    await notify({
      recipientUserId: w.userId,
      type: "waitlist_opening",
      title: "Vaga aberta na escala",
      body: `Abriu uma vaga para ${shiftPt} de ${date}${rest ? ` em ${rest.name}` : ""}. Você está na lista de espera — fale com a coordenadora para assumir.`,
      data: { cycleId, restaurantId, date, shiftType },
    });
  }
  return rows.length;
}
