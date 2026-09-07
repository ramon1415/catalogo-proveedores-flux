import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const formats = require('../../payroll_real_formats.js')
const reconcileSource = readFileSync('payroll_real_reconcile.js','utf8')
const provisionSource = readFileSync('payroll_provision_base.js','utf8')
const edgeSource = readFileSync('supabase/functions/payroll-materialize/index.ts','utf8')
const uiSource = readFileSync('app/src/features/nomina/physicalParsers.ts','utf8')
test('85-byte BBVA same-bank format is strict',()=>{
  const row='000000000123456789'+'000000000191134094'+'MXP'+'0000000012345.67'+'NOMINA 16 PERSONA PRUEBA'.padEnd(30,' ')+'\r\n'
  assert.equal(Buffer.byteLength(row,'ascii'),87)
  const parsed=formats.parseSameBank(Buffer.from(row,'ascii'))
  assert.equal(parsed.valid,true)
  assert.equal(parsed.contractVersion,'bbva-pagosbbv-85-v1')
  assert.equal(parsed.recordCount,1)
  assert.equal(parsed.totalAmountMinor,1234567)
  assert.equal(parsed.records[0].account,'123456789')
})
test('legacy 108 remains exported',()=>{
  assert.equal(typeof formats.parseSameBank108,'function')
  assert.equal(typeof formats.parseSameBank,'function')
})
test('Fersana cover contract is explicit and conditional',()=>{
  const src=readFileSync('payroll_real_formats.js','utf8')
  assert.match(src,/SOPORTE FERSANA/)
  assert.match(src,/Retroactivo Vales Despensa/)
  assert.match(src,/Pension Alimenticia/)
  assert.match(src,/selected\.contractVersion === FERSANA_COVER_CONTRACT_VERSION/)
})
test('pension is treasury SPEI not employee net',()=>{
  assert.match(reconcileSource,/PENSION ALIMENTICIA/)
  assert.match(reconcileSource,/actualPensionAmountMinor/)
})
test('provision supports both cover sheets',()=>{
  assert.match(provisionSource,/OPERADORA TLACATECPAN/)
  assert.match(provisionSource,/SOPORTE FERSANA/)
})
test('React and Edge call multi-contract parser',()=>{
  assert.match(uiSource,/physical\.parseSameBank \? physical\.parseSameBank/)
  assert.match(edgeSource,/FluxPayrollRealFormats\.parseSameBank \?/)
})
