import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../supabase/functions/payroll-materialize/index.ts', import.meta.url), 'utf8');

test('payroll-materialize explicitly accepts browser CORS preflight', () => {
  assert.match(source, /req\.method\s*===\s*["']OPTIONS["']/);
  assert.match(source, /status\s*:\s*204/);
  assert.match(source, /Access-Control-Allow-Origin/);
  assert.match(source, /Access-Control-Allow-Headers/);
  assert.match(source, /authorization, x-client-info, apikey, content-type/);
  assert.match(source, /Access-Control-Allow-Methods/);
  assert.match(source, /POST, OPTIONS/);
});

test('all JSON responses inherit CORS headers', () => {
  assert.match(source, /const JSON_HEADERS\s*=\s*\{\s*\.\.\.CORS_HEADERS/);
  assert.match(source, /new Response\(JSON\.stringify\(body\),\{status,headers:JSON_HEADERS\}\)/);
});

test('business execution remains POST-only and JWT bearer-gated', () => {
  assert.match(source, /req\.method\s*!==\s*["']POST["']/);
  assert.match(source, /PAYROLL_AUTH_REQUIRED/);
  assert.match(source, /Authorization:`Bearer \$\{token\}`/);
});

test('TOKA CFDI accepts only the two standard XML MIME aliases while other files remain strict', () => {
  assert.match(source, /function mimeMatches\(kind:string,observed:string,declared:string\)/);
  assert.match(source, /kind===\"cfdi_vales\"/);
  assert.match(source, /\[\"text\/xml\",\"application\/xml\"\]/);
  assert.match(source, /actual===expected/);
  assert.match(source, /if\(!mimeMatches\(file\.kind,mime,file\.mime_type\)\) throw new Error\(\"PAYROLL_FILE_MIME_MISMATCH\"\)/);
  assert.doesNotMatch(source, /application\/octet-stream/);
});
