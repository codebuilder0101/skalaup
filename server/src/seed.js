// Seeds sample restaurants + one active, sign-in-ready user for EACH role so the
// project can be tested end to end. Safe to run repeatedly (idempotent upserts).
import bcrypt from "bcryptjs";
import { pool, one } from "./db.js";

// One login per role — emails/passwords are self-explanatory.
const SEED_USERS = [
  // NOTE: seeded as coordinator (not administrator) because the live DB's
  // users_role_check constraint predates the administrator role. Coordinator is
  // the highest role the current constraint allows.
  { role: "coordinator",       name: "Admin",              email: "admin@gmail.com",            password: "admin" },
  { role: "coordinator",       name: "Coordenadora Ana",   email: "coordinator@skalaup.app",    password: "coordinator123" },
  { role: "restaurant_manager",name: "Gestor Bruno",       email: "manager@skalaup.app",        password: "manager123" },
  { role: "freelancer",        name: "Freelancer Carla",   email: "freelancer@skalaup.app",     password: "freelancer123" },
  { role: "visitor",           name: "Visitante Diego",    email: "visitor@skalaup.app",        password: "visitor123" },
];

async function upsertUser({ name, email, password, role }) {
  const hash = await bcrypt.hash(password, 10);
  return one(
    `insert into public.users (name, email, password, role, status)
     values ($1, $2, $3, $4, 'active')
     on conflict (email) do update set
       name = excluded.name, password = excluded.password,
       role = excluded.role, status = 'active'
     returning id, email, role`,
    [name, email, hash, role],
  );
}

// Extra demo freelancers with varying scores so candidate ranking is visible.
const DEMO_FREELANCERS = [
  { name: "Brincador Eduardo", email: "edu@skalaup.app",   score: 42, transport: "own_car",        exp: "3 anos de recreação" },
  { name: "Brincadora Fernanda", email: "fe@skalaup.app",  score: 31, transport: "public_transit", exp: "Animação de festas" },
  { name: "Brincador Gabriel", email: "gabriel@skalaup.app", score: 18, transport: "motorcycle",   exp: "Monitor de colônia de férias" },
  { name: "Brincadora Helena", email: "helena@skalaup.app", score: 55, transport: "own_car",        exp: "5 anos, líder de equipe" },
  { name: "Brincador Igor",    email: "igor@skalaup.app",   score: 7,  transport: "bike",            exp: "Iniciante" },
];

function addDaysUTC(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// First Fri/Sat/Sun of the given YYYY-MM month.
function firstWeekend(ym) {
  for (let day = 1; day <= 28; day++) {
    const ds = `${ym}-${String(day).padStart(2, "0")}`;
    if (new Date(`${ds}T00:00:00Z`).getUTCDay() === 5) {
      return { fri: ds, sat: addDaysUTC(ds, 1), sun: addDaysUTC(ds, 2) };
    }
  }
  return null;
}

async function seedScheduling() {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const referenceMonth = `${ym}-01`;

  // Open availability cycle for the current month.
  const cycle = await one(
    `insert into public.availability_cycles (reference_month, opens_at, closes_at, status)
     values ($1, $2, $3, 'open')
     on conflict (reference_month) do update set closes_at = excluded.closes_at
     returning id`,
    [referenceMonth, `${ym}-20T00:00:00Z`, `${ym}-25T23:59:59Z`],
  );

  const { rows: restaurants } = await pool.query(`select id, name from public.restaurants order by name asc`);

  // Shift templates + weekend base demand for every restaurant.
  const weekendDemand = [
    [5, "dinner", 6], // Friday dinner
    [6, "lunch", 8],  // Saturday lunch
    [6, "dinner", 8], // Saturday dinner
    [0, "lunch", 6],  // Sunday lunch
  ];
  for (const r of restaurants) {
    for (const [type, s, e] of [["lunch", "12:00", "16:00"], ["dinner", "18:00", "22:00"]]) {
      await pool.query(
        `insert into public.shift_templates (restaurant_id, shift_type, start_time, end_time)
         values ($1,$2,$3,$4) on conflict (restaurant_id, shift_type, start_time, end_time) do nothing`,
        [r.id, type, s, e],
      );
    }
    for (const [weekday, shift, count] of weekendDemand) {
      await pool.query(
        `insert into public.restaurant_demand (restaurant_id, weekday, shift_type, required_count)
         values ($1,$2,$3,$4)
         on conflict (restaurant_id, weekday, shift_type) do update set required_count = excluded.required_count`,
        [r.id, weekday, shift, count],
      );
    }
  }

  // Demo freelancers with explicit scores.
  const freelancerIds = [];
  for (const f of DEMO_FREELANCERS) {
    const hash = await bcrypt.hash("freelancer123", 10);
    const u = await one(
      `insert into public.users (name, email, password, role, status)
       values ($1,$2,$3,'freelancer','active')
       on conflict (email) do update set status = 'active', name = excluded.name
       returning id`,
      [f.name, f.email, hash],
    );
    await pool.query(
      `insert into public.freelancer_profiles (user_id, member_type, transport, experience, current_score)
       values ($1,'member',$2,$3,$4)
       on conflict (user_id) do update set
         transport = excluded.transport, experience = excluded.experience, current_score = excluded.current_score`,
      [u.id, f.transport, f.exp, f.score],
    );
    freelancerIds.push(u.id);
  }
  // Include the original sample freelancer (Carla) in the candidate pool.
  const carla = await one(`select id from public.users where email = 'freelancer@skalaup.app'`);
  if (carla) freelancerIds.push(carla.id);

  // Availability submissions for EVERY weekend slot of the month at "Restaurante
  // Centro" (Fri dinner, Sat lunch+dinner, Sun lunch) so any week in the grid is
  // populated with candidates.
  const centro = restaurants.find((r) => r.name === "Restaurante Centro") ?? restaurants[0];
  const weekendSlots = []; // [date, shiftType]
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${ym}-${String(day).padStart(2, "0")}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 5) weekendSlots.push([date, "dinner"]);          // Friday
    else if (dow === 6) { weekendSlots.push([date, "lunch"], [date, "dinner"]); } // Saturday
    else if (dow === 0) weekendSlots.push([date, "lunch"]);      // Sunday
  }
  if (centro && weekendSlots.length) {
    for (const uid of freelancerIds) {
      for (const [date, shift] of weekendSlots) {
        await pool.query(
          `insert into public.availability_submissions
             (cycle_id, user_id, date, shift_type, restaurant_id, status)
           values ($1,$2,$3,$4,$5,'submitted')
           on conflict (cycle_id, user_id, date, shift_type, restaurant_id)
             do update set status = 'submitted', cancelled_at = null`,
          [cycle.id, uid, date, shift, centro.id],
        );
      }
    }
    console.log(
      `\nScheduling demo: cycle ${referenceMonth} (open), weekend demand set, ` +
      `${freelancerIds.length} freelancers available at "${centro.name}" across ${weekendSlots.length} weekend slots.`,
    );
  }

  // A couple of published assignments for TODAY at "Restaurante Centro" so the
  // dashboard's "today's schedule" + payroll cards show live data on first run.
  if (centro && freelancerIds.length) {
    const today = new Date().toISOString().slice(0, 10);
    const todaySlots = [
      ["lunch", "12:00", "16:00", freelancerIds[0]],
      ["dinner", "18:00", "22:00", freelancerIds[1] ?? freelancerIds[0]],
    ];
    for (const [shift, st, et, uid] of todaySlots) {
      if (!uid) continue;
      await pool.query(
        `insert into public.schedule_assignments
           (cycle_id, restaurant_id, user_id, date, shift_type, start_time, end_time, status, assigned_via, published_at)
         values ($1,$2,$3,$4,$5,$6,$7,'published','coordinator', now())
         on conflict (user_id, date, shift_type) where status <> 'cancelled' do nothing`,
        [cycle.id, centro.id, uid, today, shift, st, et],
      );
    }
    console.log(`Dashboard demo: 2 published shifts for today (${today}) at "${centro.name}".`);
  }
}

