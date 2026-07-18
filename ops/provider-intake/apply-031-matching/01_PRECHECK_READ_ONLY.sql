\set ON_ERROR_STOP on

begin transaction read only;

do $$
begin
  if to_regprocedure(
    'public.provider_intake_action_fingerprint(integer,text,uuid,uuid,text,timestamptz,text,text)'
  ) is null then
    raise exception '031_precheck: Migration 030 is not applied';
  end if;

  if to_regprocedure('public.find_provider_intake_candidates(uuid,text,integer)') is not null
     or to_regprocedure('public.get_provider_intake_match_comparison(uuid,uuid)') is not null
     or to_regprocedure(
       'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'
     ) is not null then
    raise exception '031_precheck: Migration 031 is already present or partially applied';
  end if;

  if to_regclass('public.payment_intake') is null
     or to_regclass('public.payment_intake_events') is null
     or to_regclass('public.proveedores') is null then
    raise exception '031_precheck: canonical tables are missing';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
      and t.tgenabled <> 'D'
  ) then
    raise exception '031_precheck: append-only trigger is inactive';
  end if;
end
$$;

select jsonb_pretty(jsonb_build_object(
  'gate', 'phase-2a-migration-031-precheck',
  'environment', 'DEV',
  'project_ref', 'scsirgbuqjcwoaxfacth',
  'migration_030_applied', true,
  'migration_031_applied', false,
  'pg_trgm_enabled', exists (
    select 1 from pg_extension where extname = 'pg_trgm'
  ),
  'baseline', jsonb_build_object(
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

