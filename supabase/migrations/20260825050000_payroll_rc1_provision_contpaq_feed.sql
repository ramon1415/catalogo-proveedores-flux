-- Payroll RC1: automatic provision + normalized CONTPAQ accounting feeds.
-- DEV-first. No historical payroll backfill. Existing materialized shadow evidence remains untouched.
-- Accounting correction: payment discharges payroll liabilities; provision policy remains configurable/dynamic until Denise confirms the live ~17% criterion.

insert into public.budget_categories(code,name,active)
values('PAYROLL_PROVISION','Provisiones de nómina',true)
on conflict(code) do nothing;

create table if not exists public.payroll_provision_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  calculation_policy text not null default 'pending' check (calculation_policy in ('pending','configured_components','server_calculated_components')),
  configured_aguinaldo_factor numeric(12,8),
  configured_vacation_premium_factor numeric(12,8),
  budget_category_id uuid not null references public.budget_categories(id),
  posting_month_rule text not null default 'period_end_month' check (posting_month_rule='period_end_month'),
  active boolean not null default true,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  check (
    (calculation_policy='pending' and configured_aguinaldo_factor is null and configured_vacation_premium_factor is null)
    or
    (calculation_policy='server_calculated_components' and configured_aguinaldo_factor is null and configured_vacation_premium_factor is null)
    or
    (calculation_policy='configured_components'
      and configured_aguinaldo_factor is not null and configured_aguinaldo_factor >= 0
      and configured_vacation_premium_factor is not null and configured_vacation_premium_factor >= 0
      and configured_aguinaldo_factor + configured_vacation_premium_factor > 0
      and configured_aguinaldo_factor + configured_vacation_premium_factor < 1)
  )
);

create table if not exists public.payroll_provision_entries (
  payment_request_id uuid primary key references public.payment_requests(id) on delete restrict,
  company_id uuid not null references public.companies(id),
  cost_center_id uuid not null references public.cost_centers(id),
  budget_version_id uuid not null references public.budget_versions(id),
  budget_category_id uuid not null references public.budget_categories(id),
  budget_line_id uuid not null references public.budget_lines(id),
  provision_month date not null,
  provision_base_amount numeric(18,2) not null check (provision_base_amount > 0),
  calculation_policy text not null check (calculation_policy in ('configured_components','server_calculated_components')),
  policy_version text not null,
  aguinaldo_factor numeric(12,8) not null check (aguinaldo_factor >= 0),
  vacation_premium_factor numeric(12,8) not null check (vacation_premium_factor >= 0),
  combined_factor numeric(12,8) not null check (combined_factor > 0 and combined_factor < 1),
  aguinaldo_amount numeric(18,2) not null check (aguinaldo_amount >= 0),
  vacation_premium_amount numeric(18,2) not null check (vacation_premium_amount >= 0),
  provision_amount numeric(18,2) not null check (provision_amount > 0),
  budget_line_amount_before numeric(18,2) not null,
  budget_line_amount_after numeric(18,2) not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  check (combined_factor = aguinaldo_factor + vacation_premium_factor),
  check (provision_amount = aguinaldo_amount + vacation_premium_amount)
);

-- Company + Cost Center mappings. Payment roles discharge liabilities; provision roles create the daily provision entry.
create table if not exists public.payroll_contpaq_role_mappings (
  company_id uuid not null references public.companies(id) on delete cascade,
  cost_center_id uuid not null references public.cost_centers(id) on delete cascade,
  role text not null check (role in (
    'salary_payable','vouchers_payable','toka_fee_expense','input_vat','toka_variance',
    'provision_aguinaldo_expense','provision_aguinaldo_liability',
    'provision_vacation_premium_expense','provision_vacation_premium_liability'
  )),
  contpaq_account_code text not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(company_id,cost_center_id,role),
  foreign key(company_id,contpaq_account_code) references public.contpaq_accounts(company_id,code)
);

-- Bank credit is scoped by the exact source bank account selected on the payroll request.
create table if not exists public.payroll_contpaq_bank_mappings (
  company_bank_account_id uuid primary key references public.company_bank_accounts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  contpaq_account_code text not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  foreign key(company_id,contpaq_account_code) references public.contpaq_accounts(company_id,code)
);

alter table public.payroll_provision_settings enable row level security;
alter table public.payroll_provision_entries enable row level security;
alter table public.payroll_contpaq_role_mappings enable row level security;
alter table public.payroll_contpaq_bank_mappings enable row level security;

revoke all on public.payroll_provision_settings from public,anon,authenticated;
revoke all on public.payroll_provision_entries from public,anon,authenticated;
revoke all on public.payroll_contpaq_role_mappings from public,anon,authenticated;
revoke all on public.payroll_contpaq_bank_mappings from public,anon,authenticated;
grant select on public.payroll_provision_settings to authenticated;
grant select on public.payroll_provision_entries to authenticated;
grant select on public.payroll_contpaq_role_mappings to authenticated;
grant select on public.payroll_contpaq_bank_mappings to authenticated;

drop policy if exists payroll_provision_settings_finance_read on public.payroll_provision_settings;
create policy payroll_provision_settings_finance_read on public.payroll_provision_settings for select to authenticated
using (public.payroll_has_finance_pii_access() and public.has_active_company_membership(public.current_profile_id(),company_id));

drop policy if exists payroll_provision_entries_finance_read on public.payroll_provision_entries;
create policy payroll_provision_entries_finance_read on public.payroll_provision_entries for select to authenticated
using (public.payroll_has_finance_pii_access() and public.has_active_company_membership(public.current_profile_id(),company_id));

