import assert from 'node:assert/strict'
import { before, beforeEach, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const company = id(1), otherCompany = id(2), finance = id(3), operator = id(4), extraction = id(10), request = id(20)
const updated = '2026-09-15T00:00:00Z'
let db
const call = async (ext = extraction, expected = updated, limit = 20) => (await db.query('select public.preview_payment_receipt_candidates($1,$2,$3) result', [ext, expected, limit])).rows[0].result
async function asActor(actor, action, role = 'authenticated') {
  await db.query("select set_config('test.actor',$1,false)", [actor || ''])
  await db.exec(`set role ${role}`)
  try { return await action() } finally { await db.exec('reset role') }
}
before(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; grant usage on schema auth,public to authenticated,anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
    create table memberships(actor uuid, company_id uuid, finance boolean);
    create function public.payment_reconciliation_require_finance(c uuid) returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $$
    begin
      if auth.uid() is null then raise exception 'not_authenticated'; end if;
      if not exists(select 1 from memberships where actor=auth.uid() and company_id=c and finance) then raise exception 'finance_role_required'; end if;
      return auth.uid();
    end $$;
    create table payment_ingestion_batches(id uuid primary key, company_id uuid, status text);
    create table payment_document_extractions(id uuid primary key, batch_id uuid, company_id uuid, updated_at timestamptz, status text, bank_name text, bank_status text, application_date date, amount_minor bigint, currency text, bank_unique_folio text, source_account_hash text, destination_account_hash text, beneficiary_name text, payment_reason text);
    create table bank_payment_operations(id uuid primary key, extraction_id uuid, company_id uuid, status text, bank_unique_folio text, amount_minor bigint, currency text, beneficiary_name text, payment_reason text, destination_account_hash text);
    create table payment_request_receipt_links(id uuid, operation_id uuid, payment_request_id uuid);
    create table payment_operation_evidence(operation_id uuid,status text,page_count integer,single_operation_attested boolean);
    create table company_bank_accounts(id uuid, company_id uuid, active boolean, bank_name text,currency text,account_number text,clabe text);
    create table payable_snapshots(id uuid primary key,payment_request_id uuid, company_id uuid, version integer, amount_minor bigint,currency text,eligible boolean);
    create table payment_requests(id uuid primary key,company_id uuid,status text,request_number text,concept text,proveedor_id uuid);
    create table proveedores(id uuid primary key,alias text,nombre_completo text,clabe text,cuenta_bancaria text);
    create table payment_receipts(payment_request_id uuid);
    create function public.payment_reconciliation_normalize_bank_name(t text) returns text language sql immutable as $$ select upper(t) $$;
    create function public.payment_reconciliation_account_hash(t text) returns text language sql immutable as $$ select md5(t) $$;
    create function public.payment_reconciliation_source_account_hash_matches(h text,t text) returns boolean language sql immutable as $$ select h=md5(t) $$;
    create function public.payment_receipt_normalize_match_text(t text) returns text language sql immutable as $$ select lower(regexp_replace(t,'[^a-zA-Z0-9]','','g')) $$;
    create function public.payment_reconciliation_snapshot_is_receipt_matchable(s uuid) returns boolean language sql stable as $$ select eligible from payable_snapshots where id=s $$;
    create function public.get_payment_receipt_link_preview(op uuid) returns jsonb language sql stable as $$ select jsonb_build_object('operation_id',op,'link',(select to_jsonb(l) from payment_request_receipt_links l where operation_id=op)) $$;
    alter table payment_document_extractions enable row level security;
    alter table payment_requests enable row level security;
    alter table payable_snapshots enable row level security;
  `)
  const baseline = readFileSync(new URL('../../supabase/migrations/20260811035345_flux_dev_authoritative_brownfield_baseline_v2.sql', import.meta.url), 'utf8')
  await db.exec(baseline.match(/CREATE OR REPLACE FUNCTION "public"\."find_payment_receipt_candidates"[\s\S]*?\n\$\$;/)[0])
  await db.exec(readFileSync(new URL('../../supabase/migrations/20260915030837_receipt_candidates_before_confirmation.sql', import.meta.url), 'utf8'))
})
after(async () => { await db.close() })
beforeEach(async () => {
  await db.exec('truncate memberships,payment_ingestion_batches,payment_document_extractions,bank_payment_operations,payment_request_receipt_links,payment_operation_evidence,company_bank_accounts,payable_snapshots,payment_requests,proveedores,payment_receipts')
  await db.query('insert into memberships values($1,$2,true),($3,$2,false)', [finance, company, operator])
  await db.query("insert into payment_ingestion_batches values($1,$2,'review_required')", [id(5), company])
  await db.query("insert into company_bank_accounts values($1,$2,true,'BBVA','MXN','000000000199158804',null)", [id(6), company])
  await db.query("insert into payment_document_extractions values($1,$2,$3,$4,'review_required','BBVA','Operado','2026-09-15',147915,'MXN','990150926824739561708',md5('000000000199158804'),null,'SERVICIOS DEMOSTRACION FLUX SA DE CV','PAGO DE SERVICIOS')", [extraction, id(5), company, updated])
  await db.query("insert into proveedores values($1,'Servicios Demo','SERVICIOS DEMOSTRACION FLUX SA DE CV',null,'999999990117')", [id(7)])
  await db.query("insert into payment_requests values($1,$2,'approved','SOL-TEST-01','Servicio mensual',$3)", [request, company, id(7)])
  await db.query("insert into payable_snapshots values($1,$2,$3,1,147915,'MXN',true)", [id(30), request, company])
})

test('amount and beneficiary suggest a request without a request number, operation or reviewed evidence; read-only transaction succeeds', async () => {
  const before = await db.query('select to_jsonb(e) value from payment_document_extractions e')
  const result = await asActor(finance, async () => {
    await db.exec('begin read only')
    try { return await call() } finally { await db.exec('rollback') }
  })
  assert.equal(result.outcome, 'exact')
  assert.equal(result.items[0].payment_request_id, request)
  assert.equal(result.items[0].account_match, false)
  assert.equal(result.items[0].name_match, true)
  assert.equal(result.operation_id, null)
  assert.equal(result.read_only, true)
  assert.doesNotMatch(JSON.stringify(result), /source_account_hash|destination_account_hash|000000000199158804|999999990117/)
  assert.deepEqual((await db.query('select to_jsonb(e) value from payment_document_extractions e')).rows, before.rows)
  assert.equal((await db.query('select count(*)::int n from bank_payment_operations')).rows[0].n, 0)
  assert.equal((await db.query('select count(*)::int n from payment_request_receipt_links')).rows[0].n, 0)
})

test('unauthenticated, anon, operator and another-company finance cannot preview; direct table access remains denied', async () => {
  await assert.rejects(asActor(null, () => call()), /not_authenticated/)
  await assert.rejects(asActor(finance, () => call(), 'anon'), /permission denied/)
  await assert.rejects(asActor(operator, () => call()), /finance_role_required/)
  await db.query('update memberships set company_id=$1 where actor=$2', [otherCompany, finance])
  await assert.rejects(asActor(finance, () => call()), /finance_role_required/)
  await assert.rejects(asActor(finance, () => db.query('select * from payment_requests')), /permission denied/)
})

test('stale extraction and invalid limits fail before a suggestion is trusted', async () => {
  await assert.rejects(asActor(finance, () => call(extraction, '2026-09-14T00:00:00Z')), /stale_payment_extraction/)
  await assert.rejects(asActor(finance, () => call(extraction, null)), /stale_payment_extraction/)
  await assert.rejects(asActor(finance, () => call(extraction, updated, 0)), /invalid_limit/)
})

test('approval, released eligibility, current snapshot, exact amount and currency remain mandatory', async () => {
  for (const sql of ["update payment_requests set status='submitted'", 'update payable_snapshots set eligible=false', 'update payable_snapshots set amount_minor=147916', "update payable_snapshots set currency='USD'", `update payment_requests set company_id='${otherCompany}'`]) {
    await db.exec('begin')
    try { await db.exec(sql); assert.equal((await asActor(finance, () => call())).outcome, 'none') }
    finally { await db.exec('rollback') }
  }
  await db.query("insert into payable_snapshots values($1,$2,$3,2,999,'MXN',true)", [id(31), request, company])
  assert.equal((await asActor(finance, () => call())).outcome, 'none')
})

test('multiple requests remain ambiguous; provider mismatches are not suggested', async () => {
  await db.query("insert into payment_requests values($1,$2,'approved','SOL-TEST-02','Otra solicitud',$3)", [id(21), company, id(7)])
  await db.query("insert into payable_snapshots values($1,$2,$3,1,147915,'MXN',true)", [id(31), id(21), company])
  assert.equal((await asActor(finance, () => call())).outcome, 'multiple')
  await db.exec("update payment_document_extractions set beneficiary_name='OTRO BENEFICIARIO'")
  assert.equal((await asActor(finance, () => call())).outcome, 'none')
  await db.exec("update payment_document_extractions set destination_account_hash=md5('999999990117')")
  assert.equal((await asActor(finance, () => call())).outcome, 'multiple')
})

test('blocked PDFs, foreign source accounts, duplicate accounts and existing bank folios remain blocked', async () => {
  for (const [sql, reason] of [
    ["update payment_document_extractions set status='blocked'", 'payment_extraction_not_conciliable'],
    ["update payment_document_extractions set bank_status='Pendiente'", 'payment_extraction_not_conciliable'],
    ["update payment_document_extractions set source_account_hash=md5('other')", 'bank_payment_operation_company_account_mismatch'],
    ["insert into company_bank_accounts select '00000000-0000-0000-0000-000000000008',company_id,active,bank_name,currency,account_number,clabe from company_bank_accounts", 'bank_payment_operation_company_account_ambiguous'],
    [`insert into bank_payment_operations(id,company_id,extraction_id,bank_unique_folio) values('${id(40)}','${company}','${id(11)}','990150926824739561708')`, 'bank_payment_operation_folio_duplicate'],
  ]) {
    await db.exec('begin')
    try { await db.exec(sql); assert.equal((await asActor(finance, () => call())).block_reason, reason) }
    finally { await db.exec('rollback') }
  }
})

test('existing receipt links are excluded and accepted previews retain the old candidate eligibility', async () => {
  await db.query("insert into bank_payment_operations select $1,id,company_id,'available',bank_unique_folio,amount_minor,currency,beneficiary_name,payment_reason,destination_account_hash from payment_document_extractions", [id(40)])
  await db.exec("update payment_document_extractions set status='accepted'")
  await db.query("insert into payment_operation_evidence values($1,'shareable',1,true)", [id(40)])
  const preview = await asActor(finance, () => call())
  const existing = await asActor(finance, async () => (await db.query('select public.find_payment_receipt_candidates($1) result', [id(40)])).rows[0].result)
  assert.deepEqual(preview.items.map(c => c.payment_request_id), existing.items.map(c => c.payment_request_id))
  await db.query('insert into payment_request_receipt_links values($1,$2,$3)', [id(50), id(40), request])
  const linked = await asActor(finance, () => call())
  assert.equal(linked.outcome, 'linked')
  assert.deepEqual(linked.items, [])
})
