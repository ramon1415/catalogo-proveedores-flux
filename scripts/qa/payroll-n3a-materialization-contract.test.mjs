import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const migration = fs.readFileSync('supabase/migrations/20260818110000_payroll_n3a_server_materialization.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/payroll-materialize/index.ts', 'utf8');

test('public command accepts identifiers, never authoritative payroll data', () => {
  const inputType = edge.match(/type MaterializeInput = \{[\s\S]*?\};/)?.[0] || '';
  assert.match(edge, /capture_session_id\?: string/);
  assert.match(edge, /expected_version\?: number/);
  assert.match(edge, /idempotency_key\?: string/);
  assert.doesNotMatch(inputType, /(?:amount|rows|employee|channel_totals|sha256)\??:/);
  assert.match(edge, /get_payroll_capture_sessions/);
  assert.match(edge, /PAYROLL_FINANCE_REQUIRED/);
});

test('server redownload, byte hash, MIME, size and opaque path are mandatory', () => {
  assert.match(edge, /storage\/v1\/object\/authenticated\/payroll-private/);
  assert.match(edge, /crypto\.subtle\.digest\("SHA-256"/);
  for (const code of ['PAYROLL_STORAGE_OBJECT_MISSING','PAYROLL_FILE_HASH_MISMATCH','PAYROLL_FILE_SIZE_MISMATCH','PAYROLL_FILE_MIME_MISMATCH','PAYROLL_FILE_PATH_MISMATCH']) {
    assert.ok(edge.includes(code), code);
  }
  assert.match(edge, /parts\[0\] !== context\.company_id/);
  assert.match(edge, /parts\[1\] !== context\.reserved_payment_request_id/);
});

test('server uses canonical N2A SPEI parser and treats browser result as diagnostic', () => {
  assert.match(edge, /import "\.\.\/\.\.\/\.\.\/payroll_parser\.js"/);
  assert.match(edge, /FluxPayrollParser\.parsePayrollSpeiTxt\(bytes\)/);
  assert.match(edge, /authority: "server_verified"/);
  assert.match(edge, /browser_server_match:/);
  assert.doesNotMatch(edge, /client_parsed_unverified.*valid: true/);
});

test('uncertified formats fail closed', () => {
  for (const code of ['PAYROLL_COVER_SHEET_FORMAT_UNVERIFIED','PAYROLL_SAME_BANK_FORMAT_UNVERIFIED','PAYROLL_TOKA_FORMAT_UNVERIFIED']) {
    assert.ok(edge.includes(code), code);
  }
  assert.doesNotMatch(edge, /OCR|manual employee/i);
});

test('atomic internal RPC is service-role-only and transactionally creates all definitive entities', () => {
  assert.match(migration, /create function public\.materialize_payroll_capture_internal/);
  assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(migration, /revoke all on function public\.materialize_payroll_capture_internal[\s\S]*from public, anon, authenticated/);
  for (const table of ['payment_requests','payroll_channels','payroll_run_files','payroll_run_lines']) {
    assert.match(migration, new RegExp(`insert into public\\.${table}`));
  }
  assert.match(migration, /where id=p_capture_session_id for update/);
  assert.match(migration, /payroll_capture_version_conflict/);
  assert.match(migration, /payroll_capture_already_materialized/);
});

test('materialized request remains draft, approver-less, unnotified and outside approval batches', () => {
  assert.match(migration, /'nomina'[\s\S]*'draft'/);
  assert.match(migration, /payment_requests_payroll_draft_no_submission_check/);
  assert.match(migration, /when \(not \(new\.request_type::text = 'nomina' and new\.status::text = 'draft'\)\)/g);
  assert.match(migration, /notification_events where source_id=v_request_id/);
  assert.match(migration, /payment_request_approvals where payment_request_id=v_request_id/);
  assert.match(migration, /approval_batch_items where payment_request_id=v_request_id/);
  assert.doesNotMatch(edge, /rpc\([^\n]+(?:approval|layout|dispersion|notification)/i);
});

test('capture provenance freezes three-segment bytes without weakening PII RLS', () => {
  assert.match(migration, /add column capture_file_id uuid unique/);
  assert.match(migration, /payroll_run_files_capture_provenance_guard/);
  assert.match(migration, /v_capture\.sha256 <> new\.sha256/);
  assert.match(migration, /s\.capture_state='materialized'[\s\S]*payroll_run_files rf where rf\.capture_file_id=f\.id/);
  assert.doesNotMatch(migration, /disable row level security|drop policy payroll_run_(?:files|lines)_finance_select/i);
});

test('synthetic certified SPEI vector remains parsed by payroll-normalized-v1', () => {
  const parser = createRequire(import.meta.url)('../../payroll_parser.js');
  const fixed = (value, width) => value.padEnd(width, ' ');
  const destination = '002000000000000123';
  const useful = [destination, '000000000000000987', 'MXP', '0000000001250.00',
    fixed('PERSONA PRUEBA UNO', 30), '40', destination.slice(0, 3),
    fixed('NOMINA SINTETICA', 30), '       ', 'H'].join('');
  assert.equal(useful.length, 128);
  const bytes = new TextEncoder().encode(`${useful}\r\n`);
  const parsed = parser.parsePayrollSpeiTxt(bytes);
  assert.equal(parsed.parserVersion, 'payroll-normalized-v1');
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.issues.length, 0);
});
