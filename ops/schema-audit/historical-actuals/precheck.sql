-- Flux Operadora - historical_actuals precheck
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: solo SELECT. No modifica datos ni esquema.

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  now() as checked_at;

select
  'public.historical_actuals' as object_name,
  to_regclass('public.historical_actuals') is not null as exists_in_target;

select
  'HISTORICAL_ACTUALS_PRECHECK_READ_ONLY' as result;
