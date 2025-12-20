-- DESTRUCTIVE Supabase cleanup for fully removed features
--
-- You confirmed you want to DELETE these product areas entirely:
-- - Schools
-- - Assignments
-- - Applications
-- - Task management
-- - Ambassadors
-- - Translation orders
--
-- This script drops the related tables (and dependent objects via CASCADE).
-- Run this ONLY if you are sure, ideally in a Supabase Branch first.
--
-- NOTE: This will break any remaining UI/pages that still reference these features.

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

-- -----------------------------
-- Assignments (removed)
-- -----------------------------
drop table if exists public.sales_student_assignments cascade;

-- -----------------------------
-- Task management (removed)
-- -----------------------------
drop table if exists public.task_attachments cascade;
drop table if exists public.task_checklist_items cascade;
drop table if exists public.task_notifications cascade;
drop table if exists public.tasks cascade;

drop table if exists public.task_templates cascade;

-- -----------------------------
-- Applications (removed)
-- -----------------------------
drop table if exists public.application_tasks cascade;
drop table if exists public.application_progress cascade;
drop table if exists public.application_summary cascade;
drop table if exists public.application_responses cascade;
drop table if exists public.application_payments cascade;
drop table if exists public.application_documents cascade;

drop table if exists public.student_application_tracking cascade;
drop table if exists public.student_applications cascade;
drop table if exists public.applications cascade;

-- -----------------------------
-- Schools (removed)
-- -----------------------------
drop table if exists public.school_ai_chats cascade;
drop table if exists public.school_ai_documents cascade;
drop table if exists public.school_ai_settings cascade;

drop table if exists public.school_application_forms cascade;
drop table if exists public.school_documents cascade;
drop table if exists public.school_managers cascade;
drop table if exists public.school_media cascade;
drop table if exists public.school_success_stories cascade;

drop table if exists public.school_majors cascade;
drop table if exists public.school_program_pricing cascade;
drop table if exists public.school_aid_stats cascade;
drop table if exists public.school_rankings cascade;
drop table if exists public.school_alumni_stats cascade;
drop table if exists public.school_top_employers cascade;
drop table if exists public.school_stats cascade;

drop table if exists public.schools cascade;

commit;


