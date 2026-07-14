-- Migration 026 manual gate - consolidated read-only postcheck.
-- Run immediately after the exact load and before any functional retest.

begin transaction read only;

with
function_info as (
  select
    p.oid,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_function_result(p.oid) as result_type,
    l.lanname as language_name,
    p.prosecdef as security_definer,
    p.proconfig as function_settings,
    lower(p.prosrc) as function_source,
    p.pronargdefaults as default_argument_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.oid = to_regprocedure('public.create_cash_fund(uuid,uuid,date,text,uuid,text)')
),
public_execute as (
  select count(*)::integer as grant_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  where n.nspname = 'public'
    and p.oid = to_regprocedure('public.create_cash_fund(uuid,uuid,date,text,uuid,text)')
    and acl.grantee = 0
    and acl.privilege_type = 'EXECUTE'
),
batch_trigger as (
  select
    t.oid,
    t.tgenabled,
    pg_get_triggerdef(t.oid, true) as trigger_definition,
    lower(p.prosrc) as trigger_function_source
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public'
    and c.relname = 'cash_funds'
    and t.tgname = 'require_batch_for_cash_fund'
    and p.proname = 'approval_batch_assert_execution_authorized'
    and not t.tgisinternal
),
checks as (
  select
    'migration_025_present'::text as check_name,
    case when
      to_regclass('public.intake_links') is not null
      and to_regclass('public.payment_intake') is not null
      and to_regclass('public.payment_intake_files') is not null
      and to_regclass('public.payment_intake_events') is not null
      and to_regprocedure('public.next_payment_intake_public_folio()') is not null
      then 'PASS' else 'FAIL' end as check_status,
    'Migration 025 semantic objects remain present' as detail

  union all

  select
    'create_cash_fund_exists',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    format('Exact function rows: %s', count(*))
  from function_info

  union all

  select
    'function_signature_unchanged',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    coalesce(
      max(format('args=%s; result=%s; language=%s; defaults=%s',
        identity_arguments, result_type, language_name, default_argument_count)),
      'Function missing or signature changed'
    )
  from function_info
  where identity_arguments =
      'p_payment_request_id uuid, p_responsible_profile_id uuid, p_due_date date, p_delivery_method text, p_delivered_by uuid, p_notes text'
    and result_type = 'jsonb'
    and language_name = 'plpgsql'
    and default_argument_count = 2

  union all

  select
    'security_definer_preserved',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    coalesce(max(format('security_definer=%s', security_definer)), 'Function missing')
  from function_info
  where security_definer

  union all

  select
    'search_path_fixed',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    coalesce(max(function_settings::text), 'search_path is missing')
  from function_info
  where exists (
    select 1
    from unnest(coalesce(function_settings, array[]::text[])) setting
    where replace(setting, ' ', '') = 'search_path=public,pg_temp'
  )

  union all

  select
    'grants_preserved',
    case when
      has_function_privilege('authenticated', 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)', 'EXECUTE')
      and public_execute.grant_count = 0
      then 'PASS' else 'FAIL' end,
    format(
      'Expected RPC contract: authenticated only; authenticated=%s; anon=%s; PUBLIC ACL entries=%s',
      has_function_privilege('authenticated', 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)', 'EXECUTE'),
      has_function_privilege('anon', 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)', 'EXECUTE'),
      public_execute.grant_count
    )
  from public_execute

  union all

  select
    'anon_execute_false',
    case when not has_function_privilege(
      'anon', 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)', 'EXECUTE'
    ) then 'PASS' else 'FAIL' end,
    format('anon EXECUTE=%s', has_function_privilege(
      'anon', 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)', 'EXECUTE'
    ))

  union all

  select
    'public_execute_false',
    case when public_execute.grant_count = 0 then 'PASS' else 'FAIL' end,
    format('PUBLIC EXECUTE ACL entries=%s', public_execute.grant_count)
  from public_execute

  union all

  select
    'canonical_payment_method_gate_present',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'Function source resolves payment_requests.payment_method before legacy fallback'
  from function_info
  where position('v_request.payment_method' in function_source) > 0
    and position('coalesce(' in function_source) > 0
    and position('v_request_payment_method' in function_source) > 0

  union all

  select
    'legacy_fallback_present',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'request_type fallback and legacy efectivo/cheque normalization remain available'
  from function_info
  where position('v_request.request_type::text' in function_source) > 0
    and position('when ''efectivo'' then ''cash''' in function_source) > 0
    and position('when ''cheque'' then ''check''' in function_source) > 0

  union all

  select
    'only_cash_check_allowed',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'The normalized request method and delivery method allow only cash/check'
  from function_info
  where position('v_request_payment_method not in (''cash'', ''check'')' in function_source) > 0
    and position('v_delivery_method not in (''cash'', ''check'')' in function_source) > 0
    and position('payment_request_must_be_cash_or_check' in function_source) > 0

  union all

  select
    'delivery_method_matches_request',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'Caller delivery_method must match the canonical or legacy-normalized request method'
  from function_info
  where position('v_delivery_method <> v_request_payment_method' in function_source) > 0
    and position('delivery_method_must_match_payment_request' in function_source) > 0

  union all

  select
    'finance_actor_gate_present',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'create_cash_fund invokes the canonical Finance actor guard'
  from function_info
  where position('approval_batch_require_finance' in function_source) > 0

  union all

  select
    'approval_gate_preserved',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    'Request status must remain approved before fund insertion'
  from function_info
  where position('v_request.status::text <> ''approved''' in function_source) > 0
    and position('payment_request_must_be_approved' in function_source) > 0

  union all

  select
    'closed_batch_gate_preserved',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    coalesce(max(trigger_definition), 'cash_funds execution trigger missing or disabled')
  from batch_trigger
  where tgenabled <> 'D'
    and position('BEFORE INSERT OR UPDATE OF payment_request_id' in trigger_definition) > 0
    and position('approval_batch_request_has_current_direction_approval' in trigger_function_source) > 0
    and position('closed_batch_authorization_required' in trigger_function_source) > 0

  union all

  select
    'idempotency_gate_preserved',
    case when
      exists (
        select 1
        from function_info
        where position('cash_fund_already_exists' in function_source) > 0
          and position('for update' in function_source) > 0
      )
      and exists (
        select 1
        from pg_constraint pc
        join pg_class c on c.oid = pc.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'cash_funds'
          and pc.contype = 'u'
          and pg_get_constraintdef(pc.oid) = 'UNIQUE (payment_request_id)'
      )
      then 'PASS' else 'FAIL' end,
    'RPC duplicate check, row lock and database uniqueness must all remain present'

  union all

  select
    'payment_requests_count_unchanged',
    'INFO',
    format('Current rows=%s; compare with 02_BACKUP_DEV.sql export', count(*))
  from public.payment_requests

  union all

  select
    'cash_funds_count_unchanged',
    'INFO',
    format('Current rows=%s; compare with 02_BACKUP_DEV.sql export', count(*))
  from public.cash_funds

  union all

  select
    'qa_cash_request_exists',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    coalesce(max(format('%s; request_type=%s; payment_method=%s; amount=%s %s',
      request_number, request_type, payment_method, amount_requested, currency)), 'SOL-2026-0073 missing')
  from public.payment_requests
  where request_number = 'SOL-2026-0073'
    and request_type::text = 'provider_payment'
    and lower(btrim(payment_method)) = 'cash'
    and amount_requested = 12.12
    and currency = 'MXN'

  union all

  select
    'qa_check_request_exists',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    coalesce(max(format('%s; request_type=%s; payment_method=%s; amount=%s %s',
      request_number, request_type, payment_method, amount_requested, currency)), 'SOL-2026-0074 missing')
  from public.payment_requests
  where request_number = 'SOL-2026-0074'
    and request_type::text = 'provider_payment'
    and lower(btrim(payment_method)) = 'check'
    and amount_requested = 13.13
    and currency = 'MXN'

  union all

  select
    'qa_cash_fund_absent_before_retest',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('cash_funds rows for SOL-2026-0073=%s', count(*))
  from public.cash_funds cf
  join public.payment_requests pr on pr.id = cf.payment_request_id
  where pr.request_number = 'SOL-2026-0073'

  union all

  select
    'qa_check_fund_absent_before_retest',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('cash_funds rows for SOL-2026-0074=%s', count(*))
  from public.cash_funds cf
  join public.payment_requests pr on pr.id = cf.payment_request_id
  where pr.request_number = 'SOL-2026-0074'
)
select check_name, check_status, detail
from checks
order by check_name;

commit;
