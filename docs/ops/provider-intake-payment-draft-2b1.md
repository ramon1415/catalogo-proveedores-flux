# Fase 2B.1 — preparación de solicitud de pago desde intake

## Objetivo y límite

Fase 2B.1 permite que Finanzas prepare y guarde información interna desde un
`payment_intake` en `in_review`, aun sin proveedor maestro vinculado. El
resultado es un borrador persistente, no una solicitud de pago.

Esta fase no:

- inserta en `public.payment_requests`;
- actualiza `payment_intake.created_payment_request_id`;
- cambia el intake a `converted`;
- crea o modifica proveedores;
- inicia aprobación, batches, layouts, notificaciones o pagos;
- copia documentos o datos bancarios declarados.

## Flujo

```text
Intake in_review
→ preparar borrador
→ guardar información interna
→ borrador incompleto o completo
→ pendiente de proveedor
→ proveedor vinculado
→ listo para conversión
→ Fase 2B.2
```

## Arquitectura

Migration 041 agrega:

- `public.payment_intake_conversion_drafts`;
- `provider_intake_conversion_draft_fingerprint(jsonb)`, helper interno;
- `provider_intake_payment_draft_state(uuid)`, helper interno;
- `get_provider_intake_payment_draft_context(uuid)`, RPC read-only;
- `save_provider_intake_payment_draft(...)`, RPC de guardado parcial;
- eventos append-only `conversion_draft_created` y
  `conversion_draft_updated`.

El frontend consume solo los dos RPC públicos. La tabla no se expone por REST.

## Modelo

Existe exactamente un borrador por `payment_intake_id`. `company_id` se deriva
en el servidor y no es argumento del RPC. El borrador usa los contratos
canónicos:

- `cost_center_id`;
- `budget_category_id`;
- `budget_month`;
- `company_bank_account_id` como cuenta origen;
- `payment_method`: `transfer`, `cash`, `check`, `other`;
- `requested_by_profile_id`;
- `approver_profile_id`;
- `approver_assignment_id`;
- `final_amount`, `currency`, `scheduled_payment_date`;
- `internal_concept`, `internal_notes`, `amount_change_reason`;
- actor de creación/actualización, versión y timestamps.

No contiene CLABE, cuenta declarada, token, ruta de Storage ni
`payment_request_id`.

## Estado derivado

El frontend no escribe un estado libre. El servidor calcula:

| Estado | Regla |
|---|---|
| `NOT_STARTED` | No existe borrador. |
| `DRAFT_INCOMPLETE` | Existe y faltan campos internos. |
| `READY_PENDING_PROVIDER` | Está completo, pero falta proveedor activo. |
| `READY_FOR_CONVERSION` | Está completo, el intake sigue en revisión y tiene proveedor activo. |
| `ALREADY_CONVERTED` | Existe `created_payment_request_id` o el intake está convertido. |
| `BLOCKED_INTAKE_STATUS` | El intake no está en revisión. |

Un proveedor vinculado pero inactivo se mantiene en
`READY_PENDING_PROVIDER` con blocker `PROVIDER_INACTIVE`; nunca queda listo.

## Permisos

Los RPCs resuelven al actor mediante `current_profile_id()` y reutilizan
`provider_intake_actor_context()`:

- Finance requiere membresía activa en la empresa;
- Admin y Sysadmin usan la clasificación/helper canónico;
- anon, perfiles inactivos, usuarios sin Finanzas y otras empresas fallan
  cerrados.

La tabla tiene RLS habilitado, cero policies y grants directos revocados para
`PUBLIC`, `anon`, `authenticated` y `service_role`. Solo `authenticated` puede
ejecutar los RPCs públicos `SECURITY DEFINER`, ambos con
`search_path = public, pg_temp`.

## Solicitante y aprobador

El solicitante es el actor interno activo con membresía en la empresa, alineado
con la ruta normal de `create_payment_request`. No hay texto libre ni identidad
del proveedor externo.

