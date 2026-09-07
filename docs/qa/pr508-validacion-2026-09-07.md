# PR #508 — recuperación y verificación de contratos

Fecha: 7 de septiembre de 2026. Sustituye el estado provisional del 2 de septiembre.

La suite fallaba al importar SQL eliminado por la consolidación del baseline. Eso impedía incluso registrar cientos de casos del mismo archivo. La decisión aplicada es conservar los contratos de comportamiento y verificar los objetos SQL vigentes en DEV; retirar las comprobaciones del texto de reparaciones históricas ya ejecutadas.

## Alcance

- Sin cambios de producto, migraciones o configuración de negocio respecto de DEV `24037a62ab0643a05f4e5a48be655fb0a3bf356d`.
- Se conserva el trabajo original de Carlos: dependencias raíz, baseline único y versiones únicas, rutas React, allowlist de poder y guard del dispatcher. El conflicto con DEV conserva ambas comprobaciones de la allowlist.
- Se retiran lecturas de archivos inexistentes y helpers que quedaron sin consumidores. No se sustituye una migración eliminada por una copia congelada del baseline.
- La prueba de errores de Edge de nómina ejecuta las tres funciones reales del adaptador con respuestas simuladas: código `PAYROLL_*` seguro, respuesta no JSON y código no permitido. Una llamada adicional ya no rompe un contador textual de dos llamadas.
- DEV incorporó #564/#565 durante la revisión. Se actualiza el contrato de captura al flujo aprobado en #565: registro y revisión de montos, seguido de confirmación explícita de Finanzas mediante RPC, con los guards de draft y revisión TOKA. Ya no se exige envío automático a un aprobador al registrar.

## Decisión sobre las familias huérfanas

| Familia original | Cobertura que se conserva o traslada | Comprobación histórica retirada |
|---|---|---|
| Intake: fingerprint y matching | Modelos y cliente sin conexión; funciones reales, privilegios, idempotencia, normalización, máscaras, locks e índice único en `database/` | Hashes y equivalencia byte a byte de LOAD/030/031 aplicados |
| Conciliación 032/033 y paid-layout | Cliente, parser, importación y modelos; candidatos, importe/moneda, autorización, evidencia 1:1, unicidad, vínculo, auditoría y outbox contra DEV | Inventarios exactos de firmas y envolturas de antiguas migraciones |
| Layout operativo 033/034/035 y conceptos | Cliente; materialidad económica, concepto operativo, banco de empresa, RPC bancario, auditoría sin valores bancarios y pool de directores contra DEV | Texto del antiguo DDL y sus hashes |
| Extraordinarios 036/037/039/040 | Modelos y UI; RLS, grants, constraints, storage privado, facultad explícita, Director, ratificación, locks, consumo de exactamente una línea y trigger de invalidación contra DEV | Conteos de clasificación de una ejecución concreta, inventarios y hashes de scripts aplicados |
| Cierre mixto 038 | Función actual: solo items aprobados, liberados y no removidos, con helper canónico por item | Reparación puntual y texto del archivo 038 |
| Permisos P3 | Cliente y 0 reglas financieras activas globales en DEV | Forma textual de la migración histórica 044 |
| Receipt-linked | Dispatcher ejecutado con red simulada, render, escape, destinatario autorizado y adjuntos; resolver service-only, deduplicación, claim concurrente, wake-up y cron reales | Workflow/runbook retirado y bloque de aplicación original |
| Reparaciones SOL-0006 / SOL-0008 / SOL-0009 | Cliente y reglas actuales de materialidad, layout y conciliación | Identidades y precondiciones de esas reparaciones ya aplicadas |
| Conversión intake | Pruebas existentes de conversión; baseline primero, único y sin versiones repetidas | Lista cerrada de cinco archivos posteriores a 044 |

No se restaura una política obsoleta para satisfacer una prueba: la evidencia extraordinaria actual es opcional, pero debe estar completa si se proporciona; los layouts pagados pueden conciliarse si satisfacen el contrato vigente. Los modelos siguen siendo modelos; las aserciones del catálogo comprueban definiciones, privilegios y objetos desplegados, no sustituyen una prueba transaccional de concurrencia/RLS con usuarios reales.

## Ejecución reproducible y CI

```sh
npm run qa:setup
npm --prefix app run build
node scripts/build-vercel-static.mjs
VERIFY_VERCEL_ARTIFACT=1 npm test
npm run test:db
```

