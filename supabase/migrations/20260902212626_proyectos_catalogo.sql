-- Catálogo controlado por empresa para identificar el costo agregado de un
-- proyecto que cruza varias facturas, proveedores o reembolsos.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists projects_company_name_unique
  on public.projects (company_id, lower(btrim(name)));

create index if not exists projects_company_active_idx
  on public.projects (company_id, active);

alter table public.projects enable row level security;

create policy projects_select_members on public.projects
  for select using (
    public.has_active_company_membership(public.current_profile_id(), company_id)
    or public.current_user_has_role(public.flux_sysadmin_roles())
  );

create policy projects_write_finance on public.projects
  for all using (
    public.current_user_has_role(array['finance','finanzas','treasury','tesoreria','administracion','sysadmin','system_admin','superadmin'])
    and (
      public.has_active_company_membership(public.current_profile_id(), company_id)
      or public.current_user_has_role(public.flux_sysadmin_roles())
    )
  )
  with check (
    public.current_user_has_role(array['finance','finanzas','treasury','tesoreria','administracion','sysadmin','system_admin','superadmin'])
    and (
      public.has_active_company_membership(public.current_profile_id(), company_id)
      or public.current_user_has_role(public.flux_sysadmin_roles())
    )
  );

alter table public.payment_requests
  add column if not exists project_id uuid references public.projects (id);

create index if not exists payment_requests_project_idx
  on public.payment_requests (project_id)
  where project_id is not null;

comment on column public.payment_requests.project_id is
  'Proyecto al que se carga el gasto (opcional). Permite el reporte de costo por proyecto cuando un esfuerzo cruza varias facturas y proveedores.';
