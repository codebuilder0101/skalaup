# SkalaUp — Running on standalone PostgreSQL (no Supabase)

The app now runs on a **local PostgreSQL** database via a **Node/Express + `pg`** backend.
The browser talks to the backend API; the backend talks to PostgreSQL. Supabase is no
longer used anywhere.

```
React (Vite)  ──HTTP──►  server/ (Express + pg)  ──SQL──►  PostgreSQL 16
  src/lib/api.ts            http://localhost:4000           127.0.0.1:5433  db "skalaup"
```

## What's installed on this machine
- **PostgreSQL 16.4** (portable binaries): `C:\Users\Administrator\skalaup-pg\pgsql\bin`
- **Data directory**: `C:\Users\Administrator\skalaup-pg\data`  (trust auth, local dev)
- **Port**: `5433` (5432 was already in use), database `skalaup`
- Log file: `C:\Users\Administrator\skalaup-pg\pg.log`

## 1. Start PostgreSQL (if not already running)
Easiest — run the helper script from the repo root:
```powershell
./start-postgres.ps1
```
Or manually:
```powershell
& "C:\Users\Administrator\skalaup-pg\pgsql\bin\pg_ctl.exe" -D "C:\Users\Administrator\skalaup-pg\data" -l "C:\Users\Administrator\skalaup-pg\pg.log" -o "-p 5433" start
# status / stop:
& "C:\Users\Administrator\skalaup-pg\pgsql\bin\pg_ctl.exe" -D "C:\Users\Administrator\skalaup-pg\data" status
& "C:\Users\Administrator\skalaup-pg\pgsql\bin\pg_ctl.exe" -D "C:\Users\Administrator\skalaup-pg\data" stop
```
> It is **not** a Windows service, so **after every reboot you must start it again** (run `./start-postgres.ps1`).
> To auto-start it on boot instead, register it as a service (needs admin):
> `pg_ctl register -N skalaup-postgres -D <data> -S auto -o "-p 5433"` then `Start-Service skalaup-postgres`.

## 2. Backend API  (`server/`)
Config is in `server/.env` (already set: host 127.0.0.1, port 5433, db skalaup, JWT secret).

```bash
cd server
npm install          # first time only
npm run migrate      # apply supabase/skalaup_schema.sql to the DB (idempotent)
npm run seed         # create coordinator login + 3 sample restaurants (idempotent)
npm start            # API on http://localhost:4000
```

Health check: `GET http://localhost:4000/api/health` → `{"ok":true,"db":"postgresql"}`

## 3. Frontend  (project root)
`.env` has `VITE_API_URL=http://localhost:4000/api`.
```bash
npm run dev          # Vite dev server (default http://localhost:5173)
```

## Seed logins (one per role, all sign-in-ready) — `npm run seed`
Login is by **email**.

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| **administrator** | `admin@gmail.com` | `admin` | **Only role that can approve/reject sign-ups** (`/approvals`). Superset of coordinator. |
| coordinator | `coordinator@skalaup.app` | `coordinator123` | Operations (scheduling, restaurants, freelancers…). **Cannot** see Approvals. |
| restaurant_manager | `manager@skalaup.app` | `manager123` | Linked to *Restaurante Centro*. |
| freelancer | `freelancer@skalaup.app` | `freelancer123` | Has a profile ficha. |
| visitor | `visitor@skalaup.app` | `visitor123` | Temporary access. |

### Roles & approvals
- **administrator** manages WHO gets access: new sign-ups arrive as `pending` and cannot log
  in until an administrator **approves** them (Reject blocks access). Approvals live at
  `/approvals` (sidebar → System → Aprovações) and are **administrator-only** — coordinators
  do not see them.
- **coordinator** runs operations but has no user-approval powers.
- Self sign-up may request `freelancer`, `restaurant_manager`, or `coordinator` (never
  `administrator`); every request still needs administrator approval.

## Schema / migrations
- Single source of truth: [supabase/skalaup_schema.sql](supabase/skalaup_schema.sql) (plain PostgreSQL;
  the Supabase-only RLS block auto-skips on standalone Postgres). Re-run with `npm run migrate`.
- The `supabase/*_table.sql` files are the **old medical** schema and are no longer used.

## Notes
- Passwords are stored as bcrypt hashes in `public.users`. The login also accepts a plaintext
  match on first run for convenience; create real users via `POST /api/auth/register`.
- Implemented API routes: `/api/auth/*`, `/api/restaurants/*`, `/api/freelancers/*`.
  Routes for availability / assignments / score are stubbed on the frontend data layer and
  are added as those screens are built.
