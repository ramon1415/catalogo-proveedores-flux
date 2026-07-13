-- Respaldo logico de solo lectura. Ejecutar en DEV y descargar cada resultado.
begin transaction read only;

select
  current_database() as database_name,
  current_user as database_user,
  current_setting('transaction_read_only') as transaction_read_only,
  now() as captured_at;

select
  p.oid::regprocedure::text as function_signature,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any (array[
    'approval_batch_payment_layout_candidates',
    'preview_payment_layout_eligibility',
    'approval_batch_request_base_eligible',
    'list_batch_eligible_requests',
    'add_request_to_approval_batch',
    'submit_approval_batch',
    'approve_entire_batch',
    'decide_approval_batch_items',
    'release_and_rebatch_rejected_request',
    'get_approval_batch_detail',
    'authorize_payment_request_extraordinary',
    'approval_batch_assert_execution_authorized',
    'close_approval_batch',
    'get_payment_request_execution_context',
    'enqueue_rebatched_item_notification'
  ])
order by p.oid::regprocedure::text;

select
  a.attname as column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
  a.attnotnull as not_null,
  pg_get_expr(d.adbin, d.adrelid) as default_expression
from pg_attribute a
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where a.attrelid = 'public.approval_batch_items'::regclass
  and a.attnum > 0
  and not a.attisdropped
order by a.attnum;

select
  c.conname,
  c.contype,
  pg_get_constraintdef(c.oid, true) as constraint_definition
from pg_constraint c
where c.conrelid = 'public.approval_batch_items'::regclass
order by c.conname;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'approval_batch_items'
order by indexname;

select *
from public.approval_batches
order by created_at, id;

select *
from public.approval_batch_items
order by payment_request_id, created_at, id;

select *
from public.approval_batch_company_settings
order by company_id;

rollback;
