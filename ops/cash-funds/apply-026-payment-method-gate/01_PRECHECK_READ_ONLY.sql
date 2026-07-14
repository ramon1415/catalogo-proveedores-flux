-- Migration 026 manual gate - read-only precheck.
-- Run only in Supabase DEV project scsirgbuqjcwoaxfacth.

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
required_columns(table_name, column_name) as (
  values
    ('payment_requests', 'request_type'),
    ('payment_requests', 'payment_method'),
    ('payment_requests', 'status'),
    ('payment_requests', 'amount_requested'),
    ('payment_requests', 'company_id'),
    ('payment_requests', 'operational_comments'),
    ('payment_requests', 'updated_at'),
    ('cash_funds', 'payment_request_id'),
    ('cash_funds', 'company_id'),
    ('cash_funds', 'responsible_profile_id'),
    ('cash_funds', 'assigned_amount'),
    ('cash_funds', 'due_date'),
    ('cash_funds', 'status'),
    ('cash_funds', 'delivery_method')
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
checks as (
  select
    'transaction_is_read_only'::text as check_name,
    case when current_setting('transaction_read_only') = 'on' then 'PASS' else 'STOP' end as check_status,
    format('transaction_read_only=%s', current_setting('transaction_read_only')) as detail

  union all

  select
    'migration_025_present',
    case when
      to_regclass('public.intake_links') is not null
      and to_regclass('public.payment_intake') is not null
      and to_regclass('public.payment_intake_files') is not null
      and to_regclass('public.payment_intake_events') is not null
      and to_regclass('public.payment_intake_public_folio_seq') is not null
      and to_regprocedure('public.next_payment_intake_public_folio()') is not null
      then 'PASS' else 'STOP' end,
    'Migration 025 semantic objects must already exist'

  union all

  select
    'required_relations_exist',
    case when
      to_regclass('public.payment_requests') is not null
      and to_regclass('public.cash_funds') is not null
      and to_regclass('public.profiles') is not null
      and to_regclass('public.approval_batches') is not null
      and to_regclass('public.approval_batch_items') is not null
      and to_regclass('public.approval_batch_company_settings') is not null
      and to_regclass('public.payment_request_extraordinary_authorizations') is not null
      then 'PASS' else 'STOP' end,
    'Payment, cash-fund, profile, batch and extraordinary relations are required'

  union all

  select
    'required_columns_exist',
    case when count(*) filter (where c.column_name is null) = 0 then 'PASS' else 'STOP' end,
    coalesce(
      string_agg(rc.table_name || '.' || rc.column_name, ', ' order by rc.table_name, rc.column_name)
        filter (where c.column_name is null),
      format('All %s required columns exist', count(*))
    )
  from required_columns rc
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = rc.table_name
   and c.column_name = rc.column_name

  union all

  select
    'create_cash_fund_exists',
    case when count(*) = 1 then 'PASS' else 'STOP' end,
    format('Exact signature rows: %s', count(*))
  from function_info

  union all

  select
    'function_signature_matches_baseline',
    case when count(*) = 1 then 'PASS' else 'STOP' end,
    coalesce(
      max(format('args=%s; result=%s; defaults=%s', identity_arguments, result_type, default_argument_count)),
      'Function missing'
    )
  from function_info
  where identity_arguments =
      'p_payment_request_id uuid, p_responsible_profile_id uuid, p_due_date date, p_delivery_method text, p_delivered_by uuid, p_notes text'
    and result_type = 'jsonb'
    and language_name = 'plpgsql'
    and default_argument_count = 2

  union all

  select
    'security_definer_present',
    case when count(*) = 1 then 'PASS' else 'STOP' end,
    coalesce(max(format('security_definer=%s; settings=%s', security_definer, function_settings)), 'Function missing')
  from function_info
  where security_definer

  union all

  select
    'legacy_method_gate_present',
    case when count(*) = 1 then 'PASS' else 'STOP' end,
    'Expected legacy request_type-only gate must be present before applying 026'
  from function_info
  where position('v_request.request_type::text not in' in function_source) > 0
    and position('payment_request_must_be_cash_or_check' in function_source) > 0
    and position('v_request.payment_method' in function_source) = 0

  union all

  select
    'legacy_function_gates_present',
    case when count(*) = 1 then 'PASS' else 'STOP' end,
    'Row lock, approved status, responsible, duplicate and insert/update contracts must remain recognizable'
  from function_info
  where position('for update' in function_source) > 0
    and position('payment_request_must_be_approved' in function_source) > 0
    and position('responsible_profile_not_found' in function_source) > 0
    and position('cash_fund_already_exists' in function_source) > 0
    and position('insert into public.cash_funds' in function_source) > 0
    and position('update public.payment_requests' in function_source) > 0

  union all

  select
    'batch_trigger_present',
    case when count(*) = 1 then 'PASS' else 'STOP' end,
    coalesce(max(pg_get_triggerdef(t.oid, true)), 'require_batch_for_cash_fund missing')
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public'
    and c.relname = 'cash_funds'
    and t.tgname = 'require_batch_for_cash_fund'
    and p.proname = 'approval_batch_assert_execution_authorized'
    and not t.tgisinternal
    and t.tgenabled <> 'D'

  union all

  select
    'batch_contract_present',
    case when
      to_regprocedure('public.approval_batch_require_finance()') is not null
      and to_regprocedure('public.approval_batch_request_has_current_direction_approval(uuid)') is not null
      and to_regprocedure('public.approval_batch_assert_execution_authorized()') is not null
      then 'PASS' else 'STOP' end,
    'Finance actor helper and cash-fund execution trigger helper must exist'

  union all

  select
    'cash_fund_idempotency_constraint',
    case when count(*) = 1 then 'PASS' else 'STOP' end,
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
    'qa_cash_request_ready_for_migration',
    case when count(*) = 1 then 'PASS' else 'STOP' end,
    coalesce(
      max(format('%s; status=%s; request_type=%s; payment_method=%s; amount=%s %s',
        request_number, status, request_type, payment_method, amount_requested, currency)),
      'SOL-2026-0073 missing or not canonical cash MXN 12.12'
    )
  from public.payment_requests
  where request_number = 'SOL-2026-0073'
    and request_type::text = 'provider_payment'
    and lower(btrim(payment_method)) = 'cash'
    and amount_requested = 12.12
    and currency = 'MXN'

  union all

  select
    'qa_check_request_ready_for_migration',
    case when count(*) = 1 then 'PASS' else 'STOP' end,
    coalesce(
      max(format('%s; status=%s; request_type=%s; payment_method=%s; amount=%s %s',
        request_number, status, request_type, payment_method, amount_requested, currency)),
      'SOL-2026-0074 missing or not canonical check MXN 13.13'
    )
  from public.payment_requests
  where request_number = 'SOL-2026-0074'
    and request_type::text = 'provider_payment'
    and lower(btrim(payment_method)) = 'check'
    and amount_requested = 13.13
    and currency = 'MXN'

  union all

  select
    'qa_cash_check_funds_absent',
    case when count(*) = 0 then 'PASS' else 'STOP' end,
    format('Existing cash_funds for SOL-2026-0073/0074: %s', count(*))
  from public.cash_funds cf
  join public.payment_requests pr on pr.id = cf.payment_request_id
  where pr.request_number in ('SOL-2026-0073', 'SOL-2026-0074')

  union all

  select
    'current_execute_grants_snapshot',
    'INFO',
    format(
      'authenticated=%s; anon=%s; PUBLIC ACL entries=%s. Migration 026 will enforce authenticated-only.',
      has_function_privilege('authenticated', 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)', 'EXECUTE'),
      has_function_privilege('anon', 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)', 'EXECUTE'),
      public_execute.grant_count
    )
  from public_execute
)
select check_name, check_status, detail
from checks
order by check_name;

commit;
