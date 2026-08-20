import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260820154000_payroll_n4a_manual_dispersion.sql','utf8');
const ui = fs.readFileSync('payroll_dispersion.js','utf8');
const html = fs.readFileSync('nomina_dispersion.html','utf8');

test('N4A reuses payroll_channels and exposes aggregate summary/queue without new business tables', () => {
  assert.match(migration,/get_payroll_dispersion_summary/);
  assert.match(migration,/get_payroll_dispersion_queue/);
  assert.match(migration,/from public\.payroll_channels/);
  assert.doesNotMatch(migration,/create\s+table/i);
  assert.match(migration,/payroll_request_has_valid_materialization/);
  assert.match(migration,/payroll_can_read_summary/);
});

test('manual dispersion is Finance-only, company-scoped and requires an approved materialized payroll request', () => {
  assert.match(migration,/payroll_has_finance_pii_access\(\)/);
  assert.match(migration,/has_active_company_membership/);
  assert.match(migration,/status::text<>'approved'/);
  assert.match(migration,/PAYROLL_DISPERSION_REQUIRES_APPROVED_REQUEST/);
  assert.match(migration,/PAYROLL_DISPERSION_MATERIALIZATION_REQUIRED/);
  assert.match(migration,/PAYROLL_DISPERSION_COMPANY_MEMBERSHIP_REQUIRED/);
});

test('channel state machine is narrow, idempotent and irreversible after success', () => {
  assert.match(migration,/v_action not in \('dispersed','failed'\)/);
  assert.match(migration,/already_dispersed/);
  assert.match(migration,/already_failed/);
  assert.match(migration,/PAYROLL_DISPERSION_ALREADY_FINAL/);
  assert.match(migration,/PAYROLL_DISPERSION_FAILURE_NOTE_REQUIRED/);
  assert.match(migration,/PAYROLL_DISPERSION_FAILURE_ALREADY_RECORDED/);
  assert.match(migration,/reconciliation_status<>'pending'/);
  assert.match(migration,/set dispersion_status='dispersed'/);
  assert.match(migration,/set dispersion_status='failed'/);
});

test('N4A does not modify payroll money, request lifecycle, reconciliation, receipts or bank execution', () => {
  assert.doesNotMatch(migration,/update public\.payment_requests/i);
  assert.doesNotMatch(migration,/set\s+(?:amount|currency|benefit_amount|fee_amount|tax_amount|expected_funding_amount)\s*=/i);
  assert.doesNotMatch(migration,/insert into public\.payroll_run_files/i);
  assert.doesNotMatch(migration,/reconciliation_status\s*=/i);
  assert.doesNotMatch(migration,/payment_layout|bank_upload|upload.*bbva|mark.*paid/i);
});

test('Finance UI uses only N4A RPCs and explicitly states that Flux does not execute payments', () => {
  assert.match(ui,/get_payroll_dispersion_queue/);
  assert.match(ui,/get_payroll_dispersion_summary/);
  assert.match(ui,/record_payroll_channel_dispersion/);
  assert.doesNotMatch(ui,/functions\.invoke|storage\.from|create_payment_layout|decide_payment_request|submit_payroll_for_approval|mark.*paid/i);
  assert.match(html,/no se conecta al banco y no ejecuta pagos/i);
  assert.match(html,/payroll_dispersion\.js/);
});

test('N4A UI exposes only aggregate request/channel data and no employee PII or failure-note content', () => {
  assert.doesNotMatch(ui,/employee_name|\brfc\b|\bcurp\b|\bnss\b|\bclabe\b|bank_account/i);
  assert.match(ui,/amount_requested/);
  assert.match(ui,/dispersion_status/);
  assert.match(ui,/channel_count/);
  assert.doesNotMatch(ui,/dispersion_note/);
});

test('migration is forward-only and contains no business-data backfill', () => {
  assert.doesNotMatch(migration,/insert into public\.payment_requests/i);
  assert.doesNotMatch(migration,/insert into public\.payroll_channels/i);
  assert.doesNotMatch(migration,/delete from public\./i);
  assert.doesNotMatch(migration,/truncate/i);
  assert.match(migration,/revoke all on function public\.record_payroll_channel_dispersion/);
  assert.match(migration,/grant execute on function public\.record_payroll_channel_dispersion\(uuid,uuid,text,text\) to authenticated/);
});
