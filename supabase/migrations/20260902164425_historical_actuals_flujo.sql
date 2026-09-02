-- Reproduce the schema migration already applied in DEV. Historical imports
-- provide the value explicitly; no existing row is reclassified by account
-- prefix because that convention differs between companies.
alter table public.historical_actuals
  add column if not exists flujo text;

alter table public.historical_actuals
  drop constraint if exists historical_actuals_flujo_check;

alter table public.historical_actuals
  add constraint historical_actuals_flujo_check
  check (flujo = any (array['ingreso','egreso']::text[]));
