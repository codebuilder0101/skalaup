// Applies the SkalaUp schema to the configured PostgreSQL database.
// The schema lives in ../../supabase/skalaup_schema.sql and is portable:
// its RLS block is guarded to run only on Supabase (where the `authenticated`
// role exists), so it is a no-op on standalone PostgreSQL.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "..", "..", "supabase", "skalaup_schema.sql");

async function main() {
  const sql = readFileSync(schemaPath, "utf8");
  console.log(`Applying schema from ${schemaPath} ...`);
  await pool.query(sql);
  console.log("Schema applied successfully.");
  await pool.end();
}

main().catch((e) => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});
