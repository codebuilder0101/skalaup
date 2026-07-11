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

// Open a vaga on a slot (§3.4): a published shift is cancelled, a furo is recorded,
// demand is raised, or a slot was left unfilled at publish. Enrolls the freelancers
// who made themselves available for that slot (this restaurant OR "any"), aren't
// already scheduled, ranked by score, into the waiting_list (recording the open time
// and score snapshot for the priority window), and notifies them they can assume it
// in the app. No-op when the slot is not actually short of its demand. Returns how
// many were enrolled. Best-effort: callers swallow errors.
export async function openVagaForSlot({ cycleId, restaurantId, date, shiftType }) {
  if (!cycleId) return 0; // waiting list is availability-based; needs a cycle
  const future = await one(`select $1::date >= current_date as ok`, [date]);
  if (!future?.ok) return 0; // a past slot can't be covered
  const demand = await resolveDemand(restaurantId, date, shiftType);
  const filled = await one(
    `select count(*)::int as n from public.schedule_assignments
      where restaurant_id = $1 and date = $2 and shift_type = $3 and status <> 'cancelled'`,
    [restaurantId, date, shiftType],
  );
  if (filled.n >= demand) return 0; // no real vacancy

  const { rows } = await pool.query(
    `select s.user_id as "userId", coalesce(p.current_score, 0) as score
       from public.availability_submissions s
       join public.users u on u.id = s.user_id and u.status = 'active'
       left join public.freelancer_profiles p on p.user_id = s.user_id
      where s.cycle_id = $1 and s.date = $3 and s.shift_type = $4 and s.status = 'submitted'
        and (s.restaurant_id = $2 or s.restaurant_id is null)
        and not exists (
          select 1 from public.schedule_assignments a
           where a.user_id = s.user_id and a.date = s.date
             and a.shift_type = s.shift_type and a.status <> 'cancelled')
      group by s.user_id, p.current_score
      order by score desc`,
    [cycleId, restaurantId, date, shiftType],
  );
  if (rows.length === 0) return 0;

  const rest = await one(`select name from public.restaurants where id = $1`, [restaurantId]);
  const shiftPt = shiftType === "lunch" ? "almoço" : "janta";
  let pos = 0;
  for (const w of rows) {
    pos += 1;
    await pool.query(
      `insert into public.waiting_list
         (cycle_id, restaurant_id, date, shift_type, user_id, score_snapshot, position, status)
       values ($1,$2,$3,$4,$5,$6,$7,'waiting')
       on conflict (cycle_id, date, shift_type, restaurant_id, user_id)
         do update set score_snapshot = excluded.score_snapshot, position = excluded.position,
                       status = case when public.waiting_list.status = 'promoted'
                                     then 'promoted' else 'waiting' end`,
      [cycleId, restaurantId, date, shiftType, w.userId, w.score, pos],
    );
    await notify({
      recipientUserId: w.userId,
      type: "waitlist_opening",
      title: "Vaga aberta na escala",
      body: `Abriu uma vaga para ${shiftPt} de ${date}${rest ? ` em ${rest.name}` : ""}. ` +
            `Você tem preferência pelo seu score — assuma pelo app.`,
      data: { cycleId, restaurantId, date, shiftType },
    });
  }
  return rows.length;
}

// Scan a just-published cycle for slots left short of demand and open a vaga on each
// (§ "a coordenadora pode publicar a escala mesmo sem preencher tudo"). Best-effort;
// callers fire-and-forget. Returns the number of slots that opened a vaga.
export async function openVagasForCycle(cycleId) {
  const cyc = await one(
    `select reference_month::text as rm from public.availability_cycles where id = $1`, [cycleId]);
  if (!cyc) return 0;
  const { rows } = await pool.query(
    `with days as (
       select d::date as date, extract(dow from d)::int as weekday
         from generate_series($1::date, ($1::date + interval '1 month' - interval '1 day'), interval '1 day') d
        where d::date >= current_date
     ),
     rests as (select id as restaurant_id from public.restaurants where active),
     shifts as (select unnest(array['lunch','dinner']) as shift_type),
     slots as (
       select rests.restaurant_id, days.date, shifts.shift_type,
              coalesce(ov.required_count, base.required_count, 0) as required
         from days cross join rests cross join shifts
         left join public.demand_overrides ov
           on ov.restaurant_id = rests.restaurant_id and ov.date = days.date and ov.shift_type = shifts.shift_type
         left join public.restaurant_demand base
           on base.restaurant_id = rests.restaurant_id and base.weekday = days.weekday and base.shift_type = shifts.shift_type
     )
     select s.restaurant_id as "restaurantId", s.date::text as date, s.shift_type as "shiftType"
       from slots s
      where s.required > 0
        and s.required > (select count(*) from public.schedule_assignments a
                           where a.restaurant_id = s.restaurant_id and a.date = s.date
                             and a.shift_type = s.shift_type and a.status <> 'cancelled')`,
    [cyc.rm]);
  let opened = 0;
  for (const s of rows) {
    const n = await openVagaForSlot({ cycleId, restaurantId: s.restaurantId, date: s.date, shiftType: s.shiftType });
    if (n > 0) opened += 1;
  }
  return opened;
}
