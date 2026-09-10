-- PROD compatibility: historical actuals are tenant data and must follow the
-- exact company membership role. This table is already populated in PROD.

begin;

do $inventory$
declare
  v_null_company bigint;
begin
  if to_regclass('public.historical_actuals') is null then
    raise exception 'historical_actuals_missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'historical_actuals'
      and column_name = 'company_id'
      and udt_name = 'uuid'
  ) then
    raise exception 'historical_actuals_company_id_contract_missing';
  end if;

  select count(*) into v_null_company
  from public.historical_actuals
  where company_id is null;
  if v_null_company <> 0 then
    raise exception 'historical_actuals_null_company_rows: %', v_null_company;
  end if;
end
$inventory$;

drop policy if exists historical_actuals_select on public.historical_actuals;
create policy historical_actuals_select
on public.historical_actuals for select to authenticated
using ((select private.current_profile_has_company_role(
  company_id,
  array['operator','finance','director']::text[]
)));

drop policy if exists historical_actuals_write on public.historical_actuals;
create policy historical_actuals_write
on public.historical_actuals for all to authenticated
using ((select private.current_profile_has_company_role(
  company_id,
  array['finance']::text[]
)))
with check ((select private.current_profile_has_company_role(
  company_id,
  array['finance']::text[]
)));

do $postcheck$
declare
  v_blockers text;
begin
  select string_agg(policyname, ', ' order by policyname)
  into v_blockers
  from pg_policies
  where schemaname = 'public'
    and tablename = 'historical_actuals'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      ~* 'current_user_has_role|flux_(finance|approver|member)_roles';

  if v_blockers is not null then
    raise exception 'historical_actuals_company_scope_failed: %', v_blockers;
  end if;
end
$postcheck$;

commit;
