# Fecha del comprobante de nómina

## Solicitud y comportamiento

Ramón solicitó aceptar fechas de pago iguales o posteriores a la creación de la solicitud, sin tope relativo al día actual, y mostrar el motivo de rechazo. Se usa `payment_requests.created_at` convertido a `America/Mexico_City`, no el inicio del periodo de nómina ni la fecha de confirmación.

- La función privada de conciliación sustituye exclusivamente el límite `current_date + 1` por el mínimo de creación. Fechas nulas o no finitas siguen siendo inválidas.
- El resumen de conciliación expone `request_created_date` para que el formulario muestre la fecha mínima y valide antes de reservar/subir un archivo.
- El error del servidor incluye la fecha mínima en `DETAIL`. La UI muestra un mensaje en español junto al comprobante y en el aviso emergente. Conserva archivo y campos para corregirlos.
- Se preservan importe exacto, referencia, formato/integridad PDF, moneda, estados, permisos por empresa e idempotencia. No se añade reconocimiento bancario ni OCR.
- La migración no modifica filas de negocio, archivos guardados, roles, ACLs, RLS, notificaciones ni cierres existentes.

## Validación local

`npm run test:payroll`: **31 pruebas pasan, 0 fallas, 0 omitidas**.

El flujo SQL completo usa PGlite, esquema/funciones de la liberación y personas/archivos sintéticos. Instala la migración dos veces y conserva las ACLs. Para BBVA, SPEI y TOKA comprueba rechazo del día anterior, nulo e infinito; aceptación del mismo día, día posterior, 2099 y 2100; idempotencia; monto y referencia; permisos; cierre y eventos sin envío real. La creación a las 03:00 UTC se reconoce como el día anterior en CDMX incluso con la sesión SQL en Asia/Tokyo.

Las pruebas React verifican que no se reserva un archivo con fecha anterior, que no existe máximo en el selector y que el motivo del servidor permanece visible con su fecha exacta. Se preservan los datos editables.

`npm --prefix app run build`: TypeScript y Vite correctos. `git diff --check`: correcto.

## Situación de liberación

**Preparado; no aplicado ni desplegado.** Base de preparación `main` cf0f61e66888819207f4e30ee4d4d08d3bd20aab.

La consulta de PROD (`ucantptjhwttexzmslvm`) confirma la regla antigua, 125 versiones registradas y ausencia de la versión preparada `20260909175755`. Ambas funciones vigentes contienen exactamente las anclas que espera el parche. El SQL aborta en transacción ante una fuente distinta.

Migración generada con Supabase CLI: `20260909175755_payroll_receipt_date_from_request_creation.sql`. SHA-256: `8269b3e3eabd95d9a7d6ecf23f63af5b24c8110c0a7aaec7a39515084a371ae0`.

El dry-run estándar con `--skip-vault --project-ref ucantptjhwttexzmslvm` no pudo iniciar: `LegacyPlatformAuthRequiredError` (CLI sin token). No se ejecutó SQL de escritura remoto. El runbook `docs/ops/supabase-cli-migrations.md` de DEV requiere autorización por ambiente y revisión del dry-run; usar el conector en lugar del CLI requiere una excepción expresa, limitada a este SQL, con respaldo de alcance previo y verificación posterior. No se propone reparación del historial ni un push general.

Para liberar: autorizar el alcance PROD y la vía de aplicación; respaldar las dos definiciones y sus ACLs; revalidar fuente/historial; aplicar sólo este SQL; adoptar en el archivo la versión real que registre el conector si difiere; comprobar preservación de ACLs y del resto del cuerpo; publicar el frontend y verificar el bundle. Integrar después el mismo fix en DEV mediante su entrega específica. Las pruebas locales no sustituyen una UAT autenticada de la pantalla ni ejecutan pagos reales.
