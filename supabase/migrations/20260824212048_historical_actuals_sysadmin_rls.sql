-- Flux Operadora
-- Dashboard anual: historical_actuals contiene información contable sensible.
-- El acceso queda fail-closed y limitado a perfiles con rol sysadmin.

begin;

do $$
begin
  if to_regclass('public.historical_actuals') is null then
    raise exception 'public.historical_actuals must exist before applying strict sysadmin RLS';
  end if;
end
$$;

alter table public.historical_actuals enable row level security;
alter table public.historical_actuals force row level security;

-- Retira las políticas históricas amplias y cualquier versión previa de este hardening.
drop policy if exists historical_actuals_select on public.historical_actuals;
drop policy if exists historical_actuals_write on public.historical_actuals;
drop policy if exists historical_actuals_select_sysadmin on public.historical_actuals;
drop policy if exists historical_actuals_insert_sysadmin on public.historical_actuals;
drop policy if exists historical_actuals_update_sysadmin on public.historical_actuals;
drop policy if exists historical_actuals_delete_sysadmin on public.historical_actuals;

revoke all on table public.historical_actuals from public;
revoke all on table public.historical_actuals from anon;
grant select, insert, update, delete on table public.historical_actuals to authenticated;
grant select, insert, update, delete on table public.historical_actuals to service_role;

create policy historical_actuals_select_sysadmin
  on public.historical_actuals
  as permissive
  for select
  to authenticated
  using (current_user_has_role(flux_sysadmin_roles()));

create policy historical_actuals_insert_sysadmin
  on public.historical_actuals
  as permissive
  for insert
  to authenticated
  with check (current_user_has_role(flux_sysadmin_roles()));

create policy historical_actuals_update_sysadmin
  on public.historical_actuals
  as permissive
  for update
  to authenticated
  using (current_user_has_role(flux_sysadmin_roles()))
  with check (current_user_has_role(flux_sysadmin_roles()));

create policy historical_actuals_delete_sysadmin
  on public.historical_actuals
  as permissive
  for delete
  to authenticated
  using (current_user_has_role(flux_sysadmin_roles()));

comment on table public.historical_actuals is
  'Histórico contable para Dashboard anual. Acceso de Data API limitado a sysadmin mediante RLS estricta.';

commit;
