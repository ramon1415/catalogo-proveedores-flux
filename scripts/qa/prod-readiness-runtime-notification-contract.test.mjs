import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('runbook uses the deployed FLUX runtime contract and scoped Auth redirects', async () => {
  const source = await read('prod-readiness/README.md')

  assert.match(source, /FLUX_SUPABASE_URL/)
  assert.match(source, /FLUX_SUPABASE_ANON_KEY/)
  assert.match(source, /FLUX_ENV=prod/)
  assert.match(source, /https:\/\/flux\.quantta\.mx\/app\/\*\*/)
  assert.match(source, /https:\/\/ucantptjhwttexzmslvm\.supabase\.co\/auth\/v1\/callback/)
  assert.doesNotMatch(source, /verificar `VITE_SUPABASE_URL`/)
})

test('edge matrix freezes the environment-specific production bundles', async () => {
  const source = await read('prod-readiness/paso2-edge-functions-matrix.md')

  assert.match(source, /notification-dispatcher` \| v50/)
  assert.match(source, /v12 · `4221d1a2226096ceff446920f2b44816289ce48efc1afe92bdf71d6b8af7a02e`/)
  assert.match(source, /approval-batch-quick-approve` \| v3/)
  assert.match(source, /v1 · `acef4653bb189290caaf7e8af753109406af48247b83c53788e7ade686a4c9f3`/)
  assert.match(source, /cero Edge Functions por desplegar/)
  assert.match(source, /Nómina permanece apagada/)
})

test('production recovery is cutoff-bound, fail-closed and project-pinned', async () => {
  const source = await read('prod-readiness/paso2b-notification-recovery-prod.sql')

  assert.match(source, /^begin;/m)
  assert.match(source, /^commit;/m)
  assert.match(source, /notification_payment_request_approved_dispatch_after_insert/)
  assert.match(source, /new\.event_type = 'payment_request\.approved'/)
  assert.match(source, /notification-prod-recovery/)
  assert.match(source, /'\*\/5 \* \* \* \*'/)
  assert.match(source, /notification_payment_request_created_recovery_enabled/)
  assert.match(source, /notification_approval_batch_submitted_recovery_enabled/)
  assert.match(source, /notification_approval_batch_decision_recovery_enabled/)
  assert.match(source, /notification_payment_outcome_recovery_enabled/)
  assert.match(source, /https:\/\/ucantptjhwttexzmslvm\.supabase\.co\/functions\/v1\//)
  assert.match(source, /revoke all on function public\.notification_prod_recovery_wakeup_internal\(\)/)
  assert.doesNotMatch(source, /catalogo-proveedores-flux-git-dev/)
  assert.doesNotMatch(source, /test_only/)
  assert.doesNotMatch(source, /api\.resend\.com/)
})
