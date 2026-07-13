# Aplicacion manual 023 en Supabase DEV

Este paquete instala el modelo de una sola aprobacion humana para pagos regulares:

`Solicitante -> presupuesto automatico -> Finanzas prepara -> Direccion decide -> Finanzas libera`

Tambien conserva cada revision de Direccion y devuelve a Nuevo layout la lista accionable de solicitudes con datos incompletos.

## Destino autorizado

- Ambiente: Supabase DEV
- Project ref: `scsirgbuqjcwoaxfacth`
- Migration: `023_batch_single_direction_approval_and_resubmission.sql`
- Enforcement: debe permanecer sin cambios

No ejecutar este paquete en PROD. No usar `db push` ni `migration repair`.

## Gate previo

1. Abrir SQL Editor en el proyecto DEV `scsirgbuqjcwoaxfacth`.
2. Confirmar visualmente el nombre del proyecto antes de cada archivo.
3. Ejecutar `01_PRECHECK_READ_ONLY.sql`.
4. Todos los renglones `check_status` deben ser `PASS` y no debe haber solicitudes con mas de una revision pendiente.
5. Ejecutar `02_BACKUP_DEV.sql` y descargar sus resultados. Conservar especialmente definiciones de funciones, lotes, items y configuracion de enforcement.
6. Comparar el SHA-256 local de `03_LOAD_023_EXACT.sql` con el valor registrado abajo.
7. Ejecutar `03_LOAD_023_EXACT.sql` completo, una sola vez.
8. Ejecutar `04_POSTCHECK_READ_ONLY.sql`.
9. Confirmar por escrito a Codex el resultado antes de marcar el PR Ready o mergearlo.

## Integridad

- SHA-256 de `03_LOAD_023_EXACT.sql`: `b25f792eb26297040d93f91ec83e20b329ef8485c87ee55b9ddf5352b4fb21af`
- La carga debe ser byte por byte igual a `supabase/migrations/023_batch_single_direction_approval_and_resubmission.sql`.

## Resultado esperado

- Cinco columnas de historial disponibles en `approval_batch_items`.
- Una sola revision pendiente por solicitud.
- Secuencia de revision unica por solicitud.
- Elegibilidad regular basada en solicitud enviada y presupuesto aprobable, sin aprobacion individual de Finanzas.
- Direccion puede decidir una revision nueva sin sobrescribir rechazos previos.
- Finanzas sigue siendo quien prepara y libera el corte.
- El preview de layout identifica rechazadas y datos faltantes.
- `regular_payments_require_closed_batch` y `enforcement_started_at` no cambian.

## Regla de detencion

Si cualquier archivo falla, no reintentar con SQL modificado. Guardar el error completo, cerrar la pestaña y usar `05_ROLLBACK_GUIDANCE.md`. La migration es transaccional: un error antes de `commit` revierte esa ejecucion.
