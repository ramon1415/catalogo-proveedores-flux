import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const dir = 'supabase/migrations/'
const read = (file) => readFileSync(dir + file, 'utf8')
const ddlMd5 = (file) => createHash('md5')
  .update(read(file).replace(/--[^\n]*/g, '').replace(/\s/g, ''))
  .digest('hex')

const applied = {
  '20260902210503_reembolsos_beneficiario_empleado.sql': 'f7ab37e21ce70613db68a23d26b3d098',
  '20260902211421_reimbursement_items_partida_obligatoria.sql': 'a8d763a9d4c0a50d24c8a95a3d94dd36',
  '20260902212059_reembolsos_servidor_create_request.sql': '00905b96b4ba1fb035153cda4441612b',
  '20260902212126_reembolsos_servidor_layout_missing_fields.sql': '22d39f84c2cf53012306b1288a4909d2',
  '20260902212214_reembolsos_layout_candidates_destino_empleado.sql': '304a44ea1cf5ed6fdc33641636bda29f',
  '20260902212626_proyectos_catalogo.sql': '90df6dc857698562ce7f654417b92cc1',
}

test('the six DEV migrations are versioned with their exact normalized DDL', () => {
  for (const [file, hash] of Object.entries(applied)) {
    assert.ok(existsSync(dir + file), `missing ${file}`)
    assert.equal(ddlMd5(file), hash, `${file} differs from DEV`)
  }
  assert.equal(existsSync(dir + '20260902180000_reembolsos_beneficiario_empleado.sql'), false)
  assert.equal(existsSync(dir + '20260902200000_reembolsos_servidor.sql'), false)
})

test('the forward fix isolates bank data, reimbursement UUIDs and projects by company', () => {
  const sql = read('20260902224339_reimbursements_projects_tenant_hardening.sql')
  assert.match(sql, /employee_bank_accounts[\s\S]*add column if not exists company_id uuid/i)
  assert.match(sql, /primary key \(profile_id, company_id\)/i)
  assert.match(sql, /reimbursement_items[\s\S]*add column if not exists company_id uuid/i)
  assert.match(sql, /reimbursement_items_company_uuid_unique[\s\S]*\(company_id, upper\(invoice_uuid\)\)/i)
  assert.match(sql, /payment_requests_project_company_fkey[\s\S]*foreign key \(company_id, project_id\)/i)
  assert.match(sql, /beneficiary_company_membership_required/i)
  assert.match(sql, /list_reimbursement_beneficiaries/i)
  assert.match(sql, /membership\.company_id = p_company_id/i)
  assert.match(sql, /for select to authenticated/i)
  assert.match(sql, /for insert to authenticated/i)
  assert.match(sql, /for update to authenticated/i)
  assert.doesNotMatch(sql, /create policy[^;]*for all/i)
  assert.match(sql, /revoke all on function public\.approval_batch_payment_layout_candidates/i)
  assert.match(sql, /beneficiary_bank\.company_id = candidate\.company_id/i)
  assert.match(sql, /eba\.company_id = p_request\.company_id/i)
  assert.doesNotMatch(sql, /migration repair|db reset|supabase_migrations/i)
})

test('the SPA always scopes employee bank data and reimbursement items to the active request company', () => {
  const api = readFileSync('app/src/features/solicitudes/api.ts', 'utf8')
  const modal = readFileSync('app/src/features/solicitudes/RequestModal.tsx', 'utf8')
  const layouts = readFileSync('app/src/features/layouts/api.ts', 'utf8')
  assert.match(api, /loadEmployeeBankAccount\(profileId: string, companyId: string\)/)
  assert.match(api, /loadActiveProfiles\(companyId: string\)[\s\S]*list_reimbursement_beneficiaries/)
  assert.match(api, /\.eq\('profile_id', profileId\)[\s\S]*\.eq\('company_id', companyId\)/)
  assert.match(api, /onConflict: 'profile_id,company_id'/)
  assert.match(modal, /company_id: payload\.company_id!/)
  assert.match(layouts, /\.eq\('profile_id', row\.beneficiary_profile_id\)[\s\S]*\.eq\('company_id', row\.company_id\)/)
})
