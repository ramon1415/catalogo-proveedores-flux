-- MVP de autorizacion semanal por batch, independiente del routing individual.

begin;

do $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
begin
  foreach v_name in array array[
    'companies', 'profiles', 'roles', 'user_roles', 'payment_requests',
    'payment_request_approvals', 'payment_layout_lines', 'cash_funds',
    'proveedores', 'cost_centers', 'budget_categories', 'notification_events'
  ] loop
    if to_regclass('public.' || v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception '021_precheck: faltan dependencias requeridas: %', array_to_string(v_missing, ', ')
      using hint = 'El ledger de notificaciones y el esquema base deben instalarse antes del batch.';
  end if;

  if to_regprocedure('public.current_profile_id()') is null
     or to_regprocedure('public.current_user_has_role(text[])') is null
     or to_regprocedure('public.flux_finance_roles()') is null then
    raise exception '021_precheck: faltan helpers de identidad o roles del esquema base';
  end if;
end
$$;

create table public.company_directors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  director_profile_id uuid not null references public.profiles(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id)
);

create unique index company_directors_active_uidx
  on public.company_directors(company_id, director_profile_id)
  where active;
create index company_directors_company_idx
  on public.company_directors(company_id, active);

create table public.approval_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  label text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  director_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_batches_status_check check (
    status in ('draft', 'submitted', 'approved', 'partially_approved', 'closed')
  ),
  constraint approval_batches_period_check check (period_start <= period_end),
  constraint approval_batches_submission_check check (
    (status = 'draft' and submitted_at is null and submitted_by is null)
    or (status <> 'draft' and submitted_at is not null and submitted_by is not null)
  ),
  constraint approval_batches_decision_check check (
    status in ('draft', 'submitted')
    or (decided_at is not null and decided_by is not null)
  ),
  constraint approval_batches_close_check check (
    status <> 'closed'
    or (closed_at is not null and closed_by is not null)
  )
);

create index approval_batches_company_status_idx
  on public.approval_batches(company_id, status, period_end desc);
create index approval_batches_director_status_idx
  on public.approval_batches(director_id, status, period_end desc);

create table public.approval_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.approval_batches(id),
  payment_request_id uuid not null references public.payment_requests(id),
  finance_reviewed_by uuid not null references public.profiles(id),
  finance_reviewed_at timestamptz not null default now(),
  director_status text not null default 'pending',
  director_reject_reason text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  removed_by uuid references public.profiles(id),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint approval_batch_items_status_check check (
    director_status in ('pending', 'approved', 'rejected')
  ),
  constraint approval_batch_items_decision_check check (
    (director_status = 'pending' and decided_by is null and decided_at is null and director_reject_reason is null)
    or (director_status = 'approved' and decided_by is not null and decided_at is not null and director_reject_reason is null)
    or (director_status = 'rejected' and decided_by is not null and decided_at is not null and nullif(btrim(director_reject_reason), '') is not null)
  ),
  constraint approval_batch_items_removal_check check (
    (removed_at is null and removed_by is null)
    or (removed_at is not null and removed_by is not null and director_status = 'pending')
  )
);

create unique index approval_batch_items_active_uidx
  on public.approval_batch_items(batch_id, payment_request_id)
  where removed_at is null;
create index approval_batch_items_request_idx
  on public.approval_batch_items(payment_request_id, director_status);
create index approval_batch_items_batch_idx
  on public.approval_batch_items(batch_id, removed_at, director_status);

create or replace function public.set_approval_batch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger set_company_directors_updated_at
  before update on public.company_directors
  for each row execute function public.set_approval_batch_updated_at();

create trigger set_approval_batches_updated_at
  before update on public.approval_batches
  for each row execute function public.set_approval_batch_updated_at();

create or replace function public.approval_batch_require_actor()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
begin
  v_actor := public.current_profile_id();
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;
  return v_actor;
end
$$;

create or replace function public.approval_batch_require_finance()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
begin
  v_actor := public.approval_batch_require_actor();
  if not public.current_user_has_role(public.flux_finance_roles()) then
    raise exception 'finance_role_required';
  end if;
  return v_actor;
end
$$;

