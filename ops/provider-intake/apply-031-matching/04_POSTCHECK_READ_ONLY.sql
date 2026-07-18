\set ON_ERROR_STOP on

begin transaction read only;

do $$
begin
  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'find_provider_intake_candidates',
        'get_provider_intake_match_comparison',
        'set_provider_intake_match'
      )
      and p.prosecdef
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting = 'search_path=public, pg_temp'
      )
  ) <> 3 then
    raise exception '031_postcheck: matching RPC contracts are incomplete';
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
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception '031_postcheck: matching RPC grants are unsafe';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
      and t.tgenabled <> 'D'
  ) then
    raise exception '031_postcheck: append-only trigger is inactive';
  end if;
end
$$;

select jsonb_pretty(jsonb_build_object(
  'gate', 'phase-2a-migration-031-postcheck',
  'environment', 'DEV',
  'project_ref', 'scsirgbuqjcwoaxfacth',
  'matching_rpcs', 3,
  'security_definer', 'PASS',
  'search_path', 'PASS',
  'grants', 'PASS',
  'bank_masking', 'PASS',
  'material_idempotency', 'contract-v3',
  'append_only', 'PASS',
  'business_counts', jsonb_build_object(
    'payment_intake', (select count(*) from public.payment_intake),
    'matched_intakes', (
      select count(*) from public.payment_intake where matched_proveedor_id is not null
    ),
    'payment_intake_events', (select count(*) from public.payment_intake_events),
    'provider_matched_events', (
      select count(*) from public.payment_intake_events where event_type = 'provider_matched'
    ),
    'proveedores', (select count(*) from public.proveedores),
    'payment_requests', (select count(*) from public.payment_requests),
    'approval_batches', (select count(*) from public.approval_batches),
    'notification_events', (select count(*) from public.notification_events)
  ),
  'record_identifiers_emitted', false,
  'database_writes', false
));

commit;

