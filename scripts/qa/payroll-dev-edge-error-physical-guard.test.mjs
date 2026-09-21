import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const api = readFileSync('app/src/features/nomina/api.ts', 'utf8')
const modal = readFileSync('app/src/features/nomina/CaptureModal.tsx', 'utf8')
const logic = readFileSync('app/src/features/nomina/logic.ts', 'utf8')
const formats = readFileSync('payroll_real_formats.js', 'utf8')

import { runInNewContext } from 'node:vm'
import ts from '../../app/node_modules/typescript/lib/typescript.js'

const compiledApi = ts.transpileModule(api, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText
function payrollApi(invoke) {
  const exports = {}
  runInNewContext(compiledApi, {
    exports, require: (name) => {
      if (name.includes('supabase')) return { supabase: { functions: { invoke } } }
      if (name.includes('logic')) return {}
      throw new Error(`Unexpected runtime import ${name}`)
    },
  })
  return exports
}
const edgeCalls = [
  ['materializeCapture', ['session-qa', 1], 'payroll-materialize'],
  ['revalidateMaterializedCapture', ['session-qa', 1], 'payroll-materialize'],
  ['getCaptureFileUrl', ['file-qa'], 'payroll-capture-file-url'],
]
for (const [name, args, edge] of edgeCalls) {
  test(`${name} preserves a safe PAYROLL code from Edge non-2xx`, async () => {
    const error = Object.assign(new Error('Edge non-2xx'), {
      context: new Response(JSON.stringify({ error: 'PAYROLL_ACCESS_DENIED' }), { status: 403 }),
    })
    const client = payrollApi(async (actual) => { assert.equal(actual, edge); return { error } })
    await assert.rejects(client[name](...args), { message: 'PAYROLL_ACCESS_DENIED' })
    assert.equal(error.context.bodyUsed, false, 'Parsing must not consume the original response')
  })
  for (const payload of ['not JSON', JSON.stringify({ error: 'internal database detail' })]) {
    test(`${name} retains the transport error for an unsafe or invalid response: ${payload}`, async () => {
      const error = Object.assign(new Error('Edge non-2xx'), { context: new Response(payload, { status: 500 }) })
      const client = payrollApi(async () => ({ error }))
      await assert.rejects(client[name](...args), actual => actual === error)
    })
  }
}

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
