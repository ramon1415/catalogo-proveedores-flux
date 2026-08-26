// FB-2 · Validación pura del CFDI ya parseado contra una solicitud Flux.
// No parsea XML, no resuelve cuentas CONTPAQ, no hace red y no exporta pólizas.

const DEFAULT_TOLERANCE = 0.01

export function normalizeRfc(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9Ñ&]/g, '')
}

export function normalizeCurrency(value) {
  return String(value ?? '').trim().toUpperCase()
}

export function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function nearlyEqual(a, b, tolerance = DEFAULT_TOLERANCE) {
  const left = numberOrNull(a)
  const right = numberOrNull(b)
  if (left === null || right === null) return null
  return Math.abs(left - right) <= Math.abs(Number(tolerance) || DEFAULT_TOLERANCE)
}

export function validateCfdiAgainstRequest(facts, context = {}, options = {}) {
  if (!facts || typeof facts !== 'object') {
    return {
      status: 'invalid',
      checks: [{ code: 'facts_missing', result: 'error' }],
      warnings: [],
      reviewReasons: ['facts_missing'],
    }
  }

  const checks = []
  const warnings = []
  const reviewReasons = []
  const tolerance = numberOrNull(options.amountTolerance) ?? DEFAULT_TOLERANCE
  const text = (value) => String(value ?? '').trim()

  const pass = (code, meta = {}) => checks.push({ code, result: 'pass', ...meta })
  const warn = (code, meta = {}) => {
    checks.push({ code, result: 'warning', ...meta })
    warnings.push(code)
  }
  const review = (code, meta = {}) => {
    checks.push({ code, result: 'review_required', ...meta })
    reviewReasons.push(code)
  }

  const version = text(facts.version || facts.cfdiVersion)
  if (!version) warn('cfdi_version_missing')
  else if (version !== '4.0') review('cfdi_version_not_4_0', { actual: version })
  else pass('cfdi_version_4_0')

  const uuid = text(facts.uuid || facts.cfdiUuid)
  if (!uuid) review('cfdi_uuid_missing')
  else pass('cfdi_uuid_present')

  const receiverRfc = normalizeRfc(facts.receptor?.rfc || facts.receiver?.rfc || facts.receiverRfc)
  const companyRfc = normalizeRfc(context.companyRfc)
  if (!companyRfc) warn('company_rfc_unavailable')
  else if (!receiverRfc) review('receiver_rfc_missing')
  else if (receiverRfc !== companyRfc) review('receiver_rfc_mismatch')
  else pass('receiver_rfc_matches_company')

  const emitterRfc = normalizeRfc(facts.emisor?.rfc || facts.emitter?.rfc || facts.emitterRfc)
  const providerRfc = normalizeRfc(context.providerRfc)
  if (!providerRfc) warn('provider_rfc_unavailable')
  else if (!emitterRfc) review('emitter_rfc_missing')
  else if (emitterRfc !== providerRfc) review('emitter_rfc_mismatch')
  else pass('emitter_rfc_matches_provider')

  // Shape certificado de Feeder-A: moneda/total viven en `comprobante`.
  const cfdiCurrency = normalizeCurrency(facts.comprobante?.moneda || facts.moneda || facts.currency)
  const requestCurrency = normalizeCurrency(context.currency)
  if (!requestCurrency) warn('request_currency_unavailable')
  else if (!cfdiCurrency) review('cfdi_currency_missing')
  else if (cfdiCurrency !== requestCurrency) review('currency_mismatch')
  else pass('currency_matches_request')

  const total = numberOrNull(facts.comprobante?.total ?? facts.total)
  const requestedAmount = numberOrNull(context.amountRequested)
  if (requestedAmount === null) warn('request_amount_unavailable')
  else if (total === null) review('cfdi_total_missing')
  else if (nearlyEqual(total, requestedAmount, tolerance)) pass('total_matches_request', { tolerance })
  else review('total_mismatch', { tolerance })

  return {
    status: reviewReasons.length ? 'review_required' : 'parsed',
    checks,
    warnings,
    reviewReasons,
  }
}
