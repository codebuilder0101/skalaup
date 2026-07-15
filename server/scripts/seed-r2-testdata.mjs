// One-off: seed test data for the Round-2 features via the HTTP API (no direct DB
// writes). Idempotent-ish: re-running re-applies profile fields; ratings/payroll may
// accumulate. Safe test accounts only. Usage: node scripts/seed-r2-testdata.mjs
const BASE = process.env.API_BASE || "http://localhost:4000/api";
const TODAY = new Date().toISOString().slice(0, 10);          // e.g. 2026-07-15
const TODAY_MMDD = TODAY.slice(5);                            // 07-15

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return data;
}

const log = (...a) => console.log("•", ...a);

async function main() {
  const { token } = await api("POST", "/auth/login", { email: "coordinator@skalaup.app", password: "coordinator123" });
  log("logged in as coordinator");

  const freelancers = await api("GET", "/freelancers", null, token);
  const byName = (n) => freelancers.find((f) => f.name === n);

  // 1) Bank + PIX + birth dates. One freelancer's birthday is TODAY (birthday alert).
  const profiles = [
    { name: "Beatriz Almeida",     bankName: "Nubank",    pixKey: "beatriz@email.com",    birthDate: `1995-${TODAY_MMDD}` }, // birthday today
    { name: "Brincador Eduardo",   bankName: "Itaú",      pixKey: "111.222.333-44",       birthDate: "1990-03-22" },
    { name: "Brincador Gabriel",   bankName: "Bradesco",  pixKey: "(11) 98888-7777",      birthDate: "1998-11-05" },
    { name: "Brincadora Fernanda", bankName: "Caixa",     pixKey: "a1b2c3d4-aleatoria",    birthDate: "1993-06-30" },
    { name: "Camila Rodrigues",    bankName: "Santander", pixKey: "camila.r@email.com",    birthDate: "1996-09-12" },
    { name: "Freelancer Carla",    bankName: "Nubank",    pixKey: "carla.freela@email.com", birthDate: "1994-01-20" },
  ];
  for (const p of profiles) {
    const f = byName(p.name);
    if (!f) { log("skip (not found):", p.name); continue; }
    await api("PUT", `/freelancers/${f.id}`, { bankName: p.bankName, pixKey: p.pixKey, birthDate: p.birthDate }, token);
    log("profile set:", p.name, `bank=${p.bankName} birth=${p.birthDate}`);
  }

  // 2) Inactivate one freelancer so the "Reativar" flow can be shown.
  const igor = byName("Brincador Igor");
  if (igor) { await api("PUT", `/freelancers/${igor.id}/status`, { status: "inactive" }, token); log("inactivated:", igor.name); }

  // 3) Manual score adjustments (positive-only, capped) on Carla.
  const carla = byName("Freelancer Carla");
  if (carla) {
    for (const m of [{ points: 3, notes: "Ajudou na integração de novos freelas" }, { points: 2, notes: "Elogio do cliente na recepção" }]) {
      try {
        await api("POST", "/score/events", { userId: carla.id, eventType: "manual_adjustment", occurredOn: TODAY, points: m.points, notes: m.notes }, token);
        log("manual score:", `+${m.points}`, m.notes);
      } catch (e) { log("manual score skipped:", e.message); }
    }
  }

  // 4) Public (QR) customer ratings — informational only. Different device per row.
  const ratingsFor = [
    { name: "Freelancer Carla", ratings: [
      { stars: 5, comment: "Atendimento excelente, muito atenciosa!" },
      { stars: 5, comment: "Super simpática com as crianças." },
      { stars: 4, comment: "Muito boa, só demorou um pouco." },
      { stars: 5, comment: "Recomendo!" },
    ] },
    { name: "Beatriz Almeida", ratings: [
      { stars: 5, comment: "Profissional nota 10." },
      { stars: 4, comment: "Gostei bastante." },
    ] },
  ];
  for (const r of ratingsFor) {
    const f = byName(r.name);
    const tok = f?.profile?.publicRatingToken;
    if (!tok) { log("no token for ratings:", r.name); continue; }
    let i = 0;
    for (const rt of r.ratings) {
      try {
        await api("POST", `/public/ratings/${tok}`, { stars: rt.stars, comment: rt.comment, deviceHash: `seed-${f.id.slice(0, 8)}-${i++}` });
      } catch (e) { /* 409 on re-run is fine */ }
    }
    log("ratings seeded:", r.name, `(${r.ratings.length})`);
  }

  // 5) Payroll: a past test month (2026-05) → add adjustments, close, mark PAID.
  const PAID_MONTH = "2026-05";
  if (carla && igor) {
    await api("POST", "/payroll/entries", { month: PAID_MONTH, userId: carla.id, amount: 480, notes: "Turnos de maio (teste)" }, token);
    await api("POST", "/payroll/entries", { month: PAID_MONTH, userId: byName("Beatriz Almeida").id, amount: 360, notes: "Turnos de maio (teste)" }, token);
    log("payroll entries added for", PAID_MONTH);
    try { await api("POST", "/payroll/close", { month: PAID_MONTH }, token); log("closed", PAID_MONTH); } catch (e) { log("close:", e.message); }
    try { await api("POST", "/payroll/mark-paid", { month: PAID_MONTH }, token); log("marked PAID", PAID_MONTH); } catch (e) { log("mark-paid:", e.message); }
  }

  // A current-month adjustment so the open folha has data to show too.
  const CUR = TODAY.slice(0, 7);
  if (carla) {
    try { await api("POST", "/payroll/entries", { month: CUR, userId: carla.id, amount: 120, notes: "Bonificação (teste)" }, token); log("current-month entry added", CUR); }
    catch (e) { log("current entry:", e.message); }
  }

  log("DONE");
}

main().catch((e) => { console.error("SEED FAILED:", e.message); process.exit(1); });
