\set ON_ERROR_STOP on

begin transaction read only;

with functions as (
  select
    p.proname,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_function_result(p.oid) as result_type,
    pg_get_functiondef(p.oid) as definition,
    obj_description(p.oid, 'pg_proc') as comment,
    p.prosecdef,
    p.provolatile,
    p.proconfig,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'grantee', case
            when a.grantee = 0 then 'PUBLIC'
            else pg_get_userbyid(a.grantee)
          end,
          'privilege', a.privilege_type,
          'grantable', a.is_grantable
        )
        order by a.grantee, a.privilege_type
      )
      from aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) a
    ), '[]'::jsonb) as acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'transition_provider_intake',
      'add_provider_intake_note'
    )
)
select jsonb_pretty(jsonb_build_object(
  'backup', 'provider-intake-migration-030-pre-apply',
  'environment', 'DEV',
  'project_ref', 'scsirgbuqjcwoaxfacth',
  'source_contract', 'Migration 029',
  'functions', (
    select jsonb_agg(to_jsonb(f) order by f.proname)
    from functions f
  ),
  'action_id_index_definition', (
    select indexdef
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'payment_intake_events_action_id_uidx'
  ),
  'append_only_trigger_definition', (
    select pg_get_triggerdef(t.oid)
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
  ),
  'contains_record_data', false,
  'database_writes', false
));

commit;
