import { parseCfdiXml, CfdiParseError } from '../parsers/cfdiBrowser.js'
import { validateCfdiAgainstRequest } from './cfdiValidation.js'

export const CFDI_PARSER_VERSION = 'cfdi-browser-6605c95'
export const CFDI_VERIFICATION_STATUS = 'client_unverified'

function isXmlFile(file) {
  if (!file) return false
  const type = String(file.type || '').toLowerCase()
  const name = String(file.name || '').toLowerCase()
  return type === 'text/xml' || type === 'application/xml' || name.endsWith('.xml')
}

async function sha256Hex(file) {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function loadRequestContext(client, paymentRequestId) {
  const { data: request, error: requestError } = await client
    .from('payment_requests')
    .select('id,company_id,proveedor_id,currency,amount_requested')
    .eq('id', paymentRequestId)
    .single()
  if (requestError || !request) throw new Error(`cfdi_request_context_failed:${requestError?.message || 'not_found'}`)

  const [companyResult, providerResult] = await Promise.all([
    request.company_id
      ? client.from('companies').select('id,rfc').eq('id', request.company_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    request.proveedor_id
      ? client.from('proveedores').select('id,rfc').eq('id', request.proveedor_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (companyResult.error) throw new Error(`cfdi_company_context_failed:${companyResult.error.message}`)
  if (providerResult.error) throw new Error(`cfdi_provider_context_failed:${providerResult.error.message}`)

  return {
    request,
    validationContext: {
      companyRfc: companyResult.data?.rfc || null,
      providerRfc: providerResult.data?.rfc || null,
      currency: request.currency,
      amountRequested: request.amount_requested,
    },
  }
}

function persistenceRow({ paymentRequestId, companyId, storagePath, sourceSha256, createdBy, parsed, validation, parseError }) {
  const comprobante = parsed?.comprobante || {}
  return {
    payment_request_id: paymentRequestId,
    company_id: companyId,
    storage_path: storagePath,
    source_sha256: sourceSha256,
    parser_version: CFDI_PARSER_VERSION,
    parse_status: parseError ? 'invalid' : validation?.status || 'review_required',
    verification_status: CFDI_VERIFICATION_STATUS,
    cfdi_version: parsed?.version || null,
    cfdi_uuid: parsed?.uuid || null,
    issued_at: comprobante.fecha || null,
    currency: comprobante.moneda || null,
    subtotal: comprobante.subTotal ?? null,
    total: comprobante.total ?? null,
    emitter_rfc: parsed?.emisor?.rfc || null,
    receiver_rfc: parsed?.receptor?.rfc || null,
    normalized_facts: parsed || {},
    validation_result: validation || {},
    parse_error: parseError || null,
    created_by: createdBy || null,
  }
}

async function insertFacts(client, row) {
  const { data, error } = await client
    .from('payment_request_cfdi_facts')
    .insert(row)
    .select('id,parse_status,verification_status,cfdi_uuid,source_sha256')
    .single()

  if (!error) return { inserted: true, data }
  if (error.code === '23505') {
    const { data: existing, error: existingError } = await client
      .from('payment_request_cfdi_facts')
      .select('id,parse_status,verification_status,cfdi_uuid,source_sha256')
      .eq('payment_request_id', row.payment_request_id)
      .eq('source_sha256', row.source_sha256)
      .maybeSingle()
    if (existingError) throw existingError
    return { inserted: false, duplicate: true, data: existing }
  }
  throw error
}

export async function ingestRequestCfdi({ file, paymentRequestId, storagePath, client, createdBy = null }) {
  if (!isXmlFile(file)) return { skipped: true, reason: 'not_xml' }
  if (!paymentRequestId || !storagePath || !client) throw new Error('cfdi_ingestion_missing_context')

  const [{ request, validationContext }, sourceSha256, xml] = await Promise.all([
    loadRequestContext(client, paymentRequestId),
    sha256Hex(file),
    file.text(),
  ])

  let parsed = null
  let validation = null
  let parseError = null

  try {
    parsed = parseCfdiXml(xml)
    validation = validateCfdiAgainstRequest(parsed, validationContext)
  } catch (error) {
    if (error instanceof CfdiParseError) parseError = error.message
    else throw error
  }

  const row = persistenceRow({
    paymentRequestId,
    companyId: request.company_id,
    storagePath,
    sourceSha256,
    createdBy,
    parsed,
    validation,
    parseError,
  })

  const persisted = await insertFacts(client, row)
  return {
    skipped: false,
    sourceSha256,
    verificationStatus: CFDI_VERIFICATION_STATUS,
    parsed,
    validation,
    parseError,
    persisted,
  }
}

export const internals = Object.freeze({ isXmlFile, persistenceRow })
