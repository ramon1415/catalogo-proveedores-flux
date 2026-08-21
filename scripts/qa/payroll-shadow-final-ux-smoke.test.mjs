import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const polish=fs.readFileSync('payroll_shadow_ux_polish.js','utf8');

test('final payroll shadow UX remains visual and read-only',()=>{
  assert.doesNotThrow(()=>new Function(polish));
  assert.match(polish,/Materializada · solo lectura/);
  assert.match(polish,/Empresa heredada de la corrida/);
  assert.match(polish,/TOKA presenta diferencia de/);
  assert.match(polish,/get_payroll_capture_sessions/);
  assert.doesNotMatch(polish,/set_payroll_budget_context|submit_payroll_for_approval|acknowledge_payroll_toka_funding_variance|functions\.invoke/);
});
