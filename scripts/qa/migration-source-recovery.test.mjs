import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Targeted PostgreSQL replay of the recovered sources and their successors.
// Dependency tables and authorization helpers below are fixtures, not a full
// baseline replay or certification of hosted Supabase / business UAT.
const dir = new URL('../../supabase/migrations/', import.meta.url);
const versions = [
  '20260901102134', '20260901171427', '20260902041542', '20260902212059',
  '20260903023224', '20260903035514', '20260903040733', '20260903041629',
  '20260903213133', '20260903213224', '20260903213236',
];
const companyA = '10000000-0000-0000-0000-000000000001';
const companyB = '10000000-0000-0000-0000-000000000002';
const provider = '20000000-0000-0000-0000-000000000001';
let db;
const snapshots = new Map();

async function snapshot() {
  return (await db.query(`select jsonb_build_object(
    'functions', (select jsonb_agg(jsonb_build_object('name',p.proname,
      'args',pg_get_function_identity_arguments(p.oid),'body',p.prosrc,
      'config',p.proconfig,'definer',p.prosecdef,'acl',p.proacl::text)
      order by p.proname,p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('create_payment_request',
        'get_payment_request_execution_context_pre_037','confirm_provider_account')),
    'policies', (select jsonb_agg(to_jsonb(p) order by tablename,policyname)
      from pg_policies p where schemaname='public')
  ) as value`)).rows[0].value;
}

