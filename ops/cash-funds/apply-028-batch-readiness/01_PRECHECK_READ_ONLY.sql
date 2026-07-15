-- Migration 028 manual gate - read-only precheck.
-- Run only in Supabase DEV project scsirgbuqjcwoaxfacth.

begin transaction read only;

with
create_cash_fund_info as (
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
    ('payment_requests', 'id'),
    ('payment_requests', 'status'),
    ('payment_requests', 'request_type'),
    ('payment_requests', 'payment_method'),
    ('payment_requests', 'approval_material_updated_at'),
    ('payment_requests', 'created_at'),
    ('approval_batch_items', 'payment_request_id'),
    ('approval_batch_items', 'director_status'),
    ('approval_batch_items', 'decided_at'),
    ('approval_batch_items', 'review_sequence'),
    ('approval_batch_items', 'removed_at'),
    ('approval_batches', 'status'),
    ('approval_batches', 'closed_at'),
    ('approval_batch_company_settings', 'regular_payments_require_closed_batch'),
    ('approval_batch_company_settings', 'enforcement_started_at'),
    ('cash_funds', 'payment_request_id'),
    ('payment_request_extraordinary_authorizations', 'status'),
    ('payment_request_extraordinary_authorizations', 'authorized_at')
),
checks as (
  select
    'transaction_is_read_only'::text as check_name,
    case when current_setting('transaction_read_only') = 'on' then 'PASS' else 'STOP' end as check_status,
    format('transaction_read_only=%s', current_setting('transaction_read_only')) as detail

  union all

  select
    'migration_025_present',
    case when to_regclass('public.intake_links') is not null
      and to_regprocedure('public.next_payment_intake_public_folio()') is not null
      then 'PASS' else 'STOP' end,
    'Migration 025 semantic baseline must already exist'

  union all

  select
    'required_relations_exist',
    case when to_regclass('public.payment_requests') is not null
      and to_regclass('public.cash_funds') is not null
      and to_regclass('public.approval_batches') is not null
      and to_regclass('public.approval_batch_items') is not null
      and to_regclass('public.approval_batch_company_settings') is not null
      and to_regclass('public.payment_request_extraordinary_authorizations') is not null
      then 'PASS' else 'STOP' end,
    'Payment, cash-fund, batch, settings and extraordinary relations are required'

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
    'canonical_batch_helpers_present',
    case when to_regprocedure('public.approval_batch_require_finance()') is not null
      and to_regprocedure('public.approval_batch_request_has_current_direction_approval(uuid)') is not null
      and to_regprocedure('public.approval_batch_request_has_active_extraordinary(uuid)') is not null
      and to_regprocedure('public.approval_batch_request_has_any_execution_record(uuid)') is not null
      and to_regprocedure('public.approval_batch_assert_execution_authorized()') is not null
      and to_regprocedure('public.get_payment_request_execution_context(uuid)') is not null
      then 'PASS' else 'STOP' end,
    'Migration 023 batch, extraordinary and execution helpers must exist'

  union all

  select
    'create_cash_fund_signature_matches_026',
    case when count(*) = 1 then 'PASS' else 'STOP' end,
    coalesce(max(format('args=%s; result=%s; defaults=%s', identity_arguments, result_type, default_argument_count)), 'Function missing')
  from create_cash_fund_info
  where identity_arguments =
      'p_payment_request_id uuid, p_responsible_profile_id uuid, p_due_date date, p_delivery_method text, p_delivered_by uuid, p_notes text'
    and result_type = 'jsonb'
    and language_name = 'plpgsql'
    and default_argument_count = 2
    and security_definer
    and exists (
      select 1
      from unnest(coalesce(function_settings, array[]::text[])) setting
      where replace(setting, ' ', '') = 'search_path=public,pg_temp'
    )

  union all

  select
    'create_cash_fund_026_gates_present',
    case when count(*) = 1 then 'PASS' else 'STOP' end,
    'payment_method normalization, legacy approved gate, Finance actor, row lock and duplicate protection must match the inspected baseline'
  from create_cash_fund_info
  where position('v_request.payment_method' in function_source) > 0
    and position('v_request.request_type::text' in function_source) > 0
    and position('payment_request_must_be_approved' in function_source) > 0
    and position('approval_batch_require_finance' in function_source) > 0
    and position('for update' in function_source) > 0
    and position('cash_fund_already_exists' in function_source) > 0

  union all

  select
    'migration_028_not_already_applied',
    case when to_regprocedure('public.get_payment_request_execution_readiness(uuid)') is null then 'PASS' else 'STOP' end,
    case when to_regprocedure('public.get_payment_request_execution_readiness(uuid)') is null
      then 'Readiness helper is absent as expected before first application'
      else 'Readiness helper already exists; do not rerun migration 028' end

  union all

  select
    'cash_fund_batch_trigger_active',
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
    'qa_requests_closed_and_current',
    case when count(distinct pr.request_number) = 2 then 'PASS' else 'STOP' end,
    coalesce(
      string_agg(format('%s status=%s method=%s batch=%s direction=%s',
        pr.request_number, pr.status, pr.payment_method, ab.status, abi.director_status), '; ' order by pr.request_number),
      'QA requests are missing or do not have current closed-batch authorization'
    )
  from public.payment_requests pr
  join public.approval_batch_items abi
    on abi.payment_request_id = pr.id
   and abi.removed_at is null
   and abi.director_status = 'approved'
  join public.approval_batches ab
    on ab.id = abi.batch_id
   and ab.status = 'closed'
  where pr.request_number in ('SOL-2026-0073', 'SOL-2026-0074')
    and pr.status::text = 'submitted'
    and abi.decided_at is not null
    and abi.decided_at >= pr.approval_material_updated_at
    and ab.closed_at is not null
    and ab.closed_at >= abi.decided_at
    and public.approval_batch_request_has_current_direction_approval(pr.id)

  union all

  select
    'qa_cash_check_values',
    case when count(*) = 2 then 'PASS' else 'STOP' end,
    coalesce(string_agg(format('%s %s %s %s', request_number, payment_method, amount_requested, currency), '; ' order by request_number), 'QA values missing')
  from public.payment_requests
  where (request_number = 'SOL-2026-0073' and lower(btrim(payment_method)) = 'cash' and amount_requested = 12.12 and currency = 'MXN')
     or (request_number = 'SOL-2026-0074' and lower(btrim(payment_method)) = 'check' and amount_requested = 13.13 and currency = 'MXN')

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
    'migration_027_dependency',
    'INFO',
    'Migration 027 is intentionally not inspected or required by migration 028'
)
select check_name, check_status, detail
from checks
order by check_name;

commit;
