// Isolated PostgreSQL integration: exact production creator overloads + the
// new migrations. Budget/routing dependencies use deterministic QA fixtures.
// Never consumes production folios, commits notifications or contacts a bank.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { before, after, test } from 'node:test'
const require = createRequire(new URL('../../app/package.json', import.meta.url))
const { PGlite } = require('@electric-sql/pglite')
const read = name => readFileSync(name, 'utf8')
const migration = suffix => read('supabase/migrations/' + readdirSync('supabase/migrations').find(p => p.endsWith(suffix)))
const creators = JSON.parse(read('scripts/qa/fixtures/convenio-production-creators.json'))
const catalog = JSON.parse(read('scripts/qa/fixtures/payroll-prod-schema.json'))
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const [actor, approver, other, companyA, companyB, companyForeign, provider, center, category] = [1,2,3,4,5,6,7,8,9].map(id)
const reference = '00123456789012345678', concept = '0000001234'
let db
const payload = company => ({ request_type: 'convenio', payment_method: 'transfer', requested_by: actor,
  company_id: company, proveedor_id: provider, convenio_number: '0578869', cost_center_id: center,
  budget_category_id: category, budget_month: '2026-09-01', amount_requested: 70, currency: 'MXN',
  description: 'QA servicio', approver_id: approver, approver_assignment_id: null, partida_unsure: true,
  payment_reference: reference, payment_concept: concept, status: 'paid', beneficiary_profile_id: null })
