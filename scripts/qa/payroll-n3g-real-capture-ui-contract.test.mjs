import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const capture = fs.readFileSync('payroll_capture.js','utf8');
const edge = fs.readFileSync('supabase/functions/payroll-materialize/index.ts','utf8');
const migration = fs.readFileSync('supabase/migrations/20260820022528_payroll_n3g_real_capture_ui_contract.sql','utf8');

test('N3G UI exposes the complete certified physical package without employee PII', () => {
  for (const token of ['caratula','layout_mismo_banco','layout_spei','layout_toka','cfdi_vales']) assert.match(capture,new RegExp(token));
  assert.match(capture,/BBVA Nómina 108 TXT/);
  assert.match(capture,/TOKA fondeo TXT/);
  assert.match(capture,/TOKA CFDI XML/);
  assert.match(capture,/Esta vista no muestra nombres, RFC, CURP, NSS, cuentas, CLABE ni referencias de empleados/);
  assert.doesNotMatch(capture,/employee_name\s*[:=]|\brfc\s*[:=]|\bcurp\s*[:=]|\bnss\s*[:=]/i);
});

test('N3G capture requires explicit accounting context and persists it through a dedicated RPC', () => {
  assert.match(capture,/id="payrollCostCenter"/);
  assert.match(capture,/save_payroll_capture_session_n3g/);
  assert.match(capture,/p_cost_center_id:dom\.costCenter\.value/);
  assert.match(migration,/company_cost_centers/);
  assert.match(migration,/payroll_capture_cost_center_invalid/);
  assert.match(migration,/set cost_center_id=p_cost_center_id/);
});

test('only SPEI browser diagnostics become staging parser metadata; other real formats remain server-only', () => {
  assert.match(capture,/p_parser_version:slot==='layout_spei'\?summary\.parserVersion:null/);
  assert.match(capture,/p_parser_contract:slot==='layout_spei'\?summary\.contractVersion:null/);
  assert.match(capture,/p_record_count:slot==='layout_spei'\?summary\.recordCount:null/);
  assert.match(capture,/p_total_amount_minor:slot==='layout_spei'\?summary\.totalAmountMinor:null/);
  assert.match(capture,/layout_toka[\s\S]*parsePayrollSpeiTxt/);
  assert.doesNotMatch(capture,/p_parser_version:slot==='layout_toka'/);
});

test('materialization is invoked through the JWT-protected Edge with a stable version-bound idempotency key', () => {
  assert.match(capture,/client\.functions\.invoke\('payroll-materialize'/);
  assert.match(capture,/idempotencyKey='payroll-n3g:'\+state\.sessionId\+':v'\+expectedVersion/);
  assert.match(edge,/const idempotencyHash=await hashText\(input\.idempotency_key\)/);
  assert.match(edge,/context\.capture_state==="materialized"/);
  assert.match(edge,/p_idempotency_key_hash:idempotencyHash/);
  assert.match(migration,/p_expected_version not in \(v_session\.version,v_session\.version-1\)/);
});

test('Finance sees aggregate employee net vs Treasury outflow and TOKA variance without employee detail', () => {
  assert.match(capture,/Neto empleados/);
  assert.match(capture,/Salida Tesorería/);
  assert.match(capture,/get_payroll_submission_summary/);
  assert.match(migration,/coalesce\(sum\(net_amount\),0\)/);
  assert.match(migration,/'funding_variance'/);
  assert.doesNotMatch(migration,/jsonb_build_object\([\s\S]*'employee_name'/i);
});

test('TOKA variance acknowledgement and individual approver submission reuse N3F/N3B RPCs', () => {
  assert.match(capture,/acknowledge_payroll_toka_funding_variance/);
  assert.match(capture,/list_payment_request_approver_options/);
  assert.match(capture,/submit_payroll_for_approval/);
  assert.doesNotMatch(capture,/decide_payment_request/);
});

test('N3G does not introduce dispersion, payment execution, bank upload, batch approval, or PROD behavior', () => {
  assert.doesNotMatch(capture,/create_payment_layout|upload.*bbva|bank.*upload|dispers|mark.*paid|approval_batch/i);
  assert.doesNotMatch(migration,/insert into public\.payment_layout|update public\.payment_requests[\s\S]*paid|scheduled|finance_validation/i);
  assert.doesNotMatch(migration,/delete from public\./i);
  assert.doesNotMatch(migration,/truncate/i);
});

test('N3G migration is additive to existing payroll contracts and performs no business-data backfill', () => {
  assert.match(migration,/save_payroll_capture_session_n3g/);
  assert.match(migration,/get_payroll_submission_summary/);
  assert.match(migration,/get_payroll_capture_sessions/);
  assert.match(migration,/get_payroll_materialization_context_internal/);
  assert.doesNotMatch(migration,/insert into public\.payment_requests/i);
  assert.doesNotMatch(migration,/insert into public\.payroll_channels/i);
  assert.doesNotMatch(migration,/insert into public\.payroll_run_lines/i);
});