drop policy if exists payroll_contpaq_role_mappings_finance_read on public.payroll_contpaq_role_mappings;
create policy payroll_contpaq_role_mappings_finance_read on public.payroll_contpaq_role_mappings for select to authenticated
using (public.payroll_has_finance_pii_access() and public.has_active_company_membership(public.current_profile_id(),company_id));

drop policy if exists payroll_contpaq_bank_mappings_finance_read on public.payroll_contpaq_bank_mappings;
create policy payroll_contpaq_bank_mappings_finance_read on public.payroll_contpaq_bank_mappings for select to authenticated
using (public.payroll_has_finance_pii_access() and public.has_active_company_membership(public.current_profile_id(),company_id));

create or replace function public.configure_payroll_provision(
  p_company_id uuid,
  p_calculation_policy text,
  p_aguinaldo_factor numeric default null,
  p_vacation_premium_factor numeric default null
) returns jsonb
language plpgsql security definer set search_path='public','pg_temp'
as $$
declare
  v_actor uuid:=public.current_profile_id();
  v_category_id uuid;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,p_company_id) then raise exception 'PAYROLL_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if p_calculation_policy not in ('configured_components','server_calculated_components') then raise exception 'PAYROLL_PROVISION_POLICY_INVALID'; end if;
  if p_calculation_policy='configured_components' then
    if p_aguinaldo_factor is null or p_vacation_premium_factor is null
       or p_aguinaldo_factor<0 or p_vacation_premium_factor<0
       or p_aguinaldo_factor+p_vacation_premium_factor<=0
       or p_aguinaldo_factor+p_vacation_premium_factor>=1 then raise exception 'PAYROLL_PROVISION_FACTOR_INVALID'; end if;
  else
    if p_aguinaldo_factor is not null or p_vacation_premium_factor is not null then raise exception 'PAYROLL_PROVISION_SERVER_POLICY_MUST_NOT_STORE_FACTORS'; end if;
  end if;
  select id into v_category_id from public.budget_categories where code='PAYROLL_PROVISION' and active;
  if v_category_id is null then raise exception 'PAYROLL_PROVISION_CATEGORY_REQUIRED'; end if;
  insert into public.payroll_provision_settings(company_id,calculation_policy,configured_aguinaldo_factor,configured_vacation_premium_factor,budget_category_id,posting_month_rule,active,updated_by,updated_at)
  values(p_company_id,p_calculation_policy,p_aguinaldo_factor,p_vacation_premium_factor,v_category_id,'period_end_month',true,v_actor,now())
  on conflict(company_id) do update set calculation_policy=excluded.calculation_policy,
    configured_aguinaldo_factor=excluded.configured_aguinaldo_factor,
    configured_vacation_premium_factor=excluded.configured_vacation_premium_factor,
    budget_category_id=excluded.budget_category_id,posting_month_rule='period_end_month',active=true,updated_by=v_actor,updated_at=now();
  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values('payroll_provision_config',p_company_id,'configure',null,
    jsonb_build_object('redacted',true,'operation','configure_payroll_provision','calculation_policy',p_calculation_policy),v_actor,
    'Payroll provision policy configured; activity log omits factor values.');
  return jsonb_build_object('status','configured','company_id',p_company_id,'calculation_policy',p_calculation_policy,
    'budget_category_id',v_category_id,'posting_month_rule','period_end_month');
end;
$$;
revoke all on function public.configure_payroll_provision(uuid,text,numeric,numeric) from public,anon;
grant execute on function public.configure_payroll_provision(uuid,text,numeric,numeric) to authenticated;

create or replace function public.configure_payroll_contpaq_role(
  p_company_id uuid,
  p_cost_center_id uuid,
  p_role text,
  p_contpaq_account_code text
) returns jsonb
language plpgsql security definer set search_path='public','pg_temp'
as $$
declare v_actor uuid:=public.current_profile_id();
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,p_company_id) then raise exception 'PAYROLL_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if not exists(select 1 from public.company_cost_centers where company_id=p_company_id and cost_center_id=p_cost_center_id and active) then
    raise exception 'PAYROLL_COST_CENTER_SCOPE_REQUIRED';
  end if;
  if p_role not in (
    'salary_payable','vouchers_payable','toka_fee_expense','input_vat','toka_variance',
    'provision_aguinaldo_expense','provision_aguinaldo_liability',
    'provision_vacation_premium_expense','provision_vacation_premium_liability'
  ) then raise exception 'PAYROLL_CONTPAQ_ROLE_INVALID'; end if;
  if not exists(select 1 from public.contpaq_accounts where company_id=p_company_id and code=p_contpaq_account_code and is_detail) then
    raise exception 'PAYROLL_CONTPAQ_DETAIL_ACCOUNT_REQUIRED';
  end if;
  insert into public.payroll_contpaq_role_mappings(company_id,cost_center_id,role,contpaq_account_code,updated_by,updated_at)
  values(p_company_id,p_cost_center_id,p_role,p_contpaq_account_code,v_actor,now())
  on conflict(company_id,cost_center_id,role) do update set contpaq_account_code=excluded.contpaq_account_code,updated_by=v_actor,updated_at=now();
  return jsonb_build_object('status','configured','company_id',p_company_id,'cost_center_id',p_cost_center_id,'role',p_role,'contpaq_account_code',p_contpaq_account_code);