async function asActor(fn, user = actor) {
  await db.exec('begin')
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user || ''])
    await db.exec('set local role authenticated')
    return await fn()
  } finally { await db.exec('rollback') }
}
const create = async (p, path = null) => (await db.query('select public.create_convenio_payment_request($1::jsonb,$2) as result', [JSON.stringify(p), path])).rows[0].result
before(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create sequence public.payment_request_number_seq;
    grant usage on schema public,private,auth,storage to authenticated,anon,service_role;
  `)
  for (const e of catalog.enums) await db.exec(`create type public."${e.name}" as enum (${e.labels.map(v => `'${v}'`).join(',')})`)
  for (const name of ['profiles','companies','cost_centers','budget_categories','approver_assignments','payment_requests']) {
    const t = catalog.tables.find(t => t.name === name)
    await db.exec(`create table public.${name} (${t.columns.map(c => `"${c.name}" ${c.type}${c.default ? ' default ' + c.default : ''}${c.not_null ? ' not null' : ''}`).join(',')})`)
  }
  await db.exec(`create table public.proveedores(id uuid primary key,activo boolean,destination_type text,convenio_number text);
    create table public.payment_layout_lines(id uuid default gen_random_uuid(),payment_request_id uuid,status text);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid);
    create function public.current_profile_id() returns uuid language sql stable as $$select auth.uid()$$;
    create function public.flux_member_roles() returns text[] language sql immutable as $$select array['operator','finance','director','sysadmin']$$;
    create function public.flux_sysadmin_roles() returns text[] language sql immutable as $$select array['sysadmin']$$;
    create function public.current_user_has_role(text[]) returns boolean language sql stable as $$select false$$;
    create function private.current_profile_has_company_role(uuid,text[]) returns boolean language sql stable as $$select auth.uid()='${actor}'::uuid and $1 in ('${companyA}'::uuid,'${companyB}'::uuid)$$;
    create function public.has_active_company_membership(uuid,uuid) returns boolean language sql stable as $$select $1 in ('${actor}'::uuid,'${approver}'::uuid) and $2 in ('${companyA}'::uuid,'${companyB}'::uuid)$$;
    create function public.payment_request_has_active_approver_pool(uuid,uuid) returns boolean language sql as $$select false$$;
    create function public.is_payment_request_approver_for_company(uuid,uuid) returns boolean language sql as $$select $1='${approver}'::uuid and public.has_active_company_membership($1,$2)$$;
    create function public.payment_request_rule_allows(uuid,uuid,uuid,numeric,text) returns boolean language sql as $$select $1='${approver}'::uuid and public.has_active_company_membership($1,$2)$$;
    create function public.verify_budget_availability(uuid,uuid,uuid,date,numeric,boolean) returns jsonb language sql as $$select jsonb_build_object('status','aprobable','disponible_actual',100,'disponible_despues',100-$5,'faltante',0)$$;
    create function public.generate_payment_request_number(integer) returns text language sql as $$select 'QA-'||nextval('public.payment_request_number_seq')$$;
    grant usage on sequence public.payment_request_number_seq to authenticated;
    grant select on all tables in schema public to authenticated;
    grant insert,update on public.payment_requests to authenticated;
    grant select on storage.objects to authenticated;
    alter table public.payment_requests enable row level security;
    create policy request_select on public.payment_requests for select to authenticated using (requested_by=public.current_profile_id() and private.current_profile_has_company_role(company_id,public.flux_member_roles()));
    create policy request_insert on public.payment_requests for insert to authenticated with check (requested_by=public.current_profile_id() and private.current_profile_has_company_role(company_id,public.flux_member_roles()));
    create policy request_update on public.payment_requests for update to authenticated using (requested_by=public.current_profile_id() and private.current_profile_has_company_role(company_id,public.flux_member_roles())) with check (requested_by=public.current_profile_id() and private.current_profile_has_company_role(company_id,public.flux_member_roles()));
    insert into public.profiles(id,full_name,email,active) values('${actor}','Actor QA','actor@example.test',true),('${approver}','Aprobador QA','approver@example.test',true),('${other}','Other QA','other@example.test',true);
    insert into public.companies(id,name,active) values('${companyA}','Operadora',true),('${companyB}','Fersana',true),('${companyForeign}','Other',true);
    insert into public.cost_centers(id,name) values('${center}','Centro QA');
    insert into public.budget_categories(id,name) values('${category}','Servicio QA');
    insert into public.proveedores values('${provider}',true,'convenio','0578869');
    insert into storage.objects(bucket_id,name,owner) values('payment-receipts','solicitudes/drafts/${actor}/recibo.pdf','${actor}'),('payment-receipts','solicitudes/drafts/${actor}/foreign.pdf','${other}');
  `)
  for (const f of creators) await db.exec(f.definition)
  // Only the pure shared helper is required from the preceding CIE migration.
  await db.exec(migration('_cie_capture_reference_validation.sql').split('create or replace function private.validate_layout_cie_reference')[0])
  await db.exec(migration('_convenio_request_type.sql'))
  await db.exec(migration('_convenio_request_capture.sql'))
})
after(async () => { await db?.close() })

for (const [name, company] of [['Operadora',companyA],['Fersana',companyB]]) for (const document of [false,true]) {
  test(`${name}: server creates Convenio ${document ? 'with owned PDF' : 'without attachment'} atomically using production overloads`, async () => asActor(async () => {
    const path = document ? `solicitudes/drafts/${actor}/recibo.pdf` : null
    const result = await create(payload(company), path)
    await db.exec('set constraints validate_convenio_request immediate')
    const row = (await db.query('select * from public.payment_requests where id=$1',[result.payment_request_id])).rows[0]
    assert.equal(row.request_type,'convenio'); assert.equal(row.payment_method,'transfer')
    assert.equal(row.company_id,company); assert.equal(row.requested_by,actor)
    assert.equal(row.payment_reference,reference); assert.equal(row.payment_concept,concept)
    assert.equal(row.invoice_storage_path,path); assert.equal(row.partida_unsure,true)
    assert.equal(row.status,'submitted'); assert.equal(row.approver_id,approver)
    assert.equal(Number(row.budget_available_after),30)
  }))
}
for (const [patch, expected] of [
  [{ payment_reference:'10092' },'cie_reference_cfe_requires_20_characters'],
  [{ payment_reference:reference+concept },'cie_reference_too_long'],
  [{ payment_reference:null },'cie_reference_required'],
  [{ payment_concept:'' },'cie_concept_required'],
  [{ payment_concept:'X'.repeat(31) },'cie_concept_too_long'],
  [{ payment_concept:'A|B' },'cie_concept_invalid'],
  [{ convenio_number:'9999999' },'convenio_provider_changed'],
  [{ currency:'USD' },'convenio_mxn_required'],
  [{ payment_method:'cash' },'convenio_transfer_required'],
  [{ company_id:companyForeign },'convenio_company_not_authorized'],
  [{ requested_by:other },'requested_by_must_match_current_profile'],
  [{ approver_id:actor },'requester_cannot_be_own_approver'],
  [{ approver_id:other },'approver_not_allowed_by_approval_rules'],
]) test(`server rejects ${expected}`,async () => asActor(async () => {
  await assert.rejects(create({...payload(companyA),...patch}),new RegExp(expected))
}))
test('no session is rejected despite having EXECUTE permission',async () => asActor(async () => {
  await assert.rejects(create(payload(companyA)),/not_authenticated/)
}, null))
for (const [filename,error] of [['foreign.pdf','request_document_not_found_or_not_owned'],['missing.pdf','request_document_not_found_or_not_owned']]) {
  test(`document ownership: reject ${filename}`,async () => asActor(async () => {
    await assert.rejects(create(payload(companyA),`solicitudes/drafts/${actor}/${filename}`),new RegExp(error))
  }))
}
test('final-row constraint prevents clearing reference through direct writes',async () => asActor(async () => {
  const result=await create(payload(companyA))
  await db.query('update public.payment_requests set payment_reference=null where id=$1',[result.payment_request_id])
  await assert.rejects(db.exec('set constraints validate_convenio_request immediate'),/cie_reference_required/)
}))
test('legacy creation RPC cannot persist a Convenio without its bank fields',async () => asActor(async () => {
  await db.query(`select public.create_payment_request(p_proveedor_id=>$1::uuid,p_company_id=>$2::uuid,p_cost_center_id=>$3::uuid,p_budget_category_id=>$4::uuid,p_budget_month=>'2026-09-01'::date,p_amount_requested=>70,p_approver_id=>$5::uuid,p_request_type=>'convenio')`,[provider,companyA,center,category,approver])
  await assert.rejects(db.exec('set constraints validate_convenio_request immediate'),/convenio_transfer_required|cie_reference_required/)
}))
test('bank edits to a paid Convenio are blocked',async () => asActor(async () => {
  const result=await create(payload(companyA))
  await db.query("update public.payment_requests set status='paid' where id=$1",[result.payment_request_id])
  await assert.rejects(db.query("update public.payment_requests set payment_reference='00123456789012345679' where id=$1",[result.payment_request_id]),/convenio_request_locked/)
}))
test('published RPC is invoker and anonymous callers have no grant',async () => {
  const {rows}=await db.query("select prosecdef,has_function_privilege('anon',oid,'EXECUTE') as anon from pg_proc where oid='public.create_convenio_payment_request(jsonb,text)'::regprocedure")
  assert.equal(rows[0].prosecdef,false); assert.equal(rows[0].anon,false)
})
test('bank edits are blocked once a layout includes the request',async () => {
  await db.exec('begin')
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor])
    const result=await create(payload(companyA))
    await db.query("insert into public.payment_layout_lines(payment_request_id,status) values($1,'included')",[result.payment_request_id])
    await db.exec('set local role authenticated')
    await assert.rejects(db.query("update public.payment_requests set payment_concept='CAMBIO' where id=$1",[result.payment_request_id]),/convenio_request_locked/)
  } finally { await db.exec('rollback') }
})
