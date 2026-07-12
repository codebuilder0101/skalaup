import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

// Return PostgreSQL `date` columns (OID 1082) as the raw "YYYY-MM-DD" string
// instead of a JS Date. node-postgres otherwise parses a `date` into a Date at
// the server's LOCAL midnight; on a host whose timezone is at/ahead of UTC
// (e.g. UTC+1/+2), res.json()'s toISOString() then rolls it back to the previous
// calendar day — so an availability marked for the 9th round-tripped as the 8th.
// A calendar date has no timezone; keeping it as a plain string is correct and
// makes every `date` column timezone-independent across all endpoints.
pg.types.setTypeParser(1082, (v) => v);

// Standalone PostgreSQL connection pool (no Supabase).
// Configure via DATABASE_URL or the discrete PG* vars in server/.env.
const connectionString = process.env.DATABASE_URL;

export const pool = connectionString
  ? new pg.Pool({ connectionString })
  : new pg.Pool({
      host: process.env.PGHOST || "127.0.0.1",
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "postgres",
      database: process.env.PGDATABASE || "skalaup",
    });

export async function query(text, params) {
  return pool.query(text, params);
}

// Small helper: first row or null.
export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}
