import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const capture = fs.readFileSync('payroll_capture.js','utf8');
const polish = fs.readFileSync('payroll_shadow_ux_polish.js','utf8');
const guards = fs.readFileSync('budget_live_frontend_guards.js','utf8');
const solicitudes = fs.readFileSync('solicitudes.html','utf8');
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

test('shadow-run polish makes server verification, materialized totals and draft stop state explicit', () => {
  assert.doesNotThrow(() => new Function(polish));
  assert.match(guards,/payroll_shadow_ux_polish\.js\?v=20260821-shadow-run-ux-v3/);
  assert.match(solicitudes,/budget_live_frontend_guards\.js\?v=20260821-payroll-shadow-final-r3/);
  assert.match(polish,/Pendiente de validación server-side/);
  assert.match(polish,/Archivo privado recibido · servidor pendiente/);
  assert.match(polish,/Verificado por servidor/);
  assert.match(polish,/Borrador — no enviado a aprobación ni pago/);
  assert.match(polish,/Corrida verificada por servidor/);
  assert.match(polish,/server_verification_summary\?\.line_count/);
  assert.match(polish,/expected_channels/);
  assert.match(polish,/empleados/);
  assert.match(polish,/canales/);
  assert.match(polish,/Tesorería/);
  assert.match(polish,/TOKA presenta diferencia de/);
  assert.match(polish,/requiere revisión de Finanzas/);
});

test('final shadow polish cannot starve synchronization under continuous DOM mutations', () => {
  assert.match(polish,/function scheduleSync\(\)\{\s*if\(state\.timer!==null\)return;/);
  assert.match(polish,/state\.timer=null;\s*runSync\(\)/);
  assert.match(polish,/window\.setTimeout\(runSync,delay\)/);
  assert.match(polish,/function setText\(element,value\)/);
  assert.doesNotMatch(polish,/function scheduleSync\(\)\{\s*clearTimeout\(state\.timer\)/);
});

test('final shadow polish retries aggregate metadata until the authenticated client is ready', () => {
  assert.match(polish,/if\(!c\)\{scheduleMetaRetry\(\);return;\}/);
  assert.match(polish,/state\.metaLoadingFor=sessionId/);
  assert.match(polish,/state\.metaLoadedFor=sessionId/);
  assert.match(polish,/state\.metaLoadedFor=null/);
  assert.match(polish,/scheduleMetaRetry/);
  assert.match(polish,/characterData:true/);
});

test('materialized capture replaces write-looking footer actions with a read-only stop state', () => {
  assert.match(polish,/Materializada · solo lectura/);
  assert.match(polish,/payroll-shadow-materialized-action-hidden/);
  assert.match(polish,/submitRequestBtn/);
  assert.match(polish,/payrollMaterializeBtn/);
  assert.match(polish,/La captura está congelada/);
});

test('shadow-run polish removes duplicate visible company capture and renders inherited budget context', () => {
  assert.match(polish,/payrollCompanyScopeBridge/);
  assert.match(polish,/companyId/);
  assert.match(polish,/payroll-shadow-base-context-hidden/);
  assert.match(polish,/Empresa de la corrida\. Se captura una sola vez aquí/);
  assert.match(polish,/clasificaci\[oó\]n presupuestal/);
  assert.match(polish,/Empresa heredada de la corrida/);
  assert.match(polish,/Presupuesto reutiliza este contexto/);
  assert.match(polish,/payroll-shadow-budget-company-hidden/);
  assert.doesNotMatch(polish,/\.value\s*=\s*[^;]*company/i);
});

test('shadow-run polish is read-only UX and cannot advance payroll workflow', () => {
  assert.match(polish,/get_payroll_capture_sessions/);
  assert.doesNotMatch(polish,/submit_payroll_for_approval|acknowledge_payroll_toka_funding_variance|set_payroll_budget_context|refresh_payroll_budget_validation|functions\.invoke|\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(polish,/employee_name|\brfc\b|\bcurp\b|\bnss\b|\bclabe\b/i);
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
