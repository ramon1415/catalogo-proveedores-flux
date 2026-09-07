import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const api = readFileSync('app/src/features/nomina/api.ts', 'utf8')
const modal = readFileSync('app/src/features/nomina/CaptureModal.tsx', 'utf8')
const logic = readFileSync('app/src/features/nomina/logic.ts', 'utf8')
const formats = readFileSync('payroll_real_formats.js', 'utf8')

test('Edge non-2xx keeps the safe PAYROLL_* server code', () => {
  assert.match(api, /async function throwFunctionInvokeError/)
  assert.equal((api.match(/await throwFunctionInvokeError\(error\)/g) || []).length, 2)
  assert.match(api, /context\.clone\(\)\.json\(\)/)
})

test('manual assignment cannot bypass canonical physical parser', () => {
  assert.match(modal, /const classified = await classifyPayrollFile\(entry\.file\)/)
  assert.match(modal, /classified\.slot !== slot/)
  assert.match(modal, /PAYROLL_FILE_PHYSICAL_CONTRACT_MISMATCH/)
})

test('same-bank server contract remains Nómina108 and is not relaxed', () => {
  assert.match(formats, /bytes\.length % 110 !== 0/)
  assert.match(formats, /SAME_BANK_CONTRACT_VERSION = 'bbva-payroll-nomina108-v1'/)
})

test('friendly errors cover physical and provision failures', () => {
  for (const code of [
    'PAYROLL_FILE_PHYSICAL_CONTRACT_MISMATCH',
    'PAYROLL_FILE_SIZE_MISMATCH',
    'PAYROLL_FILE_MIME_MISMATCH',
    'PAYROLL_FILE_HASH_MISMATCH',
    'PAYROLL_PROVISION_BASE_SERVER_PARSE_FAILED',
  ]) assert.ok(logic.includes(code), code)
})