create or replace function public.approval_batch_request_base_eligible(p_payment_request_id uuid)
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
      and exists (
        select 1
        from public.payment_request_approvals pra
        join public.roles r on r.id = pra.role_id
        where pra.payment_request_id = pr.id
          and pra.action in ('approved', 'exception_approved')
          and pra.to_status = 'approved'
          and lower(btrim(r.name)) = any (public.flux_finance_roles())
      )
      and not exists (
        select 1 from public.payment_layout_lines pll
        where pll.payment_request_id = pr.id
      )
      and not exists (
        select 1 from public.cash_funds cf
        where cf.payment_request_id = pr.id
      )
      and not exists (
        select 1
        from public.approval_batch_items abi
        join public.approval_batches ab on ab.id = abi.batch_id
        where abi.payment_request_id = pr.id
          and abi.removed_at is null
          and abi.director_status = 'approved'
          and ab.status in ('approved', 'partially_approved', 'closed')
      )
  );
$$;

create or replace function public.approval_batch_request_open_elsewhere(
  p_payment_request_id uuid,
  p_exclude_batch_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.approval_batch_items abi
    join public.approval_batches ab on ab.id = abi.batch_id
    where abi.payment_request_id = p_payment_request_id
      and abi.removed_at is null
      and ab.status in ('draft', 'submitted')
      and (p_exclude_batch_id is null or ab.id <> p_exclude_batch_id)
  );
$$;

create or replace function public.validate_approval_batch_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch_company uuid;
  v_request_company uuid;
begin
  select company_id into v_batch_company
  from public.approval_batches where id = new.batch_id;
  select company_id into v_request_company
  from public.payment_requests where id = new.payment_request_id;

  if v_batch_company is null or v_request_company is null then
    raise exception 'batch_or_request_company_required';
  end if;
  if v_batch_company <> v_request_company then
    raise exception 'batch_request_company_mismatch';
  end if;
  return new;
end
$$;

create trigger validate_approval_batch_item_before_write
  before insert or update of batch_id, payment_request_id
  on public.approval_batch_items
  for each row execute function public.validate_approval_batch_item();

create or replace function public.approval_batch_assert_execution_authorized()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.approval_batch_items abi
    join public.approval_batches ab on ab.id = abi.batch_id
    where abi.payment_request_id = new.payment_request_id
      and abi.removed_at is null
      and abi.director_status = 'approved'
      and ab.status in ('approved', 'partially_approved', 'closed')
  ) then
    raise exception 'batch_authorization_required';
  end if;
  return new;
end
$$;

create trigger require_batch_for_payment_layout_line
  before insert or update of payment_request_id
  on public.payment_layout_lines
  for each row execute function public.approval_batch_assert_execution_authorized();

create trigger require_batch_for_cash_fund
  before insert or update of payment_request_id
  on public.cash_funds
  for each row execute function public.approval_batch_assert_execution_authorized();

alter table public.company_directors enable row level security;
alter table public.approval_batches enable row level security;
alter table public.approval_batch_items enable row level security;

create policy company_directors_read_authorized
  on public.company_directors for select to authenticated
  using (
    public.current_user_has_role(public.flux_finance_roles())
    or director_profile_id = public.current_profile_id()
  );

create policy approval_batches_read_authorized
  on public.approval_batches for select to authenticated
  using (
    public.current_user_has_role(public.flux_finance_roles())
    or director_id = public.current_profile_id()
  );

create policy approval_batch_items_read_authorized
  on public.approval_batch_items for select to authenticated
  using (
    exists (
      select 1
      from public.approval_batches ab
      where ab.id = batch_id
        and (
          public.current_user_has_role(public.flux_finance_roles())
          or ab.director_id = public.current_profile_id()
        )
    )
  );

revoke all on table public.company_directors, public.approval_batches, public.approval_batch_items from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.company_directors, public.approval_batches, public.approval_batch_items
  from authenticated;
grant select on table public.company_directors, public.approval_batches, public.approval_batch_items to authenticated;

create or replace function public.list_company_directors(p_company_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.approval_batch_require_finance();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', cd.id,
      'company_id', cd.company_id,
      'company_name', coalesce(nullif(btrim(c.legal_name), ''), c.name),
      'director_profile_id', cd.director_profile_id,
      'director_name', p.full_name,
      'director_email', p.email,
      'director_profile_active', coalesce(p.active, true),
      'active', cd.active
    ) order by coalesce(nullif(btrim(c.legal_name), ''), c.name), p.full_name)
    from public.company_directors cd
    join public.companies c on c.id = cd.company_id
    join public.profiles p on p.id = cd.director_profile_id
    where (p_company_id is null or cd.company_id = p_company_id)
  ), '[]'::jsonb);
end
$$;

