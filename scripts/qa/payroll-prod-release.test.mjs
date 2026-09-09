import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {before,after,test} from 'node:test';
const require=createRequire(new URL('../../app/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const catalog=JSON.parse(read('./fixtures/payroll-prod-schema.json'));
const helpers=[...JSON.parse(read('./fixtures/payroll-prod-helpers.json')),...JSON.parse(read('./fixtures/payroll-prod-extra-helpers.json'))];
const q=s=>'"'+s.replaceAll('"','""')+'"';
const lit=s=>"'"+s.replaceAll("'","''")+"'";
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const companyA='20cd72aa-f281-4985-931b-a83422404b66',companyB='144042c1-e493-4256-a86c-cd088a8898ce';
const [rh,finance,outsider,bank,center]=[1,2,3,4,5].map(id);
let db;
async function exec(sql){try{return await db.exec(sql)}catch(e){throw new Error(`${e.message}\n${sql.slice(Math.max(0,Number(e.position||1)-180),Number(e.position||1)+220)}`)}}
async function asUser(user,fn,role='authenticated'){
  await exec('begin');
  try {await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user,role]);await exec(`set local role ${role}`);return await fn();}
  finally {await exec('rollback');}
}
const rpc=(name,args=[])=>db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args).then(r=>r.rows[0].result);
before(async()=>{
  db=new PGlite();
  await exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;create schema private;create schema extensions;create schema vault;create schema cron;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    alter table storage.objects enable row level security;
    create table vault.decrypted_secrets(name text,decrypted_secret text);
    create table cron.job(jobname text,schedule text,command text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$with i as(insert into cron.job values($1,$2,$3) returning 1)select 1::bigint from i$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('sub',auth.uid(),'role',auth.role())$$;
    create sequence public.payment_request_number_seq;
    grant usage on schema public,private,auth,storage to authenticated,anon,service_role;
  `);
  for(const e of catalog.enums)await exec(`create type public.${q(e.name)} as enum (${e.labels.map(lit).join(',')})`);
  for(const t of [...catalog.tables,...JSON.parse(read('./fixtures/payroll-prod-extra-tables.json'))]){
    await exec(`create table public.${q(t.name)} (${t.columns.map(c=>`${q(c.name)} ${c.type}${c.default?' default '+c.default:''}${c.not_null?' not null':''}`).join(',')})`);
    for(const c of t.constraints||[]) await exec(`alter table public.${q(t.name)} add constraint ${q(c.name)} ${c.definition}`);
  }
  const funcs=new Map([...catalog.functions,...helpers].map(f=>[`${f.schema}.${f.name}`,f]));
  const done=new Set();
  async function install(key){if(done.has(key)||!funcs.has(key))return;done.add(key);for(const m of funcs.get(key).definition.matchAll(/(?:public|private)\.\w+(?=\()/g))await install(m[0]);await exec(funcs.get(key).definition);}
  await exec(`create function public.notification_payment_request_payload(uuid) returns jsonb language plpgsql as $$begin raise exception 'UNEXPECTED_GENERIC_NOTIFICATION';end$$;`);
  for(const name of ['current_profile_id','current_user_has_role','has_active_company_membership','payroll_active_company_access','generate_payment_request_number','set_updated_at','set_payment_request_no_presupuestal_snapshot','mark_payment_request_material_change','enqueue_payment_request_created_notification','validate_payment_request_approver_scope','extraordinary_guard_request_paid','extraordinary_invalidate_material_change']) await install('public.'+name);
  await exec(`create function public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamp with time zone) returns jsonb language sql as $$select '[]'::jsonb$$;`);
  await install('private.enforce_payment_request_tenant_references');await install('private.enforce_reimbursement_actor_scope');
  for(const t of catalog.triggers)await exec(t.definition);
  await exec(`insert into companies(id,name,active) values('${companyA}','Soporte Fersana',true),('${companyB}','Operadora Tlacatecpan',true);`);
  await exec(read('../../supabase/migrations/20260908075132_payroll_prod_request_type.sql'));
  await exec(read('../../supabase/migrations/20260908075149_payroll_prod_capture_and_notifications.sql'));
  const beforeAcl = (await db.query("select n.nspname,p.proname,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname='reconcile_payroll_channel') or (n.nspname='public' and p.proname='get_payroll_reconciliation_summary') order by 1,2")).rows;
  await exec(read('../../supabase/migrations/20260909175755_payroll_receipt_date_from_request_creation.sql'));
  await exec(read('../../supabase/migrations/20260909175755_payroll_receipt_date_from_request_creation.sql'));
  assert.deepEqual((await db.query("select n.nspname,p.proname,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname='reconcile_payroll_channel') or (n.nspname='public' and p.proname='get_payroll_reconciliation_summary') order by 1,2")).rows,beforeAcl);
  await exec(`insert into profiles(id,auth_user_id,full_name,email,active) values('${rh}','${rh}','Synthetic RH','rh@example.test',true),('${finance}','${finance}','Synthetic Finance','finance@example.test',true),('${outsider}','${outsider}','Synthetic other','other@example.test',true);
    insert into profile_company_memberships(profile_id,company_id,active,role_key) values('${rh}','${companyA}',true,'operator'),('${finance}','${companyA}',true,'finance'),('${finance}','${companyB}',true,'operator'),('${outsider}','${companyA}',true,'operator');
    insert into payroll_capture_grants(profile_id,company_id) values('${rh}','${companyA}');
  `);
});
after(async()=>await db?.close());
test('the complete production baseline installs against the deployed schema without enabling delivery or accounting',async()=>{
  assert.equal((await db.query('select count(*)::int as n from payroll_notification_settings')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from payroll_provision_settings')).rows[0].n,0);
  assert.equal((await db.query("select polpermissive from pg_policy where polname='payroll_private_capture_no_update'")).rows[0].polpermissive,false);
});
test('Finance memberships work without a global role; capture grants remain scoped and cannot pay',async()=>{
  assert.equal((await db.query('select count(*)::int as n from user_roles')).rows[0].n,0);
  await asUser(finance,async()=>{
    assert.deepEqual(await rpc('get_my_payroll_access',[companyA]),{can_capture:true,can_pay:true});
    assert.deepEqual(await rpc('get_my_payroll_access',[companyB]),{can_capture:false,can_pay:false});
  });
  await asUser(rh,async()=>{
    assert.deepEqual(await rpc('get_my_payroll_access',[companyA]),{can_capture:true,can_pay:false});
    await assert.rejects(rpc('confirm_payroll_finance_review',[id(99)]),/PAYROLL_FINANCE_COMPANY_REQUIRED/);
  });
  await assert.rejects(asUser(outsider,()=>rpc('get_my_payroll_access',[companyA]),'anon'),/permission denied/);
});

async function actor(user,role='authenticated') {
  await exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user,role]);
  if(role!=='owner')await exec(`set local role ${role}`);
}
async function denied(fn,pattern){await exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await exec('rollback to savepoint denied');await exec('release savepoint denied');}}
test('RH capture → server materialization → Treasury review → three receipts → paid emits exactly two payroll events',async()=>{
  await exec('begin');
  try {
    await exec(`insert into cost_centers(id,name,code,active) values('${center}','Synthetic center','QA',true);
      insert into company_cost_centers(company_id,cost_center_id,active) values('${companyA}','${center}',true);
      insert into company_bank_accounts(id,company_id,name,bank_name,currency,account_type,account_number,last4,active)
        values('${bank}','${companyA}','Synthetic account','BBVA','MXN','bank','0123456789','6789',true);
      insert into payroll_notification_settings(company_id,finance_recipient_profile_id,dispatch_enabled,app_origin)
        values('${companyA}','${finance}',true,'https://flux.example.test');
    `);
    await actor(rh);
    const capture=await rpc('save_payroll_capture_session_n3g',[null,null,companyA,bank,center,'ordinaria','2026-09-01','2026-09-15','Synthetic payroll QA',null,['banco','spei','vales']]);
    const session=capture.id;
    const specs=[['caratula',null,30000,'xlsx'],['layout_mismo_banco','banco',10000,'txt'],['layout_spei','spei',15000,'txt'],['layout_toka','vales',5116,'txt'],['cfdi_vales','vales',5000,'xml']];
    const files=[];
    for(const [kind,channel,total,ext] of specs){
      await actor('', 'owner');
      const v=(await db.query('select version from payroll_capture_sessions where id=$1',[session])).rows[0].version;
      await actor(rh);
      const mime=ext==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':ext==='xml'?'application/xml':'text/plain';
      const reserved=await rpc('reserve_payroll_capture_file',[session,v,kind,ext,mime,200,'a'.repeat(64),kind==='layout_spei'?'payroll-normalized-v1':null,kind==='layout_spei'?'bbva-simulator-pagos-interbancarios-128-v1':null,kind==='layout_spei'?1:null,kind==='layout_spei'?total:null]);
      await actor('', 'owner');
      const f=(await db.query('select * from payroll_capture_files where session_id=$1 and kind=$2 order by reserved_at desc limit 1',[session,kind])).rows[0];
      await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[f.storage_bucket,f.storage_path,{size:200,mimetype:mime}]);
      await actor(rh);
      await rpc('confirm_payroll_capture_file',[f.id,'a'.repeat(64)]);
      files.push({capture_file_id:f.id,kind,channel,sha256:'a'.repeat(64),parser_version:'payroll-normalized-v1',authority:'server_verified',record_count:kind==='caratula'?3:1});
    }
    await actor('', 'owner');
    const stored=(await db.query('select * from payroll_capture_sessions where id=$1',[session])).rows[0];
    const normalized={contract_version:'payroll-normalized-v1',valid:true,issues:[],warnings:[],actor_profile_id:rh,capture_session_id:session,capture_version:stored.version,provision_base_amount_minor:30000,files,
      channels:[{channel:'banco',amount_minor:10000},{channel:'spei',amount_minor:15000},{channel:'vales',amount_minor:5116,benefit_amount_minor:5000,fee_amount_minor:100,tax_amount_minor:16,expected_funding_amount_minor:5116}],
      lines:[10000,15000,5000].map((amount,i)=>({source_capture_file_id:files[0].capture_file_id,source_sheet:'QA',source_row_number:i+1,extraction_version:'payroll-normalized-v1',employee_name:'PRIVATE SYNTHETIC PERSON',rfc:'XAXX010101000',net_amount_minor:amount,bank_amount_minor:i===0?amount:0,spei_amount_minor:i===1?amount:0,vouchers_amount_minor:i===2?amount:0})),parser_versions:{},verified_at:'2026-09-08T00:00:00Z'};
    await actor('', 'service_role');
    const materialized=await rpc('materialize_payroll_capture_internal',[session,stored.version,'b'.repeat(64),normalized]);
    assert.equal(materialized.status,'materialized');assert.equal(materialized.provision_status,'pending_configuration');
    const request=materialized.payment_request_id;
    assert.equal((await rpc('materialize_payroll_capture_internal',[session,stored.version,'b'.repeat(64),normalized])).status,'already_materialized');
    await actor('', 'owner');
    // UTC September 8 is still September 7 in CDMX: creation date is a business day, not UTC.
    await db.query("update payment_requests set created_at='2026-09-08T03:00:00Z' where id=$1",[request]);
    await actor(rh);
    const [history]=await rpc('get_payroll_capture_sessions',[session]);
    assert.equal(history.files.length,5);assert.doesNotMatch(JSON.stringify(history),/PRIVATE SYNTHETIC PERSON/);
    assert.equal((await db.query('select * from payroll_run_lines')).rows.length,0);
    await denied(()=>rpc('confirm_payroll_finance_review',[request]),/PAYROLL_FINANCE_COMPANY_REQUIRED/);
    await actor(finance);
    assert.equal((await rpc('confirm_payroll_finance_review',[request])).status,'confirmed');
    await denied(()=>rpc('close_payroll_as_paid',[request]),/PAYROLL_PAID_RECONCILIATION_REQUIRED/);
    const channels=(await db.query('select * from payroll_channels where payment_request_id=$1 order by channel',[request])).rows;
    assert.equal((await rpc('get_payroll_reconciliation_summary',[request])).request_created_date,'2026-09-07');
    await exec("set local timezone='Asia/Tokyo'");
    assert.equal((await rpc('get_payroll_reconciliation_summary',[request])).request_created_date,'2026-09-07');
    for(const channel of channels){
      await rpc('record_payroll_channel_dispersion',[request,channel.id,'dispersed',null]);
      const receipt=await rpc('reserve_payroll_channel_receipt',[request,channel.id,'application/pdf',200,'c'.repeat(64),'Synthetic_receipt.pdf']);
      await actor('', 'owner');
      await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[receipt.storage_bucket,receipt.storage_path,{size:200,mimetype:'application/pdf'}]);
      await actor(finance);
      assert.equal((await db.query('select payroll_run_file_storage_insert_allowed($1) as allowed',[receipt.storage_path])).rows[0].allowed,true);
      await rpc('get_payroll_receipt_verification_context',[receipt.run_file_id]);
      await actor('', 'service_role');
      await rpc('confirm_payroll_channel_receipt_internal',[receipt.run_file_id,'c'.repeat(64),200,'application/pdf']);
      await actor(finance);
      const reconcile = (date,amount=Number(channel.amount),ref='DATE-TEST') => rpc('reconcile_payroll_channel',[request,channel.id,receipt.run_file_id,amount,date,ref]);
      await denied(()=>reconcile('2026-09-06'),/PAYROLL_RECONCILIATION_PAYMENT_DATE_BEFORE_REQUEST/);
      await denied(()=>reconcile(null),/PAYROLL_RECONCILIATION_PAYMENT_DATE_INVALID/);
      await denied(()=>reconcile('infinity'),/PAYROLL_RECONCILIATION_PAYMENT_DATE_INVALID/);
      await denied(()=>reconcile('-infinity'),/PAYROLL_RECONCILIATION_PAYMENT_DATE_INVALID/);
      await denied(()=>reconcile('2026-09-07',Number(channel.amount)+0.01),/PAYROLL_RECONCILIATION_AMOUNT_MISMATCH/);
      await denied(()=>reconcile('2026-09-07',Number(channel.amount),'x'),/PAYROLL_RECONCILIATION_REFERENCE_REQUIRED/);
      for(const date of ['2026-09-07','2026-09-08','2099-12-31','2100-01-01']) {
        await exec('savepoint date_case');
        assert.equal((await reconcile(date)).result,'reconciled');
        assert.equal((await reconcile(date)).result,'already_reconciled');
        await exec('rollback to savepoint date_case; release savepoint date_case');
      }
      await rpc('reconcile_payroll_channel',[request,channel.id,receipt.run_file_id,Number(channel.amount),'2026-09-08','SYNTHETIC-'+channel.channel]);
    }
    // A finance role in a different company must not unlock this request.
    await actor('', 'owner');
    await db.query("update profile_company_memberships set role_key=case when company_id=$2 then 'operator' else 'finance' end where profile_id=$1",[finance,companyA]);
    await actor(finance);
    await denied(()=>rpc('close_payroll_as_paid',[request]),/PAYROLL_FINANCE_COMPANY_REQUIRED/);
    assert.equal((await db.query('select * from payroll_run_lines')).rows.length,0);
    await actor('', 'owner');
    await db.query("update profile_company_memberships set role_key=case when company_id=$2 then 'finance' else 'operator' end where profile_id=$1",[finance,companyA]);
    await actor(finance);
    assert.equal((await rpc('close_payroll_as_paid',[request])).status,'paid');
    assert.equal((await rpc('close_payroll_as_paid',[request])).status,'already_paid');
    await actor('', 'owner');
    const events=(await db.query('select event_type,recipient_profile_id,id from notification_events where source_id=$1 order by event_type',[request])).rows;
    assert.deepEqual(events.map(e=>[e.event_type,e.recipient_profile_id]),[['payroll.paid',rh],['payroll.registered',finance]]);
    for(const table of ['budget_lines','payroll_provision_entries','payment_request_approvals','approval_batch_items'])assert.equal((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n,0,table);
    await exec('set constraints all immediate');
  } finally {await exec('rollback');}
});
