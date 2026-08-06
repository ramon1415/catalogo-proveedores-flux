-- Flux Operadora - Migracion 006
-- Seed minimo seguro para Supabase prod limpio.
-- No incluye solicitudes, pagos, fondos, facturas ni datos operativos de dev.

insert into public.roles (name, description) values
  ('admin', 'Administrador del sistema'),
  ('finance', 'Finanzas'),
  ('finanzas', 'Finanzas'),
  ('approver_2', 'Aprobador nivel 2'),
  ('aprobador_2', 'Aprobador nivel 2'),
  ('solicitante', 'Solicitante'),
  ('operator', 'Operador'),
  ('sysadmin', 'Administrador tecnico'),
  ('system_admin', 'Administrador tecnico')
on conflict (name) do nothing;

-- Catalogos minimos para prod deben cargarse de forma controlada despues de crear el usuario admin inicial:
-- - companies
-- - cost_centers
-- - budget_categories
-- - company_bank_accounts
-- - perfiles y user_roles del admin inicial
-- - proveedores demo solo si negocio lo autoriza