create or replace function public.set_company_director(
  p_company_id uuid,
  p_director_profile_id uuid,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_id uuid;
begin
  v_actor := public.approval_batch_require_finance();
  if not exists (select 1 from public.companies where id = p_company_id and coalesce(active, true)) then
    raise exception 'company_not_found_or_inactive';
  end if;
  if not exists (select 1 from public.profiles where id = p_director_profile_id and coalesce(active, true)) then
    raise exception 'director_profile_not_found_or_inactive';
  end if;

  select id into v_id
  from public.company_directors
  where company_id = p_company_id
    and director_profile_id = p_director_profile_id
  order by created_at desc
  limit 1
  for update;

  if v_id is null then
    insert into public.company_directors(company_id, director_profile_id, active, created_by)
    values (p_company_id, p_director_profile_id, coalesce(p_active, true), v_actor)
    returning id into v_id;
  else
    update public.company_directors
      set active = coalesce(p_active, true), updated_at = now()
    where id = v_id;
  end if;

  return jsonb_build_object('id', v_id, 'active', coalesce(p_active, true));
end
$$;

create or replace function public.create_approval_batch(
  p_company_id uuid,
  p_label text default null,
  p_period_start date default null,
  p_period_end date default null,
  p_director_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_director uuid;
  v_director_count integer;
  v_period_end date;
  v_period_start date;
  v_company_name text;
  v_label text;
  v_id uuid;
begin
  v_actor := public.approval_batch_require_finance();
  select coalesce(nullif(btrim(legal_name), ''), name) into v_company_name
  from public.companies where id = p_company_id and coalesce(active, true);
  if v_company_name is null then raise exception 'company_not_found_or_inactive'; end if;

  if p_director_id is null then
    select count(*) into v_director_count
    from public.company_directors cd
    join public.profiles p on p.id = cd.director_profile_id
    where cd.company_id = p_company_id and cd.active and coalesce(p.active, true);
    if v_director_count = 0 then raise exception 'company_director_required'; end if;
    if v_director_count > 1 then raise exception 'select_company_director'; end if;
    select director_profile_id into v_director
    from public.company_directors cd
    join public.profiles p on p.id = cd.director_profile_id
    where cd.company_id = p_company_id and cd.active and coalesce(p.active, true)
    order by cd.created_at, cd.id
    limit 1;
  else
    v_director := p_director_id;
    if not exists (
      select 1 from public.company_directors cd
      join public.profiles p on p.id = cd.director_profile_id
      where cd.company_id = p_company_id and cd.director_profile_id = v_director
        and cd.active and coalesce(p.active, true)
    ) then
      raise exception 'company_director_not_active';
    end if;
  end if;

  v_period_end := coalesce(
    p_period_end,
    current_date + mod(3 - extract(isodow from current_date)::integer + 7, 7)
  );
  v_period_start := coalesce(p_period_start, v_period_end - 6);
  if v_period_start > v_period_end then raise exception 'invalid_batch_period'; end if;
  v_label := coalesce(
    nullif(btrim(p_label), ''),
    'Corte ' || v_company_name || ' ' || to_char(v_period_end, 'IYYY-"W"IW')
  );

  insert into public.approval_batches(
    company_id, label, period_start, period_end, director_id, created_by, notes
  ) values (
    p_company_id, v_label, v_period_start, v_period_end, v_director, v_actor,
    nullif(btrim(coalesce(p_notes, '')), '')
  ) returning id into v_id;

  return jsonb_build_object('batch_id', v_id, 'status', 'draft', 'label', v_label);
end
$$;

create or replace function public.list_batch_eligible_requests(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.approval_batch_require_finance();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pr.id,
      'request_number', pr.request_number,
      'company_id', pr.company_id,
      'company_name', coalesce(nullif(btrim(c.legal_name), ''), c.name),
      'provider_name', coalesce(nullif(btrim(p.alias), ''), p.nombre_completo),
      'cost_center', coalesce(nullif(btrim(cc.code), '') || ' - ', '') || cc.name,
      'budget_category', coalesce(nullif(btrim(bc.code), '') || ' - ', '') || bc.name,
      'payment_method', coalesce(
        nullif(to_jsonb(pr) ->> 'payment_method', ''),
        nullif(to_jsonb(pr) ->> 'request_type', ''),
        p.metodo_pago::text,
        'otro'
      ),
      'currency', pr.currency,
      'amount', pr.amount_requested,
      'status', pr.status,
      'requested_by', pr.requested_by,
      'requester_name', requester.full_name,
      'created_at', pr.created_at
    ) order by pr.created_at, pr.id)
    from public.payment_requests pr
    join public.companies c on c.id = pr.company_id
    left join public.proveedores p on p.id = pr.proveedor_id
    left join public.cost_centers cc on cc.id = pr.cost_center_id
    left join public.budget_categories bc on bc.id = pr.budget_category_id
    left join public.profiles requester on requester.id = pr.requested_by
    where pr.company_id = p_company_id
      and public.approval_batch_request_base_eligible(pr.id)
      and not public.approval_batch_request_open_elsewhere(pr.id, null)
  ), '[]'::jsonb);
