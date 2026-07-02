# Automatizacion segura de despliegues DEV: Supabase y n8n

Este paquete agrega automatizacion manual para operar DEV sin copiar/pegar SQL en Supabase ni importar JSON manualmente en n8n.

Estado de esta entrega: propuesta tecnica y archivos de automatizacion. No ejecuta Actions por si sola.

## Alcance

Incluido:

- Workflow manual para ejecutar SQL controlado contra Supabase DEV.
- Workflow manual para importar workflows JSON a n8n DEV.
- Helpers Node.js sin dependencias externas de npm.
- Evidencia/logs sanitizados como artifacts de GitHub Actions.
- Confirmacion explicita para cada operacion DEV.
- Guards para abortar si se detectan senales de PROD/main.

No incluido:

- Ejecucion automatica por push.
- Ejecucion contra produccion.
- Uso de service role en frontend.
- Commit de credenciales o API keys.
- Activacion automatica de schedules o envio automatico de emails en n8n.

## Archivos agregados

~~~text
.github/workflows/deploy-supabase-dev-manual.yml
.github/workflows/import-n8n-dev-workflow-manual.yml
scripts/supabase/run_sql_file.js
scripts/n8n/import_workflow.js
scripts/n8n/update_workflow.js
docs/ops/dev-deployment-automation.md
~~~

## Diseno general

Los workflows usan workflow_dispatch, por lo que solo corren manualmente desde la pestana Actions de GitHub.

Nota operativa de GitHub Actions:

Este documento y estos workflows pueden existir en main unicamente para que GitHub Actions los registre y los muestre en la UI, porque main es la rama default del repositorio.

Aunque los archivos esten presentes en main, los jobs estan protegidos para abortar si se intentan ejecutar sobre main.

Para usarlos correctamente, se debe abrir GitHub Actions, elegir el workflow manual y seleccionar la rama dev en el dropdown antes de ejecutar.

No ejecutar estos workflows sobre main.
No configurar secrets productivos.
No ejecutar contra produccion.


Cada workflow exige un input de confirmacion:

- Supabase DEV: confirm_dev = scsirgbuqjcwoaxfacth
- n8n DEV: confirm_dev = n8n-dev

Si la confirmacion no coincide exactamente, el job aborta antes de tocar cualquier destino externo.

Los secrets se leen solamente desde GitHub Actions Secrets. No se deben escribir en prompts, archivos, JSON, frontend ni commits.

## Secrets requeridos

Configurar en GitHub repository secrets o en un environment dev, sin exponer valores en el repo.

| Secret | Uso | Requerido |
|---|---|---|
| SUPABASE_DEV_DB_URL | Connection string PostgreSQL de Supabase DEV para psql. | Si, para Supabase DEV |
| SUPABASE_DEV_PROJECT_REF | Project ref esperado de DEV. Debe ser scsirgbuqjcwoaxfacth. | Si, para Supabase DEV |
| SUPABASE_DEV_ACCESS_TOKEN | Reservado para futuras llamadas de Supabase CLI/API. No lo usan los helpers actuales. | No actualmente |
| N8N_DEV_API_URL | URL base de la API de n8n DEV. Puede ser root o /api/v1. | Si, para n8n DEV |
| N8N_DEV_API_KEY | API key de n8n DEV. | Si, para n8n DEV |

Nunca configurar ni usar SUPABASE_SERVICE_ROLE_KEY en frontend.

## Despliegue Supabase DEV

Workflow:

~~~text
.github/workflows/deploy-supabase-dev-manual.yml
~~~

Input manual:

| Input | Ejemplo | Nota |
|---|---|---|
| script_path | supabase/dev/tanda_XX_nombre | Carpeta o archivo SQL dentro del repo. |
| confirm_dev | scsirgbuqjcwoaxfacth | Obligatorio y exacto. |

Estructura recomendada para SQL controlado:

~~~text
supabase/dev/tanda_XX_nombre/precheck.sql
supabase/dev/tanda_XX_nombre/load.sql
supabase/dev/tanda_XX_nombre/postcheck.sql
~~~

El helper ejecuta siempre las tres fases, en este orden:

1. precheck.sql
2. load.sql
3. postcheck.sql

Si script_path apunta directamente a un archivo SQL, ese archivo se toma como load, pero de todas formas deben existir precheck.sql y postcheck.sql en la misma carpeta.

### Guardrails Supabase

El workflow y el helper abortan cuando:

