# CONTPAQ FB-2 / FB-3 — contrato de integración DEV

Estado: DEV-first. No habilita exportación CONTPAQ ni toca PROD.

## Objetivo

Integrar la captura de hechos fiscales CFDI (FB-2) y completar mappings contables ya resueltos (FB-3) sobre el flujo actual de Solicitudes, sin duplicar el parser certificado de Feeder-A ni inventar reglas contables pendientes.

## Límites

- FB-7 (export final) permanece bloqueado mientras Tax Resolver/retenciones o cualquier mapping obligatorio esté pendiente.
- No cambiar la semántica del flujo de aprobación/pago existente.
- No reemplazar `payment_requests.invoice_storage_path` en esta rebanada; se mantiene compatibilidad con el archivo actual.
- No reutilizar `payment_documents` / `payment_document_extractions` para CFDI: esas tablas están acopladas a lotes/comprobantes bancarios (`batch_id`, `page_number`, campos BBVA).
- No guardar XML completo en tablas; el original permanece en Supabase Storage.
- El parseo browser es **preview**, no evidencia contable autoritativa.

## FB-2 — parser certificado recibido

Handoff recibido en PR #422, commit `53eaa4a`.

Origen declarado por Carlos:

- `carlosquantta/flux-contpaq-export`
- rama `feat/motor-agregacion`
- core origen `6605c95`
- suite del módulo: `104/104`
- equivalencia navegador vs Node declarada: 3/3 fixtures sintéticos byte-a-byte.

La app Flux no tiene bundler. Por ello no puede importar directamente la entrada Node que usa `fast-xml-parser`. El handoff separa:

- `lib/parsers/cfdiCore.js`: regla fiscal, cero imports;
- `lib/parsers/cfdiBrowser.js`: `DOMParser` nativo → mismo contrato de árbol → mismo core.

La entrada browser detecta explícitamente `<parsererror>` porque `DOMParser` no lanza ante XML mal formado.

Shape certificado consumido por Flux:

```js
parseCfdiXml(xml) -> {
  version,
  comprobante: {
    serie,
    folio,
    fecha,
    tipoDeComprobante,
    metodoPago,
    formaPago,
    moneda,
    tipoCambio,
    subTotal,
    total
  },
  emisor: { rfc, nombre, regimenFiscal },
  receptor: { rfc, nombre, usoCfdi },
  impuestos: {
    traslados: [...],
    retenciones: [...],
    totalTrasladados,
    totalRetenidos
  },
  uuid,
  cfdiRelacionados: [...],
  pagos,
  nomina
}
```

El parser extrae hechos. No resuelve cuentas CONTPAQ, no decide retenciones y no genera póliza.

Formato no soportado / archivo no CFDI / XML mal formado produce `CfdiParseError` controlado. Flux no modifica el core recibido para adaptarlo a la UI: el adapter consume su shape certificado.

## FB-2 — frontera de confianza

El parser corre en el navegador. Por diseño, un cliente autorizado podría alterar el JSON antes de enviarlo aunque el XML real permanezca en Storage.

Por ello:

- toda fila creada en esta fase lleva `verification_status = 'client_unverified'`;
- la tabla solo acepta ese estado;
- estos hechos sirven para precarga, comparación y revisión UX;
- **FB-7 y cualquier contabilidad futura no pueden tratarlos como autoritativos**;
- una fase posterior deberá revalidar server-side el XML original antes de promover evidencia contable.

## FB-2 — validación contra Solicitud

`lib/contpaq/cfdiValidation.js` compara únicamente hechos que Flux ya conoce:

- CFDI 4.0;
- UUID presente;
- RFC receptor vs RFC de empresa, cuando la empresa tenga RFC configurado;
- RFC emisor vs RFC de proveedor legacy, cuando exista;
- moneda;
- total con tolerancia de $0.01.

Mismatch conocido → `review_required`.

Dato de referencia faltante en Flux → warning, no bloqueo. Esto es necesario porque el DEV actual solo tiene RFC en 2/5 empresas activas y 5/44 proveedores legacy.

## FB-2 — integración con uploader actual

`upload_helper.js` sigue siendo el único uploader. Después de una carga exitosa:

- solo XML;
- solo carpeta `solicitudes/{payment_request_id}`;
- carga `lib/contpaq/cfdiIngestion.js` por `import()` dinámico;
- parsea y valida;
- persiste preview fiscal `client_unverified`;
- devuelve siempre el `storage_path` si la carga a Storage ya fue exitosa.

Por tanto, un error de parseo/ingestión **no revierte ni rompe la creación de la solicitud ni el vínculo del archivo**. Queda auditado como `invalid` o como análisis pendiente.

La necesidad futura de soportar PDF + XML simultáneos se resolverá en una rebanada documental aparte; no se fuerza dentro de FB-2 para evitar romper el contrato singular actual.

## FB-2 — persistencia versionada

Migración:

`20260826153000_payment_request_cfdi_facts.sql`

Entidad: `payment_request_cfdi_facts`.

Columnas estables extraídas para búsqueda/validación:

