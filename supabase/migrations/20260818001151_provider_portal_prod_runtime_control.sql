-- Provider Portal PROD forward chain T1/4: authoritative runtime gate.
-- Target captured read-only: ucantptjhwttexzmslvm; current PROD head: 20260817230000.
-- Default is deliberately disabled. No identity, business data, Storage object, or notification data is seeded.

begin;

do $$
begin
  if to_regclass('public.intake_links') is null
     or to_regclass('public.payment_intake') is null
     or to_regclass('public.payment_intake_files') is null
     or to_regclass('public.payment_intake_events') is null then
    raise exception 'provider_portal_prod_precheck: foundation tables are unavailable';
  end if;
  if to_regclass('public.provider_intake_runtime_control') is not null then
    raise exception 'provider_portal_prod_precheck: runtime control already exists';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'provider_intake_runtime%'
  ) then
    raise exception 'provider_portal_prod_precheck: unexpected runtime function collision';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'intake-uploads'
      and public is false
      and file_size_limit = 10485760
      and allowed_mime_types = array[
        'application/pdf','application/xml','text/xml','image/jpeg','image/png','image/webp'
      ]::text[]
  ) then
    raise exception 'provider_portal_prod_precheck: intake-uploads material contract mismatch';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') ilike '%intake-uploads%' or coalesce(with_check, '') ilike '%intake-uploads%')
      and ('anon' = any(roles) or 'public' = any(roles))
  ) then
    raise exception 'provider_portal_prod_precheck: intake-uploads has a public policy';
  end if;
end
$$;

create table public.provider_intake_runtime_control (
  singleton boolean primary key default true,
  mode text not null default 'disabled',
  updated_by_profile_id uuid null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint provider_intake_runtime_control_singleton_check check (singleton is true),
  constraint provider_intake_runtime_control_mode_check check (mode in ('disabled', 'sysadmin_only', 'full'))
);

create table public.provider_intake_runtime_control_events (
  id bigint generated always as identity primary key,
  previous_mode text not null,
  new_mode text not null,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now(),
  constraint provider_intake_runtime_events_previous_check check (previous_mode in ('disabled', 'sysadmin_only', 'full')),
  constraint provider_intake_runtime_events_new_check check (new_mode in ('disabled', 'sysadmin_only', 'full'))
);

alter table public.provider_intake_runtime_control enable row level security;
alter table public.provider_intake_runtime_control_events enable row level security;
revoke all on table public.provider_intake_runtime_control from public, anon, authenticated, service_role;
revoke all on table public.provider_intake_runtime_control_events from public, anon, authenticated, service_role;

insert into public.provider_intake_runtime_control(singleton, mode)
values (true, 'disabled');

create function public.provider_intake_runtime_mode()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when count(*) = 1 and min(mode) in ('disabled', 'sysadmin_only', 'full') then min(mode)
    else 'disabled'
  end
  from public.provider_intake_runtime_control
  where singleton is true
$$;

create function public.provider_intake_public_access_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.provider_intake_runtime_mode() in ('sysadmin_only', 'full')
$$;

