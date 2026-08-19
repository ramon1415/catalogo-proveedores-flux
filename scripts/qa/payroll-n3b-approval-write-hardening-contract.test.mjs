import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  'supabase/migrations/20260819150500_payroll_n3b_approval_write_hardening.sql',
  'utf8',
);

const solicitudes = fs.readFileSync('solicitudes.js', 'utf8');
const aprobaciones = fs.readFileSync('aprobaciones.js', 'utf8');

test('authenticated direct approval writes are revoked while history reads remain', () => {
  assert.match(
    migration,
    /revoke insert, update, delete, truncate, references, trigger\s+on table public\.payment_request_approvals\s+from anon, authenticated/i,
  );
  assert.match(migration, /grant select on table public\.payment_request_approvals to authenticated/i);
  assert.match(migration, /has_table_privilege\('authenticated',[\s\S]*'INSERT'\)/i);
  assert.match(migration, /payroll_n3b_direct_approval_write_still_allowed/);
});

test('decision RPC remains the authenticated write boundary', () => {
  assert.match(
    migration,
    /grant execute on function public\.decide_payment_request\(uuid,uuid,text,text\)[\s\S]*to authenticated, service_role/i,
  );
  assert.match(migration, /payroll_n3b_decision_rpc_not_executable/);
  assert.match(solicitudes, /rpc\("decide_payment_request"/);
  assert.match(aprobaciones, /rpc\("decide_payment_request"/);
});

test('frontend approval history remains read-only at the table surface', () => {
  assert.match(solicitudes, /from\("payment_request_approvals"\)[\s\S]*\.select\(/);
  assert.match(aprobaciones, /from\("payment_request_approvals"\)[\s\S]*\.select\(/);
  assert.doesNotMatch(solicitudes, /from\("payment_request_approvals"\)[\s\S]{0,200}\.insert\(/);
  assert.doesNotMatch(aprobaciones, /from\("payment_request_approvals"\)[\s\S]{0,200}\.insert\(/);
});
