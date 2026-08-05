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
          '62f3833d88afd3d526d651cd23559fa585ffedf0c83b2f4e41bf43cf624750a1'
        ),
        (
          v_validator_oid,
          '3c4ef401c18704e1cc6c0eaadb3fa794ab0f7a04092726af6c6dc30a461fa6fe'
        ),
        (
          v_consumer_oid,
          '5bfbab08b6714ec0916360663761b70dd1eecc39f009283fd9e6b57345a395d9'
        ),
        (
          v_invalidator_oid,
          'b143ee4c78cc26393852158c0784fd4623bb7e15f485979fd47e28168dfcad70'
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
      and (
        not policy.evidence_required
        or (
          extraordinary_auth.evidence_verified_at is not null
          and extraordinary_auth.evidence_match_attested_at is not null
        )
      )
      and extraordinary_auth.valid_until > clock_timestamp()
      and extraordinary_auth.external_authorized_at >=
        request.approval_material_updated_at
      and request.currency = 'MXN'
      and (
        policy.max_amount_mxn is null
        or request.amount_requested <= policy.max_amount_mxn
      )
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


-- 01C authoritative release-prep addendum:
-- creation marks intent only, operational use requires an explicit profile
-- faculty, evidence is optional, and no notification table is touched.

alter table public.extraordinary_payment_policies
  alter column max_amount_mxn drop not null,
  alter column evidence_required set default false;

alter table public.extraordinary_payment_policies
  drop constraint extraordinary_payment_policies_amount_check,
  drop constraint extraordinary_payment_policies_evidence_check;

alter table public.extraordinary_payment_policies
  add constraint extraordinary_payment_policies_amount_check
    check (max_amount_mxn is null or max_amount_mxn > 0),
  add constraint extraordinary_payment_policies_evidence_check
    check (evidence_required = false);

alter table public.payment_requests
  add column extraordinary_state text not null default 'normal',
  add column extraordinary_requested_by uuid,
  add column extraordinary_requested_at timestamptz,
  add column extraordinary_intent_cancelled_by uuid,
  add column extraordinary_intent_cancelled_at timestamptz;

alter table public.payment_requests
  add constraint payment_requests_extraordinary_requested_by_fkey
    foreign key (extraordinary_requested_by) references public.profiles(id),
  add constraint payment_requests_extraordinary_cancelled_by_fkey
    foreign key (extraordinary_intent_cancelled_by) references public.profiles(id),
  add constraint payment_requests_extraordinary_state_check
    check (
      extraordinary_state in (
        'normal',
        'extraordinary_requested',
        'extraordinary_draft',
        'extraordinary_active',
        'consumed_pending_ratification',
        'ratified',
        'disputed',
        'revoked',
        'expired',
        'materially_invalidated'
      )
    );

alter table public.payment_request_extraordinary_authorizations
  add column authorization_medium text,
  add column authorization_reference text,
  add column director_absence_confirmed boolean not null default false,
  add column cannot_wait_confirmed boolean not null default false,
  add column ratification_cut_count integer not null default 0,
  add column ratification_first_cut_id uuid,
  add column ratification_last_cut_id uuid,
  add column ratification_overdue_at timestamptz;

alter table public.payment_request_extraordinary_authorizations
  add constraint payment_request_extraordinary_first_cut_fkey
    foreign key (ratification_first_cut_id) references public.approval_batches(id),
  add constraint payment_request_extraordinary_last_cut_fkey
    foreign key (ratification_last_cut_id) references public.approval_batches(id),
  add constraint payment_request_extraordinary_cut_count_check
    check (ratification_cut_count between 0 and 2147483647);

alter table public.payment_request_extraordinary_authorizations
  drop constraint payment_request_extraordinary_status_check,
  drop constraint payment_request_extraordinary_lifecycle_check;

alter table public.payment_request_extraordinary_authorizations
  add constraint payment_request_extraordinary_status_check
  check (
    status in (
      'draft',
      'active',
      'consumed_pending_ratification',
      'ratified',
      'revoked',
      'expired',
      'disputed',
      'materially_invalidated',
      'legacy_consumed_unverified',
      'legacy_quarantined'
    )
  ),
  add constraint payment_request_extraordinary_lifecycle_check
  check (
    status in (
      'legacy_consumed_unverified',
      'legacy_quarantined',
      'revoked'
    )
    or (
      company_id is not null
      and external_director_profile_id is not null
      and external_authorized_at is not null
      and valid_until > external_authorized_at
      and ratification_due_at > valid_until
      and idempotency_key is not null
      and char_length(idempotency_key) between 8 and 200
      and evidence_storage_bucket = 'extraordinary-authorizations'
      and evidence_storage_path is not null
      and (
        (
          evidence_type is null
          and evidence_sha256 is null
          and evidence_mime_type is null
          and evidence_size_bytes is null
          and evidence_verified_at is null
          and evidence_match_attested_by is null
          and evidence_match_attested_at is null
        )
        or (
          evidence_type is not null
          and evidence_sha256 is not null
          and evidence_mime_type is not null
          and evidence_size_bytes is not null
          and evidence_verified_at is not null
          and evidence_match_attested_by is not null
          and evidence_match_attested_at is not null
        )
      )
      and (
        status not in (
          'consumed_pending_ratification',
          'ratified',
          'disputed'
        )
        or (
          consumed_at is not null
          and consumed_layout_id is not null
          and consumed_layout_line_id is not null
        )
      )
      and (
        status <> 'ratified'
        or (ratified_by is not null and ratified_at is not null)
      )
      and (
        status <> 'disputed'
        or (
          disputed_by is not null
          and disputed_at is not null
          and nullif(btrim(dispute_reason), '') is not null
        )
      )
    )
  );

alter table public.payment_request_extraordinary_events
  drop constraint payment_request_extraordinary_events_type_check;

alter table public.payment_request_extraordinary_events
  add constraint payment_request_extraordinary_events_type_check
  check (
    event_type in (
      'legacy_consumed_classified',
      'legacy_quarantined',
      'legacy_revoked_preserved',
      'legacy_unsafe_rpc_disabled',
      'intent_requested',
      'intent_cancelled',
      'draft_created',
      'evidence_finalized',
      'authorization_activated',
      'authorization_consumed',
      'authorization_ratified',
      'authorization_disputed',
      'authorization_revoked',
      'authorization_expired',
      'material_change_invalidated',
      'ratification_overdue'
    )
  );

create table public.extraordinary_profile_faculties (
  profile_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  enabled boolean not null default false,
  granted_by uuid not null references public.profiles(id),
  granted_at timestamptz not null default clock_timestamp(),
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz,
  reason text not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint extraordinary_profile_faculties_pkey
    primary key (profile_id, company_id),
  constraint extraordinary_profile_faculties_reason_check
    check (char_length(btrim(reason)) between 10 and 500),
  constraint extraordinary_profile_faculties_revoke_check
    check (
      (enabled and revoked_by is null and revoked_at is null)
      or
      (not enabled and revoked_by is not null and revoked_at is not null)
    )
);

create table public.extraordinary_profile_faculty_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  company_id uuid not null references public.companies(id),
  enabled boolean not null,
  actor_profile_id uuid not null references public.profiles(id),
  reason text not null,
  occurred_at timestamptz not null default clock_timestamp()
);

