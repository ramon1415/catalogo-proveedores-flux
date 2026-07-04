# Supabase PROD fine migration audit plan

This document complements `docs/ops/prod-migration-reconciliation-plan.md`.

It prepares the next read-only audit needed before deciding on `supabase migration repair`, baseline, `supabase db push --dry-run`, real `supabase db push`, or merge of PR #147.

No execution is authorized by this document.

## Current context

- PR #174 merged the initial PROD reconciliation plan into `dev`.
- PROD is reachable through the protected GitHub Environment `supabase-production`.
- The general read-only audit succeeded.
- PROD is not empty.
- `supabase_migrations.schema_migrations` is missing in PROD.
- PR #147 remains open and must not be merged yet.

## Scope of this fine audit

The fine audit must close the non-conclusive points for these migrations:

- `00110_number_sequences.sql`
- `00401_historical_actuals.sql`
- `00402_payment_receipts_policies.sql`
- `00403_fase2_payment_method_closure.sql`
- `007_notifications.sql`

This is a metadata/read-only audit only. It must not modify schema, data, secrets, environment variables, Storage, n8n, or release branches.

## Execution constraints

Allowed SQL patterns:

- `select`
- catalog queries through `information_schema`, `pg_catalog`, `pg_policies`, `pg_indexes`, `pg_trigger`, and `to_regclass`
- `pg_get_functiondef` for specific public functions only

Forbidden SQL patterns:

- `insert`
- `update`
- `delete`
- `drop`
- `alter`
- `create`
- `truncate`
- `grant`
- `revoke`
- `call`
- `do`
- migration execution
- migration repair
- `supabase db push`

The audit should run with:

- `PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=15000'`
- `psql --no-psqlrc`
- sanitized artifacts only

## Read-only query set

The following logical checks should be added to the existing protected PROD audit workflow or run by an equivalent read-only workflow after explicit authorization.

### 1. Number sequences: `00110_number_sequences.sql`

Purpose: confirm whether the sequence migration is already represented in PROD.

```sql
select
  sequence_name,
  data_type,
  start_value,
  minimum_value,
  maximum_value,
  increment
from information_schema.sequences
where sequence_schema = 'public'
  and sequence_name in (
    'payment_request_number_seq',
    'payment_layout_number_seq'
  )
order by sequence_name;
```

```sql
select
  object_name,
  to_regclass(object_name) is not null as exists
from (values
  ('public.payment_request_number_seq'),
  ('public.payment_layout_number_seq')
) as expected_sequences(object_name)
order by object_name;
```

```sql
select
  p.oid::regprocedure::text as function_signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'generate_payment_request_number',
    'create_payment_layout'
  )
order by function_signature;
```

### 2. Historical actuals: `00401_historical_actuals.sql`

Purpose: confirm whether `historical_actuals` is missing, partial, or already represented.

```sql
select
  to_regclass('public.historical_actuals') is not null as historical_actuals_exists;
```

```sql
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'historical_actuals'
order by ordinal_position;
```

```sql
select
  conname,
  contype,
  pg_get_constraintdef(oid) as constraint_def
from pg_constraint
where conrelid = 'public.historical_actuals'::regclass
order by conname;
```

```sql
select
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'historical_actuals'
order by policyname;
```

```sql
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'historical_actuals';
```

### 3. Payment receipts policies: `00402_payment_receipts_policies.sql`

Purpose: confirm whether payment receipts write access is already equivalent to the versioned policy.

```sql
select
  to_regclass('public.payment_receipts') is not null as payment_receipts_exists;
```

```sql
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'payment_receipts';
```

```sql
select
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'payment_receipts'
order by policyname;
```

```sql
select
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'payment_receipts'
  and grantee in ('authenticated', 'anon', 'public')
order by grantee, privilege_type;
```

```sql
select
  p.oid::regprocedure::text as function_signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('flux_member_roles', 'flux_approver_roles')
order by function_signature;
```

### 4. Fase 2 payment method closure: `00403_fase2_payment_method_closure.sql`

Purpose: confirm whether PROD has the request type/payment method separation and the transfer-only layout backend guard.

```sql
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payment_requests'
  and column_name in ('request_type', 'payment_method')
order by column_name;
```

```sql
select
  conname,
  contype,
  convalidated,
  pg_get_constraintdef(oid) as constraint_def
from pg_constraint
where conrelid = 'public.payment_requests'::regclass
  and conname = 'payment_requests_payment_method_check'
order by conname;
```

```sql
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'payment_requests'
  and indexname = 'idx_payment_requests_payment_method'
order by indexname;
```

```sql
select
  enumlabel
from pg_enum e
join pg_type t on t.oid = e.enumtypid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname = 'payment_request_type'
order by e.enumsortorder;
```

```sql
select
  p.oid::regprocedure::text as function_signature,
  pg_get_functiondef(p.oid) as function_def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_payment_layout'
  and p.prokind = 'f'
order by function_signature;
```

The function definition must be reviewed for transfer-only behavior, specifically logic equivalent to:

```sql
coalesce(nullif(pr.payment_method, ''), case when pr.request_type::text in ('cash', 'check') then pr.request_type::text else 'transfer' end) = 'transfer'
```

### 5. Notifications ledger: `007_notifications.sql`

Purpose: confirm whether the notifications ledger is absent, partial, or already represented.

