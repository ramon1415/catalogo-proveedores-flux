-- Fersana company-scoped access onboarding for React DEV.
--
-- The public link resolves an opaque company code, registers the authenticated
-- profile as pending and lets a Flux sysadmin approve the exact tenant + role.
-- No public company directory is exposed.

create table if not exists public.company_access_links (
  code text primary key,
  company_id uuid not null references public.companies(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_access_links_code_format_check
    check (code = lower(code) and code ~ '^[a-z0-9][a-z0-9_-]{2,63}$')
);

create unique index if not exists company_access_links_company_uidx
  on public.company_access_links(company_id)
  where active;

create table if not exists public.company_access_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  approved_role text,
  updated_at timestamptz not null default now(),
  constraint company_access_requests_status_check
    check (status in ('pending', 'approved', 'rejected')),
  constraint company_access_requests_approved_role_check
    check (approved_role is null or approved_role in ('solicitante', 'finance', 'director')),
  constraint company_access_requests_profile_company_key unique(profile_id, company_id)
);

create index if not exists company_access_requests_pending_idx
  on public.company_access_requests(requested_at)
  where status = 'pending';

alter table public.company_access_links enable row level security;
alter table public.company_access_requests enable row level security;

revoke all on table public.company_access_links from public, anon, authenticated;
revoke all on table public.company_access_requests from public, anon, authenticated;
grant select on table public.company_access_requests to authenticated;
grant select, insert, update, delete on table public.company_access_links to service_role;
grant select, insert, update, delete on table public.company_access_requests to service_role;

drop policy if exists company_access_requests_select_own_or_sysadmin
  on public.company_access_requests;
create policy company_access_requests_select_own_or_sysadmin
  on public.company_access_requests
  for select
  to authenticated
  using (
    profile_id = public.current_profile_id()
    or public.current_user_has_role(public.flux_sysadmin_roles())
  );

create or replace function public.ensure_current_profile()
returns table(
  id uuid,
  email text,
  full_name text,
  auth_user_id uuid,
  active boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_profile public.profiles%rowtype;
begin
  if v_auth_user_id is null then
    raise exception 'authentication_required';
  end if;

  select lower(btrim(u.email)),
         coalesce(
           nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data->>'name'), ''),
           split_part(lower(btrim(u.email)), '@', 1)
         )
    into v_email, v_full_name
  from auth.users u
  where u.id = v_auth_user_id;

  if v_email is null or v_email = '' then
    raise exception 'authenticated_email_required';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.auth_user_id = v_auth_user_id
     or lower(btrim(p.email)) = v_email
  order by (p.auth_user_id = v_auth_user_id) desc
  limit 1
  for update;

  if found then
    if v_profile.auth_user_id is null then
      update public.profiles p
      set auth_user_id = v_auth_user_id,
          email = v_email,
          full_name = coalesce(nullif(btrim(p.full_name), ''), v_full_name),
          updated_at = now()
      where p.id = v_profile.id
      returning p.* into v_profile;
    elsif v_profile.auth_user_id <> v_auth_user_id then
      raise exception 'profile_email_already_linked';
    end if;
  else
    insert into public.profiles(email, full_name, auth_user_id, active)
    values (v_email, v_full_name, v_auth_user_id, true)
    returning * into v_profile;
  end if;

  return query
  select v_profile.id,
         v_profile.email,
         v_profile.full_name,
         v_profile.auth_user_id,
         v_profile.active;
end;
$function$;

create or replace function public.request_company_access(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_profile_id uuid;
  v_company_id uuid;
  v_company_name text;
  v_request public.company_access_requests%rowtype;
begin
  v_profile_id := public.current_profile_id();
  if v_profile_id is null then
    raise exception 'profile_required';
  end if;

  select l.company_id,
         coalesce(nullif(btrim(c.legal_name), ''), c.name)
    into v_company_id, v_company_name
  from public.company_access_links l
  join public.companies c on c.id = l.company_id
  where l.code = lower(btrim(p_code))
    and l.active
    and coalesce(c.active, true);

  if v_company_id is null then
    raise exception 'company_access_link_not_found';
  end if;

  if exists (
    select 1
    from public.profile_company_memberships pcm
    where pcm.profile_id = v_profile_id
      and pcm.company_id = v_company_id
      and pcm.active
  ) then
    return jsonb_build_object(
      'status', 'already_member',
      'company_id', v_company_id,
      'company_name', v_company_name
    );
  end if;

  insert into public.company_access_requests(
    profile_id,
    company_id,
    status,
    requested_at,
    reviewed_at,
    reviewed_by,
    approved_role,
    updated_at
  ) values (
    v_profile_id,
    v_company_id,
    'pending',
    now(),
    null,
    null,
    null,
    now()
  )
  on conflict (profile_id, company_id)
  do update set
    -- Llegar aquí implica que ya no existe una membresía activa, aunque una
    -- solicitud anterior figure aprobada. Reabrirla evita mostrar acceso falso.
    status = 'pending',
    requested_at = now(),
    reviewed_at = null,
    reviewed_by = null,
    approved_role = null,
    updated_at = now()
  returning * into v_request;

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', v_request.status,
    'company_id', v_company_id,
    'company_name', v_company_name
  );
