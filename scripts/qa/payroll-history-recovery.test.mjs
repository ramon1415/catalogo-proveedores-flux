import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Execute the three historical bridges followed by the real separate-flow
// restoration. Dependency tables, membership, materialization and budget
// helpers are fixtures. This is not a full baseline replay or hosted UAT.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [company, actor, payroll, ordinary, category, batch, channel] = [1,2,3,4,5,6,7].map(id);
let db;
let historicalUsedWeeklyCut;
let snapshotConstraint;
const rpc = (name, ...args) => db.query(
  `select public.${name}(${args.map((_, i) => `$${i + 1}::uuid`).join(',')}) as result`, args,
).then(x => x.rows[0].result);
async function rollback(fn) {
  await db.exec('begin');
  try { return await fn(); } finally { await db.exec('rollback'); }
}

before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(read('./fixtures/payroll-pilot-schema.sql'));
  await db.exec(`
    create table budget_categories(id uuid primary key, code text, name text);
    create table proveedores(id uuid primary key,alias text,nombre_completo text);
    create table approval_batches(id uuid primary key,company_id uuid,status text,label text,
      submitted_by uuid,submitted_at timestamptz);
    create table approval_batch_items(id uuid primary key default gen_random_uuid(),batch_id uuid,
      payment_request_id uuid,removed_at timestamptz,director_status text,director_reject_reason text,
      rebatch_status text,rebatch_release_note text,decided_at timestamptz,decided_by uuid,
      review_sequence integer,created_at timestamptz default now(),previous_item_id uuid,
      finance_reviewed_by uuid,finance_reviewed_at timestamptz,resubmitted_at timestamptz,
      resubmitted_by uuid,resubmission_note text);
    create table payment_layout_lines(payment_request_id uuid);
    create table cash_funds(payment_request_id uuid);
    create table payment_receipts(payment_request_id uuid);
    create table activity_log(entity_type text,entity_id uuid,action text,old_values jsonb,
      new_values jsonb,performed_by uuid,notes text);
    create function current_profile_id() returns uuid language sql stable as $$
      select nullif(current_setting('fixture.actor',true),'')::uuid $$;
    create function payroll_has_finance_pii_access() returns boolean language sql stable as $$
      select current_profile_id()='${actor}'::uuid $$;
    create function has_active_company_membership(p uuid,c uuid) returns boolean language sql stable as $$
      select p='${actor}'::uuid and c='${company}'::uuid $$;
    create function payroll_request_has_valid_materialization(p uuid) returns boolean language sql stable as $$
      select p='${payroll}'::uuid $$;
    create function payroll_can_read_summary(p uuid) returns boolean language sql stable as $$ select true $$;
    create function approval_batch_require_finance() returns uuid language sql stable as $$ select current_profile_id() $$;
    create function approval_batch_request_has_active_extraordinary(p uuid) returns boolean language sql stable as $$ select false $$;
    create function approval_batch_request_open_elsewhere(p uuid,b uuid) returns boolean language sql stable as $$ select false $$;
    create function approval_batch_request_has_current_direction_approval(p uuid) returns boolean language sql stable as $$ select false $$;
    create function approval_batch_budget_validation(p uuid) returns jsonb language sql stable as $$
      select jsonb_build_object('status','aprobable') $$;
    insert into companies(id,name) values ('${company}','Fixture company');
    insert into budget_categories values ('${category}','PAYROLL_NON_BUDGET','Fixture category');
    insert into payment_requests(id,company_id,request_type,status,no_presupuestal,
      budget_category_id,request_number,amount_requested,currency,requested_by,
      proveedor_id,cost_center_id,budget_month,payment_method)
    values ('${payroll}','${company}','nomina','draft',true,'${category}','QA-PAYROLL',100,'MXN',
      '${actor}',null,'${id(8)}',current_date,'transfer'),
      ('${ordinary}','${company}','provider_payment','submitted',false,'${category}',
      'QA-PROVIDER',100,'MXN','${actor}','${id(9)}','${id(8)}',current_date,'transfer');
    insert into payroll_channels(id,payment_request_id,channel,amount,currency,
      dispersion_status,reconciliation_status)
      values ('${channel}','${payroll}','banco',100,'MXN','pending','pending');
    insert into approval_batches values ('${batch}','${company}','draft','Fixture',null,null);
  `);
  await db.query("select set_config('fixture.actor',$1,false)", [actor]);
  // Real ordinary-cut eligibility, including its explicit payroll exclusion.
  const baseline = read('../../supabase/migrations/20260811035345_flux_dev_authoritative_brownfield_baseline_v2.sql');
  const eligibility = baseline.match(/CREATE OR REPLACE FUNCTION "public"\."approval_batch_request_eligibility"[\s\S]*?\$\$;/)?.[0];
  assert.ok(eligibility);
  await db.exec(eligibility);
  for (const name of [
    '20260907232403_payroll_confirmation_weekly_cut_bridge.sql',
    '20260907232743_payroll_direct_finance_confirmation_snapshot.sql',
    '20260907233050_payroll_weekly_cut_submit_bridge.sql',
  ]) await db.exec(read(`../../supabase/migrations/${name}`));
  historicalUsedWeeklyCut = await rpc('payroll_uses_weekly_cut_flow', payroll);
  const constraint = async () => (await db.query(`select pg_get_constraintdef(oid) as definition
    from pg_constraint where conname='payment_requests_payroll_submission_snapshot_check'`)).rows[0].definition;
  snapshotConstraint = await constraint();
  await db.exec(read('../../supabase/migrations/20260908001439_payroll_separate_payment_flow_restore.sql'));
  assert.equal(await constraint(), snapshotConstraint);
});
after(async () => { await db?.close(); });

