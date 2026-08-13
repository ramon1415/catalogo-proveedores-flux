-- 048 · SysAdmin provider-intake link administration.
-- Ledger version: 20260813005145 (official DEV apply timestamp).
-- Forward-only: align the server contract with FluxAuth's global SysAdmin role.

do $$
begin
  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260812001555'
  ) then
    raise exception 'provider_intake_046_required';
  end if;

  if to_regprocedure('public.provider_intake_link_actor_authorized(uuid,uuid)') is null
     or to_regprocedure('public.flux_sysadmin_roles()') is null then
    raise exception 'provider_intake_link_authorization_contract_required';
  end if;
end
$$;

create or replace function public.provider_intake_link_actor_authorized(
  p_profile_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_profile_id is not null
    and p_company_id is not null
    and exists (
      select 1
      from public.companies company
      where company.id = p_company_id
        and coalesce(company.active, true)
    )
    and (
      exists (
        select 1
        from public.user_roles user_role
        join public.roles role on role.id = user_role.role_id
        where user_role.profile_id = p_profile_id
          and lower(btrim(role.name)) = any(public.flux_sysadmin_roles())
      )
      or (
        public.has_active_company_membership(p_profile_id, p_company_id)
        and (
          exists (
            select 1
            from public.user_roles user_role
            join public.roles role on role.id = user_role.role_id
            where user_role.profile_id = p_profile_id
              and lower(btrim(role.name)) = any(array[
                'finance', 'finanzas', 'treasury', 'tesoreria', 'administracion'
              ]::text[])
          )
          or public.extraordinary_profile_is_company_director(p_profile_id, p_company_id)
        )
      )
    );
$$;

comment on function public.provider_intake_link_actor_authorized(uuid, uuid) is
  'Allows Flux SysAdmin roles to administer provider-intake links globally; finance and director actors remain scoped by active company membership.';
