# Migración: Solicitudes de pago (vanilla → React)

Sección central del flujo de Flux. Portada 1:1 desde `solicitudes.html` +
`solicitudes.js` y sus extensiones runtime cargadas en el HTML.

## Ruta y montaje
- Ruta: `/solicitudes`. Componente default-export: `SolicitudesPage` en
  `SolicitudesPage.tsx`.
- `App.tsx` hoy mapea `solicitudes` a `SectionPending` (no editado por esta tarea);
  para activar la migración, apuntar la ruta a `./features/solicitudes/SolicitudesPage`.
- Deep-link: `?request_id=<uuid>` abre el detalle de esa solicitud tras la carga
  inicial (igual que `openRequestFromUrl()`). Se valida contra la lista cargada.

## Tablas / vistas leídas
- `payment_requests` (lista + edición + notas + vínculo de comprobante).
- `companies`, `cost_centers`, `budget_categories`, `proveedores`, `profiles`.
- `budget_availability` (partidas disponibles por empresa+CC+mes).
- `payment_request_approvals` (historial de decisiones).
- `payment_receipts` (información de pago, status = paid).
- `payment_request_extraordinary_authorizations` (badges de extraordinario en tabla).
- `incident_charges` + `members` (asociar incidencia, sólo `canApprove`).
- `cash_funds` (sección de fondo para efectivo/cheque).

## RPCs (nombre + parámetros)
- `create_payment_request(p_proveedor_id, p_company_id, p_cost_center_id,
  p_budget_category_id, p_budget_month, p_amount_requested, p_currency,
  p_exchange_rate, p_description, p_notes, p_requested_by,
  p_is_extraordinary_adjustment, p_approver_id, p_approver_assignment_id)`.
- `list_payment_request_approver_options(p_company_id, p_cost_center_id, p_amount)`.
- `get_payment_request_approver_details(p_payment_request_id)`.
- `decide_payment_request(p_payment_request_id, p_actor_profile_id, p_action, p_comments)`.
- `get_payment_request_execution_context(p_payment_request_id)`.
- `get_payment_request_receipt_summary(p_payment_request_id)`.
- `get_payment_operation_evidence_access(p_evidence_id)`.
- `begin_extraordinary_authorization(p_payment_request_id, p_category, p_reason,
  p_external_director_profile_id, p_external_authorized_at, p_idempotency_key)`.
- `finalize_extraordinary_authorization(p_authorization_id, p_evidence_type,
  p_evidence_sha256, p_evidence_mime_type, p_evidence_size_bytes,
  p_finance_attests_evidence_matches_request, p_idempotency_key)`.
- `revoke_payment_request_extraordinary(p_payment_request_id, p_reason)`.
- `verify_cash_block(p_profile_id)` y `create_cash_fund(p_payment_request_id,
  p_responsible_profile_id, p_due_date, p_delivery_method, p_delivered_by, p_notes)`.

La metadata de Fase 2 (`request_type`, `payment_method`) se guarda con un
`update` directo a `payment_requests` tras crear (no vía RPC); si la columna no
existe en el ambiente (migración 004c ausente) se degrada con un warning, sin
bloquear la creación (`isMissingFase2ColumnError`).

## Storage
- Bucket `payment-receipts`. Ruta `<folder>/<Date.now()>_<rand>.<ext>`
  (folder = `solicitudes/<requestId>`). URL firmada TTL 3600.
- Evidencia extraordinaria: bucket/ruta devueltos por
  `begin_extraordinary_authorization`; se sube con metadata `{ sha256 }`; SHA-256
  se calcula con `crypto.subtle.digest`.
- Descarga de comprobante de pago: URL firmada con TTL devuelto por
  `get_payment_operation_evidence_access` (default 300 s).

## Máquina de estados / estatus
- `status`: `submitted → approved | changes_requested | finance_validation |
  scheduled → paid`, más `rejected`, `cancelled`.
- Activas: `submitted, approved, changes_requested, finance_validation, scheduled`.
- Excepción: `budget_decision === 'bloqueado'` **o** `is_extraordinary_adjustment`.
- Decisión final (sin controles): `approved, rejected, changes_requested,
  scheduled, paid, cancelled`.
- Terminal (no editable): `paid, cancelled, rejected, approved, scheduled`.
- Acciones de decisión normales: `approved | rejected | changes_requested`.
- Acciones de excepción: `exception_approved | exception_rejected |
  amount_change_requested | category_change_requested | budget_adjustment_requested`.
- Comentario obligatorio salvo `approved` de solicitud no-excepción.

## Compuertas por rol (config.js / lib/roles)
- Sección accesible a todos los grupos, incl. OPERATION.
- `canApprove` = grupo ∈ {SYSADMIN, ADMIN, DIRECTION} → habilita: decidir,
  editar (si no terminal), checkbox "Ajuste extraordinario" en creación,
  sección de incidencia asociada.
