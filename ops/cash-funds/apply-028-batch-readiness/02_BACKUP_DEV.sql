-- Migration 028 manual package - read-only DEV contract backup.
-- Save every result set before applying 03_LOAD_028_EXACT.sql.

begin transaction read only;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid in (
    to_regprocedure('public.create_cash_fund(uuid,uuid,date,text,uuid,text)'),
    to_regprocedure('public.approval_batch_assert_execution_authorized()'),
    to_regprocedure('public.approval_batch_request_has_current_direction_approval(uuid)'),
    to_regprocedure('public.approval_batch_request_has_active_extraordinary(uuid)'),
    to_regprocedure('public.get_payment_request_execution_context(uuid)')
  )
order by p.proname, identity_arguments;

select
  p.oid::regprocedure::text as function_signature,
  coalesce(grantee.rolname, 'PUBLIC') as grantee,
  acl.privilege_type,
  acl.is_grantable
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
left join pg_roles grantee on grantee.oid = acl.grantee
where n.nspname = 'public'
  and p.oid in (
    to_regprocedure('public.create_cash_fund(uuid,uuid,date,text,uuid,text)'),
    to_regprocedure('public.approval_batch_assert_execution_authorized()'),
    to_regprocedure('public.get_payment_request_execution_context(uuid)')
  )
order by function_signature, grantee, acl.privilege_type;

select
  n.nspname as schema_name,
  c.relname as table_name,
  t.tgname as trigger_name,
  t.tgenabled as trigger_enabled,
  p.proname as trigger_function,
  pg_get_triggerdef(t.oid, true) as trigger_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'public'
  and t.tgname in ('require_batch_for_cash_fund', 'require_batch_for_payment_layout_line')
  and not t.tgisinternal
order by c.relname, t.tgname;

select 'payment_requests' as relation_name, count(*) as row_count from public.payment_requests
union all
select 'cash_funds', count(*) from public.cash_funds
union all
select 'approval_batches', count(*) from public.approval_batches
union all
select 'approval_batch_items', count(*) from public.approval_batch_items
union all
select 'payment_request_extraordinary_authorizations', count(*) from public.payment_request_extraordinary_authorizations
order by relation_name;

select
  pr.id as payment_request_id,
  pr.request_number,
  pr.status::text as request_status,
  pr.request_type::text as request_type,
  pr.payment_method,
  pr.amount_requested,
  pr.currency,
  pr.created_at,
  pr.approval_material_updated_at,
  abi.id as batch_item_id,
  abi.director_status,
  abi.decided_at,
  abi.review_sequence,
  ab.id as batch_id,
  ab.label as batch_label,
  ab.status as batch_status,
  ab.closed_at,
  exists (
    select 1 from public.cash_funds cf where cf.payment_request_id = pr.id
  ) as cash_fund_exists,
  public.approval_batch_request_has_current_direction_approval(pr.id) as direction_approval_current,
  public.approval_batch_request_has_active_extraordinary(pr.id) as extraordinary_active,
  public.approval_batch_request_has_any_execution_record(pr.id) as execution_exists
from public.payment_requests pr
left join lateral (
  select item.*
  from public.approval_batch_items item
  where item.payment_request_id = pr.id
    and item.removed_at is null
  order by item.review_sequence desc, item.created_at desc, item.id desc
  limit 1
) abi on true
left join public.approval_batches ab on ab.id = abi.batch_id
where pr.request_number in ('SOL-2026-0073', 'SOL-2026-0074')
order by pr.request_number;

select
  settings.company_id,
  settings.regular_payments_require_closed_batch,
  settings.enforcement_started_at,
  settings.enabled_at
from public.approval_batch_company_settings settings
where settings.company_id in (
  select pr.company_id
  from public.payment_requests pr
  where pr.request_number in ('SOL-2026-0073', 'SOL-2026-0074')
);

commit;