```sql
select
  object_name,
  to_regclass(object_name) is not null as exists
from (values
  ('public.notification_events'),
  ('public.notification_delivery_attempts')
) as expected_tables(object_name)
order by object_name;
```

```sql
select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('notification_events', 'notification_delivery_attempts')
order by table_name, ordinal_position;
```

```sql
select
  conrelid::regclass::text as table_name,
  conname,
  contype,
  pg_get_constraintdef(oid) as constraint_def
from pg_constraint
where conrelid in (
  'public.notification_events'::regclass,
  'public.notification_delivery_attempts'::regclass
)
order by table_name, conname;
```

```sql
select
  p.oid::regprocedure::text as function_signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and p.proname in (
    'notification_current_profile_id',
    'notification_current_user_has_role',
    'set_updated_at_notification_events',
    'enqueue_notification_event_internal',
    'enqueue_notification_event',
    'claim_pending_notification_events',
    'mark_notification_processed',
    'mark_notification_failed'
  )
order by function_signature;
```

```sql
select
  tgname as trigger_name,
  tgrelid::regclass::text as table_name,
  tgfoid::regprocedure::text as function_signature,
  not tgisinternal as user_trigger
from pg_trigger
where tgrelid = 'public.notification_events'::regclass
order by tgname;
```

```sql
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('notification_events', 'notification_delivery_attempts')
order by c.relname;
```

```sql
select
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('notification_events', 'notification_delivery_attempts')
order by tablename, policyname;
```

```sql
select
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in (
    'notification_current_profile_id',
    'notification_current_user_has_role',
    'set_updated_at_notification_events',
    'enqueue_notification_event_internal',
    'enqueue_notification_event',
    'claim_pending_notification_events',
    'mark_notification_processed',
    'mark_notification_failed'
  )
order by routine_name, grantee, privilege_type;
```

## Resultado de auditoria fina PROD

Status: pendiente de ejecucion autorizada.

When this audit is executed, the result must be copied or summarized back into `docs/ops/prod-migration-reconciliation-plan.md` or a follow-up PR.

| Migracion | Objeto esperado | Existe en PROD | Estado | Evidencia | Riesgo | Recomendacion |
| --- | --- | --- | --- | --- | --- | --- |
| `00110_number_sequences.sql` | `payment_request_number_seq` | pendiente | pendiente | consulta de secuencias | medio | confirmar antes de repair/baseline |
| `00110_number_sequences.sql` | `payment_layout_number_seq` | pendiente | pendiente | consulta de secuencias | medio | confirmar antes de repair/baseline |
| `00401_historical_actuals.sql` | `historical_actuals` tabla/columnas/constraints/RLS/policies | pendiente | pendiente | columnas, constraints, RLS, policies | medio | aplicar solo si se confirma faltante y hay estrategia CLI |
| `00402_payment_receipts_policies.sql` | `payment_receipts_select` | pendiente | pendiente | pg_policies | alto funcional | confirmar si falta policy select |
| `00402_payment_receipts_policies.sql` | `payment_receipts_write_authorized` | pendiente | pendiente | pg_policies | alto funcional | confirmar si falta policy write |
| `00403_fase2_payment_method_closure.sql` | `payment_requests.payment_method` | pendiente | pendiente | information_schema.columns | alto release | confirmar antes de merge #147 |
| `00403_fase2_payment_method_closure.sql` | `payment_requests_payment_method_check` | pendiente | pendiente | pg_constraint | alto release | confirmar constraint validado |
| `00403_fase2_payment_method_closure.sql` | `online_purchase` enum value | pendiente | pendiente | pg_enum | medio | confirmar antes de release |
| `00403_fase2_payment_method_closure.sql` | `create_payment_layout` transfer-only backend guard | pendiente | pendiente | pg_get_functiondef | alto release | confirmar antes de release |
| `007_notifications.sql` | `notification_events` | pendiente | pendiente | to_regclass/columns | medio | no probar PROD hasta aplicar/reconciliar |
| `007_notifications.sql` | `notification_delivery_attempts` | pendiente | pendiente | to_regclass/columns | medio | no probar PROD hasta aplicar/reconciliar |
| `007_notifications.sql` | functions/triggers/RLS/policies/grants | pendiente | pendiente | pg_proc/pg_trigger/pg_policies/routine_privileges | medio | no activar n8n real |

## Classification rules

Use these statuses per migration:

- Aplicada: all expected objects exist and match the versioned migration sufficiently for CLI history repair/baseline consideration.
- Parcial: some objects exist but columns, constraints, policies, grants, function bodies or triggers are missing or different.
- No aplicada: expected objects are absent.
- No concluyente: evidence is incomplete or the workflow cannot inspect required metadata safely.

## Recommended next decision after execution

- If base objects and sequences are present but CLI history is empty: prepare an explicit baseline/repair proposal with exact versions.
- If `00402` policies are missing: prepare controlled application of payment receipt policies after baseline/repair decision.
- If `00403` is missing or partial: block release #147 until Fase 2 DB objects are applied or intentionally deferred.
- If `007` is missing: keep notifications inactive in PROD and do not test n8n/Resend there yet.
- If all required objects are aligned: request authorization for `supabase migration repair` or baseline, then run `supabase db push --dry-run`.

## Required confirmations for any future run

A future run must confirm:

- No `db push`.
- No `migration repair`.
- No migrations.
- No SQL writes.
- No DDL/DML.
- No PR #147 merge.
- No changes to `main`.
- No n8n.
- No secrets or variables changed or exposed.
