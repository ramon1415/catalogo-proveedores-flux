-- Homologate authorization across the global provider catalog.
-- Banking remains Finance/Sysadmin only. No role assignments or payment permissions change.
begin;
do $patch$
declare target text; source text; old_guard text; new_guard text;
begin
 foreach target in array array[
 'public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)',
 'public.guard_provider_payment_execution_data_insert()',
 'public.mark_provider_payment_material_change()'
 ] loop
 source := replace(pg_get_functiondef(target::regprocedure), E'\r\n', E'\n');
 if target like '%save_provider_catalog%' then
 old_guard := $old$if not (public.current_user_has_role(public.flux_member_roles()) or exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = 'finance'
    )) then$old$;
 new_guard := $new$if not (public.current_user_has_role(public.flux_member_roles()) or exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = any(array['operator','finance','director','sysadmin']::text[])
    )) then$new$;
 if position(old_guard in source)=0 then raise exception 'provider_roles: create guard drift'; end if;
 source := replace(source,old_guard,new_guard);
 old_guard := $old$if not (public.current_user_has_role(public.flux_approver_roles()) or exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = 'finance'
    )) then$old$;
 new_guard := $new$if not (public.current_user_has_role(public.flux_approver_roles()) or exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = any(array['finance','director','sysadmin']::text[])
    )) then$new$;
 if position(old_guard in source)=0 then raise exception 'provider_roles: update guard drift'; end if;
 source := replace(source,old_guard,new_guard);
 end if;
 if position($old$exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = 'finance'
    )$old$ in source)=0 then raise exception 'provider_roles: banking guard drift'; end if;
 source := replace(source,$old$exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = 'finance'
    )$old$,$new$exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = any(array['finance','sysadmin']::text[])
    )$new$);
 execute source;
 end loop;
end
$patch$;
alter policy proveedores_select_members on public.proveedores
 using (public.current_profile_id() is not null and (public.current_user_has_role(public.flux_member_roles()) or exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = any(array['operator','finance','director','sysadmin']::text[])
    )));
alter policy proveedores_insert_members on public.proveedores
 with check (public.current_profile_id() is not null and (public.current_user_has_role(public.flux_member_roles()) or exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = any(array['operator','finance','director','sysadmin']::text[])
    )));
alter policy proveedores_update_managers on public.proveedores
 using (public.current_profile_id() is not null and (public.current_user_has_role(public.flux_approver_roles()) or exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = any(array['finance','director','sysadmin']::text[])
    )))
 with check (public.current_profile_id() is not null and (public.current_user_has_role(public.flux_approver_roles()) or exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = any(array['finance','director','sysadmin']::text[])
    )));
alter policy "Authenticated can upload provider CSF" on storage.objects
 with check (bucket_id = 'payment-receipts' and name like 'csf/%'
 and (public.current_profile_id() is not null and (public.current_user_has_role(public.flux_approver_roles()) or exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = any(array['finance','director','sysadmin']::text[])
    ))));
alter policy "Authenticated can read provider CSF" on storage.objects
 using (bucket_id = 'payment-receipts' and name like 'csf/%'
 and (public.current_profile_id() is not null and (public.current_user_has_role(public.flux_approver_roles()) or exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = any(array['finance','director','sysadmin']::text[])
    ))));
commit;

