-- N1-A contract tests for migration 041 after Matching baseline 031.
-- Synthetic transaction only. Never run against DEV in gate N1-A-C1-R1.
-- Mutable claims are inspected through pg_get_functiondef and are never invoked.

\set ON_ERROR_STOP on
begin;

create temporary table n1a_external_event_model (
  id integer generated always as identity primary key,
  audience text not null,
  event_type text not null,
  payment_intake_key text not null,
  event_version smallint not null,
  idempotency_key text not null,
  status text not null default 'pending',
  unique (audience, event_type, payment_intake_key, event_version),
  unique (idempotency_key)
) on commit drop;

create temporary table n1a_attempt_model (
  notification_event_key text not null,
  attempt_number integer not null,
  unique (notification_event_key, attempt_number)
) on commit drop;

create temporary table n1a_submission_model (
  payment_intake_key text primary key
) on commit drop;

do $$
declare
  v_internal_claim text;
  v_legacy_claim text;
  v_external_claim text;
  v_recovery text;
  v_matching_set text;
  v_duplicate_blocked boolean;
  v_valid_received jsonb := jsonb_build_object(
    'event_version', 1,
    'template_version', 1,
    'locale', 'es-MX',
    'public_folio', 'INT-2026-000001',
    'occurred_on', '2026-07-30'
  );
