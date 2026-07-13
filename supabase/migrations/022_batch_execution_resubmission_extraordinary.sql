-- Batch execution, rejected resubmission and extraordinary payment controls.
-- This migration is intentionally independent from payment-request approver routing.

begin;

do $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
begin
  foreach v_name in array array[
    'companies', 'profiles', 'roles', 'user_roles', 'proveedores',
    'payment_requests', 'payment_request_approvals', 'payment_layouts',
    'payment_layout_lines', 'payment_receipts', 'cash_funds',
    'company_bank_accounts', 'approval_batches', 'approval_batch_items',
    'company_directors', 'notification_events'
  ] loop
    if to_regclass('public.' || v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception '022_precheck: faltan dependencias requeridas: %', array_to_string(v_missing, ', ');
  end if;

  if to_regprocedure('public.approval_batch_require_actor()') is null
     or to_regprocedure('public.approval_batch_require_finance()') is null
     or to_regprocedure('public.approval_batch_request_open_elsewhere(uuid,uuid)') is null
     or to_regprocedure('public.insert_approval_batch_notification(text,text,uuid,text,text,uuid,text,text,text,jsonb,text,text)') is null then
    raise exception '022_precheck: migration 021 no esta instalada completamente';
  end if;
end
$$;

alter table public.payment_requests
  add column approval_material_updated_at timestamptz;

update public.payment_requests
set approval_material_updated_at = created_at
where approval_material_updated_at is null;

alter table public.payment_requests
  alter column approval_material_updated_at set default now(),
  alter column approval_material_updated_at set not null;

comment on column public.payment_requests.approval_material_updated_at is
  'Ultimo cambio de datos financieros materiales que exige una aprobacion posterior de Finanzas.';

create table public.approval_batch_company_settings (
  company_id uuid primary key references public.companies(id),
  regular_payments_require_closed_batch boolean not null default false,
  enforcement_started_at timestamptz,
  enabled_by uuid references public.profiles(id),
  enabled_at timestamptz,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint approval_batch_company_settings_enabled_check check (
    not regular_payments_require_closed_batch
    or (enforcement_started_at is not null and enabled_by is not null and enabled_at is not null)
  )
);

create table public.approval_batch_company_setting_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  previous_enabled boolean,
  new_enabled boolean not null,
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now()
);

create index approval_batch_company_setting_events_company_idx
  on public.approval_batch_company_setting_events(company_id, changed_at desc);

create table public.payment_request_extraordinary_authorizations (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests(id),
  category text not null,
  reason text not null,
  status text not null default 'active',
  authorized_by uuid not null references public.profiles(id),
  authorized_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_request_extraordinary_category_check check (
    category in (
      'operational_emergency',
      'urgent_reimbursement',
      'urgent_termination',
      'critical_service',
      'other'
    )
  ),
  constraint payment_request_extraordinary_reason_check check (
    char_length(btrim(reason)) >= 20
  ),
  constraint payment_request_extraordinary_status_check check (
    status in ('active', 'revoked')
  ),
  constraint payment_request_extraordinary_revoke_check check (
    (
      status = 'active'
      and revoked_by is null
      and revoked_at is null
      and revoke_reason is null
    )
    or (
      status = 'revoked'
      and revoked_by is not null
      and revoked_at is not null
      and nullif(btrim(revoke_reason), '') is not null
    )
  )
);

create unique index payment_request_extraordinary_active_uidx
  on public.payment_request_extraordinary_authorizations(payment_request_id)
  where status = 'active';

create index payment_request_extraordinary_request_idx
  on public.payment_request_extraordinary_authorizations(payment_request_id, created_at desc);

create or replace function public.set_batch_execution_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger set_approval_batch_company_settings_updated_at
  before update on public.approval_batch_company_settings
  for each row execute function public.set_batch_execution_updated_at();

create trigger set_payment_request_extraordinary_updated_at
  before update on public.payment_request_extraordinary_authorizations
  for each row execute function public.set_batch_execution_updated_at();

create or replace function public.mark_payment_request_material_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.approval_material_updated_at := clock_timestamp();
    return new;
  end if;

  if pg_trigger_depth() > 1
     and new.approval_material_updated_at is distinct from old.approval_material_updated_at then
    return new;
  end if;

  if row(
    old.provider_id,
    old.provider_bank_account_id,
    old.proveedor_id,
    old.company_id,
    old.cost_center_id,
    old.budget_category_id,
    old.amount_requested,
    old.currency,
    old.payment_method,
    old.company_bank_account_id,
    old.scheduled_payment_date,
    old.payment_reference,
    old.payment_concept
  ) is distinct from row(
    new.provider_id,
    new.provider_bank_account_id,
    new.proveedor_id,
    new.company_id,
    new.cost_center_id,
    new.budget_category_id,
    new.amount_requested,
    new.currency,
    new.payment_method,
    new.company_bank_account_id,
    new.scheduled_payment_date,
    new.payment_reference,
    new.payment_concept
  ) then
    new.approval_material_updated_at := clock_timestamp();
  else
    new.approval_material_updated_at := old.approval_material_updated_at;
  end if;
  return new;
end
$$;

create trigger mark_payment_request_material_change
  before insert or update
  on public.payment_requests
  for each row execute function public.mark_payment_request_material_change();

create or replace function public.mark_provider_payment_material_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if row(
    old.destination_type,
    old.clabe,
    old.cuenta_bancaria,
    old.convenio_number,
    old.beneficiary_name,
    old.banco
  ) is distinct from row(
    new.destination_type,
    new.clabe,
    new.cuenta_bancaria,
    new.convenio_number,
    new.beneficiary_name,
    new.banco
  ) then
    update public.payment_requests pr
    set approval_material_updated_at = clock_timestamp()
    where pr.proveedor_id = new.id
      and pr.status::text in ('submitted', 'pending_approval', 'approved', 'changes_requested')
      and not exists (
        select 1 from public.payment_layout_lines pll
        where pll.payment_request_id = pr.id
      )
      and not exists (
        select 1 from public.cash_funds cf
        where cf.payment_request_id = pr.id
      );
  end if;
  return new;
end
$$;

create trigger mark_provider_payment_material_change
  after update of destination_type, clabe, cuenta_bancaria, convenio_number,
    beneficiary_name, banco
  on public.proveedores
  for each row execute function public.mark_provider_payment_material_change();

create or replace function public.approval_batch_latest_finance_approval_at(
  p_payment_request_id uuid
)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select max(pra.created_at)
  from public.payment_request_approvals pra
  join public.roles r on r.id = pra.role_id
  where pra.payment_request_id = p_payment_request_id
    and pra.action in ('approved', 'exception_approved')
    and pra.to_status = 'approved'
    and lower(btrim(r.name)) = any (public.flux_finance_roles());
$$;

create or replace function public.approval_batch_request_has_current_finance_approval(
  p_payment_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.approval_batch_latest_finance_approval_at(pr.id) >= pr.approval_material_updated_at,
    false
  )
  from public.payment_requests pr
  where pr.id = p_payment_request_id;
$$;

