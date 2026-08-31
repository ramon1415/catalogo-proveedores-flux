import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../../supabase/migrations/20260831033300_operator_own_payment_requests.sql',
  import.meta.url,
)
const pageUrl = new URL('../../app/src/features/solicitudes/SolicitudesPage.tsx', import.meta.url)

const migration = await readFile(migrationUrl, 'utf8')
const page = await readFile(pageUrl, 'utf8')
const selectPolicy = migration.match(/create policy payment_requests_select[\s\S]*?create index/i)?.[0] ?? ''

test('RLS limita al solicitante por creador y membresía activa', () => {
  assert.match(migration, /requested_by\s*=\s*\(select public\.current_profile_id\(\)\)/i)
  assert.match(migration, /public\.has_active_company_membership\(/i)
  assert.ok(selectPolicy)
  assert.doesNotMatch(selectPolicy, /approver_id\s*=/i)
})

test('RLS preserva los alcances explícitos de aprobación y SysAdmin', () => {
  assert.match(migration, /public\.flux_approver_roles\(\)/i)
  assert.match(migration, /public\.flux_sysadmin_roles\(\)/i)
})

test('la política está indexada y contiene un postcheck fail-closed', () => {
  assert.match(migration, /payment_requests_requested_by_company_id_idx/i)
  assert.match(migration, /operator_own_payment_requests_policy_postcheck_failed/i)
  assert.match(migration, /^begin;$/m)
  assert.match(migration, /^commit;$/m)
})

test('React aplica defensa en profundidad para el grupo operativo', () => {
  assert.match(page, /group === ROLE_GROUPS\.OPERATION/)
  assert.match(page, /request\.requested_by === currentProfileId/)
  assert.match(page, /request\.company_id === activeCompanyId/)
})
