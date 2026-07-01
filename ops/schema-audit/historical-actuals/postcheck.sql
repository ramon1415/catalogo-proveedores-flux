-- Flux Operadora - historical_actuals postcheck
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: solo SELECT. No modifica datos ni esquema.

select
  case
    when to_regclass('public.historical_actuals') is not null
      then 'HISTORICAL_ACTUALS_BLOCKED_NEEDS_SCHEMA_EXPORT'
    else 'HISTORICAL_ACTUALS_NOT_FOUND_IN_TARGET'
  end as result,
  to_regclass('public.historical_actuals') is not null as exists_in_target,
  now() as checked_at;
