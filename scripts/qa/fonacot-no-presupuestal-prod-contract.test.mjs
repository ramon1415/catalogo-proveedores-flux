import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const migrationsDir = 'supabase/migrations'
const migrationNames = fs.readdirSync(migrationsDir)
const coreName = migrationNames.find((name) => name.endsWith('_fonacot_no_presupuestal_prod.sql'))
const fersanaName = migrationNames.find((name) => name.endsWith('_fonacot_fersana_mapping_prod.sql'))

assert.ok(coreName, 'missing PROD FONACOT core migration')
assert.ok(fersanaName, 'missing PROD FONACOT Fersana mapping migration')

const migration = fs.readFileSync(path.join(migrationsDir, coreName), 'utf8')
const fersanaMapping = fs.readFileSync(path.join(migrationsDir, fersanaName), 'utf8')
const api = fs.readFileSync('app/src/features/solicitudes/api.ts', 'utf8')
const logic = fs.readFileSync('app/src/features/solicitudes/logic.ts', 'utf8')
const types = fs.readFileSync('app/src/features/solicitudes/types.ts', 'utf8')
const requestModal = fs.readFileSync('app/src/features/solicitudes/RequestModal.tsx', 'utf8')
const rollback = fs.readFileSync('scripts/rollback/20260903_fonacot_prod.sql', 'utf8')

test('catalog and request keep separate no-budget flags', () => {
  assert.match(migration, /alter table public\.budget_categories[\s\S]*no_presupuestal boolean not null default false/)
  assert.match(migration, /alter table public\.payment_requests[\s\S]*no_presupuestal boolean not null default false/)
  assert.match(migration, /no_presupuestal_snapshot_immutable/)
})

test('no-budget bypass remains tenant-mapped and amount-valid', () => {
  const matchPosition = migration.indexOf("'sin_match_presupuesto'")
  const bypassPosition = migration.indexOf("'motivo', 'no_presupuestal'")
  assert.ok(matchPosition > -1 && bypassPosition > matchPosition)
  assert.match(migration, /if p_amount is null or p_amount <= 0/)
  assert.match(migration, /relation\.company_id = p_company_id[\s\S]*relation\.cost_center_id = p_cost_center_id[\s\S]*relation\.budget_category_id = p_budget_category_id/)
})

test('budget calculations and approval revalidation use the immutable snapshot', () => {
  assert.match(migration, /and not pr\.no_presupuestal/)
  assert.match(migration, /alter view public\.budget_availability set \(security_invoker = true\)/)
  assert.match(migration, /public\.verify_budget_availability\([\s\S]*v_request\.no_presupuestal/)
  assert.match(migration, /coalesce\(v_request\.subtotal_amount, v_request\.amount_requested, 0\)/)
})

test('seed maps only FONACOT to Operadora and Fersana by natural keys', () => {
  assert.match(migration, /'FONACOT', 'FONACOT', 'Recursos Humanos', null, true, true/)
  assert.match(migration, /lower\(btrim\(company\.name\)\) = 'operadora tlacatecpan'/)
  assert.match(migration, /lower\(btrim\(cost_center\.name\)\) = 'rancho san juan tlacatecpan'/)
  assert.doesNotMatch(migration, /update public\.budget_categories[\s\S]*(?:carga social|\bisn\b)/i)
  assert.match(fersanaMapping, /lower\(btrim\(name\)\) = 'soporte fersana'/)
  assert.match(fersanaMapping, /update public\.company_cost_centers[\s\S]*if not found then[\s\S]*insert into public\.company_cost_centers/)
  assert.match(fersanaMapping, /insert into public\.company_cost_center_budget_categories/)
})

test('React exposes mapped no-budget categories without a budget line', () => {
  assert.match(api, /from\('budget_categories'\)[\s\S]*eq\('no_presupuestal', true\)/)
  assert.match(api, /syntheticRows/)
  assert.match(api, /no_presupuestal: true/)
  assert.match(logic, /return `\$\{label\} \| No presupuestal`/)
  assert.match(logic, /decision === 'aprobable' && reason === 'no_presupuestal'/)
  assert.match(types, /no_presupuestal\?: boolean \| null/)
  assert.match(requestModal, /availability \? budgetCategoryAvailabilityLabel\(category, availability\)/)
  assert.match(requestModal, /Esta partida no consume presupuesto y seguirá el flujo normal de autorización\./)
})

test('FONACOT remains visible in Fersana even when other categories are scoped by responsible', () => {
  assert.match(
    requestModal,
    /if \(r\.no_presupuestal\) return true[\s\S]*return emails\.includes\(myEmail\)/,
  )
  assert.ok(
    requestModal.indexOf('if (r.no_presupuestal) return true')
      < requestModal.indexOf('return emails.includes(myEmail)'),
    'the no-budget bypass must run before responsible-email filtering',
  )
})

test('rollback disables FONACOT exposure without deleting request history', () => {
  assert.match(rollback, /update public\.company_cost_center_budget_categories/)
  assert.match(rollback, /update public\.budget_categories[\s\S]*set active = false/)
  assert.doesNotMatch(rollback, /\b(?:drop|delete|truncate)\b/i)
})
