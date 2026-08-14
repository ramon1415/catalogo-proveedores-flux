import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const originalPath = new URL(
  '../../supabase/migrations/20260814170907_payroll_n0_foundation_contract.sql',
  import.meta.url
);
const forwardPath = new URL(
  '../../supabase/migrations/20260814183429_fix_payroll_request_total_trigger.sql',
  import.meta.url
);

const original = readFileSync(originalPath);
const sql = readFileSync(forwardPath, 'utf8');
const lowerSql = sql.toLowerCase();

test('the applied N0 migration remains byte-for-byte immutable', () => {
  const digest = createHash('sha256').update(original).digest('hex').toUpperCase();
  assert.equal(
    digest,
    '3A44AE1DA3438379B97B8D9F1CCCCA21DAEFBCF8E46D149A557EBD7526F85038'
  );
});

test('the forward migration replaces only the target trigger function', () => {
  const replacements = lowerSql.match(/create\s+or\s+replace\s+function/g) || [];
  assert.equal(replacements.length, 1);
  assert.match(
    lowerSql,
    /create or replace function public\.payroll_enforce_request_total\(\)/
  );
  assert.doesNotMatch(lowerSql, /create\s+(?:constraint\s+)?trigger/);
  assert.doesNotMatch(lowerSql, /drop\s+trigger|drop\s+function/);
  assert.doesNotMatch(lowerSql, /create\s+table|alter\s+table|drop\s+table/);
  assert.doesNotMatch(lowerSql, /\b(insert|update|delete)\s+(?:into|from\s+)?public\./);
});

test('the corrected function preserves its privileged trigger contract', () => {
  assert.match(lowerSql, /returns trigger/);
  assert.match(lowerSql, /language plpgsql/);
  assert.match(lowerSql, /security definer/);
  assert.match(lowerSql, /set search_path = public, pg_temp/);
  assert.match(lowerSql, /begin;[\s\S]*create or replace function[\s\S]*commit;/);
});

test('relation and operation routing never references the other rowtype directly', () => {
  assert.match(
    lowerSql,
    /tg_relid = 'public\.payment_requests'::regclass[\s\S]*tg_op not in \('insert', 'update'\)/
  );
  assert.match(lowerSql, /to_jsonb\(new\) ->> 'id'/);
  assert.match(
    lowerSql,
    /tg_relid = 'public\.payroll_channels'::regclass[\s\S]*tg_op = 'delete'[\s\S]*to_jsonb\(old\) ->> 'payment_request_id'/
  );
  assert.match(
    lowerSql,
    /tg_op in \('insert', 'update'\)[\s\S]*to_jsonb\(new\) ->> 'payment_request_id'/
  );
  assert.doesNotMatch(lowerSql, /\bnew\.payment_request_id\b|\bold\.payment_request_id\b/);
  assert.match(lowerSql, /payroll_total_guard_unexpected_trigger_source/);
  assert.match(lowerSql, /payroll_total_guard_unexpected_payment_request_op/);
  assert.match(lowerSql, /payroll_total_guard_unexpected_payroll_channel_op/);
});

test('exact total and non-payroll isolation errors are preserved', () => {
  assert.match(lowerSql, /v_channel_total <> v_request_amount/);
  assert.match(lowerSql, /raise exception 'payroll_total_mismatch'/);
  assert.match(lowerSql, /raise exception 'payroll_channels_require_nomina_request'/);
  assert.doesNotMatch(lowerSql, /epsilon|round\s*\(|double precision|\breal\b/);
});

test('the recovery contains no PROD reference or physical payroll format guess', () => {
  assert.doesNotMatch(lowerSql, /ucantptjhwttexzmslvm|\bprod\b/);
  assert.doesNotMatch(lowerSql, /xlsx|spei.*offset|toka.*xml|fixed[-_ ]width/);
});
