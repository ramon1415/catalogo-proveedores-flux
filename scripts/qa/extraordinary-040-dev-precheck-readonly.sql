\set ON_ERROR_STOP on

set session characteristics as transaction read only;
begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $precheck$
declare
  v_consumer_source text;
  v_material_trigger text;
begin
  if current_setting('transaction_read_only') <> 'on' then
    raise exception '040_remote_precheck: transaction is not read only';
  end if;

  if to_regclass(
       'public.payment_request_extraordinary_events'
     ) is null
     or to_regprocedure(
       'public.extraordinary_authorization_is_ready(uuid)'
     ) is null
     or to_regprocedure(
       'public.extraordinary_validate_layout_line()'
     ) is null
     or to_regprocedure(
       'public.extraordinary_consume_layout_line()'
     ) is null
     or to_regprocedure(
       'public.extraordinary_invalidate_material_change()'
     ) is null
     or to_regprocedure(
       'public.materialize_closed_batch_payable_snapshots()'
     ) is null
     or to_regprocedure(
       'public.extraordinary_evidence_storage_allowed(text,boolean)'
     ) is null then
    raise exception '040_remote_precheck: migrations 036-039 are incomplete';
  end if;

  if to_regprocedure(
       'public.extraordinary_authorization_can_consume_layout_line(uuid,uuid)'
     ) is not null then
    raise exception '040_remote_precheck: 040 is already or partially installed';
  end if;

  if exists (
    select 1
    from public.payment_request_extraordinary_authorizations extraordinary_auth
    where extraordinary_auth.idempotency_key is not null
      and extraordinary_auth.status in ('draft', 'active')
  ) then
    raise exception
      '040_remote_precheck: residual secure draft or active authorization';
  end if;

  if exists (
    select 1
    from public.extraordinary_payment_policies policy
    join public.companies company on company.id = policy.company_id
    where policy.enabled
      and lower(coalesce(company.name, '')) like '%operadora%'
  ) then
    raise exception
      '040_remote_precheck: Operadora extraordinary policy is enabled';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.extraordinary_evidence_storage_allowed(text,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.extraordinary_evidence_storage_allowed(text,boolean)',
       'EXECUTE'
     )
     or (
       select count(*)
       from pg_policies policy
       where policy.schemaname = 'storage'
         and policy.tablename = 'objects'
         and lower(
           coalesce(policy.qual, '') ||
           coalesce(policy.with_check, '')
         ) like '%extraordinary-approval-evidence%'
     ) <> 2 then
    raise exception '040_remote_precheck: final 039 Storage ACL drifted';
  end if;

  select prosrc into strict v_consumer_source
  from pg_proc
  where oid =
    'public.extraordinary_consume_layout_line()'::regprocedure;

  if position(
       'extraordinary_authorization_is_ready'
       in lower(v_consumer_source)
     ) = 0 then
    raise exception
      '040_remote_precheck: vulnerable consumer recheck is absent';
  end if;

  select pg_get_triggerdef(trigger_info.oid)
  into strict v_material_trigger
  from pg_trigger trigger_info
  where trigger_info.tgrelid = 'public.payment_requests'::regclass
    and trigger_info.tgname =
      'invalidate_extraordinary_on_material_change'
    and not trigger_info.tgisinternal
    and trigger_info.tgenabled = 'O';

  if v_material_trigger not like
       '%AFTER UPDATE OF approval_material_updated_at%' then
    raise exception
      '040_remote_precheck: vulnerable UPDATE OF trigger is absent';
  end if;
end
$precheck$;

\pset format unaligned
\pset tuples_only on

select jsonb_build_object(
  'result', 'MEJ05_040_CATALOG_PRECHECK_PASS',
  'transaction_read_only', current_setting('transaction_read_only'),
  'secure_open_authorizations', (
    select count(*)
    from public.payment_request_extraordinary_authorizations
    where idempotency_key is not null
      and status in ('draft', 'active')
  ),
  'consumer_body_sha256', (
    select encode(sha256(convert_to(prosrc, 'UTF8')), 'hex')
    from pg_proc
    where oid =
      'public.extraordinary_consume_layout_line()'::regprocedure
  ),
  'validator_body_sha256', (
    select encode(sha256(convert_to(prosrc, 'UTF8')), 'hex')
    from pg_proc
    where oid =
      'public.extraordinary_validate_layout_line()'::regprocedure
  ),
  'invalidator_body_sha256', (
    select encode(sha256(convert_to(prosrc, 'UTF8')), 'hex')
    from pg_proc
    where oid =
      'public.extraordinary_invalidate_material_change()'::regprocedure
  ),
  'material_trigger', (
    select pg_get_triggerdef(trigger_info.oid)
    from pg_trigger trigger_info
    where trigger_info.tgrelid = 'public.payment_requests'::regclass
      and trigger_info.tgname =
        'invalidate_extraordinary_on_material_change'
      and not trigger_info.tgisinternal
  ),
  'dml', 0,
  'ddl', 0,
  'mutable_calls', 0
);

rollback;
