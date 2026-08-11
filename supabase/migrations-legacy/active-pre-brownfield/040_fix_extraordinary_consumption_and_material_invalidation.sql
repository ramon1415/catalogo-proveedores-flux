\set ON_ERROR_STOP on

begin;

set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $precheck$
declare
  v_consumer_oid oid :=
    to_regprocedure('public.extraordinary_consume_layout_line()');
  v_validator_oid oid :=
    to_regprocedure('public.extraordinary_validate_layout_line()');
  v_invalidator_oid oid :=
    to_regprocedure('public.extraordinary_invalidate_material_change()');
  v_ready_oid oid :=
    to_regprocedure('public.extraordinary_authorization_is_ready(uuid)');
  v_storage_oid oid :=
    to_regprocedure(
      'public.extraordinary_evidence_storage_allowed(text,boolean)'
    );
  v_trigger_definition text;
  v_source text;
begin
  if to_regclass(
       'public.payment_request_extraordinary_events'
     ) is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name =
           'payment_request_extraordinary_authorizations'
         and column_name = 'legacy_classified_at'
     ) then
    raise exception '040_precheck: migration 036 is not installed';
  end if;

  if v_ready_oid is null
     or v_validator_oid is null
     or v_consumer_oid is null
     or v_invalidator_oid is null then
    raise exception '040_precheck: migration 037 is not installed';
  end if;

  if to_regprocedure(
       'public.materialize_closed_batch_payable_snapshots()'
     ) is null
     or position(
       'item.finance_release_status = ''released'''
       in pg_get_functiondef(
         'public.materialize_closed_batch_payable_snapshots()'::regprocedure
       )
     ) = 0 then
    raise exception '040_precheck: migration 038 is not installed';
  end if;

  if v_storage_oid is null
     or not has_function_privilege(
       'authenticated',
       v_storage_oid,
       'EXECUTE'
     )
     or has_function_privilege('anon', v_storage_oid, 'EXECUTE')
     or exists (
       select 1
       from aclexplode(
         coalesce(
           (select proacl from pg_proc where oid = v_storage_oid),
           acldefault(
             'f',
             (select proowner from pg_proc where oid = v_storage_oid)
           )
         )
       ) acl
       where acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     )
     or obj_description(v_storage_oid, 'pg_proc') is distinct from
       'Authenticated requires EXECUTE because Storage RLS policies invoke this side-effect-free boolean helper. Authorization remains enforced inside the function and the policies.' then
    raise exception '040_precheck: migration 039 or its final ACL is absent';
  end if;

  if to_regprocedure(
       'public.extraordinary_authorization_can_consume_layout_line(uuid,uuid)'
     ) is not null then
    raise exception '040_precheck: partial or complete 040 helper exists';
  end if;

  if exists (
    select 1
    from public.payment_request_extraordinary_authorizations extraordinary_auth
    where extraordinary_auth.idempotency_key is not null
      and extraordinary_auth.status in ('draft', 'active')
  ) then
    raise exception
      '040_precheck: residual secure draft or active authorization exists';
  end if;

  if exists (
    select 1
    from public.extraordinary_payment_policies policy
    join public.companies company on company.id = policy.company_id
    where policy.enabled
      and lower(coalesce(company.name, '')) like '%operadora%'
  ) then
    raise exception
      '040_precheck: Operadora extraordinary policy is enabled';
  end if;

  if exists (
    select 1
    from pg_proc function_info
    where function_info.oid in (
      v_ready_oid,
      v_validator_oid,
      v_consumer_oid,
      v_invalidator_oid
    )
      and (
        pg_get_userbyid(function_info.proowner) <> 'postgres'
        or not function_info.prosecdef
        or function_info.proconfig is distinct from
          array['search_path=public, pg_temp']::text[]
      )
  ) then
    raise exception '040_precheck: 037 function attributes drifted';
  end if;

  if exists (
    select 1
    from (
      values
        (
          v_ready_oid,
          'fc799a1c1cb7c8f43602973d368bcdf5519c36fadbd47cfd7b00ce2c458fdd54'
        ),
        (
          v_validator_oid,
          '0743fa6050b9ea609e06f11710bb9c8f00365a289c99b24607b0947f85453926'
        ),
        (
          v_consumer_oid,
          'd822c1a097f18e7748b855fe24e1e149cd33131eee1a2bc1ff559bf922cc8cb6'
        ),
        (
          v_invalidator_oid,
          '1c9fb6835916977ba9107c031d0c0b838eb3317663a063deabbbf96206541ccf'
        )
    ) expected(function_oid, body_sha256)
    join pg_proc function_info
      on function_info.oid = expected.function_oid
    where encode(
      sha256(convert_to(function_info.prosrc, 'UTF8')),
      'hex'
    ) <> expected.body_sha256
  ) then
    raise exception '040_precheck: 037 function body hash drifted';
  end if;

  select prosrc into strict v_source
  from pg_proc
  where oid = v_validator_oid;

  if position('for update' in lower(v_source)) = 0
     or position(
       'extraordinary_authorization_is_ready'
       in lower(v_source)
     ) = 0 then
    raise exception '040_precheck: BEFORE validator drifted';
  end if;

  select prosrc into strict v_source
  from pg_proc
  where oid = v_consumer_oid;

  if position(
       'extraordinary_authorization_is_ready'
       in lower(v_source)
     ) = 0 then
    raise exception
      '040_precheck: vulnerable AFTER readiness recheck is absent';
  end if;

  select pg_get_triggerdef(trigger_info.oid)
  into strict v_trigger_definition
  from pg_trigger trigger_info
  where trigger_info.tgrelid =
      'public.payment_layout_lines'::regclass
    and trigger_info.tgname =
      'aa_validate_secure_extraordinary_layout_line'
    and not trigger_info.tgisinternal
    and trigger_info.tgenabled = 'O';

  if v_trigger_definition not like
       'CREATE TRIGGER aa_validate_secure_extraordinary_layout_line BEFORE INSERT ON public.payment_layout_lines%' then
    raise exception '040_precheck: BEFORE trigger drifted';
  end if;

  select pg_get_triggerdef(trigger_info.oid)
  into strict v_trigger_definition
  from pg_trigger trigger_info
  where trigger_info.tgrelid =
      'public.payment_layout_lines'::regclass
    and trigger_info.tgname =
      'zz_consume_secure_extraordinary_layout_line'
    and not trigger_info.tgisinternal
    and trigger_info.tgenabled = 'O';

  if v_trigger_definition not like
       'CREATE TRIGGER zz_consume_secure_extraordinary_layout_line AFTER INSERT ON public.payment_layout_lines%' then
    raise exception '040_precheck: AFTER consumer trigger drifted';
  end if;

  select pg_get_triggerdef(trigger_info.oid)
  into strict v_trigger_definition
  from pg_trigger trigger_info
  where trigger_info.tgrelid = 'public.payment_requests'::regclass
    and trigger_info.tgname =
      'invalidate_extraordinary_on_material_change'
    and not trigger_info.tgisinternal
    and trigger_info.tgenabled = 'O';

  if v_trigger_definition not like
       'CREATE TRIGGER invalidate_extraordinary_on_material_change AFTER UPDATE OF approval_material_updated_at ON public.payment_requests%' then
    raise exception
      '040_precheck: vulnerable material UPDATE OF trigger is absent';
  end if;

  if to_regprocedure(
       'public.extraordinary_guard_receipt_insert()'
     ) is null
     or to_regprocedure(
       'public.extraordinary_guard_layout_line_paid()'
     ) is null
     or to_regprocedure(
       'public.extraordinary_guard_request_paid()'
     ) is null
     or to_regprocedure(
       'public.extraordinary_authorization_state_guard()'
     ) is null then
    raise exception '040_precheck: extraordinary guards are incomplete';
  end if;
