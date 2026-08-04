# Candidate Slice — Cortes semanales (01B)

Rama: `candidate/slice-cortes-01b` (base: `origin/main` @ 32b9752, post-canonicalización #301/#302).
Método: candidato desde main portando SOLO archivos/hunks del feature. Sin merge de dev. Sin PR.
PRs fuente: #246, #247, #248, #249, #250 completos (código) + hunks seleccionados de #252. #253 y #255 no aportan código frontend (solo ops/docs/migraciones; ver Gap 028 abajo).

## Contenido por archivo

| Archivo | Estado | PR fuente | Nota |
|---|---|---|---|
| `approval_batches.html` | NUEVO (copiado íntegro) | #246, #247, #248, #249, #250, #252 | Blob exacto del estado post-#252 (`09aea625`). NO es el tip de dev (ver "Post-#252 excluido"). |
| `approval_batches.js` | NUEVO (copiado íntegro) | #246–#250, #252 | Blob post-#252 (`3f57085e`). |
| `solicitudes_batch_execution.js` | NUEVO (copiado íntegro) | #248, #249, #252 | Blob post-#252 (`49fe8dbc`). Contiene wiring pasivo de extraordinaria (ver Residual). |
| `config.js` | hunks | #246 (entrada de nav "Cortes semanales") + #252 (bump de versión de `cash_flow_extension` y `solicitudes_workboard_extension`; retiro de `solicitudes_cash_detail_patch.js`) | Ambos hunks aplican limpio sobre main. |
| `layouts.html` | hunks | #248 → #249 → #252 en cadena | La base de #248 == main; aplicación limpia. |
| `layouts.js` | hunks | #248 → #249 → #252 en cadena | main difiere de la base de #248 solo en 1 línea en blanco; aplicación limpia. Preview de elegibilidad, gating por cortes cerrados, rebatch. |
| `cash_flow_extension.js` | hunks | #252 | Gate de creación de fondo por contexto de ejecución (`get_payment_request_execution_context`), método de pago canónico, resultado canónico de `create_cash_fund`. |
| `solicitudes_workboard_extension.js` | hunks | #252 | base == main; aplicación limpia. `payment_method` canónico + limpieza de logs debug. |
| `solicitudes.html` | hunks (manual) | #248, #249, #252 | CSS `.batch-execution-*` y `.batch-history-*` + script `solicitudes_batch_execution.js?v=20260714-readiness-028` + bump `cash_flow_extension.js?v=20260714-readiness-028d`. SIN diálogos ni CSS de extraordinaria (ver abajo). |
| `proveedores.js` | hunks | #249 | `openProviderFromQuery()`: deep-link `?provider_id=` desde layouts/cortes para completar datos de pago. |
| `proveedores.html` | hunk adaptado | #249 | Bump de versión a `?v=20260804-layout-completion-link` (main traía `20260803-csf-accessible-feedback` de Slice 01A; el string de dev era más viejo que el de main, se usó fecha nueva para garantizar cache-bust). |

Excluido globalmente: `supabase/migrations/` (van en `candidate/cortes-migrations-sql-only`), `ops/`, `docs/`, `.github/workflows/`, `scripts/` (incluye `scripts/check_approval_batch_independence.js`, tooling de QA), `docs/qa/`, `supabase/functions/notification-dispatcher/index.ts` (edge function NUEVA en dev que arrastra todo el sistema de notificaciones N1-A, fuera de alcance; se despliega por su propio canal).

## Hunks EXCLUIDOS

### 1. Extraordinaria (decisión de Carlos: 01B sale SIN solicitud extraordinaria; va como 01C)

En `solicitudes.html` quedaron FUERA estos hunks de #248 (diff literal):

```diff
@@ CSS excluido (#248) @@
+    .extraordinary-warning { padding:10px; border-left:3px solid #d97706; background:var(--amber-dim); color:var(--text-2); font-size:12px; line-height:1.5 }
+    .extraordinary-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px }
+    .extraordinary-summary div { min-width:0; padding:9px 10px; border:1px solid var(--border); border-radius:7px; background:var(--bg-surface) }
+    .extraordinary-summary span { display:block; color:var(--text-3); font-size:9.5px; font-weight:700; text-transform:uppercase }
+    .extraordinary-summary strong { display:block; margin-top:3px; color:var(--text-1); font-size:11.5px; overflow-wrap:anywhere }
+    .extraordinary-row-badge { margin-left:6px }
-    @media (max-width:760px)  { .form-grid { grid-template-columns:1fr } .budget-strip { grid-template-columns:1fr } }
+    @media (max-width:760px)  { .form-grid { grid-template-columns:1fr } .budget-strip { grid-template-columns:1fr } .extraordinary-summary { grid-template-columns:1fr 1fr } }
```

```diff
@@ Diálogos excluidos (#248) @@
+  <dialog id="extraordinaryDialog" class="narrow">
+    <form id="extraordinaryForm" class="modal-content">
+      <div class="modal-header"><div><h2 style="color:var(--text-1)">Autorizar pago extraordinario</h2><p id="extraordinarySubtitle">Solicitud aprobada por Finanzas.</p></div><button type="button" id="closeExtraordinaryBtn" class="icon-btn" aria-label="Cerrar">x</button></div>
+      <div class="modal-scroll"><div class="form-grid"><div class="full-row extraordinary-warning">Este pago omitira la autorizacion de Direccion...</div><div id="extraordinarySummary" class="extraordinary-summary full-row"></div><label class="full-row">Categoria *<select id="extraordinaryCategory" ...></select></label><label class="full-row">Motivo *<textarea id="extraordinaryReason" ...></textarea></label><label class="checkbox-card full-row"><input id="extraordinaryConfirm" type="checkbox" required> Confirmo que existe una urgencia operativa...</label></div></div>
+      <div class="modal-actions"><button type="button" id="cancelExtraordinaryBtn" class="secondary-btn">Cancelar</button><button type="submit" id="submitExtraordinaryBtn" class="primary-btn">Autorizar extraordinario</button></div>
+    </form>
+  </dialog>
+
+  <dialog id="revokeExtraordinaryDialog" class="narrow">
+    <form id="revokeExtraordinaryForm" class="modal-content">
+      <div class="modal-header">... Revocar extraordinario ...</div>
+      <div class="modal-scroll"><div class="form-grid"><label class="full-row">Motivo de revocacion *<textarea id="revokeExtraordinaryReason" ...></textarea></label></div></div>
+      <div class="modal-actions">...<button type="submit" id="submitRevokeExtraordinaryBtn" class="primary-btn">Revocar autorizacion</button></div>
+    </form>
+  </dialog>
```

**Residual documentado**: los archivos NUEVOS se copiaron íntegros (método del slice), por lo que `solicitudes_batch_execution.js` conserva wiring pasivo de extraordinaria (todo con `?.` sobre DOM inexistente — no truena al cargar) y `layouts.js`/`approval_batches.js` conservan renderizado read-only de la clasificación `ready_extraordinary` que devuelve el RPC (sin UI de autorización nadie puede llegar a ese estado). CASO LÍMITE: si el RPC `get_payment_request_execution_context` (022/023) devuelve `can_authorize_extraordinary=true` para Finanzas, `solicitudes_batch_execution.js:233` pinta el botón "Marcar como extraordinario" y el click truena en consola (`dom.extraordinaryForm.reset()` sobre null) porque el diálogo fue excluido. Es inerte (no autoriza nada) pero visible; se resuelve al llegar 01C.

### 2. Batch de comprobantes (va en `candidate/slice-batch-comprobantes`)
`config.js`: entrada de nav `{ key: "receipt-batches", ... comprobantes_batch.html ... }` — excluida.

### 3. Portal de proveedores / provider intakes
`config.js`: entrada `{ key: "provider-intakes", ... }`, `canTriageProviderIntakes()`, excepción en `enforcePageVisibility()` para `provider_intakes.html`, y `applyProviderCatalogRpcCompatibility()` (RPC `save_provider_catalog_with_payment_execution_data`) — excluidos.

### 4. Permisos/aprobador (van en `candidate/slice-permisos-aprobador`, P3)
- `solicitudes.html`: sección `approverSelectionSection`, `summaryApprover` y bumps `?v=20260709-approver-position`/`?v=20260709-multi-approver-pool` — excluidos (los porta el slice de permisos).
- `cash_flow_extension.js`: los 3 hunks de `p_approver_id`/`p_approver_assignment_id`/validación de aprobador — excluidos (idem).

### 5. Nav rediseñado / gate de perfil inactivo
`config.js`: `ROLE_GROUPS.INACTIVE`, `isInactive()`, `renderInactiveProfileGate()`, eliminación de caches de nav/rol, `NAV_RENDER_VERSION=20260723-inactive-profile-gate` — excluidos (feature aparte).

### 6. Post-#252 en dev (fuera del alcance 01B)
Los archivos del feature en el TIP de dev incluyen commits posteriores que dependen de migraciones NO incluidas y por eso el slice congela el estado post-#252:
- `893e3af` "preserve Direction approval for execution data" → requiere `033_separate_approval_material_from_payment_execution_data.sql`.
- `adb2b9e` "Hotfix multi-director pools" → requiere `034_support_multiple_active_company_directors.sql`.
- `7ec05a2` "secure extraordinary authorization lineage" → extraordinaria 01C (migraciones 036/037).
- `config.js` en dev además trae `applyPaymentRequestExecutionRpcCompatibility()` (ligado a 033) — excluido.

## Hunks que requieren rebase post-P3 (permisos)

Ningún hunk de cortes DEPENDE funcionalmente de código del slice de permisos (todo el gating de cortes es server-side vía RPC). Sí hay UN punto de fricción textual al mergear después de P3:
- `solicitudes.html` línea del script `cash_flow_extension.js`: este slice la deja en `?v=20260714-readiness-028d`; el slice de permisos la deja en `?v=20260709-multi-approver-pool`. Al mergear este candidato DESPUÉS de permisos habrá conflicto trivial en esa línea → resolver conservando `?v=20260714-readiness-028d` (la versión de cortes es posterior e incluye el archivo con hunks de permisos ya presentes en main post-P3). Idéntico criterio si `cash_flow_extension.js` conflictúa: los hunks de #252 aquí portados NO tocan las líneas de aprobador (regiones distintas del archivo); un rebase sobre main post-P3 aplica limpio.

## RPCs validados (frontend ↔ migraciones 021–024 + 026)

| RPC (llamado por) | Definido en |
|---|---|
| `create_approval_batch` (approval_batches.js) | 021 |
| `list_batch_eligible_requests` (approval_batches.js) | 021, redefinido 023 |
| `add_request_to_approval_batch` (approval_batches.js) | 021, 023 |
| `remove_request_from_approval_batch` (approval_batches.js) | 021 |
| `submit_approval_batch` (approval_batches.js) | 021, 023 |
| `approve_entire_batch` (approval_batches.js) | 021, 023 |
| `decide_approval_batch_items` (approval_batches.js) | 021, 023, 024 |
| `close_approval_batch` (approval_batches.js) | 021, 022, 023 |
| `get_approval_batch_detail` (approval_batches.js) | 021, 023 |
| `list_finance_approval_batches` / `list_director_approval_batches` (approval_batches.js, layouts.js) | 021 |
| `list_company_directors` (approval_batches.js) | 021 |
| `list_approval_batch_director_candidates` (approval_batches.js) | 021 |
| `set_company_batch_configuration` (approval_batches.js) | 022 |
| `release_and_rebatch_rejected_request` (approval_batches.js, layouts.js) | 022, 023 |
| `get_payment_request_execution_context` (solicitudes_batch_execution.js, cash_flow_extension.js) | 022, 023 |
| `authorize_payment_request_extraordinary` / `revoke_payment_request_extraordinary` (solicitudes_batch_execution.js, wiring inerte) | 022 / 022 |
| `create_payment_layout` (layouts.js) | 022 (reemplaza y condiciona a cortes cerrados) |
| `preview_payment_layout_eligibility` (layouts.js) | 022, 023 |
| `complete_payment_request_layout_data` (layouts.js) | 023 |
| `create_cash_fund` (cash_flow_extension.js) | 026 (gate por método de pago) |
| `confirm_payment_layout`, `mark_payment_layout_uploaded`, `reject_payment_layout_line`, `update_payment_layout_line_pagosint_reference`, `create_payment_request`, `verify_cash_block` | pre-existentes (00303/00304/00305, ya en ledger PROD) |
| `approval_batch_budget_validation` | 023 (uso interno del backend, no la llama el frontend directo) |

**⚠️ GAP DETECTADO — migración 028 (PR #255) NO incluida**: `cash_flow_extension.js` (#252, commit `e23656e` "Use server readiness for cash fund actions") lee del contexto los campos `can_create_cash_fund`, `cash_fund_block_reason` y `execution_authorization_source`, que SOLO devuelve la versión de `get_payment_request_execution_context` de `028_cash_fund_batch_execution_readiness.sql` (PR #255). Con solo 021–024+026 aplicadas, esos campos llegan `undefined` → el botón "crear fondo" para efectivo/cheque nunca se habilita y se muestra "No se pudo confirmar si la solicitud esta autorizada...". Decisión pendiente de Ramón/Carlos: agregar `028` al PR de migraciones o aceptar el flujo de fondos bloqueado en 01B. El resto del feature de cortes (crear/revisar/aprobar/rechazar/reabrir/ejecutar corte y layout bancario) NO depende de 028.

## DEPENDENCIAS de activación

(a) **Este slice se activa DESPUÉS de P3 (permisos)**: César necesita el rol `director` que otorga el seed de permisos. Base actual = main SIN permisos; ver nota de rebase arriba (solo conflicto trivial de versión de script).
(b) **Sus migraciones van aparte** en `candidate/cortes-migrations-sql-only` vía canal nativo de Supabase (021, 022, 023, 024, 026).
(c) **Atómico DB↔código**: la `023` REEMPLAZA `create_payment_layout` condicionándolo a cortes cerrados (y `022` ya lo condiciona antes). Una vez aplicadas las migraciones, el layout bancario SOLO acepta lo liberado por corte: el código de este slice y sus migraciones deben activarse juntos.
(d) **Aviso a Yanin**: la solicitud extraordinaria NO viene en este release; llega como 01C aparte.

**Nota César/company_directors**: al activar, César debe agregarse a `company_directors` (el seed de permisos ya le da rol `director`; el insert a `company_directors` está staged en `seed_permisos_operadora.sql` sección 4). Orden de ventana completo documentado en el commit de `candidate/cortes-migrations-sql-only`.

## Verificaciones ejecutadas

- `node --check` OK en: `approval_batches.js`, `solicitudes_batch_execution.js`, `cash_flow_extension.js`, `solicitudes_workboard_extension.js`, `layouts.js`, `proveedores.js`, `config.js`.
- Referencias HTML: todos los `src`/`href` locales de `approval_batches.html` y `layouts.html` existen en la rama (ux2_*.css, components.js, nav_first_paint_bootstrap.js, config.js, approval_batches.js, fase2_request_payment_method_extension.js, páginas de nav).
- `solicitudes.html` carga `solicitudes_batch_execution.js` y los ids que consume (`detailContent`, `detailDialog`, `requestsTableBody`) existen en el HTML de main.
- Deep-link `layouts.js` → `proveedores.html?provider_id=` cubierto por `openProviderFromQuery()` portado.
- Cero referencias a `extraordinaryDialog` en `solicitudes.html`.
- RPCs auditados archivo por archivo (tabla arriba), incluidos los dinámicos (`runRpc(...)`, `state.view === "finance" ? ... : ...`).

## Addendum 5-ago-2026 — branding del PDF de corte

`exportPdf()` de `approval_batches.js` actualizado a la identidad Flux verde que ya
está en prod (login + shell): wordmark embebido (base64, ~12 KB) arriba a la derecha,
encabezado de tabla `#172d29` con texto crema, filas alternadas con tinte verde y pie
"Flux Operadora — corte semanal". Solo estilos/branding — cero cambios de datos,
columnas o RPCs. `node --check` OK. Verificado renderizando el PDF con datos mock
(jsPDF + autotable reales). Cache bump: `approval_batches.js?v=20260805-brand-pdf`.
