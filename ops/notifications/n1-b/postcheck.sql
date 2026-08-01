-- NOTIFICATIONS-N1-B-R1 future postcheck. Read-only and sanitized.
-- Run only immediately after an separately authorized migration apply.

\set ON_ERROR_STOP on
begin transaction isolation level repeatable read read only;

do $$
declare
  v_legacy text;
  v_producer text;
  v_sent text;
  v_failed text;
  v_n1a_tables integer;
  v_n1a_columns integer;
  v_n1a_indexes integer;
  v_n1a_functions integer;
  v_n1a_triggers integer;
begin
  if to_regclass('public.notification_external_dispatch_invocations') is null
     or to_regprocedure('public.enqueue_provider_intake_external_notification_v1(uuid)') is null
     or to_regprocedure('public.finalize_provider_intake_submission_v1(uuid,smallint,jsonb)') is null
     or to_regprocedure('public.provider_intake_submission_state_v1(uuid)') is null
     or to_regprocedure('public.provider_intake_external_transition_capability_v1()') is null
     or to_regprocedure('public.transition_provider_intake_external_v1(uuid,text,timestamptz,text,text,text,text[],uuid)') is null
     or to_regprocedure('public.register_external_notification_dispatch_invocation(text,text,text,timestamptz)') is null
     or to_regprocedure('public.get_external_notification_rollout_mode()') is null
     or to_regprocedure('public.reserve_external_notification_attempt(uuid,text)') is null
     or to_regprocedure('public.mark_external_provider_request_started(uuid,integer,text)') is null
     or to_regprocedure('public.mark_external_notification_sent(uuid,integer,text,text)') is null
     or to_regprocedure('public.mark_external_notification_failed(uuid,integer,text,text)') is null then
    raise exception 'n1b_postcheck_candidate_objects_missing';
  end if;

  select count(*)::integer into v_n1a_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'notification_external_rollouts'
    and c.relkind = 'r';

  select count(*)::integer into v_n1a_columns
  from information_schema.columns
  where table_schema = 'public' and (
    (table_name = 'notification_events' and column_name = any (array[
      'audience', 'event_version', 'rollout_id', 'external_subject_type',
      'external_subject_id', 'terminal_reason'
    ]::text[]))
    or (table_name = 'notification_delivery_attempts' and column_name = any (array[
      'provider_idempotency_key', 'safe_error_code',
      'provider_request_started_at', 'provider_request_completed_at'
    ]::text[]))
    or (table_name = 'payment_intake' and column_name = any (array[
      'expected_file_count', 'submission_completed_at'
    ]::text[]))
    or (table_name = 'payment_intake_events' and column_name = any (array[
      'external_message', 'external_field_codes', 'external_contract_version'
    ]::text[]))
  );

  select count(distinct p.proname)::integer into v_n1a_functions
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = any (array[
    'notification_external_event_type_allowed',
    'notification_external_event_mode_allowed',
    'notification_external_field_codes_valid',
    'notification_external_rollout_event_types_valid',
    'notification_external_hashes_valid',
    'notification_external_message_valid',
    'notification_external_json_keys_match',
    'notification_external_payload_valid',
    'notification_external_idempotency_valid',
    'protect_payment_intake_submission_completed',
    'protect_external_notification_contract',
    'protect_notification_delivery_attempt_contract',
    'claim_external_notification_events_for_dispatcher',
    'recover_stale_external_notification_events'
  ]::text[]);

  select count(*)::integer into v_n1a_triggers
  from pg_trigger t
  where not t.tgisinternal and t.tgname = any (array[
    'set_notification_external_rollouts_updated_at',
    'protect_payment_intake_submission_completed_trigger',
    'protect_external_notification_contract_trigger',
    'protect_notification_delivery_attempt_contract_trigger'
  ]::text[]);

  select count(*)::integer into v_n1a_indexes
  from pg_indexes
  where schemaname = 'public' and indexname = any (array[
    'notification_events_external_subject_version_uidx',
    'notification_events_external_claim_idx',
    'notification_delivery_attempts_event_number_uidx',
    'payment_intake_events_submission_completed_uidx'
  ]::text[]);

  if v_n1a_tables <> 1 or v_n1a_columns <> 15 or v_n1a_indexes <> 4
     or v_n1a_functions <> 14 or v_n1a_triggers <> 4 then
    raise exception 'n1b_postcheck_n1a_exact_inventory_failed';
  end if;

  if not exists (
    select 1 from public.notification_external_rollouts
    where id = 'provider-intake-v1'
      and mode = 'disabled'
      and cutoff_at is null
      and cardinality(enabled_event_types) = 0
      and cardinality(recipient_allowlist_hashes) = 0
      and batch_size = 1
      and daily_cap = 0
  ) then
    raise exception 'n1b_postcheck_rollout_changed';
  end if;

  if exists (select 1 from public.notification_events where audience = 'external')
     or exists (
       select 1 from public.notification_delivery_attempts a
       join public.notification_events e on e.id = a.notification_event_id
       where e.audience = 'external'
     )
     or exists (select 1 from public.payment_intake_events where event_type = 'submission_completed')
     or exists (select 1 from public.notification_external_dispatch_invocations) then
    raise exception 'n1b_postcheck_zero_row_contract_failed';
  end if;

  select lower(pg_get_functiondef(
    'public.transition_provider_intake(uuid,text,timestamptz,text,text,uuid)'::regprocedure
  )) into v_legacy;
  if position('provider_intake_external_transition_requires_v1' in v_legacy) = 0
     or position('received' in v_legacy) = 0
     or position('needs_correction' in v_legacy) = 0
     or position('in_review' in v_legacy) = 0 then
    raise exception 'n1b_postcheck_legacy_bypass_open';
  end if;

  select lower(pg_get_functiondef(
    'public.enqueue_provider_intake_external_notification_v1(uuid)'::regprocedure
  )) into v_producer;
  if position('cutoff_at' in v_producer) = 0
     or position('recipient_allowlist_hashes' in v_producer) = 0
     or position('for update' in v_producer) = 0
     or position('batch_size <> 1' in v_producer) = 0
     or position('daily_cap_reached' in v_producer) = 0
     or position('daily_event.status in (''pending'', ''processing'', ''sent'')' in v_producer) = 0
     or position('notification_external_event_mode_allowed' in v_producer) = 0
     or position('provider_intake.correction_requested' in v_producer) = 0
     or position('manual_follow_up_required' in v_producer) = 0
     or position('proveedores' in v_producer) > 0 then
    raise exception 'n1b_postcheck_zero_backlog_or_recipient_contract_missing';
  end if;

  select lower(pg_get_functiondef(
    'public.mark_external_notification_sent(uuid,integer,text,text)'::regprocedure
  )) into v_sent;
  select lower(pg_get_functiondef(
    'public.mark_external_notification_failed(uuid,integer,text,text)'::regprocedure
  )) into v_failed;
  if position('already_sent' in v_sent) = 0
     or position('external_sent_material_conflict' in v_sent) = 0
     or position('provider_response_invalid' in v_failed) = 0
     or position('mode = ''paused''' in v_failed) = 0
     or position('when 1 then 5 else 30' in v_failed) = 0 then
    raise exception 'n1b_postcheck_delivery_safety_contract_missing';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.transition_provider_intake_external_v1(uuid,text,timestamptz,text,text,text,text[],uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.transition_provider_intake_external_v1(uuid,text,timestamptz,text,text,text,text[],uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.finalize_provider_intake_submission_v1(uuid,smallint,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.finalize_provider_intake_submission_v1(uuid,smallint,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.provider_intake_external_transition_capability_v1()',
       'EXECUTE'
     ) then
    raise exception 'n1b_postcheck_rpc_grants_invalid';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.notification_external_dispatch_invocations'::regclass
      and relrowsecurity
  )
     or has_table_privilege('anon', 'public.notification_external_dispatch_invocations', 'SELECT')
     or has_table_privilege('authenticated', 'public.notification_external_dispatch_invocations', 'SELECT')
     or has_table_privilege('service_role', 'public.notification_external_dispatch_invocations', 'SELECT')
     or has_table_privilege('service_role', 'public.notification_external_dispatch_invocations', 'INSERT')
     or has_table_privilege('service_role', 'public.notification_external_dispatch_invocations', 'DELETE') then
    raise exception 'n1b_postcheck_invocation_rls_or_grants_invalid';
  end if;

  if not public.provider_intake_external_transition_capability_v1() then
    raise exception 'n1b_postcheck_ui_capability_missing';
  end if;

  if exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and not t.tgisinternal
      and c.relname in ('payment_intake', 'payment_intake_events')
      and lower(t.tgname) like '%external%notification%producer%'
  ) then
    raise exception 'n1b_postcheck_active_producer_trigger_found';
  end if;

  if to_regprocedure('public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)') is null
     or position(
       'provider_matched' in pg_get_functiondef(
         'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'::regprocedure
       )
     ) = 0 then
    raise exception 'n1b_postcheck_matching_changed';
  end if;
end
$$;

select
  'N1B_POSTCHECK_PASS' as result,
  0 as external_events,
  0 as external_attempts,
  0 as historical_completions,
  0 as invocation_rows,
  'disabled' as rollout_mode;

rollback;
