import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const migrations = 'supabase/migrations/'
const read = (name) => readFileSync(migrations + name, 'utf8')

test('DEV migration versions are present exactly once', () => {
  for (const file of [
    '20260902164031_historical_actuals_finance_read.sql',
    '20260902164425_historical_actuals_flujo.sql',
  ]) assert.ok(existsSync(migrations + file), `missing ${file}`)

  assert.equal(existsSync(migrations + '20260902160000_historical_actuals_finance_read.sql'), false)
})

test('flujo is explicit and never inferred from company-specific account prefixes', () => {
  const sql = read('20260902164425_historical_actuals_flujo.sql')
  assert.match(sql, /add column if not exists flujo text/i)
  assert.match(sql, /historical_actuals_flujo_check/i)
  assert.match(sql, /'ingreso','egreso'/i)
  assert.doesNotMatch(sql, /substring|left\s*\(|like\s+'|account_code\s*[<>=]/i)
})

test('historical reads use company membership roles and remain fail-closed', () => {
  const sql = read('20260902223804_historical_actuals_company_roles.sql')
  assert.match(sql, /for select\s+to authenticated/i)
  assert.match(sql, /private\.current_profile_has_company_role\(\s*company_id,\s*array\['finance','director'\]/i)
  assert.match(sql, /current_user_has_role\([\s\S]*'sysadmin'/i)
  assert.match(sql, /revoke all on table public\.historical_actuals from anon/i)
  assert.doesNotMatch(sql, /current_user_has_role\([^)]*'finance'/i)
  assert.doesNotMatch(sql, /has_active_company_membership/i)
  assert.doesNotMatch(sql, /for all/i)
})
