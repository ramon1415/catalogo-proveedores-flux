-- Flux Operadora - Migracion 008
-- Seed idempotente de roles aprobadores y reglas catch-all de aprobacion.
-- No modifica reglas existentes; solo cubre ambientes limpios o roles sin regla.

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
  ('sysadmin', 'Administrador tecnico'),
  ('system_admin', 'Administrador tecnico')
on conflict (name) do nothing;

-- Regla temporal de negocio:
-- Los roles aprobadores operativos pueden aprobar, rechazar, solicitar cambios,
-- aprobar excepciones y solicitar ajustes de presupuesto para cualquier monto,
-- empresa y centro de costo hasta que negocio defina topes por rol.
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