end
$precheck$;

create temp table migration_040_baseline
on commit drop
as
select
  (select count(*) from public.payment_requests) as requests,
  (select count(*) from public.payment_layouts) as layouts,
  (select count(*) from public.payment_layout_lines) as layout_lines,
  (select count(*) from public.payment_receipts) as receipts,
  (select count(*) from public.notification_events) as notifications,
  md5(coalesce((
    select string_agg(to_jsonb(plan)::text, '' order by plan.id)
    from public.payment_allocation_plans plan
  ), '')) as allocation_plans_hash,
  md5(coalesce((
    select string_agg(
      to_jsonb(reservation)::text,
      ''
      order by reservation.id
    )
    from public.payment_allocation_reservations reservation
  ), '')) as allocation_reservations_hash,
  md5(coalesce((
    select string_agg(to_jsonb(operation)::text, '' order by operation.id)
    from public.bank_payment_operations operation
  ), '')) as bank_operations_hash;

create function public.extraordinary_authorization_can_consume_layout_line(
  p_authorization_id uuid,
  p_layout_line_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.payment_request_extraordinary_authorizations extraordinary_auth
    join public.payment_requests request
      on request.id = extraordinary_auth.payment_request_id
     and request.company_id = extraordinary_auth.company_id
    join public.extraordinary_payment_policies policy
      on policy.company_id = extraordinary_auth.company_id
    join public.payment_layout_lines line
      on line.id = p_layout_line_id
     and line.payment_request_id = request.id
     and line.company_id = extraordinary_auth.company_id
    join public.payment_layouts layout
      on layout.id = line.layout_id
    where extraordinary_auth.id = p_authorization_id
      and extraordinary_auth.status = 'active'
      and extraordinary_auth.idempotency_key is not null
      and policy.enabled
      and policy.evidence_required
      and extraordinary_auth.evidence_verified_at is not null
      and extraordinary_auth.evidence_match_attested_at is not null
      and extraordinary_auth.valid_until > clock_timestamp()
      and extraordinary_auth.external_authorized_at >=
        request.approval_material_updated_at
      and request.currency = 'MXN'
      and request.amount_requested <= policy.max_amount_mxn
      and extraordinary_auth.category = any(policy.allowed_categories)
      and request.status::text in (
        'submitted', 'pending_approval', 'approved'
      )
      and line.status = 'included'
      and layout.status <> 'cancelled'
      and coalesce(
        public.approval_batch_budget_validation(request.id)->>'status',
        'bloqueado'
      ) = 'aprobable'
      and cardinality(
        public.payment_request_layout_missing_fields(request)
      ) = 0
      and not exists (
        select 1
        from public.payment_layout_lines other_line
        where other_line.payment_request_id = request.id
          and other_line.id <> line.id
      )
      and not exists (
        select 1
        from public.cash_funds cash_fund
        where cash_fund.payment_request_id = request.id
      )
      and not exists (
        select 1
        from public.payment_receipts receipt
        where receipt.payment_request_id = request.id
      )
      and not exists (
        select 1
        from public.payment_request_receipt_links receipt_link
        where receipt_link.payment_request_id = request.id
      )
      and not exists (
        select 1
        from public.payable_snapshots snapshot
        join public.payment_allocation_items item
          on item.snapshot_id = snapshot.id
        where snapshot.payment_request_id = request.id
      )
      and not exists (
        select 1
        from public.payable_snapshots snapshot
        join public.payment_allocation_movements movement
          on movement.snapshot_id = snapshot.id
        where snapshot.payment_request_id = request.id
      )
      and not exists (
        select 1
        from public.payable_snapshots snapshot
        join public.payment_allocation_items item
          on item.snapshot_id = snapshot.id
        join public.payment_allocation_reservations reservation
          on reservation.plan_id = item.plan_id
        where snapshot.payment_request_id = request.id
      )
      and not exists (
        select 1
        from public.payment_request_extraordinary_authorizations other_auth
        where other_auth.payment_request_id = request.id
          and other_auth.id <> extraordinary_auth.id
          and other_auth.idempotency_key is not null
          and other_auth.status in (
            'draft', 'active', 'consumed_pending_ratification'
          )
      )
      and not exists (
        select 1
        from public.approval_batch_items batch_item
        join public.approval_batches batch
          on batch.id = batch_item.batch_id
        where batch_item.payment_request_id = request.id
          and (
            (
              batch_item.removed_at is null
              and batch_item.director_status = 'rejected'
            )
            or batch.status in ('draft', 'submitted')
          )
      )
  );
