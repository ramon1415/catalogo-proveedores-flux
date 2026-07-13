-- Ejecutar solo despues de 03_LOAD_023_EXACT.sql en DEV.
begin transaction read only;

select
  current_database() as database_name,
  current_user as database_user,
  current_setting('transaction_read_only') as transaction_read_only,
  now() as checked_at;

with expected_columns(name) as (
  values
    ('previous_item_id'),
    ('review_sequence'),
    ('resubmitted_at'),
    ('resubmitted_by'),
    ('resubmission_note')
)
select
  'history_columns' as check_name,
  case when count(c.column_name) = 5 then 'PASS' else 'FAIL' end as check_status,
  count(c.column_name) as found_count,
  coalesce(string_agg(e.name, ', ') filter (where c.column_name is null), 'none') as missing
from expected_columns e
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = 'approval_batch_items'
 and c.column_name = e.name;

with expected_indexes(name) as (
  values
    ('approval_batch_items_request_review_uidx'),
    ('approval_batch_items_one_pending_review_uidx'),
    ('approval_batch_items_previous_item_idx')
)
select
  'history_indexes' as check_name,
  case when bool_and(to_regclass('public.' || name) is not null) then 'PASS' else 'FAIL' end as check_status,
  coalesce(string_agg(name, ', ') filter (where to_regclass('public.' || name) is null), 'none') as missing
from expected_indexes;

with expected_functions(signature) as (
  values
    ('public.approval_batch_budget_validation(uuid)'),
    ('public.approval_batch_request_eligibility(uuid,uuid)'),
    ('public.list_batch_eligible_requests(uuid)'),
    ('public.add_request_to_approval_batch(uuid,uuid)'),
    ('public.submit_approval_batch(uuid)'),
    ('public.approve_entire_batch(uuid)'),
    ('public.decide_approval_batch_items(uuid,jsonb)'),
    ('public.release_and_rebatch_rejected_request(uuid,text,uuid)'),
    ('public.get_approval_batch_detail(uuid)'),
    ('public.close_approval_batch(uuid)'),
    ('public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)'),
    ('public.preview_payment_layout_eligibility(date,date,uuid,uuid)'),
    ('public.complete_payment_request_layout_data(uuid,uuid,text,text,date)'),
    ('public.get_payment_request_execution_context(uuid)')
)
select
  'expected_functions' as check_name,
  case when bool_and(to_regprocedure(signature) is not null) then 'PASS' else 'FAIL' end as check_status,
  coalesce(string_agg(signature, ', ') filter (where to_regprocedure(signature) is null), 'none') as missing
from expected_functions;

select
  'single_pending_review' as check_name,
  case when count(*) = 0 then 'PASS' else 'FAIL' end as check_status,
  count(*) as conflicting_requests
from (
  select abi.payment_request_id
  from public.approval_batch_items abi
  where abi.removed_at is null
    and abi.director_status = 'pending'
  group by abi.payment_request_id
  having count(*) > 1
) conflicts;

select
  'unique_review_sequence' as check_name,
  case when count(*) = 0 then 'PASS' else 'FAIL' end as check_status,
  count(*) as conflicting_sequences
from (
  select abi.payment_request_id, abi.review_sequence
  from public.approval_batch_items abi
  where abi.removed_at is null
  group by abi.payment_request_id, abi.review_sequence
  having count(*) > 1
) conflicts;

select
  'regular_flow_without_individual_finance_approval' as check_name,
  case when count(*) = 0 then 'PASS' else 'FAIL' end as check_status,
  count(*) as functions_with_legacy_requirement
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any (array[
    'approval_batch_request_eligibility',
    'add_request_to_approval_batch',
    'submit_approval_batch',
    'approval_batch_assert_execution_authorized',
    'close_approval_batch'
  ])
  and position('approval_batch_request_has_current_finance_approval' in p.prosrc) > 0;

select
  'authenticated_rpc_grants' as check_name,
  case
    when has_function_privilege('authenticated', 'public.list_batch_eligible_requests(uuid)', 'EXECUTE')
     and has_function_privilege('authenticated', 'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.list_batch_eligible_requests(uuid)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)', 'EXECUTE')
    then 'PASS'
    else 'FAIL'
  end as check_status;

select
  count(*) as approval_batches_after,
  (select count(*) from public.approval_batch_items) as approval_batch_items_after,
  (select count(*) from public.payment_requests) as payment_requests_after,
  (select count(*) from public.payment_layouts) as payment_layouts_after,
  (select count(*) from public.payment_layout_lines) as payment_layout_lines_after;

select
  company_id,
  regular_payments_require_closed_batch,
  enforcement_started_at,
  updated_at
from public.approval_batch_company_settings
order by company_id;

rollback;