create or replace function public.approval_batch_request_has_execution(
  p_payment_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (
      select 1
      from public.payment_layout_lines pll
      join public.payment_layouts pl on pl.id = pll.layout_id
      where pll.payment_request_id = p_payment_request_id
        and pll.status <> 'bank_rejected'
        and pl.status <> 'cancelled'
    )
    or exists (
      select 1 from public.cash_funds cf
      where cf.payment_request_id = p_payment_request_id
    )
    or exists (
      select 1 from public.payment_receipts prc
      where prc.payment_request_id = p_payment_request_id
    );
$$;

create or replace function public.approval_batch_request_has_any_execution_record(
  p_payment_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (
      select 1 from public.payment_layout_lines pll
      where pll.payment_request_id = p_payment_request_id
    )
    or exists (
      select 1 from public.cash_funds cf
      where cf.payment_request_id = p_payment_request_id
    )
    or exists (
      select 1 from public.payment_receipts prc
      where prc.payment_request_id = p_payment_request_id
    );
$$;

create or replace function public.approval_batch_request_has_active_extraordinary(
  p_payment_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.payment_request_extraordinary_authorizations prea
    where prea.payment_request_id = p_payment_request_id
      and prea.status = 'active'
  );
$$;

alter table public.approval_batch_company_settings enable row level security;
alter table public.approval_batch_company_setting_events enable row level security;
alter table public.payment_request_extraordinary_authorizations enable row level security;

create policy approval_batch_company_settings_read_finance
  on public.approval_batch_company_settings
  for select to authenticated
  using (public.current_user_has_role(public.flux_finance_roles()));

create policy approval_batch_company_setting_events_read_finance
  on public.approval_batch_company_setting_events
  for select to authenticated
  using (public.current_user_has_role(public.flux_finance_roles()));

create policy payment_request_extraordinary_read_authorized
  on public.payment_request_extraordinary_authorizations
  for select to authenticated
  using (
    public.current_user_has_role(public.flux_finance_roles())
    or exists (
      select 1
      from public.payment_requests pr
      where pr.id = payment_request_extraordinary_authorizations.payment_request_id
        and pr.requested_by = public.current_profile_id()
    )
    or exists (
      select 1
      from public.payment_requests pr
      join public.company_directors cd
        on cd.company_id = pr.company_id
       and cd.active
      where pr.id = payment_request_extraordinary_authorizations.payment_request_id
        and cd.director_profile_id = public.current_profile_id()
    )
  );

revoke all on table public.approval_batch_company_settings from public, anon, authenticated;
revoke all on table public.approval_batch_company_setting_events from public, anon, authenticated;
revoke all on table public.payment_request_extraordinary_authorizations from public, anon, authenticated;
grant select on table public.approval_batch_company_settings to authenticated;
grant select on table public.approval_batch_company_setting_events to authenticated;
grant select on table public.payment_request_extraordinary_authorizations to authenticated;

create or replace function public.set_approval_batch_company_enforcement(
  p_company_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_existing public.approval_batch_company_settings%rowtype;
  v_row public.approval_batch_company_settings%rowtype;
  v_previous_enabled boolean;
begin
  v_actor := public.approval_batch_require_finance();
  if p_company_id is null or p_enabled is null then
    raise exception 'company_and_enabled_required';
  end if;
  if not exists (
    select 1 from public.companies c
    where c.id = p_company_id and coalesce(c.active, true)
  ) then
    raise exception 'company_not_found_or_inactive';
  end if;
  if p_enabled and not exists (
    select 1
    from public.company_directors cd
    join public.profiles p on p.id = cd.director_profile_id
    where cd.company_id = p_company_id
      and cd.active
      and coalesce(p.active, true)
      and exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.profile_id = cd.director_profile_id
          and lower(btrim(r.name)) = any (public.approval_batch_direction_roles())
      )
  ) then
    raise exception 'company_director_required';
  end if;

  select * into v_existing
  from public.approval_batch_company_settings
  where company_id = p_company_id
  for update;
  v_previous_enabled := case
    when found then v_existing.regular_payments_require_closed_batch
    else null
  end;

  if not found then
    insert into public.approval_batch_company_settings(
      company_id,
      regular_payments_require_closed_batch,
      enforcement_started_at,
      enabled_by,
      enabled_at,
      updated_by
    ) values (
      p_company_id,
      p_enabled,
      case when p_enabled then now() else null end,
      case when p_enabled then v_actor else null end,
      case when p_enabled then now() else null end,
      v_actor
    )
    returning * into v_row;
  else
    update public.approval_batch_company_settings
    set regular_payments_require_closed_batch = p_enabled,
        enforcement_started_at = case
          when p_enabled and not v_existing.regular_payments_require_closed_batch then now()
          when p_enabled then v_existing.enforcement_started_at
          else null
        end,
        enabled_by = case
          when p_enabled and not v_existing.regular_payments_require_closed_batch then v_actor
          when p_enabled then v_existing.enabled_by
          else null
        end,
        enabled_at = case
          when p_enabled and not v_existing.regular_payments_require_closed_batch then now()
          when p_enabled then v_existing.enabled_at
          else null
        end,
        updated_by = v_actor,
        updated_at = now()
    where company_id = p_company_id
    returning * into v_row;
  end if;

  if v_previous_enabled is distinct from p_enabled then
    insert into public.approval_batch_company_setting_events(
      company_id,
      previous_enabled,
      new_enabled,
      changed_by
    ) values (
      p_company_id,
      v_previous_enabled,
      p_enabled,
      v_actor
    );
  end if;

  return jsonb_build_object(
    'company_id', v_row.company_id,
    'regular_payments_require_closed_batch', v_row.regular_payments_require_closed_batch,
    'enforcement_started_at', v_row.enforcement_started_at,
    'updated_at', v_row.updated_at
  );
end
$$;

create or replace function public.authorize_payment_request_extraordinary(
  p_payment_request_id uuid,
  p_category text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_request public.payment_requests%rowtype;
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  v_actor := public.approval_batch_require_finance();
  if v_category not in (
    'operational_emergency',
    'urgent_reimbursement',
    'urgent_termination',
    'critical_service',
    'other'
  ) then
    raise exception 'invalid_extraordinary_category';
  end if;
  if v_reason is null or char_length(v_reason) < 20 then
    raise exception 'extraordinary_reason_too_short';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_payment_request_id::text, 21021));
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  if v_request.status::text <> 'approved' then
    raise exception 'payment_request_must_be_finance_approved';
  end if;
  if lower(v_request.request_type::text) in ('payroll', 'nomina') then
    raise exception 'payroll_extraordinary_not_supported';
  end if;
  if not public.approval_batch_request_has_current_finance_approval(v_request.id) then
    raise exception 'finance_reapproval_required';
  end if;
  if public.approval_batch_request_has_any_execution_record(v_request.id) then
    raise exception 'payment_request_already_executed';
  end if;
  if exists (
    select 1 from public.payment_request_extraordinary_authorizations prea
    where prea.payment_request_id = v_request.id and prea.status = 'active'
  ) then
    raise exception 'extraordinary_authorization_already_active';
  end if;
  if exists (
    select 1
    from public.approval_batch_items abi
    where abi.payment_request_id = v_request.id
      and abi.removed_at is null
      and abi.director_status = 'rejected'
  ) then
    raise exception 'direction_rejected_request_cannot_be_extraordinary';
  end if;
  if exists (
    select 1
    from public.approval_batch_items abi
    join public.approval_batches ab on ab.id = abi.batch_id
    where abi.payment_request_id = v_request.id
      and abi.removed_at is null
      and abi.director_status = 'approved'
      and ab.status in ('approved', 'partially_approved', 'closed')
  ) then
    raise exception 'batch_approved_request_cannot_be_extraordinary';
  end if;
  if exists (
    select 1
    from public.approval_batch_items abi
    join public.approval_batches ab on ab.id = abi.batch_id
    where abi.payment_request_id = v_request.id
      and abi.removed_at is null
      and ab.status = 'submitted'
  ) then
    raise exception 'submitted_batch_request_cannot_be_extraordinary';
  end if;
  if exists (
    select 1
    from public.approval_batch_items abi
    join public.approval_batches ab on ab.id = abi.batch_id
    where abi.payment_request_id = v_request.id
      and abi.removed_at is null
      and ab.status = 'draft'
  ) then
    raise exception 'remove_request_from_draft_batch_first';
  end if;

  insert into public.payment_request_extraordinary_authorizations(
    payment_request_id,
    category,
    reason,
    authorized_by,
    authorized_at
  ) values (
    v_request.id,
    v_category,
    v_reason,
    v_actor,
    now()
  )
  returning id into v_id;

  return jsonb_build_object(
    'authorization_id', v_id,
    'payment_request_id', v_request.id,
    'status', 'active',
    'category', v_category,
    'reason', v_reason
  );
end
$$;

create or replace function public.revoke_payment_request_extraordinary(
  p_payment_request_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  v_actor := public.approval_batch_require_finance();
  if v_reason is null then raise exception 'revoke_reason_required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_payment_request_id::text, 21021));
  if public.approval_batch_request_has_any_execution_record(p_payment_request_id) then
    raise exception 'executed_extraordinary_cannot_be_revoked';
  end if;

  select id into v_id
  from public.payment_request_extraordinary_authorizations
  where payment_request_id = p_payment_request_id
    and status = 'active'
  order by created_at desc
  limit 1
  for update;
  if v_id is null then raise exception 'active_extraordinary_authorization_not_found'; end if;

  update public.payment_request_extraordinary_authorizations
  set status = 'revoked',
      revoked_by = v_actor,
      revoked_at = now(),
      revoke_reason = v_reason,
      updated_at = now()
  where id = v_id;

  return jsonb_build_object(
    'authorization_id', v_id,
    'payment_request_id', p_payment_request_id,
    'status', 'revoked'
  );
end
$$;

create or replace function public.approval_batch_request_base_eligible(
  p_payment_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.payment_requests pr
    where pr.id = p_payment_request_id
      and pr.status::text = 'approved'
      and pr.company_id is not null
      and public.approval_batch_request_has_current_finance_approval(pr.id)
      and not public.approval_batch_request_has_active_extraordinary(pr.id)
      and not public.approval_batch_request_has_execution(pr.id)
      and not exists (
        select 1
        from public.approval_batch_items abi
        join public.approval_batches ab on ab.id = abi.batch_id
        where abi.payment_request_id = pr.id
          and abi.removed_at is null
          and abi.director_status = 'approved'
          and ab.status in ('approved', 'partially_approved', 'closed')
      )
      and not exists (
        select 1
        from public.approval_batch_items abi
        where abi.payment_request_id = pr.id
          and abi.removed_at is null
          and abi.director_status = 'rejected'
          and abi.rebatch_status = 'blocked'
      )
  );
$$;

create or replace function public.release_and_rebatch_rejected_request(
  p_rejected_item_id uuid,
  p_correction_note text,
  p_target_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_note text := nullif(btrim(coalesce(p_correction_note, '')), '');
  v_item public.approval_batch_items%rowtype;
  v_source_batch public.approval_batches%rowtype;
  v_target_batch public.approval_batches%rowtype;
  v_request public.payment_requests%rowtype;
  v_payment_request_id uuid;
  v_new_item_id uuid;
  v_finance_approval_at timestamptz;
begin
  v_actor := public.approval_batch_require_finance();
  if v_note is null or char_length(v_note) < 10 then
    raise exception 'rebatch_correction_note_too_short';
  end if;

  select payment_request_id into v_payment_request_id
  from public.approval_batch_items
  where id = p_rejected_item_id;
  if not found then raise exception 'rejected_batch_item_not_found'; end if;

  if p_target_batch_id is not null then
    select * into v_target_batch
    from public.approval_batches
    where id = p_target_batch_id
    for update;
    if not found then raise exception 'target_batch_not_found'; end if;
    if v_target_batch.status <> 'draft' then raise exception 'target_batch_must_be_draft'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_payment_request_id::text, 21021));

  select * into v_item
  from public.approval_batch_items
  where id = p_rejected_item_id
    and payment_request_id = v_payment_request_id
  for update;
  if not found then raise exception 'rejected_batch_item_not_found'; end if;

  select * into v_source_batch
  from public.approval_batches
  where id = v_item.batch_id
  for update;
  select * into v_request
  from public.payment_requests
  where id = v_item.payment_request_id
  for update;

  if v_item.removed_at is not null
     or v_item.director_status <> 'rejected'
     or v_item.rebatch_status <> 'blocked' then
    raise exception 'rejected_batch_item_not_blocked';
  end if;
  if v_source_batch.status not in ('partially_approved', 'closed') then
    raise exception 'source_batch_not_decided';
  end if;
  if public.approval_batch_request_has_any_execution_record(v_request.id) then
    raise exception 'payment_request_already_executed';
  end if;
  if public.approval_batch_request_has_active_extraordinary(v_request.id) then
    raise exception 'extraordinary_request_cannot_be_rebatched';
  end if;

  v_finance_approval_at := public.approval_batch_latest_finance_approval_at(v_request.id);
  if v_finance_approval_at is null
     or v_finance_approval_at < v_request.approval_material_updated_at then
    raise exception 'finance_reapproval_required';
  end if;
  if public.approval_batch_request_open_elsewhere(v_request.id, p_target_batch_id) then
    raise exception 'payment_request_in_another_open_batch';
  end if;

  if p_target_batch_id is not null then
    if v_target_batch.company_id <> v_request.company_id then
      raise exception 'target_batch_company_mismatch';
    end if;
    if exists (
      select 1 from public.approval_batch_items abi
      where abi.batch_id = p_target_batch_id
        and abi.payment_request_id = v_request.id
        and abi.removed_at is null
    ) then
      raise exception 'payment_request_already_in_target_batch';
    end if;

    insert into public.approval_batch_items(
      batch_id,
      payment_request_id,
      finance_reviewed_by,
      finance_reviewed_at
    ) values (
      p_target_batch_id,
      v_request.id,
      v_actor,
      v_finance_approval_at
    )
    returning id into v_new_item_id;
  end if;

  update public.approval_batch_items
  set rebatch_status = 'released',
      rebatch_released_by = v_actor,
      rebatch_released_at = now(),
      rebatch_release_note = v_note
  where id = v_item.id;

  return jsonb_build_object(
    'rejected_item_id', v_item.id,
    'payment_request_id', v_request.id,
    'rebatch_status', 'released',
    'target_batch_id', p_target_batch_id,
    'new_item_id', v_new_item_id
  );
end
$$;

create or replace function public.approval_batch_assert_execution_authorized()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_item_status text;
  v_batch_status text;
  v_enforced boolean := false;
  v_enforcement_started_at timestamptz;
  v_extraordinary_authorized_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.payment_request_id::text, 21021));
  select * into v_request
  from public.payment_requests
  where id = new.payment_request_id
  for update;
  if not found then raise exception 'payment_request_not_found'; end if;

  select prea.authorized_at
    into v_extraordinary_authorized_at
  from public.payment_request_extraordinary_authorizations prea
  where prea.payment_request_id = v_request.id
    and prea.status = 'active'
  order by prea.authorized_at desc
  limit 1;

  if v_extraordinary_authorized_at is not null then
    if v_extraordinary_authorized_at < v_request.approval_material_updated_at
       or not public.approval_batch_request_has_current_finance_approval(v_request.id) then
      raise exception 'finance_reapproval_required';
    end if;
    if exists (
      select 1 from public.approval_batch_items abi
      where abi.payment_request_id = v_request.id
        and abi.removed_at is null
        and abi.director_status = 'rejected'
    ) then
      raise exception 'direction_rejected_request_cannot_execute';
    end if;
    if exists (
      select 1
      from public.approval_batch_items abi
      join public.approval_batches ab on ab.id = abi.batch_id
      where abi.payment_request_id = v_request.id
        and abi.removed_at is null
        and ab.status in ('draft', 'submitted')
    ) then
      raise exception 'open_batch_blocks_extraordinary_execution';
    end if;
    return new;
  end if;

  select regular_payments_require_closed_batch, enforcement_started_at
    into v_enforced, v_enforcement_started_at
  from public.approval_batch_company_settings
  where company_id = v_request.company_id;
  v_enforced := coalesce(v_enforced, false)
    and v_enforcement_started_at is not null
    and v_request.created_at >= v_enforcement_started_at;

  select abi.director_status, ab.status
    into v_item_status, v_batch_status
  from public.approval_batch_items abi
  join public.approval_batches ab on ab.id = abi.batch_id
  where abi.payment_request_id = v_request.id
    and abi.removed_at is null
  order by abi.created_at desc, abi.id desc
  limit 1;

  if not v_enforced then
    if not found then return new; end if;
    if v_item_status <> 'approved'
       or v_batch_status not in ('approved', 'partially_approved', 'closed') then
      raise exception 'batch_authorization_required';
    end if;
    return new;
  end if;

  if not public.approval_batch_request_has_current_finance_approval(v_request.id) then
    raise exception 'finance_reapproval_required';
  end if;
  if v_item_status is null
     or v_item_status <> 'approved'
     or v_batch_status <> 'closed' then
    raise exception 'closed_batch_authorization_required';
  end if;
  return new;
