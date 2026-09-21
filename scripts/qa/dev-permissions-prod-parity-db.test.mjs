import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const opt = id(1), sf = id(2), admin = id(10), operator = id(11), finance = id(12), legacy = id(13)
let db
async function as(actor, run, role = 'authenticated') {
  // Synthetic identities only in this isolated database; never remote JWTs.
  await db.query("select set_config('test.actor',$1,false)", [actor || ''])
  await db.exec(`set role ${role}`)
  try { return await run() } finally { await db.exec('reset role') }
}
const query = (sql, args = []) => db.query(sql, args)

before(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema private; create schema auth;
    grant usage on schema public,auth to anon,authenticated;
    create function current_profile_id() returns uuid language sql stable as $$
      select nullif(current_setting('test.actor',true),'')::uuid $$;
    create function auth.uid() returns uuid language sql stable as $$ select current_profile_id() $$;`)
  await db.exec(read('scripts/qa/fixtures/sin-partida-schema.sql'))
  await db.exec(`create table profile_company_memberships(profile_id uuid,company_id uuid,role_key text,active boolean);
    create table company_access_requests(id uuid primary key,status text,reviewed_at timestamptz,reviewed_by uuid,approved_role text,updated_at timestamptz);
    alter table approver_assignments add unique(company_id,requester_id,approver_id);
    create function flux_sysadmin_roles() returns text[] language sql immutable as $$ select array['sysadmin'] $$;
    create function current_user_has_role(rs text[]) returns boolean language sql stable as $$
      select current_profile_id()='${admin}'::uuid and 'sysadmin'=any(rs) $$;
    create function has_active_company_membership(p uuid,c uuid) returns boolean language sql stable as $$
      select exists(select 1 from profile_company_memberships m join profiles pr on pr.id=m.profile_id
        where m.profile_id=p and m.company_id=c and m.active and pr.active) $$;
    create function private.current_profile_has_company_role(c uuid,rs text[]) returns boolean language sql stable as $$
      select exists(select 1 from profile_company_memberships where profile_id=current_profile_id()
        and company_id=c and active and role_key=any(rs)) $$;
    create function payment_request_has_active_approver_pool(p uuid,c uuid) returns boolean language sql stable as $$
      select exists(select 1 from approver_assignments where requester_id=p and company_id=c and active) $$;
    insert into profiles(id,full_name,email,active) values
      ('${admin}','Admin','admin@example.test',true),('${operator}','Operator','operator@example.test',true),
      ('${finance}','Finance','finance@example.test',true),('${legacy}','Legacy','legacy@example.test',true);
    insert into profile_company_memberships values
      ('${admin}','${opt}','sysadmin',true),('${operator}','${opt}','operator',true),
      ('${finance}','${opt}','finance',true),('${finance}','${sf}','operator',true),
      ('${legacy}','${opt}',null,true),('${legacy}','${sf}','director',false);
    insert into roles(id,name) values ('${id(30)}','finance'),('${id(31)}','director');
    insert into user_roles(profile_id,role_id) values ('${operator}','${id(31)}'),('${legacy}','${id(31)}');
    insert into approval_rules(role_id,company_id,amount_min,amount_max,active,can_approve,can_approve_exception,can_reject)
      values ('${id(30)}','${opt}',0,1000,true,true,false,true);
    insert into company_access_requests(id,status) values ('${id(40)}','pending');`)
  // The private helper depends on the existing canonical role list.
  await db.exec(`create function payment_request_approver_role_names() returns text[] language sql immutable as $$
    select array['finance','finanzas','director','direccion','approver_2','aprobador_2']::text[] $$;`)
  await db.exec(read('supabase/migrations/20260917040714_dev_permissions_prod_parity.sql'))
  await db.exec(`create trigger validate_approver_assignment before insert or update on approver_assignments
    for each row execute function validate_approver_assignment();`)
})
after(async () => { await db?.close() })

test('company Finance is eligible without any global role; global Director does not override company Operator', async () => {
  for (const [person,company,expected] of [[finance,opt,true],[finance,sf,false],[operator,opt,false],[legacy,opt,true],[legacy,sf,false]]) {
    const result = await as(operator, () => query('select is_payment_request_approver_for_company($1,$2) as ok',[person,company]))
    assert.equal(result.rows[0].ok,expected)
  }
})

test('approval rules retain company, amount, and exception boundaries', async () => {
  for (const [company,amount,action,expected] of [[opt,100,'approved',true],[opt,1001,'approved',false],[sf,100,'approved',false],[opt,100,'exception_approved',false]]) {
    const r=await as(operator,()=>query('select payment_request_rule_allows($1,$2,null,$3,$4) as ok',[finance,company,amount,action]))
    assert.equal(r.rows[0].ok,expected)
  }
})

test('only admin can discover/configure approvers and assignment trigger uses company role', async () => {
  await assert.rejects(as(operator,()=>query('select * from list_company_approver_candidates($1,$2)',[opt,operator])),/routing_admin_required/)
  const candidates=await as(admin,()=>query('select * from list_company_approver_candidates($1,$2)',[opt,operator]))
  assert.ok(candidates.rows.some(x=>x.profile_id===finance))
  await assert.rejects(as(operator,()=>query('select add_approver_assignment($1,$2,$3)',[opt,operator,finance])),/routing_admin_required/)
  await assert.rejects(as(admin,()=>query('select add_approver_assignment($1,$2,$3)',[opt,operator,operator])),/requester_cannot_be_own_pool_approver/)
  await assert.rejects(as(admin,()=>query('select add_approver_assignment($1,$2,$3)',[sf,finance,legacy])),/approver_company_membership_required/)
  await assert.rejects(as(admin,()=>query('select add_approver_assignment($1,$2,$3)',[opt,finance,operator])),/approver_role_required/)
  await as(admin,()=>query('select add_approver_assignment($1,$2,$3)',[opt,operator,finance]))
  const options=await as(operator,()=>query('select * from list_payment_request_approver_options($1,null,null)',[opt]))
  assert.deepEqual(options.rows.map(x=>x.profile_id),[finance])
  assert.deepEqual(options.rows[0].role_names ?? options.rows[0].eligible_roles,['finance'])
})

test('private helper and public RPCs remain inaccessible to anonymous callers', async () => {
  const r=await query(`select has_function_privilege('anon','public.list_company_approver_candidates(uuid,uuid)','execute') anon_rpc,
    has_function_privilege('authenticated','private.profile_company_approver_roles(uuid,uuid)','execute') private_helper`)
  assert.equal(r.rows[0].anon_rpc,false); assert.equal(r.rows[0].private_helper,false)
  await assert.rejects(as(null,()=>query('select * from list_payment_request_approver_options($1,null,null)',[opt])),/not_authenticated/)
  await assert.rejects(as(operator,()=>query('select * from list_payment_request_approver_options($1,null,null)',[sf])),/company_scope_required/)
  await assert.rejects(as(null,()=>query('select reject_company_access_request($1)',[id(40)])),/routing_admin_required/)
  await assert.rejects(as(operator,()=>query('select reject_company_access_request($1)',[id(40)])),/routing_admin_required/)
  await as(admin,()=>query('select reject_company_access_request($1)',[id(40)]))
  assert.equal((await query('select status from company_access_requests')).rows[0].status,'rejected')
})