test('historical weekly routing is superseded by the separate payroll flow', async () => {
  assert.equal(historicalUsedWeeklyCut, true);
  assert.equal(await rpc('payroll_uses_weekly_cut_flow', payroll), false);
  const eligibility = await rpc('payroll_weekly_cut_eligibility', payroll, null);
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'payroll_uses_separate_flow');
});

test('finance confirmation enables payroll payment without creating a weekly-cut item', async () => rollback(async () => {
  const result = await rpc('confirm_payroll_finance_review', payroll);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.payment_flow_state, 'ready_for_payment');
  assert.equal(await rpc('payroll_ready_for_dispersion', payroll), true);
  assert.equal((await db.query('select count(*)::int as n from approval_batch_items')).rows[0].n, 0);
  assert.equal((await db.query('select status,approved_by from payment_requests where id=$1', [payroll])).rows[0].approved_by, actor);
}));

test('adding payroll to an ordinary weekly cut remains denied after recovery', async () => rollback(async () => {
  await rpc('confirm_payroll_finance_review', payroll);
  assert.equal(await rpc('approval_batch_request_base_eligible', payroll), false);
  await assert.rejects(rpc('add_request_to_approval_batch', batch, payroll), /payment_request_not_batch_eligible/);
}));

test('submit checks already-present payroll items and refuses the ordinary cut', async () => rollback(async () => {
  await rpc('confirm_payroll_finance_review', payroll);
  await db.query('insert into approval_batch_items(batch_id,payment_request_id,review_sequence) values($1,$2,1)', [batch,payroll]);
  await assert.rejects(rpc('submit_approval_batch', batch), /batch_contains_ineligible_request/);
}));

test('ordinary provider requests still enter and submit a weekly cut', async () => rollback(async () => {
  assert.equal(await rpc('approval_batch_request_base_eligible', ordinary), true);
  const added = await rpc('add_request_to_approval_batch', batch, ordinary);
  assert.equal(added.status, 'pending');
  const submitted = await rpc('submit_approval_batch', batch);
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.item_count, 1);
}));

test('snapshot constraint refuses an approved payroll without finance confirmation', async () => rollback(async () => {
  await assert.rejects(db.query("update payment_requests set status='approved' where id=$1", [payroll]), {code:'23514'});
}));

test('TOKA funding differences still prevent confirmation until acknowledged', async () => {
  await rollback(async () => {
    await db.query("update payroll_channels set channel='vales',expected_funding_amount=110 where id=$1", [channel]);
    await assert.rejects(rpc('confirm_payroll_finance_review', payroll), /PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED/);
  });
  await rollback(async () => {
    await db.query("update payroll_channels set channel='vales',expected_funding_amount=110,funding_variance_acknowledged_at=now() where id=$1", [channel]);
    assert.equal((await rpc('confirm_payroll_finance_review', payroll)).status, 'confirmed');
  });
});