end
$$;

create or replace function public.close_approval_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_status text;
  v_pending integer;
  v_approved integer;
  v_rejected integer;
  v_totals jsonb;
begin
  v_actor := public.approval_batch_require_finance();
  select status into v_status
  from public.approval_batches
  where id = p_batch_id
  for update;
  if v_status is null then raise exception 'batch_not_found'; end if;
  if v_status not in ('approved', 'partially_approved') then
    raise exception 'batch_not_ready_to_close';
  end if;

  select
    count(*) filter (where director_status = 'pending'),
    count(*) filter (where director_status = 'approved'),
    count(*) filter (where director_status = 'rejected')
  into v_pending, v_approved, v_rejected
  from public.approval_batch_items
  where batch_id = p_batch_id and removed_at is null;

  if v_pending > 0 then raise exception 'batch_has_pending_items'; end if;
  if v_approved = 0 then raise exception 'batch_requires_at_least_one_approved_item'; end if;

  update public.approval_batches
  set status = 'closed', closed_by = v_actor, closed_at = now()
  where id = p_batch_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'currency', totals.currency,
    'amount', totals.amount
  ) order by totals.currency), '[]'::jsonb)
    into v_totals
  from (
    select coalesce(nullif(upper(btrim(pr.currency)), ''), 'MXN') as currency,
           sum(pr.amount_requested) as amount
    from public.approval_batch_items abi
    join public.payment_requests pr on pr.id = abi.payment_request_id
    where abi.batch_id = p_batch_id
      and abi.removed_at is null
      and abi.director_status = 'approved'
    group by coalesce(nullif(upper(btrim(pr.currency)), ''), 'MXN')
  ) totals;
  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'closed',
    'approved_released_count', v_approved,
    'rejected_blocked_count', v_rejected,
    'totals_by_currency', v_totals
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
  v_actor uuid;
  v_request public.payment_requests%rowtype;
  v_extra record;
  v_batch record;
  v_is_finance boolean;
  v_executed boolean;
  v_finance_current boolean;
  v_can_authorize boolean;
  v_block_reason text;
