-- ============================================================================
-- Prod paso 5 · Seed de Soporte Fersana en PRODUCCIÓN
-- DRAFT para revisión de Ramón. Generado desde dev (31-ago-2026).
--
-- PRERREQUISITOS (o falla / queda incompleto):
--   1) Paso 1 aplicado en prod (platform_module_registry crea modules/company_modules).
--   2) Prod tiene una budget_versions ACTIVA del año 2026.
--   3) Confirmar unique constraints: companies(rfc), cost_centers(code),
--      budget_categories(code), company_modules(company_id,module_key).
--      (Los guards usan NOT EXISTS / ON CONFLICT; ajustar si difieren.)
--
-- Ejecutar en una transacción. Rerun-safe y fail-closed.
-- ============================================================================
begin;

-- 1) Empresa ------------------------------------------------------------------
insert into companies (name, legal_name, rfc, active)
select 'Soporte Fersana', 'Soporte Fersana, SA de CV', 'SFE100825TM9', true
where not exists (select 1 from companies where rfc = 'SFE100825TM9');

-- 2) Centro de costo ----------------------------------------------------------
insert into cost_centers (name, code, active)
select 'Soporte Fersana', 'SF', true
where not exists (select 1 from cost_centers where code = 'SF');

-- 3) Cuenta origen (BBVA cash management) -------------------------------------
insert into company_bank_accounts (company_id, name, bank_name, account_number, clabe, currency, account_type, active, last4)
select comp.id, 'BBVA Soporte Fersana SA de CV', 'BBVA', '0191134094', '012180001911340944', 'MXN', 'bank', true, '4094'
from companies comp
where comp.rfc = 'SFE100825TM9'
  and not exists (
    select 1 from company_bank_accounts b join companies c on c.id = b.company_id
    where c.rfc = 'SFE100825TM9' and b.account_number = '0191134094'
  );

-- 4) Módulos habilitados (requiere paso 1) ------------------------------------
-- Refleja DEV: incidencias, ingresos y nómina OFF; operación financiera ON.
insert into company_modules (company_id, module_key, enabled, version, channel)
select comp.id, d.module_key, d.enabled, d.version, d.channel
from (values
  ('aprobaciones', true, 1, 'stable'),
  ('configuracion', true, 1, 'stable'),
  ('dashboard', true, 1, 'stable'),
  ('efectivo', true, 1, 'stable'),
  ('incidencias', false, 1, 'stable'),
  ('ingresos', false, 1, 'stable'),
  ('layouts', true, 1, 'stable'),
  ('nomina', false, 1, 'stable'),
  ('proveedores', true, 1, 'stable'),
  ('solicitudes', true, 1, 'stable')
) d(module_key, enabled, version, channel)
join companies comp on comp.rfc = 'SFE100825TM9'
on conflict (company_id, module_key) do update set enabled = excluded.enabled;