end
$$;

create or replace function public.add_request_to_approval_batch(
  p_batch_id uuid,
  p_payment_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
  v_item_id uuid;
begin
  v_actor := public.approval_batch_require_finance();
  select * into v_batch from public.approval_batches where id = p_batch_id for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status <> 'draft' then raise exception 'batch_must_be_draft'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_payment_request_id::text, 21021));
  if not public.approval_batch_request_base_eligible(p_payment_request_id) then
    raise exception 'payment_request_not_batch_eligible';
  end if;
  if public.approval_batch_request_open_elsewhere(p_payment_request_id, p_batch_id) then
    raise exception 'payment_request_in_another_open_batch';
  end if;
  if not exists (
    select 1 from public.payment_requests
    where id = p_payment_request_id and company_id = v_batch.company_id
  ) then
    raise exception 'batch_request_company_mismatch';
  end if;

  insert into public.approval_batch_items(
    batch_id, payment_request_id, finance_reviewed_by, finance_reviewed_at
  ) values (p_batch_id, p_payment_request_id, v_actor, now())
  returning id into v_item_id;

  return jsonb_build_object('item_id', v_item_id, 'status', 'pending');
end
$$;

create or replace function public.remove_request_from_approval_batch(
  p_batch_id uuid,
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_status text;
begin
  v_actor := public.approval_batch_require_finance();
  select status into v_status from public.approval_batches where id = p_batch_id for update;
  if v_status is null then raise exception 'batch_not_found'; end if;
  if v_status <> 'draft' then raise exception 'batch_must_be_draft'; end if;

  update public.approval_batch_items
    set removed_by = v_actor, removed_at = now()
  where id = p_item_id and batch_id = p_batch_id
    and removed_at is null and director_status = 'pending';
  if not found then raise exception 'active_batch_item_not_found'; end if;
  return jsonb_build_object('item_id', p_item_id, 'removed', true);
end
$$;

create or replace function public.submit_approval_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
  v_count integer;
  v_invalid integer;
begin
  v_actor := public.approval_batch_require_finance();
  select * into v_batch from public.approval_batches where id = p_batch_id for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status <> 'draft' then raise exception 'batch_must_be_draft'; end if;

  select count(*) into v_count from public.approval_batch_items
  where batch_id = p_batch_id and removed_at is null;
  if v_count = 0 then raise exception 'batch_requires_items'; end if;

  select count(*) into v_invalid
  from public.approval_batch_items abi
  where abi.batch_id = p_batch_id and abi.removed_at is null
    and (
      not public.approval_batch_request_base_eligible(abi.payment_request_id)
      or public.approval_batch_request_open_elsewhere(abi.payment_request_id, p_batch_id)
    );
  if v_invalid > 0 then raise exception 'batch_contains_ineligible_requests:%', v_invalid; end if;

  update public.approval_batches
    set status = 'submitted', submitted_by = v_actor, submitted_at = now()
  where id = p_batch_id;
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'submitted', 'item_count', v_count);
end
$$;

create or replace function public.approve_entire_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
  v_count integer;
begin
  v_actor := public.approval_batch_require_actor();
  select * into v_batch from public.approval_batches where id = p_batch_id for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.director_id <> v_actor then raise exception 'batch_director_required'; end if;
  if v_batch.status <> 'submitted' then raise exception 'batch_must_be_submitted'; end if;

  update public.approval_batch_items
    set director_status = 'approved', director_reject_reason = null,
        decided_by = v_actor, decided_at = now()
  where batch_id = p_batch_id and removed_at is null and director_status = 'pending';
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'batch_has_no_pending_items'; end if;

  update public.approval_batches
    set status = 'approved', decided_by = v_actor, decided_at = now()
  where id = p_batch_id;
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'approved', 'approved_items', v_count);
end
$$;

