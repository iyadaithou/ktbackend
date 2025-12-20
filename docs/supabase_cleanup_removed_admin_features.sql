-- Supabase cleanup for removed admin features (SAFE MODE)
--
-- This script is intended for *manual execution* in Supabase SQL editor.
-- It focuses on tables that are specific to the removed Admin tabs:
-- - Translation Orders
-- - Ambassadors
--
-- NOTE:
-- - This does NOT drop core product tables like `schools`, `programs`, `users`,
--   `student_applications`, etc.
-- - Review first, then run in a non-prod branch/database if possible.

begin;

-- -----------------------------
-- Translation Orders (removed)
-- -----------------------------
drop table if exists public.translation_orders cascade;
drop table if exists public.translation_orders_backup cascade;

-- -----------------------------
-- Ambassadors (removed)
-- -----------------------------
drop table if exists public.ambassador_claims cascade;
drop table if exists public.ambassador_perks_catalog cascade;
drop table if exists public.ambassador_points_ledger cascade;
drop table if exists public.ambassador_resources cascade;
drop table if exists public.ambassador_rewards_catalog cascade;
drop table if exists public.ambassador_submissions cascade;
drop table if exists public.ambassador_tasks cascade;
drop table if exists public.ambassadors cascade;

commit;

-- If you want a more aggressive cleanup (applications, tasks, schools),
-- tell me and I’ll generate a separate "DESTRUCTIVE MODE" script after we confirm
-- which user-facing features you still want to keep.


