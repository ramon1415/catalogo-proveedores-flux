import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const hardening = fs.readFileSync(
  'supabase/migrations/20260819213919_payroll_n3b_approval_write_hardening.sql',
  'utf8',
);
const approvalMigration = fs.readFileSync(
  'supabase/migrations/20260819213907_payroll_n3b_individual_approval.sql',
  'utf8',
);

const solicitudes = fs.readFileSync('solicitudes.js', 'utf8');
const aprobaciones = fs.readFileSync('aprobaciones.js', 'utf8');

test('authenticated direct approval writes are revoked while history reads remain', () => {
  assert.match(
    hardening,
    /revoke insert, update, delete, truncate, references, trigger\s+on table public\.payment_request_approvals\s+from anon, authenticated/i,
  );
  assert.match(hardening, /grant select on table public\.payment_request_approvals to authenticated/i);
  assert.match(hardening, /has_table_privilege\('authenticated',[\s\S]*'INSERT'\)/i);
  assert.match(hardening, /payroll_n3b_direct_approval_write_still_allowed/);
});

test('decision RPC remains the authenticated write boundary', () => {
  assert.match(
    hardening,
    /grant execute on function public\.decide_payment_request\(uuid,uuid,text,text\)[\s\S]*to authenticated, service_role/i,
  );
  assert.match(hardening, /payroll_n3b_decision_rpc_not_executable/);
  assert.match(solicitudes, /rpc\("decide_payment_request"/);
  assert.match(aprobaciones, /rpc\("decide_payment_request"/);
});

test('frontend approval history remains read-only at the table surface', () => {
  assert.match(solicitudes, /from\("payment_request_approvals"\)[\s\S]*\.select\(/);
  assert.match(aprobaciones, /from\("payment_request_approvals"\)[\s\S]*\.select\(/);
  assert.doesNotMatch(solicitudes, /from\("payment_request_approvals"\)[\s\S]{0,200}\.insert\(/);
  assert.doesNotMatch(aprobaciones, /from\("payment_request_approvals"\)[\s\S]{0,200}\.insert\(/);
});

test('PLpgSQL decision mapping parenthesizes CASE after IS DISTINCT FROM', () => {
  assert.match(
    approvalMigration,
    /new\.to_status is distinct from \(case new\.action[\s\S]*when 'changes_requested' then 'changes_requested'[\s\S]*end\) then/,
  );
  assert.doesNotMatch(approvalMigration, /is distinct from case new\.action/);
});