create or replace function public.decide_approval_batch_items(
  p_batch_id uuid,
  p_decisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
  v_decision jsonb;
  v_item_id uuid;
  v_status text;
  v_reason text;
  v_updated integer := 0;
  v_pending integer;
  v_rejected integer;
  v_final_status text;
begin
  v_actor := public.approval_batch_require_actor();
  select * into v_batch from public.approval_batches where id = p_batch_id for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.director_id <> v_actor then raise exception 'batch_director_required'; end if;
  if v_batch.status <> 'submitted' then raise exception 'batch_must_be_submitted'; end if;
  if jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then
    raise exception 'decisions_array_required';
  end if;

  for v_decision in select value from jsonb_array_elements(p_decisions) loop
    v_item_id := nullif(v_decision ->> 'item_id', '')::uuid;
    v_status := lower(btrim(coalesce(v_decision ->> 'status', '')));
    v_reason := nullif(btrim(coalesce(v_decision ->> 'reject_reason', '')), '');
    if v_status not in ('approved', 'rejected') then raise exception 'invalid_item_decision'; end if;
    if v_status = 'rejected' and v_reason is null then raise exception 'reject_reason_required'; end if;

    update public.approval_batch_items
      set director_status = v_status,
          director_reject_reason = case when v_status = 'rejected' then v_reason else null end,
          decided_by = v_actor,
          decided_at = now()
    where id = v_item_id and batch_id = p_batch_id
      and removed_at is null and director_status = 'pending';
    if not found then raise exception 'pending_batch_item_not_found:%', v_item_id; end if;
    v_updated := v_updated + 1;
  end loop;

  select count(*) filter (where director_status = 'pending'),
         count(*) filter (where director_status = 'rejected')
    into v_pending, v_rejected
  from public.approval_batch_items
  where batch_id = p_batch_id and removed_at is null;

  if v_pending = 0 then
    v_final_status := case when v_rejected > 0 then 'partially_approved' else 'approved' end;
    update public.approval_batches
      set status = v_final_status, decided_by = v_actor, decided_at = now()
    where id = p_batch_id;
  else
    v_final_status := 'submitted';
  end if;

  return jsonb_build_object(
    'batch_id', p_batch_id, 'status', v_final_status,
    'updated_items', v_updated, 'pending_items', v_pending, 'rejected_items', v_rejected
  );
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
begin
  v_actor := public.approval_batch_require_finance();
  select status into v_status from public.approval_batches where id = p_batch_id for update;
  if v_status is null then raise exception 'batch_not_found'; end if;
  if v_status not in ('approved', 'partially_approved') then raise exception 'batch_not_ready_to_close'; end if;
  update public.approval_batches
    set status = 'closed', closed_by = v_actor, closed_at = now()
  where id = p_batch_id;
  return jsonb_build_object('batch_id', p_batch_id, 'status', 'closed');
end
$$;

create or replace function public.get_approval_batch_detail(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
begin
  v_actor := public.approval_batch_require_actor();
  select * into v_batch from public.approval_batches where id = p_batch_id;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.director_id <> v_actor
     and not public.current_user_has_role(public.flux_finance_roles()) then
    raise exception 'batch_access_denied';
  end if;

  return jsonb_build_object(
    'batch', (
      select jsonb_build_object(
        'id', ab.id, 'company_id', ab.company_id,
        'company_name', coalesce(nullif(btrim(c.legal_name), ''), c.name),
        'label', ab.label, 'period_start', ab.period_start, 'period_end', ab.period_end,
        'status', ab.status, 'director_id', ab.director_id,
        'director_name', dp.full_name, 'director_email', dp.email,
        'created_by', ab.created_by, 'submitted_at', ab.submitted_at,
        'decided_at', ab.decided_at, 'closed_at', ab.closed_at, 'notes', ab.notes,
        'can_finance_manage', public.current_user_has_role(public.flux_finance_roles()),
        'can_director_decide', ab.director_id = v_actor
      )
      from public.approval_batches ab
      join public.companies c on c.id = ab.company_id
      join public.profiles dp on dp.id = ab.director_id
      where ab.id = p_batch_id
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', abi.id, 'payment_request_id', pr.id,
        'request_number', pr.request_number,
        'provider_name', coalesce(nullif(btrim(p.alias), ''), p.nombre_completo),
        'company_name', coalesce(nullif(btrim(c.legal_name), ''), c.name),
        'cost_center', coalesce(nullif(btrim(cc.code), '') || ' - ', '') || cc.name,
        'budget_category', coalesce(nullif(btrim(bc.code), '') || ' - ', '') || bc.name,
        'payment_method', coalesce(
          nullif(to_jsonb(pr) ->> 'payment_method', ''),
          nullif(to_jsonb(pr) ->> 'request_type', ''),
          p.metodo_pago::text, 'otro'
        ),
        'currency', pr.currency, 'amount', pr.amount_requested,
        'request_status', pr.status, 'director_status', abi.director_status,
        'reject_reason', abi.director_reject_reason,
        'requester_name', requester.full_name,
        'finance_reviewed_at', abi.finance_reviewed_at,
        'decided_at', abi.decided_at
      ) order by pr.request_number, abi.created_at)
      from public.approval_batch_items abi
      join public.payment_requests pr on pr.id = abi.payment_request_id
      join public.companies c on c.id = pr.company_id
      left join public.proveedores p on p.id = pr.proveedor_id
      left join public.cost_centers cc on cc.id = pr.cost_center_id
      left join public.budget_categories bc on bc.id = pr.budget_category_id
      left join public.profiles requester on requester.id = pr.requested_by
      where abi.batch_id = p_batch_id and abi.removed_at is null
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.list_finance_approval_batches(p_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.approval_batch_require_finance();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', ab.id, 'label', ab.label, 'company_id', ab.company_id,
      'company_name', coalesce(nullif(btrim(c.legal_name), ''), c.name),
      'status', ab.status, 'period_start', ab.period_start, 'period_end', ab.period_end,
      'director_id', ab.director_id, 'director_name', dp.full_name,
      'item_count', (select count(*) from public.approval_batch_items i where i.batch_id = ab.id and i.removed_at is null),
      'total_amount', (select coalesce(sum(pr.amount_requested), 0) from public.approval_batch_items i join public.payment_requests pr on pr.id = i.payment_request_id where i.batch_id = ab.id and i.removed_at is null),
      'created_at', ab.created_at
    ) order by ab.created_at desc)
    from public.approval_batches ab
    join public.companies c on c.id = ab.company_id
    join public.profiles dp on dp.id = ab.director_id
    where p_status is null or ab.status = p_status
  ), '[]'::jsonb);
