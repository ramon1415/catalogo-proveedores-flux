import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  'supabase/migrations/20260819214917_payroll_n3b_post_decision_freeze.sql',
  'utf8',
);

function functionBody(name) {
  const re = new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, 'i');
  return migration.match(re)?.[1] || '';
}

test('server-verified payroll material fields are immutable after materialization', () => {
  assert.match(migration, /create function public\.guard_payroll_materialized_request_immutable/);
  assert.match(migration, /not public\.payroll_request_has_valid_materialization\(old\.id\)/);
  for (const field of [
    'company_id','company_bank_account_id','cost_center_id','budget_category_id',
    'budget_month','amount_requested','currency','exchange_rate','requested_by',
    'payroll_subtype','payroll_period_start','payroll_period_end','payment_method',
    'is_extraordinary_adjustment','concept','description','notes'
  ]) assert.ok(migration.includes(`new.${field} is distinct from old.${field}`), field);
  assert.match(migration, /PAYROLL_MATERIALIZED_REQUEST_IMMUTABLE/);
});

test('submitted_at is one-time and only created on draft to submitted', () => {
  assert.match(migration, /create function public\.guard_payroll_submitted_at_immutable/);
  assert.match(migration, /old\.status::text = 'draft'/);
  assert.match(migration, /new\.status::text = 'submitted'/);
  assert.match(migration, /old\.submitted_at is null/);
  assert.match(migration, /new\.submitted_at is not null/);
  assert.match(migration, /PAYROLL_SUBMITTED_AT_IMMUTABLE/);
});

test('post-decision payroll lifecycle remains frozen until dispersion phase', () => {
  const guard = functionBody('guard_payroll_request_status_transition');
  assert.ok(guard, 'status guard body');
  assert.match(guard, /old\.status::text in \('approved','rejected','changes_requested'\)/);
  assert.match(guard, /PAYROLL_POST_DECISION_TRANSITION_NOT_ENABLED/);
  assert.match(guard, /PAYROLL_STATUS_TRANSITION_NOT_ENABLED/);
  assert.doesNotMatch(guard, /'paid'|'scheduled'|'finance_validation'/i);
});

test('normal payment requests are not affected', () => {
  assert.match(migration, /old\.request_type::text <> 'nomina'/);
  assert.doesNotMatch(migration, /create or replace function public\.decide_payment_request/);
  assert.doesNotMatch(migration, /approval_batch_request_eligibility/);
});
