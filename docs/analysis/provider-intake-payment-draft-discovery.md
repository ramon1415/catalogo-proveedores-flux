# Discovery canónico — borrador de solicitud de pago desde intake

Fecha de inspección funcional original: 2026-07-23  
Fecha de reconciliación postmerge: 2026-07-31 UTC  
Base histórica de la candidata certificada: `691db2d3f683a760cc3fd233437e1d3bcfa1c256`  
Head integrado de Matching: `adacc471204d4715259de272bc75fbaa365afbbb`  
Merge commit y base exacta C1B: `2deae2cddf8ebb22fffd76e7a648483e2b3cc609`  
Candidata histórica certificada: `26552c8ce17bbe97f5010e4c2672d474adae416e`  
Estado: `POSTMATCHING_CANDIDATE / NOT_CERTIFIED / NOT_APPLIED`  
Modo: análisis del repositorio; no se consultó ni modificó Supabase DEV.

## Dictamen

No existe una tabla, vista o RPC equivalente a un borrador persistente de
conversión de `payment_intake` a `payment_requests`. Las apariciones existentes
de “draft/borrador” corresponden al estado de solicitudes, cortes, layouts u
otros dominios. Por lo tanto, no aplica
`EXISTING_PAYMENT_DRAFT_CONTRACT_FOUND`.

La auditoría postmerge `2B1-MATCHING-MERGE-W2` cerró como:

`PASS / MATCHING_MERGED / C1B_INPUTS_CAPTURED / NO_CHANGES`

PR #258 quedó integrado con head final `adacc471204d4715259de272bc75fbaa365afbbb`
y merge commit `2deae2cddf8ebb22fffd76e7a648483e2b3cc609`.
W2 confirmó que Migration 041 continúa disponible, segura y estáticamente
compatible con ese `dev`. Migration 041 no ha sido aplicada.

La certificación `467/467 PASS` corresponde exclusivamente a la candidata
histórica `26552c8ce17bbe97f5010e4c2672d474adae416e`. No certifica la candidata
postmatching, cuya certificación permanece pendiente de
`2B1-CERTIFICATION-C2B`.

## Reconciliación postmatching

C1B reconstruye el cambio de forma limpia y filtrada desde
`2deae2cddf8ebb22fffd76e7a648483e2b3cc609`. Su alcance está limitado a estas
ocho rutas:

- `supabase/migrations/041_provider_intake_payment_draft.sql`;
- `provider_intakes.css`;
- `provider_intakes.html`;
- `provider_intakes.js`;
- `scripts/qa/provider-intake-payment-draft-visual.mjs`;
- `scripts/qa/provider-intake-payment-draft-contract.test.mjs`;
- `docs/analysis/provider-intake-payment-draft-discovery.md`;
- `docs/ops/provider-intake-payment-draft-2b1.md`.

Las cinco rutas históricas bajo
`ops/provider-intake/apply-041-payment-draft/**` quedan excluidas de C1B. Su
clasificación es:

`HISTORICAL_ONLY / DEPRECATED_FOR_DEPLOYMENT`

La candidata histórica permanece intacta como evidencia de los blobs, parches y
la certificación anterior. La reconstrucción postmatching no hereda
automáticamente esa certificación porque tiene base, scope, documentación,
prueba contractual y SHA propios.

## Contratos canónicos encontrados

### Intake y auditoría

`public.payment_intake` se crea en Migration 025. Sus columnas relevantes son:

| Columna | Tipo/contrato relevante |
|---|---|
| `id` | `uuid`, PK |
| `company_id` | `uuid`, FK `companies(id)`, `ON DELETE RESTRICT` |
| `status` | `text`: `received`, `in_review`, `needs_correction`, `rejected`, `converted`, `cancelled` |
| `concept`, `description` | `text` |
| `amount_requested` | `numeric(18,2)`, positivo |
| `currency` | `text`, tres letras mayúsculas |
| `requested_payment_date` | `date`, nullable |
| `invoice_folio`, `invoice_uuid`, `invoice_date` | datos declarados de factura |
| `bank_name`, `bank_account`, `bank_clabe`, `beneficiary_name` | evidencia declarada; no debe copiarse al borrador |
| `matched_proveedor_id` | `uuid`, FK `proveedores(id)`, nullable |
| `created_payment_request_id` | `uuid`, FK `payment_requests(id)`, nullable |
| `updated_at` | `timestamptz`, material de concurrencia optimista |

