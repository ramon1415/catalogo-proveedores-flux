import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const ingestion = fs.readFileSync('lib/contpaq/cfdiIngestion.js', 'utf8')
const upload = fs.readFileSync('upload_helper.js', 'utf8')
const migration = fs.readFileSync('supabase/migrations/20260826153000_payment_request_cfdi_facts.sql', 'utf8')

test('FB-2 ingestion consumes the browser parser and the shared validator only', () => {
  assert.match(ingestion, /from ['"]\.\.\/parsers\/cfdiBrowser\.js['"]/)
  assert.match(ingestion, /from ['"]\.\/cfdiValidation\.js['"]/)
  assert.doesNotMatch(ingestion, /fast-xml-parser|node:|\bfs\b|tax_resolver|213-|216-/i)
})

test('FB-2 persistence maps the certified nested comprobante shape without inventing fields', () => {
  assert.match(ingestion, /const comprobante = parsed\?\.comprobante \|\| \{\}/)
  assert.match(ingestion, /issued_at: comprobante\.fecha \|\| null/)
  assert.match(ingestion, /currency: comprobante\.moneda \|\| null/)
  assert.match(ingestion, /subtotal: comprobante\.subTotal \?\? null/)
  assert.match(ingestion, /total: comprobante\.total \?\? null/)
  assert.match(ingestion, /normalized_facts: parsed \|\| \{\}/)
})

test('FB-2 browser-derived facts are explicitly client_unverified and cannot be mistaken for accounting evidence', () => {
  assert.match(ingestion, /CFDI_VERIFICATION_STATUS = ['"]client_unverified['"]/)
  assert.match(ingestion, /verification_status: CFDI_VERIFICATION_STATUS/)
  assert.match(migration, /verification_status text not null default 'client_unverified'/i)
  assert.match(migration, /check \(verification_status = 'client_unverified'\)/i)
  assert.match(migration, /No es fuente autoritativa para FB-7\/contabilidad/i)
})

test('FB-2 malformed CFDI is persisted as invalid and never rethrown as a request failure', () => {
  assert.match(ingestion, /error instanceof CfdiParseError/)
  assert.match(ingestion, /parse_status: parseError \? ['"]invalid['"]/)
  assert.match(ingestion, /parse_error: parseError \|\| null/)
  assert.match(upload, /try \{[\s\S]*ingestRequestCfdi[\s\S]*\} catch \(error\) \{/)
  assert.match(upload, /return path;/)
})

test('FB-2 hook activates only for XML under solicitudes/{uuid}', () => {
  assert.match(upload, /type === ['"]text\/xml['"] \|\| type === ['"]application\/xml['"] \|\| name\.endsWith\(['"]\.xml['"]\)/)
  assert.match(upload, /\^solicitudes\\\/\(\[0-9a-f\]/)
  assert.match(upload, /await tryIngestRequestCfdi\(file, folder, path, client\)/)
  assert.match(migration, /storage_path like \('solicitudes\/' \|\| payment_request_id::text \|\| '\/%'\)/i)
})

test('FB-2 table is idempotent by request + source SHA and keeps CFDI UUID searchable, not hard unique', () => {
  assert.match(migration, /unique \(payment_request_id, source_sha256\)/i)
  assert.match(migration, /on public\.payment_request_cfdi_facts\(company_id, cfdi_uuid\)[\s\S]*where cfdi_uuid is not null/i)
  assert.doesNotMatch(migration, /unique\s*\([^)]*cfdi_uuid/i)
})

test('FB-2 RLS is forced and inherited from the parent request scope', () => {
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /force row level security/i)
  assert.match(migration, /pr\.id = payment_request_cfdi_facts\.payment_request_id/)
  assert.match(migration, /pr\.company_id = payment_request_cfdi_facts\.company_id/)
  assert.match(migration, /has_active_company_membership\(public\.current_profile_id\(\), pr\.company_id\)/)
  assert.match(migration, /grant select, insert on table public\.payment_request_cfdi_facts to authenticated/i)
  assert.doesNotMatch(migration, /grant[^;]*(update|delete)[^;]*authenticated/i)
})

test('FB-2 migration and ingestion contain no Tax Resolver or CONTPAQ account assignment', () => {
  const combined = `${migration}\n${ingestion}`
  assert.doesNotMatch(combined, /213-|216-|tax_resolver|budget_account_mappings|contpaq_account_id|account_code/i)
})
