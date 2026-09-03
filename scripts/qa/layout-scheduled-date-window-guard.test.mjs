import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const newLayout = fs.readFileSync('app/src/features/layouts/NewLayoutModal.tsx', 'utf8')
const completion = fs.readFileSync('app/src/features/layouts/LayoutCompletionModal.tsx', 'utf8')

test('layout completion receives the active preview period', () => {
  assert.match(newLayout, /periodStart=\{periodStart\}/)
  assert.match(newLayout, /periodEnd=\{periodEnd\}/)
  assert.match(completion, /periodStart: string/)
  assert.match(completion, /periodEnd: string/)
})

test('scheduled payment date cannot silently leave the layout period', () => {
  assert.match(completion, /date < periodStart \|\| date > periodEnd/)
  assert.match(completion, /La fecha programada debe quedar dentro del periodo del layout/)
  assert.match(completion, /min=\{periodStart\}/)
  assert.match(completion, /max=\{periodEnd\}/)
  assert.match(completion, /formatDate\(periodStart\)/)
  assert.match(completion, /formatDate\(periodEnd\)/)
})

test('the guard remains an execution-data UX change only', () => {
  assert.doesNotMatch(completion, /budget_exception|exception_status|budget_decision/)
  assert.match(completion, /completePaymentRequestLayoutData/)
  assert.match(completion, /approval_preserved/)
})