`public.payment_intake_events` es append-only mediante
`payment_intake_events_immutable`. Migration 029 agrega el índice único parcial
`(payment_intake_id, metadata ->> 'action_id')`, usado por Migrations 030 y 031
para idempotencia material. El constraint de `event_type` vigente incluye los
eventos de triage, `internal_note` y `provider_matched`. Migration 041 preserva
todos esos tipos y propone agregar únicamente `conversion_draft_created` y
`conversion_draft_updated`.

### Solicitud de pago definitiva

`public.payment_requests` se crea en Migration 00104 y evoluciona hasta
Migration 023. Los campos canónicos que una futura Fase 2B.2 necesitará poblar
incluyen:

- `proveedor_id`;
- `company_id`;
- `cost_center_id`;
- `budget_category_id`;
- `budget_month` (primer día del mes);
- `requested_by`;
- `approver_id`;
- `approver_assignment_id` y `approver_selection_source`;
- `amount_requested`, `currency`, `exchange_rate`;
- `company_bank_account_id`;
- `payment_method`;
- `scheduled_payment_date`;
- `concept`, `description`, `notes`;
- estado y snapshots presupuestales calculados durante creación.

El RPC vigente `create_payment_request` (Migration 019) exige proveedor,
empresa, centro de costo, categoría, mes, monto, solicitante y aprobador; valida
membresía, pool/reglas de aprobación y disponibilidad presupuestal. Inserta
directamente una solicitud `submitted`, por lo que no es apropiado para Fase
2B.1 y no debe invocarse.

### Proveedor maestro

`public.proveedores` es el maestro canónico.
`payment_intake.matched_proveedor_id` apunta a `proveedores.id`. Sus cuentas,
CLABE y método preferido no se copiarán al borrador. Migration 031, integrada
mediante PR #258, expone matching y comparación enmascarada sin modificar la
declaración original.

### Identidad, roles y empresa

- `public.profiles`: `id`, `auth_user_id`, `full_name`, `email`, `active`.
- `public.roles` y `public.user_roles`: asignación funcional.
- `public.profile_company_memberships`: membresía activa por empresa.
- `public.companies`: empresa receptora/pagadora, con `active`.
- `public.current_profile_id()`: resuelve `auth.uid()`.
- `public.provider_intake_actor_context()`: exige perfil autenticado con rol de
  Finanzas y clasifica `finance`, `admin` o `sysadmin`.
- `public.provider_intake_assert_company_access(company_id)`: aplica alcance por
  membresía, con acceso global canónico para Sysadmin.
- `public.has_active_company_membership(profile_id, company_id)`: valida perfil,
  empresa y membresía activos.

El contrato actual de creación permite que un usuario normal solo sea su propio
`requested_by`; Sysadmin puede indicar otro perfil activo con membresía. Para
Fase 2B.1 se conserva el camino mínimo y seguro: el selector de solicitante
devuelve únicamente al actor activo cuando tiene membresía en la empresa. El
proveedor externo nunca aparece como opción.

### Centros, partidas y presupuesto

- `public.cost_centers`: catálogo maestro.
- `public.company_cost_centers`: relación activa empresa/centro.
- `public.budget_categories`: partida canónica.
- `public.company_cost_center_budget_categories`: relación activa
  empresa/centro/partida.
- `public.budget_lines`: presupuesto por versión, empresa, centro, partida y
  `budget_month`.
- `public.verify_budget_availability(...)`: la evaluación definitiva se ejecuta
  al crear la solicitud, no al guardar el borrador.

Fase 2B.1 valida relaciones de catálogo, pero no reserva, altera ni recalcula
presupuesto.

### Cuenta origen y método de pago

La cuenta origen canónica es `public.company_bank_accounts.id`, ligada por
`company_id`, `active` y `currency`. El nombre persistido en el borrador será
`company_bank_account_id`; el contexto solo devuelve nombre, banco, moneda y
`last4`, nunca cuenta/CLABE completas.

