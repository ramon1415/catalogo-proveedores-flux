-- Harden the already-published company-role foundation in DEV.
--
-- Raw legacy admin/sysadmin assignments may remain for compatibility, but
-- company-scoped authorization grants global override only to the two accounts
-- explicitly approved for platform power.

begin;

create or replace function private.profile_has_company_role(
  p_profile_id uuid,
  p_company_id uuid,
  p_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      join public.profiles p on p.id = ur.profile_id
      where ur.profile_id = p_profile_id
        and private.canonical_company_role(r.name) = 'sysadmin'
        and lower(btrim(coalesce(p.email, ''))) in (
          'carlos@quantta.mx',
          'ramon@quantta.mx'
        )
    )
    or exists (
      select 1
      from public.profile_company_memberships pcm
      where pcm.profile_id = p_profile_id
        and pcm.company_id = p_company_id
        and pcm.active
        and pcm.role_key is not null
        and pcm.role_key = any (
          select private.canonical_company_role(requested_role)
          from unnest(coalesce(p_roles, array[]::text[])) requested_role
        )
    );
$function$;

revoke all on function private.profile_has_company_role(uuid, uuid, text[])
  from public, anon;
grant execute on function private.profile_has_company_role(uuid, uuid, text[])
  to authenticated, service_role;

comment on function private.profile_has_company_role(uuid, uuid, text[]) is
  'Authorization primitive for company-aware policies/RPCs. Global override requires both a canonical sysadmin role and an approved platform-power email.';

do $postcheck$
declare
  v_blockers text;
begin
  select string_agg(
    coalesce(p.email, p.id::text),
    ', ' order by coalesce(p.email, p.id::text)
  )
  into v_blockers
  from public.profiles p
  join public.user_roles ur on ur.profile_id = p.id
  join public.roles r on r.id = ur.role_id
  where lower(btrim(r.name)) in ('sysadmin', 'system_admin', 'admin', 'superadmin')
    and lower(btrim(coalesce(p.email, ''))) not in (
      'carlos@quantta.mx',
      'ramon@quantta.mx'
    )
    and exists (
      select 1
      from public.companies c
      where coalesce(c.active, true)
        and private.profile_has_company_role(
          p.id,
          c.id,
          array['operator']::text[]
        )
    );

  if v_blockers is not null then
    raise exception 'company_role_power_override_hardening_failed: %', v_blockers;
  end if;
end
$postcheck$;

commit;