end
$$;

create or replace function public.list_director_approval_batches(p_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
begin
  v_actor := public.approval_batch_require_actor();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', ab.id, 'label', ab.label, 'company_id', ab.company_id,
      'company_name', coalesce(nullif(btrim(c.legal_name), ''), c.name),
      'status', ab.status, 'period_start', ab.period_start, 'period_end', ab.period_end,
      'item_count', (select count(*) from public.approval_batch_items i where i.batch_id = ab.id and i.removed_at is null),
      'total_amount', (select coalesce(sum(pr.amount_requested), 0) from public.approval_batch_items i join public.payment_requests pr on pr.id = i.payment_request_id where i.batch_id = ab.id and i.removed_at is null),
      'submitted_at', ab.submitted_at
    ) order by ab.created_at desc)
    from public.approval_batches ab
    join public.companies c on c.id = ab.company_id
    where ab.director_id = v_actor
      and (p_status is null or ab.status = p_status)
  ), '[]'::jsonb);
end
$$;

create or replace function public.insert_approval_batch_notification(
  p_event_type text,
  p_source_table text,
  p_source_id uuid,
  p_source_folio text,
  p_recipient_type text,
  p_recipient_profile_id uuid,
  p_recipient_email text,
  p_recipient_role text,
  p_subject text,
  p_payload jsonb,
  p_idempotency_key text,
  p_priority text default 'normal'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_recipient_email, ''))), '');
begin
  insert into public.notification_events(
    event_type, source_table, source_id, source_folio,
    recipient_type, recipient_profile_id, recipient_email, recipient_role,
    channel, priority, subject, payload, idempotency_key,
    status, next_attempt_at, last_error
  ) values (
    p_event_type, p_source_table, p_source_id, p_source_folio,
    p_recipient_type, p_recipient_profile_id, v_email, p_recipient_role,
    'email', p_priority, p_subject, coalesce(p_payload, '{}'::jsonb), p_idempotency_key,
    case when v_email is null then 'dead_letter' else 'pending' end,
    case when v_email is null then null else now() end,
    case when v_email is null then 'missing_recipient_email' else null end
  ) on conflict (idempotency_key) do nothing;
end
$$;

create or replace function public.enqueue_approval_batch_status_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_name text;
  v_director public.profiles%rowtype;
  v_recipient record;
  v_total numeric;
  v_count integer;
  v_event_type text;
  v_has_recipient boolean := false;
