-- Supabase DEV smoke precheck.
-- Read-only checks only.

select
  current_database() as database_name,
  current_schema() as schema_name,
  now() as checked_at;

select
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'profiles'
  ) as public_profiles_exists;