create function public.provider_intake_internal_access_allowed(p_company_id uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := public.provider_intake_runtime_mode();
  v_profile_id uuid := public.current_profile_id();
begin
  if v_mode = 'disabled' or v_profile_id is null then return false; end if;
  if v_mode = 'sysadmin_only' then
    return public.current_user_has_role(public.flux_sysadmin_roles());
  end if;
  if v_mode = 'full' then
    return public.current_user_has_role(public.flux_sysadmin_roles())
      or (
        public.current_user_has_role(public.flux_finance_roles())
        and (p_company_id is null or public.has_active_company_membership(v_profile_id, p_company_id))
      );
  end if;
  return false;
end
$$;

create function public.provider_intake_require_internal_access(p_company_id uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.provider_intake_internal_access_allowed(p_company_id) then
    if public.provider_intake_runtime_mode() = 'disabled' then
      raise exception 'provider_intake_disabled';
    end if;
    raise exception 'provider_intake_access_denied';
  end if;
end
$$;

create function public.provider_intake_require_emergency_sysadmin_access(p_company_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := public.current_profile_id();
begin
  if v_profile_id is null or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'provider_intake_access_denied';
  end if;
  if p_company_id is not null and not exists (
    select 1 from public.companies c where c.id = p_company_id and coalesce(c.active, true)
  ) then
    raise exception 'provider_intake_company_not_available';
  end if;
  return v_profile_id;
end
$$;

create function public.get_provider_intake_module_access()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'mode', public.provider_intake_runtime_mode(),
    'allowed', public.provider_intake_internal_access_allowed(null),
    'profile_id', case when public.provider_intake_internal_access_allowed(null) then public.current_profile_id() else null end
  )
$$;

create function public.set_provider_intake_runtime_mode(p_mode text, p_confirmed boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_mode text := lower(btrim(coalesce(p_mode, '')));
  v_previous text;
begin
  if p_confirmed is not true then raise exception 'provider_intake_mode_confirmation_required'; end if;
  if v_mode not in ('disabled', 'sysadmin_only', 'full') then
    raise exception 'provider_intake_mode_invalid';
  end if;
  if v_actor is null or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'provider_intake_access_denied';
  end if;

  select mode into v_previous
  from public.provider_intake_runtime_control
  where singleton is true
  for update;
  if not found or v_previous not in ('disabled', 'sysadmin_only', 'full') then
    raise exception 'provider_intake_runtime_control_invalid';
  end if;

  if v_previous <> v_mode then
    update public.provider_intake_runtime_control
    set mode = v_mode, updated_by_profile_id = v_actor, updated_at = now()
    where singleton is true;
    insert into public.provider_intake_runtime_control_events(previous_mode, new_mode, actor_profile_id)
    values (v_previous, v_mode, v_actor);
  end if;

  return jsonb_build_object('previous_mode', v_previous, 'mode', v_mode, 'changed', v_previous <> v_mode);
end
$$;

drop policy if exists intake_links_select_admins on public.intake_links;
drop policy if exists payment_intake_select_finance_company on public.payment_intake;
drop policy if exists payment_intake_files_select_finance_company on public.payment_intake_files;
drop policy if exists payment_intake_events_select_finance_company on public.payment_intake_events;

create policy intake_links_select_provider_portal_mode
  on public.intake_links for select to authenticated
  using (public.provider_intake_internal_access_allowed(company_id));

create policy payment_intake_select_provider_portal_mode
  on public.payment_intake for select to authenticated
  using (public.provider_intake_internal_access_allowed(company_id));

create policy payment_intake_files_select_provider_portal_mode
  on public.payment_intake_files for select to authenticated
  using (exists (
    select 1 from public.payment_intake intake
    where intake.id = payment_intake_files.payment_intake_id
      and public.provider_intake_internal_access_allowed(intake.company_id)
  ));

create policy payment_intake_events_select_provider_portal_mode
  on public.payment_intake_events for select to authenticated
  using (exists (
    select 1 from public.payment_intake intake
    where intake.id = payment_intake_events.payment_intake_id
      and public.provider_intake_internal_access_allowed(intake.company_id)
  ));

revoke all on function public.provider_intake_runtime_mode() from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_public_access_allowed() from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_internal_access_allowed(uuid) from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_require_internal_access(uuid) from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_require_emergency_sysadmin_access(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_provider_intake_module_access() from public, anon, authenticated, service_role;
revoke all on function public.set_provider_intake_runtime_mode(text, boolean) from public, anon, authenticated, service_role;

grant execute on function public.provider_intake_runtime_mode() to authenticated, service_role;
grant execute on function public.provider_intake_public_access_allowed() to service_role;
grant execute on function public.provider_intake_internal_access_allowed(uuid) to authenticated, service_role;
grant execute on function public.get_provider_intake_module_access() to authenticated;
grant execute on function public.set_provider_intake_runtime_mode(text, boolean) to authenticated;

comment on table public.provider_intake_runtime_control is
  'Singleton fail-closed release gate for the Provider Portal. Migrations always seed disabled.';
comment on function public.provider_intake_public_access_allowed() is
  'Public token routes are enabled in sysadmin_only/full and denied in disabled; login is never required.';

commit;
