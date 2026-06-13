# Supabase migrations package - Flux Operadora

Este paquete prepara la reconstruccion futura de una base Supabase prod limpia para Flux Operadora.

Estado de esta tanda:

- No se ejecuto SQL.
- No se creo Supabase prod.
- No se tocaron `main`, backend, n8n ni Vercel Production.
- No se incluyen secrets, tokens ni `service_role`.
- No se incluyen datos operativos de dev.
- Los SQL son estructura versionada y checklist tecnico. El DDL real debe extraerse desde Supabase dev con acceso autorizado.

## Archivos

| Orden | Archivo | Contenido esperado |
|---|---|---|
| 1 | `migrations/001_schema.sql` | Extensiones, tablas, columnas, tipos base, defaults, PK y FK base. |
| 2 | `migrations/002_enums_triggers_indexes.sql` | Enums, indices, triggers y funciones auxiliares de `updated_at`. |
| 3 | `migrations/003_functions_rpcs.sql` | Helper functions, RPCs de negocio y RPCs del dashboard. |
| 4 | `migrations/004_rls_policies_grants.sql` | RLS, policies, grants de tablas y grants de ejecucion. |
| 5 | `migrations/005_storage.sql` | Buckets requeridos y policies de Storage. |
| 6 | `migrations/006_seed_base.sql` | Seed minimo seguro: roles y catalogos aprobados. |

## Inventario esperado

Tablas base:

- `profiles`
- `roles`
- `user_roles`
- `companies`
- `cost_centers`
- `budget_categories`
- `budget_availability`
- `proveedores`
- `company_bank_accounts`

Egresos:

- `payment_requests`
- `payment_request_approvals`
- `payment_layouts`
- `payment_layout_lines`
- `payment_receipts`

Efectivo y comprobaciones:

- `cash_funds`
- `cash_reconciliations`
- `cash_reconciliation_items`

Ingresos, cuotas e incidencias:

- `members`
- `billing_periods`
- `maintenance_fee_charges`
- `maintenance_fee_payments`
- `incident_charges`
- `invoices`

Cierre mensual:

- `monthly_closures`
- `monthly_closure_exports`
- `monthly_closure_comments`

Funciones/RPCs:

- `current_profile_id`
- `current_user_has_role`
- `create_payment_request`
- `verify_budget_availability`
- `decide_payment_request`
- `create_payment_layout`
- `mark_payment_layout_uploaded`
- `confirm_payment_layout`
- `reject_payment_layout_line`
- `verify_cash_block`
- `create_cash_fund`
- `create_cash_reconciliation`
- `submit_cash_reconciliation`
- `review_cash_reconciliation`
- `generate_maintenance_fees_for_period`
- `register_maintenance_fee_payment`
- `create_incident_charge`
- `create_invoice_record`
- `mark_invoice_paid`
- `dashboard_kpis`
- `dashboard_export_payload`
- `dashboard_closure_checklist`

Tambien deben migrarse enums, constraints, indexes, triggers, RLS policies, grants, storage buckets y storage policies.

## Guia de extraccion con Supabase CLI

Usar esta opcion cuando la persona tenga acceso al proyecto Supabase dev y a la CLI.

1. Verificar o instalar Supabase CLI.

```bash
supabase --version
```

Si no esta instalada, usar la guia oficial de Supabase CLI para el sistema operativo correspondiente.

2. Iniciar sesion.

```bash
supabase login
```

3. Confirmar el project ref de Supabase dev.

El project ref sale del dashboard de Supabase o de la URL del proyecto. No pegar tokens ni passwords en el repo.

```bash
supabase projects list
```

4. Vincular el proyecto dev.

```bash
supabase link --project-ref <DEV_PROJECT_REF>
```

5. Generar un dump schema-only.

```bash
supabase db dump --schema public --file supabase/migrations/dev_schema_dump.sql
```

6. Si se usa Supabase local para validar, crear una migracion desde diferencias.

```bash
supabase db diff --schema public --file 000_dev_schema_extracted
```

7. Revisar el archivo generado antes de copiarlo a los SQL numerados.

Checklist de revision del dump:

