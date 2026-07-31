-- N1-A precheck for migration 041.
-- Git prerequisite: dev=2deae2cddf8ebb22fffd76e7a648483e2b3cc609 and
-- supabase/migrations/031_provider_intake_matching.sql present and unchanged.
-- Read-only, sanitized aggregates only. Run only in a separately authorized apply gate.

\set ON_ERROR_STOP on
begin transaction isolation level repeatable read read only;

do $$
declare
  v_missing text[] := array[]::text[];
  v_unexpected text[] := array[]::text[];
  v_claim_definition text;
  v_legacy_claim_definition text;
begin
  if to_regclass('public.notification_events') is null then
    v_missing := array_append(v_missing, 'notification_events');
  end if;
  if to_regclass('public.notification_delivery_attempts') is null then
    v_missing := array_append(v_missing, 'notification_delivery_attempts');
  end if;
  if to_regclass('public.payment_intake') is null then
    v_missing := array_append(v_missing, 'payment_intake');
  end if;
  if to_regclass('public.payment_intake_files') is null then
    v_missing := array_append(v_missing, 'payment_intake_files');
  end if;
  if to_regclass('public.payment_intake_events') is null then
    v_missing := array_append(v_missing, 'payment_intake_events');
  end if;
  if to_regprocedure('public.claim_notification_events_for_dispatcher(integer,text)') is null then
    v_missing := array_append(v_missing, 'claim_notification_events_for_dispatcher(integer,text)');
  end if;
  if to_regprocedure('public.claim_pending_notification_events(integer,text)') is null then
    v_missing := array_append(v_missing, 'claim_pending_notification_events(integer,text)');
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    v_missing := array_append(v_missing, 'set_updated_at()');
  end if;
  if to_regprocedure('public.protect_payment_intake_events_immutable()') is null then
    v_missing := array_append(v_missing, 'protect_payment_intake_events_immutable()');
  end if;
  if to_regprocedure('public.normalize_provider_match_text(text)') is null then
    v_missing := array_append(v_missing, 'normalize_provider_match_text(text)');
  end if;
  if to_regprocedure('public.normalize_provider_match_digits(text)') is null then
    v_missing := array_append(v_missing, 'normalize_provider_match_digits(text)');
  end if;
  if to_regprocedure(
    'public.provider_intake_match_fingerprint(integer,text,uuid,uuid,text,timestamptz,uuid,uuid,text,text)'
  ) is null then
    v_missing := array_append(v_missing, 'provider_intake_match_fingerprint signature');
  end if;
  if to_regprocedure('public.find_provider_intake_candidates(uuid,text,integer)') is null then
    v_missing := array_append(v_missing, 'find_provider_intake_candidates signature');
  end if;
  if to_regprocedure('public.get_provider_intake_match_comparison(uuid,uuid)') is null then
    v_missing := array_append(v_missing, 'get_provider_intake_match_comparison signature');
  end if;
  if to_regprocedure(
    'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'
  ) is null then
    v_missing := array_append(v_missing, 'set_provider_intake_match signature');
  end if;
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    v_missing := array_append(v_missing, 'extensions.digest(bytea,text)');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'n1a_precheck_missing_dependencies:%', array_to_string(v_missing, ',');
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_intake'
      and column_name = 'provider_rfc'
  ) then
    raise exception 'n1a_precheck_provider_rfc_missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notification_events'::regclass
      and conname = 'notification_events_recipient_type_check'
      and pg_get_constraintdef(oid) like '%usuario_solicitante%'
      and pg_get_constraintdef(oid) like '%administrador_sistema%'
  ) then
    raise exception 'n1a_precheck_notification_recipient_contract_unexpected';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notification_events'::regclass
      and conname = 'notification_events_status_check'
      and pg_get_constraintdef(oid) like '%pending%'
      and pg_get_constraintdef(oid) like '%dead_letter%'
      and pg_get_constraintdef(oid) like '%cancelled%'
  ) then
    raise exception 'n1a_precheck_notification_status_contract_unexpected';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_intake_events'::regclass
      and conname = 'payment_intake_events_event_type_check'
      and pg_get_constraintdef(oid) like '%received%'
      and pg_get_constraintdef(oid) like '%provider_matched%'
      and pg_get_constraintdef(oid) like '%correction_requested%'
      and pg_get_constraintdef(oid) like '%rejected%'
      and pg_get_constraintdef(oid) like '%internal_note%'
  ) then
    raise exception 'n1a_precheck_intake_event_contract_unexpected';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_intake_files'::regclass
      and conname = 'payment_intake_files_kind_check'
      and pg_get_constraintdef(oid) like '%invoice_pdf%'
      and pg_get_constraintdef(oid) like '%invoice_xml%'
      and pg_get_constraintdef(oid) like '%bank_document%'
  ) then
    raise exception 'n1a_precheck_file_kind_contract_unexpected';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_intake'
      and column_name = 'matched_proveedor_id'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_intake'
      and column_name = 'created_payment_request_id'
  ) then
    raise exception 'n1a_precheck_matching_columns_missing';
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
    raise exception 'n1a_precheck_matching_set_contract_changed';
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
    raise exception 'n1a_precheck_matching_rpc_grants_changed';
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
    raise exception 'n1a_precheck_matching_helper_grants_changed';
  end if;

  select pg_get_functiondef(
    'public.claim_notification_events_for_dispatcher(integer,text)'::regprocedure
  ) into v_claim_definition;

  if position('for update skip locked' in lower(v_claim_definition)) = 0
     or position('limit v_limit' in lower(v_claim_definition)) = 0
     or position('audience' in lower(v_claim_definition)) > 0 then
    raise exception 'n1a_precheck_internal_claim_unexpected';
  end if;

  select pg_get_functiondef(
    'public.claim_pending_notification_events(integer,text)'::regprocedure
  ) into v_legacy_claim_definition;

  if position('for update skip locked' in lower(v_legacy_claim_definition)) = 0
     or position('audience' in lower(v_legacy_claim_definition)) > 0 then
    raise exception 'n1a_precheck_legacy_claim_unexpected';
  end if;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.notification_events'::regclass
      and relrowsecurity
  ) or not exists (
    select 1
    from pg_class
    where oid = 'public.notification_delivery_attempts'::regclass
      and relrowsecurity
  ) then
    raise exception 'n1a_precheck_notification_rls_missing';
  end if;

  if not has_table_privilege('authenticated', 'public.notification_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.notification_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.notification_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.notification_events', 'DELETE')
     or not has_table_privilege('service_role', 'public.notification_events', 'SELECT')
     or not has_table_privilege('service_role', 'public.notification_events', 'INSERT')
     or not has_table_privilege('service_role', 'public.notification_events', 'UPDATE')
     or not has_table_privilege('service_role', 'public.notification_events', 'DELETE') then
    raise exception 'n1a_precheck_notification_grants_unexpected';
  end if;

  if to_regclass('public.notification_external_rollouts') is not null then
    v_unexpected := array_append(v_unexpected, 'notification_external_rollouts');
  end if;

  select v_unexpected || coalesce(array_agg(table_name || '.' || column_name), array[]::text[])
    into v_unexpected
  from information_schema.columns
  where table_schema = 'public'
    and (
      (table_name = 'notification_events' and column_name in (
        'audience', 'event_version', 'rollout_id', 'external_subject_type',
        'external_subject_id', 'terminal_reason'
      ))
      or (table_name = 'notification_delivery_attempts' and column_name in (
        'provider_idempotency_key', 'safe_error_code',
        'provider_request_started_at', 'provider_request_completed_at'
      ))
      or (table_name = 'payment_intake' and column_name in (
        'expected_file_count', 'submission_completed_at'
      ))
      or (table_name = 'payment_intake_events' and column_name in (
        'external_message', 'external_field_codes', 'external_contract_version'
      ))
    );

  if cardinality(v_unexpected) > 0 then
    raise exception 'n1a_precheck_candidate_objects_already_exist:%',
      array_to_string(v_unexpected, ',');
  end if;

  if exists (
    select 1
    from (
      select notification_event_id, attempt_number
      from public.notification_delivery_attempts
      group by notification_event_id, attempt_number
      having count(*) > 1
    ) duplicate_attempt
  ) then
    raise exception 'n1a_precheck_duplicate_attempt_numbers';
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
    raise exception 'n1a_precheck_external_event_names_already_present';
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
    raise exception 'n1a_precheck_external_producer_already_present';
  end if;
end
$$;

select
  'notification_events_total' as metric,
  count(*)::bigint as value
from public.notification_events
union all
select
  'notification_delivery_attempts_total',
  count(*)::bigint
from public.notification_delivery_attempts
union all
select
  'notification_events_with_recipient',
  count(*) filter (where recipient_email is not null)::bigint
from public.notification_events
union all
select
  'notification_payload_distinct_digest_count',
  count(distinct md5(payload::text))::bigint
from public.notification_events
union all
select
  'notification_idempotency_distinct_count',
  count(distinct idempotency_key)::bigint
from public.notification_events
union all
select
  'duplicate_attempt_groups',
  count(*)::bigint
from (
  select 1
  from public.notification_delivery_attempts
  group by notification_event_id, attempt_number
  having count(*) > 1
) duplicate_attempt;

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

select
  event_type,
  count(*)::bigint as intake_event_count
from public.payment_intake_events
group by event_type
order by event_type;

rollback;
