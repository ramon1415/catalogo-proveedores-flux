import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = fs.readFileSync('contpaq_mapping_candidates.js', 'utf8')
const context = { window: {} }
vm.createContext(context)
vm.runInContext(source, context)
const api = context.window.FluxContpaqMappingCandidates

test('FB-3 bank candidate accepts one exact full-number match only', () => {
  const result = api.bankAccountCandidate(
    { company_id: 'company-a', account_number: '0113509621' },
    [
      { company_id: 'company-a', code: '10201100000', name: 'Banco 0113509621', activo: true, is_detail: true },
      { company_id: 'company-a', code: '10201200000', name: 'Banco 9999999999', activo: true, is_detail: true },
    ],
  )
  assert.equal(result.status, 'matched')
  assert.equal(result.reason, 'exact_full_account_number')
  assert.equal(result.matches.length, 1)
})

test('FB-3 bank candidate never promotes last4-only coincidence', () => {
  const result = api.bankAccountCandidate(
    { company_id: 'company-a', account_number: '0113509621' },
    [{ company_id: 'company-a', name: 'Banco terminación 9621', activo: true, is_detail: true }],
  )
  assert.equal(result.status, 'needs_review')
  assert.equal(result.reason, 'bank_account_no_exact_candidate')
})

test('FB-3 bank candidate rejects missing company scope and insufficient identifiers', () => {
  assert.equal(api.bankAccountCandidate({ account_number: '0113509621' }, []).reason, 'bank_company_missing')
  assert.equal(api.bankAccountCandidate({ company_id: 'company-a', account_number: '9621' }, []).reason, 'bank_account_number_insufficient')
})

test('FB-3 bank candidate keeps multiple exact candidates in review', () => {
  const result = api.bankAccountCandidate(
    { company_id: 'company-a', account_number: '0113509621' },
    [
      { company_id: 'company-a', name: 'Banco A 0113509621', activo: true, is_detail: true },
      { company_id: 'company-a', name: 'Banco B 0113509621', activo: true, is_detail: true },
    ],
  )
  assert.equal(result.status, 'needs_review')
  assert.equal(result.reason, 'bank_account_ambiguous')
})

test('FB-3 provider identity accepts one exact RFC match scoped to company', () => {
  const result = api.providerIdentityCandidate(
    { rfc: 'AAA010101AAA', alias: 'Proveedor operativo' },
    'company-a',
    [
      { company_id: 'company-a', id_contpaq: '10', rfc: 'AAA010101AAA', nombre: 'Nombre CONTPAQ' },
      { company_id: 'company-b', id_contpaq: '11', rfc: 'AAA010101AAA', nombre: 'Otra empresa' },
    ],
  )
  assert.equal(result.status, 'matched')
  assert.equal(result.reason, 'exact_rfc')
  assert.equal(result.matches.length, 1)
})

test('FB-3 provider identity never matches by name when RFC is missing/different', () => {
  const missing = api.providerIdentityCandidate({ alias: 'Mismo Nombre' }, 'company-a', [{ company_id: 'company-a', rfc: 'AAA010101AAA', nombre: 'Mismo Nombre' }])
  const different = api.providerIdentityCandidate({ rfc: 'BBB010101BBB', alias: 'Mismo Nombre' }, 'company-a', [{ company_id: 'company-a', rfc: 'AAA010101AAA', nombre: 'Mismo Nombre' }])
  assert.equal(missing.reason, 'provider_rfc_missing')
  assert.equal(different.reason, 'provider_rfc_no_candidate')
})

test('FB-3 duplicate RFC inside the same company remains review_required', () => {
  const result = api.providerIdentityCandidate(
    { rfc: 'AAA010101AAA' },
    'company-a',
    [
      { company_id: 'company-a', rfc: 'AAA010101AAA' },
      { company_id: 'company-a', rfc: 'AAA010101AAA' },
    ],
  )
  assert.equal(result.status, 'needs_review')
  assert.equal(result.reason, 'provider_rfc_ambiguous')
})

test('FB-3 candidate core stays pure and contains no write/export/tax resolver path', () => {
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket|supabase|\.rpc\s*\(|insert\s*\(|update\s*\(|delete\s*\(/i)
  assert.doesNotMatch(source, /213-|216-|tax_resolver|export.*contpaq|create.*poliza/i)
  assert.doesNotMatch(source, /last4/i)
})
