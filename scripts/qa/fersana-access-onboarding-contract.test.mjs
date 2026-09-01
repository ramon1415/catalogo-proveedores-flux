import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const migration = fs.readFileSync(
  'supabase/migrations/20260831003419_fersana_company_access_onboarding.sql',
  'utf8',
)
const hardening = fs.readFileSync(
  'supabase/migrations/20260831005200_fersana_company_access_advisor_hardening.sql',
  'utf8',
)
const scopedRoles = fs.readFileSync(
  'supabase/migrations/20260901055111_company_scoped_roles_foundation.sql',
  'utf8',
)
const productionSeed = fs.readFileSync('prod-readiness/paso5-fersana-seed.sql', 'utf8')
const auth = fs.readFileSync('app/src/lib/auth.tsx', 'utf8')
const app = fs.readFileSync('app/src/App.tsx', 'utf8')
const accessPage = fs.readFileSync('app/src/features/access/AccessRequestPage.tsx', 'utf8')
const usersPanel = fs.readFileSync('app/src/features/configuracion/tabs/UsersPanel.tsx', 'utf8')

test('Fersana access link never exposes a public company directory', () => {
  assert.match(migration, /company_access_links/)
  assert.match(productionSeed, /select 'fersana', c\.id, true, now\(\)[\s\S]*where c\.rfc = 'SFE100825TM9'/)
  assert.match(migration, /revoke all on table public\.company_access_links from public, anon, authenticated/)
  assert.doesNotMatch(accessPage, /from\(['"]companies['"]\)/)
  assert.match(app, /pathname\.match\(\/\^\\\/acceso\\\//)
  assert.match(hardening, /company_access_links_no_direct_access/)
  assert.match(hardening, /as restrictive[\s\S]*using \(false\)[\s\S]*with check \(false\)/)
})

test('authenticated profile bootstrap is server validated and least privilege', () => {
  const ensureBlock = migration.slice(
    migration.indexOf('create or replace function public.ensure_current_profile'),
    migration.indexOf('create or replace function public.request_company_access'),
  )
  assert.match(ensureBlock, /v_auth_user_id uuid := auth\.uid\(\)/)
  assert.match(ensureBlock, /from auth\.users u/)
  assert.match(ensureBlock, /profile_email_already_linked/)
  assert.match(migration, /revoke all on function public\.ensure_current_profile\(\) from public, anon/)
  assert.match(migration, /grant execute on function public\.ensure_current_profile\(\) to authenticated/)
  assert.match(auth, /rpc\('ensure_current_profile'\)/)
  assert.doesNotMatch(ensureBlock, /raw_user_meta_data[\s\S]{0,100}(?:role|company|permission)/i)
})

test('access requests are own-row readable and admin-reviewed through guarded RPCs', () => {
  assert.match(migration, /alter table public\.company_access_requests enable row level security/)
  assert.match(migration, /profile_id = public\.current_profile_id\(\)/)
  assert.match(migration, /current_user_has_role\(public\.flux_sysadmin_roles\(\)\)/)
  assert.match(scopedRoles, /company_access_role_not_allowed/)
  assert.match(scopedRoles, /v_role not in \('operator', 'finance', 'director'\)/)
  assert.doesNotMatch(scopedRoles, /v_role not in \([^)]*admin/)
  assert.match(usersPanel, /r\.profile_id === profileId && r\.status === 'pending'/)
  assert.match(usersPanel, /approveAccess\(row, 'operator'\)/)
  assert.match(usersPanel, /approveAccess\(row, 'finance'\)/)
  assert.match(usersPanel, /approveAccess\(row, 'director'\)/)
  assert.match(usersPanel, /rejectAccess\(row\)/)
})

test('approval creates company scope and director pool membership only when requested', () => {
  const approveBlock = scopedRoles.slice(
    scopedRoles.indexOf('create or replace function public.approve_company_access_request'),
    scopedRoles.indexOf('comment on function private.profile_has_company_role'),
  )
  assert.match(approveBlock, /perform public\.set_profile_company_role/)
  assert.doesNotMatch(approveBlock, /company_access_profile_already_has_different_role/)
  assert.doesNotMatch(approveBlock, /delete from public\.user_roles/)
})

test('pending React sessions receive an explicit gate instead of a fail-open module shell', () => {
  assert.match(app, /group === 'pending'/)
  assert.match(app, /memberships\.length === 0/)
  assert.match(app, /<PendingAccessPage \/>/)
  assert.match(accessPage, /Solicitud enviada/)
  assert.match(accessPage, /Actualizar acceso/)
})

test('existing members skip the landing and enter the linked company directly', () => {
  assert.match(accessPage, /result\.status === 'already_member'/)
  assert.match(accessPage, /result\.status === 'approved'/)
  assert.match(accessPage, /setCompany\(result\.company_id\)/)
  assert.match(accessPage, /window\.location\.replace\('\/app\/solicitudes'\)/)
  assert.doesNotMatch(accessPage, /Acceso disponible/)
})

test('company access request foreign keys have covering indexes', () => {
  assert.match(hardening, /company_access_requests_company_id_idx/)
  assert.match(hardening, /company_access_requests \(company_id\)/)
  assert.match(hardening, /company_access_requests_reviewed_by_idx/)
  assert.match(hardening, /company_access_requests \(reviewed_by\)/)
})