begin
  v_actor := public.approval_batch_require_actor();
  v_is_finance := public.current_user_has_role(public.flux_finance_roles());
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id;
  if not found then raise exception 'payment_request_not_found'; end if;

  if not v_is_finance
     and v_request.requested_by <> v_actor
     and not exists (
       select 1 from public.company_directors cd
       where cd.company_id = v_request.company_id
         and cd.director_profile_id = v_actor
         and cd.active
     ) then
    raise exception 'payment_request_execution_context_denied';
  end if;

  select prea.*, p.full_name as authorized_by_name
    into v_extra
  from public.payment_request_extraordinary_authorizations prea
  join public.profiles p on p.id = prea.authorized_by
  where prea.payment_request_id = v_request.id
    and prea.status = 'active'
  order by prea.authorized_at desc
  limit 1;

  select abi.id as item_id, abi.director_status, abi.director_reject_reason,
         abi.rebatch_status, abi.rebatch_release_note,
         ab.id as batch_id, ab.label as batch_label, ab.status as batch_status
    into v_batch
  from public.approval_batch_items abi
  join public.approval_batches ab on ab.id = abi.batch_id
  where abi.payment_request_id = v_request.id
    and abi.removed_at is null
  order by abi.created_at desc, abi.id desc
  limit 1;

  v_executed := public.approval_batch_request_has_any_execution_record(v_request.id);
  v_finance_current := public.approval_batch_request_has_current_finance_approval(v_request.id);
  v_block_reason := case
    when not v_is_finance then 'finance_role_required'
    when v_request.status::text <> 'approved' then 'payment_request_must_be_finance_approved'
    when not v_finance_current then 'finance_reapproval_required'
    when v_executed then 'payment_request_already_executed'
    when v_extra.id is not null then 'extraordinary_authorization_already_active'
    when exists (
      select 1 from public.approval_batch_items abi
      where abi.payment_request_id = v_request.id
        and abi.removed_at is null
        and abi.director_status = 'rejected'
    ) then 'direction_rejected_request_cannot_be_extraordinary'
    when exists (
      select 1 from public.approval_batch_items abi
      join public.approval_batches ab on ab.id = abi.batch_id
      where abi.payment_request_id = v_request.id
        and abi.removed_at is null
        and ab.status = 'submitted'
    ) then 'submitted_batch_request_cannot_be_extraordinary'
    when exists (
      select 1 from public.approval_batch_items abi
      join public.approval_batches ab on ab.id = abi.batch_id
      where abi.payment_request_id = v_request.id
        and abi.removed_at is null
        and ab.status = 'draft'
    ) then 'remove_request_from_draft_batch_first'
    when exists (
      select 1 from public.approval_batch_items abi
      join public.approval_batches ab on ab.id = abi.batch_id
      where abi.payment_request_id = v_request.id
        and abi.removed_at is null
        and abi.director_status = 'approved'
        and ab.status in ('approved', 'partially_approved', 'closed')
    ) then 'batch_approved_request_cannot_be_extraordinary'
    else null
  end;
  v_can_authorize := v_block_reason is null;

  return jsonb_build_object(
    'payment_request_id', v_request.id,
    'is_finance', v_is_finance,
    'finance_approval_current', v_finance_current,
    'executed', v_executed,
    'can_authorize_extraordinary', v_can_authorize,
    'authorization_block_reason', v_block_reason,
    'extraordinary', case when v_extra.id is null then null else jsonb_build_object(
      'id', v_extra.id,
      'category', v_extra.category,
      'reason', v_extra.reason,
      'authorized_by', v_extra.authorized_by,
      'authorized_by_name', v_extra.authorized_by_name,
      'authorized_at', v_extra.authorized_at,
      'authorization_current', v_extra.authorized_at >= v_request.approval_material_updated_at and v_finance_current,
      'can_revoke', v_is_finance and not v_executed
    ) end,
    'latest_batch', case when v_batch.item_id is null then null else jsonb_build_object(
      'item_id', v_batch.item_id,
      'batch_id', v_batch.batch_id,
      'batch_label', v_batch.batch_label,
      'batch_status', v_batch.batch_status,
      'director_status', v_batch.director_status,
      'reject_reason', v_batch.director_reject_reason,
      'rebatch_status', v_batch.rebatch_status,
      'correction_note', v_batch.rebatch_release_note
    ) end
  );
end
$$;

create or replace function public.enqueue_extraordinary_payment_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_company_name text;
  v_provider_name text;
  v_authorizer_name text;
  v_recipient record;
  v_has_recipient boolean := false;