Las opciones de aprobador vienen de
`list_payment_request_approver_options(company_id, cost_center_id, amount)`.
Cuando existe pool asignado, se conserva `approver_assignment_id`; sin pool se
validan reglas por empresa, centro y monto. El guardado vuelve a validar perfil,
membresía, rol, pool/regla y separación solicitante/aprobador.

Como el contrato vigente puede evaluar opciones sin una fila de
`payment_requests`, no se requiere el blocker
`APPROVER_RULE_PENDING_CONVERSION`.

## Monto

`final_amount` se precarga desde `payment_intake.amount_requested`. Se acepta
`null` para guardado parcial. Cuando existe:

- debe ser positivo;
- no puede exceder `numeric(18,2)`;
- se rechazan más de dos decimales antes de persistir;
- no se redondea silenciosamente;
- si difiere del monto declarado, `amount_change_reason` es obligatorio.

El evento solo registra `amount_changed`, nunca el monto ni el motivo.

## Idempotencia, concurrencia y evento

El fingerprint contract-v1 cubre actor, intake, material esperado de
concurrencia y todos los campos normalizados del borrador.

- Replay exacto del mismo `action_id`: `idempotent=true`, sin versión, timestamp
  ni evento nuevos.
- Mismo `action_id`, material distinto:
  `provider_intake_conversion_draft_action_material_conflict`.
- Mismo `action_id`, actor distinto:
  `provider_intake_conversion_draft_action_actor_conflict`.
- Versión obsoleta: `provider_intake_conversion_draft_conflict`.
- Guardado con material idéntico y nuevo action ID: `unchanged=true`, sin
  versión ni evento nuevos.

Cada creación/actualización material incrementa o inicia `version` y agrega
exactamente un evento al ledger inmutable. La metadata usa una allowlist:
versión de contrato, action ID/fingerprint, versión, estado, campos cambiados,
conteo de blockers y booleanos. No incluye notas, motivos, nombres, correos,
RFC, factura ni identificadores bancarios.

## Privacidad y documentos

El contexto retorna cuenta/CLABE declaradas y maestras solo enmascaradas. Las
cuentas origen muestran `name`, banco, moneda y `last4`; nunca cuenta o CLABE
completas.

Los documentos se presentan por nombre, tipo, tamaño y cuarentena. La apertura
temporal continúa en el mecanismo privado existente. Fase 2B.1 no copia
archivos, no crea objetos Storage, no crea `documents`/`document_links` y no
genera URL pública.

## UX

El detalle muestra estados y acciones dinámicos:

- `Preparar solicitud de pago`;
- `Continuar preparación`;
- `Revisar solicitud preparada`;
- solo lectura para estados no elegibles o ya convertidos.

El modal incluye resumen, proveedor, datos internos, responsables, progreso,
pendientes y blockers. Permite guardado parcial, bloquea doble submit, conserva
cambios ante error, advierte antes de cerrar, admite Escape con confirmación y
devuelve foco al disparador. No incluye convertir, crear, aprobar ni enviar a
batch.

## Aplicación futura en DEV

Paquete: `ops/provider-intake/apply-041-payment-draft/`.

1. Gate 1 separado y explícito.
2. Precheck read-only.
3. Captura read-only de metadata/funciones/conteos en artefacto privado.
4. Comparación byte a byte y SHA-256.
5. Dry-run transaccional con rollback.
6. LOAD exacto una vez.
7. Postcheck read-only.
8. UAT autenticada limitada al borrador.

No usar `db push` ni `migration repair`.

## Rollback

La migration es atómica. Un fallo antes de `COMMIT` revierte todo. Después de
commit, cualquier rollback requiere autorización separada y debe usar la
captura privada del paquete; no se permite improvisar SQL destructivo. Hasta
Gate 1 no se ejecuta ningún paso del paquete.

## Dependencias y transición futura

La rama está apilada sobre el head de PR #258 (matching Fase 2A). No debe
considerarse integración final hasta que #258 se fusione a `dev` y esta rama se
rebase. Fase 2B.2 deberá crear atómicamente la solicitud definitiva, relacionar
documentos según el contrato aprobado, establecer `created_payment_request_id`
y convertir el intake. Nada de eso forma parte de esta entrega.
