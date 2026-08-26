-- Tighten historical accounting access to true system-admin roles only.
-- `flux_sysadmin_roles()` also includes plain `admin`, which is intentionally
-- allowed in other Flux surfaces but MUST NOT grant access to historical_actuals.

alter table public.historical_actuals enable row level security;
alter table public.historical_actuals force row level security;

drop policy if exists historical_actuals_select_sysadmin on public.historical_actuals;
drop policy if exists historical_actuals_insert_sysadmin on public.historical_actuals;
drop policy if exists historical_actuals_update_sysadmin on public.historical_actuals;
drop policy if exists historical_actuals_delete_sysadmin on public.historical_actuals;

create policy historical_actuals_select_strict_sysadmin
  on public.historical_actuals
  for select
  to authenticated
  using (public.current_user_has_role(array['sysadmin','system_admin','superadmin']::text[]));

create policy historical_actuals_insert_strict_sysadmin
  on public.historical_actuals
  for insert
  to authenticated
  with check (public.current_user_has_role(array['sysadmin','system_admin','superadmin']::text[]));

create policy historical_actuals_update_strict_sysadmin
  on public.historical_actuals
  for update
  to authenticated
  using (public.current_user_has_role(array['sysadmin','system_admin','superadmin']::text[]))
  with check (public.current_user_has_role(array['sysadmin','system_admin','superadmin']::text[]));

create policy historical_actuals_delete_strict_sysadmin
  on public.historical_actuals
  for delete
  to authenticated
  using (public.current_user_has_role(array['sysadmin','system_admin','superadmin']::text[]));

comment on table public.historical_actuals is
  'Historical accounting actuals. Authenticated access is restricted to sysadmin/system_admin/superadmin; plain admin and finance are excluded.';
