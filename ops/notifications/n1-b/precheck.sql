-- NOTIFICATIONS-N1-B-R1 precheck. Read-only and sanitized.
-- Run only in a separately authorized apply gate; this candidate gate does not run SQL.

\set ON_ERROR_STOP on
begin transaction isolation level repeatable read read only;

do $$
declare
  v_n1a_objects integer;
  v_n1a_tables integer;
  v_n1a_columns integer;
  v_n1a_indexes integer;
  v_n1a_functions integer;
  v_n1a_triggers integer;
  v_n1a_rollout_rows integer;
  v_internal_claim text;
begin
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

  select count(*)::integer into v_n1a_rollout_rows
  from public.notification_external_rollouts
  where id = 'provider-intake-v1';

  v_n1a_objects := v_n1a_tables + v_n1a_columns + v_n1a_indexes
    + v_n1a_functions + v_n1a_triggers;

  if v_n1a_tables <> 1
     or v_n1a_columns <> 15
     or v_n1a_indexes <> 4
     or v_n1a_functions <> 14
     or v_n1a_triggers <> 4
     or v_n1a_rollout_rows <> 1
     or v_n1a_objects <> 38 then
    raise exception 'n1b_precheck_n1a_exact_inventory_failed';
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
    raise exception 'n1b_precheck_rollout_not_disabled';
  end if;

  if exists (select 1 from public.notification_events where audience = 'external')
     or exists (
       select 1 from public.notification_delivery_attempts a
       join public.notification_events e on e.id = a.notification_event_id
       where e.audience = 'external'
     )
     or exists (
       select 1 from public.payment_intake_events
       where event_type = 'submission_completed'
     ) then
    raise exception 'n1b_precheck_external_rows_not_zero';
  end if;

  if to_regprocedure('public.create_provider_intake_internal(text,jsonb,text,text,text,text,text,integer)') is null
     or to_regprocedure('public.attach_provider_intake_files_internal(uuid,jsonb)') is null
     or to_regprocedure('public.mark_provider_intake_upload_issue_internal(uuid,text)') is null
     or to_regprocedure('public.transition_provider_intake(uuid,text,timestamptz,text,text,uuid)') is null then
    raise exception 'n1b_precheck_provider_intake_rpc_missing';
  end if;

  if to_regclass('public.notification_external_dispatch_invocations') is not null
     or to_regprocedure('public.enqueue_provider_intake_external_notification_v1(uuid)') is not null
     or to_regprocedure('public.finalize_provider_intake_submission_v1(uuid,smallint,jsonb)') is not null
     or to_regprocedure('public.provider_intake_submission_state_v1(uuid)') is not null
     or to_regprocedure('public.provider_intake_external_transition_capability_v1()') is not null
     or to_regprocedure('public.transition_provider_intake_external_v1(uuid,text,timestamptz,text,text,text,text[],uuid)') is not null
     or to_regprocedure('public.register_external_notification_dispatch_invocation(text,text,text,timestamptz)') is not null
     or to_regprocedure('public.get_external_notification_rollout_mode()') is not null
     or to_regprocedure('public.reserve_external_notification_attempt(uuid,text)') is not null
     or to_regprocedure('public.mark_external_provider_request_started(uuid,integer,text)') is not null
     or to_regprocedure('public.mark_external_notification_sent(uuid,integer,text,text)') is not null
     or to_regprocedure('public.mark_external_notification_failed(uuid,integer,text,text)') is not null then
    raise exception 'n1b_precheck_candidate_object_collision';
  end if;

  select pg_get_functiondef(
    'public.claim_notification_events_for_dispatcher(integer,text)'::regprocedure
  ) into v_internal_claim;
  if position('audience = ''internal''' in lower(v_internal_claim)) = 0
     or position('audience = ''external''' in lower(v_internal_claim)) > 0 then
    raise exception 'n1b_precheck_internal_claim_lane_changed';
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
    raise exception 'n1b_precheck_external_producer_trigger_exists';
  end if;
end
$$;

select
  'N1B_PRECHECK_PASS' as result,
  38 as n1a_contract_objects,
  0 as external_events,
  0 as external_attempts,
  'disabled' as rollout_mode;

rollback;
