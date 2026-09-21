import assert from 'node:assert/strict'
import { before, beforeEach, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const opt = id(1), sf = id(2), other = id(3), cesar = id(10), cc = id(30), provider = id(31), normal = id(32)
const actors = { operator: id(11), finance: id(12), director: id(13), sysadmin: id(14) }
const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20260916002650_requests_sin_partida_cesar.sql')
let db, sin
async function as(actor, run, role = 'authenticated') {
  await db.query("select set_config('test.actor',$1,false)", [actor || ''])
  await db.exec(`set role ${role}`)
  try { return await run() } finally { await db.exec('reset role') }
}
async function create({ actor = actors.operator, company = opt, type = 'provider_payment', category = sin, description = 'Material de limpieza' } = {}) {
  return as(actor, async () => (await db.query(`select public.create_payment_request(
    p_proveedor_id=>$1, p_company_id=>$2, p_cost_center_id=>$3, p_budget_category_id=>$4,
    p_budget_month=>'2026-09-01', p_amount_requested=>100, p_description=>$5,
    p_request_type=>$6, p_beneficiary_profile_id=>$7,
    p_approver_id=>$8, p_approver_assignment_id=>$9) result`,
    [type === 'reimbursement' ? null : provider, company, cc, category, description, type,
      type === 'reimbursement' ? actor : null, actors.finance, id(50)])).rows[0].result)
}
const row = async request => (await db.query('select * from payment_requests where id=$1', [request.payment_request_id])).rows[0]
const approve = (request, actor = cesar) => as(actor, () => db.query("select decide_payment_request($1,$2,'approved',null)", [request.payment_request_id, actor]))

before(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema private; grant usage on schema public,private to authenticated;
    grant usage on schema public to anon;
    create function public.current_profile_id() returns uuid language sql stable as $$
      select nullif(current_setting('test.actor',true),'')::uuid $$;`)
  await db.exec(read('scripts/qa/fixtures/sin-partida-schema.sql'))
  await db.exec(`alter table budget_categories add unique(code);
    alter table payment_requests add constraint payment_requests_approver_selection_source_check
      check(approver_selection_source is null or approver_selection_source in ('assigned','approval_rules'));
    create table memberships(profile_id uuid,company_id uuid,role text);
    create function has_active_company_membership(p uuid,c uuid) returns boolean language sql stable as $$
      select exists(select 1 from memberships where profile_id=p and company_id=c) $$;
    create function flux_sysadmin_roles() returns text[] language sql immutable as $$ select array['sysadmin'] $$;
    create function current_user_has_role(rs text[]) returns boolean language sql stable as $$
      select exists(select 1 from memberships where profile_id=current_profile_id() and role=any(rs)) $$;
    create function payment_request_approver_role_names() returns text[] language sql immutable as $$ select array['finance','director','sysadmin'] $$;
    create function is_payment_request_approver_for_company(p uuid,c uuid) returns boolean language sql stable as $$
      select exists(select 1 from memberships m join profiles pr on pr.id=m.profile_id
        where m.profile_id=p and m.company_id=c and pr.active and m.role=any(payment_request_approver_role_names())) $$;
    create function payment_request_has_active_approver_pool(p uuid,c uuid) returns boolean language sql stable as $$
      select exists(select 1 from approver_assignments where requester_id=p and company_id=c and active) $$;
    create function payment_request_rule_allows(p uuid,c uuid,cc uuid,a numeric,act text) returns boolean language sql stable as $$
      select is_payment_request_approver_for_company(p,c) $$;
    create function generate_payment_request_number(y integer) returns text language sql volatile as $$ select 'QA-'||gen_random_uuid()::text $$;
    create function verify_budget_availability(uuid,uuid,uuid,date,numeric,boolean,boolean) returns jsonb language sql as $$
      select jsonb_build_object('status','aprobable','motivo',null,'disponible_actual',1000,'disponible_despues',900,'faltante',0) $$;
    grant select,insert,update,delete on all tables in schema public to authenticated;
    alter table payment_requests enable row level security;
    create policy company_requests on payment_requests to authenticated
      using (has_active_company_membership(current_profile_id(),company_id))
      with check (has_active_company_membership(current_profile_id(),company_id));
    insert into companies(id,name,rfc,active) values
      ('${opt}','Operadora','AFE190704UE0',true),('${sf}','Fersana','SFE100825TM9',true),('${other}','Other','OTHER',true);
    insert into profiles(id,email,full_name,active) values ('${cesar}','cesar@quantta.mx','César',true);
    insert into memberships values ('${cesar}','${opt}','director'),('${cesar}','${sf}','director');
    insert into cost_centers(id,code,name,active) values ('${cc}','QA','QA',true);
    insert into proveedores(id,alias) values ('${provider}','QA proveedor');
    insert into budget_categories(id,code,name,active,no_presupuestal) values ('${normal}','NORMAL','Presupuestada',true,false);
    insert into roles(id,name) values ('${id(40)}','director');
    insert into user_roles(id,profile_id,role_id) values ('${id(41)}','${cesar}','${id(40)}');
    insert into approval_rules(id,role_id,active,amount_min,can_approve,can_reject,can_request_changes,approval_level)
      values ('${id(42)}','${id(40)}',true,0,true,true,true,1);`)
  for (const [role, actor] of Object.entries(actors)) {
    await db.query('insert into profiles(id,email,full_name,active) values($1,$2,$3,true)', [actor, role+'@example.test',role])
    await db.query('insert into memberships values($1,$2,$4),($1,$3,$4)', [actor,opt,sf,role])
  }
  await db.query('insert into approver_assignments(id,company_id,requester_id,approver_id,active) values($1,$2,$3,$4,true)', [id(50),opt,actors.operator,actors.finance])
  await db.exec(migration)
  sin = (await db.query("select id from budget_categories where code='SIN_PARTIDA'")).rows[0].id
  const old = read('supabase/migrations/20260903154601_payment_request_exception_quick_approve_dev.sql')
  for (const name of ['decide_payment_request_internal','decide_payment_request']) {
    const fn = old.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`, 'i'))
    assert.ok(fn, name); await db.exec(fn[0])
  }
  const budget = read('supabase/migrations/20260903041213_fonacot_no_presupuestal.sql')
  await db.exec(budget.match(/create or replace function public\.set_payment_request_no_presupuestal_snapshot\([\s\S]*?\$function\$;/i)[0])
  await db.exec(`create trigger validate_payment_request_approver_scope_insert before insert on payment_requests
      for each row execute function validate_payment_request_approver_scope();
    create trigger validate_payment_request_approver_scope_update before update of approver_id,approver_assignment_id,approver_selection_source,company_id,requested_by,cost_center_id,amount_requested on payment_requests
      for each row execute function validate_payment_request_approver_scope();
    create trigger zz_payment_request_no_presupuestal_snapshot before insert or update of budget_category_id,no_presupuestal on payment_requests
      for each row execute function set_payment_request_no_presupuestal_snapshot();`)
})
after(async () => { await db?.close() })
beforeEach(async () => { await db.exec('truncate payment_requests,reimbursement_items,payment_request_approvals') })

