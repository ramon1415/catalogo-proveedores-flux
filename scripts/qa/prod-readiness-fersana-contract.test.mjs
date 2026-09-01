import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const readme = readFileSync('prod-readiness/README.md', 'utf8')
const seed = readFileSync('prod-readiness/paso5-fersana-seed.sql', 'utf8')
const responsibles = readFileSync('prod-readiness/paso5b-fersana-responsables.sql', 'utf8')
const isolation = readFileSync('prod-readiness/paso6-ensayo-aislamiento.sql', 'utf8')

test('runbook prepares backend and auth before exposing the React app', () => {
  const migrations = readme.indexOf('| **1** | Migraciones aditivas')
  const auth = readme.indexOf('| **3** | Auth prod')
  const frontend = readme.indexOf('| **5** | Frontend `/app`')

  assert.ok(migrations >= 0)
  assert.ok(auth > migrations)
  assert.ok(frontend > auth)
  assert.match(readme, /20260831130000_budget_category_responsible\.sql/)
  assert.match(readme, /paso5b-fersana-responsables\.sql/)
  assert.match(readme, /versión, SHA-256, `verify_jwt`/)
})

test('Fersana seed is rerun-safe, fail-closed and matches the DEV module scope', () => {
  assert.match(seed, /\('incidencias', false, 1, 'stable'\)/)
  assert.match(seed, /\('ingresos', false, 1, 'stable'\)/)
  assert.match(seed, /\('nomina', false, 1, 'stable'\)/)
  assert.match(seed, /where not exists \([\s\S]*existing\.budget_month = d\.m::date/)
  assert.match(seed, /v_count <> 322 or v_total <> 6289204\.00/)
  assert.doesNotMatch(seed, /delete from budget_lines/i)

  const categoryBlock = seed.slice(
    seed.indexOf('insert into budget_categories'),
    seed.indexOf('-- 6) Presupuesto 2026'),
  )
  const codes = [...categoryBlock.matchAll(/'SF-2026-(\d{3})'/g)].map((match) => match[1])
  assert.equal(new Set(codes).size, 60)
  assert.match(categoryBlock, /insert into company_cost_center_budget_categories/)
  assert.match(categoryBlock, /on conflict \(company_id, cost_center_id, budget_category_id\)/)
})

test('responsibility seed covers all five owners and validates 60 of 60', () => {
  for (const email of [
    'afajardo@soportef.com',
    'contabilidad2@soportef.com',
    'lisette@dezdez.earth',
    'ychavez@fluxfinanciera.com',
    'ynavarrete@soportef.com',
  ]) {
    assert.match(responsibles, new RegExp(email.replace('.', '\\.')))
  }

  const accountingRows = responsibles.match(/'contabilidad2@soportef\.com'/g) || []
  assert.equal(accountingRows.length, 5)
  assert.match(responsibles, /v_total <> 60 or v_with_email <> 60/)
})

test('isolation rehearsal is rerun-safe and removes every disposable company scope', () => {
  assert.match(isolation, /not exists \([\s\S]*t\.payer_name='ZZ Pagador'/)
  for (const table of [
    'tenant_income_entries',
    'recurring_income_templates',
    'company_access_requests',
    'company_access_links',
    'approver_assignments',
    'company_directors',
    'profile_company_memberships',
    'company_modules',
  ]) {
    assert.match(isolation, new RegExp(`delete from ${table}`))
  }
  assert.match(isolation, /No borrar automáticamente el profile/)
  assert.match(isolation, /delete from companies where rfc='ZZA010101ZZ0'/)
})
