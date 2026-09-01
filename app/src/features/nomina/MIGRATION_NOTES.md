# Migración: Nómina — rail de captura N2B/N3G (vanilla → React)

Portado 1:1 desde el **rail de captura**, no desde las 5 "páginas". El core vive
en `payroll_capture.js` (600 líneas) + el gate de presupuesto de
`budget_live_frontend_guards.js`. En el vanilla la captura se **inyecta dentro
del diálogo "Nueva solicitud" de `solicitudes.html`** cuando `requestType =
nomina` y el usuario es Finanzas. En React se reconstruye como página autónoma
(`/nomina`) con el mismo estado, contrato y máquina de estados.

## Ruta y montaje
- Default export: **`NominaPage`** en `NominaPage.tsx`.
- Ruta sugerida: `/nomina`. **El coordinador** cablea la ruta en `App.tsx` /
  `navModel.tsx` / `modules.tsx` y crea la migración del módulo. Esta tarea NO
  toca esos archivos.
- DEV-only, **exclusiva de Finanzas**. Si el usuario no tiene rol finance la
  página muestra un aviso y no carga datos (igual que `hasFinanceRole()` +
  `syncPayrollOptionVisibility()` que ocultan la opción `nomina` en el vanilla).

## Gate de rol (Finanzas)
- Se computa local desde `useAuth().roles` con `hasFinanceRole()` en `logic.ts`.
- `FINANCE_ROLES = ['finance','finanzas','treasury','tesoreria','administracion']`
  — idénticos al vanilla (`payroll_capture.js` y `budget_live_frontend_guards.js`).
- El backend re-verifica con `payroll_has_finance_pii_access()` en cada RPC; el
  gate cliente es sólo UX.

## Tablas / vistas leídas (directo, no RPC)
- `company_bank_accounts` — cuenta origen de Tesorería (`active=true`,
  `account_type='bank'`, `currency='MXN'`). Se enmascara siempre (últimos 4).
- `cost_centers` (activos) + `company_cost_centers` (mapeo empresa↔CC activo).
- `companies` — selector de empresa. **Nuevo respecto al vanilla**: en vanilla el
  `companyId` venía del `<select id="companyId">` del form de Solicitudes; como
  página autónoma se lee `companies` directo. Es la única lectura añadida.

## Los 8 RPCs del contrato (nombre + params, tal cual)
Verificados contra `supabase/migrations/*payroll*`:

1. `get_payroll_capture_sessions(p_session_id uuid default null)` → jsonb[] de
   sesiones (con `files[]`, `materialized_payment_request_id`, `version`, etc.).
   *(mig. n2b, override de campos en n3g).*
2. `save_payroll_capture_session_n3g(p_session_id, p_expected_version,
   p_company_id, p_company_bank_account_id, p_cost_center_id, p_payroll_subtype,
   p_period_start, p_period_end, p_concept, p_notes, p_expected_channels)`
   → `{ id, version, cost_center_id }`. *(mig. n3g).*
   ⚠️ El nombre real es **`_n3g`**, no `_n`. Ver "Discrepancias" abajo.
3. `reserve_payroll_capture_file(p_session_id, p_expected_version, p_kind,
   p_extension, p_mime_type, p_size_bytes, p_sha256, p_parser_version,
   p_parser_contract, p_record_count, p_total_amount_minor)`
   → `{ file_id, storage_bucket, storage_path }`. *(mig. n2b; override en n3f).*
4. `confirm_payroll_capture_file(p_file_id, p_sha256)`
   → `{ session_id, capture_state, validation_status, version }`. *(mig. n2b).*
5. `get_payroll_submission_summary(p_payment_request_id)` → jsonb con
   `amount_requested`, `employee_net`, `channels[]`, `status`, y (por N5A) los
   campos `budget_*` + `budget_ready`. *(mig. n3g, override en n5a).*
6. `list_payment_request_approver_options(p_company_id, p_cost_center_id,
   p_amount)` → candidatos de aprobador. **Compartida con Solicitudes** (misma
   firma que `app/src/features/solicitudes/api.ts`). No es RPC de payroll: vive
   en el baseline.
7. `acknowledge_payroll_toka_funding_variance(p_payment_request_id, p_note)`
   → `{ status }`. Reconoce la diferencia de fondeo TOKA. *(mig. n3f).*
8. `submit_payroll_for_approval(p_payment_request_id, p_approver_id,
   p_approver_assignment_id default null)` → `{ status, ... }`. *(mig. n3b).*

Cada RPC está en `api.ts`, una función por RPC, sin renombrar params.

