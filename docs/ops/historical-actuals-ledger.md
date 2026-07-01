# historical_actuals ledger versioning

Documento operativo para versionar formalmente `public.historical_actuals` en el ledger de migraciones, usando la evidencia de DEV sin copiar datos.

## Evidencia fuente

- Auditoria: `ops/schema-audit/historical-actuals/`
- Workflow: Deploy Supabase DEV Manual
- Run ID: 28544701584
- Branch auditada: `dev`
- Ambiente auditado: Supabase DEV `scsirgbuqjcwoaxfacth`
- Resultado: `HISTORICAL_ACTUALS_BLOCKED_NEEDS_SCHEMA_EXPORT`

La auditoria fue read-only. No ejecuto migraciones, no modifico datos y no copio filas de negocio.

## Estructura auditada en DEV

`public.historical_actuals` existe en DEV con esta forma:

- `id uuid not null default gen_random_uuid()`
- `company_id uuid`
- `account_code text not null`
- `account_name text`
- `period_month date not null`
- `amount numeric not null`
- `source text not null default 'historical'::text`
- `created_at timestamptz not null default now()`
- Primary key: `historical_actuals_pkey` sobre `id`
- Unique: `historical_actuals_company_id_account_code_period_month_key` sobre `company_id`, `account_code`, `period_month`
- Foreign key: `historical_actuals_company_id_fkey` sobre `company_id`
- RLS activo
- Policies:
  - `historical_actuals_select` para `authenticated`, `SELECT`, con `current_user_has_role(flux_member_roles())`
  - `historical_actuals_write` para `authenticated`, `ALL`, con `current_user_has_role(flux_finance_roles())`

El conteo estimado reportado por la auditoria fue de 682 filas. Este PR no incluye ni exporta esas filas.

## Migracion propuesta

La migracion nueva es:

```text
supabase/migrations/004a_historical_actuals.sql
```

Se ubica despues de `004_rls_policies_grants.sql` porque depende de los helpers de roles ya versionados y porque agrega su propia configuracion RLS/policies/grant para la tabla nueva.

La migracion es no destructiva:

- Usa `create table if not exists`.
- No borra tablas.
- No borra columnas.
- No borra datos.
- No copia datos reales.
- No agrega dumps ni filas operativas.
- Crea policies solo si no existen.
- Otorga permisos necesarios a `authenticated` para que RLS controle el acceso final.

## Decision sobre company_id

La solicitud inicial mencionaba `company_id uuid not null`, pero la auditoria real de DEV reporto `company_id` como nullable.

Este PR sigue la evidencia auditada y deja `company_id` nullable para no introducir una restriccion mas fuerte sin revisar las 682 filas existentes ni preparar una migracion de limpieza/backfill. Si negocio requiere `not null`, debe hacerse en un PR posterior con auditoria de datos y autorizacion separada.

## Pendientes separados

`payment_receipts.notes` no existe en DEV segun la auditoria previa del ledger. Ese pendiente queda fuera de este PR y debe resolverse en una decision separada: migracion formal de columna o ajuste de codigo para no depender de ella.

## Validacion esperada de este PR

- No ejecutar SQL desde este PR.
- No ejecutar migraciones desde este PR.
- No tocar Supabase DEV real.
- No tocar Supabase PROD.
- No tocar produccion.
- No tocar `main`.
- No tocar n8n.
- No modificar frontend/app.
- No configurar variables ni secrets.
- Revisar humanamente si `company_id` debe permanecer nullable o pasar a `not null` en un PR posterior.
