# Migración: Layouts de pago (vanilla → React)

Sección **layouts** (`layouts.html` + `layouts.js` + extensiones runtime) portada a
`app/src/features/layouts/`. Componente default-export: **`LayoutsPage`** en `LayoutsPage.tsx`.
Ruta destino: **`/layouts`** (App.tsx hoy la mapea a `SectionPending`; el cableado de la
ruta lo hace otro paso del strangler — no se edita App.tsx).

## Fuentes portadas y extensiones "runtime" plegadas

`layouts.html` carga (directo + vía `config.js loadFluxExtensions`) estos scripts. Todos
se analizaron y su comportamiento efectivo se fusionó:

| Script | Efecto sobre layouts | Estado en React |
|---|---|---|
| `layouts.js` | Lógica base (tabla, líneas, generación BBVA, modales) | Portado |
| `layouts_result_extension.js` | **Handler de submit en fase de CAPTURA** con `stopImmediatePropagation()` → **sobreescribe** `submitNewLayout` de layouts.js. Cambia el flujo de creación al panel de resultado. | Portado como el flujo de creación efectivo (`NewLayoutModal` + `LayoutResultPanel`) |
| `layouts_ux2_extension.js` | Reestructura columnas de la tabla principal + reetiqueta headers + traduce badge "Draft"→"Borrador" + nota bajo el toolbar | Plegado en el render de `LayoutsPage` (tabla final) y `logic.layoutStatusBadge` |
| `fase2_request_payment_method_extension.js` | En layouts sólo `addLayoutTransferNotice`, que escribe en `#layoutInvalidBox`. **Efectivamente inerte**: `resetNewLayoutForm` limpia esa caja al abrir el modal (y el guard `dataset` impide re-inyectar). | No reproducido (documentado) |
| `cash_flow_extension.js` | `init()` sólo actúa en `solicitudes.html`/`efectivo.html`; **no hace nada** en layouts | N/A |

### Detalle crítico: quién gana el submit de "Crear layout"
En el mismo `<form id="newLayoutForm">` hay dos listeners:
- `layouts.js` → `submitNewLayout` (fase de burbuja).
- `layouts_result_extension.js` → `submitNewLayoutWithResult` (fase de **captura** + `stopImmediatePropagation`).

