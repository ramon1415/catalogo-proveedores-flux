import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('payroll_company_scope_fix.js','utf8');

test('waits for payroll source account before installing bridge', () => {
  assert.match(src,/await waitForElement\('payrollSourceAccount'\)/);
  assert.match(src,/MutationObserver/);
  assert.match(src,/payrollCompanyScopeBridge/);
});

test('keeps canonical companyId authoritative', () => {
  assert.match(src,/document\.getElementById\('companyId'\)/);
  assert.match(src,/source\.dispatchEvent\(new Event\('change'/);
});
