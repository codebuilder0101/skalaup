import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

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
