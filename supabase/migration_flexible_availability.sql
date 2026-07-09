-- Migration: "any restaurant" (no-preference) availability + flexibility reward.
-- Idempotent — safe to run more than once.

-- 1) Allow a submission with NO restaurant = "any restaurant / no preference".
alter table public.availability_submissions alter column restaurant_id drop not null;

-- One "any" row per (cycle, user, date, shift). The existing named unique still
-- covers the restaurant-specific rows; NULLs are distinct there, so a partial
-- unique index enforces the single-"any"-row rule.
create unique index if not exists uniq_avail_sub_any
  on public.availability_submissions (cycle_id, user_id, date, shift_type)
  where restaurant_id is null;

-- 2) New score event for choosing "any restaurant" (§ reward flexibility).
alter table public.score_events drop constraint if exists score_events_event_type_check;
alter table public.score_events add constraint score_events_event_type_check
  check (event_type in (
    'target_10_shifts','swap_accepted','meeting','online_training',
    'innovation_video','charity_event','inperson_training',
    'feedback_fundamentos','feedback_proatividade','feedback_encantamento',
    'feedback_extraordinario','late_light','late_moderate','late_severe',
    'late_critical','swap_requested','no_show_unjustified','manual_adjustment',
    'flexible_availability'));

-- 3) Configurable points for a flexible (no-preference) freelancer, per cycle.
alter table public.app_settings
  add column if not exists flexible_availability_points numeric(6,2) not null default 2;
