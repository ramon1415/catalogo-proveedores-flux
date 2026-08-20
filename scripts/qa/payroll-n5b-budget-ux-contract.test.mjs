import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const wrapper=fs.readFileSync('budget_live_frontend_guards.js','utf8');
const preserved=fs.readFileSync('budget_live_frontend_guards_base.js','utf8');
const deepLink=fs.readFileSync('payroll_budget_deeplink.js','utf8');
const html=fs.readFileSync('nomina_presupuesto.html','utf8');

function gitBlobSha(content){
  const bytes=Buffer.from(content,'utf8');
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
}

test('N5B preserves the pre-existing solicitudes budget frontend guard byte-identical',()=>{
  assert.equal(gitBlobSha(preserved),'a76d37cc16add8d755e5c1c1375d6d570369d00a');
  assert.match(wrapper,/budget_live_frontend_guards_base\.js/);
  assert.match(wrapper,/base\.onload = initN5B/);
});

test('capture UX derives the materialized request from the existing payroll session and reads only the aggregate summary',()=>{
  assert.match(wrapper,/get_payroll_capture_sessions/);
  assert.match(wrapper,/materialized_payment_request_id/);
  assert.match(wrapper,/get_payroll_submission_summary/);
  assert.match(wrapper,/summary\.budget_ready === true/);
  assert.doesNotMatch(wrapper,/from\(['"]payroll_run_lines|employee_name|\brfc\b|\bcurp\b|\bnss\b|\bclabe\b/i);
});

test('budget-not-ready visually blocks approval and exposes an exact-request CTA',()=>{
  assert.match(wrapper,/payroll-n5b-budget-blocked/);
  assert.match(wrapper,/Configurar presupuesto/);
  assert.match(wrapper,/nomina_presupuesto\.html\?request_id=/);
  assert.match(wrapper,/PAYROLL|Presupuesto requerido|Configura y valida el presupuesto/);
  assert.match(wrapper,/#payrollSubmitApprovalBtn/);
});

test('N5B never forces N3G approval visible and leaves TOKA/approver gates authoritative',()=>{
  assert.match(wrapper,/approval\.classList\.remove\("payroll-n5b-budget-blocked"\)/);
  assert.doesNotMatch(wrapper,/approval\.classList\.remove\(['"]hidden['"]\)/);
  assert.doesNotMatch(wrapper,/submit_payroll_for_approval|acknowledge_payroll_toka_funding_variance|list_payment_request_approver_options/);
});

test('deep link validates request_id and clicks only the matching N5A queue item',()=>{
  assert.match(deepLink,/new URLSearchParams\(location\.search\)\.get\('request_id'\)/);
  assert.match(deepLink,/isUuid\(requestId\)/);
  assert.match(deepLink,/item\.dataset\.requestId===requestId/);
  assert.match(deepLink,/button\.click\(\)/);
  assert.match(deepLink,/MutationObserver/);
});

test('budget page loads N5A controller before N5B deep-link enhancer',()=>{
  const n5a=html.indexOf('payroll_budget_gate.js?v=20260820-n5a');
  const n5b=html.indexOf('payroll_budget_deeplink.js?v=20260820-n5b');
  assert.ok(n5a>0&&n5b>n5a);
});

test('N5B is UX-only and introduces no database/storage/edge/bank mutation',()=>{
  const combined=wrapper+'\n'+deepLink;
  assert.doesNotMatch(combined,/\.rpc\(['"](?:set_payroll_budget_context|refresh_payroll_budget_validation|submit_payroll_for_approval|record_payroll_channel_dispersion|reconcile_payroll_channel|close_payroll_as_paid)/);
  assert.doesNotMatch(combined,/storage\.from|functions\.invoke|create_payment_layout|bank.*upload|bbva.*api/i);
  assert.doesNotMatch(combined,/insert\(|update\(|delete\(/i);
});
