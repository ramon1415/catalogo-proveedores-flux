import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync('supabase/migrations/20260901055111_company_scoped_roles_foundation.sql', 'utf8')
const hardening = readFileSync('supabase/migrations/20260901070846_company_scoped_power_override_hardening.sql', 'utf8')
const auth = readFileSync('app/src/lib/auth.tsx', 'utf8')
const platformPower = readFileSync('app/src/lib/platformPower.ts', 'utf8')
const company = readFileSync('app/src/lib/company.tsx', 'utf8')
const api = readFileSync('app/src/features/configuracion/api.ts', 'utf8')
const users = readFileSync('app/src/features/configuracion/tabs/UsersPanel.tsx', 'utf8')
const matrix = readFileSync('prod-readiness/company-role-matrix.md', 'utf8')
const cutover = readFileSync('prod-readiness/paso1c-company-role-cutover-preflight.sql', 'utf8')

test('membership owns the canonical company role and platform power is allowlisted', () => {
  assert.match(migration, /add column if not exists role_key text/)
  assert.match(migration, /role_key in \('operator', 'finance', 'director', 'sysadmin'\)/)
  assert.match(migration, /private\.profile_has_company_role/)
  assert.match(migration, /carlos@quantta\.mx/)
  assert.match(migration, /ramon@quantta\.mx/)
  assert.match(migration, /approved platform-power email/)
  assert.doesNotMatch(migration, /delete\s+from\s+public\.user_roles/i)
  assert.doesNotMatch(migration, /insert\s+into\s+public\.user_roles/i)
})

test('database and SPA reserve platform power for Carlos and Ramon', () => {
  for (const email of ['carlos@quantta.mx', 'ramon@quantta.mx']) {
    const escaped = email.replace('.', '\\.')
    assert.match(migration, new RegExp(escaped))
    assert.match(hardening, new RegExp(escaped))
    assert.match(platformPower, new RegExp(escaped))
  }
  assert.match(hardening, /security definer\s+set search_path = ''/i)
  assert.match(hardening, /company_role_power_override_hardening_failed/)
  assert.match(auth, /hasPlatformPowerEmail/)
  assert.match(platformPower, /PLATFORM_POWER_EMAILS\.has/)
})

test('access approval and admin edits write the exact company membership role', () => {
  assert.match(migration, /perform public\.set_profile_company_role/)
  assert.match(migration, /do update set role_key = excluded\.role_key, active = excluded\.active/)
  assert.doesNotMatch(migration, /company_access_profile_already_has_different_role/)
  assert.match(api, /rpc\('set_profile_company_role'/)
  assert.match(users, /El cambio aplica únicamente a esta empresa/)
  assert.match(users, /Aprobar: Operador/)
})

test('the SPA recomputes effective permissions when the company changes', () => {
  assert.match(auth, /effectiveMembership/)
  assert.match(auth, /globalGroup === ROLE_GROUPS\.SYSADMIN/)
  assert.match(auth, /effectiveMembership\?\.role/)
  assert.match(auth, /flux:company-change/)
  assert.match(company, /dispatchEvent\(new CustomEvent\('flux:company-change'/)
})

test('authorized people matrix is frozen without guessing unresolved emails', () => {
  for (const email of [
    'ynavarrete@soportef.com',
    'afajardo@soportef.com',
    'denise@quantta.mx',
    'agalvan@fluxfinanciera.com',
    'cesar@quantta.mx',
    'lisette@dezdez.earth',
    'ychavez@fluxfinanciera.com',
    'carlos@quantta.mx',
    'ramon@quantta.mx',
  ]) assert.match(matrix, new RegExp(email.replace('.', '\\.')))
  assert.match(matrix, /Gerardo \| Pendiente de correo exacto/)
  assert.doesNotMatch(matrix, /Denise \| Pendiente de correo exacto/)
  assert.doesNotMatch(matrix, /Ara \| Pendiente de correo exacto/)
  assert.match(matrix, /Yanin \| `ynavarrete@soportef\.com` \| Finanzas \| Finanzas/)
  assert.match(matrix, /Alfredo \| `afajardo@soportef\.com` \| Finanzas \| Finanzas/)
})

test('cutover remains fail-closed until global business-role dependencies are gone', () => {
  assert.match(cutover, /^begin;/m)
  assert.match(cutover, /set transaction read only;/)
  assert.match(cutover, /^rollback;/m)
  assert.match(cutover, /company_role_preflight_legacy_policy_blockers/)
  assert.match(cutover, /company_role_preflight_legacy_function_blockers/)
  assert.match(cutover, /company_role_preflight_unauthorized_global_power/)
  assert.match(cutover, /carlos@quantta\.mx/)
  assert.match(cutover, /ramon@quantta\.mx/)
})
