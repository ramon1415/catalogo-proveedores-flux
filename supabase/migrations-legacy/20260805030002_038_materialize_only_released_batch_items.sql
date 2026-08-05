-- Flux Operadora - Migration 038
-- Materialize payable snapshots only for batch items already released by
-- close_approval_batch. Blocked and pending items remain auditable but cannot
-- create snapshots or roll back otherwise valid released items.

begin;

create temporary table migration_038_baseline (
  payable_snapshots bigint not null,
  approval_batches bigint not null,
  approval_batch_items bigint not null,
  payment_layouts bigint not null,
  payment_layout_lines bigint not null,
  payment_receipts bigint not null,
  notification_events bigint not null,
  financial_outbox_events bigint not null,
  delivery_attempts bigint not null,
  trigger_definition text not null,
  target_acl text not null,
  close_definition_md5 text not null,
  canonical_definition_md5 text not null,
  block_reason_definition_md5 text not null,
  preview_definition_md5 text not null
) on commit drop;

insert into migration_038_baseline
select
  (select count(*) from public.payable_snapshots),
  (select count(*) from public.approval_batches),
  (select count(*) from public.approval_batch_items),
  (select count(*) from public.payment_layouts),
  (select count(*) from public.payment_layout_lines),
  (select count(*) from public.payment_receipts),
  (select count(*) from public.notification_events),
  (select count(*) from public.financial_outbox_events),
  (select count(*) from public.financial_outbox_delivery_attempts),
  (
    select pg_get_triggerdef(trigger_info.oid, true)
    from pg_trigger trigger_info
    where not trigger_info.tgisinternal
      and trigger_info.tgname = 'materialize_closed_batch_payable_snapshots'
      and trigger_info.tgrelid = 'public.approval_batches'::regclass
  ),
  coalesce(
    (
      select function_info.proacl::text
      from pg_proc function_info
      where function_info.oid =
        'public.materialize_closed_batch_payable_snapshots()'::regprocedure
    ),
    '<default>'
  ),
  md5(pg_get_functiondef('public.close_approval_batch(uuid)'::regprocedure)),
  md5(pg_get_functiondef(
    'public.create_payable_snapshot_internal(uuid,text,uuid,text,uuid,timestamptz,uuid,text)'::regprocedure
  )),
  md5(pg_get_functiondef(
    'public.approval_batch_item_release_block_reason(uuid)'::regprocedure
  )),
  md5(pg_get_functiondef(
    'public.preview_approval_batch_close(uuid)'::regprocedure
  ));

do $precheck$
declare
  v_definition text;
  v_trigger_definition text;
  v_status_constraint text;
  v_security_definer boolean;
  v_volatility "char";
  v_returns_trigger boolean;
  v_language_name name;
  v_config text[];
  v_owner_name name;
  v_release_columns integer;
  v_release_constraints integer;
