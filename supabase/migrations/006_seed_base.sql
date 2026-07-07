-- Flux Operadora - Migracion 006
-- Seed minimo seguro para Supabase prod limpio.
-- No incluye solicitudes, pagos, fondos, facturas ni datos operativos de dev.

insert into public.roles (name, description) values
  ('admin', 'Administrador del sistema'),
  ('superadmin', 'Administrador global'),
  ('finance', 'Finanzas'),
  ('finanzas', 'Finanzas'),
  ('treasury', 'Tesoreria'),
  ('tesoreria', 'Tesoreria'),
  ('administracion', 'Administracion'),
  ('director', 'Direccion'),
  ('direccion', 'Direccion'),
  ('approver_2', 'Aprobador nivel 2'),
  ('aprobador_2', 'Aprobador nivel 2'),
  ('solicitante', 'Solicitante'),
  ('operator', 'Operador'),
  ('sysadmin', 'Administrador tecnico'),
  ('system_admin', 'Administrador tecnico')
on conflict (name) do nothing;

-- Seed idempotente de reglas catch-all de aprobacion.
-- Regla temporal de negocio: los roles aprobadores operativos pueden aprobar/rechazar
-- cualquier monto, empresa y centro de costo hasta que negocio defina topes por rol.
insert into public.approval_rules (
  role_id,
  approval_level,
  amount_min,
  amount_max,
  company_id,
  cost_center_id,
  can_approve,
  can_reject,
  can_request_changes,
  can_approve_exception,
  can_request_budget_adjustment,
  active
)
select
  r.id,
  1,
  0,
  null,
  null,
  null,
  true,
  true,
  true,
  true,
  true,
  true
from public.roles r
where r.name in (
  'sysadmin',
  'system_admin',
  'admin',
  'superadmin',
  'finance',
  'finanzas',
  'treasury',
  'tesoreria',
  'administracion',
  'director',
  'direccion',
  'approver_2',
  'aprobador_2'
)
and not exists (
  select 1
  from public.approval_rules ar
  where ar.role_id = r.id
);

-- Catalogos minimos para prod deben cargarse de forma controlada despues de crear el usuario admin inicial:
-- - companies
-- - cost_centers
-- - budget_categories
-- - tax_schemes
-- - company_bank_accounts
-- - perfiles y user_roles del admin inicial
-- - proveedores demo solo si negocio lo autoriza
