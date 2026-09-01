-- Company-scoped roles: additive foundation only.
--
-- This migration makes the role part of profile_company_memberships and moves
-- the access-request/admin contracts to that model. Existing global roles stay
-- untouched in this phase; company-aware RLS/RPC cutover is a separate gate.

begin;

alter table public.profile_company_memberships
  add column if not exists role_key text;

alter table public.profile_company_memberships
  drop constraint if exists profile_company_memberships_role_key_check;

alter table public.profile_company_memberships
  add constraint profile_company_memberships_role_key_check
  check (role_key is null or role_key in ('operator', 'finance', 'director', 'sysadmin'));

alter table public.company_access_requests
  drop constraint if exists company_access_requests_approved_role_check;

alter table public.company_access_requests
  add constraint company_access_requests_approved_role_check
  check (approved_role is null or approved_role in ('solicitante', 'operator', 'finance', 'director'));

comment on column public.profile_company_memberships.role_key is
  'Effective role for this exact company. Global user_roles is retained only for platform-level compatibility/sysadmin during the staged cutover.';

-- Preserve the current effective access for every existing membership. The
-- priority mirrors the SPA role grouping and is deterministic for multi-role
-- legacy profiles. Null remains fail-closed when no recognized role exists.
with legacy_roles as (
  select
    pcm.id,
    case
      when bool_or(lower(btrim(r.name)) = any(array['sysadmin','system_admin','admin','superadmin'])) then 'sysadmin'
      when bool_or(lower(btrim(r.name)) = any(array['finance','finanzas','treasury','tesoreria','administracion'])) then 'finance'
      when bool_or(lower(btrim(r.name)) = any(array['approver_2','aprobador_2','direccion','director'])) then 'director'
      when bool_or(lower(btrim(r.name)) = any(array['solicitante','operator','default','seller','celebraciones','producciones','planner'])) then 'operator'
      else null
    end as role_key
  from public.profile_company_memberships pcm
  left join public.user_roles ur on ur.profile_id = pcm.profile_id
  left join public.roles r on r.id = ur.role_id
  group by pcm.id
)
update public.profile_company_memberships pcm
set role_key = legacy.role_key
from legacy_roles legacy
where pcm.id = legacy.id
  and pcm.role_key is null;

create schema if not exists private;
revoke all on schema private from public, anon;

