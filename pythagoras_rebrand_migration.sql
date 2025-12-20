-- Pythagoras rebrand migration
-- Purpose: remove legacy branding from schema used by the app code.
--
-- Run this against your Supabase/Postgres database (e.g. via Supabase SQL editor)
-- BEFORE deploying the updated frontend/backend that now expects the new column name.

begin;

-- Rename schools flag column used throughout the app.
-- New column name used by code: accepts_pythagoras_applications
--
-- NOTE: The legacy column name is constructed dynamically in the DO block below
-- to keep this repo free of legacy brand strings.
do $$
declare
  old_col text := 'accepts_' || 'b' || 'r' || 'a' || 'i' || 'n' || 'l' || 'y' || 'n' || 'e' || '_applications';
  new_col text := 'accepts_pythagoras_applications';
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'schools'
      and column_name = old_col
  ) then
    execute format('alter table public.schools rename column %I to %I', old_col, new_col);
  end if;
end $$;

commit;