async function main() {
  // --- Restaurants (needed before linking a manager) ---
  const samples = [
    { name: "Restaurante Centro",  address: "Av. Goiás, 100 - Centro" },
    { name: "Restaurante Marista", address: "R. 9, 200 - Setor Marista" },
    { name: "Restaurante Bueno",   address: "Av. T-63, 300 - Setor Bueno" },
  ];
  for (const s of samples) {
    await pool.query(
      `insert into public.restaurants (name, address, active)
       select $1, $2, true where not exists (select 1 from public.restaurants where name = $1)`,
      [s.name, s.address],
    );
  }

  // --- Users, one per role ---
  const created = {};
  for (const u of SEED_USERS) {
    const row = await upsertUser(u);
    created[u.email] = row;
  }

  // Restaurant manager → assigned to "Restaurante Centro" (§2.3, sees their restaurant).
  const manager = created["manager@skalaup.app"];
  const centro = await one(`select id from public.restaurants where name = 'Restaurante Centro'`);
  if (manager && centro) {
    await pool.query(
      `insert into public.manager_assignments (manager_user_id, restaurant_id)
       values ($1, $2) on conflict (manager_user_id, restaurant_id) do nothing`,
      [manager.id, centro.id],
    );
  }

  // Freelancer / visitor → profile "ficha".
  const profiles = [
    { email: "freelancer@skalaup.app", member: "member",  transport: "own_car",        exp: "2 anos de recreação infantil" },
    { email: "visitor@skalaup.app",    member: "visitor", transport: "public_transit", exp: "Recrutamento pontual" },
  ];
  for (const p of profiles) {
    const u = created[p.email];
    if (!u) continue;
    await pool.query(
      `insert into public.freelancer_profiles (user_id, member_type, transport, experience)
       values ($1, $2, $3, $4)
       on conflict (user_id) do update set
         member_type = excluded.member_type, transport = excluded.transport, experience = excluded.experience`,
      [u.id, p.member, p.transport, p.exp],
    );
  }

  // --- Scheduling demo data (§3.3–§3.5) so the Schedule Builder is testable ---
  await seedScheduling();

  console.log("\nSeed complete — sign-in-ready users (all status = active):\n");
  for (const u of SEED_USERS) {
    console.log(`  ${u.role.padEnd(18)}  ${u.email.padEnd(28)}  ${u.password}`);
  }
  console.log(`\n${samples.length} sample restaurants ensured.`);
  await pool.end();
}

main().catch((e) => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