test('one category in both companies, every requester role and ordinary request type is submitted to Cesar despite another configured pool', async () => {
  for (const company of [opt,sf]) for (const actor of Object.values(actors))
    for (const type of ['provider_payment','reimbursement','deposit_refund','other','cash','check','online_purchase','convenio']) {
      const result = await create({company,actor,type}), saved = await row(result)
      assert.equal(saved.approver_id, cesar); assert.equal(saved.approver_selection_source,'sin_partida')
      assert.equal(saved.approver_assignment_id,null); assert.equal(saved.status,'submitted')
      assert.equal(saved.budget_category_id,sin); assert.equal(saved.no_presupuestal,true)
      assert.equal(saved.sin_partida_description,null); assert.equal(result.budget_decision,'aprobable')
    }
  assert.equal((await db.query("select count(*)::int n from budget_categories where code='SIN_PARTIDA'")).rows[0].n,1)
})

test('Cesar explicit decision records the description; scheduled and paid retain the same category and label', async () => {
  const result = await create({description:'Compra de material de limpieza'})
  await approve(result)
  let saved = await row(result)
  assert.equal(saved.sin_partida_description,'Compra de material de limpieza'); assert.equal(saved.approved_by,cesar)
  for (const status of ['scheduled','paid']) {
    await as(actors.finance,()=>db.query('update payment_requests set status=$1 where id=$2',[status,result.payment_request_id]))
    saved = await row(result); assert.equal(saved.status,status); assert.equal(saved.budget_category_id,sin)
    assert.equal(saved.sin_partida_description,'Compra de material de limpieza')
  }
})