$$;

alter function
  public.extraordinary_authorization_can_consume_layout_line(uuid,uuid)
  owner to postgres;
revoke all on function
  public.extraordinary_authorization_can_consume_layout_line(uuid,uuid)
  from public, anon, authenticated;
grant execute on function
  public.extraordinary_authorization_can_consume_layout_line(uuid,uuid)
  to service_role;

create or replace function public.extraordinary_validate_layout_line()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
begin
  if exists (
    select 1
    from public.payment_request_extraordinary_authorizations extraordinary_auth
    where extraordinary_auth.payment_request_id = new.payment_request_id
      and extraordinary_auth.idempotency_key is not null
      and extraordinary_auth.status in (
        'consumed_pending_ratification',
        'ratified',
        'disputed',
        'expired',
        'revoked'
      )
  ) then
    raise exception
      'extraordinary_authorization_already_consumed_or_closed';
  end if;

  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where payment_request_id = new.payment_request_id
    and status = 'active'
    and idempotency_key is not null
  order by authorized_at desc
  limit 1
  for update;

  if not found then
    if exists (
      select 1
      from public.payment_request_extraordinary_authorizations
      where payment_request_id = new.payment_request_id
        and idempotency_key is not null
    ) then
      raise exception 'secure_extraordinary_authorization_changed';
    end if;
    return new;
  end if;

  if v_authorization.company_id <> new.company_id then
    raise exception 'secure_extraordinary_company_mismatch';
  end if;

  if not exists (
    select 1
    from public.payment_requests request
    where request.id = new.payment_request_id
      and request.company_id = new.company_id
  ) then
    raise exception 'secure_extraordinary_request_mismatch';
  end if;

  if not exists (
    select 1
    from public.payment_layouts layout
    where layout.id = new.layout_id
      and layout.status <> 'cancelled'
  ) then
    raise exception 'secure_extraordinary_layout_not_available';
  end if;

  if new.status <> 'included' then
    raise exception 'secure_extraordinary_layout_line_not_includable';
  end if;

  if not public.extraordinary_authorization_is_ready(
    v_authorization.id
  ) then
    raise exception 'secure_extraordinary_authorization_not_ready';
  end if;

  return new;
