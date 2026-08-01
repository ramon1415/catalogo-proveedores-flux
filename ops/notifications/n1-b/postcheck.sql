-- NOTIFICATIONS-N1-B-C1 future postcheck. Read-only and sanitized.
-- Run only immediately after an separately authorized migration apply.

\set ON_ERROR_STOP on
begin transaction isolation level repeatable read read only;

do $$
declare
  v_legacy text;
  v_producer text;
begin
  if to_regclass('public.notification_external_dispatch_invocations') is null
     or to_regprocedure('public.enqueue_provider_intake_external_notification_v1(uuid)') is null
     or to_regprocedure('public.finalize_provider_intake_submission_v1(uuid,smallint,jsonb)') is null
     or to_regprocedure('public.transition_provider_intake_external_v1(uuid,text,timestamptz,text,text,text,text[],uuid)') is null
     or to_regprocedure('public.register_external_notification_dispatch_invocation(text,text,text,timestamptz)') is null
     or to_regprocedure('public.get_external_notification_rollout_mode()') is null
     or to_regprocedure('public.reserve_external_notification_attempt(uuid,text)') is null
     or to_regprocedure('public.mark_external_provider_request_started(uuid,integer,text)') is null
     or to_regprocedure('public.mark_external_notification_sent(uuid,integer,text,text)') is null
     or to_regprocedure('public.mark_external_notification_failed(uuid,integer,text,text)') is null then
    raise exception 'n1b_postcheck_candidate_objects_missing';
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
     or position('notification_external_event_mode_allowed' in v_producer) = 0
     or position('provider_intake.correction_requested' in v_producer) = 0
     or position('manual_follow_up_required' in v_producer) = 0
     or position('proveedores' in v_producer) > 0 then
    raise exception 'n1b_postcheck_zero_backlog_or_recipient_contract_missing';
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
     ) then
    raise exception 'n1b_postcheck_rpc_grants_invalid';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.notification_external_dispatch_invocations'::regclass
      and relrowsecurity
  )
     or has_table_privilege('anon', 'public.notification_external_dispatch_invocations', 'SELECT')
     or has_table_privilege('authenticated', 'public.notification_external_dispatch_invocations', 'SELECT') then
    raise exception 'n1b_postcheck_invocation_rls_or_grants_invalid';
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