test('a direct status edit, another approver, or actor spoofing cannot approve Sin partida', async () => {
  const result = await create()
  await assert.rejects(approve(result,actors.finance),/selected_approver_only/)
  await assert.rejects(as(actors.operator,()=>db.query("select decide_payment_request($1,$2,'approved',null)",[result.payment_request_id,cesar])),/actor_profile_must_match_current_profile/)
  for(const actor of [actors.operator,actors.finance,actors.sysadmin,cesar]) {
    await assert.rejects(as(actor,()=>db.query("update payment_requests set status='approved' where id=$1",[result.payment_request_id])),/sin_partida_cesar_approval_required/)
  }
  await assert.rejects(as(actors.finance,()=>db.query("update payment_requests set status='paid' where id=$1",[result.payment_request_id])),/sin_partida_approval_required/)
  assert.equal((await row(result)).status,'submitted')
})

test('company, authentication, configuration, self-approval and description checks fail closed', async () => {
  await assert.rejects(as(null,()=>db.query('select * from get_sin_partida_approver($1)',[opt])),/not_authenticated/)
  await assert.rejects(as(actors.operator,()=>db.query('select * from get_sin_partida_approver($1)',[opt]),'anon'),/permission denied/)
  await assert.rejects(create({company:other}),/requester_company_membership_required/)
  await assert.rejects(create({actor:cesar}),/requester_cannot_be_own_approver/)
  await assert.rejects(create({description:'  '}),/sin_partida_description_required/)
  await as(actors.operator,async()=> {
    await assert.rejects(db.query('select * from private.sin_partida_approval_policy'),/permission denied/)
    await assert.rejects(db.query('select * from get_sin_partida_approver($1)',[other]),/company_scope_required/)
  })
})

test('material edits erase the old label and require a new explicit approval, while client label edits are ignored', async () => {
  const result = await create(); await approve(result)
  await as(actors.operator,()=>db.query("update payment_requests set sin_partida_description='FORGED' where id=$1",[result.payment_request_id]))
  assert.equal((await row(result)).sin_partida_description,'Material de limpieza')
  await as(actors.operator,()=>db.query("update payment_requests set description='Servicio de reparación',amount_requested=200 where id=$1",[result.payment_request_id]))
  let saved = await row(result); assert.equal(saved.status,'submitted'); assert.equal(saved.sin_partida_description,null)
  await approve(result); saved = await row(result); assert.equal(saved.sin_partida_description,'Servicio de reparación')
  await assert.rejects(as(actors.operator,()=>db.query('update payment_requests set budget_category_id=$1 where id=$2',[normal,result.payment_request_id])),/sin_partida_classification_immutable/)
  await assert.rejects(as(actors.operator,()=>db.query('update payment_requests set approver_id=$1 where id=$2',[actors.finance,result.payment_request_id])),/payment_request_approver_selection_immutable/)
})

test('all reimbursement items must share Sin partida and match the approved total; mixed or incomplete requests cannot be paid', async () => {
  const result = await create({type:'reimbursement'})
  await assert.rejects(approve(result),/sin_partida_reimbursement_incomplete/)
  await assert.rejects(as(actors.operator,()=>db.query('insert into reimbursement_items(payment_request_id,company_id,budget_category_id,amount) values($1,$2,$3,100)',[result.payment_request_id,opt,normal])),/sin_partida_reimbursement_mixed_categories/)
  await as(actors.operator,()=>db.query('insert into reimbursement_items(payment_request_id,company_id,budget_category_id,descripcion,amount) values($1,$2,$3,$4,40),($1,$2,$3,$5,60)',[result.payment_request_id,opt,sin,'Compra A','Compra B']))
  await approve(result)
  await assert.rejects(as(actors.operator,()=>db.query('delete from reimbursement_items where payment_request_id=$1',[result.payment_request_id])),/sin_partida_reimbursement_approved_immutable/)
  assert.equal((await row(result)).budget_category_id,sin)
})

test('normal categorized requests keep their configured approver and budget classification', async () => {
  const result = await create({category:normal}), saved = await row(result)
  assert.equal(saved.approver_id,actors.finance); assert.equal(saved.approver_selection_source,'assigned')
  assert.equal(saved.budget_category_id,normal); assert.equal(saved.no_presupuestal,false)
})
