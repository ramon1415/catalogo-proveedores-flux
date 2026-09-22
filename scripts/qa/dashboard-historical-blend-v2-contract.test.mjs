import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const certification = readFileSync('supabase/migrations/20260922151516_historical_actuals_period_certification.sql', 'utf8')
const blend = readFileSync('supabase/migrations/20260922151518_dashboard_historical_blend_v2.sql', 'utf8')
const blendSql = blend.replace(/--.*$/gm, '')

test('historical certification is explicit, fail-closed and not browser-writable', () => {
  assert.match(certification, /status text not null default 'partial'/)
  assert.match(certification, /status in \('certified','partial'\)/)
  assert.match(certification, /status <> 'certified'[\s\S]*certified_at is not null[\s\S]*source_ref/)
  assert.match(certification, /force row level security/)
  assert.match(certification, /revoke all on table public\.historical_actuals_periods from public, anon, authenticated/)
  assert.match(certification, /grant select, insert, update, delete on table public\.historical_actuals_periods to service_role/)
  assert.doesNotMatch(certification, /insert into public\.historical_actuals_periods/i)
})

test('historical spend uses accounting nature plus major level, not prefixes or names', () => {
  assert.match(blend, /replace\(ha\.account_code, '-', ''\)/)
  assert.match(blend, /a\.tipo = 'G'/)
  assert.match(blend, /a\.cta_mayor = 2/)
  assert.match(blend, /'por_clasificar'/)
  assert.match(blend, /'sin_partida'/)
  assert.doesNotMatch(blendSql, /5080000|devoluciones sobre ventas/i)
  assert.doesNotMatch(blendSql, /account_code\s+like\s+'[56]%'/i)
})

test('certified month replaces Flux and payroll obligations instead of adding to them', () => {
  assert.match(blend, /from public\.historical_actuals_periods hp[\s\S]*hp\.status = 'certified'/)
  assert.match(blend, /from public\.payment_requests pr[\s\S]*not exists \([\s\S]*certified_months/)
  assert.match(blend, /from public\.payroll_obligations o[\s\S]*not exists \([\s\S]*certified_months/)
  assert.match(blend, /h\.historical_executed,[\s\n ]*h\.historical_executed/)
  assert.match(blend, /then 'historical'[\s\S]*else 'flux'/)
})

test('v2 is isolated from transactional budget controls and v1', () => {
  assert.match(blend, /private\.dashboard_global_budget_report_v2/)
  assert.match(blend, /public\.dashboard_global_budget_report_v2/)
  assert.doesNotMatch(blendSql, /budget_availability/)
  assert.doesNotMatch(blendSql, /create or replace function public\.dashboard_global_budget_report\s*\(/)
  assert.doesNotMatch(blendSql, /create or replace function private\.dashboard_global_budget_report\s*\(/)
  assert.match(blend, /dashboard_assert_access\(\)/)
  assert.match(blend, /company_access_required/)
})
