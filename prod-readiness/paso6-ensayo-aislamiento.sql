-- ============================================================================
-- Prod paso 6 · Ensayo de aislamiento entre empresas (con empresa DESECHABLE)
-- DRAFT para Ramón. Correr en PROD *antes* de meter usuarios reales de Fersana.
-- Objetivo: probar que el RLS/scoping (que se estrena en prod al haber una 2ª
-- empresa) no cruza data entre empresas. Es la forma de matar el riesgo #1.
--
-- Requiere: paso 2 (migraciones) aplicado. Empresa de prueba = 'ZZ Aislamiento'.
-- ============================================================================

-- ── A) Fixtures desechables ─────────────────────────────────────────────────
begin;
insert into companies (name, legal_name, rfc, active)
select 'ZZ Aislamiento', 'ZZ Aislamiento Test', 'ZZA010101ZZ0', true
where not exists (select 1 from companies where rfc = 'ZZA010101ZZ0');

-- módulos mínimos para navegar (requiere paso 2)
insert into company_modules (company_id, module_key, enabled, version, channel)
select c.id, m.k, true, 1, 'stable'
from companies c cross join (values ('solicitudes'),('ingresos'),('proveedores')) m(k)
where c.rfc='ZZA010101ZZ0'
on conflict (company_id, module_key) do nothing;

-- un ingreso recurrente y una entrada (WS7) SOLO de la empresa de prueba
insert into recurring_income_templates (company_id, payer_name, concept, amount)
select c.id, 'ZZ Pagador', 'ZZ Renta test', 111.11
from companies c
where c.rfc='ZZA010101ZZ0'
  and not exists (
    select 1
    from recurring_income_templates t
    where t.company_id=c.id and t.payer_name='ZZ Pagador' and t.concept='ZZ Renta test'
  );
commit;

-- ── B) Verificación de aislamiento ──────────────────────────────────────────
-- B.1 (como service role / SQL editor): confirmar que los datos de la empresa de
--     prueba NO tocan a Operadora ni a Fersana (conteos por empresa).
select c.name, count(t.*) as recurring_income
from companies c
left join recurring_income_templates t on t.company_id = c.id
where c.rfc in ('ZZA010101ZZ0','SFE100825TM9') or c.name ilike '%operadora%'
group by c.name;
-- Esperado: 'ZZ Aislamiento' = 1 ; Operadora y Fersana = lo suyo, NO el de ZZ.

-- B.2 (prueba REAL de RLS — la que importa): en el /app de prod, dar de alta un
--     usuario de prueba SOLO con membresía en 'ZZ Aislamiento' (vía la liga o
--     asignándole membresía manual), loguearse como él y verificar EN CADA
--     feature scopeada que:
--       - NO ve solicitudes / ingresos / layouts / budget de Operadora ni Fersana.
--       - Operadora/Fersana NO ven lo de 'ZZ Aislamiento'.
--     Features a revisar: solicitudes, ingresos (panel recurrentes), efectivo,
--     layouts, dashboard, aprobaciones, proveedores.
--     (El RLS por company_id se ejercita por primera vez en prod al haber >1 empresa.)

-- B.3 Advisors de seguridad tras aplicar migraciones:
--     mcp get_advisors(security)  ó  Supabase Studio → Advisors → Security.
--     Revisar que las tablas nuevas (company_modules, platform_module_registry,
--     recurring_income_templates, tenant_income_entries, company_access_*) tengan
--     RLS habilitado y políticas correctas.

-- ── C) Limpieza (borrar TODO lo de la empresa de prueba) ────────────────────
begin;
delete from tenant_income_entries e using companies c where e.company_id=c.id and c.rfc='ZZA010101ZZ0';
delete from recurring_income_templates t using companies c where t.company_id=c.id and c.rfc='ZZA010101ZZ0';
delete from company_access_requests r using companies c where r.company_id=c.id and c.rfc='ZZA010101ZZ0';
delete from company_access_links l using companies c where l.company_id=c.id and c.rfc='ZZA010101ZZ0';
delete from approver_assignments a using companies c where a.company_id=c.id and c.rfc='ZZA010101ZZ0';
delete from company_directors d using companies c where d.company_id=c.id and c.rfc='ZZA010101ZZ0';
delete from profile_company_memberships m using companies c where m.company_id=c.id and c.rfc='ZZA010101ZZ0';
delete from company_modules cm using companies c where cm.company_id=c.id and c.rfc='ZZA010101ZZ0';
-- No borrar automáticamente el profile: puede conservar historia o membresías de otras empresas.
-- Si el usuario fue creado exclusivamente para el ensayo, eliminarlo manualmente tras verificar
-- que no tenga membresías, solicitudes ni eventos fuera de ZZ Aislamiento.
delete from companies where rfc='ZZA010101ZZ0';
commit;

-- Verificar limpieza:
select count(*) as debe_ser_0 from companies where rfc='ZZA010101ZZ0';
