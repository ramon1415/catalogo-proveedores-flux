# Homologación de permisos DEV con PROD

Solicitada por Ramón el 17 de septiembre de 2026. Alcance: únicamente DEV.

Referencia de producción: `main` en `4c8966916d4ac903294f4fa3bdcb5b463185d936` y catálogo de funciones/permisos de Supabase PROD leído el mismo día.

- `UsersPanel.tsx` y su CSS son idénticos a PROD: lista y detalle, rol y aprobadores por empresa. Los módulos adicionales de DEV conservan su ubicación.
- Diez definiciones de funciones y sus permisos de ejecución se homologaron con PROD. Incluye candidatos, opciones, reglas y validación de asignaciones por empresa. El helper permanece privado y los RPC no permiten acceso anónimo.
- Los 12 usuarios existentes en ambos ambientes se identificaron por correo; Operadora y Fersana por RFC. Se homologaron roles globales, 23 membresías y 18 registros de asignaciones de aprobador. Se desactivaron accesos/rutas adicionales de esos usuarios en esas dos empresas, conservando registros e IDs históricos.
- No se crearon usuarios de PROD ausentes en DEV. Los perfiles exclusivos de QA y las empresas de prueba quedaron fuera del alcance.

## Migraciones aplicadas exclusivamente en DEV

1. `20260917040714_dev_permissions_prod_parity.sql`: funciones con las mismas definiciones y ACL de PROD. No reemplaza la validación de Sin partida, que ya coincidía.
2. `20260917041034_dev_user_assignments_prod_parity.sql`: ajuste de datos, con guardas de identidad de DEV, huellas previas, transacción y verificaciones antes de confirmar.

La segunda migración es específica de DEV y **no debe ejecutarse en PROD ni incorporarse a una promoción de esquema de producción**. Rechaza bases que no tengan los IDs de las empresas DEV y estados distintos al preflight. El snapshot de permisos PROD de esta migración sirve como referencia de lo aplicado, no como sincronización continua.

## Verificación

- Compilación de la app y TypeScript correctos.
- 34 pruebas: permisos por empresa, editor, hidratación de sesión, aislamiento/autorización en PGlite, Sin partida y conciliación de comprobantes.
- Comparación posterior de roles globales, accesos activos y aprobadores activos de los 12 usuarios: cero diferencias frente a PROD.
- Comparación posterior de las 13 funciones revisadas y sus ACL: cero diferencias frente a PROD (normalizando únicamente finales de línea).
- Huellas de solicitudes y renglones de reembolso idénticas antes/después; guardas transaccionales confirmaron también que los registros fuera del alcance no cambiaron.
- Advisors de seguridad sin hallazgos nuevos respecto al preflight.

La validación de interfaz se apoya en la igualdad del componente/CSS con PROD y en la compilación; no se usaron sesiones de usuarios ni se simularon identidades contra los ambientes remotos.
