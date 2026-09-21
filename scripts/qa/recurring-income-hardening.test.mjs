import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// PostgreSQL 17 in memory: execute the real legacy DDL and forward migration.
// Auth/membership dependencies are fixtures; these tests do not certify hosted
// Supabase/PostgREST or replace authenticated UAT in DEV.
const migrationDir = new URL('../../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDir).filter(name => name.endsWith('_tenant_recurring_income_runtime_hardening.sql'));
assert.equal(migrationNames.length, 1, 'one canonical version of the forward migration');
const migration = readFileSync(new URL(migrationNames[0], migrationDir), 'utf8');
const legacy = readFileSync(new URL('./fixtures/recurring-income-legacy-dev.sql', import.meta.url), 'utf8');
const companyA = '10000000-0000-0000-0000-000000000001';
const companyB = '10000000-0000-0000-0000-000000000002';
const actor = '20000000-0000-0000-0000-000000000001';
const templateA = '30000000-0000-0000-0000-000000000001';
const templateB = '30000000-0000-0000-0000-000000000002';
let db;

async function asRole(role, uid, callback) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? '']);
    await db.exec(`set local role ${role}`);
    return await callback();
  } finally {
    await db.exec('rollback');
  }
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    grant usage on schema auth, public to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    -- Deliberate fallback: the RPC must demand a session even if a profile
    -- helper resolves an actor without auth.uid().
    create function public.current_profile_id() returns uuid language sql stable as $$
      select coalesce(auth.uid(), '${actor}'::uuid)
    $$;
    create function public.has_active_company_membership(p_actor uuid, p_company uuid)
    returns boolean language sql stable as $$
      select p_actor = '${actor}'::uuid and p_company = '${companyA}'::uuid
    $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at := now(); return new; end
    $$;
    create table public.companies (id uuid primary key);
    create table public.profiles (id uuid primary key);
    insert into public.companies values ('${companyA}'), ('${companyB}');
    insert into public.profiles values ('${actor}');
  `);
  await db.exec(legacy);
  // Reproduce the broad table grants observed in DEV, including TRUNCATE.
  await db.exec(`grant all on public.recurring_income_templates, public.tenant_income_entries
    to anon, authenticated, service_role`);
  await db.query(`insert into public.recurring_income_templates
    (id, company_id, payer_name, concept, amount) values
    ($1, $2, 'Fixture A', 'Rent A', 100), ($3, $4, 'Fixture B', 'Rent B', 200)`,
  [templateA, companyA, templateB, companyB]);
  assert.equal((await db.query("select has_table_privilege('anon', 'public.tenant_income_entries', 'TRUNCATE') as allowed")).rows[0].allowed, true);
  await db.exec(migration);
});
after(async () => { await db?.close(); });

test('anon cannot read, write, truncate, or call the generator', async () => {
  for (const sql of [
    'select * from public.tenant_income_entries',
    'delete from public.tenant_income_entries',
    'truncate public.tenant_income_entries',
    'truncate public.recurring_income_templates cascade',
    `select public.generate_recurring_income('${companyA}', '2026-09')`,
  ]) {
    await assert.rejects(asRole('anon', null, () => db.exec(sql)), { code: '42501' });
  }
});

test('authenticated and service roles retain CRUD without table-wide privileges', async () => {
  const { rows } = await db.query(`select role, tbl,
    has_table_privilege(role, tbl, 'SELECT') and has_table_privilege(role, tbl, 'INSERT')
      and has_table_privilege(role, tbl, 'UPDATE') and has_table_privilege(role, tbl, 'DELETE') as crud,
    has_table_privilege(role, tbl, 'TRUNCATE') or has_table_privilege(role, tbl, 'TRIGGER')
      or has_table_privilege(role, tbl, 'REFERENCES') as broad
    from unnest(array['authenticated','service_role']) role
    cross join unnest(array['public.tenant_income_entries','public.recurring_income_templates']) tbl`);
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => row.crud && !row.broad));
  for (const role of ['authenticated', 'service_role']) {
    await assert.rejects(asRole(role, actor, () => db.exec('truncate public.tenant_income_entries')), { code: '42501' });
  }
});

test('the FK rejects another company template even for a role that bypasses RLS', async () => {
  for (const role of ['authenticated', 'service_role']) {
    await assert.rejects(asRole(role, actor, () => db.query(`insert into public.tenant_income_entries
      (company_id, template_id, payer_name, concept, amount) values ($1,$2,'Fixture','Wrong company',1)`,
    [companyA, templateB])), { code: '23503' });
  }
});

test('members can generate their income once and cannot generate another company income', async () => {
  await asRole('authenticated', actor, async () => {
    const run = () => db.query('select public.generate_recurring_income($1,$2) as n', [companyA, '2026-09']);
    assert.equal((await run()).rows[0].n, 1);
    assert.equal((await run()).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from public.tenant_income_entries')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int as n from public.recurring_income_templates')).rows[0].n, 1);
  });
  await assert.rejects(asRole('authenticated', actor, () => db.query(
    'select public.generate_recurring_income($1,$2)', [companyB, '2026-09'])), { code: '42501' });
});

test('a missing authenticated session fails even when the profile helper resolves an actor', async () => {
  for (const role of ['authenticated', 'service_role']) {
    await assert.rejects(asRole(role, null, () => db.query(
      'select public.generate_recurring_income($1,$2)', [companyA, '2026-09'])), { code: '42501' });
  }
});

test('deleting a template preserves the income and its company', async () => {
  await asRole('authenticated', actor, async () => {
    await db.query('select public.generate_recurring_income($1,$2)', [companyA, '2026-09']);
    await db.query('delete from public.recurring_income_templates where id=$1', [templateA]);
    const { rows } = await db.query('select company_id, template_id, amount from public.tenant_income_entries');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].company_id, companyA);
    assert.equal(rows[0].template_id, null);
    assert.equal(Number(rows[0].amount), 100);
  });
});

test('reapplying the migration preserves existing rows and policies', async () => {
  const snapshot = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(t) order by id) from public.recurring_income_templates t) as templates,
    (select jsonb_agg(to_jsonb(t) order by id) from public.tenant_income_entries t) as entries,
    (select jsonb_agg(to_jsonb(p) order by tablename, policyname) from pg_policies p
      where schemaname='public' and tablename in ('recurring_income_templates','tenant_income_entries')) as policies`)).rows;
  const previous = await snapshot();
  await db.exec(migration);
  assert.deepEqual(await snapshot(), previous);
});

test('cross-company legacy rows abort the migration and are never silently changed', async () => {
  await db.exec(`alter table public.tenant_income_entries drop constraint tenant_income_entries_company_template_fk;
    alter table public.tenant_income_entries add constraint tenant_income_entries_template_id_fkey
    foreign key (template_id) references public.recurring_income_templates(id) on delete set null`);
  await db.query(`insert into public.tenant_income_entries
    (company_id, template_id, payer_name, concept, amount) values ($1,$2,'Fixture','Legacy invalid',1)`, [companyA, templateB]);
  await assert.rejects(db.exec(migration), { code: '23503' });
  await db.exec('rollback');
  const { rows } = await db.query('select company_id, template_id from public.tenant_income_entries');
  assert.deepEqual(rows, [{ company_id: companyA, template_id: templateB }]);
  assert.equal((await db.query("select to_regclass('public.recurring_income_templates_company_id_id_uidx') is not null as present")).rows[0].present, true);
  assert.equal((await db.query("select count(*)::int as n from pg_constraint where conrelid='public.tenant_income_entries'::regclass and conname='tenant_income_entries_template_id_fkey'")).rows[0].n, 1);
});
