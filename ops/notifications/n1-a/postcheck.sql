-- N1-A postcheck for migration 041.
-- Hardened by NOTIFICATIONS-N1-A-R1.
-- Read-only, sanitized aggregates only. Run only in the separately authorized N1-A-R2 dry-run.

\set ON_ERROR_STOP on
begin transaction isolation level repeatable read read only;

do $$
declare
  v_internal_claim text;
  v_legacy_claim text;
  v_external_claim text;
  v_recovery text;
  v_event_guard text;
  v_mode_helper text;
  v_rollout_constraint text;
  v_lane_constraint text;
  v_rollout_lock_position integer;
  v_daily_count_position integer;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_events'
      and column_name = 'audience'
      and is_nullable = 'NO'
      and column_default like '%internal%'
  ) then
    raise exception 'n1a_postcheck_audience_contract_missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_events'
      and column_name = 'event_version'
      and data_type = 'smallint'
      and is_nullable = 'NO'
      and column_default like '%1%'
  ) then
    raise exception 'n1a_postcheck_event_version_contract_missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notification_events'::regclass
      and conname = 'notification_events_rollout_id_fkey'
      and confrelid = 'public.notification_external_rollouts'::regclass
  ) then
    raise exception 'n1a_postcheck_rollout_fk_missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notification_events'::regclass
      and conname = 'notification_events_lane_contract_check'
      and pg_get_constraintdef(oid) like '%external_provider%'
      and pg_get_constraintdef(oid) like '%no_recipient%'
      and pg_get_constraintdef(oid) like '%payment_intake_events%'
      and pg_get_constraintdef(oid) like '%max_attempts%'
      and pg_get_constraintdef(oid) like '%3%'
  ) then
    raise exception 'n1a_postcheck_external_lane_contract_missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notification_events'::regclass
      and conname = 'notification_events_recipient_type_check'
      and pg_get_constraintdef(oid) like '%external_provider%'
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notification_events'::regclass
      and conname = 'notification_events_status_check'
      and pg_get_constraintdef(oid) like '%no_recipient%'
  ) then
    raise exception 'n1a_postcheck_recipient_or_status_extension_missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'notification_events_external_subject_version_uidx'
      and indexdef like '%UNIQUE INDEX%'
      and indexdef like '%external_subject_id%'
      and indexdef like '%event_version%'
      and indexdef like '%audience = ''external''%'
  ) then
    raise exception 'n1a_postcheck_external_aggregate_uniqueness_missing';
  end if;

  if to_regclass('public.notification_external_rollouts') is null then
    raise exception 'n1a_postcheck_rollout_table_missing';
  end if;

  if (select count(*) from public.notification_external_rollouts) <> 1
     or not exists (
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
    raise exception 'n1a_postcheck_rollout_not_fail_closed';
  end if;

  select pg_get_constraintdef(oid)
    into v_rollout_constraint
  from pg_constraint
  where conrelid = 'public.notification_external_rollouts'::regclass
    and conname = 'notification_external_rollouts_correction_pilot_check';

  if position('pilot' in lower(coalesce(v_rollout_constraint, ''))) = 0
     or position(
       'provider_intake.correction_requested'
       in lower(coalesce(v_rollout_constraint, ''))
     ) = 0 then
    raise exception 'n1a_postcheck_correction_pilot_rollout_gate_missing';
  end if;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.notification_external_rollouts'::regclass
      and relrowsecurity
  ) then
    raise exception 'n1a_postcheck_rollout_rls_missing';
  end if;

  if has_table_privilege('anon', 'public.notification_external_rollouts', 'SELECT')
     or has_table_privilege('authenticated', 'public.notification_external_rollouts', 'SELECT')
     or not has_table_privilege('service_role', 'public.notification_external_rollouts', 'SELECT') then
    raise exception 'n1a_postcheck_rollout_grants_invalid';
  end if;

  if exists (
    select 1 from public.notification_events where audience <> 'internal'
  ) then
    raise exception 'n1a_postcheck_legacy_lane_changed_or_external_rows_created';
  end if;

  if exists (
    select 1
    from public.notification_events
    where event_type in (
      'provider_intake.received',
      'provider_intake.correction_requested',
      'provider_intake.rejected'
    )
  ) then
    raise exception 'n1a_postcheck_external_rows_not_zero';
  end if;

  if exists (
    select 1
    from public.payment_intake_events
    where event_type = 'submission_completed'
  ) then
    raise exception 'n1a_postcheck_submission_completed_backfill_detected';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_intake_events'::regclass
      and conname = 'payment_intake_events_event_type_check'
      and pg_get_constraintdef(oid) like '%submission_completed%'
  ) or to_regclass('public.payment_intake_events_submission_completed_uidx') is null then
    raise exception 'n1a_postcheck_submission_completion_structure_missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_intake_events'::regclass
      and conname = 'payment_intake_events_event_type_check'
      and pg_get_constraintdef(oid) like '%provider_matched%'
      and pg_get_constraintdef(oid) like '%submission_completed%'
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_intake_events'::regclass
      and conname = 'payment_intake_events_provider_matched_internal_check'
  ) then
    raise exception 'n1a_postcheck_provider_matched_event_contract_missing';
  end if;

  if exists (
    select 1
    from public.payment_intake_events
    where event_type = 'provider_matched'
      and (
        external_message is not null
        or external_field_codes is not null
        or external_contract_version is not null
      )
  ) then
    raise exception 'n1a_postcheck_provider_matched_external_fields_detected';
  end if;

  if exists (
    select 1
    from public.payment_intake_events
    where external_message is not null
       or external_field_codes is not null
       or external_contract_version is not null
  ) then
    raise exception 'n1a_postcheck_legacy_external_field_backfill_detected';
  end if;

  if public.notification_external_event_type_allowed('provider_matched') then
    raise exception 'n1a_postcheck_provider_matched_external_eligibility';
  end if;

  if not public.notification_external_event_mode_allowed(
       'provider_intake.correction_requested',
       'test_only'
     )
     or public.notification_external_event_mode_allowed(
       'provider_intake.correction_requested',
       'pilot'
     )
     or not public.notification_external_event_mode_allowed(
       'provider_intake.received',
       'pilot'
     )
     or not public.notification_external_event_mode_allowed(
       'provider_intake.rejected',
       'pilot'
     ) then
    raise exception 'n1a_postcheck_correction_n2_mode_gate_invalid';
  end if;

  if public.notification_external_message_valid('Corrige 1234567890 ahora.')
     or public.notification_external_message_valid('Corrige 1234567890123456 ahora.')
     or public.notification_external_message_valid('Corrige 123456789012345678 ahora.')
     or public.notification_external_message_valid('Corrige 1234 5678 9012 3456 78 ahora.')
     or public.notification_external_message_valid('Corrige 1234-5678-9012-3456-78 ahora.')
     or public.notification_external_message_valid('Corrige ABCD010101XXX ahora.')
     or public.notification_external_message_valid('Corrige ABC010101XX1 ahora.')
     or public.notification_external_message_valid('Escribe a persona@example.com ahora.')
     or public.notification_external_message_valid('Visita https://example.com ahora.')
     or public.notification_external_message_valid('Comparte el matching interno ahora.')
     or public.notification_external_message_valid('<b>Corrige este dato</b>')
     or not public.notification_external_message_valid('Corrige el RFC registrado.')
     or not public.notification_external_message_valid('Adjunta nuevamente el documento bancario.')
     or not public.notification_external_message_valid('Verifica el nombre o razón social.') then
    raise exception 'n1a_postcheck_external_message_privacy_invalid';
  end if;

  if to_regprocedure('public.normalize_provider_match_text(text)') is null
     or to_regprocedure('public.normalize_provider_match_digits(text)') is null
     or to_regprocedure(
       'public.provider_intake_match_fingerprint(integer,text,uuid,uuid,text,timestamptz,uuid,uuid,text,text)'
     ) is null
     or to_regprocedure('public.find_provider_intake_candidates(uuid,text,integer)') is null
     or to_regprocedure('public.get_provider_intake_match_comparison(uuid,uuid)') is null
     or to_regprocedure(
       'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'
     ) is null then
    raise exception 'n1a_postcheck_matching_031_signatures_missing';
  end if;

  if position(
       'provider_matched'
       in pg_get_functiondef(
         'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'::regprocedure
       )
     ) = 0
     or position(
       '''contract_version'', 3'
       in pg_get_functiondef(
         'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'::regprocedure
       )
     ) = 0
     or position(
       'created_payment_request_id is not null'
       in lower(pg_get_functiondef(
         'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'::regprocedure
       ))
     ) = 0 then
    raise exception 'n1a_postcheck_matching_031_set_contract_changed';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'find_provider_intake_candidates',
        'get_provider_intake_match_comparison',
        'set_provider_intake_match'
      )
      and (
        not p.prosecdef
        or has_function_privilege('anon', p.oid, 'EXECUTE')
        or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception 'n1a_postcheck_matching_031_rpc_grants_changed';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'normalize_provider_match_text',
        'normalize_provider_match_digits',
        'provider_intake_match_fingerprint'
      )
      and (
        p.prosecdef
        or has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception 'n1a_postcheck_matching_031_helper_grants_changed';
  end if;

  if to_regprocedure('public.protect_payment_intake_events_immutable()') is null
     or to_regprocedure('public.protect_payment_intake_submission_completed()') is null
     or not exists (
       select 1
       from pg_trigger
       where tgrelid = 'public.payment_intake_events'::regclass
         and tgname = 'protect_payment_intake_submission_completed_trigger'
         and not tgisinternal
     ) then
    raise exception 'n1a_postcheck_submission_completion_guard_missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_intake'
      and column_name = 'expected_file_count'
      and is_nullable = 'YES'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_intake'
      and column_name = 'submission_completed_at'
      and is_nullable = 'YES'
  ) then
    raise exception 'n1a_postcheck_completion_columns_missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_intake_events'
      and column_name = 'external_message'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_intake_events'
      and column_name = 'external_field_codes'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_intake_events'
      and column_name = 'external_contract_version'
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_intake_events'::regclass
      and conname = 'payment_intake_events_external_contract_check'
  ) then
    raise exception 'n1a_postcheck_external_message_contract_missing';
  end if;

  if to_regprocedure('public.notification_external_payload_valid(text,smallint,jsonb)') is null
     or to_regprocedure('public.notification_external_field_codes_valid(text[])') is null
     or to_regprocedure('public.protect_external_notification_contract()') is null
     or position(
       'notification_audience_immutable'
       in pg_get_functiondef('public.protect_external_notification_contract()'::regprocedure)
     ) = 0
     or position(
       'no_recipient_terminal'
       in pg_get_functiondef('public.protect_external_notification_contract()'::regprocedure)
     ) = 0 then
    raise exception 'n1a_postcheck_external_validators_missing';
  end if;

  if to_regclass('public.notification_delivery_attempts_event_number_uidx') is null
     or exists (
       select 1
       from (
         select notification_event_id, attempt_number
         from public.notification_delivery_attempts
         group by notification_event_id, attempt_number
         having count(*) > 1
       ) duplicate_attempt
     ) then
    raise exception 'n1a_postcheck_attempt_uniqueness_invalid';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_delivery_attempts'
      and column_name = 'provider_idempotency_key'
      and is_nullable = 'YES'
  ) or to_regprocedure('public.protect_notification_delivery_attempt_contract()') is null then
    raise exception 'n1a_postcheck_attempt_recovery_contract_missing';
  end if;

  if exists (
    select 1
    from public.notification_delivery_attempts attempt
    join public.notification_events event on event.id = attempt.notification_event_id
    where event.status = 'no_recipient'
  ) then
    raise exception 'n1a_postcheck_no_recipient_has_attempt';
  end if;

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
    'public.protect_external_notification_contract()'::regprocedure
  ) into v_event_guard;
  select pg_get_functiondef(
    'public.notification_external_event_mode_allowed(text,text)'::regprocedure
  ) into v_mode_helper;
  select pg_get_constraintdef(oid)
    into v_lane_constraint
  from pg_constraint
  where conrelid = 'public.notification_events'::regclass
    and conname = 'notification_events_lane_contract_check';

  if position('e.audience = ''internal''' in lower(v_internal_claim)) = 0
     or position('for update skip locked' in lower(v_internal_claim)) = 0
     or position('least(greatest(coalesce(p_limit, 5), 1), 5)' in lower(v_internal_claim)) = 0 then
    raise exception 'n1a_postcheck_internal_claim_isolation_missing';
  end if;

  if position('e.audience = ''internal''' in lower(v_legacy_claim)) = 0
     or position('for update skip locked' in lower(v_legacy_claim)) = 0 then
    raise exception 'n1a_postcheck_legacy_claim_isolation_missing';
  end if;

  v_rollout_lock_position := position(
    'for update of r skip locked'
    in lower(v_external_claim)
  );
  v_daily_count_position := position(
    'into v_daily_count'
    in lower(v_external_claim)
  );

  if position('e.audience = ''external''' in lower(v_external_claim)) = 0
     or position('e.status = ''pending''' in lower(v_external_claim)) = 0
     or position('r.cutoff_at is not null' in lower(v_external_claim)) = 0
     or position('e.created_at >= r.cutoff_at' in lower(v_external_claim)) = 0
     or position('pie.created_at >= r.cutoff_at' in lower(v_external_claim)) = 0
     or position('recipient_allowlist_hashes' in lower(v_external_claim)) = 0
     or position('r.daily_cap > 0' in lower(v_external_claim)) = 0
     or position('v_daily_count >= v_rollout.daily_cap' in lower(v_external_claim)) = 0
     or position('notification_external_event_mode_allowed' in lower(v_external_claim)) = 0
     or position('least(greatest(coalesce(p_limit, 1), 1), 1)' in lower(v_external_claim)) = 0
     or position('for update of e skip locked' in lower(v_external_claim)) = 0
     or v_rollout_lock_position = 0
     or v_daily_count_position <= v_rollout_lock_position
     or position('provider_matched' in lower(v_external_claim)) > 0 then
    raise exception 'n1a_postcheck_external_claim_not_fail_closed';
  end if;

  if position('provider_intake.correction_requested' in lower(v_mode_helper)) = 0
     or position('p_mode = ''test_only''' in lower(v_mode_helper)) = 0
     or position('max_attempts = 3' in lower(v_lane_constraint)) = 0
     or position('new.max_attempts is distinct from 3' in lower(v_event_guard)) = 0
     or position('new.attempt_count is distinct from 0' in lower(v_event_guard)) = 0
     or position('new.locked_at is not null' in lower(v_event_guard)) = 0
     or position('new.locked_by is not null' in lower(v_event_guard)) = 0
     or position('new.processed_at is not null' in lower(v_event_guard)) = 0
     or position('new.last_attempt_at is not null' in lower(v_event_guard)) = 0 then
    raise exception 'n1a_postcheck_external_initial_attempt_contract_invalid';
  end if;

  if position('e.audience = ''external''' in lower(v_recovery)) = 0
     or position('e.status = ''processing''' in lower(v_recovery)) = 0
     or position('greatest(coalesce(p_lease_minutes, 10), 10)' in lower(v_recovery)) = 0
     or position('not exists' in lower(v_recovery)) = 0
     or position('provider_request_started_at is not null' in lower(v_recovery)) = 0
     or position('provider_request_completed_at is not null' in lower(v_recovery)) = 0
     or position('provider_message_id is not null' in lower(v_recovery)) = 0
     or position('attempt.status = ''sent''' in lower(v_recovery)) = 0
     or position('notification_external_event_mode_allowed' in lower(v_recovery)) = 0
     or position('insert into' in lower(v_recovery)) > 0
     or position('attempt_count =' in lower(v_recovery)) > 0
     or position('idempotency_key =' in lower(v_recovery)) > 0 then
    raise exception 'n1a_postcheck_recovery_contract_invalid';
  end if;

  if has_function_privilege(
       'anon',
       'public.claim_external_notification_events_for_dispatcher(integer,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.claim_external_notification_events_for_dispatcher(integer,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.claim_external_notification_events_for_dispatcher(integer,text)',
       'EXECUTE'
     ) then
    raise exception 'n1a_postcheck_external_claim_grants_invalid';
  end if;

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
            and pg_has_role('anon', policy_role::text, 'MEMBER')
        )
      )
  ) then
    raise exception 'n1a_postcheck_anon_or_public_select_policy_present';
  end if;

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
        (p.tablename = 'notification_events'
         and p.policyname <> 'notification_events_select_self_or_admin')
        or
        (p.tablename = 'notification_delivery_attempts'
         and p.policyname <> 'notification_delivery_attempts_select_self_or_admin')
        or position('audience' in lower(coalesce(p.qual, ''))) = 0
        or position('internal' in lower(coalesce(p.qual, ''))) = 0
      )
  ) then
    raise exception 'n1a_postcheck_authenticated_permissive_policy_not_internal';
  end if;

  if (
    select count(*)
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('notification_events', 'notification_delivery_attempts')
      and p.permissive = 'PERMISSIVE'
      and p.cmd = 'SELECT'
      and (
        'public'::name = any (p.roles)
        or exists (
          select 1
          from unnest(p.roles) policy_role
          where policy_role <> 'public'::name
            and pg_has_role('authenticated', policy_role::text, 'MEMBER')
        )
      )
  ) <> 2 then
    raise exception 'n1a_postcheck_authenticated_policy_inventory_unexpected';
  end if;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'notification_external_rollouts'
      and p.cmd in ('SELECT', 'ALL')
      and (
        'public'::name = any (p.roles)
        or exists (
          select 1
          from unnest(p.roles) policy_role
          where policy_role <> 'public'::name
            and (
              pg_has_role('anon', policy_role::text, 'MEMBER')
              or pg_has_role('authenticated', policy_role::text, 'MEMBER')
            )
        )
      )
  ) then
    raise exception 'n1a_postcheck_rollout_policy_exposes_non_service_role';
  end if;

  if has_table_privilege('anon', 'public.notification_events', 'SELECT')
     or has_table_privilege('anon', 'public.notification_delivery_attempts', 'SELECT')
     or not has_table_privilege('authenticated', 'public.notification_events', 'SELECT')
     or not has_table_privilege('authenticated', 'public.notification_delivery_attempts', 'SELECT')
     or not has_table_privilege('service_role', 'public.notification_events', 'SELECT')
     or not has_table_privilege('service_role', 'public.notification_delivery_attempts', 'SELECT') then
    raise exception 'n1a_postcheck_notification_table_grants_invalid';
  end if;

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
  ) then
    raise exception 'n1a_postcheck_external_producer_detected';
  end if;