end;
$$;
revoke all on function public.configure_payroll_contpaq_role(uuid,uuid,text,text) from public,anon;
grant execute on function public.configure_payroll_contpaq_role(uuid,uuid,text,text) to authenticated;

create or replace function public.configure_payroll_contpaq_bank(
  p_company_bank_account_id uuid,
  p_contpaq_account_code text
) returns jsonb
language plpgsql security definer set search_path='public','pg_temp'
as $$
declare v_actor uuid:=public.current_profile_id(); v_company_id uuid;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select company_id into v_company_id from public.company_bank_accounts where id=p_company_bank_account_id and active;
  if v_company_id is null then raise exception 'PAYROLL_SOURCE_BANK_ACCOUNT_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_company_id) then raise exception 'PAYROLL_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if not exists(select 1 from public.contpaq_accounts where company_id=v_company_id and code=p_contpaq_account_code and is_detail) then
    raise exception 'PAYROLL_CONTPAQ_DETAIL_ACCOUNT_REQUIRED';
  end if;
  insert into public.payroll_contpaq_bank_mappings(company_bank_account_id,company_id,contpaq_account_code,updated_by,updated_at)
  values(p_company_bank_account_id,v_company_id,p_contpaq_account_code,v_actor,now())
  on conflict(company_bank_account_id) do update set company_id=excluded.company_id,contpaq_account_code=excluded.contpaq_account_code,updated_by=v_actor,updated_at=now();
  return jsonb_build_object('status','configured','company_id',v_company_id,'company_bank_account_id',p_company_bank_account_id,'contpaq_account_code',p_contpaq_account_code);
end;
$$;
revoke all on function public.configure_payroll_contpaq_bank(uuid,text) from public,anon;
grant execute on function public.configure_payroll_contpaq_bank(uuid,text) to authenticated;

create or replace function public.post_payroll_provision_internal(
  p_payment_request_id uuid,
  p_base_amount_minor bigint,
  p_server_aguinaldo_factor numeric default null,
  p_server_vacation_premium_factor numeric default null,
  p_policy_version text default null
) returns jsonb
language plpgsql security definer set search_path='public','pg_temp'
as $$
declare
  v_request public.payment_requests%rowtype;
  v_setting public.payroll_provision_settings%rowtype;
  v_existing public.payroll_provision_entries%rowtype;
  v_budget_version public.budget_versions%rowtype;
  v_budget_month date;
  v_base numeric(18,2);
  v_aguinaldo_factor numeric(12,8);
  v_vacation_factor numeric(12,8);
  v_combined_factor numeric(12,8);
  v_aguinaldo numeric(18,2);
  v_vacation numeric(18,2);
  v_provision numeric(18,2);
  v_policy_version text;
  v_before numeric(18,2):=0;
  v_after numeric(18,2);
  v_budget_line_id uuid;
  v_count integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PAYROLL_PROVISION_SERVICE_ROLE_REQUIRED'; end if;
  if p_base_amount_minor is null or p_base_amount_minor<=0 then raise exception 'PAYROLL_PROVISION_BASE_REQUIRED'; end if;

  select * into v_existing from public.payroll_provision_entries where payment_request_id=p_payment_request_id;
  if found then
    return jsonb_build_object('status','already_posted','payment_request_id',p_payment_request_id,'provision_amount',v_existing.provision_amount,
      'calculation_policy',v_existing.calculation_policy,'policy_version',v_existing.policy_version);
  end if;

  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.payroll_period_end is null or v_request.cost_center_id is null then raise exception 'PAYROLL_PROVISION_CONTEXT_REQUIRED'; end if;

  select * into v_setting from public.payroll_provision_settings where company_id=v_request.company_id and active;
  if not found or v_setting.calculation_policy='pending' then raise exception 'PAYROLL_PROVISION_POLICY_REQUIRED'; end if;

  if v_setting.calculation_policy='configured_components' then
    v_aguinaldo_factor:=v_setting.configured_aguinaldo_factor;
    v_vacation_factor:=v_setting.configured_vacation_premium_factor;
    v_policy_version:='configured-components-v1';
  elsif v_setting.calculation_policy='server_calculated_components' then
    v_aguinaldo_factor:=p_server_aguinaldo_factor;
    v_vacation_factor:=p_server_vacation_premium_factor;
    v_policy_version:=nullif(btrim(coalesce(p_policy_version,'')),'');
    if v_aguinaldo_factor is null or v_vacation_factor is null or v_policy_version is null then
      raise exception 'PAYROLL_PROVISION_SERVER_CALCULATION_REQUIRED';
    end if;
  else
    raise exception 'PAYROLL_PROVISION_POLICY_REQUIRED';
  end if;

  if v_aguinaldo_factor<0 or v_vacation_factor<0
     or v_aguinaldo_factor+v_vacation_factor<=0
     or v_aguinaldo_factor+v_vacation_factor>=1 then raise exception 'PAYROLL_PROVISION_FACTOR_INVALID'; end if;
  v_combined_factor:=v_aguinaldo_factor+v_vacation_factor;

  select count(*) into v_count from public.budget_versions where active and year=extract(year from v_request.payroll_period_end)::integer;
  if v_count<>1 then raise exception 'PAYROLL_PROVISION_ACTIVE_BUDGET_VERSION_REQUIRED'; end if;
  select * into v_budget_version from public.budget_versions where active and year=extract(year from v_request.payroll_period_end)::integer limit 1;
  if v_budget_version.locked then raise exception 'PAYROLL_PROVISION_BUDGET_VERSION_LOCKED'; end if;

  v_budget_month:=date_trunc('month',v_request.payroll_period_end)::date;
  v_base:=p_base_amount_minor/100.0;
  v_aguinaldo:=round(v_base*v_aguinaldo_factor,2);
  v_vacation:=round(v_base*v_vacation_factor,2);
  v_provision:=v_aguinaldo+v_vacation;
  if v_provision<=0 then raise exception 'PAYROLL_PROVISION_AMOUNT_INVALID'; end if;

  select id,amount into v_budget_line_id,v_before from public.budget_lines
  where budget_version_id=v_budget_version.id and company_id=v_request.company_id and cost_center_id=v_request.cost_center_id
    and budget_category_id=v_setting.budget_category_id and budget_month=v_budget_month for update;
  if found then
    v_after:=v_before+v_provision;
    update public.budget_lines set amount=v_after where id=v_budget_line_id;
  else
    v_before:=0; v_after:=v_provision;
    insert into public.budget_lines(budget_version_id,company_id,cost_center_id,budget_category_id,budget_month,amount)
    values(v_budget_version.id,v_request.company_id,v_request.cost_center_id,v_setting.budget_category_id,v_budget_month,v_after)
    returning id into v_budget_line_id;
  end if;

  insert into public.payroll_provision_entries(payment_request_id,company_id,cost_center_id,budget_version_id,budget_category_id,budget_line_id,
    provision_month,provision_base_amount,calculation_policy,policy_version,aguinaldo_factor,vacation_premium_factor,combined_factor,
    aguinaldo_amount,vacation_premium_amount,provision_amount,budget_line_amount_before,budget_line_amount_after,created_by)
  values(v_request.id,v_request.company_id,v_request.cost_center_id,v_budget_version.id,v_setting.budget_category_id,v_budget_line_id,
    v_budget_month,v_base,v_setting.calculation_policy,v_policy_version,v_aguinaldo_factor,v_vacation_factor,v_combined_factor,
    v_aguinaldo,v_vacation,v_provision,v_before,v_after,v_request.requested_by);

  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values('payroll_provision',v_request.id,'post',null,
    jsonb_build_object('redacted',true,'operation','automatic_payroll_provision','calculation_policy',v_setting.calculation_policy,'policy_version',v_policy_version),
    v_request.requested_by,'Automatic payroll provision posted from server-derived cover base. Activity log omits salary/base/factor values.');

  return jsonb_build_object('status','posted','payment_request_id',v_request.id,'provision_amount',v_provision,'provision_month',v_budget_month,
    'aguinaldo_amount',v_aguinaldo,'vacation_premium_amount',v_vacation,'calculation_policy',v_setting.calculation_policy,'policy_version',v_policy_version,
    'budget_category_id',v_setting.budget_category_id,'budget_line_id',v_budget_line_id);
