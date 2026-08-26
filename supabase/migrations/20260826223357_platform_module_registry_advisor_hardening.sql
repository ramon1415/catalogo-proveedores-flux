-- F5.a · Hardening posterior a advisors de Supabase en DEV.
-- Idempotente para que otros ambientes puedan ejecutar la migración inicial ya
-- endurecida y conservar el mismo historial remoto.

begin;

drop index if exists public.company_modules_module_idx;
create index if not exists company_modules_module_version_idx
  on public.company_modules(module_key, version);

drop policy if exists modules_admin_write on public.modules;
drop policy if exists modules_admin_insert on public.modules;
drop policy if exists modules_admin_update on public.modules;
drop policy if exists modules_admin_delete on public.modules;

create policy modules_admin_insert on public.modules
  for insert to authenticated
  with check ((select current_user_has_role(flux_sysadmin_roles())));
create policy modules_admin_update on public.modules
  for update to authenticated
  using ((select current_user_has_role(flux_sysadmin_roles())))
  with check ((select current_user_has_role(flux_sysadmin_roles())));
create policy modules_admin_delete on public.modules
  for delete to authenticated
  using ((select current_user_has_role(flux_sysadmin_roles())));

drop policy if exists module_releases_admin_write on public.module_releases;
drop policy if exists module_releases_admin_insert on public.module_releases;
drop policy if exists module_releases_admin_update on public.module_releases;
drop policy if exists module_releases_admin_delete on public.module_releases;

create policy module_releases_admin_insert on public.module_releases
  for insert to authenticated
  with check ((select current_user_has_role(flux_sysadmin_roles())));
create policy module_releases_admin_update on public.module_releases
  for update to authenticated
  using ((select current_user_has_role(flux_sysadmin_roles())))
  with check ((select current_user_has_role(flux_sysadmin_roles())));
create policy module_releases_admin_delete on public.module_releases
  for delete to authenticated
  using ((select current_user_has_role(flux_sysadmin_roles())));

drop policy if exists company_modules_admin_write on public.company_modules;
drop policy if exists company_modules_admin_insert on public.company_modules;
drop policy if exists company_modules_admin_update on public.company_modules;
drop policy if exists company_modules_admin_delete on public.company_modules;

create policy company_modules_admin_insert on public.company_modules
  for insert to authenticated
  with check ((select current_user_has_role(flux_sysadmin_roles())));
create policy company_modules_admin_update on public.company_modules
  for update to authenticated
  using ((select current_user_has_role(flux_sysadmin_roles())))
  with check ((select current_user_has_role(flux_sysadmin_roles())));
create policy company_modules_admin_delete on public.company_modules
  for delete to authenticated
  using ((select current_user_has_role(flux_sysadmin_roles())));

commit;
