import assert from 'node:assert/strict'
import test from 'node:test'
import { databaseCatalog, functionMetadata, assertRpcAccess } from '../database-catalog.mjs'

test('deployed income tables keep RLS and CRUD without anonymous or table-wide privileges', () => {
  const catalog = databaseCatalog()
  for (const name of ['recurring_income_templates', 'tenant_income_entries']) {
    const table = catalog.tables.find(t => t.name === name)
    assert.ok(table, name)
    assert.equal(table.rls, true, `${name}: RLS`)
    assert.equal(table.anon_select, false, `${name}: anonymous SELECT`)
    assert.equal(table.anon_write_or_broad, false, `${name}: anonymous write/table-wide privileges`)
    for (const verb of ['select', 'insert', 'update', 'delete']) {
      assert.equal(table[`authenticated_${verb}`], true, `${name}: authenticated ${verb}`)
    }
    assert.equal(table.authenticated_broad, false, `${name}: authenticated TRUNCATE/TRIGGER/REFERENCES`)
    assert.equal(table.service_crud, true, `${name}: service CRUD`)
    assert.equal(table.service_broad, false, `${name}: service TRUNCATE/TRIGGER/REFERENCES`)
  }
})

test('deployed income FK enforces company identity and retains the income when a template is deleted', () => {
  const catalog = databaseCatalog()
  const fk = catalog.constraints.find(c => c.table === 'tenant_income_entries' && c.name === 'tenant_income_entries_company_template_fk')
  assert.ok(fk?.validated && fk.type === 'f', 'validated company/template foreign key')
  assert.match(fk.definition, /FOREIGN KEY \(company_id, template_id\) REFERENCES (?:public\.)?recurring_income_templates\(company_id, id\) ON DELETE SET NULL \(template_id\)/)
  const parent = catalog.indexes.find(i => i.name === 'recurring_income_templates_company_id_id_uidx')
  assert.ok(parent?.valid && parent.unique, 'valid parent uniqueness')
  assert.match(parent.definition, /\(company_id, id\)/)
  const child = catalog.indexes.find(i => i.name === 'tenant_income_entries_company_template_idx')
  assert.ok(child?.valid, 'valid FK support index')
  assert.match(child.definition, /\(company_id, template_id\)/)
})

test('deployed generator requires a session and membership and keeps explicit RPC privileges', () => {
  assertRpcAccess('generate_recurring_income', { authenticated: true, service: true })
  const fn = functionMetadata('generate_recurring_income')
  assert.ok(fn.config.includes('search_path=public, pg_temp'))
  assert.match(fn.body, /if\s+auth\.uid\(\) is null\s+or not public\.has_active_company_membership\(public\.current_profile_id\(\), p_company_id\) then\s+raise exception 'not_authorized' using errcode = '42501'/i)
})