end;
$$;
revoke all on function public.post_payroll_provision_internal(uuid,bigint,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.post_payroll_provision_internal(uuid,bigint,numeric,numeric,text) to service_role;

create or replace function public.get_payroll_provision_summary(p_payment_request_id uuid)
returns jsonb
language plpgsql security definer set search_path='public','pg_temp'
as $$
declare v_actor uuid:=public.current_profile_id(); v_entry public.payroll_provision_entries%rowtype;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select e.* into v_entry from public.payroll_provision_entries e join public.payment_requests pr on pr.id=e.payment_request_id
  where e.payment_request_id=p_payment_request_id and public.has_active_company_membership(v_actor,pr.company_id);
  if not found then return jsonb_build_object('status','not_posted','payment_request_id',p_payment_request_id); end if;
  return jsonb_build_object('status','posted','payment_request_id',v_entry.payment_request_id,'provision_month',v_entry.provision_month,
    'provision_base_amount',v_entry.provision_base_amount,'calculation_policy',v_entry.calculation_policy,'policy_version',v_entry.policy_version,
    'aguinaldo_factor',v_entry.aguinaldo_factor,'vacation_premium_factor',v_entry.vacation_premium_factor,'combined_factor',v_entry.combined_factor,
    'aguinaldo_amount',v_entry.aguinaldo_amount,'vacation_premium_amount',v_entry.vacation_premium_amount,'provision_amount',v_entry.provision_amount,
    'budget_line_amount_before',v_entry.budget_line_amount_before,'budget_line_amount_after',v_entry.budget_line_amount_after);
end;
$$;
revoke all on function public.get_payroll_provision_summary(uuid) from public,anon;
grant execute on function public.get_payroll_provision_summary(uuid) to authenticated;

create or replace function public.payroll_contpaq_account_for_role_internal(p_company_id uuid,p_cost_center_id uuid,p_role text)
returns text language plpgsql security definer set search_path='public','pg_temp'
as $$
declare v_code text;
begin
  select m.contpaq_account_code into v_code from public.payroll_contpaq_role_mappings m
  join public.contpaq_accounts a on a.company_id=m.company_id and a.code=m.contpaq_account_code and a.is_detail
  where m.company_id=p_company_id and m.cost_center_id=p_cost_center_id and m.role=p_role;
  if v_code is null then raise exception 'PAYROLL_CONTPAQ_MAPPING_REQUIRED: %',p_role; end if;
  return v_code;
end;
$$;
revoke all on function public.payroll_contpaq_account_for_role_internal(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.payroll_contpaq_account_for_role_internal(uuid,uuid,text) to service_role;

create or replace function public.payroll_contpaq_bank_account_internal(p_company_bank_account_id uuid)
returns text language plpgsql security definer set search_path='public','pg_temp'
as $$
declare v_code text;
begin
  select m.contpaq_account_code into v_code from public.payroll_contpaq_bank_mappings m
  join public.contpaq_accounts a on a.company_id=m.company_id and a.code=m.contpaq_account_code and a.is_detail
  where m.company_bank_account_id=p_company_bank_account_id;
  if v_code is null then raise exception 'PAYROLL_CONTPAQ_BANK_MAPPING_REQUIRED'; end if;
  return v_code;
end;
$$;
revoke all on function public.payroll_contpaq_bank_account_internal(uuid) from public,anon,authenticated;
grant execute on function public.payroll_contpaq_bank_account_internal(uuid) to service_role;

-- Payment feed: discharge payroll liabilities, never re-book payroll/vales expense.
create or replace function public.get_payroll_contpaq_feed(p_payment_request_id uuid)
returns jsonb
language plpgsql security definer set search_path='public','pg_temp'
as $$
declare
  v_actor uuid:=public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_cash numeric(18,2):=0; v_benefit numeric(18,2):=0; v_fee numeric(18,2):=0; v_tax numeric(18,2):=0;
  v_actual_toka numeric(18,2):=0; v_expected_toka numeric(18,2):=0; v_variance numeric(18,2):=0; v_debits numeric(18,2):=0; v_credits numeric(18,2):=0;
  v_lines jsonb:='[]'::jsonb; v_seq integer:=0; v_code text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if v_request.status::text<>'paid' or v_request.paid_at is null then raise exception 'PAYROLL_CONTPAQ_PAID_REQUIRED'; end if;
  if exists(select 1 from public.payroll_channels where payment_request_id=v_request.id and reconciliation_status<>'reconciled') then
    raise exception 'PAYROLL_CONTPAQ_RECONCILIATION_REQUIRED';
  end if;

  select coalesce(sum(amount),0) into v_cash from public.payroll_channels where payment_request_id=v_request.id and channel in ('banco','spei');
  select coalesce(amount,0),coalesce(benefit_amount,0),coalesce(fee_amount,0),coalesce(tax_amount,0),coalesce(expected_funding_amount,0)
  into v_actual_toka,v_benefit,v_fee,v_tax,v_expected_toka
  from public.payroll_channels where payment_request_id=v_request.id and channel='vales';
  if not found then v_actual_toka:=0;v_benefit:=0;v_fee:=0;v_tax:=0;v_expected_toka:=0; end if;
  v_variance:=v_actual_toka-v_expected_toka;

  if v_cash>0 then
    v_seq:=v_seq+1; v_code:=public.payroll_contpaq_account_for_role_internal(v_request.company_id,v_request.cost_center_id,'salary_payable');
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('sequence',v_seq,'role','salary_payable','account_code',v_code,'debit',v_cash,'credit',0,'concept','Pago nómina · descarga pasivo sueldos'));
    v_debits:=v_debits+v_cash;
  end if;
  if v_benefit>0 then
    v_seq:=v_seq+1; v_code:=public.payroll_contpaq_account_for_role_internal(v_request.company_id,v_request.cost_center_id,'vouchers_payable');
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('sequence',v_seq,'role','vouchers_payable','account_code',v_code,'debit',v_benefit,'credit',0,'concept','Pago vales · descarga pasivo'));
    v_debits:=v_debits+v_benefit;
  end if;
  if v_fee>0 then
    v_seq:=v_seq+1; v_code:=public.payroll_contpaq_account_for_role_internal(v_request.company_id,v_request.cost_center_id,'toka_fee_expense');
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('sequence',v_seq,'role','toka_fee_expense','account_code',v_code,'debit',v_fee,'credit',0,'concept','Comisión TOKA'));
    v_debits:=v_debits+v_fee;
  end if;
  if v_tax>0 then
    v_seq:=v_seq+1; v_code:=public.payroll_contpaq_account_for_role_internal(v_request.company_id,v_request.cost_center_id,'input_vat');
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('sequence',v_seq,'role','input_vat','account_code',v_code,'debit',v_tax,'credit',0,'concept','IVA acreditable TOKA'));
    v_debits:=v_debits+v_tax;
  end if;
  if v_variance<>0 then
    v_seq:=v_seq+1; v_code:=public.payroll_contpaq_account_for_role_internal(v_request.company_id,v_request.cost_center_id,'toka_variance');
    if v_variance>0 then
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object('sequence',v_seq,'role','toka_variance','account_code',v_code,'debit',v_variance,'credit',0,'concept','Variación fondeo TOKA'));
      v_debits:=v_debits+v_variance;
    else
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object('sequence',v_seq,'role','toka_variance','account_code',v_code,'debit',0,'credit',abs(v_variance),'concept','Variación fondeo TOKA'));
      v_credits:=v_credits+abs(v_variance);
    end if;
  end if;

  if v_request.company_bank_account_id is null then raise exception 'PAYROLL_SOURCE_BANK_ACCOUNT_REQUIRED'; end if;
  v_seq:=v_seq+1; v_code:=public.payroll_contpaq_bank_account_internal(v_request.company_bank_account_id);
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('sequence',v_seq,'role','bank_credit','account_code',v_code,'debit',0,'credit',v_request.amount_requested,'concept','Salida Tesorería nómina'));
  v_credits:=v_credits+v_request.amount_requested;

  if round(v_debits-v_credits,2)<>0 then raise exception 'PAYROLL_CONTPAQ_UNBALANCED_FEED'; end if;
  return jsonb_build_object('contract_version','payroll-contpaq-payment-feed-v2','source_type','payroll_payment','payment_request_id',v_request.id,
    'request_number',v_request.request_number,'company_id',v_request.company_id,'cost_center_id',v_request.cost_center_id,
    'company_bank_account_id',v_request.company_bank_account_id,'period_start',v_request.payroll_period_start,'period_end',v_request.payroll_period_end,
    'accounting_date',v_request.paid_at::date,'currency','MXN','treasury_outflow',v_request.amount_requested,
    'debit_total',v_debits,'credit_total',v_credits,'lines',v_lines,'contains_employee_pii',false);
