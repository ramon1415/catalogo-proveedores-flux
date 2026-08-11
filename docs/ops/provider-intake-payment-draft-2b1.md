# Fase 2B.1 — preparación de solicitud de pago desde intake

## Estado postmatching

| Elemento | Estado |
|---|---|
| Matching PR #258 | `MERGED` |
| Head integrado de Matching | `adacc471204d4715259de272bc75fbaa365afbbb` |
| Base exacta C1B | `2deae2cddf8ebb22fffd76e7a648483e2b3cc609` |
| Candidata histórica | `26552c8ce17bbe97f5010e4c2672d474adae416e` |
| Certificación histórica | `467/467 PASS / HISTORICAL_ONLY` |
| Resultado W2 | `PASS / MATCHING_MERGED / C1B_INPUTS_CAPTURED / NO_CHANGES` |
| Estado actual | `POSTMATCHING_CANDIDATE / NOT_CERTIFIED / NOT_APPLIED` |
| SQL aplicado | `false` |
| DEV writes | `0` |
| PR | `NONE` |
| UAT | `NOT_EXECUTED` |
| 2B.2 | `NOT_STARTED` |
| Postmatching certification | `PENDING_C2B` |
| Siguiente gate | `2B1-CERTIFICATION-C2B` |

La certificación histórica corresponde únicamente al SHA
`26552c8ce17bbe97f5010e4c2672d474adae416e`. La candidata postmatching tiene
una base y un scope diferentes y no está certificada todavía.

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

La última transición sigue fuera del alcance. Fase 2B.2 no está iniciada ni
autorizada.

## Arquitectura

`supabase/migrations/20260811035346_043_provider_intake_payment_draft.sql` es la única fuente
activa del schema de 2B.1. La migration está versionada en la candidata postmatching como versión Supabase CLI `20260811035346`, slot lógico `043`, pero no está aplicada.

Migration 043 define:

- `public.payment_intake_conversion_drafts`;
- `provider_intake_conversion_draft_fingerprint(jsonb)`, helper interno;
- `provider_intake_payment_draft_state(uuid)`, helper interno;
- `get_provider_intake_payment_draft_context(uuid)`, RPC read-only;
- `save_provider_intake_payment_draft(...)`, RPC de guardado parcial;
- eventos append-only `conversion_draft_created` y
  `conversion_draft_updated`.

El frontend consume solo los dos RPC públicos. La tabla no se expone por REST.

## Scope de reconstrucción C1B

La candidata postmatching se reconstruye de forma limpia y filtrada desde
`2deae2cddf8ebb22fffd76e7a648483e2b3cc609` y contiene exclusivamente estas
ocho rutas:

- `supabase/migrations/20260811035346_043_provider_intake_payment_draft.sql`;
- `provider_intakes.css`;
- `provider_intakes.html`;
- `provider_intakes.js`;
- `scripts/qa/provider-intake-payment-draft-visual.mjs`;
- `scripts/qa/provider-intake-payment-draft-contract.test.mjs`;
- `docs/analysis/provider-intake-payment-draft-discovery.md`;
- `docs/ops/provider-intake-payment-draft-2b1.md`.

Las cinco rutas de la candidata histórica bajo
`ops/provider-intake/apply-041-payment-draft/**` no forman parte de C1B. Su
clasificación, cuando sea necesario citarlas como trazabilidad, es:

`HISTORICAL_ONLY / DEPRECATED_FOR_DEPLOYMENT`

No constituyen una fuente activa del schema ni una vía permitida de
despliegue.

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

Cada creación o actualización material incrementa o inicia `version` y agrega
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

## Integridad de Migration 043

Fuente activa:

`supabase/migrations/20260811035346_043_provider_intake_payment_draft.sql`

Identidad vigente:

- blob histórico reutilizado:
  `fdbdba8d8dd00b4f2371fd08013a96992b3463b5`;
- tamaño: `44,491` bytes;
- SHA-256:
  `be4f0ade8670c7e8b26eb148eba7c38a4e05bf8954c602a8f432431f1ea0c9cc`;
- slot lógico 043: asignado después del 041 vigente en `dev` y del 042 reservado por PR #286;
- versión Supabase CLI: `20260811035346`;
- compatibilidad estática W2: `COMPATIBLE_AS_IS`;
- aplicación: `NOT_APPLIED`.

La prueba contractual postmatching valida directamente esta migration activa.
No depende de un LOAD ni de otra ruta bajo `ops/**`.

## Aplicación futura mediante Supabase CLI

C1B no autoriza ninguna aplicación de schema. C2B tampoco debe ejecutar SQL:
su función es certificar el nuevo SHA mediante pruebas no-write.

Una futura aplicación queda reservada a un gate separado de Supabase CLI que
deberá:

- identificar explícitamente el entorno objetivo;
- contar con autorización humana expresa;
- seguir la estrategia central documentada en
  `docs/ops/supabase-cli-migrations.md`;
- revisar la migration y el historial remoto antes de cualquier cambio;
- detenerse ante una discrepancia de schema o historial;
- registrar por separado aplicación, validación y recuperación.

Este documento no contiene instrucciones activas de despliegue. En C1B no está
autorizado:

- ejecutar `supabase db push`;
- ejecutar `supabase migration repair`;
- ejecutar SQL manual;
- usar PROD;
- ejecutar UAT;
- aplicar Migration 043;
- crear un borrador real;
- convertir un intake;
- iniciar Fase 2B.2.

La ceremonia histórica basada en precheck, backup, LOAD, postcheck y paquetes
`ops/**` es:

`HISTORICAL_ONLY / DEPRECATED_FOR_DEPLOYMENT`

No debe reconstruirse, ejecutarse ni extenderse.

## Recuperación

Como SQL aplicado es `false`, C1B no requiere rollback de base de datos. Un
conflicto o violación de scope debe detener el gate antes de cualquier
promoción.

Después de una futura aplicación autorizada, cualquier recuperación deberá
seguir una estrategia separada, revisada y forward-only. No se permite
improvisar SQL destructivo ni reparar el historial de migrations sin
autorización expresa.

## Dependencias y transición futura

Matching Fase 2A ya está integrado mediante PR #258. El head final de Matching
es `adacc471204d4715259de272bc75fbaa365afbbb` y la base postmerge usada por C1B
es `2deae2cddf8ebb22fffd76e7a648483e2b3cc609`.

La candidata histórica
`feature/ramon-provider-intake-payment-draft-integration` en
`26552c8ce17bbe97f5010e4c2672d474adae416e` permanece intacta y sirve solo como
evidencia histórica. Su resultado `467/467 PASS` no certifica el SHA
postmatching.

El siguiente gate es `2B1-CERTIFICATION-C2B`. Hasta completarlo no debe
declararse certificada la candidata postmatching ni prepararse una promoción.

Fase 2B.2 deberá crear atómicamente la solicitud definitiva, relacionar
documentos según el contrato aprobado, establecer
`created_payment_request_id` y convertir el intake. Nada de eso forma parte de
C1B o C2B.