begin
  if new.status <> 'active' then return new; end if;
  select * into v_request from public.payment_requests where id = new.payment_request_id;
  select coalesce(nullif(btrim(c.legal_name), ''), c.name)
    into v_company_name from public.companies c where c.id = v_request.company_id;
  select coalesce(nullif(btrim(p.alias), ''), p.nombre_completo)
    into v_provider_name from public.proveedores p where p.id = v_request.proveedor_id;
  select p.full_name into v_authorizer_name from public.profiles p where p.id = new.authorized_by;

  for v_recipient in
    with candidates as (
      select p.id, p.email, 'finanzas'::text as recipient_role, 1 as priority_order
      from public.profiles p
      join public.user_roles ur on ur.profile_id = p.id
      join public.roles r on r.id = ur.role_id
      where coalesce(p.active, true)
        and lower(btrim(r.name)) = any (public.flux_finance_roles())
      union all
      select p.id, p.email, 'direccion', 2
      from public.company_directors cd
      join public.profiles p on p.id = cd.director_profile_id
      where cd.company_id = v_request.company_id
        and cd.active
        and coalesce(p.active, true)
    )
    select distinct on (lower(btrim(email))) id, email, recipient_role
    from candidates
    where nullif(btrim(email), '') is not null
    order by lower(btrim(email)), priority_order, id
  loop
    v_has_recipient := true;
    perform public.insert_approval_batch_notification(
      'payment_request.extraordinary_authorized',
      'payment_request_extraordinary_authorizations',
      new.id,
      v_request.request_number,
      'administrador_sistema',
      v_recipient.id,
      v_recipient.email,
      v_recipient.recipient_role,
      'Pago extraordinario autorizado: ' || coalesce(v_request.request_number, new.id::text),
      jsonb_build_object(
        'folio', v_request.request_number,
        'provider', v_provider_name,
        'amount', v_request.amount_requested,
        'currency', v_request.currency,
        'company', v_company_name,
        'status', 'extraordinary_authorized',
        'extraordinary_category', new.category,
        'decision_comment', new.reason,
        'decision_label', 'Motivo extraordinario (' || new.category || ')',
        'authorized_by', v_authorizer_name,
        'authorized_at', new.authorized_at,
        'path', '/solicitudes.html?request_id=' || v_request.id::text
      ),
      'payment_request.extraordinary_authorized:' || new.id::text || ':' || v_recipient.id::text,
      'high'
    );
  end loop;

  if not v_has_recipient then
    perform public.insert_approval_batch_notification(
      'payment_request.extraordinary_authorized',
      'payment_request_extraordinary_authorizations',
      new.id,
      v_request.request_number,
      'administrador_sistema',
      null,
      null,
      'finanzas',
      'Pago extraordinario sin destinatario: ' || coalesce(v_request.request_number, new.id::text),
      jsonb_build_object(
        'folio', v_request.request_number,
        'company', v_company_name,
        'status', 'extraordinary_authorized',
        'decision_comment', new.reason,
        'decision_label', 'Motivo extraordinario',
        'path', '/solicitudes.html?request_id=' || v_request.id::text
      ),
      'payment_request.extraordinary_authorized:' || new.id::text || ':missing_recipient',
      'high'
    );
  end if;
  return new;
end
$$;

create trigger enqueue_extraordinary_payment_notification
  after insert on public.payment_request_extraordinary_authorizations
  for each row execute function public.enqueue_extraordinary_payment_notification();

create or replace function public.enqueue_rebatched_item_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_source_batch public.approval_batches%rowtype;
  v_target record;
  v_company_name text;
  v_recipient record;
  v_has_recipient boolean := false;
begin
  if old.rebatch_status <> 'blocked' or new.rebatch_status <> 'released' then
    return new;
  end if;
  select * into v_request from public.payment_requests where id = new.payment_request_id;
  select * into v_source_batch from public.approval_batches where id = new.batch_id;
  select coalesce(nullif(btrim(c.legal_name), ''), c.name)
    into v_company_name from public.companies c where c.id = v_request.company_id;

  select abi.id as item_id, ab.id as batch_id, ab.label as batch_label
    into v_target
  from public.approval_batch_items abi
  join public.approval_batches ab on ab.id = abi.batch_id
  where abi.payment_request_id = new.payment_request_id
    and abi.id <> new.id
    and abi.removed_at is null
    and abi.director_status = 'pending'
    and ab.status = 'draft'
  order by abi.created_at desc, abi.id desc
  limit 1;

  for v_recipient in
    with candidates as (
      select p.id, p.email, 'usuario_solicitante'::text as recipient_type,
             'solicitante'::text as recipient_role, 1 as priority_order
      from public.profiles p where p.id = v_request.requested_by
      union all
      select p.id, p.email, 'administrador_sistema', 'finanzas', 2
      from public.profiles p
      join public.user_roles ur on ur.profile_id = p.id
      join public.roles r on r.id = ur.role_id
      where coalesce(p.active, true)
        and lower(btrim(r.name)) = any (public.flux_finance_roles())
    )
    select distinct on (lower(btrim(email))) id, email, recipient_type, recipient_role
    from candidates
    where nullif(btrim(email), '') is not null
    order by lower(btrim(email)), priority_order, id
  loop
    v_has_recipient := true;
    perform public.insert_approval_batch_notification(
      'approval_batch.item_rebatched',
      'approval_batch_items',
      new.id,
      v_request.request_number,
      v_recipient.recipient_type,
      v_recipient.id,
      v_recipient.email,
      v_recipient.recipient_role,
      'Pago habilitado para nueva aprobacion: ' || coalesce(v_request.request_number, new.id::text),
      jsonb_build_object(
        'batch_label', coalesce(v_target.batch_label, 'Siguiente corte'),
        'company', v_company_name,
        'folio', v_request.request_number,
        'status', case when v_target.item_id is null then 'available_for_rebatch' else 'rebatched_pending' end,
        'decision_comment', new.rebatch_release_note,
        'decision_label', 'Correccion documentada por Finanzas',
        'source_batch', v_source_batch.label,
        'target_batch_id', v_target.batch_id,
        'path', '/approval_batches.html'
      ),
      'approval_batch.item_rebatched:' || new.id::text || ':' || coalesce(v_target.item_id::text, 'available') || ':' || v_recipient.id::text,
      'normal'
    );
  end loop;

  if not v_has_recipient then
    perform public.insert_approval_batch_notification(
      'approval_batch.item_rebatched',
      'approval_batch_items',
      new.id,
      v_request.request_number,
      'administrador_sistema',
      null,
      null,
      'finanzas',
      'Reingreso sin destinatario: ' || coalesce(v_request.request_number, new.id::text),
      jsonb_build_object(
        'batch_label', coalesce(v_target.batch_label, 'Siguiente corte'),
        'company', v_company_name,
        'folio', v_request.request_number,
        'status', 'available_for_rebatch',
        'decision_comment', new.rebatch_release_note,
        'decision_label', 'Correccion documentada por Finanzas',
        'path', '/approval_batches.html'
      ),
      'approval_batch.item_rebatched:' || new.id::text || ':missing_recipient',
      'normal'
    );
  end if;
  return new;
end
$$;

create trigger enqueue_rebatched_item_notification
  after update of rebatch_status on public.approval_batch_items
  for each row execute function public.enqueue_rebatched_item_notification();

