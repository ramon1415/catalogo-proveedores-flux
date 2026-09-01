import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const detail = read('app/src/features/provider-intakes/IntakeDetailModal.tsx')
const matching = read('app/src/features/provider-intakes/IntakeMatchSection.tsx')
const draft = read('app/src/features/provider-intakes/IntakePaymentDraft.tsx')
const logic = read('app/src/features/provider-intakes/logic.ts')

test('review transition refreshes matching without closing the intake detail', () => {
  assert.match(matching, /\[intake\.id, intake\.status, intake\.updated_at\]/)
  assert.match(matching, /useEffect\(\(\) => \{ load\(''\) \}, \[load\]\)/)
})

test('intake mutations refresh the payment draft concurrency snapshot', () => {
  assert.match(detail, /intakeUpdatedAt=\{intake\.updated_at\}/)
  assert.match(draft, /intakeUpdatedAt: string \| null/)
  assert.match(draft, /\[intakeId, intakeUpdatedAt\]/)
})

test('React translates concurrency and conversion errors into actionable Spanish', () => {
  assert.match(logic, /provider_intake_conversion_draft_intake_conflict: 'La solicitud cambió[^']*«Recargar borrador»/)
  assert.match(logic, /provider_intake_conversion_draft_conflict: 'Otra persona actualizó[^']*«Recargar borrador»/)
  assert.match(logic, /provider_intake_conversion_not_ready: '[^']*Recarga el borrador/)
  assert.match(logic, /message\.includes\('provider_intake_'\)[\s\S]{0,180}No fue posible completar la operación/)
})