begin
  if old.status = new.status then return new; end if;
  select coalesce(nullif(btrim(legal_name), ''), name) into v_company_name
  from public.companies where id = new.company_id;
  select * into v_director from public.profiles where id = new.director_id;
  select count(*), coalesce(sum(pr.amount_requested), 0)
    into v_count, v_total
  from public.approval_batch_items abi
  join public.payment_requests pr on pr.id = abi.payment_request_id
  where abi.batch_id = new.id and abi.removed_at is null;

  if new.status = 'submitted' then
    perform public.insert_approval_batch_notification(
      'approval_batch.submitted', 'approval_batches', new.id, new.label,
      'administrador_sistema', v_director.id, v_director.email, 'direccion',
      'Corte semanal por autorizar: ' || new.label,
      jsonb_build_object('batch_label', new.label, 'company', v_company_name,
        'period_start', new.period_start, 'period_end', new.period_end,
        'item_count', v_count, 'amount', v_total, 'status', new.status,
        'path', '/approval_batches.html'),
      'approval_batch.submitted:' || new.id::text || ':' || new.director_id::text,
      'high'
    );
  elsif new.status in ('approved', 'partially_approved') then
    v_event_type := case when new.status = 'approved'
      then 'approval_batch.approved' else 'approval_batch.partially_approved' end;
    for v_recipient in
      select distinct on (lower(btrim(p.email))) p.id, p.email
      from public.profiles p
      join public.user_roles ur on ur.profile_id = p.id
      join public.roles r on r.id = ur.role_id
      where coalesce(p.active, true)
        and nullif(btrim(p.email), '') is not null
        and lower(btrim(r.name)) = any (public.flux_finance_roles())
      order by lower(btrim(p.email)), p.id
    loop
      v_has_recipient := true;
      perform public.insert_approval_batch_notification(
        v_event_type, 'approval_batches', new.id, new.label,
        'administrador_sistema', v_recipient.id, v_recipient.email, 'finanzas',
        case when new.status = 'approved' then 'Corte semanal aprobado: ' else 'Corte semanal con rechazos: ' end || new.label,
        jsonb_build_object('batch_label', new.label, 'company', v_company_name,
          'period_start', new.period_start, 'period_end', new.period_end,
          'item_count', v_count, 'amount', v_total, 'status', new.status,
          'path', '/approval_batches.html'),
        v_event_type || ':' || new.id::text || ':' || v_recipient.id::text,
        'high'
      );
    end loop;
    if not v_has_recipient then
      perform public.insert_approval_batch_notification(
        v_event_type, 'approval_batches', new.id, new.label,
        'administrador_sistema', null, null, 'finanzas',
        'Corte semanal sin destinatario de Finanzas: ' || new.label,
        jsonb_build_object('batch_label', new.label, 'company', v_company_name,
          'status', new.status, 'path', '/approval_batches.html'),
        v_event_type || ':' || new.id::text || ':missing_finance',
        'high'
      );
    end if;
  end if;
  return new;
end
$$;

create trigger enqueue_approval_batch_status_notifications
  after update of status on public.approval_batches
  for each row execute function public.enqueue_approval_batch_status_notifications();

create or replace function public.enqueue_approval_batch_item_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch public.approval_batches%rowtype;
  v_request public.payment_requests%rowtype;
  v_company_name text;
  v_provider_name text;
  v_recipient record;
  v_has_recipient boolean := false;
begin
  if new.director_status <> 'rejected' or old.director_status = 'rejected' then return new; end if;
  select * into v_batch from public.approval_batches where id = new.batch_id;
  select * into v_request from public.payment_requests where id = new.payment_request_id;
  select coalesce(nullif(btrim(legal_name), ''), name) into v_company_name
  from public.companies where id = v_batch.company_id;
  select coalesce(nullif(btrim(alias), ''), nombre_completo) into v_provider_name
  from public.proveedores where id = v_request.proveedor_id;

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
      'approval_batch.item_rejected', 'approval_batch_items', new.id,
      v_request.request_number, v_recipient.recipient_type,
      v_recipient.id, v_recipient.email, v_recipient.recipient_role,
      'Pago rechazado en corte: ' || coalesce(v_request.request_number, new.id::text),
      jsonb_build_object('batch_label', v_batch.label, 'company', v_company_name,
        'folio', v_request.request_number, 'provider', v_provider_name,
        'amount', v_request.amount_requested, 'currency', v_request.currency,
        'status', new.director_status, 'decision_comment', new.director_reject_reason,
        'decision_label', 'Motivo de rechazo', 'path', '/approval_batches.html'),
      'approval_batch.item_rejected:' || new.id::text || ':' || v_recipient.id::text,
      'high'
    );
  end loop;
  if not v_has_recipient then
    perform public.insert_approval_batch_notification(
      'approval_batch.item_rejected', 'approval_batch_items', new.id,
      v_request.request_number, 'administrador_sistema', null, null, 'finanzas',
      'Pago rechazado sin destinatario: ' || coalesce(v_request.request_number, new.id::text),
      jsonb_build_object('batch_label', v_batch.label, 'company', v_company_name,
        'folio', v_request.request_number, 'status', new.director_status,
        'decision_comment', new.director_reject_reason,
        'decision_label', 'Motivo de rechazo', 'path', '/approval_batches.html'),
      'approval_batch.item_rejected:' || new.id::text || ':missing_recipient',
      'high'
    );
  end if;
  return new;