create or replace function private.canonical_company_role(p_role text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case lower(btrim(coalesce(p_role, '')))
    when 'solicitante' then 'operator'
    when 'operator' then 'operator'
    when 'default' then 'operator'
    when 'seller' then 'operator'
    when 'celebraciones' then 'operator'
    when 'producciones' then 'operator'
    when 'planner' then 'operator'
    when 'finance' then 'finance'
    when 'finanzas' then 'finance'
    when 'treasury' then 'finance'
    when 'tesoreria' then 'finance'
    when 'administracion' then 'finance'
    when 'approver_2' then 'director'
    when 'aprobador_2' then 'director'
    when 'direccion' then 'director'
    when 'director' then 'director'
    when 'sysadmin' then 'sysadmin'
    when 'system_admin' then 'sysadmin'
    when 'admin' then 'sysadmin'
    when 'superadmin' then 'sysadmin'
    else null
  end;
$function$;

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

revoke all on function private.canonical_company_role(text) from public, anon, authenticated;
revoke all on function private.profile_has_company_role(uuid, uuid, text[]) from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on function private.profile_has_company_role(uuid, uuid, text[]) to authenticated, service_role;

drop function if exists public.list_profile_company_memberships();
create function public.list_profile_company_memberships()
returns table (
  id uuid,
  profile_id uuid,
  profile_name text,
  profile_email text,
  company_id uuid,
  company_name text,
  role_key text,
  active boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null
     or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;

  return query
  select pcm.id, p.id, p.full_name, p.email, c.id,
         coalesce(nullif(btrim(c.legal_name), ''), c.name),
         pcm.role_key, pcm.active, pcm.created_at
  from public.profile_company_memberships pcm
  join public.profiles p on p.id = pcm.profile_id
  join public.companies c on c.id = pcm.company_id
  order by coalesce(nullif(btrim(p.full_name), ''), p.email),
           coalesce(nullif(btrim(c.legal_name), ''), c.name);
end;
$function$;

revoke all on function public.list_profile_company_memberships() from public, anon;
grant execute on function public.list_profile_company_memberships() to authenticated, service_role;

create or replace function public.set_profile_company_role(
  p_profile_id uuid,
  p_company_id uuid,
  p_role text,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_id uuid;
  v_actor uuid := public.current_profile_id();
  v_role text := private.canonical_company_role(p_role);
begin
  if auth.uid() is null
     or v_actor is null
     or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;
  if v_role is null or v_role not in ('operator', 'finance', 'director') then
    raise exception 'company_role_not_allowed';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and coalesce(active, true)) then
    raise exception 'profile_not_found_or_inactive';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id and coalesce(active, true)) then
    raise exception 'company_not_found_or_inactive';
  end if;

  insert into public.profile_company_memberships(profile_id, company_id, role_key, active)
  values (p_profile_id, p_company_id, v_role, coalesce(p_active, true))
  on conflict (profile_id, company_id)
  do update set role_key = excluded.role_key, active = excluded.active
  returning id into v_id;

  if v_role = 'director' and coalesce(p_active, true) then
    update public.company_directors
    set active = true, updated_at = now()
    where company_id = p_company_id
      and director_profile_id = p_profile_id;

    if not found then
      insert into public.company_directors(company_id, director_profile_id, active, created_by)
      values (p_company_id, p_profile_id, true, v_actor);
    end if;
  else
    update public.company_directors
    set active = false, updated_at = now()
    where company_id = p_company_id
      and director_profile_id = p_profile_id
      and active;
  end if;

  return v_id;
end;
$function$;

revoke all on function public.set_profile_company_role(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.set_profile_company_role(uuid, uuid, text, boolean) to authenticated, service_role;

create or replace function public.list_company_access_requests()
returns table(
  id uuid,
  profile_id uuid,
  profile_name text,
  profile_email text,
  company_id uuid,
  company_name text,
  status text,
  requested_at timestamptz,
  reviewed_at timestamptz,
  approved_role text,
  current_roles text[]
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null
     or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;

  return query
  select ar.id, p.id, p.full_name, p.email, c.id,
         coalesce(nullif(btrim(c.legal_name), ''), c.name),
         ar.status, ar.requested_at, ar.reviewed_at, ar.approved_role,
         case when pcm.role_key is null then array[]::text[] else array[pcm.role_key] end
  from public.company_access_requests ar
  join public.profiles p on p.id = ar.profile_id
  join public.companies c on c.id = ar.company_id
  left join public.profile_company_memberships pcm
    on pcm.profile_id = ar.profile_id and pcm.company_id = ar.company_id
  order by (ar.status = 'pending') desc, ar.requested_at desc;
end;
$function$;

create or replace function public.approve_company_access_request(
  p_request_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.company_access_requests%rowtype;
  v_role text := private.canonical_company_role(p_role);
begin
  if auth.uid() is null
     or v_actor is null
     or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;
  if v_role is null or v_role not in ('operator', 'finance', 'director') then
    raise exception 'company_access_role_not_allowed';
  end if;

  select ar.* into v_request
  from public.company_access_requests ar
  where ar.id = p_request_id
  for update;
  if not found then raise exception 'company_access_request_not_found'; end if;
  if v_request.status = 'rejected' then raise exception 'company_access_request_rejected'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_request.profile_id and coalesce(p.active, true)
  ) then
    raise exception 'profile_not_found_or_inactive';
  end if;

  perform public.set_profile_company_role(
    v_request.profile_id,
    v_request.company_id,
    v_role,
    true
  );

  update public.company_access_requests ar
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by = v_actor,
      approved_role = v_role,
      updated_at = now()
  where ar.id = v_request.id;

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', 'approved',
    'company_id', v_request.company_id,
    'profile_id', v_request.profile_id,
    'role', v_role
  );
end;
$function$;

comment on function private.profile_has_company_role(uuid, uuid, text[]) is
  'Authorization primitive for company-aware policies/RPCs. Global override requires both a canonical sysadmin role and an approved platform-power email.';

commit;