La captura corre antes que la burbuja en el mismo elemento, y `stopImmediatePropagation`
impide que la burbuja se ejecute. **Por lo tanto el flujo real de creación es el de
`layouts_result_extension.js`**, y todo el aparato de `submitNewLayout` (auto-descarga al
crear, `activeCreatedLayout`, `renderCreatedLayoutResult`, `singleReadyCreatedLayoutFormat`,
sección `#layoutCreatedResult`) es **código muerto** en producción. La migración reproduce
el flujo efectivo: crear → panel de resultado (métricas + solicitudes fuera + "aprobadas no
consideradas") **sin** auto-descarga. La descarga se hace después desde la tabla.

Se portaron igualmente los generadores (`buildBbvaLayoutFiles`, `singleReadyCreatedLayoutFormat`
no se usa) porque los botones de descarga por-formato de la tabla sí los ejercen.

## Rutas / deep-links
- La página **no** lee query params propios al cargar (el vanilla tampoco).
- Acciones del preview navegan a otras secciones (nombres de params idénticos al vanilla):
  - "Abrir solicitud" → `/solicitudes?request_id=<id>`
  - "Ir al corte" / "Abrir corte" → `/aprobaciones?batch_id=<id>` (el vanilla iba a
    `approval_batches.html?batch_id=`; no existe ruta SPA distinta para cortes, se mapea a aprobaciones).
  - "Completar proveedor" → `/proveedores?provider_id=<id>&return_to=layouts`
- El panel de resultado también enlaza solicitudes por `/solicitudes?request_id=`.

## Tablas (Supabase)
- `payment_layouts` (SELECT tabla principal; UPDATE `file_name`,`status`,`updated_at` tras descargar)
- `payment_layout_lines` (SELECT líneas + issues PAGOSINT)
- `companies` (catálogo, `active=true`)
- `company_bank_accounts` (catálogo cuentas origen, `active=true`)
- `payment_requests`, `payment_layouts`, `payment_layout_lines` (diagnóstico "aprobadas no consideradas")
- Bucket de storage para comprobantes: `payment-receipts` (no se usa en esta pantalla; los
  comprobantes de confirmación se referencian por ruta de texto, no se sube archivo aquí).

## RPCs (nombre + params)
- `preview_payment_layout_eligibility(p_period_start, p_period_end, p_company_id, p_company_bank_account_id)`
- `create_payment_layout(p_period_start, p_period_end, p_generated_by, p_name, p_company_id, p_company_bank_account_id)`
- `complete_provider_payment_execution_data(p_proveedor_id, p_destination_type, p_clabe, p_cuenta_bancaria, p_convenio_number, p_beneficiary_name, p_banco)`
- `complete_payment_request_layout_data(p_payment_request_id, p_company_bank_account_id, p_payment_reference, p_payment_concept, p_scheduled_payment_date)`
- `list_finance_approval_batches(p_status)` — se filtra a `draft` y por `company_id`
- `release_and_rebatch_rejected_request(p_rejected_item_id, p_correction_note, p_target_batch_id)`
- `mark_payment_layout_uploaded(p_layout_id, p_actor_profile_id, p_comments=null)`
- `confirm_payment_layout(p_layout_id, p_payment_date, p_bank_reference, p_storage_path, p_registered_by)`
- `update_payment_layout_line_pagosint_reference(p_line_id, p_payment_reference, p_beneficiary_name, p_payment_concept)`
- `reject_payment_layout_line(p_line_id, p_reason, p_actor_profile_id)`

`p_generated_by` / `p_*_profile_id` / `p_registered_by` = `useAuth().profile.id` (perfil ya
resuelto por `lib/auth`, equivalente a `resolveProfileId` del vanilla).

## Formatos de layout bancario (generación en `logic.ts`) — fidelidad carácter a carácter

Salida financiera. Cada archivo termina con CRLF final; separador de línea `\r\n`. MIME
`text/plain;charset=utf-8`, extensión `.txt`. Descarga = Blob + `<a download>` + `URL.createObjectURL`
(idéntico a `downloadTextFile` del vanilla, en `api.ts`).

Nombre de archivo: `PREFIX_FLUX_<FOLIO>_<YYYYMMDD>.txt`, PREFIX = `PAGOSBBV` | `PAGOSINT` | `PAGOSCIE`.

Detección de formato por `destination_type` normalizado:
- `cuenta|cuenta_bancaria|cuenta_bbva|mismo_banco|bbva` → **PAGOSBBV** (same_bank)
- `clabe|interbancario|transferencia_interbancaria|tarjeta|tdc` → **PAGOSINT** (interbank)
- `convenio` → **CIE**
- otro → lanza (No soportado)

### 1) PAGOSBBV (mismo banco) — longitud de línea **85** — confianza ALTA
Orden de campos (concatenados, sin separador):
| # | Campo | Ancho | Relleno |
|---|---|---|---|
| 1 | Cuenta destino (dígitos) | 18 | ceros a la izq (`padStart 0`) |
| 2 | Cuenta origen (dígitos) | 18 | ceros a la izq |
| 3 | Moneda `MXP` | 3 | fijo |
| 4 | Importe `n.nn` | 16 | ceros a la izq (máscara `0000000000000.00`) |
| 5 | Concepto (ASCII BBVA A-Z0-9 .,&/-) | 30 | espacios a la der (`padEnd " "`), truncado a 30 |
Patrón: `^\d{18}\d{18}MXP\d{13}\.\d{2}[A-Z0-9 .,&/-]{30}$`

### 2) PAGOSINT (interbancario) — longitud de línea **128** — confianza ALTA
| # | Campo | Ancho | Relleno |
|---|---|---|---|
| 1 | Cuenta destino | 18 | ceros izq |
| 2 | Cuenta origen | 18 | ceros izq |
| 3 | Moneda `MXP` | 3 | fijo |
| 4 | Importe | 16 | ceros izq |
| 5 | Titular/beneficiario (ASCII BBVA) | 30 | espacios der, trunc 30 |
| 6 | Referencia numérica | 5 | ceros izq (input 1–5 dígitos) |
| 7 | Motivo (ASCII BBVA) | 37 | espacios der, trunc 37 |
| 8 | Indicador `H` | 1 | fijo |
Patrón: `^\d{18}\d{18}MXP\d{13}\.\d{2}[A-Z0-9 .,&/-]{30}\d{5}[A-Z0-9 .,&/-]{37}H$`

### 3) CIE (convenio) — longitud de línea **121** — confianza MEDIA-ALTA (ver nota)
| # | Campo | Ancho | Relleno / regla |
|---|---|---|---|
| 1 | Concepto | 30 | ASCII imprimible `\x20-\x7e`, mayúsculas, espacios der; **se reutiliza en el campo 5** |
| 2 | Convenio | 7 | 6–7 dígitos → ceros izq |
| 3 | Cuenta origen | 18 | 9 o 10 dígitos → ceros izq (acepta ya-normalizada `0{8}\d{10}`) |
| 4 | Importe | 16 | `>0`, máscara `0000000000000.00`, ceros izq |
| 5 | Concepto (duplicado del #1) | 30 | idéntico al campo 1 |
| 6 | Referencia | 20 | ASCII imprimible, mayúsculas, espacios der, trunc 20 |
Patrón: `^[\x20-\x7e]{30}\d{7}\d{18}\d{13}\.\d{2}[\x20-\x7e]{30}[\x20-\x7e]{20}$`
- "Trash charset" CIE (26 caracteres acentuados/símbolos) se reemplaza 1:1 por
  `BBVA_CIE_REPLACEMENT_CHARACTERS` **antes** de validar ASCII (ver `replaceBbvaCieTrash`);
  se verificó que ambas cadenas miden 26.
- Se prohíbe el carácter `|` en cualquier registro.
- **Confianza:** la lógica se portó campo a campo idéntica al vanilla (mismos anchos,
  offsets de parseo 0/30/37/55/71/101/121, mismas validaciones y mensajes). La incertidumbre
  no es de la migración sino del propio contrato CIE del vanilla (concepto duplicado en dos
  posiciones); se replicó tal cual sin "corregir".

Validación de contenido (`validateBbvaContent`): sin BOM, sin línea vacía inicial/final, CRLF
final obligatorio, sin doble CRLF final, sin `|`, sin caracteres invisibles/control
(rango ` --  -‏  ﻿`),
longitud exacta por línea y patrón por línea. Diagnóstico enmascarado (`maskBbvaLine`) va a
`console.info/console.warn` igual que el vanilla (acción "Validar layout").

## Descargas / acciones de tabla
- "Ver lineas" → modal de líneas.
- "Validar layout" (no cancelados) → valida + diagnóstico consola + toast.
- "Completar referencias" (si hay pendientes PAGOSINT) → abre modal de líneas.
- Botones por formato (draft|generated): "▾ Pagos BBVA", "▾ Pagos Inter"/"Completar PAGOSINT",
  "▾ Descargar CIE"/"Revisar CIE (n)"; o fallback "Generar/Descargar layout de pagos" cuando no
  hay resumen. Tras descargar: UPDATE `file_name` (merge por formato / join `" + "` en el CxC total) + `status='generated'`.
- "Marcar subido" (generated) → confirmación → `mark_payment_layout_uploaded`.
- "Confirmar pago" (generated|uploaded) → modal → `confirm_payment_layout`.

## Gates de rol
- Sección layouts = `[SYSADMIN, ADMIN, DIRECTION]` (config.js NAV_ITEMS). Igual que
  `proveedores`/`efectivo`, la página **no** se auto-bloquea por rol: el gate es a nivel de
  navegación/ruteo (patrón establecido). El único guard in-page es `ensureProfile()` (perfil
  identificado) antes de acciones que registran actor, espejo de `ensureActorProfile()`.

## Diferencias menores conocidas / riesgos de paridad
- **Toast variantes:** el vanilla usa `"danger"`; el `useToast` de React expone
  `success|error|warning|info`. Se mapeó `danger → error` (mismo tono visual assertive).
- **`formatDate`:** el vanilla de layouts devuelve `"-"` para vacíos (no `"Sin fecha"` como
  `lib/format`). Se añadió un `formatDate` local fiel en `logic.ts` para tabla y preview.
- **Nota "solo transferencias" (fase2):** no se reproduce porque en el vanilla queda inerte
  (se limpia al abrir el modal). Si se desea mostrarla, iría en el cuerpo del modal nuevo.
- **Texto del botón de crear:** dice "Crear y descargar layout con N pagos" (texto del gating
  de layouts.js) aunque el flujo efectivo (result_extension) **no** auto-descarga. Se conservó
  el texto real shipeado.
- **Re-submit tras crear:** el botón vuelve a habilitarse como "Crear layout" tras crear
  (setButton del result_extension); volver a pulsarlo crea otro layout. Comportamiento fiel al
  shipeado (posible footgun del vanilla, no "corregido").
- **Ruta de cortes:** `approval_batches.html` no tiene ruta SPA propia; los deep-links de corte
  se dirigen a `/aprobaciones` conservando `?batch_id=`.
- **`company_bank_accounts.account_number`:** las opciones de cuenta origen se filtran a las que
  tienen `account_number` (igual que el vanilla); el completado además exige `^[0-9]{1,18}$`.