- confirm_dev no es scsirgbuqjcwoaxfacth.
- SUPABASE_DEV_PROJECT_REF no es scsirgbuqjcwoaxfacth.
- El workflow se intenta correr desde main.
- script_path intenta salir del repo, es una URL o no apunta a .sql valido.
- El host, database/user/path o variables de ambiente contienen senales como prod, production o main.
- Falta psql o falla cualquier fase SQL.

### Evidencia Supabase

El workflow sube un artifact:

~~~text
supabase-dev-deployment-evidence
~~~

Contenido esperado:

~~~text
.ops-evidence/supabase-dev/*.log
.ops-evidence/supabase-dev/summary-*.json
~~~

Los logs pasan por redaccion basica de connection strings, tokens, passwords y API keys. Aun asi, los SQL de precheck.sql y postcheck.sql deben imprimir solamente evidencia segura.

## Importacion n8n DEV

Workflow:

~~~text
.github/workflows/import-n8n-dev-workflow-manual.yml
~~~

Input manual:

| Input | Ejemplo | Nota |
|---|---|---|
| workflow_json_path | n8n/workflows/dev/flujo_demo.json | JSON versionado en repo. |
| confirm_dev | n8n-dev | Obligatorio y exacto. |

El helper:

- Lee el JSON desde el repo.
- Rechaza valores con apariencia de secrets.
- No envia active en el payload de POST /workflows porque algunas versiones de n8n lo tratan como campo read-only.
- Deshabilita nodos tipo schedule/cron/interval.
- Deshabilita nodos de envio email conocidos cuando detecta operacion de envio.
- Importa por API publica de n8n usando X-N8N-API-KEY.
- Llama a deactivate despues de crear el workflow.
- Verifica por API que el workflow quede inactivo.

Nota sobre active en n8n: algunas versiones de la API tratan active como campo read-only en POST /workflows. Por eso el importador no envia active en la creacion. La seguridad se garantiza llamando deactivate inmediatamente despues de crear el workflow y verificando despues por API que active sea false. Si la respuesta de verificacion no incluye el campo active, el helper falla con un mensaje claro.

### Guardrails n8n

El workflow y el helper abortan cuando:

- confirm_dev no es n8n-dev.
- El workflow se intenta correr desde main.
- Falta N8N_DEV_API_URL o N8N_DEV_API_KEY.
- workflow_json_path intenta salir del repo, es una URL o no apunta a .json valido.
- N8N_DEV_API_URL contiene senales como prod, production o main.
- El JSON contiene campos con apariencia de secrets, tokens, passwords, private keys o service role.
- n8n no devuelve ID de workflow.
- El workflow queda activo despues de la importacion/desactivacion.

### Evidencia n8n

El workflow sube un artifact:

~~~text
n8n-dev-import-evidence
~~~

Contenido esperado:

~~~text
.ops-evidence/n8n-dev/summary-*.json
~~~

## Actualizacion n8n DEV existente

El archivo scripts/n8n/update_workflow.js queda disponible para una fase posterior. No esta conectado al workflow inicial porque la primera necesidad es importar JSON a DEV.

Uso manual futuro dentro de Actions o una shell controlada:

~~~bash
CONFIRM_DEV=n8n-dev \
N8N_DEV_API_URL="$N8N_DEV_API_URL" \
N8N_DEV_API_KEY="$N8N_DEV_API_KEY" \
node scripts/n8n/update_workflow.js \
  --workflow-id "WORKFLOW_ID_DEV" \
  --workflow-json-path "n8n/workflows/dev/flujo_demo.json"
~~~

El actualizador tampoco envia active en el payload de update, llama a deactivate y verifica que el workflow quede inactivo. Si la respuesta de verificacion no incluye active, falla con un mensaje claro.

## Checklist de prueba DEV

Antes de correr por primera vez:

- Confirmar que los workflows existen en main solo para registro en GitHub Actions UI.
- Confirmar que, al ejecutar manualmente, se seleccione la rama dev.
- Confirmar que si se intenta ejecutar sobre main, el workflow aborta por guardrail.
- Confirmar que los secrets configurados sean DEV, no productivos.
- Confirmar que los workflows existen en la rama seleccionada desde Actions.
- Confirmar que GitHub Secrets estan cargados solo en GitHub, no en archivos.
- Confirmar que SUPABASE_DEV_PROJECT_REF es scsirgbuqjcwoaxfacth.
- Confirmar que SUPABASE_DEV_DB_URL apunta a DEV.
- Confirmar que N8N_DEV_API_URL apunta a n8n DEV.
- Revisar que ningun JSON de n8n contenga credenciales embebidas.
- Revisar que ningun SQL imprima datos sensibles en precheck.sql o postcheck.sql.

Prueba Supabase DEV:

1. Ir a GitHub Actions.
2. Abrir Deploy Supabase DEV Manual.
3. Seleccionar la rama dev o una rama de prueba que contenga el workflow.
4. Capturar script_path con una carpeta que tenga precheck.sql, load.sql, postcheck.sql.
5. Capturar confirm_dev = scsirgbuqjcwoaxfacth.
6. Ejecutar manualmente.
7. Revisar que el job muestre resumen seguro.
8. Descargar artifact supabase-dev-deployment-evidence.
9. Confirmar que no hay secrets impresos.

Prueba n8n DEV:

1. Ir a GitHub Actions.
2. Abrir Import n8n DEV Workflow Manual.
3. Seleccionar la rama dev o una rama de prueba que contenga el workflow.
4. Capturar workflow_json_path con un JSON sin secrets.
5. Capturar confirm_dev = n8n-dev.
6. Ejecutar manualmente.
7. Confirmar que el workflow importado queda inactive en n8n DEV.
8. Confirmar que ningun schedule queda activo.
9. Confirmar que no se envio ningun email automatico.
10. Descargar artifact n8n-dev-import-evidence.

## Smoke test inicial

Estos smoke tests sirven para validar conectividad DEV antes de ejecutar cargas reales o importar workflows productivos. No modifican datos y no activan automatizaciones.

### Supabase DEV smoke

Archivos incluidos:

~~~text
ops/smoke/supabase-dev-connection/precheck.sql
ops/smoke/supabase-dev-connection/load.sql
ops/smoke/supabase-dev-connection/postcheck.sql
~~~

Los tres archivos usan solamente SELECT. Validan:

- current_database().
- now().
- current_schema().
- existencia de la tabla publica esperada profiles.

Para ejecutarlo, primero configurar estos GitHub Secrets en el repo o environment dev:

- SUPABASE_DEV_DB_URL
- SUPABASE_DEV_PROJECT_REF

Luego ejecutar manualmente el workflow Deploy Supabase DEV Manual con:

| Input | Valor |
|---|---|
| script_path | ops/smoke/supabase-dev-connection |
| confirm_dev | scsirgbuqjcwoaxfacth |

Resultado esperado:

- El job acepta la confirmacion DEV.
- Ejecuta precheck.sql, load.sql y postcheck.sql.
- No hace cambios de datos ni esquema.
- El artifact supabase-dev-deployment-evidence contiene summary JSON y log sanitizado.
- La salida muestra current_database, now y si public.profiles existe.

### n8n DEV smoke

Archivo incluido:

~~~text
ops/smoke/n8n-dev-import/smoke_manual_noop_workflow.json
~~~

El workflow JSON contiene:

- Manual Trigger.
- Code node local que devuelve ok=true y smoke=n8n-dev-import.
- active=false.
- Sin schedule.
- Sin email.
- Sin credenciales.
- Sin llamadas externas.

Para ejecutarlo, primero configurar estos GitHub Secrets en el repo o environment dev:

- N8N_DEV_API_URL
- N8N_DEV_API_KEY

Luego ejecutar manualmente el workflow Import n8n DEV Workflow Manual con:

| Input | Valor |
|---|---|
| workflow_json_path | ops/smoke/n8n-dev-import/smoke_manual_noop_workflow.json |
| confirm_dev | n8n-dev |

Resultado esperado:

- El job acepta la confirmacion DEV.
- Importa el workflow en n8n DEV.
- El workflow queda inactive.
- El helper llama deactivate despues de importar.
- No se ejecuta el workflow.
- No se activa ningun schedule.
- No se envia ningun email.
- El artifact n8n-dev-import-evidence contiene summary JSON sanitizado.

## Politicas de seguridad

- No usar service_role en frontend.
- No commitear secrets.
- No hardcodear credenciales.
- No poner API keys en JSON de n8n.
- No ejecutar workflows desde main.
- No tocar produccion.
- No habilitar schedules ni emails automaticos en importacion n8n DEV.
- Usar Actions manuales con confirmacion explicita.
- Revisar artifacts despues de cada ejecucion DEV.

## Referencias oficiales

- GitHub Actions manual workflows: https://docs.github.com/actions/using-workflows/manually-running-a-workflow
- GitHub Actions secrets: https://docs.github.com/actions/security-guides/using-secrets-in-github-actions
- n8n public API authentication: https://docs.n8n.io/api/authentication/
- n8n workflow API reference: https://docs.n8n.io/api/api-reference/