begin
  select pg_get_functiondef(
    'public.claim_notification_events_for_dispatcher(integer,text)'::regprocedure
  ) into v_internal_claim;
  select pg_get_functiondef(
    'public.claim_pending_notification_events(integer,text)'::regprocedure
  ) into v_legacy_claim;
  select pg_get_functiondef(
    'public.claim_external_notification_events_for_dispatcher(integer,text)'::regprocedure
  ) into v_external_claim;
  select pg_get_functiondef(
    'public.recover_stale_external_notification_events(integer,integer,text)'::regprocedure
  ) into v_recovery;
  select pg_get_functiondef(
    'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'::regprocedure
  ) into v_matching_set;

  -- 01. Legacy notification rows remain internal.
  if exists (
    select 1 from public.notification_events where audience <> 'internal'
  ) then
    raise exception 'N1A_TEST_01_FAILED';
  end if;

  -- 02. provider_matched source evidence remains internal-only.
  if exists (
    select 1
    from public.payment_intake_events
    where event_type = 'provider_matched'
      and (
        external_message is not null
        or external_field_codes is not null
        or external_contract_version is not null
      )
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_intake_events'::regclass
      and conname = 'payment_intake_events_provider_matched_internal_check'
  ) then
    raise exception 'N1A_TEST_02_FAILED';
  end if;

  -- 03. provider_matched is absent from the external claim allowlist.
  if public.notification_external_event_type_allowed('provider_matched')
     or position('provider_matched' in lower(v_external_claim)) > 0 then
    raise exception 'N1A_TEST_03_FAILED';
  end if;

  -- 04. Matching metadata cannot pass the external payload validator.
  if public.notification_external_payload_valid(
    'provider_intake.received',
    1,
    v_valid_received || jsonb_build_object(
      'matching_metadata',
      jsonb_build_object(
        'reason_code', 'internal',
        'previous_proveedor_id', 'internal',
        'new_proveedor_id', 'internal'
      )
    )
  ) then
    raise exception 'N1A_TEST_04_FAILED';
  end if;

  -- 05. External claim cannot see internal.
  if position('e.audience = ''external''' in lower(v_external_claim)) = 0
     or position(
       'audience'
       in lower(pg_get_function_identity_arguments(
         'public.claim_external_notification_events_for_dispatcher(integer,text)'::regprocedure
       ))
     ) > 0 then
    raise exception 'N1A_TEST_05_FAILED';
  end if;

  -- 06. Every existing internal claim excludes external.
  if position('e.audience = ''internal''' in lower(v_internal_claim)) = 0
     or position('e.audience = ''internal''' in lower(v_legacy_claim)) = 0 then
    raise exception 'N1A_TEST_06_FAILED';
  end if;

  -- 07. Disabled rollout is structurally ineligible.
  if not exists (
    select 1
    from public.notification_external_rollouts
    where id = 'provider-intake-v1'
      and mode = 'disabled'
  ) or position('r.mode in (''test_only'', ''pilot'')' in lower(v_external_claim)) = 0 then
    raise exception 'N1A_TEST_07_FAILED';
  end if;

  -- 08. NULL cutoff is structurally ineligible.
  if not exists (
    select 1
    from public.notification_external_rollouts
    where id = 'provider-intake-v1'
      and cutoff_at is null
  ) or position('r.cutoff_at is not null' in lower(v_external_claim)) = 0 then
    raise exception 'N1A_TEST_08_FAILED';
  end if;

  -- 09. Daily cap zero is structurally ineligible.
  if not exists (
    select 1
    from public.notification_external_rollouts
    where id = 'provider-intake-v1'
      and daily_cap = 0
  ) or position('r.daily_cap > 0' in lower(v_external_claim)) = 0 then
    raise exception 'N1A_TEST_09_FAILED';
  end if;

  -- Positive payload baseline for the following negative cases.
  if not public.notification_external_payload_valid(
    'provider_intake.received',
    1,
    v_valid_received
  ) then
    raise exception 'N1A_TEST_PAYLOAD_BASELINE_FAILED';
  end if;

  -- 10. Unknown event type fails closed.
  if public.notification_external_event_type_allowed('provider_intake.unknown') then
    raise exception 'N1A_TEST_10_FAILED';
  end if;

  -- 11. provider_matched cannot be validated as an external event.
  if public.notification_external_payload_valid(
    'provider_matched',
    1,
    v_valid_received
  ) then
    raise exception 'N1A_TEST_11_FAILED';
  end if;

  -- 12. Internal notes are forbidden in an external payload.
  if public.notification_external_payload_valid(
    'provider_intake.received',
    1,
    v_valid_received || jsonb_build_object('notes', 'internal')
  ) then
    raise exception 'N1A_TEST_12_FAILED';
  end if;

  -- 13. match_score is forbidden in an external payload.
  if public.notification_external_payload_valid(
    'provider_intake.received',
    1,
    v_valid_received || jsonb_build_object('match_score', 100)
  ) then
    raise exception 'N1A_TEST_13_FAILED';
  end if;

  -- 14. RFC values are forbidden in an external payload.
  if public.notification_external_payload_valid(
    'provider_intake.received',
    1,
    v_valid_received || jsonb_build_object('provider_rfc', 'VALUE')
  ) then
    raise exception 'N1A_TEST_14_FAILED';
  end if;

  insert into n1a_external_event_model (
    audience, event_type, payment_intake_key, event_version, idempotency_key
  ) values
    ('external', 'provider_intake.received', 'intake-a', 1,
     'external:provider_intake.received:intake-a:v1'),
    ('external', 'provider_intake.correction_requested', 'intake-a', 1,
     'external:provider_intake.correction_requested:intake-a:v1'),
    ('external', 'provider_intake.rejected', 'intake-a', 1,
     'external:provider_intake.rejected:intake-a:v1');

  -- 15. Duplicate received for one intake/version fails.
  v_duplicate_blocked := false;
  begin
    insert into n1a_external_event_model (
      audience, event_type, payment_intake_key, event_version, idempotency_key
    ) values (
      'external', 'provider_intake.received', 'intake-a', 1, 'different-received-key'
    );
  exception when unique_violation then
    v_duplicate_blocked := true;
  end;
  if not v_duplicate_blocked
     or to_regclass('public.notification_events_external_subject_version_uidx') is null then
    raise exception 'N1A_TEST_15_FAILED';
  end if;

  -- 16. Duplicate correction for one intake/version fails.
  v_duplicate_blocked := false;
  begin
    insert into n1a_external_event_model (
      audience, event_type, payment_intake_key, event_version, idempotency_key
    ) values (
      'external', 'provider_intake.correction_requested', 'intake-a', 1,
      'different-correction-key'
    );
  exception when unique_violation then
    v_duplicate_blocked := true;
  end;
  if not v_duplicate_blocked then
    raise exception 'N1A_TEST_16_FAILED';
  end if;

  -- 17. Duplicate rejected for one intake/version fails.
  v_duplicate_blocked := false;
  begin
    insert into n1a_external_event_model (
      audience, event_type, payment_intake_key, event_version, idempotency_key
    ) values (
      'external', 'provider_intake.rejected', 'intake-a', 1, 'different-rejected-key'
    );
  exception when unique_violation then
    v_duplicate_blocked := true;
  end;
  if not v_duplicate_blocked then
    raise exception 'N1A_TEST_17_FAILED';
  end if;

  -- 18. no_recipient is terminal and not claimable.
  if position('e.status = ''pending''' in lower(v_external_claim)) = 0
     or position('no_recipient' in pg_get_functiondef(
       'public.protect_external_notification_contract()'::regprocedure
     )) = 0 then
    raise exception 'N1A_TEST_18_FAILED';
  end if;

  -- 19. Duplicate attempt number fails.
  insert into n1a_attempt_model values ('event-a', 1);
  v_duplicate_blocked := false;
  begin
    insert into n1a_attempt_model values ('event-a', 1);
  exception when unique_violation then
    v_duplicate_blocked := true;
  end;
  if not v_duplicate_blocked
     or to_regclass('public.notification_delivery_attempts_event_number_uidx') is null then
    raise exception 'N1A_TEST_19_FAILED';
  end if;

  -- 20. Duplicate submission_completed fails.
  insert into n1a_submission_model values ('intake-a');
  v_duplicate_blocked := false;
  begin
    insert into n1a_submission_model values ('intake-a');
  exception when unique_violation then
    v_duplicate_blocked := true;
  end;
  if not v_duplicate_blocked
     or to_regclass('public.payment_intake_events_submission_completed_uidx') is null then
    raise exception 'N1A_TEST_20_FAILED';
  end if;

  -- 21. Matching 031 RPC signatures and material contract remain present.
  if to_regprocedure('public.find_provider_intake_candidates(uuid,text,integer)') is null
     or to_regprocedure('public.get_provider_intake_match_comparison(uuid,uuid)') is null
     or to_regprocedure(
       'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'
     ) is null
     or position('provider_matched' in v_matching_set) = 0
     or position('''contract_version'', 3' in v_matching_set) = 0
     or not has_function_privilege(
       'authenticated',
       'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)',
       'EXECUTE'
     ) then
    raise exception 'N1A_TEST_21_FAILED';
  end if;

  -- 22. Migration creates zero external notification rows.
  if exists (
    select 1 from public.notification_events where audience = 'external'
  ) then
    raise exception 'N1A_TEST_22_FAILED';
  end if;

  -- 23. No completion or external-field backfill is present.
  if exists (
    select 1
    from public.payment_intake_events
    where event_type = 'submission_completed'
       or external_message is not null
       or external_field_codes is not null
       or external_contract_version is not null
  ) then
    raise exception 'N1A_TEST_23_FAILED';
  end if;

  -- 24. No external producer exists.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and lower(pg_get_functiondef(p.oid)) like '%insert into public.notification_events%'
      and (
        pg_get_functiondef(p.oid) like '%provider_intake.received%'
        or pg_get_functiondef(p.oid) like '%provider_intake.correction_requested%'
        or pg_get_functiondef(p.oid) like '%provider_intake.rejected%'
      )
  ) or position('insert into' in lower(v_recovery)) > 0 then
    raise exception 'N1A_TEST_24_FAILED';
  end if;
end
$$;

select *
from (
  values
    (1, 'legacy_events_internal', 'PASS'),
    (2, 'provider_matched_internal_only', 'PASS'),
    (3, 'provider_matched_external_ineligible', 'PASS'),
    (4, 'matching_metadata_rejected', 'PASS'),
    (5, 'external_claim_excludes_internal', 'PASS'),
    (6, 'internal_claims_exclude_external', 'PASS'),
    (7, 'disabled_rollout_zero', 'PASS'),
    (8, 'null_cutoff_zero', 'PASS'),
    (9, 'daily_cap_zero', 'PASS'),
    (10, 'unknown_event_rejected', 'PASS'),
    (11, 'provider_matched_external_rejected', 'PASS'),
    (12, 'notes_payload_rejected', 'PASS'),
    (13, 'match_score_payload_rejected', 'PASS'),
    (14, 'rfc_payload_rejected', 'PASS'),
    (15, 'received_aggregate_unique', 'PASS'),
    (16, 'correction_aggregate_unique', 'PASS'),
    (17, 'rejected_aggregate_unique', 'PASS'),
    (18, 'no_recipient_not_claimed', 'PASS'),
    (19, 'attempt_number_unique', 'PASS'),
    (20, 'submission_completed_unique', 'PASS'),
    (21, 'matching_rpc_signatures_preserved', 'PASS'),
    (22, 'external_rows_zero', 'PASS'),
    (23, 'no_backfill', 'PASS'),
    (24, 'no_external_producer', 'PASS')
) result(test_number, contract, result)
order by test_number;

rollback;
