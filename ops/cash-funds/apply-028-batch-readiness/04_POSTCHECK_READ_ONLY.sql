-- Migration 028 manual package - read-only postcheck.
-- Run immediately after 03_LOAD_028_EXACT.sql and compare counts with 02_BACKUP_DEV.sql.

begin transaction read only;

with
function_info as (
  select
    p.oid,
    p.oid::regprocedure::text as signature,
    pg_get_function_result(p.oid) as result_type,
    l.lanname as language_name,
    p.prosecdef as security_definer,
    p.proconfig as function_settings,
    lower(p.prosrc) as function_source
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.oid in (
      to_regprocedure('public.get_payment_request_execution_readiness(uuid)'),
      to_regprocedure('public.get_payment_request_execution_context(uuid)'),
      to_regprocedure('public.create_cash_fund(uuid,uuid,date,text,uuid,text)'),
      to_regprocedure('public.approval_batch_assert_execution_authorized()')
    )
),
qa_readiness as (
  select
    pr.request_number,
    public.get_payment_request_execution_readiness(pr.id) as readiness
  from public.payment_requests pr
  where pr.request_number in ('SOL-2026-0073', 'SOL-2026-0074')
),
checks as (
  select
    'transaction_is_read_only'::text as check_name,
    case when current_setting('transaction_read_only') = 'on' then 'PASS' else 'STOP' end as check_status,
    format('transaction_read_only=%s', current_setting('transaction_read_only')) as detail

  union all

  select
    'readiness_helper_signature',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    coalesce(max(format('%s returns %s language %s', signature, result_type, language_name)), 'Helper missing')
  from function_info
  where signature = 'get_payment_request_execution_readiness(uuid)'
    and result_type = 'jsonb'
    and language_name = 'plpgsql'

  union all

  select
    'readiness_helper_security',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'SECURITY DEFINER with fixed public,pg_temp search_path'
  from function_info
  where signature = 'get_payment_request_execution_readiness(uuid)'
    and security_definer
    and exists (
      select 1
      from unnest(coalesce(function_settings, array[]::text[])) setting
      where replace(setting, ' ', '') = 'search_path=public,pg_temp'
    )

  union all

  select
    'readiness_paths_present',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'closed_batch, extraordinary, legacy_approved, material-change, execution and duplicate paths are recognizable'
  from function_info
  where signature = 'get_payment_request_execution_readiness(uuid)'
    and position('closed_batch' in function_source) > 0
    and position('extraordinary' in function_source) > 0
    and position('legacy_approved' in function_source) > 0
    and position('material_change_requires_reapproval' in function_source) > 0
    and position('approval_batch_request_has_any_execution_record' in function_source) > 0
    and position('cash_fund_already_exists' in function_source) > 0

  union all

  select
    'create_cash_fund_uses_readiness',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'Exclusive status=approved gate removed; Finance, method, row-lock, duplicate and insert contracts retained'
  from function_info
  where signature = 'create_cash_fund(uuid,uuid,date,text,uuid,text)'
    and position('get_payment_request_execution_readiness' in function_source) > 0
    and position('payment_request_must_be_approved' in function_source) = 0
    and position('approval_batch_require_finance' in function_source) > 0
    and position('v_request.payment_method' in function_source) > 0
    and position('v_request.request_type::text' in function_source) > 0
    and position('for update' in function_source) > 0
    and position('cash_fund_already_exists' in function_source) > 0
    and position('insert into public.cash_funds' in function_source) > 0

  union all

  select
    'execution_context_extended_compatibly',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'Existing context now exposes can_create_cash_fund, block reason and authorization source'
  from function_info
  where signature = 'get_payment_request_execution_context(uuid)'
    and position('can_create_cash_fund' in function_source) > 0
    and position('cash_fund_block_reason' in function_source) > 0
    and position('execution_authorization_source' in function_source) > 0
    and position('approval_history' in function_source) > 0

  union all

  select
    'cash_fund_batch_trigger_active_and_consistent',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    coalesce(max(pg_get_triggerdef(t.oid, true)), 'require_batch_for_cash_fund missing')
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public'
    and c.relname = 'cash_funds'
    and t.tgname = 'require_batch_for_cash_fund'
    and p.proname = 'approval_batch_assert_execution_authorized'
    and position('get_payment_request_execution_readiness' in lower(p.prosrc)) > 0
    and not t.tgisinternal
    and t.tgenabled <> 'D'

  union all

  select
    'least_privilege_grants',
    case when
      not has_function_privilege('authenticated', 'public.get_payment_request_execution_readiness(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.get_payment_request_execution_readiness(uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.get_payment_request_execution_context(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.get_payment_request_execution_context(uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)', 'EXECUTE')
      then 'PASS' else 'FAIL' end,
    'Internal readiness is not callable by authenticated/anon; context and create_cash_fund are authenticated-only'

  union all

  select
    'qa_closed_batch_readiness',
    case when count(*) filter (
      where coalesce((readiness ->> 'can_execute')::boolean, false)
        and readiness ->> 'authorization_source' = 'closed_batch'
        and readiness ->> 'request_status' = 'submitted'
        and readiness ->> 'payment_method' in ('cash', 'check')
        and not coalesce((readiness ->> 'execution_exists')::boolean, true)
    ) = 2 then 'PASS' else 'FAIL' end,
    coalesce(string_agg(request_number || ': ' || readiness::text, E'\n' order by request_number), 'QA requests missing')
  from qa_readiness

  union all

  select
    'qa_cash_check_funds_still_absent',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('cash_funds created for SOL-2026-0073/0074 by migration: %s', count(*))
  from public.cash_funds cf
  join public.payment_requests pr on pr.id = cf.payment_request_id
  where pr.request_number in ('SOL-2026-0073', 'SOL-2026-0074')

  union all

  select
    'cash_fund_idempotency_constraint',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    coalesce(max(pc.conname || ': ' || pg_get_constraintdef(pc.oid)), 'Unique payment_request_id constraint missing')
  from pg_constraint pc
  join pg_class c on c.oid = pc.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'cash_funds'
    and pc.contype = 'u'
    and pg_get_constraintdef(pc.oid) = 'UNIQUE (payment_request_id)'

  union all

  select
    'request_status_unchanged',
    case when count(*) = 2 then 'PASS' else 'FAIL' end,
    coalesce(string_agg(request_number || '=' || status::text, '; ' order by request_number), 'QA requests missing or status changed')
  from public.payment_requests
  where request_number in ('SOL-2026-0073', 'SOL-2026-0074')
    and status::text = 'submitted'

  union all

  select
    'migration_027_dependency',
    'INFO',
    'Migration 027 remains outside this contract and was not required by migration 028'
)
select check_name, check_status, detail
from checks
order by check_name;

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

commit;