end;
$$;
revoke all on function public.get_payroll_contpaq_feed(uuid) from public,anon;
grant execute on function public.get_payroll_contpaq_feed(uuid) to authenticated;

-- Provision feed: separate aguinaldo and vacation-premium daily entries. No account numbers are hard-coded.
create or replace function public.get_payroll_provision_contpaq_feed(p_payment_request_id uuid)
returns jsonb
language plpgsql security definer set search_path='public','pg_temp'
as $$
declare
  v_actor uuid:=public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_entry public.payroll_provision_entries%rowtype;
  v_lines jsonb:='[]'::jsonb; v_seq integer:=0; v_debits numeric(18,2):=0; v_credits numeric(18,2):=0; v_code text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  select * into v_entry from public.payroll_provision_entries where payment_request_id=v_request.id;
  if not found then raise exception 'PAYROLL_PROVISION_NOT_POSTED'; end if;

  if v_entry.aguinaldo_amount>0 then
    v_seq:=v_seq+1; v_code:=public.payroll_contpaq_account_for_role_internal(v_request.company_id,v_request.cost_center_id,'provision_aguinaldo_expense');
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('sequence',v_seq,'role','provision_aguinaldo_expense','account_code',v_code,'debit',v_entry.aguinaldo_amount,'credit',0,'concept','Provisión aguinaldo'));
    v_debits:=v_debits+v_entry.aguinaldo_amount;
    v_seq:=v_seq+1; v_code:=public.payroll_contpaq_account_for_role_internal(v_request.company_id,v_request.cost_center_id,'provision_aguinaldo_liability');
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('sequence',v_seq,'role','provision_aguinaldo_liability','account_code',v_code,'debit',0,'credit',v_entry.aguinaldo_amount,'concept','Pasivo provisión aguinaldo'));
    v_credits:=v_credits+v_entry.aguinaldo_amount;
  end if;

  if v_entry.vacation_premium_amount>0 then
    v_seq:=v_seq+1; v_code:=public.payroll_contpaq_account_for_role_internal(v_request.company_id,v_request.cost_center_id,'provision_vacation_premium_expense');
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('sequence',v_seq,'role','provision_vacation_premium_expense','account_code',v_code,'debit',v_entry.vacation_premium_amount,'credit',0,'concept','Provisión prima vacacional'));
    v_debits:=v_debits+v_entry.vacation_premium_amount;
    v_seq:=v_seq+1; v_code:=public.payroll_contpaq_account_for_role_internal(v_request.company_id,v_request.cost_center_id,'provision_vacation_premium_liability');
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('sequence',v_seq,'role','provision_vacation_premium_liability','account_code',v_code,'debit',0,'credit',v_entry.vacation_premium_amount,'concept','Pasivo provisión prima vacacional'));
    v_credits:=v_credits+v_entry.vacation_premium_amount;
  end if;

  if round(v_debits-v_credits,2)<>0 then raise exception 'PAYROLL_PROVISION_CONTPAQ_UNBALANCED_FEED'; end if;
  return jsonb_build_object('contract_version','payroll-contpaq-provision-feed-v1','source_type','payroll_provision','payment_request_id',v_request.id,
    'request_number',v_request.request_number,'company_id',v_request.company_id,'cost_center_id',v_request.cost_center_id,
    'period_start',v_request.payroll_period_start,'period_end',v_request.payroll_period_end,'accounting_date',v_request.payroll_period_end,
    'currency','MXN','provision_amount',v_entry.provision_amount,'calculation_policy',v_entry.calculation_policy,'policy_version',v_entry.policy_version,
    'debit_total',v_debits,'credit_total',v_credits,'lines',v_lines,'contains_employee_pii',false);