create or replace function public.approval_batch_payment_layout_candidates(
  p_period_start date,
  p_period_end date,
  p_company_id uuid default null,
  p_company_bank_account_id uuid default null
)
returns table (
  classification text,
  classification_reason text,
  payment_request_id uuid,
  request_number text,
  request_status text,
  company_id uuid,
  company_name text,
  proveedor_id uuid,
  provider_name text,
  company_bank_account_id uuid,
  source_account_number text,
  destination_type text,
  destination_value text,
  beneficiary_name text,
  amount numeric,
  currency text,
  payment_reference text,
  payment_concept text,
  scheduled_payment_date date,
  missing_fields text[],
  finance_approval_current boolean,
  enforcement_required boolean,
  source_item_id uuid,
  source_batch_id uuid,
  source_batch_label text,
  source_batch_status text,
  director_status text,
  reject_reason text,
  rejected_by uuid,
  rejected_by_name text,
  rejected_at timestamptz,
  rebatch_status text,
  latest_correction_note text,
  extraordinary_authorization_id uuid,
  extraordinary_category text,
  extraordinary_reason text,
  extraordinary_authorized_by uuid,
  extraordinary_authorized_by_name text,
  extraordinary_authorized_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select
      pr.id as payment_request_id,
      pr.request_number,
      pr.status::text as request_status,
      pr.company_id,
      coalesce(nullif(btrim(c.legal_name), ''), c.name) as company_name,
      pr.proveedor_id,
      coalesce(nullif(btrim(p.alias), ''), p.nombre_completo) as provider_name,
      pr.company_bank_account_id,
      cba.account_number as source_account_number,
      p.destination_type,
      case
        when p.destination_type = 'clabe' then nullif(p.clabe, '')
        when p.destination_type = 'cuenta' then nullif(p.cuenta_bancaria, '')
        when p.destination_type = 'convenio' and nullif(p.convenio_number, '') is not null
          then 'CONVENIO ' || btrim(p.convenio_number)
        else null
      end as destination_value,
      coalesce(
        nullif(btrim(p.beneficiary_name), ''),
        nullif(btrim(p.nombre_completo), ''),
        nullif(btrim(p.alias), '')
      ) as beneficiary_name,
      pr.amount_requested as amount,
      coalesce(nullif(upper(btrim(pr.currency)), ''), 'MXN') as currency,
      nullif(btrim(pr.payment_reference), '') as payment_reference,
      nullif(btrim(pr.payment_concept), '') as payment_concept,
      pr.scheduled_payment_date,
      public.approval_batch_request_has_current_finance_approval(pr.id) as finance_approval_current,
      coalesce(settings.regular_payments_require_closed_batch, false)
        and settings.enforcement_started_at is not null
        and pr.created_at >= settings.enforcement_started_at as enforcement_required,
      latest_item.item_id as source_item_id,
      latest_item.batch_id as source_batch_id,
      latest_item.batch_label as source_batch_label,
      latest_item.batch_status as source_batch_status,
      latest_item.director_status,
      latest_item.reject_reason,
      latest_item.rejected_by,
      rejected_profile.full_name as rejected_by_name,
      latest_item.rejected_at,
      latest_item.rebatch_status,
      latest_item.latest_correction_note,
      extra.id as extraordinary_authorization_id,
      extra.category as extraordinary_category,
      extra.reason as extraordinary_reason,
      extra.authorized_by as extraordinary_authorized_by,
      extra_profile.full_name as extraordinary_authorized_by_name,
      extra.authorized_at as extraordinary_authorized_at,
      extra.authorized_at >= pr.approval_material_updated_at as extraordinary_authorization_current,
      public.approval_batch_request_has_execution(pr.id) as has_execution,
      array_remove(array[
        case when pr.scheduled_payment_date is null then 'scheduled_payment_date' end,
        case when pr.company_bank_account_id is null then 'company_bank_account_id' end,
        case when pr.company_bank_account_id is not null and cba.id is null then 'company_bank_account_id_not_found' end,
        case when cba.id is not null and not coalesce(cba.active, false) then 'company_bank_account_inactive' end,
        case when nullif(btrim(cba.account_number), '') is null then 'source_account_number' end,
        case when coalesce(nullif(btrim(c.legal_name), ''), nullif(btrim(c.name), '')) is null then 'company_name' end,
        case when pr.proveedor_id is null then 'proveedor_id' end,
        case when pr.proveedor_id is not null and p.id is null then 'proveedor_not_found' end,
        case when p.id is not null and not coalesce(p.activo, false) then 'proveedor_inactive' end,
        case when coalesce(nullif(btrim(p.beneficiary_name), ''), nullif(btrim(p.nombre_completo), ''), nullif(btrim(p.alias), '')) is null then 'beneficiary_name' end,
        case when p.destination_type is null then 'destination_type' end,
        case when p.destination_type = 'clabe' and nullif(btrim(p.clabe), '') is null then 'clabe' end,
        case when p.destination_type = 'cuenta' and nullif(btrim(p.cuenta_bancaria), '') is null then 'cuenta_bancaria' end,
        case when p.destination_type = 'convenio' and nullif(btrim(p.convenio_number), '') is null then 'convenio_number' end,
        case when nullif(btrim(pr.payment_reference), '') is null then 'payment_reference' end,
        case when nullif(btrim(pr.payment_concept), '') is null then 'payment_concept' end,
        case when coalesce(nullif(upper(btrim(pr.currency)), ''), 'MXN') <> 'MXN' then 'unsupported_layout_currency' end,
        case when coalesce(pr.amount_requested, 0) <= 0 then 'invalid_amount' end
      ]::text[], null) as missing_fields
    from public.payment_requests pr
    left join public.companies c on c.id = pr.company_id
    left join public.company_bank_accounts cba on cba.id = pr.company_bank_account_id
    left join public.proveedores p on p.id = pr.proveedor_id
    left join public.approval_batch_company_settings settings on settings.company_id = pr.company_id
    left join lateral (
      select
        abi.id as item_id,
        abi.batch_id,
        ab.label as batch_label,
        ab.status as batch_status,
        abi.director_status,
        abi.director_reject_reason as reject_reason,
        abi.decided_by as rejected_by,
        abi.decided_at as rejected_at,
        abi.rebatch_status,
        abi.rebatch_release_note as latest_correction_note
      from public.approval_batch_items abi
      join public.approval_batches ab on ab.id = abi.batch_id
      where abi.payment_request_id = pr.id
        and abi.removed_at is null
      order by abi.created_at desc, abi.id desc
      limit 1
    ) latest_item on true
    left join public.profiles rejected_profile on rejected_profile.id = latest_item.rejected_by
    left join lateral (
      select prea.id, prea.category, prea.reason, prea.authorized_by, prea.authorized_at
      from public.payment_request_extraordinary_authorizations prea
      where prea.payment_request_id = pr.id
        and prea.status = 'active'
      order by prea.authorized_at desc
      limit 1
    ) extra on true
    left join public.profiles extra_profile on extra_profile.id = extra.authorized_by
    where coalesce(
        nullif(pr.payment_method, ''),
        case when pr.request_type::text in ('cash', 'check') then pr.request_type::text else 'transfer' end
      ) = 'transfer'
      and coalesce(pr.scheduled_payment_date, pr.created_at::date)
        between p_period_start and p_period_end
      and (p_company_id is null or pr.company_id = p_company_id)
      and (p_company_bank_account_id is null or pr.company_bank_account_id = p_company_bank_account_id)
      and pr.status::text in ('approved', 'finance_validation', 'scheduled', 'paid')
  ), marked as (
    select
      case
        when b.has_execution then 'already_executed'
        when b.director_status = 'rejected' then 'rejected_by_direction'
        when b.source_batch_status in ('draft', 'submitted') then 'pending_director'
        when b.extraordinary_authorization_id is not null
          and (
            not coalesce(b.extraordinary_authorization_current, false)
            or not b.finance_approval_current
          ) then 'invalid_data'
        when b.extraordinary_authorization_id is not null
          and cardinality(b.missing_fields) = 0 then 'ready_extraordinary'
        when not b.finance_approval_current then 'invalid_data'
        when b.enforcement_required
          and b.director_status = 'approved'
          and b.source_batch_status in ('approved', 'partially_approved') then 'pending_finance_close'
        when cardinality(b.missing_fields) > 0 then 'invalid_data'
        when b.enforcement_required
          and b.director_status = 'approved'
          and b.source_batch_status = 'closed' then 'ready_regular'
        when b.enforcement_required then 'pending_director'
        when b.source_item_id is null then 'legacy_eligible'
        when b.director_status = 'approved'
          and b.source_batch_status in ('approved', 'partially_approved', 'closed') then 'legacy_eligible'
        else 'pending_director'
      end as classification,
      case
        when b.has_execution then 'already_executed'
        when b.director_status = 'rejected' then 'direction_rejected'
        when b.source_batch_status = 'draft' then 'batch_draft'
        when b.source_batch_status = 'submitted' then 'direction_pending'
        when b.extraordinary_authorization_id is not null
          and not coalesce(b.extraordinary_authorization_current, false) then 'extraordinary_reauthorization_required'
        when b.extraordinary_authorization_id is not null
          and not b.finance_approval_current then 'finance_reapproval_required'
        when b.extraordinary_authorization_id is not null
          and cardinality(b.missing_fields) > 0 then 'incomplete_layout_data'
        when not b.finance_approval_current then 'finance_reapproval_required'
        when b.enforcement_required
          and b.director_status = 'approved'
          and b.source_batch_status in ('approved', 'partially_approved') then 'finance_close_required'
        when cardinality(b.missing_fields) > 0 then 'incomplete_layout_data'
        when b.enforcement_required
          and b.source_item_id is null then 'closed_batch_required'
        when b.enforcement_required then 'direction_approval_required'
        when b.source_item_id is null then 'legacy_without_batch'
        else 'legacy_batch_compatible'
      end as classification_reason,
      b.*
    from base b
  )
  select
    m.classification,
    m.classification_reason,
    m.payment_request_id,
    m.request_number,
    m.request_status,
    m.company_id,
    m.company_name,
    m.proveedor_id,
    m.provider_name,
    m.company_bank_account_id,
    m.source_account_number,
    m.destination_type,
    m.destination_value,
    m.beneficiary_name,
    m.amount,
    m.currency,
    m.payment_reference,
    m.payment_concept,
    m.scheduled_payment_date,
    case
      when m.extraordinary_authorization_id is not null
        and not coalesce(m.extraordinary_authorization_current, false)
        and not (m.missing_fields @> array['extraordinary_reauthorization_required']::text[])
        then array_append(m.missing_fields, 'extraordinary_reauthorization_required')
      when not m.finance_approval_current
        and not (m.missing_fields @> array['finance_reapproval_required']::text[])
        then array_append(m.missing_fields, 'finance_reapproval_required')
      else m.missing_fields
    end,
    m.finance_approval_current,
    m.enforcement_required,
    m.source_item_id,
    m.source_batch_id,
    m.source_batch_label,
    m.source_batch_status,
    m.director_status,
    m.reject_reason,
    m.rejected_by,
    m.rejected_by_name,
    m.rejected_at,
    m.rebatch_status,
    m.latest_correction_note,
    m.extraordinary_authorization_id,
    m.extraordinary_category,
    m.extraordinary_reason,
    m.extraordinary_authorized_by,
    m.extraordinary_authorized_by_name,
    m.extraordinary_authorized_at
  from marked m;
