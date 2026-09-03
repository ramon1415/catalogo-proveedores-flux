import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const migration = fs.readFileSync(
  'supabase/migrations/20260903041213_fonacot_no_presupuestal.sql',
  'utf8',
)
const fersanaMappingFile = fs.readdirSync('supabase/migrations')
  .find((file) => file.endsWith('_fonacot_fersana_mapping.sql'))
assert.ok(fersanaMappingFile, 'missing FONACOT mapping migration for Fersana')
const fersanaMapping = fs.readFileSync(
  `supabase/migrations/${fersanaMappingFile}`,
  'utf8',
)
const api = fs.readFileSync('app/src/features/solicitudes/api.ts', 'utf8')
const logic = fs.readFileSync('app/src/features/solicitudes/logic.ts', 'utf8')
const types = fs.readFileSync('app/src/features/solicitudes/types.ts', 'utf8')

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

test('seed is natural-keyed and only marks FONACOT as pass-through', () => {
  assert.match(migration, /'FONACOT', 'FONACOT', 'Recursos Humanos', null, true, true/)
  assert.match(migration, /lower\(btrim\(company\.name\)\) = 'operadora tlacatecpan'/)
  assert.match(migration, /lower\(btrim\(cost_center\.name\)\) = 'rancho san juan tlacatecpan'/)
  assert.doesNotMatch(migration, /update public\.budget_categories[\s\S]*(?:carga social|\bisn\b)/i)
})

test('FONACOT is mapped to Soporte Fersana with natural keys', () => {
  assert.match(fersanaMapping, /lower\(btrim\(company\.name\)\) = 'soporte fersana'/)
  assert.match(fersanaMapping, /lower\(btrim\(cost_center\.name\)\) = 'soporte fersana'/)
  assert.match(fersanaMapping, /category\.code = 'FONACOT'/)
  assert.match(fersanaMapping, /category\.no_presupuestal/)
  assert.match(fersanaMapping, /on conflict \(company_id, cost_center_id, budget_category_id\)[\s\S]*do update set active = true/)
  assert.doesNotMatch(fersanaMapping, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)
})

test('React exposes mapped no-budget categories without a budget line', () => {
  assert.match(api, /from\('budget_categories'\)[\s\S]*eq\('no_presupuestal', true\)/)
  assert.match(api, /syntheticRows/)
  assert.match(api, /no_presupuestal: true/)
  assert.match(logic, /return `\$\{label\} \| No presupuestal`/)
  assert.match(logic, /decision === 'aprobable' && reason === 'no_presupuestal'/)
  assert.match(types, /no_presupuestal\?: boolean \| null/)
})
