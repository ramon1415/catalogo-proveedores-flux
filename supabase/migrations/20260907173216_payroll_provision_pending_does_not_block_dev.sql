-- DEV-only payroll hotfix.
-- A valid payroll package may materialize while the payroll provision policy is still
-- pending configuration. No percentage is inferred and no budget line is mutated in
-- that case. Once Finance configures the policy, the existing posting function keeps
-- its original behavior for subsequent payrolls.

begin;

do $patch_provision_function$
declare
  v_def text;
  v_old text := $old$select * into v_setting from public.payroll_provision_settings where company_id=v_request.company_id and active;
  if not found or v_setting.calculation_policy='pending' then raise exception 'PAYROLL_PROVISION_POLICY_REQUIRED'; end if;$old$;
  v_new text := $new$select * into v_setting from public.payroll_provision_settings where company_id=v_request.company_id and active;
  if not found or v_setting.calculation_policy='pending' then
    return jsonb_build_object(
      'status','pending_configuration',
      'payment_request_id',p_payment_request_id,
      'calculation_policy','pending',
      'policy_version',null
    );
  end if;$new$;
begin
  if to_regprocedure('public.post_payroll_provision_internal(uuid,bigint,numeric,numeric,text)') is null then
    raise exception 'payroll_provision_posting_function_missing';
  end if;

  select pg_get_functiondef('public.post_payroll_provision_internal(uuid,bigint,numeric,numeric,text)'::regprocedure)
    into v_def;

  if position(v_old in v_def) = 0 then
    raise exception 'payroll_provision_pending_guard_drifted';
  end if;

  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end
$patch_provision_function$;

-- RC1 materialization already writes these provision metadata keys. The prior
-- capture-session constraint predates RC1 and rejected them, so widen only the
-- allow-list; the lifecycle/integrity checks remain unchanged.
alter table public.payroll_capture_sessions
  drop constraint payroll_capture_sessions_materialized_check;

alter table public.payroll_capture_sessions
  add constraint payroll_capture_sessions_materialized_check check (
    (
      capture_state <> 'materialized'
      and materialized_payment_request_id is null
      and materialized_at is null
      and materialized_by is null
      and materialization_idempotency_hash is null
      and server_verification_summary is null
    )
    or
    (
      capture_state = 'materialized'
      and validation_status = 'valid'
      and materialized_payment_request_id is not null
      and materialized_at is not null
      and materialized_by is not null
      and materialization_idempotency_hash ~ '^[0-9a-f]{64}$'
      and jsonb_typeof(server_verification_summary) = 'object'
      and server_verification_summary - array[
        'contract_version','file_count','line_count','parser_versions','verified_at',
        'warning_codes','finance_review_required',
        'provision_base_amount_minor','provision_status',
        'provision_calculation_policy','provision_policy_version'
      ]::text[] = '{}'::jsonb
    )
  ) not valid;

alter table public.payroll_capture_sessions
  validate constraint payroll_capture_sessions_materialized_check;

do $postcheck$
declare
  v_def text;
begin
  select pg_get_functiondef('public.post_payroll_provision_internal(uuid,bigint,numeric,numeric,text)'::regprocedure)
    into v_def;

  if position('pending_configuration' in v_def) = 0 then
    raise exception 'payroll_provision_pending_behavior_missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid='public.payroll_capture_sessions'::regclass
      and conname='payroll_capture_sessions_materialized_check'
      and pg_get_constraintdef(oid) like '%provision_status%'
      and pg_get_constraintdef(oid) like '%provision_policy_version%'
  ) then
    raise exception 'payroll_materialized_summary_constraint_not_rc1_compatible';
  end if;
end
$postcheck$;

commit;
