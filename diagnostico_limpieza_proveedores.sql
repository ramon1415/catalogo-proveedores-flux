-- Diagnostico seguro para limpieza de proveedores Flux Operadora
-- Objetivo: revisar dependencias antes de inactivar o borrar proveedores de prueba.
-- No ejecutar bloques de modificacion sin revisar resultados.

-- 1. Conteo total de proveedores
select count(*) as total_proveedores
from public.proveedores;

-- 2. Listado de proveedores actuales
select
  p.id,
  p.alias,
  p.nombre_completo,
  p.rfc,
  p.metodo_pago,
  p.destination_type,
  p.beneficiary_name,
  p.activo,
  p.created_at
from public.proveedores p
order by p.activo desc, p.alias nulls last, p.nombre_completo nulls last;

-- 3. Proveedores vinculados a solicitudes de pago
select
  p.id,
  p.alias,
  p.nombre_completo,
  count(pr.id) as total_solicitudes,
  count(*) filter (where pr.status = 'paid') as solicitudes_pagadas,
  count(*) filter (where pr.status in ('submitted','approved','changes_requested','finance_validation','scheduled')) as solicitudes_activas
from public.proveedores p
join public.payment_requests pr on pr.proveedor_id = p.id
group by p.id, p.alias, p.nombre_completo
order by total_solicitudes desc, p.alias nulls last;

-- 4. Proveedores vinculados a lineas de layout
select
  p.id,
  p.alias,
  p.nombre_completo,
  count(pll.id) as total_lineas_layout,
  count(*) filter (where pll.status = 'paid') as lineas_pagadas,
  count(*) filter (where pll.status = 'bank_rejected') as lineas_rechazadas
from public.proveedores p
join public.payment_layout_lines pll on pll.proveedor_id = p.id
group by p.id, p.alias, p.nombre_completo
order by total_lineas_layout desc, p.alias nulls last;

-- 5. Proveedores vinculados a pagos confirmados
select
  p.id,
  p.alias,
  p.nombre_completo,
  count(distinct prc.id) as total_comprobantes,
  count(distinct pr.id) as solicitudes_pagadas,
  sum(prc.amount) as monto_pagado
from public.proveedores p
join public.payment_requests pr on pr.proveedor_id = p.id
join public.payment_receipts prc on prc.payment_request_id = pr.id
group by p.id, p.alias, p.nombre_completo
order by total_comprobantes desc, p.alias nulls last;

-- 6. Proveedores sin dependencias operativas
with dependencias as (
  select proveedor_id, count(*) as total
  from public.payment_requests
  where proveedor_id is not null
  group by proveedor_id
  union all
  select proveedor_id, count(*) as total
  from public.payment_layout_lines
  where proveedor_id is not null
  group by proveedor_id
)
select
  p.id,
  p.alias,
  p.nombre_completo,
  p.rfc,
  p.activo,
  p.created_at
from public.proveedores p
left join (
  select proveedor_id, sum(total) as total_dependencias
  from dependencias
  group by proveedor_id
) d on d.proveedor_id = p.id
where coalesce(d.total_dependencias, 0) = 0
order by p.created_at desc, p.alias nulls last;

-- 7. Resumen por dependencia
with resumen as (
  select
    p.id,
    exists (
      select 1 from public.payment_requests pr where pr.proveedor_id = p.id
    ) as tiene_solicitudes,
    exists (
      select 1 from public.payment_layout_lines pll where pll.proveedor_id = p.id
    ) as tiene_layouts,
    exists (
      select 1
      from public.payment_requests pr
      join public.payment_receipts prc on prc.payment_request_id = pr.id
      where pr.proveedor_id = p.id
    ) as tiene_pagos_confirmados
  from public.proveedores p
)
select
  count(*) as total_proveedores,
  count(*) filter (where tiene_solicitudes) as con_solicitudes,
  count(*) filter (where tiene_layouts) as con_layouts,
  count(*) filter (where tiene_pagos_confirmados) as con_pagos_confirmados,
  count(*) filter (where not tiene_solicitudes and not tiene_layouts and not tiene_pagos_confirmados) as sin_dependencias
from resumen;

-- Recomendacion:
-- 1) Inactivar proveedores de prueba siempre que haya duda.
-- 2) Borrar fisicamente solo proveedores sin dependencias y despues de validar con negocio.
-- 3) No borrar proveedores ligados a solicitudes, layouts o pagos confirmados.

-- SQL opcional para inactivar proveedores de prueba por lista controlada.
-- Reemplazar los UUID por proveedores revisados y aprobados para inactivar.
/*
update public.proveedores
set activo = false,
    updated_at = now()
where id in (
  '00000000-0000-0000-0000-000000000000'
);
*/

-- SQL opcional para borrar solo proveedores sin dependencias.
-- Usar un filtro adicional por id para evitar borrado masivo accidental.
/*
delete from public.proveedores p
where p.id in (
  '00000000-0000-0000-0000-000000000000'
)
and not exists (select 1 from public.payment_requests pr where pr.proveedor_id = p.id)
and not exists (select 1 from public.payment_layout_lines pll where pll.proveedor_id = p.id);
*/
