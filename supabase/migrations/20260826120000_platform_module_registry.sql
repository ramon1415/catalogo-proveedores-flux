-- F5.a · Registro de módulos de plataforma + estado por tenant
--
-- modules            : catálogo de módulos (alineado a las rutas del SPA).
-- module_releases    : versiones que existen en el código (última = max(version)).
-- company_modules    : estado por empresa — enabled + version fijada + hold/reason.
--
-- Mecanismo: config-flags en un solo bundle. La versión por tenant se fija en
-- company_modules.version; el rollout es un cambio de config (no re-deploy).
-- hold/hold_reason/held_since modelan el flujo "retengo un módulo en un tenant
-- por algo noncompliant, lo arreglo, y luego sigo pusheando" sin frenar al resto.
--
-- RLS: catálogo legible por autenticado; company_modules legible por miembros de
-- la empresa (para armar el nav) o sysadmin (tablero cross-tenant); escrituras
-- solo sysadmin. Usa los helpers existentes current_profile_id() /
-- current_user_has_role() / flux_sysadmin_roles().
--
-- MCP es read-only: aplicar en el editor SQL (dev primero; prod con autorización).

begin;

-- ── Tablas ────────────────────────────────────────────────────
create table if not exists public.modules (
  module_key  text primary key,
  name        text not null,
  kind        text not null default 'shared' check (kind in ('shared','tenant_variant')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.module_releases (
  id          uuid primary key default gen_random_uuid(),
  module_key  text not null references public.modules(module_key) on delete cascade,
  version     integer not null,
  git_sha     text,
  notes       text,
  released_at timestamptz not null default now(),
  unique (module_key, version)
);

create table if not exists public.company_modules (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  module_key   text not null references public.modules(module_key) on delete cascade,
  enabled      boolean not null default true,
  version      integer not null default 1,
  channel      text not null default 'stable' check (channel in ('stable','canary')),
  hold         boolean not null default false,
  hold_reason  text,
  held_since   timestamptz,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id),
  unique (company_id, module_key)
);

create index if not exists company_modules_company_idx on public.company_modules(company_id);
create index if not exists company_modules_module_idx  on public.company_modules(module_key);

-- Si hay hold, exige motivo + desde-cuándo (el des-hold lo hace el RPC/app).
alter table public.company_modules drop constraint if exists company_modules_hold_ck;
alter table public.company_modules add constraint company_modules_hold_ck
  check (hold = false or (hold_reason is not null and held_since is not null));

-- ── RLS ───────────────────────────────────────────────────────
alter table public.modules          enable row level security;
alter table public.module_releases  enable row level security;
alter table public.company_modules  enable row level security;

drop policy if exists modules_select on public.modules;
create policy modules_select on public.modules
  for select to authenticated using (true);
drop policy if exists modules_admin_write on public.modules;
create policy modules_admin_write on public.modules
  for all to authenticated
  using (current_user_has_role(flux_sysadmin_roles()))
  with check (current_user_has_role(flux_sysadmin_roles()));

drop policy if exists module_releases_select on public.module_releases;
create policy module_releases_select on public.module_releases
  for select to authenticated using (true);
drop policy if exists module_releases_admin_write on public.module_releases;
create policy module_releases_admin_write on public.module_releases
  for all to authenticated
  using (current_user_has_role(flux_sysadmin_roles()))
  with check (current_user_has_role(flux_sysadmin_roles()));

drop policy if exists company_modules_select on public.company_modules;
create policy company_modules_select on public.company_modules
  for select to authenticated
  using (
    company_id in (
      select company_id from public.profile_company_memberships
      where profile_id = current_profile_id() and active
    )
    or current_user_has_role(flux_sysadmin_roles())
  );
drop policy if exists company_modules_admin_write on public.company_modules;
create policy company_modules_admin_write on public.company_modules
  for all to authenticated
  using (current_user_has_role(flux_sysadmin_roles()))
  with check (current_user_has_role(flux_sysadmin_roles()));

-- ── Seed ──────────────────────────────────────────────────────
-- Catálogo alineado a las rutas reales del SPA. 'ingresos' cubre /ingresos y
-- /incidencias (mismo componente, variante por empresa).
insert into public.modules (module_key, name, kind) values
  ('solicitudes',   'Solicitudes de pago',        'shared'),
  ('proveedores',   'Proveedores',                'shared'),
  ('efectivo',      'Efectivo y comprobaciones',  'shared'),
  ('dashboard',     'Dashboard',                  'shared'),
  ('aprobaciones',  'Aprobaciones',               'shared'),
  ('layouts',       'Layouts de pago',            'shared'),
  ('configuracion', 'Configuración',              'shared'),
  ('ingresos',      'Ingresos',                   'tenant_variant')
on conflict (module_key) do nothing;

-- v1 de cada módulo (la migración inicial a React, F3/F4).
insert into public.module_releases (module_key, version, notes)
select module_key, 1, 'Migracion inicial a React (F3/F4)'
from public.modules
on conflict (module_key, version) do nothing;

-- Estado por tenant: 'shared' habilitado para todas; 'ingresos' solo Operadora
-- (la única con datos de ingresos hoy). NOTA prod: fijar por company_id explícito
-- en vez de por nombre.
insert into public.company_modules (company_id, module_key, enabled, version)
select c.id, m.module_key,
  case when m.kind = 'tenant_variant' then (c.name = 'Operadora Tlacatecpan') else true end,
  1
from public.companies c
cross join public.modules m
on conflict (company_id, module_key) do nothing;

commit;
