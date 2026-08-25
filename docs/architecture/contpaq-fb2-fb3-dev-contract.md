# CONTPAQ FB-2 / FB-3 — contrato de integración DEV

Estado: diseño DEV-first. No habilita exportación CONTPAQ ni toca PROD.

## Objetivo

Integrar la captura de hechos fiscales CFDI (FB-2) y completar mappings contables ya resueltos (FB-3) sobre el flujo actual de Solicitudes, sin duplicar el parser certificado de Feeder-A ni inventar reglas contables pendientes.

## Límites

- FB-7 (export final) permanece bloqueado mientras Tax Resolver/retenciones o cualquier mapping obligatorio esté pendiente.
- No cambiar la semántica del flujo de aprobación/pago existente.
- No reemplazar `payment_requests.invoice_storage_path` en esta rebanada; se mantiene compatibilidad con el archivo actual.
- No reutilizar `payment_documents` / `payment_document_extractions` para CFDI: esas tablas están acopladas a lotes/comprobantes bancarios (`batch_id`, `page_number`, campos BBVA).
- No guardar XML completo en tablas; el original permanece en Supabase Storage.

## FB-2 — contrato del parser

Flux debe consumir el parser CFDI 4.0 ya certificado en Feeder-A mediante una API browser-ready, determinista y sin red/IA.

Interfaz esperada:

```js
parseCfdiXml(input) -> {
  version,
  uuid,
  fecha,
  moneda,
  tipoCambio,
  subtotal,
  descuento,
  total,
  emisor: { rfc, nombre, regimenFiscal },
  receptor: { rfc, nombre, regimenFiscal, usoCfdi },
  conceptos: [...],
  traslados: [...],
  retenciones: [...],
  impuestos: {...}
}
```

El parser extrae hechos. No resuelve cuentas CONTPAQ, no decide retenciones y no genera póliza.

Formato no soportado / archivo no CFDI: resultado controlado o error tipado según el contrato Feeder-A. CFDI reconocido pero inválido: error tipado y mensaje accionable.

## FB-2 — persistencia propuesta

Crear una entidad fiscal específica de solicitud, separada de las extracciones bancarias. Nombre sugerido: `payment_request_cfdi_facts`.

Campos mínimos:

- `id uuid`
- `payment_request_id uuid`
- `company_id uuid`
- `storage_path text`
- `source_sha256 text`
- `parser_version text`
- `parse_status text` (`parsed`, `review_required`, `invalid`)
- `cfdi_version text`
- `cfdi_uuid text`
- `issued_at timestamptz`
- `currency text`
- `exchange_rate numeric`
- `subtotal numeric`
- `discount numeric`
- `total numeric`
- `emitter_rfc text`
- `emitter_name text`
- `emitter_tax_regime text`
- `receiver_rfc text`
- `receiver_name text`
- `receiver_tax_regime text`
- `receiver_cfdi_use text`
- `concepts jsonb`
- `transferred_taxes jsonb`
- `withheld_taxes jsonb`
- `normalized_facts jsonb`
- auditoría (`created_at`, `updated_at`, `created_by`)

Restricciones:

- única por `(payment_request_id, source_sha256)` para idempotencia de ingestión;
- `cfdi_uuid` único por compañía cuando no sea nulo, sujeto a validar la semántica final de sustituciones/cancelaciones;
- RLS por membresía activa de `company_id` y rol autorizado; no usar `TO authenticated` como autorización suficiente;
- ningún campo de cuenta contable en esta tabla.

## Compatibilidad con archivos actuales

El flujo actual ya acepta XML en `upload_helper.js` y guarda el path en `payment_requests.invoice_storage_path`. FB-2 debe engancharse después de una carga XML exitosa y parsear el mismo archivo, sin crear un segundo uploader.

La necesidad futura de soportar PDF + XML simultáneos se resolverá en una rebanada documental aparte; no se fuerza dentro de FB-2 para evitar romper el contrato singular actual.

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
2. XML subido en Solicitudes genera hechos fiscales deterministas e idempotentes;
3. archivo no XML no dispara parser;
4. XML inválido no rompe la creación de la solicitud y queda revisión/error controlado;
5. RLS y aislamiento por compañía pasan negativos;
6. no existe lógica de Tax Resolver ni exportación en esta rebanada.

FB-3 puede considerarse listo para UAT cuando:

1. mappings resueltos están cargables/configurables sin duplicar fuentes;
2. Fersana respeta árbol explícito;
3. TOKA/banco pasan contra casos reales documentados y los faltantes bancarios quedan pendientes, no inferidos;
4. proveedor→cuenta no confirmado permanece `needs_review`;
5. identidad CONTPAQ de proveedor no reemplaza `proveedores`/`providers`;
6. no se habilita FB-7.

## Producción

`NO_PROD_CHANGES / NO_FB7_EXPORT / DEV_ONLY`
