import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../../supabase/migrations/20260902213643_prod_budget_finance_and_company_approver_hotfix.sql',
  import.meta.url,
)
const apiUrl = new URL('../../app/src/features/solicitudes/api.ts', import.meta.url)
const modalUrl = new URL('../../app/src/features/solicitudes/RequestModal.tsx', import.meta.url)

const migration = await readFile(migrationUrl, 'utf8')
const api = await readFile(apiUrl, 'utf8')
const modal = await readFile(modalUrl, 'utf8')

test('migration is forward-only and preserves the legacy responsible', () => {
  assert.match(migration, /^-- PROD hotfix:[\s\S]*\nbegin;/)
  assert.match(migration, /commit;\s*$/)
  assert.match(migration, /create table if not exists public\.company_cost_center_budget_category_responsibles/)
  assert.match(migration, /on delete cascade/)
  assert.doesNotMatch(migration, /update public\.company_cost_center_budget_categories/i)
  assert.doesNotMatch(migration, /delete\s+from|truncate/i)
})

test('Araceli receives Yulma Fersana categories without replacing Yulma', () => {
  assert.match(migration, /'agalvan@fluxfinanciera\.com'/)
  assert.match(migration, /'ychavez@fluxfinanciera\.com'/)
  assert.match(migration, /lower\(btrim\(company_row\.name\)\) = 'soporte fersana'/)
  assert.match(migration, /on conflict do nothing/)
})

test('React merges legacy and shared responsibles before scoping categories', () => {
  assert.match(api, /company_cost_center_budget_category_responsibles/)
  assert.match(api, /const respByCat = new Map<string, Set<string>>\(\)/)
  assert.match(api, /responsible_emails:/)
  assert.match(modal, /r\.responsible_emails\?\.length/)
  assert.match(modal, /return emails\.includes\(myEmail\)/)
})

test('approver lifecycle uses the company membership role', () => {
  assert.match(migration, /private\.profile_company_approver_roles/)
  for (const functionName of [
    'list_company_approver_candidates',
    'add_approver_assignment',
    'validate_approver_assignment',
    'list_payment_request_approver_options',
    'get_payment_request_approver_details',
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${functionName}`))
  }
  assert.match(migration, /decide_payment_request_assignment_role_drift/)
  assert.match(migration, /decide_payment_request_actor_role_drift/)
  assert.match(migration, /decide_payment_request_rule_role_drift/)
})
