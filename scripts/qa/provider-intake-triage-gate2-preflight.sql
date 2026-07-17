\set ON_ERROR_STOP on

begin transaction read only;

with
triage_functions as (
  select
    p.oid,
    p.proname,
    p.prosecdef,
    p.provolatile,
    p.proconfig,
    l.lanname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.proname = any (array[
      'provider_intake_actor_context',
      'provider_intake_assert_company_access',
      'provider_intake_mask_value',
      'list_provider_intakes',
      'get_provider_intake_detail',
      'transition_provider_intake',
      'add_provider_intake_note'
    ]::text[])
),
triage_acl as (
  select
    f.oid,
    f.proname,
    a.grantee,
    a.privilege_type
  from triage_functions f
  cross join lateral aclexplode(
    coalesce(
      (select p.proacl from pg_proc p where p.oid = f.oid),
      acldefault('f', (select p.proowner from pg_proc p where p.oid = f.oid))
    )
  ) a
),
event_actor_fk as (
  select c.confdeltype
  from pg_constraint c
  where c.contype = 'f'
    and c.conrelid = 'public.payment_intake_events'::regclass
    and pg_get_constraintdef(c.oid) like '%(actor_profile_id)%'
  limit 1
),
intake_triaged_by_fk as (
  select c.confdeltype
  from pg_constraint c
  where c.contype = 'f'
    and c.conrelid = 'public.payment_intake'::regclass
    and pg_get_constraintdef(c.oid) like '%(triaged_by)%'
  limit 1
),
transition_definition as (
  select pg_get_functiondef(
    'public.transition_provider_intake(uuid,text,timestamptz,text,text,uuid)'::regprocedure
  ) as definition
),
safe_received as (
  select pi.company_id, count(*)::integer as fixture_count
  from public.payment_intake pi
  where pi.status = 'received'
    and pi.matched_proveedor_id is null
    and pi.created_payment_request_id is null
    and lower(pi.provider_email) ~ '@example\.(test|com|org)$'
    and lower(concat_ws(
      ' ',
      pi.provider_name,
      pi.concept,
      pi.description,
      pi.idempotency_key
    )) ~ '(qa|test|prueba|demo|fictici|sandbox|codex)'
  group by pi.company_id
),
status_counts as (
  select coalesce(jsonb_object_agg(status, amount order by status), '{}'::jsonb) as value
  from (
    select status, count(*)::integer as amount
    from public.payment_intake
    group by status
  ) counted
),
event_counts as (
  select coalesce(jsonb_object_agg(event_type, amount order by event_type), '{}'::jsonb) as value
  from (
    select event_type, count(*)::integer as amount
    from public.payment_intake_events
    group by event_type
  ) counted
),
facts as (
  select
    (select count(*)::integer from public.payment_intake) as intakes,
    (select count(*)::integer from public.payment_intake_events) as intake_events,
    (select count(*)::integer from public.payment_intake_files) as intake_files,
    (select count(*)::integer from storage.objects where bucket_id = 'intake-uploads') as storage_objects,
    (select count(*)::integer from public.payment_requests) as payment_requests,
    (select count(*)::integer from public.proveedores) as proveedores,
    (select count(*)::integer from public.providers) as providers,
    (select count(*)::integer from public.approval_batches) as approval_batches,
    (select count(*)::integer from public.payment_layouts) as payment_layouts,
    (select count(*)::integer from public.payment_layout_lines) as payment_layout_lines,
    (select count(*)::integer from public.cash_funds) as cash_funds,
    (select count(*)::integer from public.notification_events) as notification_events,
    (select count(*)::integer from public.intake_links) as intake_links,
    (select count(*)::integer from public.profiles) as profiles,
    (select count(*)::integer from public.user_roles) as user_roles,
    (select count(*)::integer from public.profile_company_memberships) as memberships,
    (select count(*)::integer from auth.users) as auth_users,
    (select count(*)::integer from public.payment_intake_events where event_type = 'internal_note') as internal_notes,
    (select value from status_counts) as statuses,
    (select value from event_counts) as event_types,
    coalesce((select sum(fixture_count)::integer from safe_received), 0) as conservative_safe_received,
    (select count(*)::integer from safe_received where fixture_count >= 2) as companies_with_two_safe_received,
    (select count(*)::integer from triage_functions) as function_count,
    (select count(*)::integer from triage_functions where prosecdef) as security_definer_count,
    (
      select count(*)::integer
      from triage_functions
      where proname = 'provider_intake_mask_value'
        and not prosecdef
        and lanname = 'sql'
        and provolatile = 'i'
    ) as pure_mask_invoker_count,
    (
      select count(*)::integer
      from triage_functions
      where proconfig is not null
        and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%'
    ) as fixed_search_path_count,
    (
      select count(*)::integer
      from triage_acl
      where grantee = 0
        and privilege_type = 'EXECUTE'
    ) as public_execute_count,
    (
      select count(*)::integer
      from triage_functions f
      where has_function_privilege('anon', f.oid, 'EXECUTE')
    ) as anon_execute_count,
    (
      select count(*)::integer
      from triage_functions f
      where has_function_privilege('authenticated', f.oid, 'EXECUTE')
    ) as authenticated_execute_count,
    (
      select count(*)::integer
      from triage_functions f
      where f.proname in (
        'provider_intake_actor_context',
        'provider_intake_assert_company_access',
        'provider_intake_mask_value'
      )
        and (
          has_function_privilege('authenticated', f.oid, 'EXECUTE')
          or has_function_privilege('service_role', f.oid, 'EXECUTE')
        )
    ) as internal_helper_direct_execute_count,
    (
      select confdeltype in ('a', 'r')
      from event_actor_fk
    ) as event_actor_profile_delete_restricted,
    (
      select confdeltype in ('a', 'r')
      from intake_triaged_by_fk
    ) as intake_triaged_by_profile_delete_restricted,
    (
      select definition like '%select pie.id, pie.actor_profile_id%'
        and definition like '%v_existing_event.actor_profile_id is distinct from v_actor_profile_id%'
      from transition_definition
    ) as action_replay_checks_actor,
    (
      select definition ~* '(request_fingerprint|material_hash|payload_hash|notes_hash)'
        or definition ~* 'metadata[^\n]+(to_status|expected_status|expected_updated_at)'
      from transition_definition
    ) as action_replay_checks_material_request,
    (
      select definition like '%v_intake.updated_at is distinct from p_expected_updated_at%'
      from transition_definition
    ) as optimistic_concurrency_present
)
select jsonb_pretty(
  jsonb_build_object(
    'gate', 'phase-1d-gate-2-read-only-preflight',
    'environment', 'DEV',
    'project_ref', 'scsirgbuqjcwoaxfacth',
    'decision', case
      when f.event_actor_profile_delete_restricted
        or f.intake_triaged_by_profile_delete_restricted
        or not f.action_replay_checks_material_request
      then 'FAIL_PRECHECK'
      else 'PROCEED'
    end,
    'mutations_executed', false,
    'identities_created', 0,
    'baseline', jsonb_build_object(
      'payment_intake', f.intakes,
      'payment_intake_events', f.intake_events,
      'payment_intake_files', f.intake_files,
      'storage_private', f.storage_objects,
      'payment_requests', f.payment_requests,
      'proveedores', f.proveedores,
      'providers', f.providers,
      'approval_batches', f.approval_batches,
      'payment_layouts', f.payment_layouts,
      'payment_layout_lines', f.payment_layout_lines,
      'cash_funds', f.cash_funds,
      'notification_events', f.notification_events,
      'intake_links', f.intake_links,
      'profiles', f.profiles,
      'user_roles', f.user_roles,
      'profile_company_memberships', f.memberships,
      'auth_users', f.auth_users,
      'statuses', f.statuses,
      'internal_note', f.internal_notes,
      'event_types', f.event_types
    ),
    'reference_baseline_matches', (
      f.intakes = 13
      and f.intake_events = 20
      and f.intake_files = 6
      and f.storage_objects = 6
      and f.payment_requests = 73
      and f.proveedores = 22
      and f.approval_batches = 8
      and f.notification_events = 322
      and f.intake_links = 2
      and f.statuses = '{"needs_correction": 1, "received": 12}'::jsonb
      and f.internal_notes = 0
    ),
    'migration_029_live_contract', jsonb_build_object(
      'functions', f.function_count,
      'security_definer', f.security_definer_count,
      'pure_mask_invoker', f.pure_mask_invoker_count,
      'fixed_search_path', f.fixed_search_path_count,
      'public_execute', f.public_execute_count,
      'anon_execute', f.anon_execute_count,
      'authenticated_execute', f.authenticated_execute_count,
      'internal_helper_direct_execute', f.internal_helper_direct_execute_count,
      'optimistic_concurrency_present', f.optimistic_concurrency_present
    ),
    'fixture_preflight', jsonb_build_object(
      'selection_rule', 'reserved_email_domain_plus_explicit_qa_marker',
      'conservative_safe_received', f.conservative_safe_received,
      'companies_with_two_safe_received', f.companies_with_two_safe_received,
      'record_identifiers_emitted', false
    ),
    'structural_checks', jsonb_build_object(
      'event_actor_profile_delete_restricted', f.event_actor_profile_delete_restricted,
      'intake_triaged_by_profile_delete_restricted', f.intake_triaged_by_profile_delete_restricted,
      'temporary_finance_profile_cleanup_after_events_possible', not (
        f.event_actor_profile_delete_restricted
        or f.intake_triaged_by_profile_delete_restricted
      ),
      'action_replay_checks_actor', f.action_replay_checks_actor,
      'action_replay_checks_material_request', f.action_replay_checks_material_request
    ),
    'blockers', jsonb_build_array(
      jsonb_build_object(
        'id', 'QA_IAM_CLEANUP_FK_RESTRICT',
        'severity', 'P1',
        'confirmed', (
          f.event_actor_profile_delete_restricted
          or f.intake_triaged_by_profile_delete_restricted
        ),
        'impact', 'A temporary Finance profile cannot be deleted after it becomes event actor or triaged_by while append-only evidence is retained.'
      ),
      jsonb_build_object(
        'id', 'ACTION_ID_MATERIAL_MISMATCH_NOT_GUARDED',
        'severity', 'P1',
        'confirmed', not f.action_replay_checks_material_request,
        'impact', 'A repeated action_id from the same actor is accepted without proving that the material request is identical.'
      )
    ),
    'privacy', jsonb_build_object(
      'contains_pii', false,
      'contains_record_ids', false,
      'contains_tokens_or_secrets', false
    )
  )
)
from facts f;

commit;