end
$$;

select
  tablename,
  permissive,
  cmd,
  count(*)::bigint as policy_count,
  count(*) filter (
    where (
      'public'::name = any (roles)
      or exists (
        select 1
        from unnest(roles) policy_role
        where policy_role <> 'public'::name
          and pg_has_role('authenticated', policy_role::text, 'MEMBER')
      )
    )
  )::bigint as authenticated_or_public_count,
  count(*) filter (
    where (
      'public'::name = any (roles)
      or exists (
        select 1
        from unnest(roles) policy_role
        where policy_role <> 'public'::name
          and pg_has_role('anon', policy_role::text, 'MEMBER')
      )
    )
  )::bigint as anon_or_public_count,
  count(*) filter (
    where position('audience' in lower(coalesce(qual, ''))) > 0
      and position('internal' in lower(coalesce(qual, ''))) > 0
  )::bigint as explicitly_internal_count
from pg_policies
where schemaname = 'public'
  and tablename in (
    'notification_events',
    'notification_delivery_attempts',
    'notification_external_rollouts'
  )
group by tablename, permissive, cmd
order by tablename, permissive, cmd;

select
  'notification_events_total' as metric,
  count(*)::bigint as value
from public.notification_events
union all
select
  'notification_events_internal',
  count(*) filter (where audience = 'internal')::bigint
from public.notification_events
union all
select
  'notification_events_external',
  count(*) filter (where audience = 'external')::bigint
from public.notification_events
union all
select
  'notification_delivery_attempts_total',
  count(*)::bigint
from public.notification_delivery_attempts
union all
select
  'submission_completed_rows',
  count(*) filter (where event_type = 'submission_completed')::bigint
from public.payment_intake_events
union all
select
  'provider_matched_rows',
  count(*) filter (where event_type = 'provider_matched')::bigint
from public.payment_intake_events
union all
select
  'legacy_external_source_fields_nonnull',
  count(*) filter (
    where external_message is not null
       or external_field_codes is not null
       or external_contract_version is not null
  )::bigint
from public.payment_intake_events
union all
select
  'notification_payload_distinct_digest_count',
  count(distinct md5(payload::text))::bigint
from public.notification_events
union all
select
  'notification_idempotency_distinct_count',
  count(distinct idempotency_key)::bigint
from public.notification_events;

select
  status,
  count(*)::bigint as event_count
from public.notification_events
group by status
order by status;

select
  event_type,
  count(*)::bigint as event_count
from public.notification_events
group by event_type
order by event_type;

rollback;
