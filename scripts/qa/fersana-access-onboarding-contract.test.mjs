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
const auth = fs.readFileSync('app/src/lib/auth.tsx', 'utf8')
const app = fs.readFileSync('app/src/App.tsx', 'utf8')
const accessPage = fs.readFileSync('app/src/features/access/AccessRequestPage.tsx', 'utf8')
const system = fs.readFileSync('app/src/features/configuracion/tabs/SystemTab.tsx', 'utf8')

test('Fersana access link never exposes a public company directory', () => {
  assert.match(migration, /company_access_links/)
  assert.match(migration, /values \('fersana', v_company_id, true, now\(\)\)/)
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
  assert.match(migration, /company_access_role_not_allowed/)
  assert.match(migration, /v_role_name not in \('solicitante', 'finance', 'director'\)/)
  assert.doesNotMatch(migration, /v_role_name not in \([^)]*admin/)
  assert.match(system, /Solicitudes de acceso por empresa/)
  assert.match(system, /approveAccess\(row, 'solicitante'\)/)
  assert.match(system, /approveAccess\(row, 'finance'\)/)
  assert.match(system, /approveAccess\(row, 'director'\)/)
})

test('approval creates company scope and director pool membership only when requested', () => {
  const approveBlock = migration.slice(
    migration.indexOf('create or replace function public.approve_company_access_request'),
    migration.indexOf('create or replace function public.reject_company_access_request'),
  )
  assert.match(approveBlock, /insert into public\.profile_company_memberships/)
  assert.match(approveBlock, /on conflict \(profile_id, company_id\)[\s\S]*do update set active = true/)
  assert.match(approveBlock, /if v_role_name = 'director' then/)
  assert.match(approveBlock, /insert into public\.company_directors/)
  assert.match(approveBlock, /company_access_profile_already_has_different_role/)
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
