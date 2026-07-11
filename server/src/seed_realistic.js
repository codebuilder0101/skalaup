// One-off: realistic restaurants + 10 realistic users linked across ALL restaurants.
// Idempotent — safe to run more than once (upserts by name/email). Passwords are
// bcrypt-hashed exactly like the app expects. Run: node src/seed_realistic.js
import bcrypt from "bcryptjs";
import { pool, one } from "./db.js";

// --- Restaurants to ensure (realistic Goiânia venues that hire recreação monitors) ---
const RESTAURANTS = [
  { name: "Cantina Nonna Rosa",       address: "R. 1004, 250 - Setor Pedro Ludovico, Goiânia - GO", cep: "74823-020" },
  { name: "Villa Mineira Restaurante", address: "Av. República do Líbano, 1500 - Setor Oeste, Goiânia - GO", cep: "74125-125" },
  { name: "Recanto do Sabor",         address: "Al. Ricardo Paranhos, 800 - Setor Marista, Goiânia - GO", cep: "74180-050" },
  { name: "Parrilla Del Sur",         address: "Av. 85, 990 - Setor Bueno, Goiânia - GO", cep: "74150-020" },
  { name: "Empório Girassol",         address: "R. 24, 45 - Setor Central, Goiânia - GO", cep: "74015-050" },
];

// --- 10 realistic users. Passwords are shown at the end so they can be tested. ---
const FREELANCERS = [
  { name: "Beatriz Almeida",   email: "beatriz.almeida@skalaup.com.br",   password: "Beatriz@2026",  transport: "own_car",        experience: "3 anos de recreação infantil e festas", score: 42, level: 4 },
  { name: "Rafael Souza",      email: "rafael.souza@skalaup.com.br",      password: "Rafael@2026",   transport: "motorcycle",     experience: "2 anos como monitor de buffet",         score: 28, level: 3 },
  { name: "Juliana Ferreira",  email: "juliana.ferreira@skalaup.com.br",  password: "Juliana@2026",  transport: "public_transit", experience: "Recreadora, 4 anos em eventos",         score: 55, level: 5 },
  { name: "Lucas Oliveira",    email: "lucas.oliveira@skalaup.com.br",    password: "Lucas@2026",    transport: "bike",           experience: "1 ano de experiência em recreação",     score: 12, level: 2 },
  { name: "Camila Rodrigues",  email: "camila.rodrigues@skalaup.com.br",  password: "Camila@2026",   transport: "own_car",        experience: "Pedagoga, 5 anos com crianças",         score: 61, level: 5 },
  { name: "Thiago Santos",     email: "thiago.santos@skalaup.com.br",     password: "Thiago@2026",   transport: "public_transit", experience: "Monitor de festas, 2 anos",             score: 20, level: 3 },
  { name: "Mariana Costa",     email: "mariana.costa@skalaup.com.br",     password: "Mariana@2026",  transport: "walk",           experience: "Recreadora iniciante",                  score: 6,  level: 1 },
];
const MANAGERS = [
  { name: "Patrícia Gomes",  email: "patricia.gomes@skalaup.com.br",  password: "Patricia@2026" },
  { name: "André Martins",   email: "andre.martins@skalaup.com.br",   password: "Andre@2026" },
];
const COORDINATORS = [
  { name: "Fernanda Ribeiro", email: "fernanda.ribeiro@skalaup.com.br", password: "Fernanda@2026" },
];

async function upsertUser({ name, email, password, role }) {
  const hash = await bcrypt.hash(password, 10);
  return one(
    `insert into public.users (name, email, password, role, status)
     values ($1,$2,$3,$4,'active')
     on conflict (email) do update set
       name = excluded.name, password = excluded.password,
       role = excluded.role, status = 'active'
     returning id, email, role`,
    [name, email, hash, role],
  );
}

async function main() {
  // 1) Restaurants (upsert by name; add cep on the ones we own).
  for (const r of RESTAURANTS) {
    const existing = await one(`select id from public.restaurants where name = $1`, [r.name]);
    if (existing) {
      await pool.query(`update public.restaurants set address = $2, cep = $3, active = true where id = $1`,
        [existing.id, r.address, r.cep]);
    } else {
      await pool.query(`insert into public.restaurants (name, address, cep, active) values ($1,$2,$3,true)`,
        [r.name, r.address, r.cep]);
    }
  }

  // ALL active restaurants (the 5 new + any pre-existing) — links span everything.
  const { rows: allRests } = await pool.query(
    `select id, name from public.restaurants where active = true order by created_at asc`);
  const n = allRests.length;

  // 2) Coordinator (oversees everything — no per-restaurant link needed).
  for (const c of COORDINATORS) await upsertUser({ ...c, role: "coordinator" });

  // 3) Managers — split all restaurants between them so every venue has a manager.
  const mgrIds = [];
  for (const m of MANAGERS) {
    const u = await upsertUser({ ...m, role: "restaurant_manager" });
    mgrIds.push(u.id);
  }
  for (let ri = 0; ri < n; ri++) {
    const managerId = mgrIds[ri % mgrIds.length];
    await pool.query(
      `insert into public.manager_assignments (manager_user_id, restaurant_id)
       values ($1,$2) on conflict (manager_user_id, restaurant_id) do nothing`,
      [managerId, allRests[ri].id]);
  }

  // 4) Freelancers — profile + linked to 3 restaurants each (round-robin), so every
  //    restaurant gets candidates and some freelancers cover multiple venues.
  for (let fi = 0; fi < FREELANCERS.length; fi++) {
    const f = FREELANCERS[fi];
    const u = await upsertUser({ ...f, role: "freelancer" });
    await pool.query(
      `insert into public.freelancer_profiles
         (user_id, member_type, transport, experience, current_score, current_level)
       values ($1,'member',$2,$3,$4,$5)
       on conflict (user_id) do update set
         transport = excluded.transport, experience = excluded.experience,
         current_score = excluded.current_score, current_level = excluded.current_level`,
      [u.id, f.transport, f.experience, f.score, f.level]);
    for (let k = 0; k < 3; k++) {
      const rest = allRests[(fi + k) % n];
      await pool.query(
        `insert into public.member_clients (member_user_id, restaurant_id)
         values ($1,$2) on conflict (member_user_id, restaurant_id) do nothing`,
        [u.id, rest.id]);
    }
  }

  // --- Report ---
  const all = [
    ...COORDINATORS.map((u) => ({ ...u, role: "coordinator" })),
    ...MANAGERS.map((u) => ({ ...u, role: "restaurant_manager" })),
    ...FREELANCERS.map((u) => ({ ...u, role: "freelancer" })),
  ];
  console.log(`\nRestaurants (${n} total active):`);
  allRests.forEach((r) => console.log(`  • ${r.name}`));
  console.log(`\n10 users created (all status = active):\n`);
  console.log(`  ROLE                EMAIL                                 PASSWORD`);
  for (const u of all) {
    console.log(`  ${u.role.padEnd(18)}  ${u.email.padEnd(36)}  ${u.password}`);
  }
  console.log(`\nFreelancers are linked to 3 restaurants each; managers split all venues.`);
  await pool.end();
}

main().catch((e) => { console.error("seed_realistic failed:", e.message); process.exit(1); });
