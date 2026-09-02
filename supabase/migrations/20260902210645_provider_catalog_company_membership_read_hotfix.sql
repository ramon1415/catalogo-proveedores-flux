-- PROD hotfix: restore provider catalog reads after company-scoped role cutover.
--
-- The UI writes authorization to profile_company_memberships, while the legacy
-- proveedores SELECT policy still checks only user_roles. During the transition,
-- accept either a valid legacy member role or an active company membership with
-- one of the canonical application roles. Provider rows are intentionally global
-- and do not carry company_id, so any active authorized company membership grants
-- read-only catalog access.

begin;

do $precheck$
declare
  v_policy_count integer;
begin
  if to_regclass('public.proveedores') is null
     or to_regclass('public.profile_company_memberships') is null then
    raise exception 'provider_catalog_membership_hotfix: required tables are missing';
  end if;

  if to_regprocedure('public.current_profile_id()') is null
     or to_regprocedure('public.current_user_has_role(text[])') is null
     or to_regprocedure('public.flux_member_roles()') is null then
    raise exception 'provider_catalog_membership_hotfix: required authorization helpers are missing';
  end if;

  select count(*)
    into v_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'proveedores'
    and policyname = 'proveedores_select_members'
    and cmd = 'SELECT'
    and roles = array['authenticated']::name[];

  if v_policy_count <> 1 then
    raise exception 'provider_catalog_membership_hotfix: unexpected proveedores SELECT policy state';
  end if;
end
$precheck$;

drop policy proveedores_select_members on public.proveedores;

create policy proveedores_select_members
on public.proveedores
for select
to authenticated
using (
  (select public.current_user_has_role(public.flux_member_roles()))
  or exists (
    select 1
    from public.profile_company_memberships pcm
    where pcm.profile_id = (select public.current_profile_id())
      and pcm.active
      and lower(btrim(pcm.role_key)) = any (
        array['operator', 'finance', 'director']::text[]
      )
  )
);

comment on policy proveedores_select_members on public.proveedores is
  'Allows provider catalog reads through a valid legacy global role or an active canonical company membership.';

do $postcheck$
declare
  v_qual text;
begin
  select qual
    into v_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'proveedores'
    and policyname = 'proveedores_select_members'
    and cmd = 'SELECT'
    and roles = array['authenticated']::name[];

  if v_qual is null
     or position('current_user_has_role' in v_qual) = 0
     or position('profile_company_memberships' in v_qual) = 0
     or position('current_profile_id' in v_qual) = 0 then
    raise exception 'provider_catalog_membership_hotfix: postcheck failed';
  end if;
end
$postcheck$;

commit;