async function asRole(role, company, fn) {
  assert.ok(['anon', 'authenticated'].includes(role));
  await db.exec('begin');
  try {
    await db.query("select set_config('fixture.company', $1, true)", [company ?? '']);
    await db.exec(`set local role ${role}`);
    return await fn();
  } finally { await db.exec('rollback'); }
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table companies(id uuid primary key);
    insert into companies values ('${companyA}'), ('${companyB}');
    create table approver_assignments(id uuid primary key);
    create type payment_request_type as enum ('provider_payment','reimbursement');
    create table payment_requests(id uuid primary key default gen_random_uuid(),
      company_id uuid not null references companies(id), status text not null,
      cost_center_id uuid, budget_category_id uuid, budget_month date,
      amount_requested numeric, exchange_rate numeric, budget_decision text);
    create table budget_versions(id uuid primary key, active boolean);
    create table budget_lines(company_id uuid, cost_center_id uuid,
      budget_category_id uuid, budget_month date, amount numeric, budget_version_id uuid);
    create function current_profile_id() returns uuid language sql stable as $$
      select case when nullif(current_setting('fixture.company',true),'') is not null
        then '${provider}'::uuid else null::uuid end
    $$;
    create function has_active_company_membership(actor uuid, company uuid)
      returns boolean language sql stable as $$
      select actor is not null and company::text=current_setting('fixture.company',true)
    $$;
    create function contpaq_mapper_company_access(company uuid)
      returns boolean language sql stable as $$
      select coalesce(company::text=nullif(current_setting('fixture.company',true),''),false)
    $$;
    create table contpaq_accounts(company_id uuid, code text, is_detail boolean);
    create table provider_account_mappings(company_id uuid, proveedor_id uuid,
      contpaq_account_code text, contpaq_provider_id text, updated_at timestamptz,
      primary key(company_id,proveedor_id));
    insert into contpaq_accounts values ('${companyA}','60101',true),
      ('${companyA}','60000',false), ('${companyB}','60201',true);
    insert into provider_account_mappings values
      ('${companyA}','${provider}','OLD','KEEP-THIRD-PARTY',now());
  `);
  const names = readdirSync(dir);
  for (const version of versions) {
    const matches = names.filter(name => name.startsWith(`${version}_`) && name.endsWith('.sql'));
    assert.equal(matches.length, 1, `one source for ${version}`);
    await db.exec(readFileSync(new URL(matches[0], dir), 'utf8'));
    snapshots.set(version, await snapshot());
  }
});
after(async () => { await db?.close(); });

test('fiscal, UUID, reimbursement and unsure migrations leave one unambiguous RPC', async () => {
  const rows = (await db.query(`select pronargs, proargnames from pg_proc
    where pronamespace='public'::regnamespace and proname='create_payment_request'`)).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pronargs, 21);
  assert.deepEqual(rows[0].proargnames.slice(-4),
    ['p_invoice_uuid','p_beneficiary_profile_id','p_request_type','p_partida_unsure']);
  await assert.rejects(db.exec(`select create_payment_request(null, '${companyA}',
    null, null, current_date, 100)`), /not_authenticated/);
});

test('UUID uniqueness ignores case, isolates companies and excludes rejected/cancelled rows', async () => {
  const insert = (company, uuid, status = 'submitted') => db.query(
    'insert into payment_requests(company_id,invoice_uuid,status) values($1,$2,$3)',
    [company, uuid, status]);
  await insert(companyA, 'ABCD-1234');
  await assert.rejects(insert(companyA, 'abcd-1234'), { code: '23505' });
  await insert(companyB, 'abcd-1234');
  await insert(companyA, 'abcd-1234', 'rejected');
  await insert(companyA, 'abcd-1234', 'cancelled');
  await insert(companyA, null);
  await insert(companyA, null);
  assert.equal((await db.query('select count(*)::int as n from payment_requests')).rows[0].n, 6);
});

test('repeated extraordinary execution preserves its function definition and privileges', () => {
  const pick = version => snapshots.get(version).functions.find(
    f => f.name === 'get_payment_request_execution_context_pre_037');
  assert.deepEqual(pick('20260903023224'), pick('20260902041542'));
});

test('E2/E3 successors preserve RPC signatures, security settings and membership policy', () => {
  // The successor adds comments inside the function body. Compare its public
  // contract and ACL here; behavioral guards are exercised in the other cases.
  const contract = version => {
    const value = snapshots.get(version);
    return { policies: value.policies,
      functions: value.functions.map(({ body, ...metadata }) => metadata) };
  };
  assert.deepEqual(contract('20260903213236'), contract('20260903041629'));
});

test('prediction RLS returns only the fixture member company and permits no writes', async () => {
  await db.exec(`grant select, insert on partida_predictions to authenticated;
    insert into partida_predictions(company_id,rfc_emisor,cuenta_gasto_dominante,
      share_dominante,n_cfdis,partida_candidates,is_confident)
    values ('${companyA}','A','60101',1,2,'[]',true),
      ('${companyB}','B','60201',1,2,'[]',true)`);
  const rows = await asRole('authenticated', companyA,
    async () => (await db.query('select rfc_emisor from partida_predictions')).rows);
  assert.deepEqual(rows, [{ rfc_emisor: 'A' }]);
  await assert.rejects(asRole('authenticated', companyA, () => db.exec(`
    insert into partida_predictions(company_id,rfc_emisor,cuenta_gasto_dominante,
      share_dominante,n_cfdis,partida_candidates,is_confident)
    values ('${companyA}','C','60101',1,2,'[]',true)`)), { code: '42501' });
});

test('account confirmation preserves the third-party id and denies other companies/invalid accounts', async () => {
  const confirm = (company, code) => db.query('select confirm_provider_account($1,$2,$3)',
    [company, provider, code]);
  await assert.rejects(asRole('anon', null, () => confirm(companyA, '60101')), { code: '42501' });
  await assert.rejects(asRole('authenticated', companyA, () => confirm(companyB, '60201')),
    /contpaq_mapper_company_access_denied/);
  for (const code of ['60000', '99999']) {
    await assert.rejects(asRole('authenticated', companyA, () => confirm(companyA, code)),
      /contpaq_account_not_found_or_not_detail/);
  }
  await db.query("select set_config('fixture.company', $1, false)", [companyA]);
  await confirm(companyA, '601-01');
  const row = (await db.query('select contpaq_account_code,contpaq_provider_id from provider_account_mappings')).rows[0];
  assert.deepEqual(row, { contpaq_account_code: '60101', contpaq_provider_id: 'KEEP-THIRD-PARTY' });
});
