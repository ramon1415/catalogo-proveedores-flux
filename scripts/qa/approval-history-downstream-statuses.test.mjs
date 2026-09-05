import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('../../app/node_modules/typescript')
const source = readFileSync('app/src/features/aprobaciones/logic.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const module = { exports: {} }
const sandbox = {
  module,
  exports: module.exports,
  require(id) {
    if (id === '../../lib/format') return { normalize: (value) => String(value || '').toLowerCase() }
    throw new Error(`Unexpected runtime import: ${id}`)
  },
  Intl, Date, Number, Set, console,
}
vm.runInNewContext(compiled, sandbox, { filename: 'logic.js' })
const { approvalRows, columnKey, approvalDateMeta, decisionActionsFor } = module.exports
const now = new Date().toISOString()
const base = {
  id: 'request', status: 'submitted', created_at: now, updated_at: now,
  exception_status: null, exception_action: null, exception_approved_at: null,
  budget_decision: 'aprobable', is_extraordinary_adjustment: false, approver_id: null,
}

test('paid approvals remain in history', () => {
  const row = { ...base, id: 'fersana-paid', status: 'paid', __approvalEvent: { payment_request_id: 'fersana-paid', action: 'approved', created_at: now } }
  assert.equal(columnKey(row), 'approved')
  assert.equal(approvalRows([row]).length, 1)
  assert.equal(approvalDateMeta(row)?.label, 'Aprobada')
})
test('finance validation after approval remains in history', () => {
  const row = { ...base, id: 'operadora-finance', status: 'finance_validation', __approvalEvent: { payment_request_id: 'operadora-finance', action: 'approved', created_at: now } }
  assert.equal(columnKey(row), 'approved')
  assert.equal(approvalRows([row]).length, 1)
})
test('paid fallback remains approved history without event', () => {
  const row = { ...base, id: 'legacy-paid', status: 'paid' }
  assert.equal(columnKey(row), 'approved')
  assert.equal(approvalRows([row]).length, 1)
  assert.equal(approvalDateMeta(row)?.label, 'Aprobada/actualizada')
})
test('rejected decisions remain closed history', () => {
  const row = { ...base, id: 'rejected', __approvalEvent: { payment_request_id: 'rejected', action: 'rejected', created_at: now } }
  assert.equal(columnKey(row), 'closed')
  assert.equal(approvalRows([row]).length, 1)
})
test('undecided submitted stays pending', () => {
  const row = { ...base, id: 'pending' }
  assert.equal(columnKey(row), 'pending')
})
test('paid exception cannot expose approval actions again', () => {
  const row = { ...base, id: 'paid-exception', status: 'paid', budget_decision: 'bloqueado', is_extraordinary_adjustment: true, __approvalEvent: { payment_request_id: 'paid-exception', action: 'exception_approved', created_at: now } }
  assert.equal(decisionActionsFor(row, true, 'approver').kind, 'message')
})
test('history stays bounded to 100 days', () => {
  const old = new Date(Date.now() - 101 * 24 * 60 * 60 * 1000).toISOString()
  const row = { ...base, id: 'old-paid', status: 'paid', created_at: old, updated_at: old, __approvalEvent: { payment_request_id: 'old-paid', action: 'approved', created_at: old } }
  assert.equal(approvalRows([row]).length, 0)
})
