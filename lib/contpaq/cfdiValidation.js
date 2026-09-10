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

export function resolveCfdiComparison(facts, context = {}) {
  const comprobante = facts?.comprobante || {}
  const tipo = String(comprobante.tipoDeComprobante || '').trim().toUpperCase()
  const requestCurrency = normalizeCurrency(context.currency)

  if (tipo === 'I' || tipo === 'E') {
    return {
      tipoDeComprobante: tipo,
      comparable: true,
      currency: normalizeCurrency(comprobante.moneda || facts?.moneda || facts?.currency),
      total: numberOrNull(comprobante.total ?? facts?.total),
      source: 'comprobante',
      warnings: [],
    }
  }

  if (tipo === 'P') {
    const pagos = Array.isArray(facts?.pagos) ? facts.pagos : []
    const currencies = [...new Set(
      pagos.map((pago) => normalizeCurrency(pago?.monedaP)).filter(Boolean),
    )]
    const amounts = pagos
      .map((pago) => numberOrNull(pago?.montoP))
      .filter((value) => value !== null)
    const sumPagos = amounts.length ? amounts.reduce((sum, value) => sum + value, 0) : null
    const montoTotalPagos = numberOrNull(facts?.pagosTotales?.montoTotalPagos)

    if (currencies.length === 1) {
      const currency = currencies[0]
      const total = currency === 'MXN' && montoTotalPagos !== null ? montoTotalPagos : sumPagos
      if (total === null) {
        return {
          tipoDeComprobante: tipo,
          comparable: false,
          currency,
          total: null,
          source: null,
          reason: 'cfdi_pago_effective_amount_missing',
          warnings: [],
        }
      }
      return {
        tipoDeComprobante: tipo,
        comparable: true,
        currency,
        total,
        source: currency === 'MXN' && montoTotalPagos !== null ? 'pagos_totales' : 'pagos_sum',
        warnings: [],
      }
    }

    if (currencies.length === 0 && montoTotalPagos !== null) {
      return {
        tipoDeComprobante: tipo,
        comparable: true,
        currency: 'MXN',
        total: montoTotalPagos,
        source: 'pagos_totales',
        warnings: ['cfdi_pago_moneda_p_missing_using_mxn_total'],
      }
    }

    if (currencies.length > 1 && requestCurrency === 'MXN' && montoTotalPagos !== null) {
      return {
        tipoDeComprobante: tipo,
        comparable: true,
        currency: 'MXN',
        total: montoTotalPagos,
        source: 'pagos_totales',
        warnings: ['cfdi_pago_multiple_currencies_mxn_total'],
      }
    }

    return {
      tipoDeComprobante: tipo,
      comparable: false,
      currency: null,
      total: null,
      source: null,
      reason: currencies.length > 1 ? 'cfdi_pago_currency_ambiguous' : 'cfdi_pago_effective_amount_missing',
      warnings: [],
    }
  }

  if (tipo === 'T' || tipo === 'N') {
    return {
      tipoDeComprobante: tipo,
      comparable: false,
      currency: null,
      total: null,
      source: null,
      reason: 'cfdi_tipo_no_comparable',
      warnings: [],
    }
  }

  return {
    tipoDeComprobante: tipo || null,
    comparable: false,
    currency: null,
    total: null,
    source: null,
    reason: tipo ? 'cfdi_tipo_no_comparable' : 'cfdi_tipo_missing',
    warnings: [],
  }
}

export function validateCfdiAgainstRequest(facts, context = {}, options = {}) {
  if (!facts || typeof facts !== 'object') {
    return {
      status: 'invalid',
      checks: [{ code: 'facts_missing', result: 'error' }],
      warnings: [],
      reviewReasons: ['facts_missing'],
      comparison: null,
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
    if (!warnings.includes(code)) warnings.push(code)
  }
  const review = (code, meta = {}) => {
    checks.push({ code, result: 'review_required', ...meta })
    if (!reviewReasons.includes(code)) reviewReasons.push(code)
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

  const comparison = resolveCfdiComparison(facts, context)
  for (const warning of comparison.warnings || []) warn(warning)

  if (!comparison.comparable) {
    review(comparison.reason || 'cfdi_tipo_no_comparable', {
      tipoDeComprobante: comparison.tipoDeComprobante,
    })
  } else {
    const requestCurrency = normalizeCurrency(context.currency)
    if (!requestCurrency) warn('request_currency_unavailable')
    else if (!comparison.currency) review('cfdi_currency_missing')
    else if (comparison.currency !== requestCurrency) {
      review('currency_mismatch', {
        actual: comparison.currency,
        expected: requestCurrency,
        source: comparison.source,
      })
    } else pass('currency_matches_request', { source: comparison.source })

    const requestedAmount = numberOrNull(context.amountRequested)
    if (requestedAmount === null) warn('request_amount_unavailable')
    else if (comparison.total === null) review('cfdi_total_missing')
    else if (nearlyEqual(comparison.total, requestedAmount, tolerance)) {
      pass('total_matches_request', { tolerance, source: comparison.source })
    } else {
      review('total_mismatch', {
        tolerance,
        actual: comparison.total,
        expected: requestedAmount,
        source: comparison.source,
      })
    }
  }

  return {
    status: reviewReasons.length ? 'review_required' : 'parsed',
    checks,
    warnings,
    reviewReasons,
    comparison,
  }
}