`test:db` requiere `SUPABASE_ACCESS_TOKEN` para capturar el catálogo de DEV mediante Management API. Alternativamente acepta `FLUX_QA_CATALOG` con una exportación de `scripts/qa/database-catalog-readonly.sql` de menos de 30 minutos. La ausencia de credenciales, captura inválida/vencida o consulta fallida causa error; no omite pruebas para producir verde.

La consulta fija DEV `scsirgbuqjcwoaxfacth`, usa una transacción `READ ONLY` y `read_only: true` en la API. Lee metadatos, flags de buckets, un conteo de reglas y configuración del cron; las únicas sondas SQL ejecutan el helper puro de fingerprint con valores ficticios. No llama RPCs de pagos ni envía correos. La captura temporal se elimina y el token no se hereda al proceso de pruebas. El catálogo completo no se publica como artifact ni se imprime.

`.github/workflows/contract-suite.yml` instala con los lockfiles, construye el artifact estático y ejecuta toda la suite local en cada PR a DEV y push a DEV. El segundo job comprueba la base desplegada después del merge y por ejecución manual sobre DEV, usando el secret del entorno DEV. Los PR no reciben ese token. No hay ejecución sobre PROD ni deploy de Edge Functions.

## Evidencia local

| Verificación | Resultado |
|---|---|
| Punto de partida tras incorporar DEV inicial | 602 tests registrados: 581 pasan, 20 fallan, 1 omitido |
| Suite sin conexión, incluido artifact construido | 1064 pasan, 0 fallan, 0 omitidas |
| Catálogo DEV, captura 2026-09-07 22:53 UTC | 108 pasan, 0 fallan, 0 omitidas |
| TypeScript y Vite | Build correcto; recertificación final sobre el DEV indicado arriba |
| Publicación CI | Resultados y commit exacto en la PR; este documento no anticipa el estado de GitHub |

El aumento de pruebas registradas se debe principalmente a que los archivos vuelven a cargar: antes, un error de lectura al inicio impedía registrar todos sus casos. Los resultados locales del catálogo se obtuvieron con la consulta real por Supabase MCP y `FLUX_QA_CATALOG`; el camino HTTP con secret se verifica en CI después del merge.

## Dispatcher DEV recertificado

DEV devuelve la versión 83 del dispatcher. Los cuatro archivos de código devueltos por `get_edge_function` son idénticos a DEV en el repositorio. El metadata declara import map y JWT desactivado; `deno.json` conserva las tres dependencias locales/versionadas esperadas. El API no devuelve el contenido de `deno.json`, por lo que su hash certifica el archivo revisado del repositorio, no una lectura de ese quinto archivo desplegado.

| Archivo | Git blob SHA-1 certificado |
|---|---|
| `deno.json` | `95feb9ee585c58270f6f7149161261be68c5234c` |
| `index.ts` | `410ba33a81a8b69d3e3929f16dc55ed5d99c4804` |
| `jspdf_edge.ts` | `e72e0524be72d89866c834c7892e1b3f5d5e7b5a` |
| `pdf_logo.ts` | `c02b257afcaf7bc81db1346c769175388f33566b` |
| `pdf_logo_embed.ts` | `8b2a5fcfb08ef13147d5de7c62b865ea5ce61f62` |

Se revisó el avance desde `414b318f`: autorización rápida de excepciones, firma HMAC, límites de vigencia, enlace fijo de DEV, feature flag y fallback al correo normal. `verify-dispatcher-bundle.mjs` verifica los cinco archivos exactos, su contenido y que no sean enlaces simbólicos. Las pruebas negativas rechazan archivo adicional, archivo faltante y contenido distinto. Se conservan los guards de rama DEV, commit seleccionado, proyecto, JWT, CLI y único comando de despliegue. No se ejecutó ese workflow ni se desplegó el dispatcher durante esta recuperación.

## Pendiente separado: reproducibilidad de migraciones

El Supabase Preview de DEV ya fallaba por versiones históricas remotas sin archivo local. Esta PR no cambia ni repara el ledger.

Como diagnóstico adicional, una reconstrucción aislada con PGlite 0.5.8 aplicó el baseline y 043–046, y se detuvo en `20260812210013_047_fix_dev_layout_candidate_recursion.sql` con `047_precheck: public layout contract drifted`. El guard compara el hash de `pg_get_functiondef`; no se ha determinado si la diferencia procede del runtime aislado o de la cadena. No demuestra un fallo nuevo en DEV/PROD. Se conservó el guard y se detuvo el replay; la reconciliación completa sigue siendo una tarea independiente.