$$;

create or replace function public.preview_payment_layout_eligibility(
  p_period_start date,
  p_period_end date,
  p_company_id uuid default null,
  p_company_bank_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.approval_batch_require_finance();
  if p_period_start is null or p_period_end is null then
    raise exception 'period_dates_required';
  end if;
  if p_period_start > p_period_end then
    raise exception 'invalid_period_range';
  end if;
  if p_company_id is not null and not exists (
    select 1 from public.companies c where c.id = p_company_id
  ) then
    raise exception 'company_not_found';
  end if;
  if p_company_bank_account_id is not null and not exists (
    select 1 from public.company_bank_accounts cba
    where cba.id = p_company_bank_account_id
      and coalesce(cba.active, true)
      and (p_company_id is null or cba.company_id = p_company_id)
  ) then
    raise exception 'company_bank_account_not_found_or_inactive';
  end if;

  with candidates as (
    select * from public.approval_batch_payment_layout_candidates(
      p_period_start,
      p_period_end,
      p_company_id,
      p_company_bank_account_id
    )
  ), totals as (
    select classification, currency, count(*) as payment_count, sum(amount) as amount
    from candidates
    where classification in ('ready_regular', 'ready_extraordinary', 'legacy_eligible')
    group by classification, currency
  )
  select jsonb_build_object(
    'ready_regular', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'ready_regular'), '[]'::jsonb),
    'ready_extraordinary', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'ready_extraordinary'), '[]'::jsonb),
    'rejected_by_direction', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.rejected_at desc nulls last, c.request_number) from candidates c where c.classification = 'rejected_by_direction'), '[]'::jsonb),
    'pending_director', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'pending_director'), '[]'::jsonb),
    'pending_finance_close', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'pending_finance_close'), '[]'::jsonb),
    'legacy_eligible', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'legacy_eligible'), '[]'::jsonb),
    'invalid_data', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'invalid_data'), '[]'::jsonb),
    'already_executed', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'already_executed'), '[]'::jsonb),
    'totals_by_currency', coalesce((select jsonb_agg(jsonb_build_object(
      'classification', t.classification,
      'currency', t.currency,
      'payment_count', t.payment_count,
      'amount', t.amount
    ) order by t.currency, t.classification) from totals t), '[]'::jsonb)
  ) into v_result;

  return v_result;
end
$$;

create or replace function public.create_payment_layout(
  p_period_start date,
  p_period_end date,
  p_generated_by uuid,
  p_name text default null,
  p_company_id uuid default null,
  p_company_bank_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_layout_id uuid;
  v_layout_number text;
  v_layout_name text;
  v_request_id uuid;
  v_locked_request_ids uuid[] := array[]::uuid[];
  v_payment_count integer := 0;
  v_company_count integer := 0;
  v_total_amount numeric := 0;
  v_regular_count integer := 0;
  v_extraordinary_count integer := 0;
  v_legacy_count integer := 0;
  v_rejected_count integer := 0;
  v_pending_close_count integer := 0;
  v_pending_director_count integer := 0;
  v_invalid_count integer := 0;
  v_already_executed_count integer := 0;
  v_invalid_requests jsonb := '[]'::jsonb;
begin
  v_actor := public.approval_batch_require_finance();
  if p_generated_by is not null and p_generated_by <> v_actor then
    raise exception 'generated_by_must_match_authenticated_actor';
  end if;
  if p_period_start is null or p_period_end is null then
    raise exception 'period_dates_required';
  end if;
  if p_period_start > p_period_end then
    raise exception 'invalid_period_range';
  end if;
  if p_company_id is not null and not exists (
    select 1 from public.companies c where c.id = p_company_id
  ) then
    raise exception 'company_not_found';
  end if;
  if p_company_bank_account_id is not null and not exists (
    select 1 from public.company_bank_accounts cba
    where cba.id = p_company_bank_account_id
      and coalesce(cba.active, true)
      and (p_company_id is null or cba.company_id = p_company_id)
  ) then
    raise exception 'company_bank_account_not_found_or_inactive';
  end if;

  for v_request_id in
    select c.payment_request_id
    from public.approval_batch_payment_layout_candidates(
      p_period_start,
      p_period_end,
      p_company_id,
      p_company_bank_account_id
    ) c
    where c.classification in ('ready_regular', 'ready_extraordinary', 'legacy_eligible')
    order by c.payment_request_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_request_id::text, 21021));
    v_locked_request_ids := array_append(v_locked_request_ids, v_request_id);
  end loop;

  select
    count(*) filter (
      where c.classification = 'ready_regular'
        and c.payment_request_id = any(v_locked_request_ids)
    ),
    count(*) filter (
      where c.classification = 'ready_extraordinary'
        and c.payment_request_id = any(v_locked_request_ids)
    ),
    count(*) filter (
      where c.classification = 'legacy_eligible'
        and c.payment_request_id = any(v_locked_request_ids)
    ),
    count(*) filter (where c.classification = 'rejected_by_direction'),
    count(*) filter (where c.classification = 'pending_finance_close'),
    count(*) filter (where c.classification = 'pending_director'),
    count(*) filter (where c.classification = 'invalid_data'),
    count(*) filter (where c.classification = 'already_executed')
  into
    v_regular_count,
    v_extraordinary_count,
    v_legacy_count,
    v_rejected_count,
    v_pending_close_count,
    v_pending_director_count,
    v_invalid_count,
    v_already_executed_count
  from public.approval_batch_payment_layout_candidates(
    p_period_start,
    p_period_end,
    p_company_id,
    p_company_bank_account_id
  ) c;

  v_payment_count := v_regular_count + v_extraordinary_count + v_legacy_count;
  select coalesce(jsonb_agg(jsonb_build_object(
    'payment_request_id', c.payment_request_id,
    'request_number', c.request_number,
    'reason', c.classification_reason,
    'missing_fields', c.missing_fields
  ) order by c.request_number), '[]'::jsonb)
  into v_invalid_requests
  from public.approval_batch_payment_layout_candidates(
    p_period_start,
    p_period_end,
    p_company_id,
    p_company_bank_account_id
  ) c
  where c.classification = 'invalid_data';

  if v_payment_count = 0 then
    return jsonb_build_object(
      'layout_id', null,
      'status', 'not_created',
      'payment_count', 0,
      'company_count', 0,
      'total_amount', 0,
      'ready_regular_count', v_regular_count,
      'extraordinary_count', v_extraordinary_count,
      'legacy_count', v_legacy_count,
      'rejected_count', v_rejected_count,
      'pending_close_count', v_pending_close_count,
      'pending_director_count', v_pending_director_count,
      'invalid_count', v_invalid_count,
      'already_executed_count', v_already_executed_count,
      'invalid_requests', v_invalid_requests,
      'message', 'no_valid_payment_requests'
    );
  end if;

  v_layout_number := 'LAY-' || extract(year from p_period_start)::int || '-'
    || lpad(nextval('public.payment_layout_number_seq')::text, 4, '0');
  v_layout_name := coalesce(
    nullif(btrim(p_name), ''),
    'Layout BBVA - ' || p_period_start::text || ' a ' || p_period_end::text
  );

  insert into public.payment_layouts(
    layout_number,
    name,
    period_start,
    period_end,
    status,
    generated_by,
    generated_at
  ) values (
    v_layout_number,
    v_layout_name,
    p_period_start,
    p_period_end,
    'draft',
    v_actor,
    now()
  ) returning id into v_layout_id;

  insert into public.payment_layout_lines(
    layout_id,
    payment_request_id,
    company_id,
    proveedor_id,
    company_bank_account_id,
    source_account_number,
    company_name,
    destination_type,
    destination_value,
    beneficiary_name,
    amount,
    payment_reference,
    payment_concept,
    request_number,
    status
  )
  select
    v_layout_id,
    payment_request_id,
    company_id,
    proveedor_id,
    company_bank_account_id,
    source_account_number,
    company_name,
    destination_type,
    destination_value,
    beneficiary_name,
    amount,
    payment_reference,
    payment_concept,
    request_number,
    'included'
  from public.approval_batch_payment_layout_candidates(
    p_period_start,
    p_period_end,
    p_company_id,
    p_company_bank_account_id
  ) c
  where c.classification in ('ready_regular', 'ready_extraordinary', 'legacy_eligible')
    and c.payment_request_id = any(v_locked_request_ids)
  order by c.request_number, c.payment_request_id;

  get diagnostics v_payment_count = row_count;
  select count(distinct company_id), coalesce(sum(amount), 0)
    into v_company_count, v_total_amount
  from public.payment_layout_lines
  where layout_id = v_layout_id;

  update public.payment_layouts
  set company_count = v_company_count,
      payment_count = v_payment_count,
      total_amount = v_total_amount,
      updated_at = now()
  where id = v_layout_id;

  update public.payment_requests pr
  set status = 'finance_validation'::public.payment_request_status,
      scheduled_by = v_actor,
      scheduled_at = now(),
      updated_at = now()
  where pr.id in (
    select pll.payment_request_id
    from public.payment_layout_lines pll
    where pll.layout_id = v_layout_id
  );

  return jsonb_build_object(
    'layout_id', v_layout_id,
    'layout_number', v_layout_number,
    'status', 'draft',
    'payment_count', v_payment_count,
    'company_count', v_company_count,
    'total_amount', v_total_amount,
    'ready_regular_count', v_regular_count,
    'extraordinary_count', v_extraordinary_count,
    'legacy_count', v_legacy_count,
    'rejected_count', v_rejected_count,
    'pending_close_count', v_pending_close_count,
    'pending_director_count', v_pending_director_count,
    'invalid_count', v_invalid_count,
    'already_executed_count', v_already_executed_count,
    'invalid_requests', v_invalid_requests,
    'message', 'layout_created_with_batch_controls'
  );
