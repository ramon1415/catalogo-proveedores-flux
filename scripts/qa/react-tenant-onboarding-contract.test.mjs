import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const api = fs.readFileSync('app/src/features/configuracion/api.ts', 'utf8')
const wizard = fs.readFileSync('app/src/features/configuracion/TenantOnboardingWizard.tsx', 'utf8')
const system = fs.readFileSync('app/src/features/configuracion/tabs/SystemTab.tsx', 'utf8')
const companies = fs.readFileSync('app/src/features/configuracion/tabs/EmpresasTab.tsx', 'utf8')
const onboardingApi = api.slice(
  api.indexOf('// ── Onboarding de tenant'),
  api.indexOf('// ── Mapeo CONTPAQ'),
)

test('WS2 reuses the F5 registry and only configures existing companies', () => {
  assert.match(api, /from\('companies'\)[\s\S]*eq\('active', true\)/)
  assert.match(api, /from\('modules'\)[\s\S]*eq\('active', true\)/)
  assert.match(api, /from\('module_releases'\)/)
  assert.match(api, /from\('company_modules'\)/)
  assert.doesNotMatch(onboardingApi, /from\('companies'\)[\s\S]{0,120}\.(?:insert|upsert)\(/)
  assert.doesNotMatch(onboardingApi, /from\('(?:profiles|roles|user_roles|profile_company_memberships)'\)[\s\S]{0,120}\.(?:insert|upsert|update|delete)\(/)
})

test('one confirmed bulk upsert seeds company_modules under the existing unique key', () => {
  assert.match(api, /saveTenantModuleConfiguration/)
  assert.match(api, /\.upsert\(rows, \{ onConflict: 'company_id,module_key' \}\)/)
  assert.match(api, /updated_by: profileId/)
  assert.match(api, /TENANT_ONBOARDING_CONFIGURATION_EMPTY/)
  assert.doesNotMatch(api, /service_role|SUPABASE_SERVICE/)
})

test('wizard is isolated in the Empresas tab and requires review plus confirmation', () => {
  assert.match(companies, /<TenantOnboardingWizard \/>/)
  assert.doesNotMatch(system, /<TenantOnboardingWizard \/>/)
  assert.match(wizard, /Paso \$\{step\} de 3/)
  assert.match(wizard, /Revisar cambios/)
  assert.match(wizard, /Confirmo que esta configuración corresponde únicamente a/)
  assert.match(wizard, /disabled=\{!confirmed \|\| changedDrafts\.length === 0 \|\| status === 'saving'\}/)
})

test('new modules fail closed and payroll is never automatically enabled', () => {
  assert.match(wizard, /enabled: current\?\.enabled \?\? false/)
  assert.match(wizard, /Nómina nunca se habilita automáticamente/)
  assert.match(wizard, /Debe quedar al menos un módulo habilitado/)
  assert.doesNotMatch(wizard, /module_key\s*===\s*['"]nomina['"][\s\S]{0,160}enabled:\s*true/)
})

test('held modules remain locked in the onboarding UI', () => {
  assert.match(wizard, /heldKeys\.has\(module\.module_key\)/)
  assert.match(wizard, /disabled=\{held\}/)
  assert.match(wizard, /En hold:/)
})
