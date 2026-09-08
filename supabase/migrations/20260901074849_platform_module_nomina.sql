-- WS4b · Módulo 'nomina' (captura N2B en React) — APAGADO pendiente de QA
--
-- Registra el módulo pero lo deja deshabilitado en TODAS las empresas. Se habilita
-- (por empresa) SOLO después del QA de Ramón:
--   1. Edge Function payroll-materialize desplegada en el entorno.
--   2. Guards de scope de nómina verificados (budget_live_frontend_guards_base.js /
--      payroll_company_scope_fix.js) contra el comportamiento del rail vanilla.
--   3. RLS de companies para el selector de empresa.
-- Respeta el guardrail: nómina no entra como bloque incompleto.
--
-- Idempotente. Aplicar en editor SQL (dev primero; prod con autorización).

begin;

insert into public.modules (module_key, name, kind)
values ('nomina', 'Nómina', 'shared')
on conflict (module_key) do nothing;

insert into public.module_releases (module_key, version, notes)
values ('nomina', 1, 'Captura N2B migrada a React (WS4b) — pendiente QA')
on conflict (module_key, version) do nothing;

-- Deshabilitado en todas las empresas hasta el QA. Habilitar con:
--   update company_modules set enabled=true where module_key='nomina' and company_id=...
insert into public.company_modules (company_id, module_key, enabled, version)
select c.id, 'nomina', false, 1
from public.companies c
on conflict (company_id, module_key) do nothing;

commit;
