# Operación controlada — Mapper CONTPAQ

Este paquete acompaña al PR de la tercera rebanada. No contiene la semilla real porque el catálogo enriquecido y el archivo de razones no se localizaron en las fuentes conectadas durante la preparación del PR.

## Orden obligatorio

1. Merge y smoke de la rebanada 1.
2. Merge, migración y smoke del Dashboard anual.
3. Ejecutar `01_precheck_readonly.sql` en PROD.
4. Aplicar las migraciones versionadas del mapper.
5. Re-sincronizar el catálogo real de Operadora con los seis campos de árbol/vigencia.
6. Aplicar la semilla de 87 mapeos con método, razón y seis banderas `needs_review`.
7. Ejecutar `02_postcheck_readonly.sql`.
8. Liberar el frontend de la tercera rebanada.
9. Smoke de Configuración, mapper y facultades extraordinarias.

## Invariantes de la carga

- No copiar el `company_id` de DEV.
- Resolver Operadora por identidad estable y verificar nombre legal/RFC antes de escribir.
- Normalizar `code` y `cta_sup` sin guiones antes del upsert.
- Preservar el orden de tokens `C` y `RF` del archivo fuente.
- Nunca borrar cuentas ausentes; marcarlas `activo = false`.
- No aplicar mapeos hasta que las 63 cuentas objetivo estén sincronizadas y elegibles.
- El resultado debe ser 1,646 cuentas, 87 mapeos, 63 cuentas distintas y 6 revisiones.
- Los 87 mapeos deben conservar `mapping_method` y `mapping_reason` cuando corresponda.
- La validación 63/63 de existencia, hoja, detalle y gasto es gate de release.

## Rollback lógico

Las migraciones crean contrato y RLS; no borran datos operativos. Ante una carga defectuosa:

1. No borrar `historical_actuals` ni cuentas con movimientos.
2. Revocar la liberación del frontend o retirar el PR 3.
3. Marcar como inactivas las cuentas de la sincronización defectuosa.
4. Restaurar los mapeos desde el snapshot previo de `budget_account_mappings`.
5. Conservar bitácora del lote y corregir el parser o el artefacto fuente.

`NO_PROD_MERGE_YET` permanece vigente hasta completar el orden anterior.
