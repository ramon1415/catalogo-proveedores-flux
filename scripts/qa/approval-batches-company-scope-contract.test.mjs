import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const cuts = fs.readFileSync('approval_batches.js', 'utf8')
const html = fs.readFileSync('approval_batches.html', 'utf8')
const frame = fs.readFileSync('app/src/pages/LegacyModuleFrame.tsx', 'utf8')

test('React passes the active company to the embedded weekly-cuts module', () => {
  assert.match(frame, /company_id=\$\{encodeURIComponent\(companyId\)\}/)
  assert.match(frame, /const \{ companyId \} = useCompany\(\)/)
})

test('weekly cuts parse a valid company scope and fail closed on an invalid requested scope', () => {
  assert.match(cuts, /companyScopeRequired:\s*false/)
  assert.match(cuts, /state\.companyScopeRequired = params\.has\("company_id"\)/)
  assert.match(cuts, /state\.companyScopeId = parseUuid\(params\.get\("company_id"\)\)/)
  assert.match(cuts, /state\.companyScopeRequired && !state\.companyScopeId[\s\S]*renderCompanyScopeError/)
})

test('batch, director, settings and regularization reads are scoped to the selected company', () => {
  assert.match(cuts, /state\.batches = scopeCompanyRows\(data\)/)
  assert.match(cuts, /list_company_directors", \{ p_company_id: state\.companyScopeId \|\| null \}/)
  assert.match(cuts, /settingsQuery = settingsQuery\.eq\("company_id", state\.companyScopeId\)/)
  assert.match(cuts, /list_extraordinary_regularizations", \{[\s\S]*p_company_id: state\.companyScopeId \|\| null/)
  assert.match(cuts, /state\.regularizations = scopeCompanyRows\(data\)/)
})

test('a cross-company deep link cannot render or mutate a cut', () => {
  assert.match(cuts, /const listedBatch = state\.batches\.find\(\(batch\) => batch\.id === batchId\)/)
  assert.match(cuts, /!listedBatch \|\| !isWithinCompanyScope\(listedBatch\)/)
  assert.match(cuts, /!isWithinCompanyScope\(state\.detail\.batch\)[\s\S]*batch_company_scope_mismatch/)
})

test('create and configuration selectors are locked to the active company', () => {
  assert.match(cuts, /const current = state\.companyScopeId \|\| select\.value/)
  assert.match(cuts, /select\.disabled = Boolean\(state\.companyScopeId\)/)
  assert.equal((cuts.match(/companyId !== state\.companyScopeId/g) || []).length, 2)
})

test('legacy asset uses a fresh cache key for the company-scope hotfix', () => {
  assert.match(html, /approval_batches\.js\?v=20260903-company-scope/)
})
