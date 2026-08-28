import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

const frame = read('app/src/pages/LegacyModuleFrame.tsx')
const cuts = read('approval_batches.js')
const receipts = read('comprobantes_batch.js')
const intakes = read('provider_intakes.js')

test('the React legacy frame propagates the active company and reloads on company changes', () => {
  assert.match(frame, /const \{ companyId \} = useCompany\(\)/)
  assert.match(frame, /company_id=\$\{encodeURIComponent\(companyId\)\}/)
  assert.match(frame, /\[frameSrc\]/)
  assert.match(frame, /src=\{frameSrc\}/)
})

test('weekly cuts stay scoped to the active company', () => {
  assert.match(cuts, /const ACTIVE_COMPANY_ID =/)
  assert.match(cuts, /batches\.filter\(\(batch\) => batch\.company_id === ACTIVE_COMPANY_ID\)/)
  assert.match(cuts, /list_company_directors"[,\s]+\{ p_company_id: ACTIVE_COMPANY_ID \}/)
  assert.match(cuts, /list_extraordinary_regularizations"[,\s]+\{[\s\S]{0,120}p_company_id: ACTIVE_COMPANY_ID/)
})

test('receipt batches query only the active company', () => {
  assert.match(receipts, /const ACTIVE_COMPANY_ID =/)
  const scopedCalls = receipts.match(/RPC\.listBatches, \{ p_company_id: ACTIVE_COMPANY_ID/g) || []
  assert.equal(scopedCalls.length, 2)
  assert.doesNotMatch(receipts, /RPC\.listBatches, \{ p_company_id: null/)
})

test('provider intakes and link management stay scoped to the active company', () => {
  assert.match(intakes, /p_company_id: ACTIVE_COMPANY_ID \|\| dom\.companyFilter\.value \|\| null/)
  assert.match(intakes, /companies\.filter\(\(company\) => company\.id === ACTIVE_COMPANY_ID\)/)
  assert.match(intakes, /dom\.companyFilter\.disabled = Boolean\(ACTIVE_COMPANY_ID\)/)
})