alter table public.extraordinary_profile_faculties enable row level security;
alter table public.extraordinary_profile_faculty_events enable row level security;
revoke all on table public.extraordinary_profile_faculties
  from public, anon, authenticated, service_role;
revoke all on table public.extraordinary_profile_faculty_events
  from public, anon, authenticated, service_role;

create or replace function public.extraordinary_profile_has_explicit_faculty(
  p_profile_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.extraordinary_profile_faculties faculty
    join public.profiles profile
      on profile.id = faculty.profile_id
     and coalesce(profile.active, true)
    join public.profile_company_memberships membership
      on membership.profile_id = faculty.profile_id
     and membership.company_id = faculty.company_id
     and membership.active
    where faculty.profile_id = p_profile_id
      and faculty.company_id = p_company_id
      and faculty.enabled
      and faculty.revoked_at is null
  );
$$;

revoke all on function
  public.extraordinary_profile_has_explicit_faculty(uuid,uuid)
  from public, anon, authenticated;
grant execute on function
  public.extraordinary_profile_has_explicit_faculty(uuid,uuid)
  to authenticated, service_role;

create or replace function public.current_extraordinary_faculty_company_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(faculty.company_id order by faculty.company_id), '{}')
  from public.extraordinary_profile_faculties faculty
  where faculty.profile_id = public.current_profile_id()
    and public.extraordinary_profile_has_explicit_faculty(
      faculty.profile_id,
      faculty.company_id
    );
$$;

revoke all on function public.current_extraordinary_faculty_company_ids()
  from public, anon;
grant execute on function public.current_extraordinary_faculty_company_ids()
  to authenticated, service_role;

create or replace function public.list_extraordinary_profile_faculties()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_profile_id() is null
     or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'sysadmin_role_required';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'profile_id', faculty.profile_id,
        'profile_name', coalesce(profile.full_name, profile.email, 'Perfil'),
        'company_id', faculty.company_id,
        'company_name', company.name,
        'enabled', faculty.enabled,
        'reason', faculty.reason,
        'granted_at', faculty.granted_at,
        'revoked_at', faculty.revoked_at
      )
      order by company.name, coalesce(profile.full_name, profile.email)
    )
    from public.extraordinary_profile_faculties faculty
    join public.profiles profile on profile.id = faculty.profile_id
    join public.companies company on company.id = faculty.company_id
  ), '[]'::jsonb);
end
$$;

revoke all on function public.list_extraordinary_profile_faculties()
  from public, anon;
grant execute on function public.list_extraordinary_profile_faculties()
  to authenticated, service_role;

create or replace function public.set_extraordinary_profile_faculty(
  p_profile_id uuid,
  p_company_id uuid,
  p_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_enabled boolean := coalesce(p_enabled, false);
begin
  if v_actor is null
     or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'sysadmin_role_required';
  end if;
  if v_reason is null or char_length(v_reason) not between 10 and 500 then
    raise exception 'extraordinary_faculty_reason_required';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_profile_id and coalesce(profile.active, true)
  ) then
    raise exception 'active_profile_required';
  end if;
  if not exists (
    select 1
    from public.profile_company_memberships membership
    where membership.profile_id = p_profile_id
      and membership.company_id = p_company_id
      and membership.active
  ) then
    raise exception 'active_company_membership_required';
  end if;

  insert into public.extraordinary_profile_faculties(
    profile_id, company_id, enabled, granted_by, granted_at,
    revoked_by, revoked_at, reason, updated_at
  ) values (
    p_profile_id, p_company_id, v_enabled, v_actor, clock_timestamp(),
    case when v_enabled then null else v_actor end,
    case when v_enabled then null else clock_timestamp() end,
    v_reason, clock_timestamp()
  )
  on conflict (profile_id, company_id) do update
  set enabled = excluded.enabled,
      granted_by = case
        when excluded.enabled then v_actor
        else extraordinary_profile_faculties.granted_by
      end,
      granted_at = case
        when excluded.enabled then clock_timestamp()
        else extraordinary_profile_faculties.granted_at
      end,
      revoked_by = case when excluded.enabled then null else v_actor end,
      revoked_at = case
        when excluded.enabled then null else clock_timestamp()
      end,
      reason = excluded.reason,
      updated_at = clock_timestamp();

  insert into public.extraordinary_profile_faculty_events(
    profile_id, company_id, enabled, actor_profile_id, reason
  ) values (
    p_profile_id, p_company_id, v_enabled, v_actor, v_reason
  );

  return jsonb_build_object(
    'profile_id', p_profile_id,
    'company_id', p_company_id,
    'enabled', v_enabled
  );
