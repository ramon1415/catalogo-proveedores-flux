import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  'supabase/migrations/20260901062149_company_scoped_rls_rpc_cutover.sql',
  'utf8',
)
const rpcMigration = readFileSync(
  'supabase/migrations/20260901063043_company_scoped_rpc_cutover.sql',
  'utf8',
)
const preflight = readFileSync(
  'prod-readiness/paso1c-company-role-cutover-preflight.sql',
  'utf8',
)

function policy(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = migration.match(
    new RegExp(`create policy ${escaped}[\\s\\S]*?;`, 'i'),
  )
  assert.ok(match, `missing policy ${name}`)
  return match[0]
}

test('the company-role lookup stays private and pins search_path', () => {
  assert.match(migration, /function private\.current_profile_has_company_role/)
  assert.match(migration, /security invoker\s+set search_path = ''/i)
  assert.match(migration, /private\.profile_has_company_role/)
  assert.match(
    migration,
    /revoke all on function private\.current_profile_has_company_role[\s\S]*?from public, anon/i,
  )
  assert.match(
    migration,
    /grant execute on function private\.current_profile_has_company_role[\s\S]*?to authenticated, service_role/i,
  )
})

test('payment requests enforce operator-own and company approver visibility', () => {
  const insert = policy('payment_requests_insert')
  const select = policy('payment_requests_select')
  const update = policy('payment_requests_update')

  assert.match(insert, /requested_by = \(select public\.current_profile_id\(\)\)/)
  assert.match(insert, /array\['operator','finance','director'\]/)
  assert.match(select, /array\['finance','director'\]/)
  assert.match(update, /with check/i)
  assert.doesNotMatch(`${insert}\n${select}\n${update}`, /current_user_has_role/i)
  assert.doesNotMatch(`${insert}\n${select}\n${update}`, /has_active_company_membership/i)
})

test('CFDI and Finance ingestion inherit exact company authorization', () => {
  for (const name of [
    'payment_request_cfdi_facts_select',
    'payment_request_cfdi_facts_insert',
    'payment_intake_select_finance_company',
    'payment_intake_events_select_finance_company',
    'payment_intake_files_select_finance_company',
  ]) {
    assert.match(policy(name), /current_profile_has_company_role/)
  }
  assert.match(policy('payment_intake_select_finance_company'), /array\['finance'\]/)
})

test('approval, banking, cash incidents, and extraordinary rows are company scoped', () => {
  for (const name of [
    'approval_batch_company_settings_read_finance',
    'approval_batch_company_setting_events_read_finance',
    'approval_batches_read_authorized',
    'cba_select',
    'cba_write',
    'cash_funds_select_company',
    'cash_funds_insert_company',
    'cash_funds_update_company',
    'cash_funds_delete_company',
    'company_directors_read_authorized',
    'extraordinary_payment_policies_read',
    'incident_charges_authorized_select',
    'incident_charges_authorized_all',
    'payment_request_extraordinary_read_authorized',
  ]) {
    assert.match(policy(name), /current_profile_has_company_role/)
  }
})

test('CONTPAQ and payroll require Finance in the selected company', () => {
  assert.match(
    migration,
    /function public\.contpaq_mapper_company_access[\s\S]*?array\['finance'\]/,
  )
  assert.match(
    migration,
    /function public\.payroll_active_company_access[\s\S]*?array\['finance'\]/,
  )
  assert.match(
    migration,
    /payroll_active_company_access[\s\S]*?auth\.jwt\(\) ->> 'role'[\s\S]*?service_role/,
  )

  assert.doesNotMatch(migration, /create policy budget_categories_write/i)
  assert.match(migration, /budget_categories is a shared global catalogue/i)

  for (const name of [
    'payroll_provision_settings_finance_read',
    'payroll_provision_entries_finance_read',
    'payroll_contpaq_role_mappings_finance_read',
    'payroll_contpaq_bank_mappings_finance_read',
  ]) {
    assert.match(policy(name), /array\['finance'\]/)
  }
})

test('cash funds preserve responsible read and scope management by company', () => {
  const select = policy('cash_funds_select_company')
  const insert = policy('cash_funds_insert_company')
  const update = policy('cash_funds_update_company')
  const remove = policy('cash_funds_delete_company')

  assert.match(select, /responsible_profile_id = \(select public\.current_profile_id\(\)\)/)
  assert.match(select, /array\['operator','finance','director'\]/)
  for (const write of [insert, update, remove]) {
    assert.match(write, /array\['finance','director'\]/)
  }
  assert.match(insert, /with check/i)
  assert.match(update, /with check/i)
  assert.doesNotMatch(`${select}\n${insert}\n${update}\n${remove}`, /current_user_has_role/i)
})

test('the migration is transactional and fails closed on policy regression', () => {
  assert.match(migration, /^begin;/m)
  assert.match(migration, /company_role_wave1_policy_postcheck_failed/)
  assert.match(migration, /^commit;/m)
})

test('legacy RPC predicates are drift-checked before company-scope rewrite', () => {
  for (const signature of [
    'contpaq_mapper_save_mapping',
    'contpaq_mapper_set_review',
    'get_approval_batch_detail',
    'get_payment_request_execution_readiness',
    'payment_reconciliation_require_finance',
    'payment_reconciliation_storage_path_allowed',
    'payment_receipt_evidence_storage_path_allowed',
    'get_payment_request_approver_details',
    'list_payment_ingestion_batches',
    'get_payment_batch_context',
  ]) assert.match(rpcMigration, new RegExp(signature))

  assert.match(rpcMigration, /expected_count/)
  assert.match(rpcMigration, /company_role_rpc_.*_drift/)
  assert.match(rpcMigration, /company_role_rpc_postcheck_failed/)
  assert.match(
    rpcMigration,
    /function public\.get_payment_batch_context\(\)[\s\S]*?set search_path = ''/i,
  )
  assert.match(
    rpcMigration,
    /get_payment_batch_context\(\)[\s\S]*?private\.current_profile_has_company_role[\s\S]*?array\['finance'\]/i,
  )
  assert.match(rpcMigration, /^begin;/m)
  assert.match(rpcMigration, /^commit;/m)
})

test('preflight detects only actual global business-role calls', () => {
  assert.match(preflight, /flux_\(finance\|approver\|member\)_roles/)
  assert.match(preflight, /approval_batch_direction_roles/)
  assert.match(preflight, /current_user_has_role\\s\*\\\(/)
  assert.match(preflight, /company_role_preflight_legacy_function_blockers/)
  assert.doesNotMatch(
    preflight,
    /pg_get_functiondef\(p\.oid\) ~\* 'flux_\(finance\|approver\|member\)_roles\|finance'/,
  )
})
