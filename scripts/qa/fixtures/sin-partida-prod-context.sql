-- Isolated, fictional fixtures for the production RPC dependencies.
create schema auth;
create function auth.uid() returns uuid language sql stable set search_path = public as $$ select current_profile_id() $$;
grant usage on schema auth to authenticated, anon;
create schema storage;
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
grant usage on schema storage to authenticated;
create table employee_bank_accounts (
  profile_id uuid, company_id uuid, beneficiary_name text, banco text, clabe text, cuenta text
);
create table company_cost_center_budget_categories (
  company_id uuid, cost_center_id uuid, budget_category_id uuid, active boolean
);
create table budget_availability (
  company_id uuid, cost_center_id uuid, budget_category_id uuid, budget_month date,
  budgeted numeric, available numeric
);
insert into employee_bank_accounts
  select profile_id,company_id,'QA fictional','BBVA','000000000000000000',null from memberships;
insert into company_cost_center_budget_categories
  select id,'00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000032',true
  from companies where rfc in ('AFE190704UE0','SFE100825TM9');
insert into budget_availability
  select company_id,cost_center_id,budget_category_id,'2026-09-01',1000,1000 from company_cost_center_budget_categories;
create function private.current_profile_has_company_role(c uuid, rs text[]) returns boolean language sql stable set search_path = public as $$
  select exists(select 1 from memberships where profile_id=current_profile_id() and company_id=c
    and (role=any(rs) or role='sysadmin'))
$$;
grant select,insert,update,delete on all tables in schema public,storage to authenticated;
drop policy company_requests on payment_requests;
create policy payment_requests_insert on payment_requests for insert to authenticated
  with check(requested_by=current_profile_id() and private.current_profile_has_company_role(company_id,array['operator','finance','director']));
create policy payment_requests_select on payment_requests for select to authenticated
  using ((requested_by=current_profile_id() and private.current_profile_has_company_role(company_id,array['operator','finance','director']))
    or private.current_profile_has_company_role(company_id,array['finance','director']));
create policy payment_requests_update on payment_requests for update to authenticated
  using ((requested_by=current_profile_id() and private.current_profile_has_company_role(company_id,array['operator','finance','director']))
    or private.current_profile_has_company_role(company_id,array['finance','director']))
  with check ((requested_by=current_profile_id() and private.current_profile_has_company_role(company_id,array['operator','finance','director']))
    or private.current_profile_has_company_role(company_id,array['finance','director']));

create function private.profile_company_approver_roles(p uuid,c uuid) returns text[] language sql stable set search_path = public as $$
  select coalesce(array_agg(role),array[]::text[]) from memberships where profile_id=p and company_id=c
$$;