end
$$;

alter function public.extraordinary_validate_layout_line() owner to postgres;
revoke all on function public.extraordinary_validate_layout_line()
  from public, anon, authenticated;
grant execute on function public.extraordinary_validate_layout_line()
  to service_role;

create or replace function public.extraordinary_consume_layout_line()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
  v_now timestamptz := clock_timestamp();
  v_updated integer;
begin
  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where payment_request_id = new.payment_request_id
    and status = 'active'
    and idempotency_key is not null
  order by authorized_at desc
  limit 1
  for update;

  if not found then
    return new;
  end if;

  if not public.extraordinary_authorization_can_consume_layout_line(
    v_authorization.id,
    new.id
  ) then
    raise exception
      'secure_extraordinary_authorization_not_consumable_for_layout_line';
  end if;

  perform set_config('app.extraordinary_internal', 'on', true);

  update public.payment_request_extraordinary_authorizations extraordinary_auth
  set status = 'consumed_pending_ratification',
      consumed_at = v_now,
      consumed_layout_id = new.layout_id,
      consumed_layout_line_id = new.id,
      updated_at = v_now
  where extraordinary_auth.id = v_authorization.id
    and extraordinary_auth.payment_request_id = new.payment_request_id
    and extraordinary_auth.company_id = new.company_id
    and extraordinary_auth.status = 'active'
    and extraordinary_auth.idempotency_key is not null;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception
      'secure_extraordinary_authorization_consumption_race';
  end if;

  perform public.extraordinary_append_event(
    v_authorization.id,
    'authorization_consumed',
    v_actor,
    'authorization-consumed:' || v_authorization.id::text,
    jsonb_build_object(
      'layout_id', new.layout_id,
      'layout_line_id', new.id,
      'status', 'consumed_pending_ratification'
    )
  );

  return new;
end
$$;

alter function public.extraordinary_consume_layout_line() owner to postgres;
revoke all on function public.extraordinary_consume_layout_line()
  from public, anon, authenticated;
grant execute on function public.extraordinary_consume_layout_line()
  to service_role;

drop trigger invalidate_extraordinary_on_material_change
  on public.payment_requests;

create trigger invalidate_extraordinary_on_material_change
after update on public.payment_requests
for each row
when (
  old.approval_material_updated_at
  is distinct from
  new.approval_material_updated_at
)
execute function public.extraordinary_invalidate_material_change();

do $postcheck$
declare
  v_consumer_source text;
  v_helper_source text;
  v_trigger_definition text;
  v_baseline migration_040_baseline%rowtype;
