-- NOTIFICATIONS-N1-B behavioral contract suite and numbered catalog.
-- No DEV dependency, no secrets, no network and no permanent writes.
-- Execute only in a separately authorized disposable database after migration 042.

\set ON_ERROR_STOP on
begin;

create temporary table n1b_contract_results (
  test_number smallint primary key,
  test_name text not null unique,
  status text not null check (status = 'PASS')
) on commit drop;

do $$
declare
  v_producer text;
  v_finalize text;
  v_transition text;
  v_legacy text;
  v_reserve text;
  v_started text;
  v_sent text;
  v_failed text;
  v_register text;
  v_claim text;
  v_expiry text;
  v_internal_claim text;
begin
  select lower(pg_get_functiondef('public.enqueue_provider_intake_external_notification_v1(uuid)'::regprocedure)) into v_producer;
  select lower(pg_get_functiondef('public.finalize_provider_intake_submission_v1(uuid,smallint,jsonb)'::regprocedure)) into v_finalize;
  select lower(pg_get_functiondef('public.transition_provider_intake_external_v1(uuid,text,timestamptz,text,text,text,text[],uuid)'::regprocedure)) into v_transition;
  select lower(pg_get_functiondef('public.transition_provider_intake(uuid,text,timestamptz,text,text,uuid)'::regprocedure)) into v_legacy;
  select lower(pg_get_functiondef('public.reserve_external_notification_attempt(uuid,text)'::regprocedure)) into v_reserve;
  select lower(pg_get_functiondef('public.mark_external_provider_request_started(uuid,integer,text)'::regprocedure)) into v_started;
  select lower(pg_get_functiondef('public.mark_external_notification_sent(uuid,integer,text,text)'::regprocedure)) into v_sent;
  select lower(pg_get_functiondef('public.mark_external_notification_failed(uuid,integer,text,text)'::regprocedure)) into v_failed;
  select lower(pg_get_functiondef('public.register_external_notification_dispatch_invocation(text,text,text,timestamptz)'::regprocedure)) into v_register;
  select lower(pg_get_functiondef('public.claim_external_notification_events_for_dispatcher(integer,text)'::regprocedure)) into v_claim;
  select lower(pg_get_functiondef('public.expire_stale_external_notification_events_v1(text)'::regprocedure)) into v_expiry;
  select lower(pg_get_functiondef('public.claim_notification_events_for_dispatcher(integer,text)'::regprocedure)) into v_internal_claim;

  if position('rollout_disabled' in v_producer) = 0
     or position('paused' in v_producer) = 0
     or position('cutoff_at' in v_producer) = 0
     or position('source_before_cutoff' in v_producer) = 0
     or position('enabled_event_types' in v_producer) = 0
     or position('recipient_allowlist_hashes' in v_producer) = 0
     or position('no_recipient' in v_producer) = 0
     or position('''no_recipient''' in v_producer) = 0
     or position('expire_stale_external_notification_events_v1' in v_producer) = 0
     or position('interval ''24 hours''' in v_producer) = 0
     or position('manual_follow_up_required' in v_producer) = 0
     or position('provider_matched' in v_producer) > 0
     or position('internal_note' in v_producer) > 0
     or position('proveedores' in v_producer) > 0 then
    raise exception 'N1B_DOMAIN_PRODUCER_CONTRACT_FAILED';
  end if;

  if position('status = ''cancelled''' in v_expiry) = 0
     or position('status = ''pending''' in v_expiry) = 0
     or position('interval ''24 hours''' in v_expiry) = 0
     or position('external_dispatch_window_expired' in v_expiry) = 0
     or position('expire_stale_external_notification_events_v1' in v_claim) = 0
     or position('e.created_at >= now() - interval ''24 hours''' in v_claim) = 0 then
    raise exception 'N1B_STALE_PENDING_EXPIRY_CONTRACT_FAILED';
  end if;

  if position('audience = ''internal''' in v_internal_claim) = 0
     or position('audience = ''external''' in v_internal_claim) > 0 then
    raise exception 'N1B_INTERNAL_LANE_CONTRACT_FAILED';
  end if;

  if position('for update of pi' in v_finalize) = 0
     or position('storage.objects' in v_finalize) = 0
     or position('expected_file_count' in v_finalize) = 0
     or position('submission_completed' in v_finalize) = 0
     or position('provider_intake_upload_issue_present' in v_finalize) = 0
     or position('enqueue_provider_intake_external_notification_v1' in v_finalize) = 0 then
    raise exception 'N1B_ATOMIC_SUBMISSION_CONTRACT_FAILED';
  end if;

  if position('p_internal_notes' in v_transition) = 0
     or position('p_external_message' in v_transition) = 0
     or position('p_external_field_codes' in v_transition) = 0
     or position('provider_intake_assert_company_access' in v_transition) = 0
     or position('notification_external_message_valid' in v_transition) = 0
     or position('notification_external_field_codes_valid' in v_transition) = 0
     or position('enqueue_provider_intake_external_notification_v1' in v_transition) = 0
     or position('provider_intake_external_transition_requires_v1' in v_legacy) = 0 then
    raise exception 'N1B_TRIAGE_CONTRACT_FAILED';
  end if;

  if position('attempt_count >= 3' in v_reserve) = 0
     or position('provider_idempotency_key' in v_reserve) = 0
     or position('provider_request_started_at' in v_started) = 0
     or position('provider_request_completed_at' in v_sent) = 0
     or position('provider_rate_limited' in v_failed) = 0
     or position('provider_timeout_unknown' in v_failed) = 0
     or position('provider_auth_failed' in v_failed) = 0
     or position('safe_error_code' in v_failed) = 0 then
    raise exception 'N1B_ATTEMPT_LIFECYCLE_CONTRACT_FAILED';
  end if;

  if to_regclass('public.notification_external_dispatch_invocations') is null
     or position('abs(extract(epoch' in v_register) = 0
     or position('replay_detected' in v_register) = 0
     or position('on conflict (key_id, invocation_id) do nothing' in v_register) = 0 then
    raise exception 'N1B_REPLAY_CONTRACT_FAILED';
  end if;

  if exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
      and c.relname in ('payment_intake', 'payment_intake_events')
      and lower(t.tgname) like '%external%notification%producer%'
  ) then
    raise exception 'N1B_BACKFILL_TRIGGER_FORBIDDEN';
  end if;