## Materialización — Edge Function (NO es RPC)
`materializeCapture()` invoca **`supabase.functions.invoke('payroll-materialize')`**
con `{ capture_session_id, expected_version, idempotency_key }` (idempotency
`payroll-n3g:<id>:v<version>`), idéntico al vanilla. El servidor re-descarga y
re-interpreta los bytes y materializa la `payment_request` en `draft`. **Es parte
inseparable del rail** (sin ella no hay resumen ni submit), por eso se incluye;
no está entre los 8 RPCs. Flux **no ejecuta pagos**: sólo valida y crea la
corrida.

## Flujo de archivos en DOS FASES
`reserve → storage.upload → confirm` (igual que la evidencia SHA de Solicitudes):
1. `reserve_payroll_capture_file(...)` devuelve `storage_path` (**la ruta la fija
   el backend**, no se inventa).
2. `supabase.storage.from('payroll-private').upload(storage_path, file, ...)`.
3. `confirm_payroll_capture_file(file_id, sha256)` → nueva `version`.
- **Bucket: `payroll-private`** (confirmado en `reserve_payroll_capture_file`
  → `'storage_bucket':'payroll-private'` y en `payroll_capture.js`
  `const BUCKET='payroll-private'`). **NO** es `payment-receipts` (ese es el de
  proveedores/efectivo). Ver "Discrepancias".
- La subida es secuencial por archivo; la `version` se hila entre reserve/confirm
  y se marca cada slot como subido conforme progresa, para que un reintento tras
  fallo parcial use la versión correcta (fidelidad con la mutación por-archivo de
  `uploadReservedFile`).
- Inspección local previa (`inspectFile` en `logic.ts`): valida
  extensión/MIME/tamaño/firma (ZIP para xlsx, sin NUL para txt, `<` para xml),
  calcula SHA-256, y **para SPEI** corre el parser certificado
  (`speiParser.ts`); para **TOKA fondeo** valida que el registro único codifique
  la cuenta origen seleccionada. Sólo el SPEI envía `parser_version /
  parser_contract / record_count / total_amount_minor`; el resto va `null` (el
  backend rechaza metadata de parser para kinds no certificados).

## Slots del paquete físico y canales
Canales: **TOKA/vales, SPEI, BBVA mismo banco** (`banco | spei | vales`).
Slots requeridos por canal (`requiredSlots`):
- Siempre: `caratula` (XLSX).
- `banco` → `layout_mismo_banco` (TXT Nómina 108).
- `spei` → `layout_spei` (TXT 128 bytes + CRLF, parser certificado).
- `vales` → `layout_toka` (TXT fondeo agregado) **y** `cfdi_vales` (CFDI 4.0 +
  complemento valesdedespensa). Incluye el **ack de varianza de fondeo TOKA**
  (`acknowledge_payroll_toka_funding_variance`) cuando `funding_variance ≠ 0`.
- Locks de integridad portados: no se puede retirar un canal con evidencia
  subida; empresa y cuenta origen quedan fijas tras subir evidencia (la cuenta,
  tras subir un layout que la codifica).

## Estados y freezes
- `capture_state`: draft / files_pending / validation_pending /
  ready_for_submission / materialized (`captureStateLabel`).
- **Freeze de materialización**: si `capture_state='materialized'` todo el form
  queda de sólo lectura (`locked`) y los archivos se muestran "verificado en
  servidor" (backend: `payroll_capture_materialized_locked`).
- **Submission**: `status='draft'` → puede reconocer varianza / configurar
  presupuesto / seleccionar aprobador / enviar. Tras `submit` → `submitted`.

## Gate de presupuesto (budget_live_frontend_guards.js, plegado)
Comportamiento replicado dentro del resumen de submission:
- Lee `budget_ready` / `budget_decision` / `budget_block_reason` /
  `budget_available_after` / `budget_month` del summary (extensión N5A).
- Si `status='draft'` y `!budget_ready`: **bloquea "Enviar a aprobación"** y
  muestra panel "Presupuesto pendiente/bloqueado". Si `budget_ready`: panel verde
  "Presupuesto listo". El botón submit vuelve a chequear el gate antes de llamar
  al RPC (equivalente a `guardApprovalClick`).
- El enlace "Configurar presupuesto" apunta a la página **vanilla**
  `/nomina_presupuesto.html?request_id=...` (ver diferidos). No se portó el
  loader dinámico de `budget_live_frontend_guards_base.js` /
  `payroll_company_scope_fix.js` / `payroll_shadow_ux_polish.js`: son parches
  runtime del vanilla, no lógica del rail.

