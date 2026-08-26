import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync('lib/contpaq/cfdiValidation.js', 'utf8')
const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const api = await import(dataUrl)

const baseFacts = {
  version: '4.0',
  uuid: '11111111-2222-3333-4444-555555555555',
  comprobante: { tipoDeComprobante: 'I', moneda: 'MXN', total: 1000 },
  emisor: { rfc: 'AAA010101AAA' },
  receptor: { rfc: 'BBB010101BBB' },
}

const baseContext = {
  companyRfc: 'BBB010101BBB',
  providerRfc: 'AAA010101AAA',
  currency: 'MXN',
  amountRequested: 1000,
}

test('FB-2 exact parser shape remains parsed and requires no review', () => {
  const result = api.validateCfdiAgainstRequest(baseFacts, baseContext)
  assert.equal(result.status, 'parsed')
  assert.deepEqual(result.reviewReasons, [])
  assert.equal(result.checks.filter((item) => item.result === 'pass').length, 6)
  assert.equal(result.comparison.source, 'comprobante')
})

test('FB-2 known RFC, currency or amount mismatch is review_required, never silently corrected', () => {
  const result = api.validateCfdiAgainstRequest(
    {
      ...baseFacts,
      comprobante: { tipoDeComprobante: 'I', moneda: 'USD', total: 999.5 },
      emisor: { rfc: 'CCC010101CCC' },
      receptor: { rfc: 'DDD010101DDD' },
    },
    baseContext,
  )
  assert.equal(result.status, 'review_required')
  assert.ok(result.reviewReasons.includes('receiver_rfc_mismatch'))
  assert.ok(result.reviewReasons.includes('emitter_rfc_mismatch'))
  assert.ok(result.reviewReasons.includes('currency_mismatch'))
  assert.ok(result.reviewReasons.includes('total_mismatch'))
})

test('FB-2 REP/P compares effective payment amount and MonedaP, not Comprobante 0/XXX', () => {
  const facts = {
    ...baseFacts,
    comprobante: { tipoDeComprobante: 'P', moneda: 'XXX', subTotal: 0, total: 0 },
    pagosTotales: { montoTotalPagos: 62391.01 },
    pagos: [{ monedaP: 'MXN', tipoCambioP: 1, montoP: 62391.01, doctoRelacionado: [] }],
  }
  const context = { ...baseContext, amountRequested: 62391.01 }
  const result = api.validateCfdiAgainstRequest(facts, context)

  assert.equal(result.status, 'parsed')
  assert.deepEqual(result.reviewReasons, [])
  assert.equal(result.comparison.tipoDeComprobante, 'P')
  assert.equal(result.comparison.currency, 'MXN')
  assert.equal(result.comparison.total, 62391.01)
  assert.equal(result.comparison.source, 'pagos_totales')
  assert.ok(!result.reviewReasons.includes('currency_mismatch'))
  assert.ok(!result.reviewReasons.includes('total_mismatch'))
})

test('FB-2 T/N do not compare misleading Comprobante total/currency', () => {
  for (const tipoDeComprobante of ['T', 'N']) {
    const result = api.validateCfdiAgainstRequest(
      {
        ...baseFacts,
        comprobante: { tipoDeComprobante, moneda: 'XXX', total: 0 },
      },
      baseContext,
    )
    assert.equal(result.status, 'review_required')
    assert.ok(result.reviewReasons.includes('cfdi_tipo_no_comparable'))
    assert.ok(!result.reviewReasons.includes('currency_mismatch'))
    assert.ok(!result.reviewReasons.includes('total_mismatch'))
    assert.equal(result.comparison.comparable, false)
  }
})

test('FB-2 missing company/provider RFC is warning-only because DEV catalog is incomplete', () => {
  const result = api.validateCfdiAgainstRequest(baseFacts, { currency: 'MXN', amountRequested: 1000 })
  assert.equal(result.status, 'parsed')
  assert.ok(result.warnings.includes('company_rfc_unavailable'))
  assert.ok(result.warnings.includes('provider_rfc_unavailable'))
  assert.equal(result.reviewReasons.length, 0)
})

test('FB-2 amount comparison has one-cent tolerance on comparable amount', () => {
  const inside = api.validateCfdiAgainstRequest(
    { ...baseFacts, comprobante: { ...baseFacts.comprobante, total: 1000.01 } },
    baseContext,
  )
  const outside = api.validateCfdiAgainstRequest(
    { ...baseFacts, comprobante: { ...baseFacts.comprobante, total: 1000.02 } },
    baseContext,
  )
  assert.equal(inside.status, 'parsed')
  assert.equal(outside.status, 'review_required')
  assert.ok(outside.reviewReasons.includes('total_mismatch'))
})

test('FB-2 non-4.0 or UUID-less facts require review', () => {
  const version = api.validateCfdiAgainstRequest({ ...baseFacts, version: '3.3' }, baseContext)
  const uuid = api.validateCfdiAgainstRequest({ ...baseFacts, uuid: '' }, baseContext)
  assert.equal(version.status, 'review_required')
  assert.ok(version.reviewReasons.includes('cfdi_version_not_4_0'))
  assert.equal(uuid.status, 'review_required')
  assert.ok(uuid.reviewReasons.includes('cfdi_uuid_missing'))
})

test('FB-2 missing normalized facts is invalid without throwing', () => {
  const result = api.validateCfdiAgainstRequest(null, baseContext)
  assert.equal(result.status, 'invalid')
  assert.ok(result.reviewReasons.includes('facts_missing'))
})

test('FB-2 validator stays pure: no network, storage, parser or accounting side effects', () => {
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket|storage\.from|supabase|\.rpc\s*\(|insert\s*\(|update\s*\(|delete\s*\(/i)
  assert.doesNotMatch(source, /213-|216-|contpaq_account|tax_resolver|retenci[oó]n.*cuenta/i)
  assert.doesNotMatch(source, /DOMParser|fast-xml-parser|parseCfdiXml/)
})
