import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflow = readFileSync('.github/workflows/flux-prod-release-546-547.yml', 'utf8')
const contract = readFileSync('.github/workflows/flux-prod-release-546-547-contract.yml', 'utf8')

const required = [
  'workflow_dispatch:',
  'pr546_db', 'pr547_db', 'pr546_edges',
  'preflight', 'apply',
  'environment: supabase-production',
  'EXPECTED_PROD_REF: ucantptjhwttexzmslvm',
  'FORBIDDEN_DEV_REF: scsirgbuqjcwoaxfacth',
  'APPLY-PR546-DB', 'APPLY-PR547-DB', 'DEPLOY-PR546-EDGES',
  'release_pr_number:', 'target_git_sha:',
  'pr_base_main', 'target_matches_pr_head',
  '20260904192129_payment_request_exception_quick_approve_prod.sql',
  '20260904194016_partida_predictions_prod.sql',
  '20260904194019_partida_unsure_prod.sql',
  '20260904194022_partida_predictions_seed_prod.sql',
  '07c696220dcb3f1aef212611cee286a8a586edd2',
  '59236bd270d8957a9f3f5479837db67b17e58837',
  '19ea7af46c04e2be22426a03f4b44658101ad8af',
  '7ad75b5aaa7ab86b2ab6028c55d6f8620dda9d77',
  '3be0200a980ee48a49ab857a21a0e6fa19676178',
  'fd23dc1830cef160a009f9dfea3e2a01718d6ae7',
  '9680353c-9b86-4730-82e1-fce664f048a2',
  '68b61801-74c0-44ea-a33b-f20e4bf53aa7',
  'payment_request_exception_quick_approval_uses',
  'partida_predictions',
  'create_payment_request_with_document',
  'create_reimbursement_request_with_documents',
  'db push', '--db-url', '--include-all', '--dry-run',
  'QUICK_APPROVE_MUST_REMAIN_OFF',
  'functions deploy payment-request-exception-quick-approve',
  'functions deploy notification-dispatcher',
  'SECRETS_UNCHANGED', 'FUNCTIONS_NOT_INVOKED',
]

test('control plane contains all immutable release boundaries', () => {
  for (const marker of required) assert.ok(workflow.includes(marker), `missing marker: ${marker}`)
})

test('database releases use synthetic exact ledger, not global linked push or repair', () => {
  assert.match(workflow, /REMOTE_MIGRATION_HISTORY_INVALID/)
  assert.match(workflow, /prod-history\.txt/)
  assert.match(workflow, /_remote_history\.sql/)
  assert.match(workflow, /TARGET_MIGRATION_ALREADY_PRESENT/)
  assert.doesNotMatch(workflow, /db push --linked/)
  assert.doesNotMatch(workflow, /migration repair/i)
  assert.doesNotMatch(workflow, /db reset/i)
  assert.doesNotMatch(workflow, /supabase link/i)
})

test('preflight and apply are separated by exact confirmation phrases', () => {
  assert.match(workflow, /mode == 'apply'/)
  assert.match(workflow, /mode == 'preflight'/)
  assert.match(workflow, /APPLY_CONFIRMATION_FORBIDDEN_IN_PREFLIGHT/)
  assert.match(workflow, /EXPLICIT_APPLY_CONFIRMATION_REQUIRED/)
  assert.match(workflow, /ZERO_WRITE_PREFLIGHT/)
  assert.match(workflow, /ZERO_WRITE_EDGE_PREFLIGHT/)
})

test('PR547 is DB-first and fail-closed on both tenant identities', () => {
  assert.match(workflow, /PR547_DB_PREREQUISITE_OR_TENANT_IDENTITY_MISSING/)
  assert.match(workflow, /operadora==98/)
  assert.match(workflow, /fersana==62/)
  assert.match(workflow, /ledger==3/)
})

test('PR546 edge deploy requires DB ledger and feature OFF, and never writes secrets', () => {
  assert.match(workflow, /PR546_DB_GATE_NOT_APPLIED/)
  assert.match(workflow, /QUICK_APPROVE_MUST_REMAIN_OFF/)
  assert.match(workflow, /get_payment_request_exception_quick_approval_runtime_config/)
  assert.doesNotMatch(workflow, /vault\.create_secret/i)
  assert.doesNotMatch(workflow, /vault\.update_secret/i)
  assert.doesNotMatch(workflow, /secrets set/i)
  assert.doesNotMatch(workflow, /functions invoke/i)
})

test('business data is snapshotted and protected from unexpected mutation', () => {
  assert.match(workflow, /payment_requests_core_digest/)
  assert.match(workflow, /notification_events_digest/)
  assert.match(workflow, /UNEXPECTED_BUSINESS_DATA_CHANGE/)
  assert.match(workflow, /LEDGER_RECORDED/)
})

test('platform contract itself is PR-only and exact scoped', () => {
  assert.match(contract, /pull_request:/)
  assert.match(contract, /branches:\s*\n\s*- main/)
  assert.match(contract, /Enforce exact three-file platform scope/)
  assert.doesNotMatch(contract, /workflow_dispatch:/)
})