-- 5) Catálogo Fersana · 60 partidas (56 con presupuesto distinto de cero) ----
insert into budget_categories (code, name, category, active) values
  ('SF-2026-001', 'Renta', 'Soporte Fersana · Operativo', true),
  ('SF-2026-002', 'Mantenimiento Inmueble', 'Soporte Fersana · Operativo', true),
  ('SF-2026-003', 'Reparacion y Mantto Bluepath', 'Soporte Fersana · Operativo', true),
  ('SF-2026-004', 'Luz', 'Soporte Fersana · Operativo', true),
  ('SF-2026-005', 'Dispensador de Agua', 'Soporte Fersana · Operativo', true),
  ('SF-2026-006', 'Enseres', 'Soporte Fersana · Operativo', true),
  ('SF-2026-007', 'Seguros de Gastos Médicos', 'Soporte Fersana · Operativo', true),
  ('SF-2026-008', 'Gastos de Viaje', 'Soporte Fersana · Operativo', true),
  ('SF-2026-009', 'Vales de Gasolina (Reembolso no gasto)', 'Soporte Fersana · Operativo', true),
  ('SF-2026-010', 'Correos y Mensajeria', 'Soporte Fersana · Operativo', true),
  ('SF-2026-011', 'Comisiones Efectivale', 'Soporte Fersana · Operativo', true),
  ('SF-2026-012', 'Servicio de Escolta', 'Soporte Fersana · Operativo', true),
  ('SF-2026-013', 'Google y MS Office', 'Soporte Fersana · Operativo', true),
  ('SF-2026-014', 'Activos Fijos Menores Bluepath', 'Soporte Fersana · Operativo', true),
  ('SF-2026-015', 'Bolsas de empleo (OCC, Computrabajo)', 'Soporte Fersana · Operativo', true),
  ('SF-2026-016', 'LinkedIn', 'Soporte Fersana · Operativo', true),
  ('SF-2026-017', 'Evaluatest', 'Soporte Fersana · Operativo', true),
  ('SF-2026-018', 'Estudios socioeconomicos', 'Soporte Fersana · Operativo', true),
  ('SF-2026-019', 'Kits de bienvenida onboarding', 'Soporte Fersana · Operativo', true),
  ('SF-2026-020', 'Capacitación interna', 'Soporte Fersana · Operativo', true),
  ('SF-2026-021', 'Curso brigadistas', 'Soporte Fersana · Operativo', true),
  ('SF-2026-022', 'Cursos primeros auxilios', 'Soporte Fersana · Operativo', true),
  ('SF-2026-023', 'Capacitación técnica', 'Soporte Fersana · Operativo', true),
  ('SF-2026-024', 'Membresía B-Salud', 'Soporte Fersana · Operativo', true),
  ('SF-2026-025', 'Talleres bienestar', 'Soporte Fersana · Operativo', true),
  ('SF-2026-026', 'Actividades de voluntariado', 'Soporte Fersana · Operativo', true),
  ('SF-2026-027', 'Convivios( San Valentín, Independencia)', 'Soporte Fersana · Operativo', true),
  ('SF-2026-028', 'Regalos día del padre', 'Soporte Fersana · Operativo', true),
  ('SF-2026-029', 'Regalos día de las madres', 'Soporte Fersana · Operativo', true),
  ('SF-2026-030', 'Pasteles', 'Soporte Fersana · Operativo', true),
  ('SF-2026-031', 'Snacks saludables viernes', 'Soporte Fersana · Operativo', true),
  ('SF-2026-032', 'Kits de identidad', 'Soporte Fersana · Operativo', true),
  ('SF-2026-033', 'Actividades de integración', 'Soporte Fersana · Operativo', true),
  ('SF-2026-034', 'Evento de fin de año', 'Soporte Fersana · Operativo', true),
  ('SF-2026-035', 'Café', 'Soporte Fersana · Operativo', true),
  ('SF-2026-036', 'Papelería', 'Soporte Fersana · Operativo', true),
  ('SF-2026-037', 'Adornos oficina', 'Soporte Fersana · Operativo', true),
  ('SF-2026-038', 'Equipos de cómputo nuevos integrantes', 'Soporte Fersana · Operativo', true),
  ('SF-2026-039', 'Diseño comunicación interna', 'Soporte Fersana · Operativo', true),
  ('SF-2026-040', 'Fotos profesionales colaboradores', 'Soporte Fersana · Operativo', true),
  ('SF-2026-041', 'Aseoría Recursos Humanos', 'Soporte Fersana · Operativo', true),
  ('SF-2026-042', 'Asesoría laboral', 'Soporte Fersana · Operativo', true),
  ('SF-2026-043', 'Worky plataforma', 'Soporte Fersana · Operativo', true),
  ('SF-2026-044', 'Worky maquila', 'Soporte Fersana · Operativo', true),
  ('SF-2026-045', 'Comisiones Bancarias', 'Soporte Fersana · Operativo', true),
  ('SF-2026-046', 'Depreciaciones', 'Soporte Fersana · Operativo', true),
  ('SF-2026-047', 'Renta Servidor y Mtto.', 'Soporte Fersana · Operativo', true),
  ('SF-2026-048', 'Actualización y Mtto. Contpaq', 'Soporte Fersana · Operativo', true),
  ('SF-2026-049', 'Partidas no Deducibles', 'Soporte Fersana · Operativo', true),
  ('SF-2026-050', 'Servicios notariales y auditoría', 'Soporte Fersana · Operativo', true),
  ('SF-2026-051', 'Iguala Blanco Carrillo', 'Soporte Fersana · Operativo', true),
  ('SF-2026-052', 'Viajes Transporte', 'Soporte Fersana · Estratégico', true),
  ('SF-2026-053', 'Congresos', 'Soporte Fersana · Estratégico', true),
  ('SF-2026-054', 'Viajes T&E (Hospedaje, Comidas)', 'Soporte Fersana · Estratégico', true),
  ('SF-2026-055', 'Pagina Web Dezdez & Branding Material', 'Soporte Fersana · Estratégico', true),
  ('SF-2026-056', 'Plataforma de Portfolio Management', 'Soporte Fersana · Estratégico', true),
  ('SF-2026-057', 'Offsite Equipo Directivo', 'Soporte Fersana · Estratégico', true),
  ('SF-2026-058', 'Comidas Representación', 'Soporte Fersana · Estratégico', true),
  ('SF-2026-059', 'Consultoria Medicion de Impacto', 'Soporte Fersana · Estratégico', true),
  ('SF-2026-060', 'Gastos Automatización', 'Soporte Fersana · Estratégico', true)
