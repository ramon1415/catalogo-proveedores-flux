import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const ingestion = fs.readFileSync('lib/contpaq/cfdiIngestion.js', 'utf8')
const upload = fs.readFileSync('upload_helper.js', 'utf8')
const migration = fs.readFileSync('supabase/migrations/20260826160401_payment_request_cfdi_facts.sql', 'utf8')
const createdByIndexMigration = fs.readFileSync('supabase/migrations/20260826160958_payment_request_cfdi_facts_created_by_idx.sql', 'utf8')

test('FB-2 ingestion consumes the browser parser and shared validator only', () => {
  assert.match(ingestion, /from ['"]\.\.\/parsers\/cfdiBrowser\.js['"]/)
  assert.match(ingestion, /from ['"]\.\/cfdiValidation\.js['"]/)
  assert.doesNotMatch(ingestion, /fast-xml-parser|node:|\bfs\b|tax_resolver|213-|216-/i)
})

test('FB-2 persistence maps certified nested comprobante shape', () => {
  assert.match(ingestion, /const comprobante = parsed\?\.comprobante \|\| \{\}/)
  assert.match(ingestion, /issued_at: comprobante\.fecha \|\| null/)
  assert.match(ingestion, /currency: comprobante\.moneda \|\| null/)
  assert.match(ingestion, /subtotal: comprobante\.subTotal \?\? null/)
  assert.match(ingestion, /total: comprobante\.total \?\? null/)
  assert.match(ingestion, /normalized_facts: parsed \|\| \{\}/)
})

test('FB-2 browser facts remain client_unverified', () => {
  assert.match(ingestion, /CFDI_VERIFICATION_STATUS = ['"]client_unverified['"]/)
  assert.match(migration, /verification_status text not null default 'client_unverified'/i)
  assert.match(migration, /check \(verification_status = 'client_unverified'\)/i)
})

test('FB-2 created_by is server-controlled and indexed', () => {
  assert.match(migration, /created_by uuid not null default public\.current_profile_id\(\) references public\.profiles\(id\)/i)
  assert.match(migration, /created_by = public\.current_profile_id\(\)/i)
  assert.doesNotMatch(ingestion, /created_by\s*:/)
  assert.doesNotMatch(upload, /createdBy/)
  assert.match(createdByIndexMigration, /create index if not exists payment_request_cfdi_facts_created_by_idx[\s\S]*on public\.payment_request_cfdi_facts\(created_by\)/i)
})

test('FB-2 malformed CFDI is non-blocking and auditable', () => {
  assert.match(ingestion, /error instanceof CfdiParseError/)
  assert.match(ingestion, /parse_status: parseError \? ['"]invalid['"]/)
  assert.match(upload, /try \{[\s\S]*ingestRequestCfdi[\s\S]*\} catch \(error\) \{/)
  assert.match(upload, /return path;/)
})

test('FB-2 hook only activates for XML under solicitudes UUID scope', () => {
  assert.match(upload, /type === ['"]text\/xml['"] \|\| type === ['"]application\/xml['"] \|\| name\.endsWith\(['"]\.xml['"]\)/)
  assert.match(upload, /\^solicitudes\\\/\(\[0-9a-f\]/)
  assert.match(migration, /storage_path like \('solicitudes\/' \|\| payment_request_id::text \|\| '\/%'\)/i)
})

test('FB-2 table is idempotent by request + source SHA', () => {
  assert.match(migration, /unique \(payment_request_id, source_sha256\)/i)
  assert.doesNotMatch(migration, /unique\s*\([^)]*cfdi_uuid/i)
})

test('FB-2 RLS is forced and no client UPDATE or DELETE is granted', () => {
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /force row level security/i)
  assert.match(migration, /grant select, insert on table public\.payment_request_cfdi_facts to authenticated/i)
  assert.doesNotMatch(migration, /grant[^;]*(update|delete)[^;]*authenticated/i)
})

test('FB-2 contains no Tax Resolver or CONTPAQ account assignment', () => {
  const combined = `${migration}\n${createdByIndexMigration}\n${ingestion}`
  assert.doesNotMatch(combined, /213-|216-|tax_resolver|budget_account_mappings|contpaq_account_id|account_code/i)
})
