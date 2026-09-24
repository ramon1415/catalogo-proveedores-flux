import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('../../app/node_modules/typescript')
const root = new URL('../../', import.meta.url)
const source = readFileSync(new URL('app/src/features/solicitudes/logic.ts', root), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }
vm.runInNewContext(compiled, {
  module, exports: module.exports,
  require(id) {
    // These imports are unused by the status and budget functions under test.
    if (['../../lib/format', '../../lib/requestClassification'].includes(id)) return {}
    throw new Error(`Unexpected runtime import: ${id}`)
  },
}, { filename: 'solicitudes-logic.js' })
const {
  isApprovedAwaitingPayment, hasAuthorizedBudgetException, isPendingExceptionRequest,
  statusMatches, budgetDecisionMatches, statusBadge, requestBudgetDecisionBadge,
  isFinalDecisionStatus, isTerminalStatus,
} = module.exports
const base = {
  status: 'submitted', budget_decision: 'aprobable', budget_block_reason: null,
  exception_status: null, exception_action: null, is_extraordinary_adjustment: false,
}
const authorized = {
  ...base, request_number: 'SOL-2026-0075', status: 'finance_validation',
  budget_decision: 'bloqueado', budget_block_reason: 'sin_disponible',
  exception_status: 'approved', exception_action: 'exception_approved',
}

test('the reported request retains approval and the authorized exception during bank processing', () => {
  assert.equal(statusBadge(authorized.status).label, 'Aprobada · Pendiente de pago')
  assert.equal(requestBudgetDecisionBadge(authorized).label, 'Excepción autorizada')
  assert.match(requestBudgetDecisionBadge(authorized).title, /Sin presupuesto/)
  assert.equal(statusMatches(authorized, 'approved'), true)
  assert.equal(budgetDecisionMatches(authorized, 'excepciones'), false)
  assert.equal(budgetDecisionMatches(authorized, 'excepciones_autorizadas'), true)
  assert.equal(isFinalDecisionStatus(authorized.status), true)
  assert.equal(isTerminalStatus(authorized.status), true)
  assert.equal(authorized.status, 'finance_validation')
})

test('approved KPI and filter cover all three unpaid downstream stages only', () => {
  const rows = ['submitted', 'approved', 'finance_validation', 'scheduled', 'paid', 'rejected', 'cancelled', 'changes_requested'].map(status => ({ ...base, status }))
  const expected = ['approved', 'finance_validation', 'scheduled']
  assert.deepEqual(rows.filter(isApprovedAwaitingPayment).map(r => r.status), expected)
  assert.deepEqual(rows.filter(r => statusMatches(r, 'approved')).map(r => r.status), expected)
  assert.deepEqual(rows.filter(r => statusMatches(r, 'finance_validation')).map(r => r.status), ['finance_validation'])
  assert.equal(statusBadge('scheduled').label, 'Aprobada · Pago programado')
})

test('authorized historical exceptions stay searchable without becoming pending approvals', () => {
  for (const status of ['approved', 'finance_validation', 'scheduled', 'paid']) {
    const row = { ...authorized, status }
    assert.equal(hasAuthorizedBudgetException(row), true)
    assert.equal(isPendingExceptionRequest(row), false)
    assert.equal(budgetDecisionMatches(row, 'excepciones_autorizadas'), true)
    assert.equal(requestBudgetDecisionBadge(row).label, 'Excepción autorizada')
  }
})

test('returned requests cannot reuse stale exception flags as current approval', () => {
  for (const status of ['submitted', 'changes_requested']) {
    const row = { ...authorized, status }
    assert.equal(hasAuthorizedBudgetException(row), false)
    assert.equal(isPendingExceptionRequest(row), true)
    assert.equal(statusMatches(row, 'approved'), false)
    assert.equal(requestBudgetDecisionBadge(row).label, 'Sin presupuesto')
  }
  for (const status of ['rejected', 'cancelled']) {
    assert.equal(isPendingExceptionRequest({ ...authorized, status }), false)
  }
})

test('budget availability and downstream status alone do not invent exception authorization', () => {
  assert.equal(requestBudgetDecisionBadge(base).label, 'Con presupuesto')
  assert.equal(statusMatches(base, 'approved'), false)
  assert.equal(hasAuthorizedBudgetException({ ...authorized, exception_status: null, exception_action: null }), false)
  assert.equal(hasAuthorizedBudgetException({ ...authorized, exception_action: 'exception_rejected' }), false)
})

test('paid is driven by confirmed request state, never by approval or an uploaded attachment', () => {
  assert.equal(statusMatches({ ...authorized, receipt_count: 1 }, 'paid'), false)
  assert.equal(statusMatches({ ...authorized, status: 'paid' }, 'paid'), true)
  assert.equal(statusMatches({ ...authorized, status: 'paid' }, 'activas'), false)
  assert.equal(statusBadge('paid').label, 'Pagada')
})
