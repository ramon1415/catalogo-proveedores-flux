from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


completion_path = Path("app/src/features/layouts/LayoutCompletionModal.tsx")
completion = completion_path.read_text(encoding="utf-8")

completion = replace_once(
    completion,
    """  cleanText, friendlyRpcError, formatMissingFields, formatPreviewMoney, layoutAccountLabel,
  providerExecutionLayoutFields,""",
    """  cleanText, friendlyRpcError, formatDate, formatMissingFields, formatPreviewMoney,
  layoutAccountLabel, providerExecutionLayoutFields,""",
    "LayoutCompletionModal logic imports",
)

completion = replace_once(
    completion,
    """  request,
  accounts,
  onClose,
  onSaved,
}: {
  request: PreviewRow
  accounts: CompanyBankAccount[]
  onClose: () => void""",
    """  request,
  accounts,
  periodStart,
  periodEnd,
  onClose,
  onSaved,
}: {
  request: PreviewRow
  accounts: CompanyBankAccount[]
  periodStart: string
  periodEnd: string
  onClose: () => void""",
    "LayoutCompletionModal period props",
)

completion = replace_once(
    completion,
    """  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const referenceValue = cleanText(reference)""",
    """  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (date && (date < periodStart || date > periodEnd)) {
      return fieldError(
        refs.date,
        `La fecha programada debe quedar dentro del periodo del layout: ${formatDate(periodStart)} a ${formatDate(periodEnd)}.`,
      )
    }
    const referenceValue = cleanText(reference)""",
    "LayoutCompletionModal date validation",
)

completion = replace_once(
    completion,
    """          <label>Fecha programada
            <input ref={refs.date} type=\"date\" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>""",
    """          <label>Fecha programada
            <input
              ref={refs.date}
              type=\"date\"
              min={periodStart}
              max={periodEnd}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <span className={s.fieldHint}>
              Debe quedar dentro del periodo del layout: {formatDate(periodStart)} a {formatDate(periodEnd)}.
            </span>
          </label>""",
    "LayoutCompletionModal bounded date input",
)

completion_path.write_text(completion, encoding="utf-8")

modal_path = Path("app/src/features/layouts/NewLayoutModal.tsx")
modal = modal_path.read_text(encoding="utf-8")
modal = replace_once(
    modal,
    """        <LayoutCompletionModal
          request={completionRequest}
          accounts={accounts}
          onClose={() => setCompletionRequest(null)}""",
    """        <LayoutCompletionModal
          request={completionRequest}
          accounts={accounts}
          periodStart={periodStart}
          periodEnd={periodEnd}
          onClose={() => setCompletionRequest(null)}""",
    "NewLayoutModal period wiring",
)
modal_path.write_text(modal, encoding="utf-8")

test_path = Path("scripts/qa/layout-scheduled-date-window-guard.test.mjs")
test_path.write_text(
    """import assert from 'node:assert/strict'
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
""",
    encoding="utf-8",
)
