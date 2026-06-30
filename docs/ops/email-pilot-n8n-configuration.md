# EMAIL PILOT n8n DEV configuration

Esta automatizacion configura el workflow n8n `Flux DEV - Notification Dispatcher EMAIL PILOT` usando GitHub Environment Secrets del environment `dev`.

Sirve para reemplazar los placeholders del nodo `Set Config` sin entrar nodo por nodo a la UI de n8n. No ejecuta el workflow, no manda correos y no toca Supabase.

## Que hace

- Lee el workflow desde n8n por API.
- Verifica que el nombre sea `Flux DEV - Notification Dispatcher EMAIL PILOT`.
- Actualiza el nodo `Set Config` con valores leidos desde GitHub Environment Secrets `dev`.
- Mantiene `EMAIL_PILOT_MODE=true`.
- Mantiene `SEND_TO_TEST_EMAIL_ONLY=true`.
- Mantiene `SEND_TO_REAL_RECIPIENT=false`.
- Mantiene `MAX_EVENTS_PER_RUN=1`.
- Puede dejar `Email Send Pilot` deshabilitado o habilitarlo solo en modo TEST_ONLY.
- Llama `deactivate` despues del update.
- Verifica por API que el workflow quede `active=false`.

## Que no hace

- No ejecuta el workflow n8n.
- No manda correos.
- No activa el workflow.
- No configura destinatarios reales.
- No toca Supabase.
- No toca produccion.

## Secrets requeridos en GitHub Environment `dev`

Configurar estos valores como Environment Secrets, nunca en archivos ni prompts:

```text
N8N_DEV_API_URL
N8N_DEV_API_KEY
FLUX_DEV_SUPABASE_URL
FLUX_DEV_SUPABASE_ANON_KEY
FLUX_DEV_DISPATCHER_EMAIL
FLUX_DEV_DISPATCHER_PASSWORD
FLUX_DEV_EMAIL_FROM
FLUX_DEV_TEST_RECIPIENT_EMAIL
```

Secrets opcionales:

```text
FLUX_DEV_MIN_CREATED_AT
N8N_DEV_EMAIL_CREDENTIAL_ID
N8N_DEV_EMAIL_CREDENTIAL_TYPE
```

Si `N8N_DEV_EMAIL_CREDENTIAL_ID` y `N8N_DEV_EMAIL_CREDENTIAL_TYPE` no existen, el Action no falla. En ese caso la credencial SMTP/Gmail debe configurarse manualmente en n8n antes de habilitar y probar envio.

## Ejecucion segura inicial

Usar primero con el nodo de email deshabilitado:

```text
Action: Configure n8n EMAIL PILOT DEV Manual
Branch: dev
workflow_id: 0QOhk8Eq4QvYAaRG
confirm_dev: n8n-dev
confirm_test_only: TEST_ONLY
enable_email_node: false
```

Resultado esperado:

```json
{
  "ok": true,
  "workflow_id": "0QOhk8Eq4QvYAaRG",
  "workflow_name": "Flux DEV - Notification Dispatcher EMAIL PILOT",
  "set_config_updated": true,
  "email_node_enabled": false,
  "email_node_credentials_attached": false,
  "send_to_test_email_only": true,
  "send_to_real_recipient": false,
  "active": false
}
```

## Habilitar nodo de email en modo TEST_ONLY

Cuando la credencial SMTP/Gmail ya exista en n8n y los secrets opcionales esten configurados, se puede correr:

```text
Action: Configure n8n EMAIL PILOT DEV Manual
Branch: dev
workflow_id: 0QOhk8Eq4QvYAaRG
confirm_dev: n8n-dev
confirm_test_only: TEST_ONLY
enable_email_node: true
```

Esto habilita solo el nodo `Email Send Pilot`, conserva destinatario real desactivado y vuelve a dejar el workflow completo inactive.

## Guardrails

- No correr desde `main`.
- No usar URL de n8n productiva.
- No usar Supabase productivo.
- No mandar a usuarios reales.
- No cambiar `SEND_TO_REAL_RECIPIENT=false`.
- No activar workflow automatico.
- No pegar secrets en issues, PRs, prompts o archivos.

## Evidencia

El Action sube un artifact con summary seguro:

```text
n8n-email-pilot-dev-configuration-evidence
```

El summary no incluye secretos ni el contenido del nodo `Set Config`.
