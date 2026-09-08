import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../../app/node_modules/typescript/lib/typescript.js';
import { receiptAmountMinor } from '../../app/src/features/nomina/receiptAmount.ts';

const source = readFileSync(new URL('../../supabase/functions/payroll-receipt-verify/index.ts',import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const context = { exports:{}, Request, Response, TextDecoder, crypto, Deno:{env:{get:()=> 'test'},serve:()=>{}}, fetch:()=> { throw new Error('unexpected network'); } };
vm.runInNewContext(compiled,context);

test('browser preflight succeeds and anonymous POST retains CORS and rejects authentication', async () => {
  const preflight=await context.exports.handler(new Request('https://test',{method:'OPTIONS'}));
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),'*');
  assert.match(preflight.headers.get('access-control-allow-headers'),/authorization/);
  const denied=await context.exports.handler(new Request('https://test',{method:'POST',body:'{}'}));
  assert.equal(denied.status,401);
  assert.equal(denied.headers.get('access-control-allow-origin'),'*');
  assert.equal((await denied.json()).error,'PAYROLL_AUTH_REQUIRED');
});

test('receipt amounts require an explicit positive amount and never silently round', () => {
  for(const value of ['', '0', '-1', '100.001', '1e2', '1,000.00','Infinity']) assert.equal(receiptAmountMinor(value),null,value);
  assert.equal(receiptAmountMinor('100.01'),10001);
  assert.equal(receiptAmountMinor('100'),10000);
  assert.equal(receiptAmountMinor('100.10'),10010);
  assert.notEqual(receiptAmountMinor('100.01'),receiptAmountMinor('100.02'));
});
