import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { before,after,test } from 'node:test'
const require=createRequire(new URL('../../app/package.json',import.meta.url))
const {PGlite}=require('@electric-sql/pglite')
const migration=suffix=>readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(file=>file.endsWith(suffix)),'utf8')
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const actor=id(1), companyA=id(2),companyB=id(3),foreign=id(4),layout=id(5),line=id(6),request=id(7)
const reference='01123456789012260831',concept='0000000703'
let db
before(async()=>{
  db=new PGlite()
  await db.exec(`create role authenticated;create role anon;create role service_role;
    create schema auth;create schema private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.current_profile_id() returns uuid language sql stable as $$select auth.uid()$$;
    create function public.flux_member_roles() returns text[] language sql as $$select array['finance','requester']::text[]$$;
    create function private.current_profile_has_company_role(uuid,text[]) returns boolean language sql stable as $$select auth.uid()='${actor}'::uuid and $1 in ('${companyA}'::uuid,'${companyB}'::uuid) and current_setting('qa.role',true)=any($2)$$;
    create table public.profiles(id uuid primary key);
    create table public.payment_layouts(id uuid primary key,status text);
    create table public.payment_requests(id uuid primary key,status text);
    create table public.payment_receipts(id uuid default gen_random_uuid(),payment_request_id uuid);
    create table public.payment_layout_lines(id uuid primary key,layout_id uuid,company_id uuid,payment_request_id uuid,destination_type text,convenio_number text,payment_reference text,payment_concept text,status text,amount numeric,source_account_number text,updated_at timestamptz);
    insert into public.profiles values('${actor}');
    insert into public.payment_layouts values('${layout}','uploaded');
    insert into public.payment_requests values('${request}','finance_validation');
    insert into public.payment_layout_lines values('${line}','${layout}','${companyA}','${request}','convenio','0578869','10092','CFE QA SEPT','included',70,'0012345678',now());
    alter table public.payment_layout_lines enable row level security;
    create policy line_select on public.payment_layout_lines for select to authenticated using(private.current_profile_has_company_role(company_id,public.flux_member_roles()));
    grant usage on schema public,private,auth to authenticated,anon,service_role;
    grant select on public.payment_layout_lines to authenticated;
  `)
  await db.exec(migration('_cie_capture_reference_validation.sql'))
  await db.exec(migration('_cie_receipt_instructions.sql'))
})
after(async()=>db?.close())
async function asActor(fn,patch='',role='finance') {
  await db.exec('begin')
  try {
    if(patch) await db.exec(patch)
    await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('qa.role',$2,true)",[actor,role])
    await db.exec('set local role authenticated')
    return await fn()
  } finally {await db.exec('rollback')}
}
async function correct(overrides={}) {
  const p={reference,concept,oldReference:'10092',oldConcept:'CFE QA SEPT',confirmed:true,...overrides}
  return db.query('select public.update_payment_layout_line_cie_instructions($1,$2,$3,$4,$5,$6) as result',[line,p.reference,p.oldReference,p.concept,p.oldConcept,p.confirmed])
}
for(const company of [companyA,companyB]) test(`atomic correction and audit for authorized company ${company.slice(-1)}`,async()=>asActor(async()=>{
  const before=(await db.query('select * from public.payment_layout_lines where id=$1',[line])).rows[0]
  await correct()
  const row=(await db.query('select * from public.payment_layout_lines where id=$1',[line])).rows[0]
  assert.equal(row.payment_reference,reference);assert.equal(row.payment_concept,concept)
  for(const key of ['layout_id','company_id','payment_request_id','status','amount','source_account_number','convenio_number']) assert.equal(row[key],before[key])
  await correct({oldReference:reference,oldConcept:concept}) // unchanged retry must not duplicate audit
  await db.exec('reset role')
  const audits=(await db.query('select * from private.payment_layout_cie_reference_audit')).rows
  assert.equal(audits.length,1);assert.equal(audits[0].previous_concept,'CFE QA SEPT');assert.equal(audits[0].new_concept,concept);assert.equal(audits[0].actor_profile_id,actor)
},`update public.payment_layout_lines set company_id='${company}' where id='${line}'`))
for(const [patch,message] of [
  [{confirmed:false},'confirmation_required'],[{oldConcept:'stale'},'changed'],[{oldReference:'stale'},'changed'],
  [{reference:'10092'},'20_characters'],[{concept:''},'concept_required'],[{concept:'x'.repeat(31)},'concept_invalid'],[{concept:'bad|data'},'concept_invalid'],
]) test(`reject invalid correction ${JSON.stringify(patch)}`,async()=>asActor(async()=>{await assert.rejects(correct(patch),new RegExp(message))}))
for(const patch of [
  `update public.payment_requests set status='paid'`,
  `update public.payment_layouts set status='confirmed'`,
  `update public.payment_layout_lines set status='paid'`,
  `insert into public.payment_receipts(payment_request_id) values('${request}')`,
]) test(`never change closed or evidenced payments: ${patch.split(' ')[2]}`,async()=>asActor(async()=>{await assert.rejects(correct(),/locked/)},patch))
test('foreign company denied',async()=>asActor(async()=>{await assert.rejects(correct(),/not_authorized/)},`update public.payment_layout_lines set company_id='${foreign}'`))
test('requester cannot change bank instructions',async()=>asActor(async()=>{await assert.rejects(correct(),/not_authorized/)},'','requester'))
test('wrapper is invoker and anonymous role cannot execute',async()=>{
  const row=(await db.query("select p.prosecdef,has_function_privilege('anon',p.oid,'execute') as anon from pg_proc p where p.proname='update_payment_layout_line_cie_instructions'")).rows[0]
  assert.equal(row.prosecdef,false);assert.equal(row.anon,false)
})