end;
$$;
revoke all on function public.get_payroll_provision_contpaq_feed(uuid) from public,anon;
grant execute on function public.get_payroll_provision_contpaq_feed(uuid) to authenticated;

-- Make provision part of the same transaction as server-verified materialization.
create or replace function public.materialize_payroll_capture_internal(p_capture_session_id uuid, p_expected_version integer, p_idempotency_key_hash text, p_server_result jsonb)
returns jsonb language plpgsql security definer set search_path='public','pg_temp'
as $$
declare v_session public.payroll_capture_sessions%rowtype; v_actor uuid; v_request_id uuid; v_channel jsonb; v_file jsonb; v_line jsonb;
  v_channel_ids jsonb:='{}'::jsonb; v_file_ids jsonb:='{}'::jsonb; v_amount_minor bigint:=0; v_count integer; v_warning_codes jsonb; v_provision jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'payroll_materialization_service_role_required'; end if;
  if p_idempotency_key_hash !~ '^[0-9a-f]{64}$' then raise exception 'payroll_materialization_idempotency_invalid'; end if;
  select * into v_session from public.payroll_capture_sessions where id=p_capture_session_id for update;
  if not found then raise exception 'payroll_capture_not_found'; end if;
  if v_session.capture_state='materialized' then
    if v_session.materialization_idempotency_hash=p_idempotency_key_hash then return jsonb_build_object('status','already_materialized','payment_request_id',v_session.materialized_payment_request_id); end if;
    raise exception 'payroll_capture_already_materialized';
  end if;
  if v_session.version<>p_expected_version then raise exception 'payroll_capture_version_conflict'; end if;
  if v_session.expires_at<=now() then raise exception 'payroll_capture_expired'; end if;
  if v_session.capture_state not in ('validation_pending','ready_for_submission') then raise exception 'payroll_capture_not_materializable'; end if;
  if v_session.cost_center_id is null then raise exception 'payroll_capture_accounting_context_required'; end if;
  if p_server_result->>'contract_version'<>'payroll-normalized-v1' or coalesce((p_server_result->>'valid')::boolean,false) is not true
     or jsonb_array_length(coalesce(p_server_result->'issues','[]'::jsonb))<>0 then raise exception 'payroll_server_validation_required'; end if;
  if coalesce((p_server_result->>'provision_base_amount_minor')::bigint,0)<=0 then raise exception 'PAYROLL_PROVISION_BASE_REQUIRED'; end if;
  v_actor:=(p_server_result->>'actor_profile_id')::uuid;
  if v_actor is null then raise exception 'payroll_materialization_actor_required'; end if;
  if not exists(select 1 from public.profiles p join public.user_roles ur on ur.profile_id=p.id join public.roles r on r.id=ur.role_id
      where p.id=v_actor and p.active and lower(btrim(r.name))=any(array['finance','finanzas','treasury','tesoreria','administracion']))
     or not public.has_active_company_membership(v_actor,v_session.company_id) then raise exception 'payroll_materialization_finance_required'; end if;
  if (p_server_result->>'capture_session_id')::uuid<>v_session.id or (p_server_result->>'capture_version')::integer<>v_session.version then raise exception 'payroll_server_result_binding_mismatch'; end if;
  if not exists(select 1 from jsonb_array_elements(p_server_result->'files') x where x->>'kind'='caratula' and x->>'authority'='server_verified') then raise exception 'PAYROLL_COVER_SHEET_FORMAT_UNVERIFIED'; end if;

  select coalesce(sum((x->>'amount_minor')::bigint),0),count(*) into v_amount_minor,v_count
  from jsonb_array_elements(p_server_result->'channels') x where (x->>'amount_minor')::bigint>0;
  if v_count=0 or v_amount_minor<=0 then raise exception 'payroll_channel_totals_invalid'; end if;
  if v_count<>cardinality(v_session.expected_channels) or exists(select 1 from unnest(v_session.expected_channels) expected where not exists(
      select 1 from jsonb_array_elements(p_server_result->'channels') x where x->>'channel'=expected and (x->>'amount_minor')::bigint>0))
  then raise exception 'payroll_channel_inventory_mismatch'; end if;
  select count(*) into v_count from public.payroll_capture_files where session_id=v_session.id and is_current and upload_state='uploaded';
  if v_count<>jsonb_array_length(p_server_result->'files') then raise exception 'payroll_file_inventory_mismatch'; end if;
  if jsonb_array_length(p_server_result->'lines')=0 then raise exception 'payroll_server_lines_required'; end if;

  v_request_id:=v_session.reserved_payment_request_id;
  insert into public.payment_requests(id,request_type,requested_by,company_id,company_bank_account_id,cost_center_id,budget_category_id,budget_month,
    amount_requested,currency,exchange_rate,status,concept,description,notes,payroll_subtype,payroll_period_start,payroll_period_end,
    provider_id,proveedor_id,provider_bank_account_id,approver_id,submitted_at)
  values(v_request_id,'nomina',v_actor,v_session.company_id,v_session.company_bank_account_id,v_session.cost_center_id,v_session.budget_category_id,v_session.budget_month,
    v_amount_minor/100.0,'MXN',1,'draft',v_session.concept,v_session.concept,v_session.notes,v_session.payroll_subtype,v_session.period_start,v_session.period_end,
    null,null,null,null,null);

  for v_channel in select value from jsonb_array_elements(p_server_result->'channels') loop
    if v_channel->>'channel'<>all(v_session.expected_channels) then raise exception 'payroll_channel_inventory_mismatch'; end if;
    v_actor:=null;
    insert into public.payroll_channels(payment_request_id,channel,amount,currency,benefit_amount,fee_amount,tax_amount,expected_funding_amount)
    values(v_request_id,v_channel->>'channel',(v_channel->>'amount_minor')::bigint/100.0,'MXN',
      case when v_channel->>'channel'='vales' then (v_channel->>'benefit_amount_minor')::bigint/100.0 else null end,
      case when v_channel->>'channel'='vales' then (v_channel->>'fee_amount_minor')::bigint/100.0 else null end,
      case when v_channel->>'channel'='vales' then (v_channel->>'tax_amount_minor')::bigint/100.0 else null end,
      case when v_channel->>'channel'='vales' then (v_channel->>'expected_funding_amount_minor')::bigint/100.0 else null end)
    returning id into v_actor;
    v_channel_ids:=v_channel_ids||jsonb_build_object(v_channel->>'channel',v_actor);
  end loop;

  for v_file in select value from jsonb_array_elements(p_server_result->'files') loop
    v_actor:=null;
    insert into public.payroll_run_files(payment_request_id,payroll_channel_id,kind,storage_bucket,storage_path,original_filename,mime_type,size_bytes,sha256,
      uploaded_by,uploaded_at,parsing_status,parsing_version,parsing_metadata,capture_file_id)
    select v_request_id,case when f.channel is null then null else (v_channel_ids->>f.channel)::uuid end,f.kind,f.storage_bucket,f.storage_path,
      f.kind||'.'||f.extension,f.mime_type,f.size_bytes,v_file->>'sha256',f.uploaded_by,f.uploaded_at,'parsed',v_file->>'parser_version',
      jsonb_build_object('evidence_class','SERVER_VERIFIED','parser_version',v_file->>'parser_version','row_count',coalesce((v_file->>'record_count')::integer,0),'issue_codes','[]'::jsonb),f.id
    from public.payroll_capture_files f where f.id=(v_file->>'capture_file_id')::uuid and f.session_id=v_session.id
      and f.sha256=v_file->>'sha256' and f.is_current and f.upload_state='uploaded' returning id into v_actor;
    if v_actor is null then raise exception 'payroll_server_file_binding_mismatch'; end if;
    v_file_ids:=v_file_ids||jsonb_build_object(v_file->>'capture_file_id',v_actor);
  end loop;

  for v_line in select value from jsonb_array_elements(p_server_result->'lines') loop
    insert into public.payroll_run_lines(payment_request_id,source_file_id,source_sheet,source_row_number,extraction_version,employee_name,rfc,curp,nss,
      bank_name,bank_account,clabe,net_amount,bank_amount,spei_amount,vouchers_amount)
    values(v_request_id,(v_file_ids->>(v_line->>'source_capture_file_id'))::uuid,v_line->>'source_sheet',(v_line->>'source_row_number')::integer,
      v_line->>'extraction_version',v_line->>'employee_name',nullif(v_line->>'rfc',''),nullif(v_line->>'curp',''),nullif(v_line->>'nss',''),
      nullif(v_line->>'bank_name',''),nullif(v_line->>'bank_account',''),nullif(v_line->>'clabe',''),
      (v_line->>'net_amount_minor')::bigint/100.0,(v_line->>'bank_amount_minor')::bigint/100.0,
      (v_line->>'spei_amount_minor')::bigint/100.0,(v_line->>'vouchers_amount_minor')::bigint/100.0);
  end loop;

  update public.payroll_channels c set layout_file_id=f.id from public.payroll_run_files f
  where c.payment_request_id=v_request_id and f.payroll_channel_id=c.id
    and f.kind=case c.channel when 'banco' then 'layout_mismo_banco' when 'spei' then 'layout_spei' else 'layout_toka' end;

  v_provision:=public.post_payroll_provision_internal(
    v_request_id,
    (p_server_result->>'provision_base_amount_minor')::bigint,
    nullif(p_server_result->>'provision_aguinaldo_factor','')::numeric,
    nullif(p_server_result->>'provision_vacation_premium_factor','')::numeric,
    nullif(p_server_result->>'provision_policy_version','')
  );

  select coalesce(jsonb_agg(w->>'code'),'[]'::jsonb) into v_warning_codes
  from jsonb_array_elements(coalesce(p_server_result->'warnings','[]'::jsonb)) w;
  update public.payroll_capture_sessions set capture_state='materialized',validation_status='valid',materialized_payment_request_id=v_request_id,
    materialized_at=now(),materialized_by=(p_server_result->>'actor_profile_id')::uuid,materialization_idempotency_hash=p_idempotency_key_hash,
    server_verification_summary=jsonb_build_object('contract_version','payroll-normalized-v1','file_count',jsonb_array_length(p_server_result->'files'),
      'line_count',jsonb_array_length(p_server_result->'lines'),'parser_versions',p_server_result->'parser_versions','verified_at',p_server_result->>'verified_at',
      'warning_codes',v_warning_codes,'finance_review_required',coalesce((p_server_result->>'finance_review_required')::boolean,false),
      'provision_base_amount_minor',(p_server_result->>'provision_base_amount_minor')::bigint,'provision_status',v_provision->>'status',
      'provision_calculation_policy',v_provision->>'calculation_policy','provision_policy_version',v_provision->>'policy_version'),
    version=version+1,updated_at=now(),updated_by=(p_server_result->>'actor_profile_id')::uuid where id=v_session.id;

  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values('payroll_materialization',v_session.id,'materialize',null,jsonb_build_object('redacted',true,'operation','server_verified_materialization'),
    (p_server_result->>'actor_profile_id')::uuid,'Server verification audit contains no employee, identifier, bank account, salary, or raw-byte values.');
  if exists(select 1 from public.notification_events where source_id=v_request_id)
     or exists(select 1 from public.payment_request_approvals where payment_request_id=v_request_id)
     or exists(select 1 from public.approval_batch_items where payment_request_id=v_request_id)
  then raise exception 'payroll_materialization_side_effect_detected'; end if;
  return jsonb_build_object('status','materialized','payment_request_id',v_request_id,
    'finance_review_required',coalesce((p_server_result->>'finance_review_required')::boolean,false),
    'provision_status',v_provision->>'status','provision_calculation_policy',v_provision->>'calculation_policy');
end;
$$;

-- Keep internal materialization surface closed.
revoke all on function public.materialize_payroll_capture_internal(uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.materialize_payroll_capture_internal(uuid,integer,text,jsonb) to service_role;