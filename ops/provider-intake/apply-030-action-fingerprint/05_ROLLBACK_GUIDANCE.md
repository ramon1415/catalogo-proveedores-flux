# Guía de rollback para Migration 030

No ejecutar rollback automático ni editar eventos. Migration 030 reemplaza dos
funciones y agrega un helper interno; los eventos v2 que genere Gate 2 deben
permanecer append-only.

Ante una falla antes de `COMMIT`, la transacción revierte por completo. Detenerse
y conservar logs sanitizados; no reintentar el LOAD.

Ante una falla después de `COMMIT`:

1. desactivar los dos principales QA y revocar sesiones;
2. retirar temporalmente `EXECUTE` de los dos RPCs solo si Seguridad autoriza la
   contención;
3. comparar el backup capturado por `02_BACKUP_DEV.sql`;
4. preparar una migration forward-only nueva que restaure las definiciones
   anteriores o corrija el defecto;
5. validar grants, `SECURITY DEFINER`, `search_path`, índice y append-only;
6. nunca borrar el helper o reponer funciones mediante fragmentos manuales.

No modificar Migration 029, FKs, eventos, `triaged_by` ni `actor_profile_id`.