begin
  if to_regclass('public.payment_request_extraordinary_events') is null
     or to_regprocedure(
       'public.authorize_payment_request_extraordinary(uuid,text,text)'
     ) is null then
    raise exception '038_precheck: migration 036 contract is missing';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.authorize_payment_request_extraordinary(uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.authorize_payment_request_extraordinary(uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception '038_precheck: legacy extraordinary RPC is not blocked';
  end if;

  if (
    select count(*) filter (
      where status = 'legacy_consumed_unverified'
    ) <> 7
       or count(*) filter (where status = 'legacy_quarantined') <> 1
       or count(*) filter (
         where status = 'revoked'
           and evidence_verified_at is null
       ) < 1
       or count(*) filter (
         where status = 'active'
           and evidence_verified_at is null
       ) <> 0
    from public.payment_request_extraordinary_authorizations
  ) then
    raise exception '038_precheck: migration 036 legacy distribution is invalid';
  end if;

  if to_regclass('public.extraordinary_payment_policies') is null
     or to_regprocedure('public.preview_approval_batch_close(uuid)') is null
     or to_regprocedure(
       'public.approval_batch_item_release_block_reason(uuid)'
     ) is null then
    raise exception '038_precheck: migration 037 contract is missing';
  end if;

  select count(*) into v_release_columns
  from information_schema.columns column_info
  where column_info.table_schema = 'public'
    and column_info.table_name = 'approval_batch_items'
    and column_info.column_name in (
      'finance_release_status',
      'finance_release_reason',
      'finance_released_by',
      'finance_released_at'
    );
  if v_release_columns <> 4 then
    raise exception '038_precheck: release columns are incomplete';
  end if;

  select count(*) into v_release_constraints
  from pg_constraint constraint_info
  where constraint_info.conrelid = 'public.approval_batch_items'::regclass
    and constraint_info.conname in (
      'approval_batch_items_finance_release_status_check',
      'approval_batch_items_finance_release_lifecycle_check',
      'approval_batch_items_finance_released_by_fkey'
    );
  if v_release_constraints <> 3 then
    raise exception '038_precheck: release constraints are incomplete';
  end if;

  select pg_get_constraintdef(constraint_info.oid, true)
    into v_status_constraint
  from pg_constraint constraint_info
  where constraint_info.conrelid = 'public.approval_batch_items'::regclass
    and constraint_info.conname =
      'approval_batch_items_finance_release_status_check';
  if v_status_constraint is null
     or position('pending' in v_status_constraint) = 0
     or position('released' in v_status_constraint) = 0
     or position('blocked' in v_status_constraint) = 0 then
    raise exception '038_precheck: release status constraint is unexpected';
  end if;

  if to_regprocedure(
       'public.materialize_closed_batch_payable_snapshots()'
     ) is null then
    raise exception '038_precheck: materializer function is missing';
  end if;

  select
    pg_get_functiondef(function_info.oid),
    function_info.prosecdef,
    function_info.provolatile,
    function_info.prorettype = 'trigger'::regtype,
    language_info.lanname,
    function_info.proconfig,
    pg_get_userbyid(function_info.proowner)
  into
    v_definition,
    v_security_definer,
    v_volatility,
    v_returns_trigger,
    v_language_name,
    v_config,
    v_owner_name
  from pg_proc function_info
  join pg_language language_info
    on language_info.oid = function_info.prolang
  where function_info.oid =
    'public.materialize_closed_batch_payable_snapshots()'::regprocedure;

  if not v_security_definer
     or v_volatility <> 'v'
     or not v_returns_trigger
     or v_language_name <> 'plpgsql'
     or v_owner_name <> 'postgres'
     or v_config is distinct from
       array['search_path=public, pg_temp']::text[] then
    raise exception '038_precheck: materializer signature or attributes changed';
  end if;

  if has_function_privilege(
       'public',
       'public.materialize_closed_batch_payable_snapshots()',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.materialize_closed_batch_payable_snapshots()',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.materialize_closed_batch_payable_snapshots()',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.materialize_closed_batch_payable_snapshots()',
       'EXECUTE'
     ) then
    raise exception '038_precheck: materializer grants are unexpected';
  end if;

  if position(
       'item.director_status = ''approved''' in v_definition
     ) = 0
     or position(
       'create_payable_snapshot_internal' in v_definition
     ) = 0 then
    raise exception '038_precheck: installed materializer is not the known 032 contract';
  end if;

  if position(
       'item.finance_release_status = ''released''' in v_definition
     ) > 0 then
    raise exception '038_precheck: released-only correction already exists';
  end if;

  select pg_get_triggerdef(trigger_info.oid, true)
    into v_trigger_definition
  from pg_trigger trigger_info
  where not trigger_info.tgisinternal
    and trigger_info.tgname = 'materialize_closed_batch_payable_snapshots'
    and trigger_info.tgrelid = 'public.approval_batches'::regclass
    and trigger_info.tgfoid =
      'public.materialize_closed_batch_payable_snapshots()'::regprocedure
    and trigger_info.tgenabled = 'O';
  if v_trigger_definition is null
     or v_trigger_definition <> (
       select baseline.trigger_definition
       from migration_038_baseline baseline
     ) then
    raise exception '038_precheck: materializer trigger is missing or unexpected';
  end if;
end
$precheck$;

create or replace function public.materialize_closed_batch_payable_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_item record;
begin
  if new.status <> 'closed' or old.status = 'closed' then
    return new;
  end if;
  if new.closed_by is null or new.closed_at is null then
    raise exception 'closed_batch_actor_required';
  end if;
  for v_item in
    select item.id, item.payment_request_id, item.decided_by, item.decided_at
    from public.approval_batch_items item
    where item.batch_id = new.id
      and item.removed_at is null
      and item.director_status = 'approved'
      and item.finance_release_status = 'released'
    order by item.payment_request_id, item.id
  loop
    perform public.create_payable_snapshot_internal(
      v_item.payment_request_id,
      'approval_batch_item',
      v_item.id,
      'closed',
      v_item.decided_by,
      v_item.decided_at,
      new.closed_by,
      'Authorized by closed approval batch ' || new.id::text
    );
  end loop;
  return new;
end
$function$;

do $postcheck$
declare
  v_definition text;
  v_trigger_definition text;
  v_security_definer boolean;
  v_volatility "char";
  v_returns_trigger boolean;
  v_language_name name;
  v_config text[];
  v_owner_name name;
  v_acl text;
  v_baseline migration_038_baseline%rowtype;
begin
  select * into strict v_baseline from migration_038_baseline;

  select
    pg_get_functiondef(function_info.oid),
    function_info.prosecdef,
    function_info.provolatile,
    function_info.prorettype = 'trigger'::regtype,
    language_info.lanname,
    function_info.proconfig,
    pg_get_userbyid(function_info.proowner),
    coalesce(function_info.proacl::text, '<default>')
  into
    v_definition,
    v_security_definer,
    v_volatility,
    v_returns_trigger,
    v_language_name,
    v_config,
    v_owner_name,
    v_acl
  from pg_proc function_info
  join pg_language language_info
    on language_info.oid = function_info.prolang
  where function_info.oid =
    'public.materialize_closed_batch_payable_snapshots()'::regprocedure;

  if v_definition is null
     or not v_security_definer
     or v_volatility <> 'v'
     or not v_returns_trigger
     or v_language_name <> 'plpgsql'
     or v_owner_name <> 'postgres'
     or v_config is distinct from
       array['search_path=public, pg_temp']::text[]
     or v_acl is distinct from v_baseline.target_acl then
    raise exception '038_postcheck: materializer attributes or grants changed';
  end if;

  if position('item.batch_id = new.id' in v_definition) = 0
     or position('item.removed_at is null' in v_definition) = 0
     or position('item.director_status = ''approved''' in v_definition) = 0
     or position(
       'item.finance_release_status = ''released''' in v_definition
     ) = 0
     or position(
       'create_payable_snapshot_internal' in v_definition
     ) = 0 then
    raise exception '038_postcheck: released-only materialization contract is incomplete';
  end if;

  select pg_get_triggerdef(trigger_info.oid, true)
    into v_trigger_definition
  from pg_trigger trigger_info
  where not trigger_info.tgisinternal
    and trigger_info.tgname = 'materialize_closed_batch_payable_snapshots'
    and trigger_info.tgrelid = 'public.approval_batches'::regclass
    and trigger_info.tgfoid =
      'public.materialize_closed_batch_payable_snapshots()'::regprocedure
    and trigger_info.tgenabled = 'O';
  if v_trigger_definition is distinct from v_baseline.trigger_definition then
    raise exception '038_postcheck: trigger definition changed';
  end if;

  if md5(pg_get_functiondef(
       'public.close_approval_batch(uuid)'::regprocedure
     )) <> v_baseline.close_definition_md5
     or md5(pg_get_functiondef(
       'public.create_payable_snapshot_internal(uuid,text,uuid,text,uuid,timestamptz,uuid,text)'::regprocedure
     )) <> v_baseline.canonical_definition_md5
     or md5(pg_get_functiondef(
       'public.approval_batch_item_release_block_reason(uuid)'::regprocedure
     )) <> v_baseline.block_reason_definition_md5
     or md5(pg_get_functiondef(
       'public.preview_approval_batch_close(uuid)'::regprocedure
     )) <> v_baseline.preview_definition_md5 then
    raise exception '038_postcheck: adjacent function changed during LOAD';
  end if;

  if v_baseline.payable_snapshots <>
       (select count(*) from public.payable_snapshots)
     or v_baseline.approval_batches <>
       (select count(*) from public.approval_batches)
     or v_baseline.approval_batch_items <>
       (select count(*) from public.approval_batch_items)
     or v_baseline.payment_layouts <>
       (select count(*) from public.payment_layouts)
     or v_baseline.payment_layout_lines <>
       (select count(*) from public.payment_layout_lines)
     or v_baseline.payment_receipts <>
       (select count(*) from public.payment_receipts)
     or v_baseline.notification_events <>
       (select count(*) from public.notification_events)
     or v_baseline.financial_outbox_events <>
       (select count(*) from public.financial_outbox_events)
     or v_baseline.delivery_attempts <>
       (select count(*) from public.financial_outbox_delivery_attempts) then
    raise exception '038_postcheck: business row counts changed during LOAD';
  end if;
end
$postcheck$;

commit;

select 'MIGRATION_038_POSTCHECK_PASS' as result;
