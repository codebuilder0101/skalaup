-- =============================================================================
-- SkalaUp — Shift / Schedule Management for Recreation Freelancers ("Brincadores")
-- Complete PostgreSQL schema, derived from requirement.pdf (v1.0, Jun/2026).
--
-- Conventions (match existing supabase/*.sql):
--   * uuid primary keys via gen_random_uuid() (pgcrypto)
--   * created_at / updated_at timestamptz, updated_at maintained by trigger
--   * enums modelled as text + CHECK constraints
--   * jsonb for flexible lists; numeric for money/score
--   * Row Level Security enabled with permissive policies (anon, authenticated),
--     mirroring the existing project. TIGHTEN per-role before production.
--
-- Resolved ambiguities (see requirement contradictions):
--   * Bonus per shift = R$ 75.00  (§8.1/§8.2 + worked example "Maria"; §13 "R$90"
--     treated as a typo). Configurable via app_settings.
--   * Lateness has 4 tiers incl. "critical" (>30 min, -8) per the §9.1 score table.
--   * Star-level cutoffs are nullable (defined after first months — §9.3).
--   * 3-month weighted classification: weights are app-side & configurable
--     (default 3 / 2 / 1, newest month heaviest).
--
-- Run order: this single file creates everything in dependency order.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Shared updated_at trigger function
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- 1. GLOBAL CONFIGURATION (§8.1, §8.4, §2.1, §6, §9.3)
-- =============================================================================
create table if not exists public.app_settings (
  id                          smallint primary key default 1 check (id = 1), -- singleton
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  base_pay_per_shift          numeric(10,2) not null default 60.00,   -- §8.1
  bonus_pay_per_shift         numeric(10,2) not null default 75.00,   -- §8.1/§8.2
  weekend_bonus_enabled       boolean not null default true,

  late_discount_amount        numeric(10,2) not null default 0.00,    -- applied on 3rd late (§5)
  no_show_discount_mode       text not null default 'highest_shift'
                               check (no_show_discount_mode in ('highest_shift','base_shift','custom')),
  no_show_custom_amount       numeric(10,2),

  checkin_open_minutes_before integer not null default 15,            -- §4
  checkout_reminder_minutes   integer not null default 15,            -- §4 "X minutes"
  early_arrival_target_min    integer not null default 10,            -- §4.1
  absence_grace_minutes       integer not null default 0,             -- §4 no-check-in cutoff

  availability_open_day       smallint not null default 20,           -- §2.1
  availability_close_day      smallint not null default 25,           -- §2.1

  monthly_target_shifts       integer not null default 10,            -- §8.1 (+5 pts)
  swap_scoring_cap            integer not null default 3,             -- §6
  feedback_coverage_pct       numeric(4,2) not null default 0.40,     -- §9.3 (40% rule)
  classification_month_weights jsonb not null default '[3,2,1]'::jsonb, -- §9 weighted avg (newest first)
  flexible_availability_points numeric(6,2) not null default 2          -- reward for "any restaurant" per cycle
);

drop trigger if exists trg_app_settings_updated_at on public.app_settings;
create trigger trg_app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 2. USERS (§2) — all four profiles authenticate here
-- =============================================================================
create table if not exists public.users (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  name                   text not null,
  email                  text not null unique,
  password               text not null,                              -- hashed
  phone                  text,

  role                   text not null
                          check (role in ('administrator','coordinator','restaurant_manager','freelancer','visitor')),
  status                 text not null default 'active'
                          check (status in ('active','inactive','pending','rejected')),

  visitor_expires_at     timestamptz,                                -- §2.2 temporary access
  promoted_to_member_at  timestamptz                                 -- §2.2 visitor -> member
);

create index if not exists idx_users_email on public.users(email);
create index if not exists idx_users_role  on public.users(role);

-- Coordinator-created accounts get a temporary password and must change it on
-- first login (FR-B4). Idempotent for existing databases.
alter table public.users add column if not exists must_change_password boolean not null default false;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 3. RESTAURANTS (§1, §3.5, §8.1, §14)
-- =============================================================================
create table if not exists public.restaurants (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  name                   text not null,
  address                text,
  cep                    text,                                       -- postal code (registration)
  cnpj                   text,                                       -- company tax id (registration)
  latitude               numeric(9,6),                               -- geofenced check-in
  longitude              numeric(9,6),
  geofence_radius_m      integer not null default 150,
  timezone               text not null default 'America/Sao_Paulo',

  -- per-restaurant overrides of the global compensation config (nullable = use global)
  base_pay_per_shift     numeric(10,2),
  bonus_pay_per_shift    numeric(10,2),
  late_discount_amount   numeric(10,2),
  no_show_discount_mode  text check (no_show_discount_mode in ('highest_shift','base_shift','custom')),

  active                 boolean not null default true
);

create index if not exists idx_restaurants_active on public.restaurants(active);

-- Per-restaurant overrides added after the original table shipped (idempotent):
--   no_show_custom_amount   used when no_show_discount_mode = 'custom' (FR-C3)
--   weekend_bonus_enabled   per-restaurant weekend bonus toggle (nullable = inherit global §8.2)
alter table public.restaurants add column if not exists no_show_custom_amount numeric(10,2);
alter table public.restaurants add column if not exists weekend_bonus_enabled boolean;

drop trigger if exists trg_restaurants_updated_at on public.restaurants;
create trigger trg_restaurants_updated_at before update on public.restaurants
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 4. FREELANCER PROFILES (§2.1, §2.4 "ficha")
-- =============================================================================
create table if not exists public.freelancer_profiles (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  user_id            uuid not null unique references public.users(id) on delete cascade,
  member_type        text not null default 'member'
                      check (member_type in ('member','visitor')),
  photo_url          text,

  cpf                text,                                           -- individual tax id (registration)
  pix_key            text,                                           -- PIX payment key (registration)
  whatsapp           text,                                           -- WhatsApp contact (registration)

  home_address       text,
  home_cep           text,                                           -- postal code for home address
  home_latitude      numeric(9,6),
  home_longitude     numeric(9,6),
  transport          text check (transport in
                       ('own_car','motorcycle','public_transit','bike','walk','other')),
  experience         text,
  hire_date          date,

  current_score      numeric(8,2) not null default 0,                -- cached sum(score_events)
  current_level      smallint check (current_level between 1 and 5), -- cached from score_levels
  notes              text
);

create index if not exists idx_freelancer_profiles_user  on public.freelancer_profiles(user_id);
create index if not exists idx_freelancer_profiles_score on public.freelancer_profiles(current_score desc);

drop trigger if exists trg_freelancer_profiles_updated_at on public.freelancer_profiles;
create trigger trg_freelancer_profiles_updated_at before update on public.freelancer_profiles
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 5. MANAGER ASSIGNMENTS (§2.3) — which restaurant(s) a manager can see
-- =============================================================================
create table if not exists public.manager_assignments (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  manager_user_id  uuid not null references public.users(id) on delete cascade,
  restaurant_id    uuid not null references public.restaurants(id) on delete cascade,
  unique (manager_user_id, restaurant_id)
);

create index if not exists idx_manager_assignments_restaurant on public.manager_assignments(restaurant_id);

-- Member ↔ client links (§3): which clients (restaurants) a member may work for.
-- Gates participation — a member only sees/submits availability for linked clients.
create table if not exists public.member_clients (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  member_user_id   uuid not null references public.users(id) on delete cascade,
  restaurant_id    uuid not null references public.restaurants(id) on delete cascade,
  unique (member_user_id, restaurant_id)
);

create index if not exists idx_member_clients_member on public.member_clients(member_user_id);
create index if not exists idx_member_clients_restaurant on public.member_clients(restaurant_id);

-- =============================================================================
-- 6. SHIFT TEMPLATES (§8.1) — default hours per restaurant/shift
-- =============================================================================
create table if not exists public.shift_templates (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  shift_type     text not null check (shift_type in ('lunch','dinner')),
  label          text,                                            -- optional name to distinguish staggered slots
  start_time     time not null,
  end_time       time not null
);

-- A restaurant may now have MULTIPLE staggered slots per meal period (e.g. an
-- 11:00 and a 12:00 lunch). Drop the old one-row-per-(restaurant,shift) limit and
-- prevent only exact-duplicate time windows. Idempotent for existing databases.
alter table public.shift_templates drop constraint if exists shift_templates_restaurant_id_shift_type_key;
alter table public.shift_templates add column if not exists label text;
create unique index if not exists shift_templates_rest_type_times_uidx
  on public.shift_templates (restaurant_id, shift_type, start_time, end_time);

-- =============================================================================
-- 7. RESTAURANT DEMAND (§3.5) — contracted base demand per weekday/shift
-- =============================================================================
create table if not exists public.restaurant_demand (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  weekday         smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  shift_type      text not null check (shift_type in ('lunch','dinner')),
  required_count  integer not null check (required_count >= 0),
  unique (restaurant_id, weekday, shift_type)
);

drop trigger if exists trg_restaurant_demand_updated_at on public.restaurant_demand;
create trigger trg_restaurant_demand_updated_at before update on public.restaurant_demand
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 8. DEMAND OVERRIDES (§2.5, §3.5) — holidays / extra events
-- =============================================================================
create table if not exists public.demand_overrides (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  date            date not null,
  shift_type      text not null check (shift_type in ('lunch','dinner')),
  required_count  integer not null check (required_count >= 0),
  reason          text,
  created_by      uuid references public.users(id) on delete set null,
  unique (restaurant_id, date, shift_type)
);

create index if not exists idx_demand_overrides_date on public.demand_overrides(date);

-- =============================================================================
-- 9. AVAILABILITY CYCLES (§2.1) — monthly cycle window
-- =============================================================================
create table if not exists public.availability_cycles (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  reference_month  date not null unique,                  -- first day of the target month
  opens_at         timestamptz not null,                  -- ~day 20
  closes_at        timestamptz not null,                  -- ~day 25
  status           text not null default 'open'
                    check (status in ('open','closed','published')),
  reopened         boolean not null default false,        -- coordinator can reopen (§2.1)
  published_at     timestamptz
);

drop trigger if exists trg_availability_cycles_updated_at on public.availability_cycles;
create trigger trg_availability_cycles_updated_at before update on public.availability_cycles
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 10. AVAILABILITY SUBMISSIONS (§2.2) — one row per day/shift/restaurant preference
-- =============================================================================
create table if not exists public.availability_submissions (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  cycle_id         uuid not null references public.availability_cycles(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  date             date not null,
  shift_type       text not null check (shift_type in ('lunch','dinner')),
  -- NULL restaurant = "any restaurant / no preference" (§3.2, flexibility reward).
  restaurant_id    uuid references public.restaurants(id) on delete cascade,
  preference_rank  smallint,                              -- optional ordering when multiple
  status           text not null default 'submitted'
                    check (status in ('submitted','cancelled')),
  cancelled_at     timestamptz,
  unique (cycle_id, user_id, date, shift_type, restaurant_id)
);

create index if not exists idx_avail_sub_cycle on public.availability_submissions(cycle_id);
create index if not exists idx_avail_sub_slot  on public.availability_submissions(date, shift_type, restaurant_id);
create index if not exists idx_avail_sub_user  on public.availability_submissions(user_id);
-- One "any restaurant" row per (cycle, user, date, shift); the named unique above
-- treats NULLs as distinct, so a partial unique index enforces it.
create unique index if not exists uniq_avail_sub_any
  on public.availability_submissions (cycle_id, user_id, date, shift_type)
  where restaurant_id is null;

-- Granular reopen exceptions (§3.1): when a cycle is closed, the coordinator may
-- reopen it for a single restaurant OR a single freelancer. A row here whitelists
-- that target so its submissions are accepted even while the cycle is closed.
create table if not exists public.availability_reopens (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  cycle_id       uuid not null references public.availability_cycles(id) on delete cascade,
  restaurant_id  uuid references public.restaurants(id) on delete cascade,
  user_id        uuid references public.users(id) on delete cascade,
  created_by     uuid references public.users(id) on delete set null,
  -- exactly one target: a restaurant OR a freelancer
  constraint availability_reopens_one_target
    check ((restaurant_id is not null) <> (user_id is not null))
);
create unique index if not exists idx_reopen_restaurant
  on public.availability_reopens(cycle_id, restaurant_id) where restaurant_id is not null;
create unique index if not exists idx_reopen_user
  on public.availability_reopens(cycle_id, user_id) where user_id is not null;

-- =============================================================================
-- 11. SCHEDULE ASSIGNMENTS (§3.3) — the published escala (one freelancer / shift)
-- =============================================================================
create table if not exists public.schedule_assignments (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  cycle_id              uuid references public.availability_cycles(id) on delete set null,
  restaurant_id         uuid not null references public.restaurants(id) on delete restrict,
  user_id               uuid not null references public.users(id) on delete restrict,
  date                  date not null,
  shift_type            text not null check (shift_type in ('lunch','dinner')),
  start_time            time not null,
  end_time              time not null,
  status                text not null default 'draft'
                         check (status in ('draft','published','cancelled')),
  is_weekend_mandatory  boolean not null default false,  -- one of the 4 bonus shifts (§7.1/§8.2)
  pay_rate_applied      numeric(10,2),                   -- 60 or 75, resolved at payroll
  bonus_applied         boolean not null default false,
  assigned_via          text not null default 'coordinator'
                         check (assigned_via in ('coordinator','waiting_list','swap','manager')),
  created_by            uuid references public.users(id) on delete set null,
  published_at          timestamptz,
  -- prevent the exact same freelancer being scheduled twice in the same slot
  unique (user_id, date, shift_type)
);

create index if not exists idx_assign_slot on public.schedule_assignments(date, shift_type, restaurant_id);
create index if not exists idx_assign_user on public.schedule_assignments(user_id, date);
create index if not exists idx_assign_cycle on public.schedule_assignments(cycle_id);

-- Restaurant managers may now fill their own restaurant's shifts, so assignments
-- can also be created 'manager'. Widen the check constraint idempotently for
-- databases created before this shipped.
alter table public.schedule_assignments drop constraint if exists schedule_assignments_assigned_via_check;
alter table public.schedule_assignments add constraint schedule_assignments_assigned_via_check
  check (assigned_via in ('coordinator','waiting_list','swap','manager'));

-- The plain unique(user_id,date,shift_type) also blocked CANCELLED rows, so once a
-- freelancer was removed from a slot they could not be re-added (breaks remove/
-- re-assign and waiting-list fill, §3.3/§3.4). Replace it with a partial unique
-- index that only constrains ACTIVE (non-cancelled) assignments. Idempotent.
alter table public.schedule_assignments drop constraint if exists schedule_assignments_user_id_date_shift_type_key;
create unique index if not exists uq_assign_active_user_slot
  on public.schedule_assignments(user_id, date, shift_type) where status <> 'cancelled';

drop trigger if exists trg_schedule_assignments_updated_at on public.schedule_assignments;
create trigger trg_schedule_assignments_updated_at before update on public.schedule_assignments
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 12. WAITING LIST (§3.4) — available-but-unscheduled, ordered by score
-- =============================================================================
create table if not exists public.waiting_list (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  cycle_id        uuid not null references public.availability_cycles(id) on delete cascade,
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  date            date not null,
  shift_type      text not null check (shift_type in ('lunch','dinner')),
  user_id         uuid not null references public.users(id) on delete cascade,
  score_snapshot  numeric(8,2) not null default 0,       -- ordering criterion (§3.4)
  position        integer,
  status          text not null default 'waiting'
                   check (status in ('waiting','promoted','expired')),
  unique (cycle_id, date, shift_type, restaurant_id, user_id)
);

create index if not exists idx_waiting_slot on public.waiting_list(date, shift_type, restaurant_id, score_snapshot desc);

-- =============================================================================
-- 13. SHIFT ATTENDANCE (§4, §4.1) — check-in / check-out + lateness
-- =============================================================================
create table if not exists public.shift_attendance (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  assignment_id          uuid not null unique references public.schedule_assignments(id) on delete cascade,
  user_id                uuid not null references public.users(id) on delete cascade,
  restaurant_id          uuid not null references public.restaurants(id) on delete cascade,
  scheduled_start        timestamptz not null,

  checkin_at             timestamptz,
  checkout_at            timestamptz,
  checkin_latitude       numeric(9,6),
  checkin_longitude      numeric(9,6),
  checkin_distance_m     numeric(10,2),
  checkin_method         text check (checkin_method in ('gps','manual')),

  lateness_minutes       integer,
  lateness_category      text not null default 'none'
                          check (lateness_category in ('none','light','moderate','severe','critical')),
  no_show                boolean not null default false,

  edited_by_coordinator  boolean not null default false,  -- §4 OBS (dead battery / app down)
  edited_by              uuid references public.users(id) on delete set null,
  edit_reason            text
);

create index if not exists idx_attendance_user on public.shift_attendance(user_id);
create index if not exists idx_attendance_restaurant on public.shift_attendance(restaurant_id);

drop trigger if exists trg_shift_attendance_updated_at on public.shift_attendance;
create trigger trg_shift_attendance_updated_at before update on public.shift_attendance
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 14. SHIFT SWAP REQUESTS (§6, §7.1)
-- =============================================================================
create table if not exists public.shift_swap_requests (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  assignment_id            uuid not null references public.schedule_assignments(id) on delete cascade,
  requester_user_id        uuid not null references public.users(id) on delete cascade,
  target_user_id           uuid references public.users(id) on delete set null,
  target_restaurant_id     uuid references public.restaurants(id) on delete set null, -- cross-restaurant
  status                   text not null default 'pending_target'
                            check (status in ('pending_target','pending_coordinator','approved','rejected','cancelled')),
  affects_weekend_bonus    boolean not null default false,  -- triggers R$75 loss alert (§7.1)
  bonus_loss_acknowledged  boolean not null default false,
  target_responded_at      timestamptz,
  coordinator_decision_by  uuid references public.users(id) on delete set null,
  coordinator_decision_at  timestamptz
);

create index if not exists idx_swap_requester on public.shift_swap_requests(requester_user_id);
create index if not exists idx_swap_target on public.shift_swap_requests(target_user_id);
create index if not exists idx_swap_status on public.shift_swap_requests(status);

drop trigger if exists trg_shift_swap_requests_updated_at on public.shift_swap_requests;
create trigger trg_shift_swap_requests_updated_at before update on public.shift_swap_requests
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 15. ABSENCES / NO-SHOWS (§5)
-- =============================================================================
create table if not exists public.absences (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  assignment_id         uuid not null references public.schedule_assignments(id) on delete cascade,
  user_id               uuid not null references public.users(id) on delete cascade,
  type                  text not null check (type in ('no_show_unjustified','justified')),
  occurrence_in_month   smallint,                          -- 1st / 2nd no-show logic (§5)
  justification_text    text,
  certificate_url       text,                              -- medical certificate (§5/§8.2)
  coordinator_decision  text not null default 'none'
                         check (coordinator_decision in ('none','forgive','cancel_remaining')),
  created_by            uuid references public.users(id) on delete set null
);

create index if not exists idx_absences_user on public.absences(user_id, created_at desc);

-- =============================================================================
-- 16. SCORE LEVELS (§9.3) — star tiers (cutoffs TBD)
-- =============================================================================
create table if not exists public.score_levels (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  level            smallint not null unique check (level between 1 and 5),
  name             text not null,
  min_score_cutoff numeric(8,2),                           -- nullable: defined after launch (§9.3)
  benefits         text
);

drop trigger if exists trg_score_levels_updated_at on public.score_levels;
create trigger trg_score_levels_updated_at before update on public.score_levels
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 17. SCORE EVENTS (§9.1) — append-only points ledger (source of truth)
-- =============================================================================
create table if not exists public.score_events (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  user_id         uuid not null references public.users(id) on delete cascade,
  event_type      text not null check (event_type in (
                     'target_10_shifts','swap_accepted','meeting','online_training',
                     'innovation_video','charity_event','inperson_training',
                     'feedback_fundamentos','feedback_proatividade','feedback_encantamento',
                     'feedback_extraordinario','late_light','late_moderate','late_severe',
                     'late_critical','swap_requested','no_show_unjustified','manual_adjustment',
                     'flexible_availability')),
  points          numeric(6,2) not null,                  -- supports -0.5
  reference_type  text check (reference_type in ('assignment','feedback','swap','engagement','absence','manual')),
  reference_id    uuid,
  occurred_on     date not null,
  month_ref       date not null,                          -- first day of month (for aggregation)
  created_by      uuid references public.users(id) on delete set null, -- coordinator for manual/edits
  is_voided       boolean not null default false,         -- coordinator can remove penalty (§9.1 OBS)
  notes           text
);

create index if not exists idx_score_events_user  on public.score_events(user_id);
create index if not exists idx_score_events_month on public.score_events(user_id, month_ref);

-- =============================================================================
-- 18. ENGAGEMENT EVENTS (§2.4, §9.1) — coordinator-logged activities
-- =============================================================================
create table if not exists public.engagement_events (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  user_id         uuid not null references public.users(id) on delete cascade,
  type            text not null check (type in
                    ('meeting','online_training','inperson_training','innovation_video','charity_event')),
  description     text,
  evidence_url    text,
  score_event_id  uuid references public.score_events(id) on delete set null,
  created_by      uuid references public.users(id) on delete set null
);

create index if not exists idx_engagement_user on public.engagement_events(user_id);

-- =============================================================================
-- 19. MONTHLY PERFORMANCE (aggregate cache for reports & 3-month weighting — §9)
-- =============================================================================
create table if not exists public.monthly_performance (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  month_ref     date not null,
  total_points  numeric(8,2) not null default 0,
  shifts_worked integer not null default 0,
  computed_at   timestamptz not null default now(),
  unique (user_id, month_ref)
);

-- =============================================================================
-- 20. MANAGER FEEDBACK (§10)
-- =============================================================================
create table if not exists public.manager_feedback (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  restaurant_id       uuid not null references public.restaurants(id) on delete cascade,
  manager_user_id     uuid not null references public.users(id) on delete cascade,
  freelancer_user_id  uuid not null references public.users(id) on delete cascade,
  assignment_id       uuid references public.schedule_assignments(id) on delete set null,
  stars               smallint not null check (stars between 1 and 5),
  justification       text not null,                       -- mandatory (§10.1)
  status              text not null default 'pending_validation'
                       check (status in ('pending_validation','validated','rejected')),
  category            text check (category in
                        ('fundamentos','proatividade','encantamento','extraordinario')), -- §10.2 (coordinator)
  points_awarded      numeric(4,2),
  validated_by        uuid references public.users(id) on delete set null,
  validated_at        timestamptz,
  score_event_id      uuid references public.score_events(id) on delete set null
);

create index if not exists idx_feedback_freelancer on public.manager_feedback(freelancer_user_id);
create index if not exists idx_feedback_status on public.manager_feedback(status);

drop trigger if exists trg_manager_feedback_updated_at on public.manager_feedback;
create trigger trg_manager_feedback_updated_at before update on public.manager_feedback
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 21. FEEDBACK REQUESTS (§9.3) — 40% coverage targeting
-- =============================================================================
create table if not exists public.feedback_requests (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  restaurant_id       uuid not null references public.restaurants(id) on delete cascade,
  manager_user_id     uuid not null references public.users(id) on delete cascade,
  freelancer_user_id  uuid not null references public.users(id) on delete cascade,
  assignment_id       uuid references public.schedule_assignments(id) on delete set null,
  month_ref           date not null,
  status              text not null default 'pending'
                       check (status in ('pending','completed','expired'))
);

create index if not exists idx_feedback_req_manager on public.feedback_requests(manager_user_id, status);
create index if not exists idx_feedback_req_month on public.feedback_requests(freelancer_user_id, month_ref);

-- =============================================================================
-- 22. NOTIFICATIONS (§11)
-- =============================================================================
create table if not exists public.notifications (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  recipient_user_id  uuid not null references public.users(id) on delete cascade,
  type               text not null check (type in (
                        'day_start_reminder','checkout_reminder','checkin_absence','third_late',
                        'bonus_loss_warning','second_no_show','swap_request','availability_cancelled',
                        'coverage_deficit','availability_reminder','schedule_conflict',
                        'weekday_eligibility','manager_checkin_checkout','feedback_received',
                        'feedback_request','schedule_published','schedule_assigned','schedule_removed',
                        'shift_reminder','waitlist_opening')),
  title              text not null,
  body               text,
  data               jsonb not null default '{}'::jsonb,  -- deep-link payload
  read_at            timestamptz,
  sent_at            timestamptz
);

create index if not exists idx_notifications_recipient on public.notifications(recipient_user_id, created_at desc);
create index if not exists idx_notifications_unread on public.notifications(recipient_user_id) where read_at is null;

-- 'waitlist_opening' (§3.4 vacancy alert) added after the original list shipped.
-- 'schedule_assigned'/'schedule_removed' (§R14b immediate coordinator-assign notify).
-- Widen the type check constraint idempotently for existing databases.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'day_start_reminder','checkout_reminder','checkin_absence','third_late',
  'bonus_loss_warning','second_no_show','swap_request','availability_cancelled',
  'coverage_deficit','availability_reminder','schedule_conflict',
  'weekday_eligibility','manager_checkin_checkout','feedback_received',
  'feedback_request','schedule_published','schedule_assigned','schedule_removed',
  'shift_reminder','waitlist_opening'));

-- =============================================================================
-- 23. DEVICE TOKENS (§14) — push to iOS / Android / web
-- =============================================================================
create table if not exists public.device_tokens (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid not null references public.users(id) on delete cascade,
  token         text not null unique,
  platform      text not null check (platform in ('ios','android','web')),
  last_seen_at  timestamptz not null default now()
);

create index if not exists idx_device_tokens_user on public.device_tokens(user_id);

-- =============================================================================
-- 24. PAYROLL PERIODS (§8.2/§13) — monthly close
-- =============================================================================
create table if not exists public.payroll_periods (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  reference_month  date not null unique,
  status           text not null default 'open' check (status in ('open','closed')),
  closed_at        timestamptz,
  closed_by        uuid references public.users(id) on delete set null
);

-- =============================================================================
-- 25. PAYROLL ENTRIES (§12) — line items, discriminated by restaurant
-- =============================================================================
create table if not exists public.payroll_entries (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  period_id     uuid not null references public.payroll_periods(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  type          text not null check (type in
                  ('shift_pay','weekend_bonus','late_discount','no_show_discount','manual_adjustment')),
  reference_id  uuid,
  amount        numeric(10,2) not null,                   -- + pay, - discount
  shift_count   integer,
  notes         text
);

create index if not exists idx_payroll_entries_period on public.payroll_entries(period_id);
create index if not exists idx_payroll_entries_user on public.payroll_entries(user_id, restaurant_id);

-- =============================================================================
-- 26. WEEKLY BONUS ELIGIBILITY (§8.2 bonus + §8.3 weekday gating)
-- =============================================================================
create table if not exists public.weekly_bonus_eligibility (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  user_id                uuid not null references public.users(id) on delete cascade,
  week_start             date not null,                   -- Monday (§8.2)
  has_four_weekend_shifts boolean not null default false,
  bonus_eligible         boolean not null default false,
  weekday_eligible       boolean not null default false,  -- gate for Mon–Thu (§8.3)
  reason                 text,
  unique (user_id, week_start)
);

-- =============================================================================
-- 27. CALENDAR EXPORT TOKENS (§2.1, §14) — per-freelancer iCal link
-- =============================================================================
create table if not exists public.calendar_export_tokens (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null references public.users(id) on delete cascade,
  token       text not null unique,
  revoked     boolean not null default false
);

-- =============================================================================
-- 28. AUDIT LOG — recommended: coordinator overrides on check-in/score/pay
-- =============================================================================
create table if not exists public.audit_log (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  actor_user_id  uuid references public.users(id) on delete set null,
  action         text not null,
  entity         text not null,
  entity_id      uuid,
  before_data    jsonb,
  after_data     jsonb
);

create index if not exists idx_audit_entity on public.audit_log(entity, entity_id);

-- =============================================================================
-- SEED DATA
-- =============================================================================
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

insert into public.score_levels (level, name) values
  (1, 'Brincador 1 Estrela'),
  (2, 'Brincador 2 Estrelas'),
  (3, 'Brincador 3 Estrelas'),
  (4, 'Brincador 4 Estrelas'),
  (5, 'Brincador 5 Estrelas')
on conflict (level) do nothing;

-- =============================================================================
-- IDEMPOTENT COLUMN ADDITIONS — keep existing databases in sync with the CREATE
-- definitions above when migrate is re-run. `add column if not exists` is a no-op
-- once the column exists, so this block is safe to run repeatedly.
-- =============================================================================
alter table public.restaurants          add column if not exists cep      text;
alter table public.restaurants          add column if not exists cnpj     text;
alter table public.freelancer_profiles  add column if not exists cpf      text;
alter table public.freelancer_profiles  add column if not exists pix_key  text;
alter table public.freelancer_profiles  add column if not exists whatsapp text;
alter table public.freelancer_profiles  add column if not exists home_cep text;

-- Extra shifts ("turno extra", R9): a shift the restaurant manager requests
-- beyond the base schedule (e.g. a holiday not in the base grid). Whoever works
-- an is_extra shift earns the furo-cover reward. Managers request; coordination
-- either assigns directly or opens it as a vaga (via an is_extra demand override).
alter table public.schedule_assignments  add column if not exists is_extra boolean not null default false;
alter table public.demand_overrides      add column if not exists is_extra boolean not null default false;
create table if not exists public.extra_shift_requests (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  date          date not null,
  shift_type    text not null check (shift_type in ('lunch','dinner')),
  headcount     integer not null default 1 check (headcount >= 1),
  reason        text,
  requested_by  uuid references public.users(id) on delete set null,
  status        text not null default 'pending'
                check (status in ('pending','assigned','opened','rejected','cancelled')),
  decided_by    uuid references public.users(id) on delete set null,
  decided_at    timestamptz
);
create index if not exists idx_extra_req_status on public.extra_shift_requests(status);

-- Editable scoring config (R1/R7): per-event point overrides + star-level cutoffs.
-- `score_points` overrides the code defaults per event_type; `star_cutoffs` is 4
-- ascending scores mapping current_score → level 1..5 (level = 1 + #cutoffs met).
alter table public.app_settings add column if not exists score_points jsonb;
alter table public.app_settings add column if not exists star_cutoffs jsonb;
update public.app_settings set star_cutoffs = '[10,25,50,100]'::jsonb where id = 1 and star_cutoffs is null;

-- Derive freelancer_profiles.current_level from current_score on every write, using
-- the configured cutoffs. This makes stars automatic across all recompute sites.
create or replace function public.skala_set_current_level() returns trigger as $$
declare cutoffs jsonb; lvl int := 1; c numeric;
begin
  select star_cutoffs into cutoffs from public.app_settings where id = 1;
  if cutoffs is null then cutoffs := '[10,25,50,100]'::jsonb; end if;
  for c in select value::numeric from jsonb_array_elements_text(cutoffs) loop
    if coalesce(new.current_score, 0) >= c then lvl := lvl + 1; end if;
  end loop;
  new.current_level := least(5, lvl);
  return new;
end $$ language plpgsql;

drop trigger if exists trg_set_current_level on public.freelancer_profiles;
create trigger trg_set_current_level
  before insert or update of current_score on public.freelancer_profiles
  for each row execute function public.skala_set_current_level();

-- Align score_events.event_type with the live set (furo_covered was added post-hoc).
alter table public.score_events drop constraint if exists score_events_event_type_check;
alter table public.score_events add constraint score_events_event_type_check check (event_type in (
  'target_10_shifts','swap_accepted','meeting','online_training','innovation_video',
  'charity_event','inperson_training','feedback_fundamentos','feedback_proatividade',
  'feedback_encantamento','feedback_extraordinario','late_light','late_moderate',
  'late_severe','late_critical','swap_requested','no_show_unjustified','manual_adjustment',
  'flexible_availability','furo_covered'));

-- =============================================================================
-- ROW LEVEL SECURITY
-- Permissive policies mirror the existing project (anon + authenticated).
-- TODO before production: replace with per-role policies (coordinator full,
-- freelancer own rows, manager own restaurant/day, visitor restricted).
-- =============================================================================
do $$
declare t text;
begin
  -- Supabase-only: the `authenticated`/`anon` roles exist only on Supabase.
  -- On standalone PostgreSQL these policies are unnecessary (the API connects as
  -- the table owner, which bypasses RLS) and the roles don't exist — so skip.
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'Standalone PostgreSQL detected — skipping Supabase RLS policies.';
    return;
  end if;

  foreach t in array array[
    'app_settings','users','restaurants','freelancer_profiles','manager_assignments',
    'member_clients',
    'shift_templates','restaurant_demand','demand_overrides','availability_cycles',
    'availability_submissions','schedule_assignments','waiting_list','shift_attendance',
    'shift_swap_requests','absences','score_levels','score_events','engagement_events',
    'monthly_performance','manager_feedback','feedback_requests','notifications',
    'device_tokens','payroll_periods','payroll_entries','weekly_bonus_eligibility',
    'calendar_export_tokens','audit_log'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "%1$s_all" on public.%1$I;', t);
    execute format(
      'create policy "%1$s_all" on public.%1$I for all to anon, authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;
