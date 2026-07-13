# Guia de contingencia para migration 023

## Si la carga falla antes de `commit`

La migration completa esta dentro de una transaccion. PostgreSQL revierte automaticamente la ejecucion. No editar el SQL ni reintentar. Guardar:

- mensaje completo;
- linea reportada;
- hora;
- confirmacion visual de que era DEV `scsirgbuqjcwoaxfacth`.

Volver a ejecutar `01_PRECHECK_READ_ONLY.sql` para confirmar el estado, sin aplicar nada mas.

## Si la carga termina pero el postcheck falla

1. Detener pruebas y no mergear el PR.
2. No activar enforcement.
3. No generar layouts ni cerrar cortes con el modelo nuevo.
4. Comparar los resultados de `02_BACKUP_DEV.sql` y `04_POSTCHECK_READ_ONLY.sql`.
5. No borrar columnas, items ni historial.
6. No usar `DROP`, `DELETE`, `TRUNCATE`, `db push` o `migration repair`.
7. Preparar una migration correctiva revisada. Restaurar definiciones anteriores solo desde el respaldo capturado y con autorizacion explicita.

## Por que no existe un rollback automatico destructivo

La migration agrega vinculos de historial y puede registrar nuevas revisiones despues de quedar activa. Eliminar columnas o indices a ciegas podria perder trazabilidad o permitir dos revisiones pendientes. La contingencia segura es conservar datos, mantener enforcement sin cambios y corregir hacia adelante.

## Confirmaciones antes de continuar

- Los cinco checks principales de `04_POSTCHECK_READ_ONLY.sql` estan en `PASS`.
- Los conteos de lotes, solicitudes y layouts coinciden con el respaldo, salvo cambios operativos explicados.
- La configuracion de enforcement es igual antes y despues.
- No hay dos items pendientes para la misma solicitud.
- No hay secuencias de revision duplicadas.
- No se toco PROD.