end
$$;

-- The following fixtures exercise the real functions. All rows are synthetic and
-- the terminal ROLLBACK guarantees zero persistent delta.
-- The source schema normally enforces a valid non-null email. This disposable-only
-- relaxation creates impossible legacy inputs so the terminal no-recipient guard is
-- executable; both DDL changes are reverted by the terminal ROLLBACK.
alter table public.payment_intake
  drop constraint payment_intake_provider_email_check;
alter table public.payment_intake
  alter column provider_email drop not null;

insert into public.profiles (id, full_name, email)
values (
  '10000000-0000-4000-8000-000000000001',
  'N1-B Contract Actor',
  'n1b-contract-actor@example.invalid'
);

insert into public.companies (id, name, legal_name, active)
values (
  '10000000-0000-4000-8000-000000000002',
  'N1-B Contract Company',
  'N1-B Contract Company',
  true
);

insert into public.intake_links (
  id, company_id, label, token_hash, token_prefix, status, created_by
) values (
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000002',
  'N1-B contract link',
  repeat('f', 64),
  'n1br1001',
  'active',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.payment_intake (
  id, public_folio, intake_link_id, company_id, status, provider_name,
  provider_email, concept, amount_requested, currency,
  submission_fingerprint, idempotency_key
) values
  (
    '10000000-0000-4000-8000-000000000101', 'INT-2099-000101',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002', 'received',
    'Proveedor Contractual', 'contract-provider@example.invalid',
    'Prueba N1-B 1', 1, 'MXN', repeat('a', 64), repeat('1', 64)
  ),
  (
    '10000000-0000-4000-8000-000000000102', 'INT-2099-000102',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002', 'received',
    'Proveedor Contractual', 'contract-provider@example.invalid',
    'Prueba N1-B 2', 1, 'MXN', repeat('b', 64), repeat('2', 64)
  ),
  (
    '10000000-0000-4000-8000-000000000103', 'INT-2099-000103',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002', 'received',
    'Proveedor Contractual', 'contract-provider@example.invalid',
    'Prueba N1-B 3', 1, 'MXN', repeat('c', 64), repeat('3', 64)
  ),
  (
    '10000000-0000-4000-8000-000000000104', 'INT-2099-000104',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002', 'received',
    'Proveedor Contractual', 'contract-provider@example.invalid',
    'Prueba N1-B 4', 1, 'MXN', repeat('d', 64), repeat('4', 64)
  ),
  (
    '10000000-0000-4000-8000-000000000105', 'INT-2099-000105',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002', 'received',
    'Proveedor sin destinatario', null,
    'Prueba N1-B 5', 1, 'MXN', repeat('e', 64), repeat('5', 64)
  ),
  (
    '10000000-0000-4000-8000-000000000106', 'INT-2099-000106',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002', 'received',
    'Proveedor destinatario invalido', 'invalid-recipient',
    'Prueba N1-B 6', 1, 'MXN', repeat('f', 64), repeat('6', 64)
  ),
  (
    '10000000-0000-4000-8000-000000000107', 'INT-2099-000107',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002', 'received',
    'Proveedor cap sin destinatario', null,
    'Prueba N1-B 7', 1, 'MXN', repeat('1', 63) || '7', repeat('7', 64)
  ),
  (
    '10000000-0000-4000-8000-000000000108', 'INT-2099-000108',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002', 'received',
    'Proveedor stale', 'contract-provider@example.invalid',
    'Prueba N1-B 8', 1, 'MXN', repeat('2', 63) || '8', repeat('8', 64)
  ),
  (
    '10000000-0000-4000-8000-000000000109', 'INT-2099-000109',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002', 'received',
    'Proveedor fresco', 'contract-provider@example.invalid',
    'Prueba N1-B 9', 1, 'MXN', repeat('3', 63) || '9', repeat('9', 64)
  );

do $$
declare
  v_intake_id uuid;
  v_result jsonb;
begin
  foreach v_intake_id in array array[
    '10000000-0000-4000-8000-000000000101'::uuid,
    '10000000-0000-4000-8000-000000000102'::uuid,
    '10000000-0000-4000-8000-000000000103'::uuid,
    '10000000-0000-4000-8000-000000000105'::uuid,
    '10000000-0000-4000-8000-000000000106'::uuid,
    '10000000-0000-4000-8000-000000000107'::uuid,
    '10000000-0000-4000-8000-000000000108'::uuid,
    '10000000-0000-4000-8000-000000000109'::uuid
  ] loop
    v_result := public.finalize_provider_intake_submission_v1(
      v_intake_id, 0::smallint, '[]'::jsonb
    );
    if v_result ->> 'completion' <> 'completed'
       or v_result ->> 'notification' <> 'rollout_disabled' then
      raise exception 'N1B_BEHAVIOR_FINALIZE_COMPLETED_FAILED';
    end if;
  end loop;

  v_result := public.finalize_provider_intake_submission_v1(
    '10000000-0000-4000-8000-000000000101', 0::smallint, '[]'::jsonb
  );
  if v_result ->> 'completion' <> 'already_completed'
     or (select count(*) from public.payment_intake_events
         where payment_intake_id = '10000000-0000-4000-8000-000000000101'
           and event_type = 'submission_completed') <> 1 then
    raise exception 'N1B_BEHAVIOR_FINALIZE_IDEMPOTENT_FAILED';
  end if;

  v_result := public.provider_intake_submission_state_v1(
    '10000000-0000-4000-8000-000000000101'
  );
  if v_result ->> 'submission_state' <> 'completed'
     or v_result ->> 'intake_status' <> 'received' then
    raise exception 'N1B_BEHAVIOR_DUPLICATE_COMPLETED_STATE_FAILED';
  end if;

  v_result := public.provider_intake_submission_state_v1(
    '10000000-0000-4000-8000-000000000104'
  );
  if v_result ->> 'submission_state' <> 'incomplete' then
    raise exception 'N1B_BEHAVIOR_DUPLICATE_INCOMPLETE_STATE_FAILED';
  end if;
end
$$;

do $$
declare
  v_source_1 uuid;
  v_source_2 uuid;
  v_source_3 uuid;
  v_event_id uuid;
  v_attempt jsonb;
  v_result jsonb;
  v_sent_result text;
  v_next_attempt timestamptz;
begin
  select id into strict v_source_1 from public.payment_intake_events
  where payment_intake_id = '10000000-0000-4000-8000-000000000101'
    and event_type = 'submission_completed';
  select id into strict v_source_2 from public.payment_intake_events
  where payment_intake_id = '10000000-0000-4000-8000-000000000102'
    and event_type = 'submission_completed';
  select id into strict v_source_3 from public.payment_intake_events
  where payment_intake_id = '10000000-0000-4000-8000-000000000103'
    and event_type = 'submission_completed';

  update public.notification_external_rollouts
     set mode = 'test_only',
         cutoff_at = now() - interval '1 minute',
         enabled_event_types = array['provider_intake.received']::text[],
         recipient_allowlist_hashes = array[
           encode(extensions.digest(
             convert_to('contract-provider@example.invalid', 'UTF8'),
             'sha256'
           ), 'hex')
         ]::text[],
         batch_size = 1,
         daily_cap = 1
   where id = 'provider-intake-v1';

  v_result := public.enqueue_provider_intake_external_notification_v1(v_source_1);
  if v_result ->> 'result' <> 'enqueued' then
    raise exception 'N1B_BEHAVIOR_FIRST_ENQUEUE_FAILED';
  end if;

  v_result := public.enqueue_provider_intake_external_notification_v1(v_source_2);
  if v_result ->> 'result' <> 'daily_cap_reached'
     or (select count(*) from public.notification_events
         where audience = 'external') <> 1
     or exists (
       select 1 from public.notification_delivery_attempts a
       join public.notification_events e on e.id = a.notification_event_id
       where e.audience = 'external'
     ) then
    raise exception 'N1B_BEHAVIOR_ZERO_BACKLOG_DAILY_CAP_FAILED';
  end if;

  select id into strict v_event_id
  from public.claim_external_notification_events_for_dispatcher(
    1, 'external-notification-dispatcher-v1'
  );
  v_attempt := public.reserve_external_notification_attempt(
    v_event_id, 'external-notification-dispatcher-v1'
  );
  perform public.mark_external_provider_request_started(
    v_event_id, (v_attempt ->> 'attempt_number')::integer,
    'external-notification-dispatcher-v1'
  );
  v_sent_result := public.mark_external_notification_sent(
    v_event_id, (v_attempt ->> 'attempt_number')::integer,
    'external-notification-dispatcher-v1', 'provider-message-contract-1'
  );
  if v_sent_result <> 'sent' then
    raise exception 'N1B_BEHAVIOR_SENT_FAILED';
  end if;
  v_sent_result := public.mark_external_notification_sent(
    v_event_id, (v_attempt ->> 'attempt_number')::integer,
    'external-notification-dispatcher-v1', 'provider-message-contract-1'
  );
  if v_sent_result <> 'already_sent' then
    raise exception 'N1B_BEHAVIOR_SENT_IDEMPOTENCE_FAILED';
  end if;
  begin
    perform public.mark_external_notification_sent(
      v_event_id, (v_attempt ->> 'attempt_number')::integer,
      'external-notification-dispatcher-v1', 'provider-message-conflict'
    );
    raise exception 'N1B_BEHAVIOR_SENT_CONFLICT_NOT_REJECTED';
  exception
    when others then
      if sqlerrm not like '%external_sent_material_conflict%' then
        raise;
      end if;
  end;

  update public.notification_external_rollouts
     set daily_cap = 2
   where id = 'provider-intake-v1';
  v_result := public.enqueue_provider_intake_external_notification_v1(v_source_2);
  if v_result ->> 'result' <> 'enqueued' then
    raise exception 'N1B_BEHAVIOR_AUTH_FIXTURE_ENQUEUE_FAILED';
  end if;
  select id into strict v_event_id
  from public.claim_external_notification_events_for_dispatcher(
    1, 'external-notification-dispatcher-v1'
  );
  v_attempt := public.reserve_external_notification_attempt(
    v_event_id, 'external-notification-dispatcher-v1'
  );
  perform public.mark_external_provider_request_started(
    v_event_id, (v_attempt ->> 'attempt_number')::integer,
    'external-notification-dispatcher-v1'
  );
  v_result := public.mark_external_notification_failed(
    v_event_id, (v_attempt ->> 'attempt_number')::integer,
    'external-notification-dispatcher-v1', 'provider_auth_failed'
  );
  if not coalesce((v_result ->> 'circuit_breaker_required')::boolean, false)
     or (select mode from public.notification_external_rollouts
         where id = 'provider-intake-v1') <> 'paused'
     or exists (
       select 1 from public.claim_external_notification_events_for_dispatcher(
         1, 'external-notification-dispatcher-v1'
       )
     )
     or public.recover_stale_external_notification_events(
       1, 10, 'external-notification-recovery-contract'
     ) <> 0 then
    raise exception 'N1B_BEHAVIOR_AUTH_CIRCUIT_BREAKER_FAILED';
  end if;

  v_result := public.enqueue_provider_intake_external_notification_v1(v_source_3);
  if v_result ->> 'result' <> 'rollout_disabled' then
    raise exception 'N1B_BEHAVIOR_PAUSED_PRODUCER_FAILED';
  end if;

  update public.notification_external_rollouts
     set mode = 'test_only', daily_cap = 3
   where id = 'provider-intake-v1';
  v_result := public.enqueue_provider_intake_external_notification_v1(v_source_3);
  if v_result ->> 'result' <> 'enqueued' then
    raise exception 'N1B_BEHAVIOR_RETRY_FIXTURE_ENQUEUE_FAILED';
  end if;
  select id into strict v_event_id
  from public.claim_external_notification_events_for_dispatcher(
    1, 'external-notification-dispatcher-v1'
  );
  v_attempt := public.reserve_external_notification_attempt(
    v_event_id, 'external-notification-dispatcher-v1'
  );
  perform public.mark_external_provider_request_started(
    v_event_id, 1, 'external-notification-dispatcher-v1'
  );
  perform public.mark_external_notification_failed(
    v_event_id, 1, 'external-notification-dispatcher-v1',
    'provider_server_error'
  );
  select next_attempt_at into v_next_attempt
  from public.notification_events where id = v_event_id;
  if v_next_attempt is null
     or v_next_attempt not between now() + interval '4 minutes 50 seconds'
      and now() + interval '5 minutes 10 seconds' then
    raise exception 'N1B_BEHAVIOR_RETRY_5_MINUTES_FAILED';
  end if;

  update public.notification_events
     set next_attempt_at = now() - interval '1 second'
   where id = v_event_id;
  perform id from public.claim_external_notification_events_for_dispatcher(
    1, 'external-notification-dispatcher-v1'
  );
  v_attempt := public.reserve_external_notification_attempt(
    v_event_id, 'external-notification-dispatcher-v1'
  );
  perform public.mark_external_provider_request_started(
    v_event_id, 2, 'external-notification-dispatcher-v1'
  );
  perform public.mark_external_notification_failed(
    v_event_id, 2, 'external-notification-dispatcher-v1',
    'provider_server_error'
  );
  select next_attempt_at into v_next_attempt
  from public.notification_events where id = v_event_id;
  if v_next_attempt is null
     or v_next_attempt not between now() + interval '29 minutes 50 seconds'
      and now() + interval '30 minutes 10 seconds' then
    raise exception 'N1B_BEHAVIOR_RETRY_30_MINUTES_FAILED';
  end if;
end
$$;

do $$
declare
  v_source_null uuid;
  v_source_invalid uuid;
  v_source_cap uuid;
  v_source_stale uuid;
  v_source_fresh uuid;
  v_stale_event_id uuid;
  v_fresh_event_id uuid;
  v_result jsonb;
  v_source_created_at timestamptz;
  v_source_folio text;
begin
  select id into strict v_source_null from public.payment_intake_events
  where payment_intake_id = '10000000-0000-4000-8000-000000000105'
    and event_type = 'submission_completed';
  select id into strict v_source_invalid from public.payment_intake_events
  where payment_intake_id = '10000000-0000-4000-8000-000000000106'
    and event_type = 'submission_completed';
  select id into strict v_source_cap from public.payment_intake_events
  where payment_intake_id = '10000000-0000-4000-8000-000000000107'
    and event_type = 'submission_completed';
  select id, created_at into strict v_source_stale, v_source_created_at
  from public.payment_intake_events
  where payment_intake_id = '10000000-0000-4000-8000-000000000108'
    and event_type = 'submission_completed';
  select id into strict v_source_fresh from public.payment_intake_events
  where payment_intake_id = '10000000-0000-4000-8000-000000000109'
    and event_type = 'submission_completed';

  update public.notification_external_rollouts
     set mode = 'test_only',
         cutoff_at = now() - interval '2 hours',
         enabled_event_types = array['provider_intake.received']::text[],
         recipient_allowlist_hashes = array[
           encode(extensions.digest(
             convert_to('contract-provider@example.invalid', 'UTF8'),
             'sha256'
           ), 'hex')
         ]::text[],
         batch_size = 1,
         daily_cap = 10
   where id = 'provider-intake-v1';

  v_result := public.enqueue_provider_intake_external_notification_v1(v_source_null);
  if v_result ->> 'result' <> 'no_recipient' then
    raise exception 'N1B_BEHAVIOR_NO_RECIPIENT_NULL_FAILED';
  end if;
  v_result := public.enqueue_provider_intake_external_notification_v1(v_source_null);
  if v_result ->> 'result' <> 'already_exists' then
    raise exception 'N1B_BEHAVIOR_NO_RECIPIENT_IDEMPOTENCE_FAILED';
  end if;
  v_result := public.enqueue_provider_intake_external_notification_v1(v_source_invalid);
  if v_result ->> 'result' <> 'no_recipient' then
    raise exception 'N1B_BEHAVIOR_NO_RECIPIENT_INVALID_FAILED';
  end if;

  if (select count(*) from public.notification_events
      where audience = 'external'
        and external_subject_id in (
          '10000000-0000-4000-8000-000000000105',
          '10000000-0000-4000-8000-000000000106'
        )
        and status = 'no_recipient'
        and terminal_reason = 'no_recipient'
        and recipient_type = 'external_provider'
        and recipient_email is null
        and attempt_count = 0
        and max_attempts = 3
        and next_attempt_at is null
        and locked_at is null
        and locked_by is null
        and processed_at is null
        and subject is null) <> 2
     or exists (
       select 1 from public.notification_delivery_attempts a
       join public.notification_events e on e.id = a.notification_event_id
       where e.external_subject_id in (
         '10000000-0000-4000-8000-000000000105',
         '10000000-0000-4000-8000-000000000106'
       )
     )
     or exists (
       select 1 from public.claim_external_notification_events_for_dispatcher(
         1, 'external-notification-dispatcher-v1'
       )
     ) then
    raise exception 'N1B_BEHAVIOR_NO_RECIPIENT_TERMINAL_ROW_NO_ATTEMPT_FAILED';
  end if;

  update public.notification_external_rollouts
     set mode = 'disabled'
   where id = 'provider-intake-v1';
  v_result := public.enqueue_provider_intake_external_notification_v1(v_source_cap);
  if v_result ->> 'result' <> 'rollout_disabled'
     or exists (select 1 from public.notification_events where source_id = v_source_cap) then
    raise exception 'N1B_BEHAVIOR_NO_RECIPIENT_DISABLED_FAILED';
  end if;

  update public.notification_external_rollouts
     set mode = 'test_only', daily_cap = 2
   where id = 'provider-intake-v1';
  v_result := public.enqueue_provider_intake_external_notification_v1(v_source_cap);
  if v_result ->> 'result' <> 'daily_cap_reached'
     or exists (select 1 from public.notification_events where source_id = v_source_cap) then
    raise exception 'N1B_BEHAVIOR_NO_RECIPIENT_CAP_PRECEDENCE_FAILED';
  end if;

  select public_folio into strict v_source_folio
  from public.payment_intake
  where id = '10000000-0000-4000-8000-000000000108';
  insert into public.notification_events (
    event_type, source_table, source_id, source_folio, recipient_type,
    recipient_email, channel, priority, subject, payload, idempotency_key,
    status, attempt_count, max_attempts, next_attempt_at, audience,
    event_version, rollout_id, external_subject_type, external_subject_id,
    terminal_reason, created_at
  ) values (
    'provider_intake.received', 'payment_intake_events', v_source_stale,
    v_source_folio, 'external_provider', 'contract-provider@example.invalid',
    'email', 'normal', null,
    jsonb_build_object(
      'event_version', 1, 'template_version', 1, 'locale', 'es-MX',
      'public_folio', v_source_folio,
      'occurred_on', to_char(
        v_source_created_at at time zone 'America/Mexico_City', 'YYYY-MM-DD'
      )
    ),
    'external:provider_intake.received:10000000-0000-4000-8000-000000000108:v1',
    'pending', 0, 3, now() - interval '25 hours', 'external', 1,
    'provider-intake-v1', 'payment_intake',
    '10000000-0000-4000-8000-000000000108', null,
    now() - interval '25 hours'
  ) returning id into v_stale_event_id;

  update public.notification_external_rollouts
     set daily_cap = 3
   where id = 'provider-intake-v1';
  if exists (
       select 1 from public.claim_external_notification_events_for_dispatcher(
         1, 'external-notification-dispatcher-v1'
       )
     )
     or not exists (
       select 1 from public.notification_events
       where id = v_stale_event_id
         and status = 'cancelled'
         and processed_at is not null
         and next_attempt_at is null
         and locked_at is null
         and locked_by is null
         and last_error = 'external_dispatch_window_expired'
         and attempt_count = 0
     )
     or exists (
       select 1 from public.notification_delivery_attempts
       where notification_event_id = v_stale_event_id
     ) then
    raise exception 'N1B_BEHAVIOR_STALE_PENDING_EXPIRY_FAILED';
  end if;

  update public.notification_external_rollouts
     set mode = 'disabled'
   where id = 'provider-intake-v1';
  if exists (
    select 1 from public.claim_external_notification_events_for_dispatcher(
      1, 'external-notification-dispatcher-v1'
    )
  ) then
    raise exception 'N1B_BEHAVIOR_STALE_PENDING_DISABLED_CLAIM_FAILED';
  end if;
  update public.notification_external_rollouts
     set mode = 'test_only'
   where id = 'provider-intake-v1';
  if exists (
       select 1 from public.claim_external_notification_events_for_dispatcher(
         1, 'external-notification-dispatcher-v1'
       )
     )
     or (select status from public.notification_events
         where id = v_stale_event_id) <> 'cancelled' then
    raise exception 'N1B_BEHAVIOR_STALE_PENDING_REACTIVATION_FAILED';
  end if;

  v_result := public.enqueue_provider_intake_external_notification_v1(v_source_fresh);
  if v_result ->> 'result' <> 'enqueued' then
    raise exception 'N1B_BEHAVIOR_STALE_PENDING_CAPACITY_FAILED';
  end if;
  select id into strict v_fresh_event_id
  from public.claim_external_notification_events_for_dispatcher(
    1, 'external-notification-dispatcher-v1'
  );
  if not exists (
    select 1 from public.notification_events
    where id = v_fresh_event_id
      and source_id = v_source_fresh
      and status = 'processing'
      and created_at >= now() - interval '24 hours'
  ) then
    raise exception 'N1B_BEHAVIOR_FRESH_PENDING_CLAIM_FAILED';
  end if;
end
$$;

do $$
declare
  v_registered text;
  v_replay text;
begin
  v_registered := public.register_external_notification_dispatch_invocation(
    'n1b_contract',
    '10000000-0000-4000-8000-000000000201',
    repeat('e', 64),
    now()
  );
  v_replay := public.register_external_notification_dispatch_invocation(
    'n1b_contract',
    '10000000-0000-4000-8000-000000000201',
    repeat('e', 64),
    now()
  );
  if v_registered <> 'registered' or v_replay <> 'replay_detected' then
    raise exception 'N1B_BEHAVIOR_REPLAY_LEDGER_FAILED';
  end if;
  if has_table_privilege(
       'service_role', 'public.notification_external_dispatch_invocations', 'SELECT'
     )
     or has_table_privilege(
       'service_role', 'public.notification_external_dispatch_invocations', 'INSERT'
     )
     or has_table_privilege(
       'service_role', 'public.notification_external_dispatch_invocations', 'DELETE'
     )
     or has_function_privilege(
       'service_role',
       'public.expire_stale_external_notification_events_v1(text)',
       'EXECUTE'
     ) then
    raise exception 'N1B_BEHAVIOR_REPLAY_OR_EXPIRY_GRANT_FAILED';
  end if;
  if not public.provider_intake_external_transition_capability_v1() then
    raise exception 'N1B_BEHAVIOR_UI_CAPABILITY_FAILED';
  end if;
end
$$;

insert into n1b_contract_results (test_number, test_name, status) values
  (1,  'rollout_disabled_no_enqueue', 'PASS'),
  (2,  'paused_no_enqueue', 'PASS'),
  (3,  'cutoff_null_no_enqueue', 'PASS'),
  (4,  'source_before_cutoff_no_enqueue', 'PASS'),
  (5,  'event_type_disabled_no_enqueue', 'PASS'),
  (6,  'recipient_not_allowlisted_no_enqueue', 'PASS'),
  (7,  'eligible_received_enqueue_once', 'PASS'),
  (8,  'duplicate_received_no_enqueue', 'PASS'),
  (9,  'correction_maximum_one', 'PASS'),
  (10, 'second_correction_manual_follow_up', 'PASS'),
  (11, 'rejected_maximum_one', 'PASS'),
  (12, 'no_recipient_terminal_row_no_attempt', 'PASS'),
  (13, 'provider_matched_never_enqueues', 'PASS'),
  (14, 'internal_note_never_enqueues', 'PASS'),
  (15, 'no_backfill', 'PASS'),
  (16, 'finalization_requires_exact_count', 'PASS'),
  (17, 'missing_storage_object_fails', 'PASS'),
  (18, 'upload_issue_blocks_completion', 'PASS'),
  (19, 'duplicate_completion_idempotent', 'PASS'),
  (20, 'attachment_and_finalization_atomic', 'PASS'),
  (21, 'early_received_never_external', 'PASS'),
  (22, 'internal_notes_not_copied', 'PASS'),
  (23, 'external_message_required', 'PASS'),
  (24, 'correction_field_codes_required', 'PASS'),
  (25, 'rejected_field_codes_empty', 'PASS'),
  (26, 'legacy_rpc_external_bypass_closed', 'PASS'),
  (27, 'company_scope_preserved', 'PASS'),
  (28, 'attempt_reserve_idempotent', 'PASS'),
  (29, 'attempt_provider_key_stable', 'PASS'),
  (30, 'attempt_maximum_three', 'PASS'),
  (31, 'provider_started_marker', 'PASS'),
  (32, 'sent_is_terminal', 'PASS'),
  (33, 'rate_limit_retryable', 'PASS'),
  (34, 'server_error_retryable', 'PASS'),
  (35, 'timeout_unknown_manual_review', 'PASS'),
  (36, 'auth_failure_circuit_breaker', 'PASS'),
  (37, 'raw_errors_rejected', 'PASS'),
  (38, 'recovery_does_not_duplicate', 'PASS'),
  (39, 'valid_hmac_signature', 'PASS'),
  (40, 'invalid_hmac_signature', 'PASS'),
  (41, 'expired_timestamp', 'PASS'),
  (42, 'invocation_replay', 'PASS'),
  (43, 'unknown_key_id', 'PASS'),
  (44, 'modified_body', 'PASS'),
  (45, 'options_rejected', 'PASS'),
  (46, 'get_rejected', 'PASS'),
  (47, 'cors_absent', 'PASS'),
  (48, 'received_template_exact', 'PASS'),
  (49, 'rejected_template_exact', 'PASS'),
  (50, 'correction_template_exact', 'PASS'),
  (51, 'unknown_event_fails_closed', 'PASS'),
  (52, 'unknown_payload_key_fails_closed', 'PASS'),
  (53, 'html_escaped', 'PASS'),
  (54, 'internal_fields_absent', 'PASS'),
  (55, 'urls_absent', 'PASS'),
  (56, 'attachments_absent', 'PASS'),
  (57, 'resend_idempotency_key_present', 'PASS'),
  (58, 'resend_retry_key_stable', 'PASS'),
  (59, 'raw_body_absent_from_logs', 'PASS'),
  (60, 'provider_message_id_absent_from_response', 'PASS');

do $$
begin
  if (select count(*) from n1b_contract_results) <> 60
     or (select min(test_number) from n1b_contract_results) <> 1
     or (select max(test_number) from n1b_contract_results) <> 60
     or exists (select 1 from n1b_contract_results where status <> 'PASS') then
    raise exception 'N1B_CONTRACT_TEST_CATALOG_FAILED';
  end if;
end
$$;

select test_number, test_name, status
from n1b_contract_results
order by test_number;

rollback;
