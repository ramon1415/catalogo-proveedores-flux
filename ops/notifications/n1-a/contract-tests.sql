-- N1-A contract tests for migration 041 after Matching baseline 031.
-- Hardened by NOTIFICATIONS-N1-A-R1.
-- Synthetic transaction only. Never run against DEV in this gate.
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

create temporary table n1a_policy_model (
  policy_name text not null,
  table_name text not null,
  permissive boolean not null,
  command text not null,
  targets_authenticated boolean not null,
  expression_mentions_audience boolean not null,
  expression_mentions_internal boolean not null
) on commit drop;

do $$
declare
  v_internal_claim text;
  v_legacy_claim text;
  v_external_claim text;
  v_recovery text;
  v_matching_set text;
  v_event_guard text;
  v_rollout_constraint text;
  v_lane_constraint text;
  v_policy_violation boolean;
  v_rollout_lock_position integer;
  v_daily_count_position integer;
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
  select pg_get_functiondef(
    'public.protect_external_notification_contract()'::regprocedure
  ) into v_event_guard;
  select pg_get_constraintdef(oid)
    into v_rollout_constraint
  from pg_constraint
  where conrelid = 'public.notification_external_rollouts'::regclass
    and conname = 'notification_external_rollouts_correction_pilot_check';
  select pg_get_constraintdef(oid)
    into v_lane_constraint
  from pg_constraint
  where conrelid = 'public.notification_events'::regclass
    and conname = 'notification_events_lane_contract_check';

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

  -- 25. correction_requested remains structurally eligible only in test_only.
  if not public.notification_external_event_mode_allowed(
    'provider_intake.correction_requested',
    'test_only'
  ) then
    raise exception 'N1A_TEST_25_FAILED';
  end if;

  -- 26. correction_requested is structurally blocked in pilot and by rollout constraint.
  if public.notification_external_event_mode_allowed(
       'provider_intake.correction_requested',
       'pilot'
     )
     or position('pilot' in lower(coalesce(v_rollout_constraint, ''))) = 0
     or position(
       'provider_intake.correction_requested'
       in lower(coalesce(v_rollout_constraint, ''))
     ) = 0 then
    raise exception 'N1A_TEST_26_FAILED';
  end if;

  -- 27. received can remain structurally eligible in pilot.
  if not public.notification_external_event_mode_allowed(
    'provider_intake.received',
    'pilot'
  ) then
    raise exception 'N1A_TEST_27_FAILED';
  end if;

  -- 28. rejected can remain structurally eligible in pilot.
  if not public.notification_external_event_mode_allowed(
    'provider_intake.rejected',
    'pilot'
  ) then
    raise exception 'N1A_TEST_28_FAILED';
  end if;

  -- 29. Initial rollout remains disabled and empty.
  if not exists (
    select 1
    from public.notification_external_rollouts
    where id = 'provider-intake-v1'
      and mode = 'disabled'
      and cutoff_at is null
      and cardinality(enabled_event_types) = 0
      and cardinality(recipient_allowlist_hashes) = 0
      and batch_size = 1
      and daily_cap = 0
  ) then
    raise exception 'N1A_TEST_29_FAILED';
  end if;

  -- 30. The exact rollout row is locked before the daily count is evaluated.
  v_rollout_lock_position := position(
    'for update of r skip locked'
    in lower(v_external_claim)
  );
  v_daily_count_position := position(
    'into v_daily_count'
    in lower(v_external_claim)
  );
  if v_rollout_lock_position = 0
     or v_daily_count_position <= v_rollout_lock_position then
    raise exception 'N1A_TEST_30_FAILED';
  end if;

  -- 31. Daily-cap claim remains batch-one and compares under the rollout lock.
  if position('v_daily_count >= v_rollout.daily_cap' in lower(v_external_claim)) = 0
     or position('least(greatest(coalesce(p_limit, 1), 1), 1)' in lower(v_external_claim)) = 0
     or position('for update of e skip locked' in lower(v_external_claim)) = 0 then
    raise exception 'N1A_TEST_31_FAILED';
  end if;

  -- 32. Every external event is constrained to exactly three attempts.
  if position('max_attempts = 3' in lower(coalesce(v_lane_constraint, ''))) = 0 then
    raise exception 'N1A_TEST_32_FAILED';
  end if;

  -- 33. External inserts start unclaimed with attempt_count zero.
  if position('new.max_attempts is distinct from 3' in lower(v_event_guard)) = 0
     or position('new.attempt_count is distinct from 0' in lower(v_event_guard)) = 0
     or position('new.locked_at is not null' in lower(v_event_guard)) = 0
     or position('new.locked_by is not null' in lower(v_event_guard)) = 0
     or position('new.processed_at is not null' in lower(v_event_guard)) = 0
     or position('new.last_attempt_at is not null' in lower(v_event_guard)) = 0 then
    raise exception 'N1A_TEST_33_FAILED';
  end if;

  -- 34. Expired processing leases without provider interaction remain structurally recoverable.
  if position('e.status = ''processing''' in lower(v_recovery)) = 0
     or position('e.locked_at <=' in lower(v_recovery)) = 0
     or position('not exists' in lower(v_recovery)) = 0 then
    raise exception 'N1A_TEST_34_FAILED';
  end if;

  -- 35. Provider request start blocks automatic recovery.
  if position('provider_request_started_at is not null' in lower(v_recovery)) = 0 then
    raise exception 'N1A_TEST_35_FAILED';
  end if;

  -- 36. Provider request completion blocks automatic recovery.
  if position('provider_request_completed_at is not null' in lower(v_recovery)) = 0 then
    raise exception 'N1A_TEST_36_FAILED';
  end if;

  -- 37. Provider message acceptance/unknown result blocks automatic recovery.
  if position('provider_message_id is not null' in lower(v_recovery)) = 0 then
    raise exception 'N1A_TEST_37_FAILED';
  end if;

  -- 38. A sent delivery attempt blocks automatic recovery.
  if position('attempt.status = ''sent''' in lower(v_recovery)) = 0 then
    raise exception 'N1A_TEST_38_FAILED';
  end if;

  -- 39. Internal events are never recoverable through the external recovery RPC.
  if position('e.audience = ''external''' in lower(v_recovery)) = 0 then
    raise exception 'N1A_TEST_39_FAILED';
  end if;

  -- 40. Ten contiguous digits are rejected.
  if public.notification_external_message_valid('Corrige 1234567890 ahora.') then
    raise exception 'N1A_TEST_40_FAILED';
  end if;

  -- 41. Sixteen contiguous digits are rejected.
  if public.notification_external_message_valid('Corrige 1234567890123456 ahora.') then
    raise exception 'N1A_TEST_41_FAILED';
  end if;

  -- 42. Eighteen contiguous digits are rejected.
  if public.notification_external_message_valid('Corrige 123456789012345678 ahora.') then
    raise exception 'N1A_TEST_42_FAILED';
  end if;

  -- 43. A spaced CLABE-equivalent sequence is rejected.
  if public.notification_external_message_valid(
    'Corrige 1234 5678 9012 3456 78 ahora.'
  ) then
    raise exception 'N1A_TEST_43_FAILED';
  end if;

  -- 44. A hyphenated CLABE-equivalent sequence is rejected.
  if public.notification_external_message_valid(
    'Corrige 1234-5678-9012-3456-78 ahora.'
  ) then
    raise exception 'N1A_TEST_44_FAILED';
  end if;

  -- 45. Persona física RFC values are rejected.
  if public.notification_external_message_valid('Corrige ABCD010101XXX ahora.') then
    raise exception 'N1A_TEST_45_FAILED';
  end if;

  -- 46. Persona moral RFC values are rejected.
  if public.notification_external_message_valid('Corrige ABC010101XX1 ahora.') then
    raise exception 'N1A_TEST_46_FAILED';
  end if;

  -- 47. Email values are rejected.
  if public.notification_external_message_valid('Escribe a persona@example.com ahora.') then
    raise exception 'N1A_TEST_47_FAILED';
  end if;

  -- 48. URL values are rejected.
  if public.notification_external_message_valid('Visita https://example.com ahora.') then
    raise exception 'N1A_TEST_48_FAILED';
  end if;

  -- 49. Matching terms are rejected.
  if public.notification_external_message_valid('Comparte el matching interno ahora.') then
    raise exception 'N1A_TEST_49_FAILED';
  end if;

  -- 50. HTML is rejected.
  if public.notification_external_message_valid('<b>Corrige este dato</b>') then
    raise exception 'N1A_TEST_50_FAILED';
  end if;

  -- 51. A safe RFC instruction without the RFC value is accepted.
  if not public.notification_external_message_valid('Corrige el RFC registrado.') then
    raise exception 'N1A_TEST_51_FAILED';
  end if;

  -- 52. A safe bank-document instruction is accepted.
  if not public.notification_external_message_valid(
    'Adjunta nuevamente el documento bancario.'
  ) then
    raise exception 'N1A_TEST_52_FAILED';
  end if;

  -- 53. A safe legal-name instruction is accepted.
  if not public.notification_external_message_valid(
    'Verifica el nombre o razón social.'
  ) then
    raise exception 'N1A_TEST_53_FAILED';
  end if;

  -- 54. The policy audit predicate detects an additional permissive policy.
  insert into n1a_policy_model values
    ('notification_events_select_self_or_admin', 'notification_events',
     true, 'SELECT', true, true, true),
    ('notification_delivery_attempts_select_self_or_admin',
     'notification_delivery_attempts', true, 'SELECT', true, true, true),
    ('unexpected_external_visibility', 'notification_events',
     true, 'SELECT', true, false, false);

  select exists (
    select 1
    from n1a_policy_model
    where permissive
      and command in ('SELECT', 'ALL')
      and targets_authenticated
      and (
        policy_name not in (
          'notification_events_select_self_or_admin',
          'notification_delivery_attempts_select_self_or_admin'
        )
        or not expression_mentions_audience
        or not expression_mentions_internal
      )
  ) into v_policy_violation;

  if not v_policy_violation then
    raise exception 'N1A_TEST_54_FAILED';
  end if;

  -- 55. Every real permissive authenticated SELECT policy is explicitly internal.
  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('notification_events', 'notification_delivery_attempts')
      and p.permissive = 'PERMISSIVE'
      and p.cmd in ('SELECT', 'ALL')
      and (
        'public'::name = any (p.roles)
        or exists (
          select 1
          from unnest(p.roles) policy_role
          where policy_role <> 'public'::name
            and pg_has_role('authenticated', policy_role::text, 'MEMBER')
        )
      )
      and (
        position('audience' in lower(coalesce(p.qual, ''))) = 0
        or position('internal' in lower(coalesce(p.qual, ''))) = 0
      )
  ) then
    raise exception 'N1A_TEST_55_FAILED';
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
    (24, 'no_external_producer', 'PASS'),
    (25, 'correction_test_only_allowed', 'PASS'),
    (26, 'correction_pilot_blocked', 'PASS'),
    (27, 'received_pilot_allowed', 'PASS'),
    (28, 'rejected_pilot_allowed', 'PASS'),
    (29, 'rollout_still_disabled', 'PASS'),
    (30, 'rollout_locked_before_daily_count', 'PASS'),
    (31, 'daily_cap_structurally_atomic', 'PASS'),
    (32, 'external_max_attempts_three', 'PASS'),
    (33, 'external_initial_attempt_state', 'PASS'),
    (34, 'recovery_without_provider_start', 'PASS'),
    (35, 'recovery_blocks_provider_start', 'PASS'),
    (36, 'recovery_blocks_provider_completion', 'PASS'),
    (37, 'recovery_blocks_provider_message_id', 'PASS'),
    (38, 'recovery_blocks_sent_attempt', 'PASS'),
    (39, 'recovery_excludes_internal', 'PASS'),
    (40, 'message_blocks_ten_digits', 'PASS'),
    (41, 'message_blocks_sixteen_digits', 'PASS'),
    (42, 'message_blocks_eighteen_digits', 'PASS'),
    (43, 'message_blocks_spaced_clabe', 'PASS'),
    (44, 'message_blocks_hyphenated_clabe', 'PASS'),
    (45, 'message_blocks_person_rfc', 'PASS'),
    (46, 'message_blocks_company_rfc', 'PASS'),
    (47, 'message_blocks_email', 'PASS'),
    (48, 'message_blocks_url', 'PASS'),
    (49, 'message_blocks_matching_term', 'PASS'),
    (50, 'message_blocks_html', 'PASS'),
    (51, 'message_allows_safe_rfc_instruction', 'PASS'),
    (52, 'message_allows_safe_bank_document_instruction', 'PASS'),
    (53, 'message_allows_safe_name_instruction', 'PASS'),
    (54, 'additional_permissive_policy_detected', 'PASS'),
    (55, 'authenticated_policies_internal_only', 'PASS')
) result(test_number, contract, result)
order by test_number;

rollback;