end
$$;

revoke all on function
  public.set_extraordinary_profile_faculty(uuid,uuid,boolean,text)
  from public, anon;
grant execute on function
  public.set_extraordinary_profile_faculty(uuid,uuid,boolean,text)
  to authenticated, service_role;

create or replace function public.extraordinary_require_finance_for_company(
  p_company_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if v_actor is null then raise exception 'not_authenticated'; end if;
  if not public.extraordinary_profile_has_explicit_faculty(
    v_actor,
    p_company_id
  ) then
    raise exception 'explicit_extraordinary_faculty_required';
  end if;
  return v_actor;
end
$$;

create or replace function public.sync_payment_request_extraordinary_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state text;
begin
  v_state := case new.status
    when 'draft' then 'extraordinary_draft'
    when 'active' then 'extraordinary_active'
    when 'consumed_pending_ratification' then 'consumed_pending_ratification'
    when 'ratified' then 'ratified'
    when 'disputed' then 'disputed'
    when 'revoked' then 'revoked'
    when 'expired' then 'expired'
    when 'materially_invalidated' then 'materially_invalidated'
    else null
  end;
  if v_state is not null then
    update public.payment_requests
    set extraordinary_state = v_state,
        updated_at = clock_timestamp()
    where id = new.payment_request_id
      and extraordinary_state is distinct from v_state;
  end if;
  return new;
end
$$;

create trigger sync_payment_request_extraordinary_state
after insert or update of status
on public.payment_request_extraordinary_authorizations
for each row execute function public.sync_payment_request_extraordinary_state();

create or replace function public.create_payment_request_with_extraordinary_intent(
  p_proveedor_id uuid,
  p_company_id uuid,
  p_cost_center_id uuid,
  p_budget_category_id uuid,
  p_budget_month date,
  p_amount_requested numeric,
  p_currency text default 'MXN',
  p_exchange_rate numeric default 1,
  p_description text default null,
  p_notes text default null,
  p_requested_by uuid default null,
  p_is_extraordinary_adjustment boolean default false,
  p_approver_id uuid default null,
  p_approver_assignment_id uuid default null,
  p_extraordinary_requested boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_result jsonb;
  v_request_id uuid;
begin
  v_result := public.create_payment_request(
    p_proveedor_id,
    p_company_id,
    p_cost_center_id,
    p_budget_category_id,
    p_budget_month,
    p_amount_requested,
    p_currency,
    p_exchange_rate,
    p_description,
    p_notes,
    p_requested_by,
    p_is_extraordinary_adjustment,
    p_approver_id,
    p_approver_assignment_id
  );
  v_request_id := (v_result->>'payment_request_id')::uuid;

  if coalesce(p_extraordinary_requested, false) then
    if not public.extraordinary_profile_has_explicit_faculty(
      v_actor,
      p_company_id
    ) then
      raise exception 'explicit_extraordinary_faculty_required';
    end if;

    update public.payment_requests
    set extraordinary_state = 'extraordinary_requested',
        extraordinary_requested_by = v_actor,
        extraordinary_requested_at = clock_timestamp(),
        extraordinary_intent_cancelled_by = null,
        extraordinary_intent_cancelled_at = null
    where id = v_request_id;

    insert into public.payment_request_extraordinary_events(
      authorization_id,
      payment_request_id,
      company_id,
      event_type,
      actor_profile_id,
      idempotency_key,
      metadata
    ) values (
      null,
      v_request_id,
      p_company_id,
      'intent_requested',
      v_actor,
      'intent-requested:' || v_request_id::text,
      jsonb_build_object(
        'creation_mark_is_intent_only', true,
        'layout_bypass_enabled', false
      )
    );
  end if;

  return v_result || jsonb_build_object(
    'extraordinary_state',
    case when coalesce(p_extraordinary_requested, false)
      then 'extraordinary_requested'
      else 'normal'
    end
  );
end
$$;

revoke all on function public.create_payment_request_with_extraordinary_intent(
  uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,boolean
) from public, anon;
grant execute on function public.create_payment_request_with_extraordinary_intent(
  uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,boolean
) to authenticated, service_role;

create or replace function public.cancel_payment_request_extraordinary_intent(
  p_payment_request_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_draft public.payment_request_extraordinary_authorizations%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null then raise exception 'not_authenticated'; end if;
  if v_reason is null or char_length(v_reason) < 10 then
    raise exception 'extraordinary_intent_cancel_reason_required';
  end if;

  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  if v_request.requested_by <> v_actor
     and not public.extraordinary_profile_has_explicit_faculty(
       v_actor,
       v_request.company_id
     ) then
    raise exception 'extraordinary_intent_cancel_not_allowed';
  end if;
  if v_request.extraordinary_state not in (
    'extraordinary_requested', 'extraordinary_draft'
  ) then
    raise exception 'extraordinary_intent_not_cancellable';
  end if;

  select * into v_draft
  from public.payment_request_extraordinary_authorizations
  where payment_request_id = p_payment_request_id
    and status = 'draft'
  order by authorized_at desc, id desc
  limit 1
  for update;

  if found then
    perform set_config('app.extraordinary_internal', 'on', true);
    update public.payment_request_extraordinary_authorizations
    set status = 'revoked',
        revoked_by = v_actor,
        revoked_at = clock_timestamp(),
        revoke_reason = v_reason,
        updated_at = clock_timestamp()
    where id = v_draft.id;
  end if;

  update public.payment_requests
  set extraordinary_state = 'normal',
      extraordinary_intent_cancelled_by = v_actor,
      extraordinary_intent_cancelled_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = p_payment_request_id;

  insert into public.payment_request_extraordinary_events(
    authorization_id,
    payment_request_id,
    company_id,
    event_type,
    actor_profile_id,
    idempotency_key,
    metadata
  ) values (
    case when v_draft.id is null then null else v_draft.id end,
    p_payment_request_id,
    v_request.company_id,
    'intent_cancelled',
    v_actor,
    'intent-cancelled:' || p_payment_request_id::text || ':' ||
      extract(epoch from clock_timestamp())::bigint::text,
    jsonb_build_object('reason', v_reason, 'returned_to_normal', true)
  );

  return jsonb_build_object(
    'payment_request_id', p_payment_request_id,
    'extraordinary_state', 'normal'
  );
end
$$;

revoke all on function
  public.cancel_payment_request_extraordinary_intent(uuid,text)
  from public, anon;
grant execute on function
  public.cancel_payment_request_extraordinary_intent(uuid,text)
  to authenticated, service_role;

create or replace function public.begin_extraordinary_authorization(
  p_payment_request_id uuid,
  p_category text,
  p_reason text,
  p_external_director_profile_id uuid,
  p_external_authorized_at timestamptz,
  p_idempotency_key text,
  p_authorization_medium text,
  p_authorization_reference text,
  p_director_absence_confirmed boolean,
  p_cannot_wait_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_result jsonb;
  v_authorization_id uuid;
  v_medium text := nullif(btrim(coalesce(p_authorization_medium, '')), '');
  v_reference text := nullif(btrim(coalesce(p_authorization_reference, '')), '');
begin
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  if v_request.extraordinary_state <> 'extraordinary_requested' then
    raise exception 'extraordinary_intent_required_before_draft';
  end if;
  if not public.extraordinary_profile_has_explicit_faculty(
    public.current_profile_id(),
    v_request.company_id
  ) then
    raise exception 'explicit_extraordinary_faculty_required';
  end if;
  if v_medium is null or char_length(v_medium) > 100 then
    raise exception 'external_authorization_medium_required';
  end if;
  if v_reference is null or char_length(v_reference) < 8
     or char_length(v_reference) > 500 then
    raise exception 'external_authorization_reference_required';
  end if;
  if not coalesce(p_director_absence_confirmed, false) then
    raise exception 'director_absence_confirmation_required';
  end if;
  if not coalesce(p_cannot_wait_confirmed, false) then
    raise exception 'cannot_wait_confirmation_required';
  end if;

  v_result := public.begin_extraordinary_authorization(
    p_payment_request_id,
    p_category,
    p_reason,
    p_external_director_profile_id,
    p_external_authorized_at,
    p_idempotency_key
  );
  v_authorization_id := (v_result->>'authorization_id')::uuid;

  perform set_config('app.extraordinary_internal', 'on', true);
  update public.payment_request_extraordinary_authorizations
  set authorization_medium = v_medium,
      authorization_reference = v_reference,
      director_absence_confirmed = true,
      cannot_wait_confirmed = true,
      updated_at = clock_timestamp()
  where id = v_authorization_id
    and status = 'draft';

  return v_result || jsonb_build_object(
    'authorization_medium', v_medium,
    'evidence_optional', true,
    'creation_mark_was_intent_only', true
  );
end
$$;

revoke all on function
  public.begin_extraordinary_authorization(uuid,text,text,uuid,timestamptz,text)
  from public, anon, authenticated;
revoke all on function
  public.finalize_extraordinary_authorization(uuid,text,text,text,bigint,boolean,text)
  from public, anon, authenticated;
grant execute on function
  public.begin_extraordinary_authorization(
    uuid,text,text,uuid,timestamptz,text,text,text,boolean,boolean
  )
  to authenticated, service_role;

create or replace function public.activate_extraordinary_authorization(
  p_authorization_id uuid,
  p_evidence_type text,
  p_evidence_sha256 text,
  p_evidence_mime_type text,
  p_evidence_size_bytes bigint,
  p_evidence_matches_request boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
  v_request public.payment_requests%rowtype;
  v_policy public.extraordinary_payment_policies%rowtype;
  v_any_evidence boolean;
  v_all_evidence boolean;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where id = p_authorization_id
  for update;
  if not found then raise exception 'extraordinary_authorization_not_found'; end if;

  perform public.extraordinary_require_finance_for_company(
    v_authorization.company_id
  );
  if v_authorization.authorized_by <> v_actor then
    raise exception 'extraordinary_draft_owner_required';
  end if;

  v_any_evidence :=
    p_evidence_type is not null
    or p_evidence_sha256 is not null
    or p_evidence_mime_type is not null
    or p_evidence_size_bytes is not null
    or coalesce(p_evidence_matches_request, false);
  v_all_evidence :=
    nullif(btrim(coalesce(p_evidence_type, '')), '') is not null
    and nullif(btrim(coalesce(p_evidence_sha256, '')), '') is not null
    and nullif(btrim(coalesce(p_evidence_mime_type, '')), '') is not null
    and p_evidence_size_bytes is not null
    and coalesce(p_evidence_matches_request, false);

  if v_any_evidence and not v_all_evidence then
    raise exception 'optional_evidence_must_be_complete_when_present';
  end if;

  if v_all_evidence then
    return public.finalize_extraordinary_authorization(
      p_authorization_id,
      p_evidence_type,
      p_evidence_sha256,
      p_evidence_mime_type,
      p_evidence_size_bytes,
      p_evidence_matches_request,
      p_idempotency_key
    );
  end if;

  if v_authorization.status = 'active' then
    return jsonb_build_object(
      'authorization_id', v_authorization.id,
      'status', 'active',
      'evidence_optional', true,
      'idempotent_replay', true
    );
  end if;
  if v_authorization.status <> 'draft' then
    raise exception 'extraordinary_authorization_not_draft';
  end if;
  if nullif(btrim(coalesce(v_authorization.authorization_medium, '')), '') is null
     or nullif(btrim(coalesce(v_authorization.authorization_reference, '')), '') is null
     or not v_authorization.director_absence_confirmed
     or not v_authorization.cannot_wait_confirmed then
    raise exception 'extraordinary_governance_fields_incomplete';
  end if;

  select * into v_request
  from public.payment_requests
  where id = v_authorization.payment_request_id
  for update;
  select * into v_policy
  from public.extraordinary_payment_policies
  where company_id = v_authorization.company_id
  for share;

  if not found or not v_policy.enabled then
    raise exception 'extraordinary_policy_disabled';
  end if;
  if v_now >= v_authorization.valid_until
     or v_authorization.external_authorized_at <
       v_request.approval_material_updated_at then
    raise exception 'extraordinary_authorization_expired_or_stale';
  end if;
  if not public.extraordinary_profile_is_company_director(
    v_authorization.external_director_profile_id,
    v_authorization.company_id
  ) then
    raise exception 'external_director_not_active_for_company';
  end if;
  if v_request.currency <> 'MXN'
     or (
       v_policy.max_amount_mxn is not null
       and v_request.amount_requested > v_policy.max_amount_mxn
     )
     or v_authorization.category <> all(v_policy.allowed_categories) then
    raise exception 'extraordinary_policy_no_longer_matches';
  end if;
  if coalesce(
    public.approval_batch_budget_validation(v_request.id)->>'status',
    'bloqueado'
  ) <> 'aprobable' then
    raise exception 'budget_revalidation_required';
  end if;
  if public.approval_batch_request_has_any_execution_record(v_request.id)
     or exists (
       select 1 from public.payment_request_receipt_links link
       where link.payment_request_id = v_request.id
     ) then
    raise exception 'payment_request_already_executed';
  end if;

  perform set_config('app.extraordinary_internal', 'on', true);
  update public.payment_request_extraordinary_authorizations
  set status = 'active',
      updated_at = v_now
  where id = v_authorization.id
    and status = 'draft';
  if not found then raise exception 'extraordinary_authorization_changed'; end if;

  perform public.extraordinary_append_event(
    v_authorization.id,
    'authorization_activated',
    v_actor,
    'authorization-activated:' || v_authorization.id::text || ':' ||
      coalesce(nullif(btrim(p_idempotency_key), ''), 'without-evidence'),
    jsonb_build_object(
      'valid_until', v_authorization.valid_until,
      'evidence_optional', true,
      'evidence_present', false
    )
  );

  return jsonb_build_object(
    'authorization_id', v_authorization.id,
    'status', 'active',
    'valid_until', v_authorization.valid_until,
    'evidence_optional', true,
    'idempotent_replay', false
  );
end
$$;

revoke all on function public.activate_extraordinary_authorization(
  uuid,text,text,text,bigint,boolean,text
) from public, anon;
grant execute on function public.activate_extraordinary_authorization(
  uuid,text,text,text,bigint,boolean,text
) to authenticated, service_role;

create or replace function public.extraordinary_authorization_is_ready(
  p_authorization_id uuid
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
    join public.extraordinary_payment_policies policy
      on policy.company_id = extraordinary_auth.company_id
    where extraordinary_auth.id = p_authorization_id
      and extraordinary_auth.status = 'active'
      and request.extraordinary_state = 'extraordinary_active'
      and policy.enabled
      and (
        not policy.evidence_required
        or (
          extraordinary_auth.evidence_verified_at is not null
          and extraordinary_auth.evidence_match_attested_at is not null
        )
      )
      and extraordinary_auth.authorization_medium is not null
      and extraordinary_auth.authorization_reference is not null
      and extraordinary_auth.director_absence_confirmed
      and extraordinary_auth.cannot_wait_confirmed
      and extraordinary_auth.valid_until > clock_timestamp()
      and extraordinary_auth.external_authorized_at >=
        request.approval_material_updated_at
      and request.currency = 'MXN'
      and (
        policy.max_amount_mxn is null
        or request.amount_requested <= policy.max_amount_mxn
      )
      and extraordinary_auth.category = any(policy.allowed_categories)
      and request.status::text in (
        'submitted', 'pending_approval', 'approved'
      )
      and coalesce(
        public.approval_batch_budget_validation(request.id)->>'status',
        'bloqueado'
      ) = 'aprobable'
      and cardinality(
        public.payment_request_layout_missing_fields(request)
      ) = 0
      and not public.approval_batch_request_has_any_execution_record(request.id)
      and not exists (
        select 1
        from public.payment_request_receipt_links receipt_link
        where receipt_link.payment_request_id = request.id
      )
  );
$$;

create or replace function public.extraordinary_invalidate_material_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_authorization record;
begin
  if new.approval_material_updated_at is not distinct from
     old.approval_material_updated_at then
    return new;
  end if;
  perform set_config('app.extraordinary_internal', 'on', true);
  for v_authorization in
    update public.payment_request_extraordinary_authorizations extraordinary_auth
    set status = 'materially_invalidated',
        updated_at = clock_timestamp()
    where extraordinary_auth.payment_request_id = new.id
      and extraordinary_auth.idempotency_key is not null
      and extraordinary_auth.status in (
        'draft', 'active', 'consumed_pending_ratification', 'ratified'
      )
    returning extraordinary_auth.id
  loop
    perform public.extraordinary_append_event(
      v_authorization.id,
      'material_change_invalidated',
      public.current_profile_id(),
      'material-invalidated:' || v_authorization.id::text || ':' ||
        extract(epoch from new.approval_material_updated_at)::bigint::text,
      jsonb_build_object(
        'approval_material_updated_at', new.approval_material_updated_at
      )
    );
  end loop;
  return new;
end
$$;

create or replace function public.ratify_extraordinary_authorization(
  p_authorization_id uuid,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
  v_request public.payment_requests%rowtype;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then raise exception 'not_authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_authorization_id::text, 37037));
  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where id = p_authorization_id
  for update;
  if not found then raise exception 'extraordinary_authorization_not_found'; end if;
  if v_authorization.status = 'ratified'
     and v_authorization.ratified_by = v_actor then
    return jsonb_build_object(
      'authorization_id', v_authorization.id,
      'status', 'ratified',
      'ratified_at', v_authorization.ratified_at,
      'idempotent_replay', true
    );
  end if;
  if v_actor <> v_authorization.external_director_profile_id
     or not public.extraordinary_profile_is_company_director(
       v_actor,
       v_authorization.company_id
     ) then
    raise exception 'registered_external_director_required';
  end if;
  if v_authorization.status <> 'consumed_pending_ratification' then
    raise exception 'extraordinary_authorization_not_pending_ratification';
  end if;
  select * into v_request
  from public.payment_requests
  where id = v_authorization.payment_request_id;
  if v_authorization.external_authorized_at <
     v_request.approval_material_updated_at then
    raise exception 'extraordinary_authorization_materially_stale';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 200 then
    raise exception 'invalid_idempotency_key';
  end if;

  perform set_config('app.extraordinary_internal', 'on', true);
  update public.payment_request_extraordinary_authorizations
  set status = 'ratified',
      ratified_by = v_actor,
      ratified_at = v_now,
      ratification_note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = v_now
  where id = v_authorization.id
    and status = 'consumed_pending_ratification';

  perform public.extraordinary_append_event(
    v_authorization.id,
    'authorization_ratified',
    v_actor,
    'authorization-ratified:' || v_authorization.id::text || ':' || v_key,
    jsonb_build_object(
      'layout_id', v_authorization.consumed_layout_id,
      'layout_line_id', v_authorization.consumed_layout_line_id
    )
  );
  return jsonb_build_object(
    'authorization_id', v_authorization.id,
    'status', 'ratified',
    'ratified_at', v_now,
    'idempotent_replay', false
  );
end
$$;

create or replace function public.advance_extraordinary_ratification_cut()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_authorization record;
begin
  if new.status <> 'closed'
     or old.status = 'closed'
     or new.closed_at is null then
    return new;
  end if;

  perform set_config('app.extraordinary_internal', 'on', true);
  for v_authorization in
    update public.payment_request_extraordinary_authorizations extraordinary_auth
    set ratification_cut_count = extraordinary_auth.ratification_cut_count + 1,
        ratification_first_cut_id = coalesce(
          extraordinary_auth.ratification_first_cut_id,
          new.id
        ),
        ratification_last_cut_id = new.id,
        ratification_overdue_at = case
          when extraordinary_auth.ratification_cut_count + 1 >= 2
            then coalesce(
              extraordinary_auth.ratification_overdue_at,
              new.closed_at
            )
          else extraordinary_auth.ratification_overdue_at
        end,
        updated_at = clock_timestamp()
    where extraordinary_auth.company_id = new.company_id
      and extraordinary_auth.status = 'consumed_pending_ratification'
      and extraordinary_auth.consumed_at < new.closed_at
      and extraordinary_auth.ratification_last_cut_id is distinct from new.id
    returning extraordinary_auth.id,
              extraordinary_auth.ratification_cut_count,
              extraordinary_auth.ratification_overdue_at
  loop
    if v_authorization.ratification_cut_count = 2 then
      perform public.extraordinary_append_event(
        v_authorization.id,
        'ratification_overdue',
        null,
        'ratification-overdue:' || v_authorization.id::text,
        jsonb_build_object(
          'actual_company_cuts_elapsed', 2,
          'cut_id', new.id
        )
      );
    end if;
  end loop;
  return new;
end
$$;

create trigger advance_extraordinary_ratification_on_closed_cut
after update of status on public.approval_batches
for each row execute function public.advance_extraordinary_ratification_cut();

create or replace function public.list_extraordinary_regularizations(
  p_company_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if v_actor is null then raise exception 'not_authenticated'; end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'authorization_id', extraordinary_auth.id,
        'payment_request_id', extraordinary_auth.payment_request_id,
        'request_number', request.request_number,
        'company_id', extraordinary_auth.company_id,
        'amount', request.amount_requested,
        'currency', request.currency,
        'category', extraordinary_auth.category,
        'status', extraordinary_auth.status,
        'consumed_at', extraordinary_auth.consumed_at,
        'ratification_due_at', extraordinary_auth.ratification_due_at,
        'ratification_cut_count', extraordinary_auth.ratification_cut_count,
        'ratification_overdue_at', extraordinary_auth.ratification_overdue_at,
        'authorization_medium', extraordinary_auth.authorization_medium,
        'authorization_reference', extraordinary_auth.authorization_reference,
        'evidence_present', extraordinary_auth.evidence_verified_at is not null,
        'layout_id', extraordinary_auth.consumed_layout_id,
        'layout_line_id', extraordinary_auth.consumed_layout_line_id,
        'can_decide',
          v_actor = extraordinary_auth.external_director_profile_id
      )
      order by extraordinary_auth.ratification_due_at, extraordinary_auth.id
    )
    from public.payment_request_extraordinary_authorizations extraordinary_auth
    join public.payment_requests request
      on request.id = extraordinary_auth.payment_request_id
    where extraordinary_auth.status in (
      'consumed_pending_ratification', 'ratified', 'disputed'
    )
      and (p_company_id is null or extraordinary_auth.company_id = p_company_id)
      and (
        (
          v_actor = extraordinary_auth.external_director_profile_id
          and public.extraordinary_profile_is_company_director(
            v_actor,
            extraordinary_auth.company_id
          )
        )
        or public.extraordinary_profile_has_explicit_faculty(
          v_actor,
          extraordinary_auth.company_id
        )
      )
  ), '[]'::jsonb);
end
$$;

create or replace function public.get_extraordinary_authorization_evidence_access(
  p_authorization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
begin
  if v_actor is null then raise exception 'not_authenticated'; end if;
  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where id = p_authorization_id;
  if not found then raise exception 'extraordinary_authorization_not_found'; end if;

  if not (
    public.extraordinary_profile_has_explicit_faculty(
      v_actor,
      v_authorization.company_id
    )
    or v_actor = v_authorization.external_director_profile_id
  ) then
    raise exception 'extraordinary_evidence_access_denied';
  end if;
  if v_authorization.evidence_verified_at is null then
    raise exception 'extraordinary_evidence_not_finalized';
  end if;

  return jsonb_build_object(
    'authorization_id', v_authorization.id,
    'storage_bucket', v_authorization.evidence_storage_bucket,
    'storage_path', v_authorization.evidence_storage_path,
    'url_ttl_seconds', 120,
    'mime_type', v_authorization.evidence_mime_type,
    'size_bytes', v_authorization.evidence_size_bytes
  );
end
$$;

create or replace function public.extraordinary_evidence_storage_allowed(
  p_name text,
  p_write boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_authorization_id uuid;
  v_company_id uuid;
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
begin
  if v_actor is null
     or p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/evidence/[0-9a-f-]{36}$' then
    return false;
  end if;
  v_company_id := split_part(p_name, '/', 1)::uuid;
  v_authorization_id := split_part(p_name, '/', 2)::uuid;
  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where id = v_authorization_id
    and company_id = v_company_id
    and evidence_storage_path = p_name;
  if not found then return false; end if;

  if p_write then
    return v_authorization.status = 'draft'
      and v_authorization.authorized_by = v_actor
      and public.extraordinary_profile_has_explicit_faculty(
        v_actor,
        v_company_id
      );
  end if;
  return (
    v_actor = v_authorization.external_director_profile_id
    or public.extraordinary_profile_has_explicit_faculty(
      v_actor,
      v_company_id
    )
  );
end
$$;

create or replace function public.get_payment_request_execution_context(
  p_payment_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base jsonb;
  v_actor uuid := public.current_profile_id();
  v_policy public.extraordinary_payment_policies%rowtype;
  v_policy_found boolean := false;
  v_directors jsonb := '[]'::jsonb;
  v_authorization record;
  v_has_authorization boolean := false;
  v_has_open_authorization boolean := false;
  v_is_finance boolean := false;
  v_has_faculty boolean := false;
  v_request_state text := 'normal';
  v_can_begin boolean := false;
  v_block_reason text;
begin
  v_base := public.get_payment_request_execution_context_pre_037(
    p_payment_request_id
  );
  v_is_finance := coalesce((v_base->>'is_finance')::boolean, false);

  select request.extraordinary_state,
         public.extraordinary_profile_has_explicit_faculty(v_actor, request.company_id)
  into v_request_state, v_has_faculty
  from public.payment_requests request
  where request.id = p_payment_request_id;

  select policy.*
  into v_policy
  from public.extraordinary_payment_policies policy
  join public.payment_requests request
    on request.company_id = policy.company_id
  where request.id = p_payment_request_id;
  v_policy_found := found;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'profile_id', director.director_profile_id,
      'name', profile.full_name
    )
    order by profile.full_name, director.director_profile_id
  ), '[]'::jsonb)
  into v_directors
  from public.payment_requests request
  join public.company_directors director
    on director.company_id = request.company_id
   and director.active
  join public.profiles profile
    on profile.id = director.director_profile_id
   and profile.active
  where request.id = p_payment_request_id
    and public.extraordinary_profile_is_company_director(
      director.director_profile_id,
      request.company_id
    );

  select
    extraordinary_auth.*,
    author.full_name as authorized_by_name,
    external_director.full_name as external_director_name
  into v_authorization
  from public.payment_request_extraordinary_authorizations extraordinary_auth
  left join public.profiles author
    on author.id = extraordinary_auth.authorized_by
  left join public.profiles external_director
    on external_director.id = extraordinary_auth.external_director_profile_id
  where extraordinary_auth.payment_request_id = p_payment_request_id
  order by extraordinary_auth.authorized_at desc, extraordinary_auth.id desc
  limit 1;
  v_has_authorization := found;

  select exists (
    select 1
    from public.payment_request_extraordinary_authorizations extraordinary_auth
    where extraordinary_auth.payment_request_id = p_payment_request_id
      and extraordinary_auth.status in (
        'draft', 'active', 'consumed_pending_ratification'
      )
  )
  into v_has_open_authorization;

  v_can_begin :=
    v_has_faculty
    and v_request_state = 'extraordinary_requested'
    and v_policy_found
    and v_policy.enabled
    and jsonb_array_length(v_directors) > 0
    and not v_has_open_authorization;

  v_block_reason := case
    when not v_has_faculty then 'explicit_extraordinary_faculty_required'
    when v_request_state <> 'extraordinary_requested'
      then 'extraordinary_intent_required_before_draft'
    when v_has_open_authorization then 'extraordinary_authorization_already_open'
    when not v_policy_found or not v_policy.enabled
      then 'extraordinary_policy_disabled'
    when jsonb_array_length(v_directors) = 0
      then 'external_director_not_active_for_company'
    when not coalesce((v_base->>'budget_validation_current')::boolean, false)
      then 'budget_revalidation_required'
    else null
  end;

  return v_base || jsonb_build_object(
    'can_authorize_extraordinary', v_can_begin,
    'is_extraordinary_faculty', v_has_faculty,
    'extraordinary_state', v_request_state,
    'authorization_block_reason', v_block_reason,
    'extraordinary_policy', case
      when not v_policy_found then null
      else jsonb_build_object(
        'enabled', v_policy.enabled,
        'max_amount_mxn', v_policy.max_amount_mxn,
        'allowed_categories', v_policy.allowed_categories,
        'authorization_valid_hours', v_policy.authorization_valid_hours,
        'ratification_due_hours', v_policy.ratification_due_hours,
        'evidence_required', v_policy.evidence_required
      )
    end,
    'eligible_external_directors', v_directors,
    'extraordinary', case
      when not v_has_authorization then null
      else jsonb_build_object(
        'id', v_authorization.id,
        'secure_contract',
          v_authorization.external_director_profile_id is not null,
        'status', v_authorization.status,
        'category', v_authorization.category,
        'reason', v_authorization.reason,
        'authorized_by', v_authorization.authorized_by,
        'authorized_by_name', v_authorization.authorized_by_name,
        'authorized_at', v_authorization.authorized_at,
        'external_director_profile_id',
          v_authorization.external_director_profile_id,
        'external_director_name', v_authorization.external_director_name,
        'external_authorized_at', v_authorization.external_authorized_at,
        'authorization_medium', v_authorization.authorization_medium,
        'authorization_reference', v_authorization.authorization_reference,
        'director_absence_confirmed', v_authorization.director_absence_confirmed,
        'cannot_wait_confirmed', v_authorization.cannot_wait_confirmed,
        'valid_until', v_authorization.valid_until,
        'ratification_due_at', v_authorization.ratification_due_at,
        'evidence_type', v_authorization.evidence_type,
        'evidence_sha256', v_authorization.evidence_sha256,
        'evidence_mime_type', v_authorization.evidence_mime_type,
        'evidence_size_bytes', v_authorization.evidence_size_bytes,
        'evidence_finalized',
          v_authorization.evidence_verified_at is not null,
        'storage_bucket', case
          when v_authorization.status = 'draft'
            and (
              v_authorization.authorized_by = v_actor
            )
          then v_authorization.evidence_storage_bucket
          else null
        end,
        'storage_path', case
          when v_authorization.status = 'draft'
            and (
              v_authorization.authorized_by = v_actor
            )
          then v_authorization.evidence_storage_path
          else null
        end,
        'can_resume', v_authorization.status = 'draft'
          and (
            v_authorization.authorized_by = v_actor
          ),
        'authorization_current',
          v_authorization.status = 'active'
          and public.extraordinary_authorization_is_ready(v_authorization.id),
        'ready_for_layout',
          public.extraordinary_authorization_is_ready(v_authorization.id),
        'can_revoke',
          v_has_faculty
          and v_authorization.status in ('draft', 'active')
          and not coalesce((v_base->>'executed')::boolean, false),
        'consumed_at', v_authorization.consumed_at,
        'consumed_layout_id', v_authorization.consumed_layout_id,
        'ratification_cut_count', v_authorization.ratification_cut_count,
        'ratification_overdue_at', v_authorization.ratification_overdue_at,
        'ratified_at', v_authorization.ratified_at,
        'disputed_at', v_authorization.disputed_at,
        'dispute_reason', v_authorization.dispute_reason,
        'legacy_classification_reason',
          v_authorization.legacy_classification_reason
      )
    end
  );
end
$$;

do $authoritative_postcheck$
begin
  if exists (select 1 from public.extraordinary_profile_faculties)
     or exists (select 1 from public.extraordinary_profile_faculty_events) then
    raise exception '040_authoritative_postcheck: faculty rows were seeded';
  end if;
  if exists (
    select 1
    from public.payment_requests
    where extraordinary_state <> 'normal'
  ) then
    raise exception '040_authoritative_postcheck: release fabricated request state';
  end if;
  if (select count(*) from public.notification_events) <>
     (select notifications from migration_040_baseline) then
    raise exception '040_authoritative_postcheck: notification delta is not zero';
  end if;
  if has_function_privilege(
       'authenticated',
       'public.begin_extraordinary_authorization(uuid,text,text,uuid,timestamptz,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.finalize_extraordinary_authorization(uuid,text,text,text,bigint,boolean,text)',
       'EXECUTE'
     ) then
    raise exception '040_authoritative_postcheck: incomplete legacy RPC remains callable';
  end if;
  raise notice 'EXTRAORDINARY_CAN_BE_MARKED_AT_CREATION';
  raise notice 'CREATION_MARK_IS_INTENT_ONLY';
  raise notice 'NO_BYPASS_BEFORE_ACTIVATION';
  raise notice 'EXPLICIT_PROFILE_FACULTY_REQUIRED';
end
$authoritative_postcheck$;


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
         ) like '%extraordinary-authorizations%'
     ) <> 2 then
    raise exception '040_postcheck: Storage 039 contract changed';
  end if;

  raise notice 'MIGRATION_040_STATIC_POSTCHECK_PASS';
end
$postcheck$;

commit;
