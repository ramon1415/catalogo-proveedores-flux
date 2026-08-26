# Migración: Ingresos e Incidencias (vanilla → React)

Fuente vanilla: `ingresos.html` + `ingresos.js` (una sola pantalla con 6 sub-tabs internos).
Destino: `app/src/features/ingresos/`. Default export **`IngresosPage`** en `IngresosPage.tsx`.

## Rutas
El coordinador enruta AMBOS paths a `<IngresosPage/>`:
- `/ingresos` → tab interno inicial **Balance** (`dashboard`) = lado "income".
- `/incidencias` → tab interno inicial **Incidencias** (`incidents`).

Derivación del tab (dentro del componente):
```
routeTab = (location.pathname === '/incidencias' || searchParams.tab === 'incidents')
             ? 'incidents' : 'dashboard'
```
- `useLocation()` decide por path; `useSearchParams()` honra `?tab=income|incidents` si viene.
- `?tab=income` (o cualquier valor distinto de `incidents`) cae en `dashboard`.
- Un `useEffect([routeTab])` re-siembra el tab al cambiar la ruta; el usuario puede cambiar
  libremente entre los 6 tabs internos después (igual que el vanilla, que siempre mostraba los 6).

> Nota de paridad: el vanilla NUNCA leía `?tab` en `ingresos.js` (arrancaba siempre en `dashboard`);
> el `?tab` solo marcaba el ítem de nav. Aquí se usa para sembrar el tab inicial, según lo pedido.

## Tabs internos (idénticos al vanilla)
`dashboard` (Balance) · `members` (Socios) · `periods` (Periodos y cuotas) · `payments` (Cuotas) ·
`incidents` (Incidencias) · `invoices` (Facturas). Todos viven en `IngresosPage`.

## Tablas leídas (`loadIngresosData`, todas en paralelo — falla si cualquiera falla, como el vanilla)
- `members` (order full_name asc)
- `billing_periods` (order cutoff_date desc)
- `maintenance_fee_charges` (order created_at desc)
- `maintenance_fee_payments` (order created_at desc) — cargada por paridad de red; **no se renderiza**.
- `incident_charges` (order incident_date desc)
- `invoices` (order issue_date desc)
- `companies` (id,name,legal_name,active)
- `cost_centers` (id,name,code,company_id,active)
- `budget_categories` (id,code,name,category,budget_type,active)

## Escrituras directas a tabla
- `members` insert / update (payload con `updated_at`; update cuando se edita, insert si nuevo).
- `billing_periods` insert (`.select('id').single()` para el nuevo id; incluye `created_by`).
- `maintenance_fee_payments` update `receipt_storage_path` (vincular comprobante al pago creado).

## RPCs (nombre + params, sin cambios)
| RPC | Params |
|---|---|
| `generate_maintenance_fees_for_period` | `p_billing_period_id` → `{ charges_generated }` |
| `register_maintenance_fee_payment` | `p_charge_id, p_amount, p_payment_date, p_bank_reference, p_payment_method, p_registered_by, p_notes` → `{ payment_id\|id, message }` |
| `create_incident_charge` | `p_member_id, p_external_name, p_external_rfc, p_referred_by_member_id, p_company_id, p_cost_center_id, p_budget_category_id, p_description, p_amount, p_incident_date, p_registered_by, p_notes` → `{ message }` |
| `create_invoice_record` | `p_invoice_type, p_reference_id, p_fiscal_uuid, p_series_folio, p_amount, p_issue_date, p_storage_path_xml, p_storage_path_pdf` → `{ message }` |
| `mark_invoice_paid` | `p_invoice_id, p_payment_date, p_bank_reference, p_payment_method, p_registered_by, p_notes` → `{ message }` |

## Storage
Bucket `payment-receipts`. Path `<folder>/<Date.now()>_<rand>.<ext>` (rand = `Math.random().toString(36).slice(2,7)`), `upsert:false`, `contentType`.
- Cobro: folder `cobros/<chargeId>`; tras el RPC se sube y se hace update de `receipt_storage_path`
  en el pago; si el update falla, toast warning "Comprobante no vinculado" (no bloquea el cobro).
- Factura: folder `facturas/<type>/<referenceId>`; XML y PDF suben en paralelo (`uploadReceipt` devuelve null si no hay archivo).
- Validación de archivo (espejo de `upload_helper.js`): tipos `jpeg/png/webp/pdf/xml`, máx 10 MB; si inválido se descarta y se muestra hint en rojo.
- URL firmada TTL 3600 disponible en el helper (el vanilla la exponía; esta pantalla no la usa para render).

## Role gates
**Ninguno.** El vanilla no filtra por rol en esta pantalla. La única guarda es `profileOk()`
(existe `profile.id`), replicada como chequeo previo en los modales que envían `p_registered_by` /
`created_by`: **Periodo, Cobro, Incidencia, Marcar factura pagada**. `saveMember` y `saveInvoice`
NO exigen perfil (paridad exacta). Si falta perfil → toast "Perfil no identificado".

## Filtro rápido (stat cards)
Cada card es un botón (`applyCard`): cambia de tab + fija un select de estatus + setea `quick`.
`quick` además restringe el render (socios→solo activos, cobros→pendiente>0, incidencias→open/invoiced,
facturas→issued). Franja "Vista filtrada" con botón "Ver todo" (`clearQuick` resetea los 4 selects de
estatus a `todos` y limpia `quick`). La card seleccionada se resalta cuando `card === quick`.

## Errores
- `rpcError()`: mapa de ~24 códigos conocidos (billing_period_*, charge_*, invoice_*, etc.) → mensaje es-MX;
  fallback a `friendlyError()`.
- `friendlyError()`: RLS / 42501 / permission denied → "No tienes permiso para realizar esta accion."

## Riesgos de paridad / decisiones
1. **Fechas vacías**: el vanilla muestra `—`; `formatDate` compartido devuelve "Sin fecha". Se creó
   `dateCell()` local que preserva `—` (vacío e inválido) para no cambiar el contenido de las celdas.
2. **`maintenance_fee_payments`** se carga pero el vanilla no la renderiza; se mantiene la consulta.
3. **Estado de error de carga**: el vanilla dejaba los placeholders "Cargando..." tras un error y solo
   lanzaba toast. Aquí se muestra "No se pudo cargar." en las tablas + el mismo toast (mejor UX, mismo
   comportamiento de datos: no se rendel nada).
4. **Tab inicial por ruta**: divergencia intencional vs vanilla (siempre `dashboard`) para soportar el
   deep-link `/incidencias` pedido. Los 6 tabs siguen accesibles.
5. **`fee_factor`**: `formatFactor` con `maximumFractionDigits:3` (igual que `formatNum` del vanilla).
6. Puentes `window.*Modal` del vanilla (para el patch UX legacy) no se portan: eran acoplamiento DOM.