## Qué de los 4 `nomina_*.html` incluí vs diferí
Los 4 son **shells de ops post-materialización separados del rail de captura**,
cada uno con su propio script y RPCs distintos a los 8 del contrato. **Diferidos**
(no forman parte de la captura; se dejan como páginas vanilla vivas del strangler):
- `nomina_presupuesto.html` (N5A, 31 líneas de shell + `payroll_budget_gate.js`):
  cola de nóminas materializadas + asignación de mes/partida y validación de
  disponibilidad. RPCs propios: `set_payroll_budget_context`,
  `refresh_payroll_budget_validation`, `get_payroll_budget_context_options`,
  `get_payroll_budget_queue`. El rail sólo **enlaza** aquí desde el gate.
- `nomina_dispersion.html` (N4A): registro manual de dispersión por canal.
- `nomina_reconciliacion.html` (N4B): comprobantes PDF + conciliación por canal.
- `nomina_qa.html` (N3E): visor QA.
Incluí del rail: metadata + canales + paquete físico (2 fases) + validación
server-side (materialize) + resumen de submission + ack varianza TOKA + gate de
presupuesto + envío a aprobación. Es el equivalente exacto de lo que
`payroll_capture.js` inyectaba en Solicitudes.

## Archivos
- `types.ts` — tipos del contrato (sesión, archivo, summary, canal, aprobador).
- `logic.ts` — puro: slots, canales, `requiredSlots`, `validateMetadata`,
  `inspectFile`, labels, `formatMoney`, mapa de errores (`friendlyError`), gate
  de rol, bucket.
- `speiParser.ts` — parser SPEI certificado portado 1:1 de `payroll_parser.js`
  (`parsePayrollSpeiTxt`, `summarizePayrollSpeiForCapture` + helpers puros).
- `api.ts` — los 8 RPCs + subida 2 fases + Edge `payroll-materialize` + lecturas.
- `NominaPage.tsx` — default export: gate de rol + tablero de capturas + botón
  "Nueva captura".
- `CaptureModal.tsx` — el rail completo (form, canales, cards de archivo,
  validación, resumen, varianza, gate presupuesto, submit).
- `Nomina.module.css` — estilos portados de `payrollN3gStyles` + `payroll-n5b`.

## Discrepancias con el brief (contrato manda) y riesgos/gaps de paridad
1. **Nombre de RPC**: el brief lista `save_payroll_capture_session_n` pero el
   código y la migración `20260820022528_payroll_n3g_real_capture_ui_contract.sql`
   definen **`save_payroll_capture_session_n3g`**. Se usó el nombre real. (Existe
   también `save_payroll_capture_session` sin sufijo, que el `_n3g` invoca por
   dentro para añadir `cost_center_id`; NO es la que consume el cliente.)
2. **Bucket**: el brief sugería `payment-receipts`; el contrato real y el vanilla
   usan **`payroll-private`**. Se respetó `payroll-private` (el brief pedía
   confirmarlo en el código y no cambiarlo).
3. **Materialize es Edge Function**, no RPC — incluida por ser parte del rail;
   marcada como tal. Si el entorno no tiene desplegada `payroll-materialize`, el
   flujo se corta en "Validar y materializar" (mismo comportamiento que vanilla).
4. **Empresa activa**: el selector ya no consulta `companies`. Toma únicamente
   la membresía activa del shell React y queda bloqueado a esa empresa. Cuentas,
   centros y sesiones se reducen al mismo scope.
5. **Enlace a presupuesto** apunta a la página vanilla `/nomina_presupuesto.html`
   (ruta raíz, fuera de `/app`). Cuando N5A se migre a React, reapuntar.
6. **No portado (parches runtime del vanilla)**: `budget_live_frontend_guards_base.js`,
   `payroll_company_scope_fix.js`, `payroll_shadow_ux_polish.js`. Son UX/scope
   fixes sobre el DOM inyectado; el comportamiento efectivo del gate (bloqueo +
   panel) sí se replicó. La migración `payroll_active_company_scope` añade la
   defensa backend que faltaba: membresía activa en listado, creación, reserva,
   confirmación y acceso a Storage.
7. **Firma de `reserve_payroll_capture_file`**: params 100% verificados contra
   migración (11 params, orden exacto). El SPEI es el único kind que envía
   metadata de parser; confirmado contra el `case p_kind` de la migración n3f.
8. **`list_payment_request_approver_options`**: forma del candidato
   (`profile_id`, `assignment_id`, `option_label`...) tomada del tipo ya validado
   en Solicitudes; si el backend agrega campos no rompe (se ignoran).
