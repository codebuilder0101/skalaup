import { chromium } from "playwright-core";
import fs from "node:fs";

const API = "http://localhost:4000/api";        // node-side calls hit the API directly
const APP = "https://skalaup.com.br";           // browser hits the real vhost (mapped to 127.0.0.1)
const OUT = "/tmp/claude-0/-var-www-skalaup/91f1a98f-b223-4314-891c-a3ddf5f24657/scratchpad/screenshots";
const EXEC = "/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";
fs.mkdirSync(OUT, { recursive: true });

async function login(email, password) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json());
}

const shots = [];
async function snap(page, name) {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  shots.push(path);
  console.log("  📸", path);
}

async function main() {
  const coord = await login("coordinator@skalaup.app", "coordinator123");
  const carla = await login("freelancer@skalaup.app", "freelancer123");
  // Carla's public rating token
  const frs = await (await fetch(`${API}/freelancers`, { headers: { Authorization: `Bearer ${coord.token}` } })).json();
  const carlaFr = frs.find((f) => f.name === "Freelancer Carla");
  const rateToken = carlaFr?.profile?.publicRatingToken;
  console.log("carla rate token:", rateToken);

  const browser = await chromium.launch({
    executablePath: EXEC,
    args: [
      "--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors",
      "--host-resolver-rules=MAP skalaup.com.br 127.0.0.1, MAP www.skalaup.com.br 127.0.0.1",
    ],
  });

  // ---- Public rating page (mobile, no auth) ----
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
  const mp = await mob.newPage();
  await mp.goto(`${APP}/rate/${rateToken}`, { waitUntil: "networkidle" });
  await mp.waitForTimeout(800);
  await snap(mp, "01-public-rating-page");
  // pick 5 stars + comment to show filled state
  const stars = mp.locator('button[aria-label="5"]');
  if (await stars.count()) { await stars.first().click(); await mp.waitForTimeout(200); }
  await mp.locator("textarea").first().fill("Ótimo atendimento, super atenciosa!");
  await mp.waitForTimeout(200);
  await snap(mp, "02-public-rating-filled");
  await mob.close();

  // ---- Login page (desktop, no auth) ----
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const lp = await desk.newPage();
  await lp.goto(`${APP}/auth`, { waitUntil: "networkidle" });
  await lp.waitForTimeout(600);
  await snap(lp, "03-login");
  await lp.close();

  // ---- Coordinator context (token injected) ----
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript((tok) => localStorage.setItem("skalaup-token", tok), coord.token);
  const p = await ctx.newPage();

  // Freelancers roster (Pontos/QR buttons, Inativo badge + Reativar, banks/scores)
  await p.goto(`${APP}/freelancers`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  await snap(p, "04-freelancers-roster");

  // Manual score dialog (on Beatriz)
  const beaCard = p.locator("div.p-4", { hasText: "Beatriz Almeida" }).first();
  await beaCard.getByRole("button", { name: "Pontos" }).click();
  await p.waitForTimeout(500);
  await p.locator('input[type="number"]').first().fill("4");
  await p.locator("textarea").first().fill("Excelente desempenho na semana");
  await p.waitForTimeout(300);
  await snap(p, "05-manual-score-dialog");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);

  // QR dialog (on Carla — has customer ratings)
  const carlaCard = p.locator("div.p-4", { hasText: "Freelancer Carla" }).first();
  await carlaCard.getByRole("button", { name: "QR" }).click();
  await p.waitForTimeout(1200);
  await snap(p, "06-qr-dialog");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);

  // Financial — paid month (2026-05)
  await p.goto(`${APP}/financial`, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  await p.locator('input[type="month"]').fill("2026-05");
  await p.waitForTimeout(1500);
  await snap(p, "07-financial-paid");

  // Financial — current open month (shows Aberta + adjustment)
  const cur = new Date().toISOString().slice(0, 7);
  await p.locator('input[type="month"]').fill(cur);
  await p.waitForTimeout(1500);
  await snap(p, "08-financial-open");

  // Settings — score config incl. manual cap
  await p.goto(`${APP}/settings`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1000);
  await snap(p, "09-settings-score");

  await ctx.close();

  // ---- Freelancer (Carla) context — performance with manual adjustment ----
  const fctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  await fctx.addInitScript((tok) => localStorage.setItem("skalaup-token", tok), carla.token);
  const fp = await fctx.newPage();
  await fp.goto(`${APP}/performance`, { waitUntil: "networkidle" });
  await fp.waitForTimeout(1200);
  await snap(fp, "10-performance-manual-score");
  await fctx.close();

  await browser.close();
  console.log("\nALL SHOTS:");
  shots.forEach((s) => console.log(s));
}

main().catch((e) => { console.error("SHOTS FAILED:", e.stack || e.message); process.exit(1); });
