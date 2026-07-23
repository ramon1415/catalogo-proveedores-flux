# Aplicación controlada de Migration 032 en DEV

Este paquete prepara el contrato de borrador interno previo a convertir un
`payment_intake` en `payment_requests`. No crea solicitudes definitivas, no
convierte intakes y no modifica proveedores.

## Alcance

- Entorno único futuro: Supabase DEV `scsirgbuqjcwoaxfacth`.
- Migration: `supabase/migrations/032_provider_intake_payment_draft.sql`.
- LOAD byte-identical: `03_LOAD_032_EXACT.sql`.
- SHA-256: `3e7ba49752a7bcd29e10df6ad1ae1a22609a2ccc51ad4b246bd7279ec212fd19`.
- No usar `db push`, `migration repair`, fragmentos manuales ni SQL editado.
- No ejecutar este paquete hasta recibir autorización explícita para Gate 1.

## Precondiciones

- Migrations 025, 029, 030 y 031 aplicadas íntegramente.
- `payment_intake_events_immutable` activo.
- RPCs canónicos de identidad, empresa y aprobadores disponibles.
- Migration 032 ausente; cualquier presencia parcial detiene la aplicación.
- Baseline de `payment_requests`, intakes, eventos y proveedores capturado sin
  identificadores de registros.

## Orden futuro de Gate 1

1. Ejecutar `01_PRECHECK_READ_ONLY.sql`.
2. Capturar la salida de `02_BACKUP_DEV.sql` en un artefacto privado.
3. Verificar que migration y LOAD sean byte-identical y coincidan con el SHA.
4. Hacer un dry-run transaccional sustituyendo únicamente el `COMMIT` final por
   `ROLLBACK`; esa copia no se versiona.
5. Ejecutar el LOAD exacto una sola vez con `ON_ERROR_STOP=1`.
6. Ejecutar `04_POSTCHECK_READ_ONLY.sql`.
7. Comparar conteos protegidos y detenerse ante cualquier delta no autorizado.

## Contrato preparado

- Una fila de borrador por intake.
- Tabla con RLS, cero policies y cero grants directos de aplicación.
- Contexto sanitizado y guardado parcial mediante RPCs `SECURITY DEFINER`.
- Empresa derivada server-side.
- Solicitante interno y aprobador canónico revalidados.
- Concurrencia optimista e idempotencia material.
- Un evento append-only sanitizado por guardado material.
- Proveedor no requerido para guardar; sí para `READY_FOR_CONVERSION`.
- Cero creación de `payment_requests` y cero transición a `converted`.

## Backup y rollback

`02_BACKUP_DEV.sql` es read-only: exporta definiciones, grants, RLS, funciones,
constraint de eventos y conteos sanitizados. No crea tablas backup. La salida
debe guardarse fuera de superficies de aplicación y sin secretos.

Si el LOAD futuro falla, la transacción debe revertirse completa. Si el
postcheck falla después de un commit, detener toda UAT y restaurar usando el
artefacto privado bajo una autorización de rollback separada. No improvisar
`DROP`, `repair` ni cambios manuales.

Consultar `docs/ops/provider-intake-payment-draft-2b1.md` antes de cualquier
rollout.
