# Rollback controlado — release Fersana

Este paquete no usa un rollback destructivo automático. Todas las migraciones y
los dos seeds se ejecutan en transacciones explícitas: si falla un guard o
postcheck interno, PostgreSQL revierte ese archivo completo.

## Antes del merge del PR #467

Si falla cualquier paso:

1. detener el runbook;
2. conservar el error y la versión exacta del archivo;
3. no reintentar ni borrar objetos manualmente;
4. confirmar qué transacciones quedaron registradas en el historial remoto;
5. corregir en una rama nueva y volver a ejecutar el preflight.

Mientras `/app` no se haya publicado, las tablas nuevas no tienen tráfico real.
La opción preferida es una migración compensatoria revisada, no `DROP ... CASCADE`.

## Después del seed

No se permite retirar Fersana si existe cualquiera de estos datos:

- membresías o solicitudes de acceso;
- directores o asignaciones de aprobación;
- solicitudes de pago, layouts, fondos o comprobantes;
- ingresos recurrentes o sueltos;
- eventos de notificación;
- actividad real asociada al RFC `SFE100825TM9`.

Si todos los conteos son cero y Ramón autoriza expresamente el retiro, preparar
una migración compensatoria específica que elimine, en orden, responsables,
líneas presupuestales, relaciones de partidas, liga de acceso, módulos, cuenta
bancaria, centro de costo y empresa. Nunca reutilizar el script del ensayo
`ZZ Aislamiento` ni eliminar perfiles automáticamente.

## Después del merge

El rollback del frontend es revertir exclusivamente el merge del PR #467 en
`main`; el vanilla raíz permanece disponible. No retirar el esquema ni los datos
de Fersana durante el mismo incidente: frontend y base de datos se recuperan en
operaciones separadas, cada una con autorización explícita.

