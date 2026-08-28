import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const edge = fs.readFileSync('supabase/functions/payroll-materialize/index.ts', 'utf8')
const vanilla = fs.readFileSync('payroll_capture.js', 'utf8')
const reactApi = fs.readFileSync('app/src/features/nomina/api.ts', 'utf8')
const reactModal = fs.readFileSync('app/src/features/nomina/CaptureModal.tsx', 'utf8')

test('revalidation is hard-gated to the DEV Supabase project and a materialized capture', () => {
  assert.match(edge, /DEV_PROJECT_REF = "scsirgbuqjcwoaxfacth"/)
  assert.match(edge, /validationOnly&&projectRef\(base\)!==DEV_PROJECT_REF/)
  assert.match(edge, /PAYROLL_DEV_REVALIDATION_REQUIRED/)
  assert.match(edge, /validationOnly&&context\.capture_state!=="materialized"/)
  assert.match(edge, /PAYROLL_MATERIALIZED_CAPTURE_REQUIRED/)
})

test('revalidation preserves JWT and Finance authorization and runs every authoritative parser', () => {
  assert.match(edge, /token=bearer\(req\)/)
  assert.match(edge, /requireFinanceCaptureAccess\(base,serviceKey,token,input\.capture_session_id\)/)
  assert.match(edge, /for\(const file of context\.files\) verified\.set\(file\.kind,await verifyFile/)
  assert.match(edge, /FluxPayrollRealReconcile\.reconcilePackage/)
  assert.match(edge, /FluxPayrollProvisionBase\.parseProvisionBaseXlsx/)
})

test('validate_only returns only aggregate safe fields before the mutating RPC', () => {
  const validationBranch = edge.match(/if\(validationOnly\)\{[\s\S]*?\n    \}/)?.[0] || ''
  assert.match(validationBranch, /status:"validated"/)
  for (const key of ['file_count','employee_record_count','channels','employee_net_total_minor','treasury_total_minor','provision_base_amount_minor','parser_versions']) {
    assert.ok(validationBranch.includes(key), key)
  }
  assert.doesNotMatch(validationBranch, /employee_name|rfc|curp|nss|bank_account|clabe|storage_path|sha256/)
  assert.ok(edge.indexOf('if(validationOnly){', edge.indexOf('reconcilePackage')) < edge.lastIndexOf('materialize_payroll_capture_internal'))
})

test('both current and React capture UIs request validate_only without an idempotency key', () => {
  assert.match(vanilla, /mode:'validate_only'/)
  assert.match(vanilla, /Revalidar paquete en servidor/)
  assert.match(vanilla, /isDevSupabaseProject\(\)/)
  assert.match(reactApi, /mode: 'validate_only'/)
  assert.match(reactModal, /Revalidar paquete en servidor/)
  assert.match(reactModal, /locked && isFinance && isDevSupabaseProject/)
})

test('revalidation client paths do not invoke business-state RPCs', () => {
  const vanillaFn = vanilla.match(/async function revalidateMaterializedCapture\(\)[\s\S]*?\n  \}/)?.[0] || ''
  const reactFn = reactApi.match(/export async function revalidateMaterializedCapture[\s\S]*?\n\}/)?.[0] || ''
  assert.doesNotMatch(vanillaFn, /\.rpc\(/)
  assert.doesNotMatch(reactFn, /\.rpc\(/)
  assert.doesNotMatch(vanillaFn + reactFn, /approve|submit|dispers|notification/i)
})
