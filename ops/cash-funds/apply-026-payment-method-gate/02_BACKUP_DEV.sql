-- Migration 026 manual gate - read-only evidence snapshot.
-- Export every result grid before running the exact load file.

begin transaction read only;

select
  now() as captured_at,
  current_database() as database_name,
  current_user as database_role,
  current_setting('transaction_read_only') as transaction_read_only,
  version() as postgres_version;

-- Semantic migration-state snapshot. The ledger query below is informational;
-- the object contract remains authoritative for manually applied migrations.
select
  '025'::text as migration,
  (
    to_regclass('public.intake_links') is not null
    and to_regclass('public.payment_intake') is not null
    and to_regclass('public.payment_intake_files') is not null
    and to_regclass('public.payment_intake_events') is not null
    and to_regprocedure('public.next_payment_intake_public_folio()') is not null
  ) as semantic_contract_present
union all
select
  '026',
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.oid = to_regprocedure('public.create_cash_fund(uuid,uuid,date,text,uuid,text)')
      and position('v_request.payment_method' in lower(p.prosrc)) > 0
  );

select version
from supabase_migrations.schema_migrations
where version in ('025', '026')
order by version;

-- Exact function definition, owner, settings and identity contract.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  l.lanname as language_name,
  owner_role.rolname as owner_name,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  p.pronargdefaults as default_argument_count,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
join pg_roles owner_role on owner_role.oid = p.proowner
where n.nspname = 'public'
  and p.oid = to_regprocedure('public.create_cash_fund(uuid,uuid,date,text,uuid,text)');

-- Effective EXECUTE ACL, including PUBLIC when grantee_oid=0.
select
  case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end as grantee,
  grantor.rolname as grantor,
  acl.privilege_type,
  acl.is_grantable
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
left join pg_roles grantee on grantee.oid = acl.grantee
left join pg_roles grantor on grantor.oid = acl.grantor
where n.nspname = 'public'
  and p.oid = to_regprocedure('public.create_cash_fund(uuid,uuid,date,text,uuid,text)')
order by grantee, acl.privilege_type;

-- Canonical and legacy request columns.
select
  c.column_name,
  c.data_type,
  c.udt_schema,
  c.udt_name,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'payment_requests'
  and c.column_name in ('request_type', 'payment_method')
order by c.ordinal_position;

select
  pc.conname as constraint_name,
  pc.contype as constraint_type,
  pg_get_constraintdef(pc.oid) as definition
from pg_constraint pc
join pg_class c on c.oid = pc.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'payment_requests'
  and (
    pc.conname ilike '%request_type%'
    or pc.conname ilike '%payment_method%'
    or position('payment_method' in pg_get_constraintdef(pc.oid)) > 0
  )
order by pc.conname;

-- cash_funds constraints and execution trigger.
select
  pc.conname as constraint_name,
  pc.contype as constraint_type,
  pg_get_constraintdef(pc.oid) as definition
from pg_constraint pc
join pg_class c on c.oid = pc.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'cash_funds'
order by pc.conname;

select
  t.tgname as trigger_name,
  t.tgenabled as enabled,
  p.proname as function_name,
  pg_get_triggerdef(t.oid, true) as trigger_definition,
  pg_get_functiondef(p.oid) as trigger_function_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'public'
  and c.relname = 'cash_funds'
  and not t.tgisinternal
order by t.tgname;

-- Counts that must remain unchanged immediately after migration 026.
select 'payment_requests'::text as object_name, count(*)::bigint as row_count
from public.payment_requests
union all
select 'cash_funds', count(*) from public.cash_funds
union all
select 'approval_batches', count(*) from public.approval_batches
union all
select 'approval_batch_items', count(*) from public.approval_batch_items
order by object_name;

-- Minimal sanitized QA request snapshot. No provider, bank or email fields.
select
  pr.id,
  pr.request_number,
  pr.request_type,
  pr.payment_method,
  pr.status,
  pr.amount_requested,
  pr.currency,
  pr.company_id,
  pr.approval_material_updated_at,
  pr.created_at,
  pr.updated_at
from public.payment_requests pr
where pr.request_number in ('SOL-2026-0073', 'SOL-2026-0074')
order by pr.request_number;

select
  ab.id as batch_id,
  ab.label,
  ab.status as batch_status,
  ab.company_id,
  ab.submitted_at,
  ab.decided_at,
  ab.closed_at,
  abi.id as item_id,
  pr.request_number,
  abi.director_status,
  abi.rebatch_status,
  abi.review_sequence,
  abi.decided_at as item_decided_at
from public.approval_batches ab
join public.approval_batch_items abi on abi.batch_id = ab.id
join public.payment_requests pr on pr.id = abi.payment_request_id
where ab.id = '4fc82585-a4b6-478d-bcf9-1c0aaeb427d9'::uuid
order by pr.request_number, abi.review_sequence;

select
  cf.id as cash_fund_id,
  pr.request_number,
  cf.assigned_amount,
  cf.status,
  cf.delivery_method,
  cf.assignment_date,
  cf.due_date,
  cf.created_at
from public.cash_funds cf
join public.payment_requests pr on pr.id = cf.payment_request_id
where pr.request_number in ('SOL-2026-0073', 'SOL-2026-0074')
order by pr.request_number;

commit;
