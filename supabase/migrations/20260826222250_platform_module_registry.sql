-- F5.a · Registro de módulos de plataforma + estado por tenant
--
-- modules            : catálogo de módulos alineado a las rutas del SPA.
-- module_releases    : versiones disponibles en el bundle.
-- company_modules    : configuración por empresa (enabled/version/hold).
--
-- Esta migración sólo define el contrato. Debe aplicarse primero en DEV y
-- únicamente mediante el flujo de migraciones de Supabase.

begin;

create table public.modules (
  module_key text primary key,
  name text not null,
  kind text not null default 'shared'
    check (kind in ('shared', 'tenant_variant')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.module_releases (
  id uuid primary key default gen_random_uuid(),
  module_key text not null
    references public.modules(module_key) on delete cascade,
  version integer not null check (version > 0),
  git_sha text,
  notes text,
  released_at timestamptz not null default now(),
  constraint module_releases_module_version_key
    unique (module_key, version)
);

create table public.company_modules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies(id) on delete cascade,
  module_key text not null
    references public.modules(module_key) on delete cascade,
  enabled boolean not null default true,
  version integer not null default 1 check (version > 0),
  channel text not null default 'stable'
    check (channel in ('stable', 'canary')),
  hold boolean not null default false,
  hold_reason text,
  held_since timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint company_modules_company_module_key
    unique (company_id, module_key),
  constraint company_modules_release_fk
    foreign key (module_key, version)
    references public.module_releases(module_key, version)
    on update cascade on delete restrict,
  constraint company_modules_hold_ck check (
    (not hold and hold_reason is null and held_since is null)
    or
    (hold and nullif(btrim(hold_reason), '') is not null and held_since is not null)
  )
);

create index company_modules_company_idx
  on public.company_modules(company_id);
create index company_modules_module_idx
  on public.company_modules(module_key);
create index company_modules_updated_by_idx
  on public.company_modules(updated_by);

-- Las tablas están en un esquema expuesto. Grants y RLS son capas separadas:
-- authenticated obtiene sólo DML y las policies limitan las filas/roles.
revoke all privileges on table
  public.modules,
  public.module_releases,
  public.company_modules
from public, anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.modules,
  public.module_releases,
  public.company_modules
to authenticated, service_role;

alter table public.modules enable row level security;
alter table public.module_releases enable row level security;
alter table public.company_modules enable row level security;

create policy modules_select on public.modules
  for select to authenticated
  using (true);

create policy modules_admin_write on public.modules
  for all to authenticated
  using ((select current_user_has_role(flux_sysadmin_roles())))
  with check ((select current_user_has_role(flux_sysadmin_roles())));

create policy module_releases_select on public.module_releases
  for select to authenticated
  using (true);

create policy module_releases_admin_write on public.module_releases
  for all to authenticated
  using ((select current_user_has_role(flux_sysadmin_roles())))
  with check ((select current_user_has_role(flux_sysadmin_roles())));

create policy company_modules_select on public.company_modules
  for select to authenticated
  using (
    company_id in (
      select pcm.company_id
      from public.profile_company_memberships pcm
      where pcm.profile_id = (select current_profile_id())
        and pcm.active
    )
    or (select current_user_has_role(flux_sysadmin_roles()))
  );

create policy company_modules_admin_write on public.company_modules
  for all to authenticated
  using ((select current_user_has_role(flux_sysadmin_roles())))
  with check ((select current_user_has_role(flux_sysadmin_roles())));

insert into public.modules (module_key, name, kind) values
  ('solicitudes',   'Solicitudes de pago',        'shared'),
  ('proveedores',   'Proveedores',                'shared'),
  ('efectivo',      'Efectivo y comprobaciones',  'shared'),
  ('dashboard',     'Dashboard',                  'shared'),
  ('aprobaciones',  'Aprobaciones',               'shared'),
  ('layouts',       'Layouts de pago',            'shared'),
  ('configuracion', 'Configuración',              'shared'),
  ('ingresos',      'Ingresos',                   'tenant_variant');

insert into public.module_releases (module_key, version, notes)
select module_key, 1, 'Migración inicial a React (F3/F4)'
from public.modules;

-- Los módulos compartidos parten habilitados. Una variante tenant sólo se
-- habilita automáticamente donde ya existe evidencia operativa estable. En DEV,
-- incident_charges identifica a Operadora sin depender del nombre o de un UUID
-- específico del ambiente. Nuevos tenants se habilitan después por configuración.
insert into public.company_modules (company_id, module_key, enabled, version)
select
  c.id,
  m.module_key,
  case
    when m.kind = 'shared' then true
    when m.module_key = 'ingresos' then exists (
      select 1
      from public.incident_charges ic
      where ic.company_id = c.id
    )
    else false
  end,
  1
from public.companies c
cross join public.modules m;

commit;
