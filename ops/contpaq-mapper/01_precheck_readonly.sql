-- Mapper CONTPAQ — precheck PROD estrictamente de lectura.
-- Ejecutar antes de cualquier DDL o carga.

select now() at time zone 'utc' as audited_at_utc,
       current_database() as database_name,
       version() as postgres_version;

select id, name, legal_name, rfc, active
from public.companies
where active
order by name;

select
  to_regclass('public.contpaq_accounts') as contpaq_accounts_relation,
  to_regclass('public.budget_account_mappings') as budget_account_mappings_relation,
  to_regclass('public.contpaq_account_mapper_candidates') as mapper_candidates_relation;

select count(*) as historical_actual_rows,
       min(period_month) as first_period,
       max(period_month) as last_period
from public.historical_actuals;

select version, name
from supabase_migrations.schema_migrations
where name in (
  'historical_actuals_sysadmin_rls',
  'contpaq_mapper_schema_tree',
  'contpaq_mapper_audit_hardening'
)
order by version;

-- Confirmar manualmente y registrar antes de escribir:
-- 1. Qué fila corresponde a Operadora.
-- 2. Su company_id real en PROD.
-- 3. Coincidencia de nombre legal y RFC contra el manifiesto fuente.
-- 4. SHA-256 y conteo del catálogo enriquecido.
-- 5. SHA-256 y conteo de la semilla de mapeos.
