# Paso 2 · Matriz Edge Functions DEV → PROD

Inventario vivo leído el **1-sep-2026**. No contiene valores de secretos.

## Decisión de despliegue

| Función | DEV | PROD | `verify_jwt` PROD | Decisión para Fersana |
|---|---|---|---:|---|
| `notification-dispatcher` | v50 · `8a0d1e7b69d847a6e8ab2a46d210e365c140a7b9b890b19b610de8299df1bd9b` | v12 · `4221d1a2226096ceff446920f2b44816289ce48efc1afe92bdf71d6b8af7a02e` | `false` | **Conservar PROD v12.** Soporta los mismos 13 tipos de evento. DEV agrega allowlists y reintentos `test_only` que no pertenecen a PROD. |
| `provider-intake` | v37 · `f0cb47ab7a516bc7d6dea0d165b325a2e7efd650760eb10e88321ca87a9f9ac0` | v1 · `00b5116b6ac0f64a01ce8671d66caf1321f39d27c5d934967866a4980ed7fc61` | `false` | **Conservar PROD v1.** Es la variante productiva fijada a `https://flux.quantta.mx`; el tenant lo determina el enlace y la base de datos. |
| `approval-batch-submitted-dispatcher` | v8 · `4a8028226ab4fd2d9933804c47ad0378f54c2ca42852bbe779c57a5c66cef271` | v3 · `02647da46dc4138f7b9b180f676c3c0eae01efac6b5ea788ebf66409a4f7d167` | `false` | **Conservar PROD v3.** Genera PDF, correo al Director y liga Quick Approval con origen productivo. |
| `approval-batch-quick-approve` | v3 · `c12c3a6e99a8426e89de8b4edfb16606c73bac95358211f5a54391f6b95c721c` | v1 · `acef4653bb189290caaf7e8af753109406af48247b83c53788e7ade686a4c9f3` | `false` | **Conservar PROD v1.** CORS acepta únicamente `https://flux.quantta.mx`; desplegar DEV rompería el origen. |
| `payroll-materialize` | v13 | No existe | — | Fuera de alcance. Nómina permanece apagada. |
| `payroll-receipt-verify` | v3 | No existe | — | Fuera de alcance. Nómina permanece apagada. |

Conclusión: **cero Edge Functions por desplegar** para habilitar Fersana. Los números de versión no son comparables entre proyectos; el gate se decide por contrato, origen y hash vivo.

## Variables requeridas por las funciones productivas

| Función | Variables/secretos Edge obligatorios |
|---|---|
| `notification-dispatcher` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `NOTIFICATION_DISPATCHER_SECRET`, `NOTIFICATION_SEND_MODE=real`, `NOTIFICATION_FROM_EMAIL` |
| `approval-batch-submitted-dispatcher` | Las anteriores + `APPROVAL_BATCH_SUBMITTED_DELIVERY_MODE=director`; para liga rápida: `APPROVAL_BATCH_QUICK_APPROVE_ENABLED`, `APPROVAL_BATCH_QUICK_APPROVE_SECRET`, `APPROVAL_BATCH_QUICK_APPROVE_TTL_HOURS` |
| `approval-batch-quick-approve` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APPROVAL_BATCH_QUICK_APPROVE_SECRET` o configuración equivalente en Vault/RPC |
| `provider-intake` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Turnstile, hash pepper y contrato productivo de orígenes/privacidad |

No registrar valores en Git, evidencias, comentarios del PR ni salida de consola.

## Hallazgo operativo y gate de recuperación

PROD tiene triggers inmediatos para solicitud nueva, corte enviado, decisión del corte y comprobante vinculado. Falta el trigger inmediato de `payment_request.approved` y no existe `pg_cron`; por ello un error temporal puede dejar correos en `pending` sin recuperación.

Inventario Vault por nombre (sin leer valores):

| Estado antes del corte | Nombres |
|---|---|
| Ya existen en PROD | `notification_dispatcher_secret`, URLs/cutoffs/flags inmediatos de `payment_request.created`, `approval_batch.submitted`, decisión de corte y comprobante vinculado; también existe `notification_approval_batch_submitted_recovery_enabled`. |
| Crear inicialmente en `false` | `notification_payment_request_created_recovery_enabled`, `notification_approval_batch_decision_recovery_enabled`, `notification_payment_outcome_immediate_enabled`, `notification_payment_outcome_recovery_enabled`. |
| Crear con destino PROD y cutoff nuevo | `notification_payment_outcome_dispatcher_url=https://ucantptjhwttexzmslvm.supabase.co/functions/v1/notification-dispatcher` y `notification_payment_outcome_cutoff_at=<CUTOVER_UTC>`. |

Antes de habilitar recovery también se deben mover al mismo `<CUTOVER_UTC>` los cutoffs existentes de solicitud nueva, corte enviado y decisión de corte. El valor debe ser igual o anterior al instante de activación y nunca más de cinco minutos futuro.

El script `paso2b-notification-recovery-prod.sql` resuelve únicamente esa orquestación. Antes de activar:

1. Fijar todos los cutoffs al instante UTC del corte, nunca a una fecha histórica.
2. Crear los flags y la configuración de outcome indicados arriba, todos los flags con valor inicial `false`.
3. Aplicar el SQL y verificar que no reclama ningún evento.
4. Cambiar a `true` sólo los cuatro flags de recovery y `notification_payment_outcome_immediate_enabled`.
5. Crear una solicitud UAT posterior al cutoff y verificar los cuatro correos con sus destinatarios reales.

Los locks de claim, el estado del evento y la idempotencia de Resend siguen siendo la defensa contra duplicados.
