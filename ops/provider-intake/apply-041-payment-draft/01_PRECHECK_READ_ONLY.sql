\set ON_ERROR_STOP on

begin transaction read only;

do $$
begin
  if to_regclass('public.payment_intake_conversion_drafts') is not null
     or to_regprocedure('public.get_provider_intake_payment_draft_context(uuid)') is not null
     or exists (
       select 1
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = 'save_provider_intake_payment_draft'
     ) then
    raise exception '041_precheck: Migration 041 is already present or partially applied';
  end if;

  if to_regclass('public.payment_intake') is null
     or to_regclass('public.payment_intake_events') is null
     or to_regclass('public.payment_requests') is null
     or to_regclass('public.proveedores') is null
     or to_regprocedure('public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)') is null
     or to_regprocedure('public.list_payment_request_approver_options(uuid,uuid,numeric)') is null then
    raise exception '041_precheck: canonical prerequisites are incomplete';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
      and t.tgenabled <> 'D'
  ) then
    raise exception '041_precheck: append-only trigger is inactive';
  end if;
end
$$;

select jsonb_pretty(jsonb_build_object(
  'gate', 'phase-2b1-migration-041-precheck',
  'environment', 'DEV',
  'project_ref', 'scsirgbuqjcwoaxfacth',
  'migration_031_applied', true,
  'migration_041_applied', false,
  'baseline', jsonb_build_object(
    'payment_intake', (select count(*) from public.payment_intake),
    'payment_intake_events', (select count(*) from public.payment_intake_events),
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
