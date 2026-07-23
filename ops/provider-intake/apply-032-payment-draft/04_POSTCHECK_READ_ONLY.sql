\set ON_ERROR_STOP on

begin transaction read only;

do $$
begin
  if to_regclass('public.payment_intake_conversion_drafts') is null then
    raise exception '032_postcheck: draft table is missing';
  end if;
  if not (
    select c.relrowsecurity
    from pg_class c
    where c.oid = 'public.payment_intake_conversion_drafts'::regclass
  ) then
    raise exception '032_postcheck: RLS is disabled';
  end if;
  if exists (
    select 1 from pg_policy
    where polrelid = 'public.payment_intake_conversion_drafts'::regclass
  ) then
    raise exception '032_postcheck: draft table has policies';
  end if;
  if has_table_privilege('anon', 'public.payment_intake_conversion_drafts', 'SELECT')
     or has_table_privilege('authenticated', 'public.payment_intake_conversion_drafts', 'SELECT')
     or has_table_privilege('service_role', 'public.payment_intake_conversion_drafts', 'SELECT') then
    raise exception '032_postcheck: direct table access is open';
  end if;
  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_provider_intake_payment_draft_context',
        'save_provider_intake_payment_draft'
      )
      and p.prosecdef
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting = 'search_path=public, pg_temp'
      )
  ) <> 2 then
    raise exception '032_postcheck: RPC contracts are incomplete';
  end if;
  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
      and t.tgenabled <> 'D'
  ) then
    raise exception '032_postcheck: append-only trigger is inactive';
  end if;
end
$$;

select jsonb_pretty(jsonb_build_object(
  'gate', 'phase-2b1-migration-032-postcheck',
  'environment', 'DEV',
  'project_ref', 'scsirgbuqjcwoaxfacth',
  'draft_table', 'PASS',
  'unique_per_intake', exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.payment_intake_conversion_drafts'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) like '%payment_intake_id%'
  ),
  'rls', 'PASS',
  'direct_grants', 'CLOSED',
  'rpc_security', 'PASS',
  'append_only', 'PASS',
  'business_counts', jsonb_build_object(
    'payment_intake', (select count(*) from public.payment_intake),
    'payment_intake_events', (select count(*) from public.payment_intake_events),
    'conversion_drafts', (select count(*) from public.payment_intake_conversion_drafts),
    'conversion_draft_events', (
      select count(*) from public.payment_intake_events
      where event_type in ('conversion_draft_created', 'conversion_draft_updated')
    ),
    'payment_requests', (select count(*) from public.payment_requests),
    'proveedores', (select count(*) from public.proveedores),
    'approval_batches', (select count(*) from public.approval_batches),
    'notification_events', (select count(*) from public.notification_events)
  ),
  'record_identifiers_emitted', false,
  'database_writes', false
));

commit;
