# Aplicación controlada de Migration 030 en DEV

Este paquete corrige la idempotencia material de `transition_provider_intake` y
`add_provider_intake_note`. No modifica Migration 029, los FKs de auditoría, el
trigger append-only, la UI, el endpoint de archivos ni datos de negocio.

## Alcance

- Entorno único: Supabase DEV `scsirgbuqjcwoaxfacth`.
- Branch: `feature/ramon-provider-intake-triage-ui`.
- Migration y LOAD deben ser byte-identical.
- SHA-256 autorizado:
  `effc70e602c55ba6b291ad5e904848bd9190389b08c6dbc9186ee28eeab87aeb`.
- El LOAD se ejecuta exactamente una vez, solo después de un dry-run con
  rollback exitoso.
- No usar `db push`, `migration repair`, fragmentos manuales ni SQL editado
  durante la ejecución.

## Orden obligatorio

1. Ejecutar `01_PRECHECK_READ_ONLY.sql`.
2. Capturar `02_BACKUP_DEV.sql` en un artefacto privado del runner.
3. Crear una copia efímera de `03_LOAD_030_EXACT.sql` cuyo `COMMIT` final se
   sustituye por `ROLLBACK`.
4. Ejecutar esa copia con `ON_ERROR_STOP=1`.
5. Confirmar que helper y reemplazos no persistieron y que los conteos siguen
   intactos.
6. Ejecutar el LOAD versionado, sin modificarlo, una sola vez.
7. Ejecutar `04_POSTCHECK_READ_ONLY.sql`.
8. Conservar backup, migration, LOAD y evidencia sanitizada.

Si falla el LOAD, detenerse. No reintentar, no ejecutar correction SQL y no
alterar el historial de migrations.

## Huella

La huella SHA-256 se calcula server-side sobre JSONB canónico que incluye actor,
operación, intake, versión, estado esperado, timestamp UTC con microsegundos,
destino y nota ya normalizada. Los eventos nuevos guardan únicamente:

```json
{
  "action_id": "<uuid>",
  "action_fingerprint": "<64 hex lowercase>",
  "action_kind": "transition | internal_note",
  "contract_version": 2
}
```

Los eventos legacy sin huella fallan cerrado y nunca se reescriben.

## Rollback

No existe rollback automático. Consultar `05_ROLLBACK_GUIDANCE.md`. Los eventos
append-only no se borran ni se actualizan.
