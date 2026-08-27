-- WS1 · Incidencias como módulo propio (Operadora-only)
--
-- Separa 'incidencias' del módulo 'ingresos' para que ingresos pueda variar por
-- empresa (Operadora = cuotas/socios/incidencias; Fersana = rentas fijas + otros).
-- El componente sigue siendo IngresosPage (se auto-detecta por la ruta /incidencias).
-- Habilitado SOLO para Operadora Tlacatecpan; deshabilitado para el resto (incl. Fersana).
--
-- Idempotente. Aplicar en editor SQL (dev primero; prod con autorización).

begin;

insert into public.modules (module_key, name, kind)
values ('incidencias', 'Incidencias', 'shared')
on conflict (module_key) do nothing;

insert into public.module_releases (module_key, version, notes)
values ('incidencias', 1, 'Split de incidencias fuera de ingresos (WS1)')
on conflict (module_key, version) do nothing;

-- Una fila por empresa; enabled solo Operadora. NOTA prod: fijar por company_id.
insert into public.company_modules (company_id, module_key, enabled, version)
select c.id, 'incidencias', (c.name = 'Operadora Tlacatecpan'), 1
from public.companies c
on conflict (company_id, module_key) do nothing;

commit;
