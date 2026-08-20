import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration=fs.readFileSync('supabase/migrations/20260820160925_payroll_n4b_channel_receipt_reconciliation.sql','utf8');
const grantMigration=fs.readFileSync('supabase/migrations/20260820161058_payroll_n4b_storage_helper_execute.sql','utf8');
const migrations=migration+'\n'+grantMigration;
const edge=fs.readFileSync('supabase/functions/payroll-receipt-verify/index.ts','utf8');
const ui=fs.readFileSync('payroll_reconciliation.js','utf8');
const html=fs.readFileSync('nomina_reconciliacion.html','utf8');

test('N4B reuses payroll_run_files/payroll_channels and stores one selected receipt snapshot on the channel',()=>{
  for(const token of ['receipt_file_id','receipt_amount','receipt_payment_date','receipt_reference_hint']) assert.match(migration,new RegExp(token));
  assert.match(migration,/kind='comprobante'/);
  assert.doesNotMatch(migration,/create\s+table/i);
  assert.match(migration,/payroll_channels_reconciliation_receipt_check/);
});

test('receipt reservation is Finance-only, company-scoped, PDF-only, and requires dispersed approved payroll',()=>{
  assert.match(migration,/reserve_payroll_channel_receipt/);
  assert.match(migration,/payroll_has_finance_pii_access/);
  assert.match(migration,/has_active_company_membership/);
  assert.match(migration,/PAYROLL_RECEIPT_REQUIRES_DISPERSED_CHANNEL/);
  assert.match(migration,/PAYROLL_RECEIPT_PDF_REQUIRED/);
  assert.match(migration,/10485760/);
  assert.match(migration,/PAYROLL_RECEIPT_SHA256_INVALID/);
});

test('private storage upload is bound to a reserved payroll_run_files receipt row',()=>{
  assert.match(migration,/payroll_run_file_storage_insert_allowed/);
  assert.match(migration,/drop policy if exists payroll_private_finance_insert/);
  assert.match(migration,/file\.storage_path=p_name/);
  assert.match(migration,/file\.parsing_status='pending'/);
  assert.match(migration,/channel\.dispersion_status='dispersed'/);
  assert.match(migrations,/grant execute on function public\.payroll_run_file_storage_insert_allowed\(text\) to authenticated/);
});

test('server verifier downloads bytes and enforces size MIME SHA256 PDF header and EOF without OCR',()=>{
  assert.match(edge,/storage\/v1\/object\/authenticated\/payroll-private/);
  assert.match(edge,/sha256Hex/);
  assert.match(edge,/bytes\.byteLength !== Number\(context\.size_bytes\)/);
  assert.match(edge,/application\/pdf/);
  assert.match(edge,/%PDF-/);
  assert.match(edge,/%%EOF/);
  assert.match(edge,/confirm_payroll_channel_receipt_internal/);
  assert.doesNotMatch(edge,/ocr|tesseract|vision|openai/i);
});

test('reconciliation requires server-verified evidence and exact channel amount',()=>{
  assert.match(migration,/reconcile_payroll_channel/);
  assert.match(migration,/parsing_version<>'payroll-channel-receipt-v1'/);
  assert.match(migration,/p_receipt_amount<>v_channel\.amount/);
  assert.match(migration,/PAYROLL_RECONCILIATION_AMOUNT_MISMATCH/);
  assert.match(migration,/reconciliation_status='reconciled'/);
  assert.match(migration,/receipt_file_id=v_file\.id/);
});

test('approved to paid is only enabled through the N4B close RPC and all reconciled evidence gates',()=>{
  assert.match(migration,/current_setting\('app\.payroll_n4b_close_request',true\)/);
  assert.match(migration,/PAYROLL_PAID_CLOSE_RPC_REQUIRED/);
  assert.match(migration,/PAYROLL_PAID_RECONCILIATION_REQUIRED/);
  assert.match(migration,/set_config\('app\.payroll_n4b_close_request'/);
  assert.match(migration,/status='paid'::public\.payment_request_status/);
  assert.match(migration,/paid_at=now\(\)/);
  assert.match(migration,/paid_by=v_actor/);
  assert.doesNotMatch(migration,/scheduled'::public\.payment_request_status|finance_validation'::public\.payment_request_status/);
});

test('Finance UI performs receipt reserve upload verify reconcile and close without bank execution or employee PII',()=>{
  for(const token of ['get_payroll_reconciliation_queue','get_payroll_reconciliation_summary','reserve_payroll_channel_receipt','payroll-receipt-verify','reconcile_payroll_channel','close_payroll_as_paid']) assert.match(ui,new RegExp(token));
  assert.match(ui,/storage\.from\(reserved\.data\.storage_bucket\)\.upload/);
  assert.match(html,/no usa OCR/i);
  assert.doesNotMatch(ui,/employee_name|\brfc\b|\bcurp\b|\bnss\b|\bclabe\b|bank_account/i);
  assert.doesNotMatch(ui,/create_payment_layout|bank.*upload|bbva.*api|mark.*scheduled|decide_payment_request/i);
});

test('N4B migrations have no business-data backfill and internal verifier is service-role only',()=>{
  assert.doesNotMatch(migrations,/insert into public\.payment_requests/i);
  assert.doesNotMatch(migrations,/insert into public\.payroll_channels/i);
  assert.doesNotMatch(migrations,/delete from public\./i);
  assert.doesNotMatch(migrations,/truncate/i);
  assert.match(migration,/PAYROLL_RECEIPT_SERVICE_ROLE_REQUIRED/);
  assert.match(migration,/grant execute on function public\.confirm_payroll_channel_receipt_internal\(uuid,text,bigint,text\) to service_role/);
  assert.match(migration,/revoke all on function public\.confirm_payroll_channel_receipt_internal\(uuid,text,bigint,text\) from public,anon,authenticated/);
});