end
$$;

create trigger enqueue_approval_batch_item_notification
  after update of director_status on public.approval_batch_items
  for each row execute function public.enqueue_approval_batch_item_notification();

revoke all on function public.set_approval_batch_updated_at() from public, anon, authenticated;
revoke all on function public.approval_batch_require_actor() from public, anon, authenticated;
revoke all on function public.approval_batch_require_finance() from public, anon, authenticated;
revoke all on function public.approval_batch_request_base_eligible(uuid) from public, anon, authenticated;
revoke all on function public.approval_batch_request_open_elsewhere(uuid, uuid) from public, anon, authenticated;
revoke all on function public.validate_approval_batch_item() from public, anon, authenticated;
revoke all on function public.approval_batch_assert_execution_authorized() from public, anon, authenticated;
revoke all on function public.insert_approval_batch_notification(text, text, uuid, text, text, uuid, text, text, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.enqueue_approval_batch_status_notifications() from public, anon, authenticated;
revoke all on function public.enqueue_approval_batch_item_notification() from public, anon, authenticated;

revoke all on function public.list_company_directors(uuid) from public, anon;
revoke all on function public.set_company_director(uuid, uuid, boolean) from public, anon;
revoke all on function public.create_approval_batch(uuid, text, date, date, uuid, text) from public, anon;
revoke all on function public.list_batch_eligible_requests(uuid) from public, anon;
revoke all on function public.add_request_to_approval_batch(uuid, uuid) from public, anon;
revoke all on function public.remove_request_from_approval_batch(uuid, uuid) from public, anon;
revoke all on function public.submit_approval_batch(uuid) from public, anon;
revoke all on function public.get_approval_batch_detail(uuid) from public, anon;
revoke all on function public.approve_entire_batch(uuid) from public, anon;
revoke all on function public.decide_approval_batch_items(uuid, jsonb) from public, anon;
revoke all on function public.close_approval_batch(uuid) from public, anon;
revoke all on function public.list_finance_approval_batches(text) from public, anon;
revoke all on function public.list_director_approval_batches(text) from public, anon;

grant execute on function public.list_company_directors(uuid) to authenticated;
grant execute on function public.set_company_director(uuid, uuid, boolean) to authenticated;
grant execute on function public.create_approval_batch(uuid, text, date, date, uuid, text) to authenticated;
grant execute on function public.list_batch_eligible_requests(uuid) to authenticated;
grant execute on function public.add_request_to_approval_batch(uuid, uuid) to authenticated;
grant execute on function public.remove_request_from_approval_batch(uuid, uuid) to authenticated;
grant execute on function public.submit_approval_batch(uuid) to authenticated;
grant execute on function public.get_approval_batch_detail(uuid) to authenticated;
grant execute on function public.approve_entire_batch(uuid) to authenticated;
grant execute on function public.decide_approval_batch_items(uuid, jsonb) to authenticated;
grant execute on function public.close_approval_batch(uuid) to authenticated;
grant execute on function public.list_finance_approval_batches(text) to authenticated;
grant execute on function public.list_director_approval_batches(text) to authenticated;

do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename in (
    'company_directors', 'approval_batches', 'approval_batch_items'
  )) <> 3 then
    raise exception '021_postcheck: se esperaban exactamente tres policies de lectura';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'require_batch_for_payment_layout_line' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'require_batch_for_cash_fund' and not tgisinternal) then
    raise exception '021_postcheck: faltan gates de ejecucion';
  end if;
end
$$;

commit;