- No contiene inserts de datos operativos.
- No contiene passwords.
- No contiene connection strings.
- No contiene tokens.
- No contiene `service_role`.
- No contiene datos personales innecesarios.
- No contiene owners locales innecesarios.
- No contiene paths locales.

8. Separar el contenido generado en:

- `001_schema.sql`
- `002_enums_triggers_indexes.sql`
- `003_functions_rpcs.sql`
- `004_rls_policies_grants.sql`
- `005_storage.sql`
- `006_seed_base.sql`

No ejecutar en prod hasta que el PR sea revisado y aprobado.

## Guia alternativa con pg_dump

Usar esta opcion si se tiene acceso al connection string de Supabase dev.

No guardar la connection string completa en el repo. No pegar password en archivos. Usar variables de ambiente locales o un password prompt.

Variables requeridas:

- `HOST`
- `PORT`
- `DATABASE`
- `USER`
- `PASSWORD`
- `SSLMODE`

Ejemplo con variables de ambiente:

```bash
export PGHOST="<HOST>"
export PGPORT="<PORT>"
export PGDATABASE="<DATABASE>"
export PGUSER="<USER>"
export PGPASSWORD="<PASSWORD>"
export PGSSLMODE="require"

pg_dump \
  --schema-only \
  --no-owner \
  --no-privileges \
  --schema public \
  --file supabase/migrations/dev_schema_dump.sql
```

En PowerShell:

```powershell
$env:PGHOST="<HOST>"
$env:PGPORT="<PORT>"
$env:PGDATABASE="<DATABASE>"
$env:PGUSER="<USER>"
$env:PGPASSWORD="<PASSWORD>"
$env:PGSSLMODE="require"

pg_dump `
  --schema-only `
  --no-owner `
  --no-privileges `
  --schema public `
  --file supabase/migrations/dev_schema_dump.sql
```

Antes de guardar el resultado:

- Eliminar owners locales si aparecen.
- Confirmar que no hay datos.
- Confirmar que no hay secrets.
- Confirmar que no hay comentarios sensibles.
- Confirmar que no hay roles internos innecesarios.
- Confirmar que no hay connection strings completas.

## Inventario manual desde SQL Editor

Si no se usa CLI ni `pg_dump`, estas queries permiten inventariar el esquema desde Supabase SQL Editor. No modifican datos.

### Tablas

```sql
select table_schema, table_name, table_type
from information_schema.tables
where table_schema in ('public', 'storage')
order by table_schema, table_name;
```

### Columnas

```sql
select table_schema,
       table_name,
       ordinal_position,
       column_name,
       data_type,
       udt_name,
       is_nullable,
       column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```

### Constraints

```sql
select conrelid::regclass::text as table_name,
       conname,
       contype,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;
```

### Indexes

```sql
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;
```

### Functions/RPCs

```sql
select n.nspname as schema_name,
       p.proname as function_name,
       pg_get_function_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result_type,
       l.lanname as language,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public'
order by p.proname, arguments;
```

### Function definitions

```sql
select n.nspname as schema_name,
       p.proname as function_name,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;
```

### Triggers

```sql
select event_object_table,
       trigger_name,
       action_timing,
       event_manipulation,
       action_statement
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;
```

Postgres-native trigger definitions:

```sql
select tgrelid::regclass::text as table_name,
       tgname as trigger_name,
       pg_get_triggerdef(oid) as definition
from pg_trigger
where not tgisinternal
order by tgrelid::regclass::text, tgname;
```

### Policies

```sql
select schemaname,
       tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual,
       with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;
```

### RLS enabled

```sql
select n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;
```

### Grants de tablas

```sql
select grantee,
       table_schema,
       table_name,
       privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
order by table_name, grantee, privilege_type;
```

### Grants de funciones

```sql
select routine_schema,
       routine_name,
       grantee,
       privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
order by routine_name, grantee;
```

### Storage buckets

```sql
select id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at
from storage.buckets
order by name;
```

### Storage policies

```sql
select schemaname,
       tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual,
       with_check
