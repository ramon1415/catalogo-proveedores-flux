# Guía de rollback para Migration 031

No ejecutar rollback automático y nunca editar o borrar eventos
`provider_matched`.

Si el LOAD falla antes del `COMMIT`, la transacción revierte completamente.
Detenerse, conservar logs sanitizados y no reintentar.

Si se detecta un defecto después del `COMMIT`:

1. suspender el uso de las acciones de matching en DEV;
2. revocar temporalmente `EXECUTE` de los tres RPCs únicamente con autorización
   de Seguridad;
3. comparar el artefacto privado generado por `02_BACKUP_DEV.sql`;
4. preparar una migration forward-only nueva;
5. si la contención requiere retirar contratos, eliminar solo los tres RPCs y
   sus tres helpers mediante esa migration forward-only;
6. preservar `matched_proveedor_id`, todos los eventos y el trigger append-only;
7. validar de nuevo grants, empresa, concurrencia e idempotencia.

No modificar migrations 025–031, no usar `migration repair`, no ejecutar
fragmentos manuales y no revertir datos maestros.