on conflict (code) do nothing;

insert into company_cost_center_budget_categories (
  company_id, cost_center_id, budget_category_id, active
)
select comp.id, cc.id, bc.id, true
from companies comp
join cost_centers cc on cc.code = 'SF'
join budget_categories bc on bc.code between 'SF-2026-001' and 'SF-2026-060'
where comp.rfc = 'SFE100825TM9'
on conflict (company_id, cost_center_id, budget_category_id)
do update set active = excluded.active;

-- 6) Presupuesto 2026 · 322 líneas -------------------------------------------
-- Keyed por código + versión activa 2026 + cost center SF (portable a prod).
insert into budget_lines (budget_version_id, company_id, cost_center_id, budget_category_id, budget_month, amount)
select v.id, comp.id, cc.id, bc.id, d.m::date, d.a
from (values
  ('SF-2026-001', '2026-01-01', 135000.00),
  ('SF-2026-001', '2026-02-01', 135000.00),
  ('SF-2026-001', '2026-03-01', 135000.00),
  ('SF-2026-001', '2026-04-01', 135000.00),
  ('SF-2026-001', '2026-05-01', 135000.00),
  ('SF-2026-001', '2026-06-01', 135000.00),
  ('SF-2026-001', '2026-07-01', 139050.00),
  ('SF-2026-001', '2026-08-01', 139050.00),
  ('SF-2026-001', '2026-09-01', 139050.00),
  ('SF-2026-001', '2026-10-01', 139050.00),
  ('SF-2026-001', '2026-11-01', 139050.00),
  ('SF-2026-001', '2026-12-01', 139050.00),
  ('SF-2026-003', '2026-01-01', 4750.00),
  ('SF-2026-003', '2026-02-01', 4750.00),
  ('SF-2026-003', '2026-03-01', 4750.00),
  ('SF-2026-003', '2026-04-01', 4750.00),
  ('SF-2026-003', '2026-05-01', 4750.00),
  ('SF-2026-003', '2026-06-01', 4750.00),
  ('SF-2026-003', '2026-07-01', 4750.00),
  ('SF-2026-003', '2026-08-01', 4750.00),
  ('SF-2026-003', '2026-09-01', 4750.00),
  ('SF-2026-003', '2026-10-01', 4750.00),
  ('SF-2026-003', '2026-11-01', 4750.00),
  ('SF-2026-003', '2026-12-01', 4750.00),
  ('SF-2026-004', '2026-01-01', 15000.00),
  ('SF-2026-004', '2026-02-01', 15000.00),
  ('SF-2026-004', '2026-03-01', 15000.00),
  ('SF-2026-004', '2026-04-01', 15000.00),
  ('SF-2026-004', '2026-05-01', 15000.00),
  ('SF-2026-004', '2026-06-01', 15000.00),
  ('SF-2026-004', '2026-07-01', 15000.00),
  ('SF-2026-004', '2026-08-01', 15000.00),
  ('SF-2026-004', '2026-09-01', 15000.00),
  ('SF-2026-004', '2026-10-01', 15000.00),
  ('SF-2026-004', '2026-11-01', 15000.00),
  ('SF-2026-004', '2026-12-01', 15000.00),
  ('SF-2026-005', '2026-01-01', 2000.00),
  ('SF-2026-005', '2026-02-01', 2000.00),
  ('SF-2026-005', '2026-03-01', 2000.00),
  ('SF-2026-005', '2026-04-01', 2000.00),
  ('SF-2026-005', '2026-05-01', 2000.00),
  ('SF-2026-005', '2026-06-01', 2000.00),
  ('SF-2026-005', '2026-07-01', 2000.00),
  ('SF-2026-005', '2026-08-01', 2000.00),
  ('SF-2026-005', '2026-09-01', 2000.00),
  ('SF-2026-005', '2026-10-01', 2000.00),
  ('SF-2026-005', '2026-11-01', 2000.00),
  ('SF-2026-005', '2026-12-01', 2000.00),
  ('SF-2026-006', '2026-06-01', 3000.00),
  ('SF-2026-006', '2026-09-01', 3000.00),
  ('SF-2026-006', '2026-12-01', 3000.00),
  ('SF-2026-007', '2026-08-01', 34664.00),
  ('SF-2026-007', '2026-09-01', 5200.00),
  ('SF-2026-007', '2026-10-01', 5200.00),
  ('SF-2026-007', '2026-11-01', 5200.00),
  ('SF-2026-007', '2026-12-01', 5200.00),
  ('SF-2026-008', '2026-04-01', 44129.00),
  ('SF-2026-008', '2026-05-01', 10000.00),
  ('SF-2026-008', '2026-06-01', 10000.00),
  ('SF-2026-008', '2026-07-01', 10000.00),
  ('SF-2026-008', '2026-08-01', 10000.00),
  ('SF-2026-008', '2026-09-01', 10000.00),
  ('SF-2026-008', '2026-10-01', 10000.00),
  ('SF-2026-008', '2026-11-01', 10000.00),
  ('SF-2026-008', '2026-12-01', 10000.00),
  ('SF-2026-009', '2026-01-01', 52000.00),
  ('SF-2026-009', '2026-02-01', 52000.00),
  ('SF-2026-009', '2026-03-01', 60000.00),
  ('SF-2026-010', '2026-04-01', 700.00),
  ('SF-2026-010', '2026-05-01', 700.00),
  ('SF-2026-010', '2026-06-01', 700.00),
  ('SF-2026-010', '2026-07-01', 700.00),
  ('SF-2026-010', '2026-08-01', 700.00),
  ('SF-2026-010', '2026-09-01', 700.00),
  ('SF-2026-010', '2026-10-01', 700.00),
  ('SF-2026-010', '2026-11-01', 700.00),
  ('SF-2026-010', '2026-12-01', 700.00),
  ('SF-2026-011', '2026-01-01', 2178.00),
  ('SF-2026-011', '2026-02-01', 2178.00),
  ('SF-2026-011', '2026-03-01', 2512.50),
  ('SF-2026-012', '2026-01-01', 19694.00),
  ('SF-2026-012', '2026-02-01', 19694.00),
  ('SF-2026-012', '2026-03-01', 19694.00),
  ('SF-2026-012', '2026-04-01', 19694.00),
  ('SF-2026-012', '2026-05-01', 19694.00),
  ('SF-2026-012', '2026-06-01', 19694.00),
  ('SF-2026-012', '2026-07-01', 19694.00),
  ('SF-2026-012', '2026-08-01', 19694.00),
  ('SF-2026-012', '2026-09-01', 19694.00),
  ('SF-2026-012', '2026-10-01', 19694.00),
  ('SF-2026-012', '2026-11-01', 19694.00),
  ('SF-2026-012', '2026-12-01', 19694.00),
  ('SF-2026-013', '2026-02-01', 54378.00),
  ('SF-2026-015', '2026-04-01', 1855.00),
  ('SF-2026-015', '2026-07-01', 1855.00),
  ('SF-2026-015', '2026-10-01', 1855.00),
  ('SF-2026-016', '2026-09-01', 4000.00),
  ('SF-2026-017', '2026-05-01', 9363.00),
  ('SF-2026-018', '2026-05-01', 980.00),
  ('SF-2026-018', '2026-06-01', 980.00),
  ('SF-2026-018', '2026-10-01', 980.00),
  ('SF-2026-019', '2026-01-01', 900.00),
  ('SF-2026-019', '2026-04-01', 450.00),
  ('SF-2026-019', '2026-08-01', 900.00),
  ('SF-2026-020', '2026-01-01', 500.00),
  ('SF-2026-020', '2026-05-01', 200.00),
  ('SF-2026-020', '2026-09-01', 200.00),
  ('SF-2026-021', '2026-05-01', 3480.00),
  ('SF-2026-022', '2026-05-01', 4500.00),
  ('SF-2026-024', '2026-11-01', 7700.00),
  ('SF-2026-025', '2026-09-01', 2500.00),
  ('SF-2026-026', '2026-06-01', 6000.00),
  ('SF-2026-027', '2026-02-01', 1144.00),
  ('SF-2026-027', '2026-09-01', 1740.00),
  ('SF-2026-027', '2026-11-01', 1740.00),
  ('SF-2026-028', '2026-07-01', 1600.00),
  ('SF-2026-029', '2026-05-01', 2400.00),
  ('SF-2026-030', '2026-01-01', 400.00),
  ('SF-2026-030', '2026-02-01', 400.00),
  ('SF-2026-030', '2026-03-01', 400.00),
  ('SF-2026-030', '2026-04-01', 400.00),
  ('SF-2026-030', '2026-05-01', 400.00),
  ('SF-2026-030', '2026-06-01', 400.00),
  ('SF-2026-030', '2026-07-01', 400.00),
  ('SF-2026-030', '2026-08-01', 400.00),
  ('SF-2026-030', '2026-09-01', 400.00),
  ('SF-2026-030', '2026-10-01', 400.00),
  ('SF-2026-030', '2026-11-01', 400.00),
  ('SF-2026-030', '2026-12-01', 400.00),
  ('SF-2026-031', '2026-01-01', 1500.00),
  ('SF-2026-031', '2026-02-01', 1500.00),
  ('SF-2026-031', '2026-03-01', 1500.00),
  ('SF-2026-031', '2026-04-01', 1500.00),
  ('SF-2026-031', '2026-05-01', 1500.00),
  ('SF-2026-031', '2026-06-01', 1500.00),
  ('SF-2026-031', '2026-07-01', 1500.00),
  ('SF-2026-031', '2026-08-01', 1500.00),
  ('SF-2026-031', '2026-09-01', 1500.00),
  ('SF-2026-031', '2026-10-01', 1500.00),
  ('SF-2026-031', '2026-11-01', 1500.00),
  ('SF-2026-031', '2026-12-01', 1500.00),
  ('SF-2026-032', '2026-04-01', 13500.00),
  ('SF-2026-033', '2026-02-01', 6000.00),
  ('SF-2026-033', '2026-06-01', 6000.00),
  ('SF-2026-033', '2026-10-01', 6000.00),
  ('SF-2026-034', '2026-12-01', 60000.00),
  ('SF-2026-035', '2026-01-01', 1624.00),
  ('SF-2026-035', '2026-02-01', 1624.00),
  ('SF-2026-035', '2026-03-01', 1624.00),
  ('SF-2026-035', '2026-04-01', 1624.00),
  ('SF-2026-035', '2026-05-01', 1624.00),
  ('SF-2026-035', '2026-06-01', 1624.00),
  ('SF-2026-035', '2026-07-01', 1624.00),
  ('SF-2026-035', '2026-08-01', 1624.00),
  ('SF-2026-035', '2026-09-01', 1624.00),
  ('SF-2026-035', '2026-10-01', 1624.00),
  ('SF-2026-035', '2026-11-01', 1624.00),
  ('SF-2026-035', '2026-12-01', 1624.00),
  ('SF-2026-036', '2026-02-01', 450.00),
  ('SF-2026-036', '2026-05-01', 450.00),
  ('SF-2026-036', '2026-08-01', 450.00),
  ('SF-2026-036', '2026-11-01', 450.00),
  ('SF-2026-037', '2026-02-01', 700.00),
  ('SF-2026-037', '2026-09-01', 700.00),
  ('SF-2026-037', '2026-11-01', 1200.00),
  ('SF-2026-037', '2026-12-01', 2000.00),
  ('SF-2026-038', '2026-04-01', 30050.00),
  ('SF-2026-038', '2026-08-01', 14000.00),
  ('SF-2026-039', '2026-01-01', 3528.00),
  ('SF-2026-039', '2026-02-01', 3528.00),
  ('SF-2026-039', '2026-03-01', 3528.00),
  ('SF-2026-039', '2026-04-01', 3528.00),
  ('SF-2026-039', '2026-05-01', 3528.00),
  ('SF-2026-039', '2026-06-01', 3528.00),
  ('SF-2026-039', '2026-07-01', 3528.00),
  ('SF-2026-039', '2026-08-01', 3528.00),
  ('SF-2026-039', '2026-09-01', 3528.00),
  ('SF-2026-039', '2026-10-01', 3528.00),
  ('SF-2026-039', '2026-11-01', 3528.00),
  ('SF-2026-039', '2026-12-01', 3528.00),
  ('SF-2026-040', '2026-05-01', 4500.00),
  ('SF-2026-041', '2026-04-01', 10000.00),
  ('SF-2026-041', '2026-06-01', 10000.00),
  ('SF-2026-042', '2026-04-01', 46400.00),
  ('SF-2026-042', '2026-05-01', 11600.00),
  ('SF-2026-042', '2026-06-01', 11600.00),
  ('SF-2026-042', '2026-07-01', 11600.00),
  ('SF-2026-042', '2026-08-01', 11600.00),
  ('SF-2026-042', '2026-09-01', 11600.00),
  ('SF-2026-042', '2026-10-01', 11600.00),
  ('SF-2026-042', '2026-11-01', 11600.00),
  ('SF-2026-042', '2026-12-01', 11600.00),
  ('SF-2026-043', '2026-07-01', 13920.00),
  ('SF-2026-044', '2026-01-01', 2651.00),
  ('SF-2026-044', '2026-02-01', 2651.00),
  ('SF-2026-044', '2026-03-01', 2651.00),
  ('SF-2026-044', '2026-04-01', 2651.00),
  ('SF-2026-044', '2026-05-01', 2651.00),
  ('SF-2026-044', '2026-06-01', 2651.00),
  ('SF-2026-044', '2026-07-01', 2651.00),
  ('SF-2026-044', '2026-08-01', 2651.00),
  ('SF-2026-044', '2026-09-01', 2651.00),
  ('SF-2026-044', '2026-10-01', 2651.00),
  ('SF-2026-044', '2026-11-01', 2651.00),
  ('SF-2026-044', '2026-12-01', 2651.00),
  ('SF-2026-045', '2026-01-01', 1250.00),
  ('SF-2026-045', '2026-02-01', 1250.00),
  ('SF-2026-045', '2026-03-01', 1250.00),
  ('SF-2026-045', '2026-04-01', 1250.00),
  ('SF-2026-045', '2026-05-01', 1250.00),
  ('SF-2026-045', '2026-06-01', 1250.00),
  ('SF-2026-045', '2026-07-01', 1250.00),
  ('SF-2026-045', '2026-08-01', 1250.00),
  ('SF-2026-045', '2026-09-01', 1250.00),
  ('SF-2026-045', '2026-10-01', 1250.00),
  ('SF-2026-045', '2026-11-01', 1250.00),
  ('SF-2026-045', '2026-12-01', 1250.00),
  ('SF-2026-046', '2026-01-01', 3500.00),
  ('SF-2026-046', '2026-02-01', 3500.00),
  ('SF-2026-046', '2026-03-01', 3500.00),
  ('SF-2026-046', '2026-04-01', 3500.00),
  ('SF-2026-046', '2026-05-01', 3500.00),
  ('SF-2026-046', '2026-06-01', 3500.00),
  ('SF-2026-046', '2026-07-01', 3500.00),
  ('SF-2026-046', '2026-08-01', 3500.00),
  ('SF-2026-046', '2026-09-01', 3500.00),
  ('SF-2026-046', '2026-10-01', 3500.00),
  ('SF-2026-046', '2026-11-01', 3500.00),
  ('SF-2026-046', '2026-12-01', 3500.00),
  ('SF-2026-047', '2026-01-01', 5000.00),
  ('SF-2026-047', '2026-02-01', 5000.00),
  ('SF-2026-047', '2026-03-01', 5000.00),
  ('SF-2026-047', '2026-04-01', 5000.00),
  ('SF-2026-047', '2026-05-01', 5000.00),
  ('SF-2026-047', '2026-06-01', 5000.00),
  ('SF-2026-047', '2026-07-01', 5000.00),
  ('SF-2026-047', '2026-08-01', 5000.00),
  ('SF-2026-047', '2026-09-01', 5000.00),
  ('SF-2026-047', '2026-10-01', 5000.00),
  ('SF-2026-047', '2026-11-01', 5000.00),
  ('SF-2026-047', '2026-12-01', 5000.00),
  ('SF-2026-049', '2026-01-01', 1500.00),
  ('SF-2026-049', '2026-02-01', 1500.00),
  ('SF-2026-049', '2026-03-01', 1500.00),
  ('SF-2026-049', '2026-04-01', 1500.00),
  ('SF-2026-049', '2026-05-01', 1500.00),
  ('SF-2026-049', '2026-06-01', 1500.00),
  ('SF-2026-049', '2026-07-01', 1500.00),
  ('SF-2026-049', '2026-08-01', 1500.00),
  ('SF-2026-049', '2026-09-01', 1500.00),
  ('SF-2026-049', '2026-10-01', 1500.00),
  ('SF-2026-049', '2026-11-01', 1500.00),
  ('SF-2026-049', '2026-12-01', 1500.00),
  ('SF-2026-050', '2026-01-01', 10000.00),
  ('SF-2026-050', '2026-02-01', 10000.00),
  ('SF-2026-050', '2026-03-01', 10000.00),
  ('SF-2026-050', '2026-04-01', 10000.00),
  ('SF-2026-050', '2026-05-01', 10000.00),
  ('SF-2026-050', '2026-06-01', 10000.00),
  ('SF-2026-050', '2026-07-01', 41500.00),
  ('SF-2026-050', '2026-08-01', 41500.00),
  ('SF-2026-050', '2026-09-01', 10000.00),
  ('SF-2026-050', '2026-10-01', 10000.00),
  ('SF-2026-050', '2026-11-01', 10000.00),
  ('SF-2026-050', '2026-12-01', 10000.00),
  ('SF-2026-051', '2026-01-01', 100000.00),
  ('SF-2026-051', '2026-02-01', 100000.00),
  ('SF-2026-051', '2026-03-01', 100000.00),
  ('SF-2026-051', '2026-04-01', 100000.00),
  ('SF-2026-051', '2026-05-01', 100000.00),
  ('SF-2026-051', '2026-06-01', 100000.00),
  ('SF-2026-051', '2026-07-01', 100000.00),
  ('SF-2026-051', '2026-08-01', 100000.00),
  ('SF-2026-051', '2026-09-01', 100000.00),
  ('SF-2026-051', '2026-10-01', 100000.00),
  ('SF-2026-051', '2026-11-01', 100000.00),
  ('SF-2026-051', '2026-12-01', 100000.00),
  ('SF-2026-052', '2026-04-01', 44127.00),
  ('SF-2026-052', '2026-06-01', 10000.00),
  ('SF-2026-053', '2026-06-01', 12000.00),
  ('SF-2026-053', '2026-10-01', 12000.00),
  ('SF-2026-054', '2026-05-01', 8000.00),
  ('SF-2026-054', '2026-06-01', 15000.00),
  ('SF-2026-054', '2026-07-01', 8000.00),
  ('SF-2026-054', '2026-09-01', 8000.00),
  ('SF-2026-054', '2026-10-01', 15000.00),
  ('SF-2026-054', '2026-11-01', 8000.00),
  ('SF-2026-055', '2026-08-01', 200000.00),
  ('SF-2026-056', '2026-05-01', 6667.00),
  ('SF-2026-056', '2026-06-01', 6667.00),
  ('SF-2026-056', '2026-07-01', 6667.00),
  ('SF-2026-056', '2026-08-01', 6667.00),
  ('SF-2026-056', '2026-09-01', 6667.00),
  ('SF-2026-056', '2026-10-01', 6667.00),
  ('SF-2026-056', '2026-11-01', 6667.00),
  ('SF-2026-056', '2026-12-01', 6667.00),
  ('SF-2026-057', '2026-10-01', 114000.00),
  ('SF-2026-058', '2026-03-01', 2145.00),
  ('SF-2026-058', '2026-04-01', 4000.00),
  ('SF-2026-058', '2026-05-01', 4000.00),
  ('SF-2026-058', '2026-06-01', 4000.00),
  ('SF-2026-058', '2026-07-01', 4000.00),
  ('SF-2026-058', '2026-08-01', 4000.00),
  ('SF-2026-058', '2026-09-01', 4000.00),
  ('SF-2026-058', '2026-10-01', 4000.00),
  ('SF-2026-058', '2026-11-01', 4000.00),
  ('SF-2026-058', '2026-12-01', 4000.00),
  ('SF-2026-059', '2026-03-01', 116177.00),
  ('SF-2026-059', '2026-04-01', 67091.50),
  ('SF-2026-059', '2026-05-01', 67091.50),
  ('SF-2026-059', '2026-06-01', 67091.50),
  ('SF-2026-059', '2026-07-01', 67091.50),
  ('SF-2026-059', '2026-08-01', 67091.50),
  ('SF-2026-059', '2026-09-01', 67091.50),
  ('SF-2026-059', '2026-10-01', 67091.50),
  ('SF-2026-059', '2026-11-01', 67091.50),
  ('SF-2026-059', '2026-12-01', 67091.50),
  ('SF-2026-060', '2026-08-01', 75000.00),
  ('SF-2026-060', '2026-09-01', 75000.00),
  ('SF-2026-060', '2026-10-01', 100000.00),
  ('SF-2026-060', '2026-11-01', 100000.00),
  ('SF-2026-060', '2026-12-01', 100000.00)
) d(code, m, a)
join budget_categories bc on bc.code = d.code
join cost_centers cc on cc.code = 'SF'
join companies comp on comp.rfc = 'SFE100825TM9'
cross join (select id from budget_versions where active and year = 2026 limit 1) v
where not exists (
  select 1
  from budget_lines existing
  where existing.budget_version_id = v.id
    and existing.company_id = comp.id
    and existing.cost_center_id = cc.id
    and existing.budget_category_id = bc.id
    and existing.budget_month = d.m::date
);

