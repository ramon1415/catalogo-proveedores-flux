# Rollback guidance — Migration 029

No existe un rollback automático autorizado. No borrar intakes, archivos, eventos ni objetos Storage.

Antes de revertir:

1. Detener la UI revirtiendo la entrada de navegación y los tres archivos `provider_intakes.*`.
2. Retirar o deshabilitar el endpoint server-side de URL firmada.
3. Consultar cuántos eventos `internal_note` existen y preservar su contenido append-only.
4. Confirmar que ninguna sesión sigue invocando los RPCs de triage.
5. Tomar un respaldo adicional del catálogo y de las definiciones de funciones.

Reversión de esquema, solo con una migration nueva revisada:

- revocar `EXECUTE` de los cuatro RPCs públicos;
- retirar las funciones públicas y helpers en orden de dependencias;
- retirar el índice de idempotencia únicamente después de preservar los eventos;
- restaurar el constraint anterior de `event_type` solo si no existen eventos `internal_note`;
- evaluar por separado el índice `payment_intake_company_created_idx`.

No modificar migration 029 después de aplicada. No ejecutar `DELETE`, `TRUNCATE`, `DROP TABLE`, `db push` o `migration repair` como atajo de rollback.

Los respaldos `_backup_029_*` no deben borrarse dentro del incidente. Su retención y retiro requieren una autorización operativa separada.
