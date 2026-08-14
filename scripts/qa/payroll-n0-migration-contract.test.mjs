import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = new URL(
  '../../supabase/migrations/20260814170907_payroll_n0_foundation_contract.sql',
  import.meta.url
);
const sql = readFileSync(migrationPath, 'utf8');
const lowerSql = sql.toLowerCase();

function block(start, end) {
  const startIndex = lowerSql.indexOf(start.toLowerCase());
  assert.notEqual(startIndex, -1, `missing block start: ${start}`);
  const endIndex = lowerSql.indexOf(end.toLowerCase(), startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing block end: ${end}`);
  return lowerSql.slice(startIndex, endIndex);
}

test('payment_requests is extended additively for one payroll request per run', () => {
  assert.match(lowerSql, /alter type public\.payment_request_type add value if not exists 'nomina'/);
  assert.match(lowerSql, /alter table public\.payment_requests[\s\S]*add column if not exists payroll_subtype text/);
  assert.match(lowerSql, /add column if not exists payroll_period_start date/);
  assert.match(lowerSql, /add column if not exists payroll_period_end date/);
  assert.match(lowerSql, /provider_id is null[\s\S]*proveedor_id is null[\s\S]*provider_bank_account_id is null/);
  assert.doesNotMatch(lowerSql, /create table (if not exists )?public\.payroll_runs\b/);
  assert.doesNotMatch(lowerSql, /create table (if not exists )?public\.employees\b/);
});

test('channels are relational and exactly one row per request/channel in v1', () => {
  const channels = block('create table public.payroll_channels', 'comment on table public.payroll_channels');
  assert.match(channels, /payment_request_id uuid not null/);
  assert.match(channels, /channel text not null/);
  assert.match(channels, /unique \(payment_request_id, channel\)/);
  assert.match(channels, /channel in \('banco', 'spei', 'vales'\)/);
  assert.match(channels, /amount numeric\(14,2\) not null/);
  assert.doesNotMatch(channels, /channels jsonb/);
});

test('one high-PII person snapshot has exact monetary equality and no PII indexes', () => {
  const lines = block('create table public.payroll_run_lines', 'comment on table public.payroll_run_lines');
  assert.match(lines, /employee_name text not null/);
  assert.match(lines, /rfc text/);
  assert.match(lines, /curp text/);
  assert.match(lines, /nss text/);
  assert.match(lines, /bank_account text/);
  assert.match(lines, /clabe text/);
  assert.match(lines, /net_amount = bank_amount \+ spei_amount \+ vouchers_amount/);

  const indexStatements = lowerSql.match(/create (?:unique )?index[\s\S]*?;/g) || [];
  for (const statement of indexStatements) {
    assert.doesNotMatch(statement, /\b(rfc|curp|nss|employee_name|bank_account|clabe)\b/);
  }
});

test('files use a dedicated private bucket and redacted metadata allowlist', () => {
  const files = block('create table public.payroll_run_files', 'comment on table public.payroll_run_files');
  assert.match(files, /storage_bucket text not null default 'payroll-private'/);
  assert.match(files, /kind in \([\s\S]*'caratula'[\s\S]*'layout_mismo_banco'[\s\S]*'layout_spei'[\s\S]*'layout_toka'[\s\S]*'cfdi_vales'[\s\S]*'comprobante'[\s\S]*'cfdi_nomina'/);
  assert.match(files, /parsing_metadata - array\[/);
  assert.match(lowerSql, /'payroll-private',[\s\S]*false,[\s\S]*26214400/);
  assert.doesNotMatch(lowerSql, /payroll_private[^\n]*delete/);
});

test('PII RLS is Finance-only while Director receives summary only', () => {
  for (const table of ['payroll_channels', 'payroll_run_files', 'payroll_run_lines']) {
    assert.match(lowerSql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(lowerSql, new RegExp(`alter table public\\.${table} force row level security`));
    assert.match(lowerSql, new RegExp(`revoke all on table public\\.${table}[\\s\\s]*?from public, anon, authenticated`));
  }

  const financeGate = block(
    'create or replace function public.payroll_has_finance_pii_access()',
    'comment on function public.payroll_has_finance_pii_access()'
  );
  assert.match(financeGate, /'finance'/);
  assert.doesNotMatch(financeGate, /'sysadmin'|'director'|'direccion'/);

  const summaryPolicy = block(
    'create policy payroll_channels_summary_select',
    'create policy payroll_run_files_finance_select'
  );
  assert.match(summaryPolicy, /payroll_can_read_summary\(payment_request_id\)/);

  const linePolicy = block(
    'create policy payroll_run_lines_finance_select',
    'insert into storage.buckets'
  );
  assert.match(linePolicy, /payroll_has_finance_pii_access\(\)/);
  assert.doesNotMatch(linePolicy, /director|requested_by|approver_id/);
});

test('normal PAGOSBBV, PAGOSINT, and CIE generation excludes payroll twice', () => {
  const candidate = block(
    'create or replace function public.approval_batch_payment_layout_candidates(',
    'comment on function public.approval_batch_payment_layout_candidates('
  );
  assert.match(candidate, /request\.request_type::text = 'nomina'/);
  assert.match(candidate, /where not exists/);
  assert.match(lowerSql, /create trigger payment_layout_lines_reject_payroll/);
  assert.match(lowerSql, /raise exception 'payroll_external_layout_required'/);
});

test('sensitive audit writes changed field names but no row values', () => {
  const audit = block(
    'create or replace function public.payroll_redacted_audit()',
    'revoke all on function public.payroll_redacted_audit()'
  );
  assert.match(audit, /'changed_fields'/);
  assert.match(audit, /'redacted', true/);
  assert.match(audit, /old_values,[\s\S]*new_values/);
  assert.match(audit, /null,[\s\S]*jsonb_build_object/);
  assert.doesNotMatch(audit, /'rfc'|'curp'|'nss'|'clabe'|'employee_name'/);
});

test('request/channel total is exact and deferred for atomic writes', () => {
  assert.match(lowerSql, /create trigger payment_requests_payroll_contract_guard/);
  assert.match(lowerSql, /payroll_source_account_not_active_for_company/);
  assert.match(lowerSql, /v_channel_total <> v_request_amount/);
  assert.match(lowerSql, /raise exception 'payroll_total_mismatch'/);
  assert.match(lowerSql, /create constraint trigger payroll_channels_total_guard[\s\S]*deferrable initially deferred/);
  assert.match(lowerSql, /create constraint trigger payment_requests_payroll_total_guard[\s\S]*deferrable initially deferred/);
});

test('migration remains a review draft and contains no data backfill', () => {
  assert.match(sql, /DRAFT ONLY in N0/);
  assert.match(sql, /MUST NOT be\s+-- applied to DEV/);
  assert.doesNotMatch(lowerSql, /update public\.payment_requests/);
  assert.doesNotMatch(lowerSql, /delete from public\./);
});
