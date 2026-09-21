import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const logic=readFileSync('app/src/features/configuracion/logic.ts','utf8')
const schema=readFileSync('supabase/migrations/20260921231129_contpaq_dark_launch_schema_prod_r3.sql','utf8')
const seed=readFileSync('supabase/migrations/20260921231130_contpaq_dark_launch_seed_prod_r3.sql','utf8')
const api=readFileSync('app/src/features/configuracion/api.ts','utf8')

test('dark launch UI is SysAdmin only',()=>{
  assert.match(logic,/contpaq:\s*\[ROLE_GROUPS\.SYSADMIN\]/)
  assert.doesNotMatch(logic,/contpaq:\s*\[[^\]]*ROLE_GROUPS\.ADMIN/)
  assert.doesNotMatch(logic,/contpaq:\s*\[[^\]]*ROLE_GROUPS\.DIRECTION/)
})

test('schema is additive and isolated from payment flows',()=>{
  assert.match(schema,/contpaq_dark_launch_access/)
  assert.match(schema,/add column if not exists cfdi_data jsonb/)
  for (const forbidden of [
    /create or replace function public\.create_payment_request/,
    /reimbursement_items/,
    /payment_request_exception_quick_approve/,
    /weekly_request_digest/,
    /notification_events/
  ]) assert.doesNotMatch(schema,forbidden)
})

test('R3 keeps partida mapping 1:1 to match current UI and seeded data',()=>{
  assert.match(schema,/unique \(company_id,budget_category_id\)/)
  assert.doesNotMatch(schema,/unique \(company_id,\s*budget_category_id,\s*contpaq_account_code\)/)
  assert.match(api,/onConflict:\s*['"]company_id,budget_category_id['"]/)
})

test('provider tercero can be saved before optional provider expense account',()=>{
  assert.match(schema,/create table public\.provider_account_mappings[\s\S]*?contpaq_account_code text,\s*\n\s*contpaq_provider_id text/)
  assert.doesNotMatch(schema,/provider_account_mappings[\s\S]{0,350}contpaq_account_code text not null/)
  assert.match(api,/upsertProviderMapping[\s\S]*code: string \| null/)
})

test('dark launch uses dedicated SysAdmin RLS and safe view/function mode',()=>{
  assert.match(schema,/current_user_has_role\(public\.flux_sysadmin_roles\(\)\)/)
  assert.match(schema,/force row level security/)
  assert.match(schema,/with \(security_invoker=true\)/)
  assert.match(schema,/confirm_provider_account[\s\S]*?language plpgsql security invoker/)
  assert.doesNotMatch(schema,/confirm_provider_account[\s\S]{0,600}?security definer/)
})

test('seed uses only PROD tenant ids and exact expected counts',()=>{
  assert.match(seed,/144042c1-e493-4256-a86c-cd088a8898ce/)
  assert.match(seed,/20cd72aa-f281-4985-931b-a83422404b66/)
  assert.doesNotMatch(seed,/9680353c-9b86-4730-82e1-fce664f048a2/)
  assert.doesNotMatch(seed,/68b61801-74c0-44ea-a33b-f20e4bf53aa7/)
  for (const marker of ['<>1646','<>694','<>95','<>396','<>187','<>83','<>60']) assert.ok(seed.includes(marker),marker)
  assert.ok(seed.includes("needs_review)<>4"),'Operadora review count must be 4')
  assert.doesNotMatch(seed,/AUTO-RSJT-2026-ROW-/)
  for (const code of ['OP-001','OP-002','OP-003','REC-RSJT-2026-001']) assert.doesNotMatch(seed,new RegExp(`\\('${code}'`))
  assert.match(seed,/FONACOT existe en PROD pero no tenía mapeo validado en DEV/)
  assert.match(seed,/contpaq_seed_opt_tax_count/)
  assert.match(seed,/tax_account_mappings where company_id=opt\)<>4/)
  assert.doesNotMatch(seed,/66001060300/)
  assert.match(seed,/ajusteRedondeo\/noDeducibles se omiten/)
})

test('account review/export code is present but remains behind module gate',()=>{
  assert.match(api,/loadCuentaReviewData/)
  assert.match(api,/confirmProviderAccount/)
  assert.match(schema,/confirm_provider_account/)
})