- Sólo el aprobador seleccionado (o solicitud sin aprobador) puede decidir.
- Opción "Nómina" en Tipo de solicitud: visible sólo con rol exacto de Finanzas
  (`finance/finanzas/treasury/tesoreria/administracion`) — `hasFinanceRole`.
- Panel de ejecución/extraordinarios: se muestra según `is_finance` y el contexto
  del RPC; el registro de autorización externa lo gobierna el backend
  (`can_authorize_extraordinary`, `authorization_block_reason`).

## Extensiones runtime folded-in (antes MutationObserver/patches)
- `solicitudes_ux1_extension.js`: orden final del formulario (**Datos del pago →
  Proveedor / beneficiario → Clasificación presupuestal → Contexto operativo →
  Datos de entrega → Revisión final**), asociación opcional de visita/incidencia
  durante la creación y marcador trazable en `notes`. Reproducido en
  `RequestModal`.
- `fase2_request_payment_method_extension.js`: campos **Tipo de solicitud** y
  **Método de pago**, sección **Datos de entrega** (efectivo/cheque), método
  preferido del proveedor al seleccionarlo, alta rápida de proveedor (`+`),
  panel de éxito ("Crear otra" / "Cerrar y ver"), badges de tipo/método en tabla
  y detalle, metadata local de efectivo en `localStorage`
  (`flux-cash-request-<id>`). Reproducido en `RequestModal`, `QuickProviderModal`,
  `SolicitudesPage` (badges de tabla) y `DetailModal` (strip de detalle).
  Nota: `fase2_request_success_patch.js` está **desactivado en el vanilla** (la
  extensión de payment_method fija su flag `__fluxFase2RequestSuccessPatchLoaded`),
  por lo que el submit operativo es el de payment_method; se portó ése.
- `solicitudes_batch_execution.js`: panel "Ruta de autorización y pago" /
  contingencia extraordinaria en el detalle, badges de extraordinario en tabla,
  diálogo de autorización externa (3 pasos: begin → upload evidencia → finalize)
  y diálogo de revocación. Reproducido en `DetailModal` (BatchExecutionPanel) +
  `ExtraordinaryModal` / `RevokeExtraordinaryModal`.
- `payment_request_reconciliation_evidence.js`: sección "Comprobante de pago"
  (Finanzas) con ver/descargar evidencia. Reproducido en `DetailModal`
  (ReceiptSection).
- `cash_flow_extension.js` (parte de solicitudes): sección "Fondo y comprobación"
  para efectivo/cheque, con crear fondo. Reproducido en `DetailModal`
  (CashFundSection) + `CashFundModal`.

## Deep-link params
- `?request_id=<uuid>` → abre detalle.

## Riesgos de paridad / gaps explícitos
1. **Rail de Nómina (N2B) NO portado.** `payroll_capture.js` (~600 líneas) y
   `budget_live_frontend_guards.js` (compuerta presupuestal N5B) implementan un
   sub-flujo de staging de nómina completo (sesiones, slots de archivos, layouts
   Toka/SPEI, materialización). Aquí sólo se expone la opción "Nómina" (gated a
   Finanzas) y, al intentar crearla, se muestra un aviso de que la captura vive en
   su flujo dedicado. **No se crea vía `create_payment_request`.** Migrar la
   nómina como su propia feature.
2. **Descarga de comprobante single-page verificada.** El vanilla usa
   `payment_batch_single_page_pdf.js` (pdf-lib) para descargar/verificar un PDF de
   una sola página y forzar `download`. Aquí "Descargar para compartir" abre la URL
   firmada en una pestaña nueva (el sandbox de artefactos/descargas y la ausencia
   de pdf-lib en la SPA lo justifican). La verificación SHA/single-page queda
   pendiente si se requiere descarga forzada con nombre de archivo.
3. **Badge "violet" → "accent".** El componente `Badge` compartido no tiene
   variante violeta; "Extraordinario" y "Excepción" usan `accent` (mismo texto,
   color distinto al vanilla).
4. **Refrescos por polling/MutationObserver eliminados.** El vanilla re-consulta
   `requestedAmount` y re-inyecta badges con timers/observers; aquí el monto y los
   badges se derivan del estado cargado (una consulta). El total de "Monto
   solicitado" se calcula sobre la lista cargada (suma de activas), equivalente a
   `updateRequestedAmountFull`.
5. **`Components.showToast` reparenting al `<dialog>`** (top-layer) no se replica;
   el `ToastProvider` compartido ya renderiza los toasts por encima.
6. **Botón "Demo"** (`fillDemoRequest`) del vanilla no se portó (no está en el HTML
   activo; era utilería de presentación).
7. **Enriquecimiento de otras páginas** (aprobaciones, layouts, pagos) que la
   extensión Fase 2 hacía desde `solicitudes.html` pertenece a esas secciones y no
   aplica aquí.
8. **RLS/errores:** los mapas de error (routing de aprobador, decisión,
   extraordinarios, cash fund, bloque presupuestal) se portaron 1:1 a `logic.ts`.
