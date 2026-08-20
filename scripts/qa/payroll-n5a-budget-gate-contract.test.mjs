import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration=fs.readFileSync('supabase/migrations/20260820164338_payroll_n5a_budget_gate.sql','utf8');
const ui=fs.readFileSync('payroll_budget_gate.js','utf8');
const html=fs.readFileSync('nomina_presupuesto.html','utf8');

test('N5A reuses the existing budget model and creates no provision/business table',()=>{
  assert.match(migration,/public\.budget_lines/);
  assert.match(migration,/public\.budget_versions/);
  assert.match(migration,/public\.budget_availability/);
  assert.match(migration,/verify_budget_availability/);
  assert.doesNotMatch(migration,/create\s+table/i);
  assert.doesNotMatch(migration,/insert\s+into\s+public\.budget_lines/i);
  assert.doesNotMatch(migration,/update\s+public\.budget_lines/i);
  assert.doesNotMatch(migration,/delete\s+from\s+public\.budget_lines/i);
});

test('budget validation serializes concurrent payroll submit on the active budget line',()=>{
  assert.match(migration,/join public\.budget_versions version/);
  assert.match(migration,/version\.active/);
  assert.match(migration,/for update of line/);
  assert.match(migration,/payroll_budget_check_internal/);
});

test('materialized payroll budget context is mutable only by N5A token while every other material field stays frozen',()=>{
  assert.match(migration,/app\.payroll_n5a_budget_context/);
  assert.match(migration,/PAYROLL_BUDGET_CONTEXT_RPC_REQUIRED/);
  assert.match(migration,/PAYROLL_MATERIALIZED_REQUEST_IMMUTABLE/);
  assert.match(migration,/new\.budget_category_id is distinct from old\.budget_category_id/);
  assert.match(migration,/new\.budget_month is distinct from old\.budget_month/);
  for(const token of ['company_id','company_bank_account_id','cost_center_id','amount_requested','currency','requested_by','payroll_period_start','payroll_period_end']) assert.match(migration,new RegExp(token));
});

test('payroll budget snapshot fields are server-owned after materialization',()=>{
  assert.match(migration,/guard_payroll_budget_snapshot_immutable/);
  assert.match(migration,/app\.payroll_n5a_budget_snapshot/);
  assert.match(migration,/PAYROLL_BUDGET_SNAPSHOT_RPC_REQUIRED/);
  for(const field of ['budget_decision','budget_block_reason','budget_available_before','budget_available_after','budget_shortfall','budget_checked_at','budget_result']) assert.match(migration,new RegExp(field));
});

test('Finance context RPC requires draft materialization, requester identity, membership, and active category mapping',()=>{
  assert.match(migration,/set_payroll_budget_context/);
  assert.match(migration,/payroll_has_finance_pii_access/);
  assert.match(migration,/PAYROLL_BUDGET_REQUESTER_REQUIRED/);
  assert.match(migration,/PAYROLL_BUDGET_DRAFT_REQUIRED/);
  assert.match(migration,/PAYROLL_VALID_MATERIALIZATION_REQUIRED/);
  assert.match(migration,/company_cost_center_budget_categories/);
  assert.match(migration,/PAYROLL_BUDGET_CATEGORY_NOT_ALLOWED/);
});

test('submit revalidates budget under lock and direct draft-to-submitted writes cannot bypass the N5A RPC',()=>{
  const checkPos=migration.indexOf("v_budget := public.payroll_budget_check_internal(v_request.id,true)");
  const tokenPos=migration.indexOf("set_config('app.payroll_n5a_submit'");
  const submitWritePos=migration.indexOf("status='submitted'::public.payment_request_status");
  assert.ok(checkPos>0&&tokenPos>checkPos&&submitWritePos>tokenPos);
  assert.match(migration,/PAYROLL_BUDGET_NOT_APPROVABLE/);
  assert.match(migration,/PAYROLL_BUDGET_SUBMIT_RPC_REQUIRED/);
  assert.match(migration,/old\.budget_decision<>'aprobable'/);
});

test('N5A preserves N4B approved-to-paid close gates unchanged in principle',()=>{
  assert.match(migration,/app\.payroll_n4b_close_request/);
  assert.match(migration,/PAYROLL_PAID_CLOSE_RPC_REQUIRED/);
  assert.match(migration,/PAYROLL_PAID_RECONCILIATION_REQUIRED/);
  assert.match(migration,/payroll-channel-receipt-v1/);
});

test('submission summary exposes aggregate budget status without employee PII',()=>{
  assert.match(migration,/get_payroll_submission_summary/);
  assert.match(migration,/budget_ready/);
  assert.doesNotMatch(ui,/employee_name|\brfc\b|\bcurp\b|\bnss\b|\bclabe\b|bank_account/i);
});

test('Finance UI only manages existing budget context and does not calculate payroll/provision rates or execute payments',()=>{
  for(const token of ['get_payroll_budget_queue','get_payroll_budget_context_options','set_payroll_budget_context','refresh_payroll_budget_validation','get_payroll_submission_summary']) assert.match(ui,new RegExp(token));
  assert.match(html,/no calcula sueldos ni inventa porcentajes de provisión/i);
  assert.doesNotMatch(ui,/storage\.from|functions\.invoke|create_payment_layout|bank.*upload|bbva.*api/i);
  assert.doesNotMatch(migration,/\b(?:factor|porcentaje|percentage|tasa_patronal|imss_rate|aguinaldo_rate)\b/i);
});

test('migration is forward-only and contains no payroll/budget business-data backfill',()=>{
  assert.doesNotMatch(migration,/insert\s+into\s+public\.payment_requests/i);
  assert.doesNotMatch(migration,/insert\s+into\s+public\.payroll_channels/i);
  assert.doesNotMatch(migration,/truncate/i);
  assert.match(migration,/grant execute on function public\.set_payroll_budget_context\(uuid,uuid,date\) to authenticated/);
  assert.match(migration,/grant execute on function public\.refresh_payroll_budget_validation\(uuid\) to authenticated/);
  assert.match(migration,/revoke all on function public\.payroll_budget_check_internal\(uuid,boolean\) from public,anon,authenticated/);
});
