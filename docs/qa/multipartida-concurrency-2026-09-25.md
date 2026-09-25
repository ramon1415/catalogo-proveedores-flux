# Multi-partida: prueba de concurrencia con dos conexiones

## Resultado

Prueba ejecutada el 25 de septiembre de 2026 sobre PostgreSQL **17.6 nativo**, en un cluster local desechable y accesible solo por loopback. Los procesos backend de las conexiones A y B fueron **5807** y **5808**.

Se ejecutó `create_payment_request` completo como `authenticated`, con el helper de `20260925155322`, la vista de disponibilidad y los triggers de snapshot/guard de `20260925130000`. La configuración de obligaciones no concede SELECT a authenticated y budget_lines tiene RLS de solo lectura. La identidad, membresía y selección de aprobadores usan fixtures deterministas; no se copian datos privados de DEV/PROD.

| Escenario | Evidencia durante la espera | Resultado después de liberar A |
| --- | --- | --- |
| A consume 70 de 100 y hace COMMIT; B intenta 40 | `pg_blocking_pids(B)` contiene el PID de A; B sigue pendiente | B relee los 30 restantes y aborta con SQLSTATE **40001**; queda una solicitud, comprometido 70, disponible 30 |
| A consume 70 de 100 y hace ROLLBACK; B intenta 40 | Mismo bloqueo comprobado entre backends independientes | B crea las dos líneas y hace COMMIT; queda una solicitud, comprometido 40, disponible 60 |

Esto acredita bloqueo y lectura posterior al COMMIT para el SQL probado en PostgreSQL nativo. **No es una prueba de dos conexiones al servicio alojado en DEV/PROD**, ni valida su transporte PostgREST, infraestructura o todos los permisos externos al fixture. La prueba previa del RPC completo en DEV real con authenticated y rollback sigue siendo evidencia complementaria.

## Reproducción

```sh
npm run qa:setup
npm install --prefix /tmp/flux-pg-qa --save-exact embedded-postgres@17.6.0-beta.15 pg@8.16.3
FLUX_QA_RUNTIME_PACKAGE=/tmp/flux-pg-qa/package.json node scripts/qa/multipartida-concurrency.mjs
```

El script crea su propio cluster, elige un puerto libre, usa tres conexiones independientes (A, B y observación), comprueba el bloqueo en pg_blocking_pids y elimina el cluster al terminar. No acepta una URL remota ni requiere credenciales de Supabase. El fixture compartido también se ejecuta en las pruebas offline con PGlite.

## Ruta con archivo adjunto en el paquete para main

La migración `20260925160000` transmite el reparto en ambos wrappers; el cliente de este paquete lo envía tanto con archivo como sin él. `multipartida-document-db.test.mjs` comprueba dos líneas + enlace del comprobante, compatibilidad con llamada antigua, rechazo de objetos ajenos y rollback completo cuando falla el enlace. `request-optional-document.test.mjs` prueba la captura React en ambas rutas. La migración `20260925171716` conserva los permisos de ejecución de PROD después de recrear las funciones.

Estas pruebas de solicitudes son locales. El paquete consolidado fue ensayado en PROD con rollback y aplicado como `20260925173828`; los siete SQL originales se conservan como fixtures de regresión. Ver el informe de release para verificaciones y estado del cliente.
