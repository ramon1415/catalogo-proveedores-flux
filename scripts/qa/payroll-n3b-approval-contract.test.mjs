import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260819150000_payroll_n3b_individual_approval.sql', 'utf8');
const n3a = fs.readFileSync('supabase/migrations/20260818110000_payroll_n3a_server_materialization.sql', 'utf8');

test('N3B reuses individual approval and preserves weekly-batch exclusion', () => {
  assert.match(migration, /create function public\.submit_payroll_for_approval/);
  assert.match(migration, /public\.payment_request_approvals/);
  assert.doesNotMatch(migration, /create function public\.approval_batch_request_eligibility/);
  assert.doesNotMatch(migration, /insert into public\.approval_batch_items/);
  assert.doesNotMatch(migration, /insert into public\.approval_batches/);
  assert.match(n3a, /payment_requests_payroll_draft_no_submission_check/);
});

test('Finance can submit only its own valid materialized payroll draft', () => {
  assert.match(migration, /not public\.payroll_has_finance_pii_access\(\)/);
  assert.match(migration, /v_request\.requested_by is distinct from v_actor/);
  assert.match(migration, /payroll_request_has_valid_materialization\(v_request\.id\)/);
  assert.match(migration, /v_request\.status::text <> 'draft'/);
  assert.match(migration, /status = 'submitted'::public\.payment_request_status/);
  assert.match(migration, /submitted_at = now\(\)/);
});

test('approver selection is a one-time payroll draft to submitted exception', () => {
  assert.match(migration, /create function public\.validate_payroll_submit_transition/);
  assert.match(migration, /old\.status::text <> 'draft'/);
  assert.match(migration, /new\.status::text <> 'submitted'/);
  assert.match(migration, /old\.approver_id is not null/);
  assert.match(migration, /PAYROLL_APPROVER_ALREADY_SELECTED/);
  assert.match(migration, /drop trigger validate_payment_request_approver_scope_update/);
  assert.match(migration, /execute function public\.validate_payment_request_approver_scope\(\)/);
  assert.match(migration, /validate_payroll_submit_transition[\s\S]*old\.status::text = 'draft'[\s\S]*new\.status::text = 'submitted'/);
});

test('configured pool and approval-rules routing reuse the existing contracts', () => {
  for (const contract of [
    'payment_request_has_active_approver_pool',
    'approver_assignments',
    'is_payment_request_approver_for_company',
    'payment_request_rule_allows',
  ]) assert.ok(migration.includes(contract), contract);
  assert.match(migration, /v_source := 'assigned'/);
  assert.match(migration, /v_source := 'approval_rules'/);
  assert.match(migration, /approver_must_come_from_configured_pool/);
});

test('server-verified payroll evidence is immutable at submission', () => {
  assert.match(migration, /PAYROLL_MATERIALIZATION_IMMUTABLE_AT_SUBMIT/);
  for (const field of [
    'company_id','company_bank_account_id','cost_center_id','budget_category_id',
    'budget_month','amount_requested','currency','payroll_subtype',
    'payroll_period_start','payroll_period_end','requested_by'
  ]) assert.ok(migration.includes(`new.${field} is distinct from old.${field}`), field);
  assert.doesNotMatch(migration, /update public\.payroll_(?:channels|run_files|run_lines)/i);
});

test('direct payroll status updates cannot bypass submission or decision records', () => {
  assert.match(migration, /create function public\.guard_payroll_request_status_transition/);
  assert.match(migration, /old\.status::text = 'draft'[\s\S]*new\.status::text <> 'submitted'/);
  assert.match(migration, /old\.status::text = 'submitted'/);
  assert.match(migration, /new\.status::text not in \('approved','rejected','changes_requested'\)/);
  assert.match(migration, /from public\.payment_request_approvals a/);
  assert.match(migration, /a\.created_at >= transaction_timestamp\(\)/);
  assert.match(migration, /PAYROLL_DECISION_RECORD_REQUIRED/);
});

test('payroll approval inserts require submitted materialized request and selected approver', () => {
  assert.match(migration, /create function public\.guard_payroll_approval_insert/);
  assert.match(migration, /v_request\.status::text <> 'submitted'/);
  assert.match(migration, /new\.actor_profile_id is distinct from v_request\.approver_id/);
  assert.match(migration, /new\.action not in \('approved','rejected','changes_requested'\)/);
  assert.match(migration, /PAYROLL_NOT_SUBMITTED_FOR_APPROVAL/);
  assert.match(migration, /before insert on public\.payment_request_approvals/);
});

test('submission emits exactly the existing logical creation notification key', () => {
  assert.match(migration, /create function public\.enqueue_payroll_submission_notification/);
  assert.match(migration, /'payment_request\.created'/);
  assert.match(migration, /'payment_request\.created:' \|\| new\.id::text \|\| ':approver'/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/);
  assert.match(migration, /old\.status::text = 'draft'[\s\S]*new\.status::text = 'submitted'/);
  assert.match(migration, /status', 'already_submitted'/);
});

test('decision notification engine and decide_payment_request are not forked', () => {
  assert.doesNotMatch(migration, /create or replace function public\.decide_payment_request/);
  assert.doesNotMatch(migration, /create or replace function public\.enqueue_payment_request_decision_notification/);
  assert.doesNotMatch(migration, /drop trigger payment_request_decision_notification_event/);
});

test('payroll remains isolated from Flux bank-layout generation and dispersion', () => {
  assert.doesNotMatch(migration, /insert into public\.payment_layout/i);
  assert.doesNotMatch(migration, /create_payment_layout|PAGOSBBV|PAGOSINT|CIE/i);
  assert.doesNotMatch(migration, /dispers|net cash|toka/i);
});

test('N3B is forward-only and does not rewrite N3A materialization', () => {
  assert.match(migration, /^-- N3B:/);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\.payroll/i);
  assert.doesNotMatch(migration, /create or replace function public\.materialize_payroll_capture_internal/);
  assert.match(n3a, /PAYROLL_COVER_SHEET_FORMAT_UNVERIFIED/);
});
