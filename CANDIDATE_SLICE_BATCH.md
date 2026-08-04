# Candidato: Slice "Comprobantes batch"

Rama: `candidate/slice-batch-comprobantes` (base: `origin/main` @ 85ec304).
Construida portando SOLO los archivos del feature desde `origin/dev` (PRs fuente #259–#276 + receipt-fix #143/#144, excluyendo harness y versiones superseded). Sin merge de dev, sin PR.

Alcance funcional 1:1 del flujo vigente: tesorería sube un PDF multi-página con comprobantes del banco; el sistema lo parte por página, hace match automático contra solicitudes (monto/beneficiario/cuentas), finanzas valida y el comprobante queda ligado 1:1 a su solicitud, con descarga privada verificada de una sola página.

## 1. Archivos portados (copias completas desde origin/dev)

### Módulo Comprobantes batch (UI + parser)
| Archivo | PR fuente |
|---|---|
| `comprobantes_batch.html` | #259 (base), #261 (guided UX), #263–#272 (runtime PDF, cache, descargas privadas, Storage auth, retry idempotente) |
| `comprobantes_batch.js` | #259, #261, #263, #267, #269, #270, #272–#276 |
| `comprobantes_batch.css` | #259, #261 |
| `payment_batch_parser.js` | #259 |
| `payment_batch_single_page_pdf.js` | #263 |
| `payment_batch_final_reconciliation.css` | #263 |
| `payment_request_reconciliation_evidence.js` | #263, #275 (compartición controlada), #276 (nombre de descarga) |

### Fix de comprobantes en Pagos y comprobaciones
| Archivo | PR fuente |
|---|---|
| `pagos_comprobaciones_receipt_fix.js` | #143 (transfer-receipt-sysadmin-permission) |
| `pagos_comprobaciones_receipt_fix.css` | #143 |

### Runtime PDF vendoreado (raíz, publicable en Vercel)
| Archivo | PR fuente |
|---|---|
| `pdf-lib-1.17.1.min.js` | #265 (supersede la copia CDN de #263 y la copia `vendor/` de #264) |
| `pdfjs-3.11.174.min.js` | #265 |
| `pdfjs-worker-3.11.174.min.js` | #265 |

Nota: los `.min.js` se excluyen de `node --check` (minificados de terceros, se portan byte a byte).

### Navegación
| Archivo | PR fuente |
|---|---|
| `nav_first_paint_bootstrap.js` | #259 — copia completa: TODO el diff main→dev de este archivo es del batch (entrada "Comprobantes batch", flag `sensitive` en fallback, `NAV_RENDER_VERSION=20260721-receipt-batches`) |

## 2. Migraciones del paquete

| Migración | PR fuente | Qué hace |
|---|---|---|
| `supabase/migrations/00402_payment_receipts_policies.sql` | #143/#144 (renombrada en #158) | Políticas de Storage para comprobantes de pago (base del receipt fix) |
| `supabase/migrations/032_payment_batch_reconciliation.sql` | #259 (+fix alias en dev directo) | Fundación de conciliación batch: tablas, RPCs de carga/match/validación |
| `supabase/migrations/033_payment_batch_final_reconciliation.sql` | #263 (+adf79da guided-UX/cutover) | Conciliación final 1:1, `get_payment_request_receipt_summary`, `get_payment_operation_evidence_access` |
| `supabase/migrations/034_payment_receipt_evidence_storage_policy_fix.sql` | #271 | Aísla el lookup de política de Storage de evidencia privada |
| `supabase/migrations/038_materialize_only_released_batch_items.sql` | #277 (commit eccb7ad) | Materializa solo items liberados del corte |

### DEPENDENCIA DURA de orden en prod
Estas migraciones referencian objetos que NO crea este paquete: `approval_batches`, `approval_batch_items` (y sus constraints de release de finanzas), `extraordinary_authorizations`, `extraordinary_events`, snapshots extraordinarios, etc.

**El paquete de cortes semanales (021–024, 028, 034_directors, 036–040) debe estar aplicado ANTES en prod.** Si no, 032/033/038 fallan en `CREATE`/`ALTER`/referencias. Nota de solapamiento: `038_materialize_only_released_batch_items.sql` aparece tanto en el rango 036–040 del paquete de cortes como en la lista de este slice; si el paquete de cortes ya la aplicó, NO debe re-aplicarse aquí (misma versión exacta, tomada de origin/dev).

Verificación cruzada hecha: todos los RPC que invoca el front portado (`get_payment_operation_evidence_access`, `get_payment_request_receipt_summary`) están definidos en las migraciones portadas.

### Migración verificada y EXCLUIDA
- `00403_fase2_payment_method_closure.sql` — NO es del batch. Es el cierre de Fase 2 (request type / payment method, PR #145). No se porta.

## 3. Archivos compartidos: hunks aplicados quirúrgicamente

No se copió ningún archivo compartido completo desde dev. Hunks batch aplicados:

- `config.js`
  - Entrada de módulo `receipt-batches` en `modules[]` (PR #259).
  - `NAV_RENDER_VERSION` → `"20260721-receipt-batches"` (PR #259; en dev hoy vale `"20260723-inactive-profile-gate"` por el feature de perfil inactivo, que no es de este paquete).
  - `fallbackFirstPaintModules()` ahora filtra `!item.sensitive`. Origen literal: PR #257 (provider intake), pero es REQUERIDO en runtime por la entrada `sensitive: true` del batch para que el módulo no se pinte en el first-paint pre-auth. Es la única pieza no-#259 aplicada; una línea, sin efecto sobre ningún otro módulo de main (no existe otro `sensitive`).
- `solicitudes.html`
  - `<link>` a `payment_batch_final_reconciliation.css` (PR #263).
  - Tres `<script>` insertados tras `solicitudes.js`: `pdf-lib-1.17.1.min.js`, `payment_batch_single_page_pdf.js`, `payment_request_reconciliation_evidence.js` (PRs #263/#265). Sin tocar las versiones de los scripts existentes (los bumps de dev son de otros paquetes).
- `pagos_comprobaciones.html`
  - `<link>` a `pagos_comprobaciones_receipt_fix.css` y `<script>` de `pagos_comprobaciones_receipt_fix.js` (PR #143).

## 4. Hunks pendientes de extracción manual

**Ninguno.** Todos los hunks propios del batch en archivos compartidos resultaron separables y quedaron aplicados. Los hunks vecinos NO aplicados pertenecen a otros paquetes (se listan para que el integrador no los busque aquí):

- `solicitudes.html` / `pagos_comprobaciones.html` / `config.js`: reescritura del nav estático (clases `muted`, `?tab=`, capitalización) — feature de navegación, otro paquete.
- `solicitudes.html`: estilos `.batch-execution-panel` / `.batch-history-*` / `.extraordinary-*`, sección `approverSelectionSection`, diálogos `extraordinaryDialog`/`revokeExtraordinaryDialog`, `<script src="./solicitudes_batch_execution.js...">` y bumps de versión de `solicitudes.js`/`cash_flow_extension.js`/`fase2_*` — pertenecen a cortes semanales (022/028), multi-approver (018/019) y extraordinarias (036–040).
- `pagos_comprobaciones.html`: en dev el mismo hunk de footer añade también esta línea, que NO se aplicó por ser de Fase 2 (migración 00403, fuera del paquete):
  ```diff
  +  <script src="./fase2_request_payment_method_extension.js?v=20260702-fase2-closure"></script>
  ```
- `config.js`: entradas `provider-intakes` y `approval-batches` en `modules[]`, `INACTIVE`/`isInactive`/gate de perfil inactivo, eliminación del cache de nav en sessionStorage, `applyProviderCatalogRpcCompatibility()` y `applyPaymentRequestExecutionRpcCompatibility()` (dependen de RPCs de 033_separate_approval_material y 020/033, otros paquetes), `canTriageProviderIntakes`, bumps de `loadFluxExtensions`.

## 5. NO incluido (y razón)

- `scripts/qa/payment-batch-parser-core.test.mjs`, `scripts/qa/payment-batch-reconciliation-contract.test.mjs`, `scripts/qa/payment-batch-final-reconciliation-contract.test.mjs`, `scripts/qa/payment-batch-final-gaps-contract.test.mjs` — harness de QA, excluido por definición del slice.
- `docs/architecture/payment-batch-reconciliation.md`, `docs/ops/transfer-receipt-sysadmin-permission.md` — docs, excluidos.
- `vendor/pdf-lib*.min.js`, `vendor/pdfjs*.min.js` (PR #264) — superseded por las copias en raíz de PR #265 (el path `vendor/` no se publicaba en Vercel); ya no existen en dev.
- Referencia CDN a pdf-lib de PR #263 — superseded por vendorización (#264/#265).
- `supabase/migrations/00403_fase2_payment_method_closure.sql` — verificada: es de Fase 2, no del batch.
- Todo `ops/`, `.github/workflows/` — infra/operación, fuera del alcance del slice.
- PR #262 (hotfix approval-execution-layout) y PR #277 salvo la migración 038 — pertenecen a los paquetes de cortes semanales / extraordinarias.

## 6. Verificación ejecutada

- `node --check` OK en los 7 `.js` portados no minificados (incluye `config.js` y `nav_first_paint_bootstrap.js` ya con hunks).
- Auditoría de referencias locales (`src=`/`href=` relativos) en `comprobantes_batch.html`, `solicitudes.html` y `pagos_comprobaciones.html`: 0 referencias rotas (ux2_shared.css, ux2_nav_skeleton.css, components.js, upload_helper.js ya existen en main).
- Worker de pdfjs (`pdfjs-worker-3.11.174.min.js`) referenciado desde `comprobantes_batch.js` línea 22: presente.
- RPCs del front cubiertos por las migraciones portadas (ver §2).

No se aplicó ninguna migración a ninguna base de datos.