end
$$;

revoke all on function public.set_batch_execution_updated_at() from public, anon, authenticated;
revoke all on function public.mark_payment_request_material_change() from public, anon, authenticated;
revoke all on function public.mark_provider_payment_material_change() from public, anon, authenticated;
revoke all on function public.approval_batch_latest_finance_approval_at(uuid) from public, anon, authenticated;
revoke all on function public.approval_batch_request_has_current_finance_approval(uuid) from public, anon, authenticated;
revoke all on function public.approval_batch_request_has_execution(uuid) from public, anon, authenticated;
revoke all on function public.approval_batch_request_has_any_execution_record(uuid) from public, anon, authenticated;
revoke all on function public.approval_batch_request_has_active_extraordinary(uuid) from public, anon, authenticated;
revoke all on function public.approval_batch_request_base_eligible(uuid) from public, anon, authenticated;
revoke all on function public.approval_batch_assert_execution_authorized() from public, anon, authenticated;
revoke all on function public.enqueue_extraordinary_payment_notification() from public, anon, authenticated;
revoke all on function public.enqueue_rebatched_item_notification() from public, anon, authenticated;
revoke all on function public.approval_batch_payment_layout_candidates(date,date,uuid,uuid) from public, anon, authenticated;

revoke all on function public.set_approval_batch_company_enforcement(uuid,boolean) from public, anon;
revoke all on function public.authorize_payment_request_extraordinary(uuid,text,text) from public, anon;
revoke all on function public.revoke_payment_request_extraordinary(uuid,text) from public, anon;
revoke all on function public.release_and_rebatch_rejected_request(uuid,text,uuid) from public, anon;
revoke all on function public.close_approval_batch(uuid) from public, anon;
revoke all on function public.get_payment_request_execution_context(uuid) from public, anon;
revoke all on function public.preview_payment_layout_eligibility(date,date,uuid,uuid) from public, anon;
revoke all on function public.create_payment_layout(date,date,uuid,text,uuid,uuid) from public, anon;

grant execute on function public.set_approval_batch_company_enforcement(uuid,boolean) to authenticated;
grant execute on function public.authorize_payment_request_extraordinary(uuid,text,text) to authenticated;
grant execute on function public.revoke_payment_request_extraordinary(uuid,text) to authenticated;
grant execute on function public.release_and_rebatch_rejected_request(uuid,text,uuid) to authenticated;
grant execute on function public.close_approval_batch(uuid) to authenticated;
grant execute on function public.get_payment_request_execution_context(uuid) to authenticated;
grant execute on function public.preview_payment_layout_eligibility(date,date,uuid,uuid) to authenticated;
grant execute on function public.create_payment_layout(date,date,uuid,text,uuid,uuid) to authenticated;

do $$
begin
  if to_regclass('public.approval_batch_company_settings') is null
     or to_regclass('public.approval_batch_company_setting_events') is null
     or to_regclass('public.payment_request_extraordinary_authorizations') is null then
    raise exception '022_postcheck: faltan tablas de control';
  end if;
  if to_regprocedure('public.release_and_rebatch_rejected_request(uuid,text,uuid)') is null
     or to_regprocedure('public.preview_payment_layout_eligibility(date,date,uuid,uuid)') is null
     or to_regprocedure('public.authorize_payment_request_extraordinary(uuid,text,text)') is null then
    raise exception '022_postcheck: faltan RPCs requeridos';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'mark_payment_request_material_change' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'mark_provider_payment_material_change' and not tgisinternal
  ) then
    raise exception '022_postcheck: faltan gates de cambios materiales';
  end if;
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname = 'payment_layout_lines'
      and t.tgname = 'require_batch_for_payment_layout_line'
      and p.proname = 'approval_batch_assert_execution_authorized'
      and not t.tgisinternal
  ) or not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname = 'cash_funds'
      and t.tgname = 'require_batch_for_cash_fund'
      and p.proname = 'approval_batch_assert_execution_authorized'
      and not t.tgisinternal
  ) then
    raise exception '022_postcheck: faltan gates de ejecucion en layout o efectivo/cheque';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'enqueue_extraordinary_payment_notification' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'enqueue_rebatched_item_notification' and not tgisinternal
  ) then
    raise exception '022_postcheck: faltan fuentes unicas de notificacion';
  end if;
end
$$;

commit;
