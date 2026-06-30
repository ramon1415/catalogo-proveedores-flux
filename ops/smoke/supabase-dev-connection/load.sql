-- Supabase DEV smoke load phase.
-- This runner phase is intentionally a read-only no-op.

select
  'supabase-dev-connection'::text as smoke_name,
  true as ok,
  now() as checked_at;

select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and table_name = 'profiles';