from pg_policies
where schemaname = 'storage'
order by tablename, policyname;
```

## Como dividir un dump grande

Si el dump sale en un solo archivo, dividirlo asi:

### `001_schema.sql`

Copiar:

- `CREATE EXTENSION`
- `CREATE TABLE`
- columnas
- defaults
- primary keys
- foreign keys base
- generated columns
- check constraints base

Tambien puede incluir `CREATE TYPE` si los enums son necesarios antes de crear tablas.

### `002_enums_triggers_indexes.sql`

Copiar:

- `CREATE TYPE` si no quedo en `001_schema.sql`
- `CREATE INDEX`
- `CREATE TRIGGER`
- funciones genericas de `updated_at`, si son solo soporte tecnico

### `003_functions_rpcs.sql`

Copiar:

- `CREATE OR REPLACE FUNCTION`
- helper functions como `current_profile_id`
- helper functions como `current_user_has_role`
- RPCs de negocio
- RPCs de dashboard

### `004_rls_policies_grants.sql`

Copiar:

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- `CREATE POLICY`
- `GRANT` sobre tablas
- `GRANT EXECUTE ON FUNCTION`

### `005_storage.sql`

Copiar:

- buckets
- policies de `storage.objects`
- instrucciones manuales si Supabase no exporta algun detalle del bucket

### `006_seed_base.sql`

Solo incluir:

- roles base aprobados
- catalogos minimos aprobados
- usuario/profile admin inicial solo si el procedimiento ya fue autorizado

No incluir datos operativos.

## Checklist de seguridad antes de commit

- No `service_role`.
- No passwords.
- No connection string completa.
- No tokens.
- No datos personales innecesarios.
- No solicitudes, pagos, facturas ni cierres reales.
- No datos basura de dev.
- No anon key si no es necesaria.
- No owners locales.
- No paths locales.
- No credenciales OAuth.
- No signed URLs de Storage.
- No dumps con datos, solo schema.

## Checklist de validacion local

Opcion ideal con Supabase local:

```bash
supabase start
supabase db reset
```

Despues aplicar o integrar los SQL numerados en el flujo de migraciones local y verificar que no fallen.

Validar:

- Tablas creadas.
- RPCs creadas.
- RLS activo.
- Policies presentes.
- Grants presentes.
- Buckets/policies documentados.
- Seed base no inserta datos operativos.

Opcion alternativa:

1. Crear proyecto Supabase temporal de prueba.
2. Aplicar los SQL numerados en orden.
3. Cargar solo seed minimo.
4. Crear usuario admin temporal.
5. Validar login.
6. Probar Proveedores, Solicitudes, Layouts, Efectivo, Ingresos y Dashboard.
7. Eliminar proyecto temporal cuando termine la prueba.

No usar Supabase prod real para validar migraciones por primera vez.

## Aplicacion futura en Supabase prod limpio

1. Crear proyecto Supabase prod limpio.
2. Confirmar URL distinta a dev.
3. Aplicar `001_schema.sql`.
4. Aplicar `002_enums_triggers_indexes.sql`.
5. Aplicar `003_functions_rpcs.sql`.
6. Aplicar `004_rls_policies_grants.sql`.
7. Aplicar `005_storage.sql`.
8. Revisar y aplicar `006_seed_base.sql` solo con datos aprobados.
9. Crear usuario admin inicial en Supabase Auth.
10. Vincular usuario a `profiles` y `user_roles`.
11. Validar modulos.
12. Configurar Vercel Production con `FLUX_ENV=prod`, `FLUX_SUPABASE_URL` y `FLUX_SUPABASE_ANON_KEY`.

## Seed base seguro

Debe ser minimo:

- Roles base.
- Perfil admin inicial, despues de crear usuario Auth prod.
- Empresas limpias aprobadas.
- Centros de costo aprobados.
- Partidas presupuestales aprobadas.
- Cuentas origen aprobadas.

No incluir solicitudes, pagos, layouts, fondos, comprobaciones, incidencias, facturas, cierres de prueba, correos personales sin autorizacion, tokens, secrets ni `service_role`.

## Reglas

- Nunca usar `service_role` en frontend.
- Nunca subir secrets al repo.
- Nunca copiar dev hacia prod.
- Solo copiar prod hacia dev, con sanitizacion si aplica.
- No ejecutar migraciones en produccion sin respaldo y autorizacion humana.
- No configurar Vercel Production hasta que Supabase prod exista y este validado.
