-- Supabase DEV smoke postcheck.
-- Read-only checks only.

select
  'postcheck'::text as phase,
  current_database() as database_name,
  now() as checked_at;

select
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'profiles'
  ) as public_profiles_exists_after_smoke;
