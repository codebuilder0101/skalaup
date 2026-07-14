// Manual push tester (R13). Fire a web-push to a user's registered devices so
// you can confirm on-device delivery without triggering a real business event.
//
// Usage (from the server/ directory):
//   node scripts/test-push.js --list                 # who has push enabled
//   node scripts/test-push.js <email>                # push to that user
//   node scripts/test-push.js <email> "Custom text"  # push with custom body
//
// It reuses the app's own push.js/sendPush, so VAPID config + subscription
// storage are exactly what production uses.
import "dotenv/config";
import { pool } from "../src/db.js";
import { sendPush, pushPublicKey } from "../src/push.js";

async function main() {
  const args = process.argv.slice(2);

  if (pushPublicKey === null) {
    console.error("✗ Web push is DISABLED — VAPID keys are not set in server/.env. Aborting.");
    process.exit(1);
  }

  if (args[0] === "--list" || args.length === 0) {
    const { rows } = await pool.query(
      `select u.email, u.name, count(d.token)::int as devices
         from public.users u
         join public.device_tokens d on d.user_id = u.id and d.platform = 'web'
        group by u.email, u.name
        order by u.email`,
    );
    if (rows.length === 0) {
      console.log("No users have web push enabled yet. Have someone install the app and toggle notifications on in Configurações.");
    } else {
      console.log("Users with web push enabled:");
      for (const r of rows) console.log(`  • ${r.email}  (${r.name}) — ${r.devices} device(s)`);
    }
    console.log("\nTo send a test: node scripts/test-push.js <email>");
    await pool.end();
    return;
  }

  const email = args[0];
  const body = args[1] || "Notificação de teste do SkalaUp ✅ — se você está vendo isso, o push está funcionando!";

  const { rows } = await pool.query(
    `select id, name from public.users where lower(email) = lower($1)`, [email],
  );
  if (rows.length === 0) {
    console.error(`✗ No user found with email: ${email}`);
    process.exit(1);
  }
  const user = rows[0];

  const { rows: devices } = await pool.query(
    `select count(*)::int as n from public.device_tokens where user_id = $1 and platform = 'web'`, [user.id],
  );
  if (devices[0].n === 0) {
    console.error(`✗ ${user.name} (${email}) has NO web push devices registered.`);
    console.error("  → On the phone: install the app to the home screen, open it, then Configurações → ativar notificações → Permitir.");
    process.exit(1);
  }

  console.log(`Sending test push to ${user.name} (${email}) — ${devices[0].n} device(s)…`);
  await sendPush(user.id, {
    title: "SkalaUp",
    body,
    url: "/notifications",
    tag: "test",
  });
  console.log("✓ Push dispatched. Check the phone (notification should appear within a few seconds).");
  console.log("  If nothing arrives: confirm the app was opened from the home-screen icon and permission is 'Permitir'.");
  await pool.end();
}

main().catch((e) => {
  console.error("test-push failed:", e.message);
  process.exit(1);
});