- `payment_request_id`
- `company_id`
- `storage_path`
- `source_sha256`
- `parser_version`
- `parse_status` (`parsed`, `review_required`, `invalid`)
- `verification_status = client_unverified`
- `cfdi_version`
- `cfdi_uuid`
- `issued_at timestamp without time zone` — CFDI `Fecha` no incluye zona horaria
- `currency`
- `subtotal`
- `total`
- `emitter_rfc`
- `receiver_rfc`
- `normalized_facts jsonb` — conserva el output completo certificado
- `validation_result jsonb`
- `parse_error`
- auditoría (`created_by`, `created_at`)

Restricciones:

- idempotencia única por `(payment_request_id, source_sha256)`;
- `storage_path` debe vivir bajo `solicitudes/{payment_request_id}/...`;
- `cfdi_uuid` queda indexado por compañía, **no hard-unique**, hasta definir formalmente duplicados/sustituciones/cancelaciones;
- evidencia cliente inmutable: `authenticated` recibe `SELECT, INSERT`, no `UPDATE/DELETE`;
- RLS habilitada y forzada;
- políticas heredan visibilidad/escritura de la solicitud padre y validan el mismo `company_id`;
- ningún campo de cuenta contable en esta tabla.

## FB-3 — mappings

Mantener como fuente canónica del mapper general:

- `contpaq_accounts`
- `budget_account_mappings`

Reglas/insumos ya resueltos:

- criterio bancario: el número real puede aparecer embebido en el nombre de la cuenta CONTPAQ y debe validarse contra la cuenta de origen de Flux; no se considera match universal hasta que exista `company_id`, identificador bancario suficiente y catálogo de esa empresa;
- Fersana: usar árbol explícito del catálogo/seed; nunca inferir padre por prefijo numérico;
- Flux Financiera: seed versionado disponible;
- TOKA diferencia en contra → `602-83-000-000`;
- TOKA diferencia a favor → `401-38-000-000`;
- IdProveedor: padrón CONTPAQ disponible por RFC, pero debe integrarse como identidad CONTPAQ por empresa, no reemplazar el catálogo de Flux.

Pendientes:

- proveedor → cuenta contable: candidato/`needs_review` hasta evidencia de pólizas o validación de Finanzas;
- Tax Resolver/retenciones: bloqueado por Denise; no hardcodear 213/216.

## Proveedores — coexistencia legacy/canónico

El DEV actual confirma que `payment_requests.proveedor_id` referencia `public.proveedores(id)` (catálogo legacy). No debe migrarse implícitamente a `public.providers` como parte de FB-3.

Inventario read-only observado al diseñar la rebanada:

- `proveedores` legacy: 44 filas; 5 con RFC;
- `providers` canónico: 1 fila; 1 con RFC;
- solapamiento por RFC entre ambos catálogos: 1.

Por tanto, el padrón CONTPAQ de terceros debe vivir en una capa separada por empresa, por ejemplo `contpaq_third_parties`, y enlazarse al `proveedor_id` legacy mediante un mapping auditable (`provider_contpaq_identity_mappings`). El match automático solo puede aceptarse con RFC normalizado exacto y unicidad; el resto queda `needs_review`.

Esta capa puede conservar `id_contpaq`, RFC, nombre y atributos fiscales de CONTPAQ sin contaminar ni reemplazar los catálogos operativos de Flux.

## Banco y Nómina

Evitar dos fuentes de verdad. Antes de crear un mapping bancario general, reconciliarlo con `payroll_contpaq_bank_mappings` del RC1. La recomendación es que un mapping genérico de `company_bank_accounts` sea la fuente común y que Nómina lo consuma cuando aplique, manteniendo roles específicos de Nómina solo para cuentas que realmente son exclusivas del flujo.

Inventario read-only del DEV al diseñar esta rebanada:

- 8 cuentas bancarias activas;
- 3 legacy sin `company_id`;
- 5 con `company_id`;
- en Operadora hay 3 cuentas activas y, contra el catálogo actualmente cargado, 1 tiene match único por número completo y 2 no tienen candidato; no hay ambiguas.

Consecuencia: no crear mappings automáticos por `last4` ni por nombre parcial. Solo exact-match con identificador suficiente; faltantes quedan pendientes de configuración/catálogo.

## Gates

FB-2 puede considerarse listo para UAT cuando:

1. parser certificado Feeder-A está versionado/consumible desde Flux;
2. contratos parser + validación + ingestión pasan CI;
3. migración `payment_request_cfdi_facts` aplica en DEV y RLS negativos pasan;
4. XML subido en Solicitudes genera preview fiscal determinista e idempotente;
5. archivo no XML no dispara parser;
6. XML inválido no rompe la creación de la solicitud y queda error controlado;
7. toda evidencia browser permanece `client_unverified`;
8. no existe lógica de Tax Resolver ni exportación en esta rebanada.

FB-3 puede considerarse listo para UAT cuando:

1. mappings resueltos están cargables/configurables sin duplicar fuentes;
2. Fersana respeta árbol explícito;
3. TOKA/banco pasan contra casos reales documentados y los faltantes bancarios quedan pendientes, no inferidos;
4. proveedor→cuenta no confirmado permanece `needs_review`;
5. identidad CONTPAQ de proveedor no reemplaza `proveedores`/`providers`;
6. no se habilita FB-7.

## Producción

`NO_PROD_CHANGES / NO_FB7_EXPORT / DEV_ONLY`
