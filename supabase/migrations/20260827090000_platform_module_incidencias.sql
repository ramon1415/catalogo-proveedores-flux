-- WS1 · Incidencias como módulo propio (Operadora-only)
--
-- Separa 'incidencias' del módulo 'ingresos' para que ingresos pueda variar por
-- empresa (Operadora = cuotas/socios/incidencias; Fersana = rentas fijas + otros).
-- El componente sigue siendo IngresosPage (se auto-detecta por la ruta /incidencias).
-- Habilitado SOLO para la empresa incumbente que existe antes del alta de
-- Fersana. El preflight PROD exige exactamente una empresa en ese punto; así
-- evitamos depender de nombre o UUID específicos del ambiente.
--
-- Idempotente. Aplicar en editor SQL (dev primero; prod con autorización).

begin;

insert into public.modules (module_key, name, kind)
values ('incidencias', 'Incidencias', 'shared')
on conflict (module_key) do nothing;

insert into public.module_releases (module_key, version, notes)
values ('incidencias', 1, 'Split de incidencias fuera de ingresos (WS1)')
on conflict (module_key, version) do nothing;

do $block$
declare
  v_company_count integer;
begin
  select count(*) into v_company_count from public.companies;
  if v_company_count <> 1 then
    raise exception 'incidencias_expected_one_incumbent_company_found_%', v_company_count;
  end if;
end;
$block$;

-- La única empresa existente en este punto queda fijada por su company_id real.
-- Los tenants creados posteriormente (incluido Fersana) se seedean en OFF.
insert into public.company_modules (company_id, module_key, enabled, version)
select c.id, 'incidencias', true, 1
from public.companies c
on conflict (company_id, module_key) do update
set enabled = excluded.enabled,
    version = excluded.version;

commit;
