import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../supabase/migrations/20260908015626_payroll_capture_access_and_history.sql');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [companyA, companyB, rh, finance, outsider, session, request] = [1,2,3,4,5,6,7].map(id);
let db;
async function asUser(user, action, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.query("select set_config('test.actor',$1,true)", [user || '']);
    await db.exec(`set local role ${role}`);
    return await action();
  } finally { await db.exec('rollback'); }
}
const rpc = (name, arg) => db.query(`select public.${name}($1::uuid) as result`, [arg]).then(x => x.rows[0].result);

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema private; create schema auth; create schema storage;
    create table storage.objects (bucket_id text,name text,metadata jsonb);
    grant usage on schema public,auth to authenticated,anon,service_role;
    create function auth.role() returns text language sql stable as $$ select current_setting('role') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('role',auth.role()) $$;
    create function public.current_profile_id() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
    create table public.test_memberships(profile_id uuid,company_id uuid,active boolean,finance boolean);
    create function public.has_active_company_membership(p uuid,c uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.test_memberships where profile_id=p and company_id=c and active) $$;
    create function private.profile_has_company_role(p uuid,c uuid,r text[]) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.test_memberships where profile_id=p and company_id=c and active and finance) $$;
    create function public.payroll_has_finance_pii_access() returns boolean language sql stable security definer as $$
      select exists(select 1 from public.test_memberships where profile_id=public.current_profile_id() and finance and active) $$;
    create function public.payroll_active_company_access(c uuid) returns boolean language sql stable security definer as $$
      select private.profile_has_company_role(public.current_profile_id(),c,array['finance']) $$;
    create function public.payroll_ready_for_dispersion(p uuid) returns boolean language sql stable as $$ select false $$;
  `);
  await db.exec(read('./fixtures/payroll-pilot-schema.sql'));
  await db.exec(`insert into public.companies(id,name,active) values ('${companyA}','A',true),('${companyB}','B',true);
    insert into public.profiles(id,active) values ('${rh}',true),('${finance}',true),('${outsider}',true);
    insert into public.test_memberships values ('${rh}','${companyA}',true,false),('${rh}','${companyB}',true,false),('${finance}','${companyA}',true,true),('${outsider}','${companyA}',true,false);
    alter table public.payroll_run_lines enable row level security;
    grant select on public.payroll_run_lines to authenticated;
    create policy fixture_finance_only on public.payroll_run_lines for select to authenticated using (public.payroll_has_finance_pii_access());
    insert into public.payroll_run_lines(id,employee_name) values ('${id(50)}','PRIVATE FIXTURE');
  `);
  // Existing internal routines are not callable by authenticated users.
  await db.exec(migration);
  await db.exec(`revoke all on function public.get_payroll_capture_sessions_unscoped_internal(uuid) from public,anon,authenticated;
    insert into public.payroll_capture_grants(profile_id,company_id) values ('${rh}','${companyA}');
    insert into public.payment_requests(id,company_id,request_type,status) values ('${request}','${companyA}','nomina','paid');
    insert into public.payroll_capture_sessions(id,company_id,capture_state,expires_at,updated_at,materialized_payment_request_id)
      values ('${session}','${companyA}','materialized',now()-interval '1 day',now()-interval '1 day','${request}'),
      ('${id(8)}','${companyA}','draft',now()-interval '1 day',now(),null);
    insert into public.payroll_capture_sessions(id,company_id,capture_state,expires_at,updated_at)
      select gen_random_uuid(),'${companyB}','draft',now()+interval '1 day',now() from generate_series(1,55);
  `);
  const legacy = read('../../supabase/migrations/20260820160925_payroll_n4b_channel_receipt_reconciliation.sql');
  for (const name of ['reserve_payroll_channel_receipt','reconcile_payroll_channel','close_payroll_as_paid']) {
    const definition = legacy.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0];
    assert.ok(definition, name);
    await db.exec(definition);
  }
  await db.exec(`
    create schema cron;
    create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
    create function public.payroll_request_has_valid_materialization(p uuid) returns boolean language sql stable as $$
      select exists(select 1 from public.payroll_capture_sessions where materialized_payment_request_id=p and capture_state='materialized') $$;
    alter table public.notification_events add unique(idempotency_key);
    alter table public.notification_events alter column attempt_count set default 0;
    alter table public.notification_events alter column max_attempts set default 5;
    alter table public.notification_events alter column created_at set default now();
    update public.profiles set email='rh@example.com' where id='${rh}';
    update public.profiles set email='finance@example.com' where id='${finance}';
  `);
  await db.exec(read('../../supabase/migrations/20260908015701_payroll_pilot_notifications.sql'));
  await db.exec(read('../../supabase/migrations/20260908022737_payroll_notification_scoped_test.sql'));
  await db.exec(read('../../supabase/migrations/20260908060513_payroll_capture_verified_file_totals.sql'));
  await db.exec(`insert into public.payroll_notification_settings(company_id,finance_recipient_profile_id,dispatch_enabled,app_origin)
    values ('${companyA}','${finance}',true,'https://flux.example.com');`);
});
after(async () => { await db?.close(); });

test('capture grant is company-specific and does not confer payment rights', async () => {
  await asUser(rh, async () => {
    assert.deepEqual(await rpc('get_my_payroll_access',companyA), {can_capture:true,can_pay:false});
    assert.deepEqual(await rpc('get_my_payroll_access',companyB), {can_capture:false,can_pay:false});
    assert.deepEqual((await db.query('select * from public.payroll_run_lines')).rows, []);
    await assert.rejects(rpc('get_payroll_capture_context',companyB), /PAYROLL_CAPTURE_ACCESS_REQUIRED/);
  });
  await asUser(finance, async () => assert.deepEqual(await rpc('get_my_payroll_access',companyA), {can_capture:true,can_pay:true}));
  await asUser(outsider, async () => assert.deepEqual(await rpc('get_my_payroll_access',companyA), {can_capture:false,can_pay:false}));
});

test('anonymous users and operators cannot grant themselves payroll access', async () => {
  await assert.rejects(asUser(null, () => rpc('get_my_payroll_access',companyA), 'anon'), {code:'42501'});
  await assert.rejects(asUser(rh, () => db.query('insert into public.payroll_capture_grants(profile_id,company_id) values ($1,$2)',[rh,companyB])), {code:'42501'});
  await assert.rejects(asUser(rh, () => rpc('get_payroll_capture_sessions_unscoped_internal',null)), {code:'42501'});
});

test('history retains expired materialized runs and scopes before the 50-row limit', async () => {
  await asUser(rh, async () => {
    const list = await rpc('get_payroll_capture_sessions',null);
    assert.equal(list.length,1);
    assert.equal(list[0].id,session);
    assert.equal(list[0].payment_request_status,'paid');
  });
});

const fileSpecs = [
  ['caratula', null, 3, 30000],
  ['layout_mismo_banco', 'banco', 1, 10000],
  ['layout_spei', 'spei', 1, 15000],
  ['layout_toka', 'vales', 1, 5116],
  ['cfdi_vales', 'vales', 1, 5000],
];

async function withFileEvidence(check, arrange = async () => {}) {
  await db.exec('begin');
  try {
    const channelIds = { banco: id(201), spei: id(202), vales: id(203) };
    for (const [channel, amount, benefit] of [['banco',100,null],['spei',150,null],['vales',51.16,50]]) {
      await db.query(`insert into public.payroll_channels(id,payment_request_id,channel,amount,benefit_amount)
        values ($1,$2,$3,$4,$5)`,[channelIds[channel],request,channel,amount,benefit]);
    }
    for (const [i, [kind, channel, count]] of fileSpecs.entries()) {
      await db.query(`insert into public.payroll_capture_files(id,session_id,kind,channel,sha256,upload_state,is_current,record_count,total_amount_minor)
        values ($1,$2,$3,$4,$5,'uploaded',true,$6,$7)`,
        [id(210+i),session,kind,channel,'a'.repeat(64),kind==='layout_spei'?42:null,kind==='layout_spei'?999999:null]);
      await db.query(`insert into public.payroll_run_files(id,payment_request_id,payroll_channel_id,kind,sha256,parsing_status,parsing_metadata,capture_file_id)
        values ($1,$2,$3,$4,$5,'parsed',$6,$7)`,[id(220+i),request,channelIds[channel]||null,kind,'a'.repeat(64),
        {evidence_class:'SERVER_VERIFIED',row_count:count,employee_name:'PRIVATE_PAYROLL_PERSON',rfc:'PRIVATE_RFC'},id(210+i)]);
    }
    for (const [i, amount] of [100,150,50].entries()) {
      await db.query(`insert into public.payroll_run_lines(id,payment_request_id,source_file_id,net_amount,employee_name)
        values ($1,$2,$3,$4,'PRIVATE_PAYROLL_PERSON')`,[id(230+i),request,id(220),amount]);
    }
    await arrange();
    await db.query("select set_config('test.actor',$1,true)",[rh]);
    await db.exec('set local role authenticated');
    await check();
  } finally { await db.exec('rollback'); }
}

test('saved paid captures return server counts and exact totals for all five files without exposing individual records', async () => {
  await withFileEvidence(async () => {
    const [capture] = await rpc('get_payroll_capture_sessions',session);
    assert.equal(capture.payment_request_status,'paid');
    assert.equal(capture.files.length,5);
    for (const [kind,,count,amount] of fileSpecs) {
      const file=capture.files.find(file=>file.kind===kind);
      assert.equal(file.record_count,count,kind);
      assert.equal(file.total_amount_minor,amount,kind);
    }
    // The invoice's benefit amount must not be replaced by TOKA funding + fees.
    assert.equal(capture.files.find(file=>file.kind==='cfdi_vales').total_amount_minor,5000);
    assert.equal(capture.files.find(file=>file.kind==='layout_toka').total_amount_minor,5116);
    assert.doesNotMatch(JSON.stringify(capture), /PRIVATE_PAYROLL_PERSON|PRIVATE_RFC|employee_name|parsing_metadata/);
    assert.deepEqual((await db.query('select * from public.payroll_run_lines')).rows,[]);
    assert.deepEqual(await rpc('get_payroll_capture_sessions',id(999)),[]);
    await db.exec('reset role');
    const staging=await db.query('select kind,record_count,total_amount_minor from public.payroll_capture_files where session_id=$1',[session]);
    for (const file of staging.rows) {
      assert.equal(file.record_count,file.kind==='layout_spei'?42:null);
      assert.equal(Number(file.total_amount_minor)||null,file.kind==='layout_spei'?999999:null);
    }
  });
});

test('staging metadata is preserved while incomplete saved captures never infer totals', async () => {
  await withFileEvidence(async () => {
    const [capture] = await rpc('get_payroll_capture_sessions',session);
    for (const file of capture.files) {
      assert.equal(file.record_count,file.kind==='layout_spei'?42:null);
      assert.equal(file.total_amount_minor,file.kind==='layout_spei'?999999:null);
    }
  }, async () => {
    await db.query(`update public.payroll_capture_sessions set capture_state='draft',materialized_payment_request_id=null,expires_at=now()+interval '1 day' where id=$1`,[session]);
  });
});

test('verified aggregates require the same file, hash, kind and payroll request', async () => {
  await withFileEvidence(async () => {
    const [capture] = await rpc('get_payroll_capture_sessions',session);
    assert.equal(capture.files.length,5);
    for (const file of capture.files) {
      assert.equal(file.record_count,null,file.kind);
      assert.equal(file.total_amount_minor,null,file.kind);
    }
  }, async () => {
    await db.query('update public.payroll_run_files set sha256=$1 where id=$2',['b'.repeat(64),id(220)]);
    await db.query('update public.payroll_run_files set payment_request_id=$1 where id=$2',[id(999),id(221)]);
    await db.query("update public.payroll_run_files set kind='cfdi_vales' where id=$1",[id(222)]);
    await db.query("update public.payroll_run_files set parsing_metadata=jsonb_build_object('evidence_class','CLIENT_ATTESTED','row_count',1) where id=$1",[id(223)]);
    await db.query('update public.payroll_run_files set capture_file_id=$1 where id=$2',[id(999),id(224)]);
  });
});

test('malformed counts stay unavailable and a materialized request from another company cannot contribute data', async () => {
  await withFileEvidence(async () => {
    const [capture] = await rpc('get_payroll_capture_sessions',session);
    assert.equal(capture.files.find(file=>file.kind==='layout_spei').record_count,null);
    assert.equal(capture.files.find(file=>file.kind==='layout_spei').total_amount_minor,15000);
    await db.exec('reset role');
    await db.query('update public.payment_requests set company_id=$1 where id=$2',[companyB,request]);
    await db.exec('set local role authenticated');
    const [mismatched] = await rpc('get_payroll_capture_sessions',session);
    assert.equal(mismatched.payment_request_status,null);
    assert.ok(mismatched.files.every(file=>file.record_count===null && file.total_amount_minor===null));
  }, async () => {
    await db.query(`update public.payroll_run_files set parsing_metadata=jsonb_set(parsing_metadata,'{row_count}','"invalid"'::jsonb) where id=$1`,[id(222)]);
  });
});

test('inactive memberships and profiles revoke capture access immediately', async () => {
  await db.exec('begin');
  try {
    await db.query('update public.test_memberships set active=false where profile_id=$1',[rh]);
    assert.equal((await db.query('select private.payroll_profile_can_capture($1,$2) ok',[rh,companyA])).rows[0].ok,false);
    await db.query('update public.test_memberships set active=true where profile_id=$1',[rh]);
    await db.query('update public.profiles set active=false where id=$1',[rh]);
    assert.equal((await db.query('select private.payroll_profile_can_capture($1,$2) ok',[rh,companyA])).rows[0].ok,false);
  } finally { await db.exec('rollback'); }
});

test('real payment RPC guards reject an RH capture actor', async () => {
  await assert.rejects(asUser(rh, () => db.query('select public.reserve_payroll_channel_receipt($1,$2,$3,$4,$5,$6)',[request,id(9),'application/pdf',100,'a'.repeat(64),'receipt.pdf'])), /PAYROLL_FINANCE_REQUIRED/);
  await assert.rejects(asUser(rh, () => db.query('select public.reconcile_payroll_channel($1,$2,$3,$4,$5,$6)',[request,id(9),id(10),100,'2026-09-01','REF'])), /PAYROLL_FINANCE_REQUIRED/);
  await assert.rejects(asUser(rh, () => rpc('close_payroll_as_paid',request)), /PAYROLL_FINANCE_REQUIRED/);
});

test('lifecycle produces one registered event and one paid event with all receipts; retries cannot duplicate them', async () => {
  const req=id(101), cap=id(102);
  await db.exec('begin');
  try {
    await db.query(`insert into public.payment_requests(id,company_id,request_type,status,request_number,amount_requested,currency)
      values ($1,$2,'nomina','approved','QA-ONLY',300,'MXN')`,[req,companyA]);
    await db.query(`insert into public.payroll_capture_sessions(id,company_id,capture_state,materialized_payment_request_id,created_by,period_start,period_end)
      values ($1,$2,'draft',$3,$4,'2026-09-01','2026-09-15')`,[cap,companyA,req,rh]);
    await db.query("update public.payroll_capture_sessions set capture_state='materialized' where id=$1",[cap]);
    await db.query("update public.payroll_capture_sessions set updated_at=now() where id=$1",[cap]);
    await db.query("select private.enqueue_payroll_lifecycle($1,'payroll.registered')",[req]);
    for (const [i,channel] of ['banco','spei','vales'].entries()) {
      const c=id(110+i), f=id(120+i);
      await db.query(`insert into public.payroll_channels(id,payment_request_id,channel,amount,currency,dispersion_status,reconciliation_status,receipt_file_id)
        values ($1,$2,$3,100,'MXN','dispersed','reconciled',$4)`,[c,req,channel,f]);
      await db.query(`insert into public.payroll_run_files(id,payment_request_id,payroll_channel_id,kind,storage_bucket,storage_path,mime_type,size_bytes,sha256,parsing_status,parsing_version)
        values ($1,$2,$3,'comprobante','payroll-private',$4,'application/pdf',100,$5,'parsed','payroll-channel-receipt-v1')`,[f,req,c,`${req}/${f}.pdf`,'a'.repeat(64)]);
    }
    await db.query("update public.payment_requests set status='paid' where id=$1",[req]);
    await db.query("select private.enqueue_payroll_lifecycle($1,'payroll.paid')",[req]);
    const events=(await db.query('select id,event_type,recipient_email,payload from public.notification_events where source_id=$1 order by event_type',[req])).rows;
    assert.equal(events.length,2);
    assert.deepEqual(events.map(e=>e.recipient_email),['rh@example.com','finance@example.com']);
    assert.doesNotMatch(JSON.stringify(events),/employee_name|clabe|bank_account|PRIVATE FIXTURE/);
    await db.exec('set local role service_role');
    const claimed=(await db.query("select public.claim_payroll_notifications('worker') result")).rows[0].result;
    assert.equal(claimed.length,2);
    assert.equal((await db.query("select public.claim_payroll_notifications('other-worker') result")).rows[0].result.length,0);
    const doc=(await db.query("select public.get_payroll_notification_document($1,'worker') result",[events.find(e=>e.event_type==='payroll.paid').id])).rows[0].result;
    assert.equal(doc.attachments.length,3);
    assert.equal(doc.recipient_email,'rh@example.com');
    assert.deepEqual(doc.channels.map(c=>c.channel),['banco','spei','vales']);
  } finally { await db.exec('rollback'); }
});

test('client cannot claim notifications or read attachment documents', async () => {
  await assert.rejects(asUser(rh,()=>db.query("select public.claim_payroll_notifications('client')")),{code:'42501'});
  await assert.rejects(asUser(rh,()=>db.query("select public.get_payroll_notification_document($1,'client')",[id(999)])),{code:'42501'});
});

test('paid event is blocked without all channel evidence', async () => {
  await db.exec('begin');
  try {
    await assert.rejects(db.query("select private.enqueue_payroll_lifecycle($1,'payroll.paid')",[request]),/PAYROLL_EVENT_PAID_EVIDENCE_REQUIRED/);
  } finally { await db.exec('rollback'); }
});

test('scoped QA claims only its run; expiration stops delivery and recipient access is rechecked', async () => {
  await db.exec('begin');
  try {
    for (const n of [210,220]) {
      await db.query("insert into public.payment_requests(id,company_id,request_type,status) values ($1,$2,'nomina','draft')",[id(n),companyA]);
      await db.query("insert into public.payroll_capture_sessions(id,company_id,created_by,capture_state,materialized_payment_request_id) values ($1,$2,$3,'materialized',$4)",[id(n+1),companyA,rh,id(n)]);
      await db.query("select private.enqueue_payroll_lifecycle($1,'payroll.registered')",[id(n)]);
    }
    await db.query("update public.payroll_notification_settings set test_capture_session_id=$1,test_recipient_profile_id=$2,test_expires_at=now()-interval '1 minute' where company_id=$3",[id(211),rh,companyA]);
    await db.exec('set local role service_role');
    assert.deepEqual((await db.query("select public.claim_payroll_notifications('qa') result")).rows[0].result,[]);
    await db.query("update public.payroll_notification_settings set test_expires_at=now()+interval '1 hour' where company_id=$1",[companyA]);
    const claimed=(await db.query("select public.claim_payroll_notifications('qa') result")).rows[0].result;
    assert.equal(claimed.length,1);
    const doc=(await db.query("select public.get_payroll_notification_document($1,'qa') result",[claimed[0]])).rows[0].result;
    assert.equal(doc.request_id,id(210));
    assert.equal(doc.test_recipient_email,'rh@example.com');
    await db.exec('reset role');
    await db.query('update public.profiles set active=false where id=$1',[rh]);
    await db.exec('set local role service_role');
    await assert.rejects(db.query("select public.get_payroll_notification_document($1,'qa')",[claimed[0]]),/PAYROLL_NOTIFICATION_TEST_RECIPIENT_REQUIRED/);
  } finally { await db.exec('rollback'); }
});
