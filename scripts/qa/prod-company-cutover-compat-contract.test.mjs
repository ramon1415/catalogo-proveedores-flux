import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..', '..')
execFileSync(process.execPath, [resolve(root, 'scripts/qa/build-prod-company-cutover-compat.mjs')])

const wave1 = readFileSync(resolve(root, 'prod-readiness/generated/company_scoped_rls_rpc_cutover_prod.sql'), 'utf8')
const rpc = readFileSync(resolve(root, 'prod-readiness/generated/company_scoped_rpc_cutover_prod.sql'), 'utf8')
const historical = readFileSync(resolve(root, 'prod-readiness/generated/company_scoped_historical_actuals_prod.sql'), 'utf8')

test('PROD wave cuts released tables and guards absent optional modules', () => {
  assert.match(wave1, /create policy payment_requests_select/)
  assert.match(wave1, /create policy payment_intake_select_finance_company/)
  assert.match(wave1, /prod_company_cutover_cfdi_inventory_changed/)
  assert.match(wave1, /prod_company_cutover_payroll_inventory_changed/)
  assert.doesNotMatch(wave1, /create policy payment_request_cfdi_facts_select/)
  assert.doesNotMatch(wave1, /create policy payroll_provision_settings_finance_read/)
})

test('PROD RPC wave skips only the two unreleased CONTPAQ signatures', () => {
  assert.match(rpc, /contpaq_mapper_save_mapping/)
  assert.match(rpc, /contpaq_mapper_set_review/)
  assert.match(rpc, /continue;/)
  assert.match(rpc, /company_role_rpc_missing/)
  assert.match(rpc, /company_role_rpc_postcheck_failed/)
})

test('PROD RPC wave cuts the two retained compatibility functions', () => {
  assert.match(rpc, /get_payment_request_execution_context_pre_037/)
  assert.match(rpc, /provider_intake_internal_access_allowed/)
  assert.match(rpc, /prod_execution_context_finance_drift/)
  assert.match(rpc, /prod_provider_intake_company_predicate_drift/)
})

test('historical actuals are read by company members and written by company Finance', () => {
  assert.match(historical, /historical_actuals_null_company_rows/)
  assert.match(historical, /array\['operator','finance','director'\]/)
  assert.match(historical, /array\['finance'\]/)
  assert.match(historical, /historical_actuals_company_scope_failed/)
})
