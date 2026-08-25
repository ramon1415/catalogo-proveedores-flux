import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = fs.readFileSync('contpaq_cfdi_validation.js', 'utf8')
const context = { window: {} }
vm.createContext(context)
vm.runInContext(source, context)
const api = context.window.FluxContpaqCfdiValidation

const baseFacts = {
  version: '4.0',
  uuid: '11111111-2222-3333-4444-555555555555',
  moneda: 'MXN',
  total: 1000,
  emisor: { rfc: 'AAA010101AAA' },
  receptor: { rfc: 'BBB010101BBB' },
}

const baseContext = {
  companyRfc: 'BBB010101BBB',
  providerRfc: 'AAA010101AAA',
  currency: 'MXN',
  amountRequested: 1000,
}

test('FB-2 exact known facts remain parsed and require no review', () => {
  const result = api.validateCfdiAgainstRequest(baseFacts, baseContext)
  assert.equal(result.status, 'parsed')
  assert.deepEqual(Array.from(result.reviewReasons), [])
  assert.equal(result.checks.filter((item) => item.result === 'pass').length, 6)
})

test('FB-2 known RFC, currency or amount mismatch is review_required, never silently corrected', () => {
  const result = api.validateCfdiAgainstRequest(
    { ...baseFacts, moneda: 'USD', total: 999.5, emisor: { rfc: 'CCC010101CCC' }, receptor: { rfc: 'DDD010101DDD' } },
    baseContext,
  )
  assert.equal(result.status, 'review_required')
  assert.ok(result.reviewReasons.includes('receiver_rfc_mismatch'))
  assert.ok(result.reviewReasons.includes('emitter_rfc_mismatch'))
  assert.ok(result.reviewReasons.includes('currency_mismatch'))
  assert.ok(result.reviewReasons.includes('total_mismatch'))
})

test('FB-2 missing company/provider RFC is warning-only because DEV catalog is incomplete', () => {
  const result = api.validateCfdiAgainstRequest(baseFacts, { currency: 'MXN', amountRequested: 1000 })
  assert.equal(result.status, 'parsed')
  assert.ok(result.warnings.includes('company_rfc_unavailable'))
  assert.ok(result.warnings.includes('provider_rfc_unavailable'))
  assert.equal(result.reviewReasons.length, 0)
})

test('FB-2 amount comparison has one-cent tolerance', () => {
  const inside = api.validateCfdiAgainstRequest({ ...baseFacts, total: 1000.01 }, baseContext)
  const outside = api.validateCfdiAgainstRequest({ ...baseFacts, total: 1000.02 }, baseContext)
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