begin
  select * into strict v_baseline from migration_040_baseline;

  if v_baseline.requests <>
       (select count(*) from public.payment_requests)
     or v_baseline.layouts <>
       (select count(*) from public.payment_layouts)
     or v_baseline.layout_lines <>
       (select count(*) from public.payment_layout_lines)
     or v_baseline.receipts <>
       (select count(*) from public.payment_receipts)
     or v_baseline.notifications <>
       (select count(*) from public.notification_events)
     or v_baseline.allocation_plans_hash is distinct from md5(coalesce((
       select string_agg(to_jsonb(plan)::text, '' order by plan.id)
       from public.payment_allocation_plans plan
     ), ''))
     or v_baseline.allocation_reservations_hash is distinct from
       md5(coalesce((
         select string_agg(
           to_jsonb(reservation)::text,
           ''
           order by reservation.id
         )
         from public.payment_allocation_reservations reservation
       ), ''))
     or v_baseline.bank_operations_hash is distinct from md5(coalesce((
       select string_agg(
         to_jsonb(operation)::text,
         ''
         order by operation.id
       )
       from public.bank_payment_operations operation
     ), '')) then
    raise exception '040_postcheck: business data changed';
  end if;

  if exists (
    select 1
    from public.extraordinary_payment_policies policy
    join public.companies company on company.id = policy.company_id
    where policy.enabled
      and lower(coalesce(company.name, '')) like '%operadora%'
  ) then
    raise exception
      '040_postcheck: Operadora extraordinary policy is enabled';
  end if;

  select prosrc into strict v_consumer_source
  from pg_proc
  where oid =
    'public.extraordinary_consume_layout_line()'::regprocedure;

  if position(
       'extraordinary_authorization_is_ready'
       in lower(v_consumer_source)
     ) > 0
     or position(
       'extraordinary_authorization_can_consume_layout_line'
       in lower(v_consumer_source)
     ) = 0
     or position('get diagnostics' in lower(v_consumer_source)) = 0
     or position('v_updated <> 1' in lower(v_consumer_source)) = 0
     or position('consumed_layout_id = new.layout_id'
       in lower(v_consumer_source)) = 0
     or position('consumed_layout_line_id = new.id'
       in lower(v_consumer_source)) = 0
     or position('authorization_consumed'
       in lower(v_consumer_source)) = 0 then
    raise exception '040_postcheck: consumer contract is incomplete';
  end if;

  select prosrc into strict v_helper_source
  from pg_proc
  where oid =
    'public.extraordinary_authorization_can_consume_layout_line(uuid,uuid)'::regprocedure;

  if lower(v_helper_source) ~
       '\m(insert|update|delete|truncate|merge|execute|format)\M'
     or position('other_line.id <> line.id'
       in lower(v_helper_source)) = 0
     or position('payment_receipts' in lower(v_helper_source)) = 0
     or position('payment_request_receipt_links'
       in lower(v_helper_source)) = 0
     or position('payment_allocation_movements'
       in lower(v_helper_source)) = 0
     or position('payment_allocation_reservations'
       in lower(v_helper_source)) = 0 then
    raise exception '040_postcheck: post-insert predicate is unsafe';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.extraordinary_authorization_can_consume_layout_line(uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.extraordinary_authorization_can_consume_layout_line(uuid,uuid)',
       'EXECUTE'
     )
     or exists (
       select 1
       from aclexplode((
         select proacl
         from pg_proc
         where oid =
           'public.extraordinary_authorization_can_consume_layout_line(uuid,uuid)'::regprocedure
       )) acl
       where acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception '040_postcheck: internal helper ACL is too broad';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_info
    where trigger_info.tgrelid =
        'public.payment_layout_lines'::regclass
      and trigger_info.tgname =
        'aa_validate_secure_extraordinary_layout_line'
      and trigger_info.tgenabled = 'O'
      and not trigger_info.tgisinternal
  )
  or not exists (
    select 1
    from pg_trigger trigger_info
    where trigger_info.tgrelid =
        'public.payment_layout_lines'::regclass
      and trigger_info.tgname =
        'zz_consume_secure_extraordinary_layout_line'
      and trigger_info.tgenabled = 'O'
      and not trigger_info.tgisinternal
  ) then
    raise exception '040_postcheck: layout triggers are not enabled';
  end if;

  select pg_get_triggerdef(trigger_info.oid)
  into strict v_trigger_definition
  from pg_trigger trigger_info
  where trigger_info.tgrelid = 'public.payment_requests'::regclass
    and trigger_info.tgname =
      'invalidate_extraordinary_on_material_change'
    and not trigger_info.tgisinternal
    and trigger_info.tgenabled = 'O';

  if v_trigger_definition like '%UPDATE OF%'
     or v_trigger_definition not like
       'CREATE TRIGGER invalidate_extraordinary_on_material_change AFTER UPDATE ON public.payment_requests%'
     or v_trigger_definition not like
       '%WHEN ((old.approval_material_updated_at IS DISTINCT FROM new.approval_material_updated_at))%' then
    raise exception '040_postcheck: material trigger is not row-difference based';
  end if;

  if to_regprocedure(
       'public.extraordinary_guard_receipt_insert()'
     ) is null
     or to_regprocedure(
       'public.extraordinary_guard_layout_line_paid()'
     ) is null
     or to_regprocedure(
       'public.extraordinary_guard_request_paid()'
     ) is null
     or to_regprocedure(
       'public.extraordinary_authorization_state_guard()'
     ) is null then
    raise exception '040_postcheck: payment guards changed';
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
    raise exception '040_postcheck: Storage 039 contract changed';
  end if;

  raise notice 'MIGRATION_040_STATIC_POSTCHECK_PASS';
end
$postcheck$;

commit;