`payment_requests.payment_method` es `text` con valores canónicos `transfer`,
`cash`, `check`, `other`. Para `transfer`, una cuenta origen activa de la misma
empresa es obligatoria. Para los demás métodos se permite `null` porque la ruta
operativa posterior tiene controles específicos.

### Aprobadores

Migration 019 define:

- `public.approver_assignments`: pool activo por empresa y solicitante;
- `public.list_payment_request_approver_options(company_id, cost_center_id, amount)`;
- `public.payment_request_has_active_approver_pool(...)`;
- `public.payment_request_rule_allows(...)`;
- `public.is_payment_request_approver_for_company(...)`.

El RPC de opciones no requiere una fila de `payment_requests`; usa al perfil
actual como solicitante. Puede reutilizarse dentro del RPC de contexto cuando
existen centro y monto, o inmediatamente si existe pool asignado. El guardado
vuelve a validar `approver_profile_id` y `approver_assignment_id`; no confía en
el frontend.

No se encontró una brecha que obligue a usar
`APPROVER_RULE_PENDING_CONVERSION`.

### Documentos

- `public.payment_intake_files` contiene el inventario privado del intake.
- `public.documents` y `public.document_links` son el contrato genérico para
  documentos internos.
- La apertura temporal de archivos del intake usa el mecanismo privado
  existente; no se almacena ni devuelve `storage_path` en el contexto del
  borrador.

Fase 2B.1 no copia archivos, no crea `documents`, no crea `document_links` y no
cambia Storage. La relación definitiva queda para Fase 2B.2.

## Brechas y decisiones de diseño

1. No existe borrador de conversión: Migration 041 propone
   `public.payment_intake_conversion_drafts`.
2. No existe helper de solicitantes: se devuelve el actor actual activo con
   membresía, alineado con `create_payment_request`.
3. El contexto de aprobadores depende del centro/monto. Sin esos datos, la lista
   puede estar vacía y el campo queda pendiente; después de guardar
   parcialmente, el contexto recalcula opciones.
4. El modelo de `payment_requests` no exige hoy una cuenta origen al crearse,
   pero la preparación la exige para transferencias para evitar una falsa
   condición de “lista”.
5. No existe un estado lógico específico para proveedor vinculado pero inactivo.
   Se clasifica como `READY_PENDING_PROVIDER` con blocker
   `PROVIDER_INACTIVE`, nunca como listo para conversión.
6. La evaluación presupuestal definitiva, generación de folio, creación,
   aprobación, notificación, batch y layout quedan explícitamente fuera de Fase
   2B.1.

## Objetos versionados por Migration 041

Migration 041, todavía no aplicada, define:

- tabla cerrada `public.payment_intake_conversion_drafts`;
- helper interno de fingerprint;
- helper interno de estado derivado;
- RPC `get_provider_intake_payment_draft_context(uuid)`;
- RPC `save_provider_intake_payment_draft(...)`;
- eventos `conversion_draft_created` y `conversion_draft_updated`;
- grants mínimos de ejecución solo a `authenticated`.

Ninguno de estos contratos crea o modifica `payment_requests`, `proveedores`,
batches, layouts, notificaciones, Storage o el estado/matching del intake.

## Estado de la candidata postmatching

| Elemento | Estado |
|---|---|
| Matching PR #258 | `MERGED` |
| Head integrado | `adacc471204d4715259de272bc75fbaa365afbbb` |
| Base C1B | `2deae2cddf8ebb22fffd76e7a648483e2b3cc609` |
| Candidata histórica | `26552c8ce17bbe97f5010e4c2672d474adae416e` |
| Certificación histórica | `467/467 PASS / HISTORICAL_ONLY` |
| Resultado W2 | `PASS / MATCHING_MERGED / C1B_INPUTS_CAPTURED / NO_CHANGES` |
| Alcance postmatching | `8 rutas` |
| Migration 041 | `AVAILABLE / COMPATIBLE / NOT_APPLIED` |
| Estado actual | `POSTMATCHING_CANDIDATE / NOT_CERTIFIED / NOT_APPLIED` |
| Siguiente gate | `2B1-CERTIFICATION-C2B` |