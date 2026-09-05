import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const logic=readFileSync('app/src/features/configuracion/logic.ts','utf8')
const schema=readFileSync('supabase/migrations/20260905220000_contpaq_dark_launch_schema_prod.sql','utf8')
const seed=readFileSync('supabase/migrations/20260905220100_contpaq_dark_launch_seed_prod.sql','utf8')
const api=readFileSync('app/src/features/configuracion/api.ts','utf8')

test('dark launch UI is SysAdmin only',()=>{
  assert.match(logic,/contpaq:\s*\[ROLE_GROUPS\.SYSADMIN\]/)
  assert.doesNotMatch(logic,/contpaq:\s*\[[^\]]*ROLE_GROUPS\.ADMIN/)
  assert.doesNotMatch(logic,/contpaq:\s*\[[^\]]*ROLE_GROUPS\.DIRECTION/)
})
test('schema is additive and dedicated',()=>{
  assert.match(schema,/contpaq_dark_launch_access/)
  assert.match(schema,/add column if not exists cfdi_data jsonb/)
  assert.doesNotMatch(schema,/create or replace function public\.create_payment_request/)
  assert.doesNotMatch(schema,/reimbursement_items/)
  assert.doesNotMatch(schema,/payment_request_exception_quick_approve/)
})
test('dark launch uses dedicated SysAdmin RLS',()=>{
  assert.match(schema,/current_user_has_role\(public\.flux_sysadmin_roles\(\)\)/)
  assert.match(schema,/force row level security/)
  assert.match(schema,/revoke all on table public\.%I from public,anon,authenticated/)
})
test('seed uses only PROD tenant ids and exact expected counts',()=>{
  assert.match(seed,/144042c1-e493-4256-a86c-cd088a8898ce/)
  assert.match(seed,/20cd72aa-f281-4985-931b-a83422404b66/)
  assert.doesNotMatch(seed,/9680353c-9b86-4730-82e1-fce664f048a2/)
  assert.doesNotMatch(seed,/68b61801-74c0-44ea-a33b-f20e4bf53aa7/)
  for (const marker of ['<>1646','<>694','<>95','<>396','<>187','<>87','<>60']) assert.ok(seed.includes(marker),marker)
})
test('account review is wired but stays behind module gate',()=>{
  assert.match(api,/loadCuentaReviewData/)
  assert.match(api,/confirmProviderAccount/)
  assert.match(schema,/confirm_provider_account/)
})