end;
$function$;

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
  if not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;

  return query
  select ar.id,
         p.id,
         p.full_name,
         p.email,
         c.id,
         coalesce(nullif(btrim(c.legal_name), ''), c.name),
         ar.status,
         ar.requested_at,
         ar.reviewed_at,
         ar.approved_role,
         coalesce(
           array_agg(distinct lower(btrim(r.name))) filter (where r.name is not null),
           array[]::text[]
         )
  from public.company_access_requests ar
  join public.profiles p on p.id = ar.profile_id
  join public.companies c on c.id = ar.company_id
  left join public.user_roles ur on ur.profile_id = p.id
  left join public.roles r on r.id = ur.role_id
  group by ar.id, p.id, c.id
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
  v_actor uuid;
  v_request public.company_access_requests%rowtype;
  v_role_name text := lower(btrim(p_role));
  v_role_id uuid;
  v_existing_roles text[];
begin
  v_actor := public.current_profile_id();
  if v_actor is null
     or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;
  if v_role_name not in ('solicitante', 'finance', 'director') then
    raise exception 'company_access_role_not_allowed';
  end if;

  select ar.* into v_request
  from public.company_access_requests ar
  where ar.id = p_request_id
  for update;
  if not found then
    raise exception 'company_access_request_not_found';
  end if;
  if v_request.status = 'rejected' then
    raise exception 'company_access_request_rejected';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_request.profile_id and coalesce(p.active, true)
  ) then
    raise exception 'profile_not_found_or_inactive';
  end if;

  select r.id into v_role_id
  from public.roles r
  where lower(btrim(r.name)) = v_role_name
  limit 1;
  if v_role_id is null then
    raise exception 'company_access_role_not_found';
  end if;

  select coalesce(array_agg(distinct lower(btrim(r.name))), array[]::text[])
    into v_existing_roles
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.profile_id = v_request.profile_id;

  if cardinality(v_existing_roles) > 0
     and not (v_role_name = any(v_existing_roles)) then
    raise exception 'company_access_profile_already_has_different_role';
  end if;

  if cardinality(v_existing_roles) = 0 then
    insert into public.user_roles(profile_id, role_id)
    values (v_request.profile_id, v_role_id);
  end if;

  insert into public.profile_company_memberships(profile_id, company_id, active)
  values (v_request.profile_id, v_request.company_id, true)
  on conflict (profile_id, company_id)
  do update set active = true;

  if v_role_name = 'director' then
    update public.company_directors cd
    set active = true,
        updated_at = now()
    where cd.company_id = v_request.company_id
      and cd.director_profile_id = v_request.profile_id;

    if not found then
      insert into public.company_directors(
        company_id,
        director_profile_id,
        active,
        created_by
      ) values (
        v_request.company_id,
        v_request.profile_id,
        true,
        v_actor
      );
    end if;
  end if;

  update public.company_access_requests ar
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by = v_actor,
      approved_role = v_role_name,
      updated_at = now()
  where ar.id = v_request.id;

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', 'approved',
    'company_id', v_request.company_id,
    'profile_id', v_request.profile_id,
    'role', v_role_name
  );
end;
$function$;

create or replace function public.reject_company_access_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid;
  v_request public.company_access_requests%rowtype;
begin
  v_actor := public.current_profile_id();
  if v_actor is null
     or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;

  select ar.* into v_request
  from public.company_access_requests ar
  where ar.id = p_request_id
  for update;
  if not found then
    raise exception 'company_access_request_not_found';
  end if;
  if v_request.status = 'approved' then
    raise exception 'company_access_request_already_approved';
  end if;

  update public.company_access_requests ar
  set status = 'rejected',
      reviewed_at = now(),
      reviewed_by = v_actor,
      approved_role = null,
      updated_at = now()
  where ar.id = v_request.id;

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', 'rejected'
  );
end;
$function$;

revoke all on function public.ensure_current_profile() from public, anon;
revoke all on function public.request_company_access(text) from public, anon;
revoke all on function public.list_company_access_requests() from public, anon;
revoke all on function public.approve_company_access_request(uuid, text) from public, anon;
revoke all on function public.reject_company_access_request(uuid) from public, anon;

grant execute on function public.ensure_current_profile() to authenticated;
grant execute on function public.request_company_access(text) to authenticated;
grant execute on function public.list_company_access_requests() to authenticated;
grant execute on function public.approve_company_access_request(uuid, text) to authenticated;
grant execute on function public.reject_company_access_request(uuid) to authenticated;

do $block$
declare
  v_company_id uuid;
  v_count integer;
begin
  select min(c.id::text)::uuid, count(*)
    into v_company_id, v_count
  from public.companies c
  where lower(btrim(c.name)) = 'soporte fersana'
     or lower(btrim(coalesce(c.legal_name, ''))) = 'soporte fersana';

  if v_count <> 1 then
    raise exception 'fersana_company_resolution_expected_one_found_%', v_count;
  end if;

  insert into public.company_access_links(code, company_id, active, updated_at)
  values ('fersana', v_company_id, true, now())
  on conflict (code)
  do update set
    company_id = excluded.company_id,
    active = true,
    updated_at = now();
end;
$block$;