-- Fail closed: un reintento no duplica y cualquier drift aborta toda la transacción.
do $$
declare
  v_count bigint;
  v_total numeric;
begin
  select count(*), coalesce(sum(bl.amount), 0)
    into v_count, v_total
  from budget_lines bl
  join companies c on c.id = bl.company_id
  join budget_versions bv on bv.id = bl.budget_version_id
  where c.rfc = 'SFE100825TM9'
    and bv.active
    and bv.year = 2026;

  if v_count <> 322 or v_total <> 6289204.00 then
    raise exception 'fersana_budget_postcheck_failed: count=%, total=%', v_count, v_total;
  end if;
end;
$$;

commit;

-- ============================================================================
-- VERIFICACIÓN (esperado):
--   select rfc, legal_name from companies where rfc='SFE100825TM9';
--   select count(*) n, sum(amount) total from budget_lines bl
--     join companies c on c.id=bl.company_id where c.rfc='SFE100825TM9';
--     -> n = 322,  total = 6,289,204.00
--   select module_key, enabled from company_modules cm
--     join companies c on c.id=cm.company_id where c.rfc='SFE100825TM9' order by 1;
--
-- MEMBERSHIPS / ROLES / APROBADORES: NO se seedean aquí — los profiles se crean en
-- el primer login OAuth. Post-seed en prod:
--   - La lista final de usuarios/correos se confirma en el gate GO/NO-GO.
--     entran por la LIGA de acceso de Fersana (code 'fersana').
--   - SysAdmin (Carlos) confirma rol + membresía por usuario.
--   - Cesar = Director/Aprobador (approver_assignments) — necesita rol de aprobador ANTES.
--
-- IDEMPOTENCIA: las líneas usan NOT EXISTS sobre versión/empresa/centro/partida/mes.
-- No borrar datos para reintentar. El postcheck anterior aborta si detecta drift.
-- ============================================================================
