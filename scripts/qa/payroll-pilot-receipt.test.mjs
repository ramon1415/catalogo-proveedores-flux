import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { syntheticPng, syntheticJpeg } from './fixtures/payroll-image-fixture.mjs';
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

test('server verifier accepts image-generated PDF bytes and confirms their actual hash and size', async () => {
  const require=createRequire(import.meta.url);
  const source=readFileSync(new URL('../../app/src/features/nomina/receiptUpload.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const client={exports:{}};
  new Function('exports','window',compiled)(client.exports,{PDFLib:require('../../pdf-lib-1.17.1.min.js')});
  for(const [name,input]of [['image.jpg',syntheticJpeg],['image.png',syntheticPng()]]){
    const prepared=await client.exports.prepareReceiptPdf(new File([input],name));
    const bytes=new Uint8Array(await prepared.file.arrayBuffer());
    const sha256=await context.exports.sha256Hex(bytes);
    const receipt={run_file_id:'00000000-0000-4000-8000-000000000001',payment_request_id:'00000000-0000-4000-8000-000000000002',payroll_channel_id:'00000000-0000-4000-8000-000000000003',storage_bucket:'payroll-private',storage_path:'00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000001.pdf',mime_type:'application/pdf',size_bytes:bytes.length,sha256};
    const confirmed=[];
    context.fetch=async(url,options)=>{
      if(url.endsWith('/auth/v1/user'))return Response.json({id:'test-actor'});
      if(url.endsWith('/rpc/get_payroll_receipt_verification_context'))return Response.json(receipt);
      if(url.includes('/storage/v1/object/'))return new Response(bytes,{headers:{'content-type':'application/pdf'}});
      if(url.endsWith('/rpc/confirm_payroll_channel_receipt_internal')){confirmed.push(JSON.parse(options.body));return Response.json({status:'verified'});}
      throw Error('unexpected request');
    };
    const result=await context.exports.handler(new Request('https://test',{method:'POST',headers:{authorization:'Bearer test-user'},body:JSON.stringify({run_file_id:receipt.run_file_id})}));
    assert.equal(result.status,200);assert.equal((await result.json()).status,'verified');
    assert.equal(confirmed.length,1);assert.equal(confirmed[0].p_sha256,sha256);assert.equal(confirmed[0].p_size_bytes,bytes.length);assert.equal(confirmed[0].p_mime_type,'application/pdf');
  }
});
