// One-off: publish manual coordinator drafts left over from before the
// immediate-publish change (R14b), and notify each freelancer. Idempotent.
import { pool, one } from "../src/db.js";
import { notify } from "../src/notify.js";

const SHIFT_LABEL = { lunch: "Almoço", dinner: "Janta" };
const dateBR = (iso) => String(iso).slice(0, 10).split("-").reverse().join("/");
const hhmm = (t) => String(t).slice(0, 5);

const { rows } = await pool.query(
  `select a.id, a.user_id as "userId", a.restaurant_id as "restaurantId",
          a.date::text as date, a.shift_type as "shiftType",
          to_char(a.start_time,'HH24:MI') as "startTime", to_char(a.end_time,'HH24:MI') as "endTime",
          r.name as "restaurantName", u.name as "userName"
     from public.schedule_assignments a
     join public.restaurants r on r.id = a.restaurant_id
     join public.users u on u.id = a.user_id
    where a.status = 'draft' and a.assigned_via = 'coordinator'
    order by a.created_at`,
);

console.log(`Found ${rows.length} stuck coordinator draft(s).`);
for (const a of rows) {
  await pool.query(
    `update public.schedule_assignments set status='published', published_at=now() where id=$1`,
    [a.id],
  );
  await notify({
    recipientUserId: a.userId,
    type: "schedule_assigned",
    title: "Novo turno na sua escala",
    body: `${SHIFT_LABEL[a.shiftType] || a.shiftType} em ${a.restaurantName} — ${dateBR(a.date)}, ${hhmm(a.startTime)}–${hhmm(a.endTime)}.`,
    data: { date: a.date, shiftType: a.shiftType, restaurantId: a.restaurantId, path: "/my-schedule" },
  });
  console.log(`  published + notified: ${a.userName} — ${a.date} ${a.shiftType} @ ${a.restaurantName}`);
}
await pool.end();
console.log("done.");
