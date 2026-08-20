// N4B payroll channel receipt verification.
// Server downloads the reserved PDF, verifies bytes/hash/MIME, then confirms evidence.

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
type Input = { run_file_id?: string };
type Context = {
  run_file_id:string;
  payment_request_id:string;
  payroll_channel_id:string;
  storage_bucket:string;
  storage_path:string;
  mime_type:string;
  size_bytes:number;
  sha256:string;
};

function response(status:number, body:Record<string,unknown>):Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
function requiredEnv(name:string):string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_required_secret:${name}`);
  return value.replace(/\/$/, '');
}
function bearer(req:Request):string {
  const value = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(value)) throw new Error('PAYROLL_AUTH_REQUIRED');
  return value.replace(/^Bearer\s+/i, '');
}
async function apiJson(url:string, init:RequestInit, code:string):Promise<any> {
  const result = await fetch(url, init);
  if (!result.ok) throw new Error(code);
  return await result.json();
}
async function rpc(base:string, key:string, token:string, name:string, body:unknown):Promise<any> {
  return await apiJson(`${base}/rest/v1/rpc/${name}`, {
    method:'POST',
    headers:{ apikey:key, Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body:JSON.stringify(body),
  }, `PAYROLL_RPC_${name.toUpperCase()}_FAILED`);
}
async function sha256Hex(bytes:Uint8Array):Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2,'0')).join('');
}
function isPdf(bytes:Uint8Array):boolean {
  if (bytes.byteLength < 100) return false;
  const head = new TextDecoder('ascii').decode(bytes.slice(0,5));
  if (head !== '%PDF-') return false;
  const tailStart = Math.max(0, bytes.byteLength - 4096);
  const tail = new TextDecoder('latin1').decode(bytes.slice(tailStart));
  return tail.includes('%%EOF');
}
function errorStatus(code:string):number {
  if (code === 'PAYROLL_AUTH_REQUIRED') return 401;
  if (code.endsWith('_REQUIRED') || code.includes('FINANCE')) return 403;
  return 409;
}

async function handler(req:Request):Promise<Response> {
  if (req.method !== 'POST') return response(405,{error:'METHOD_NOT_ALLOWED'});
  try {
    const base = requiredEnv('SUPABASE_URL');
    const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    const token = bearer(req);
    const input = await req.json() as Input;
    if (!input.run_file_id || !/^[0-9a-f-]{36}$/i.test(input.run_file_id)) {
      return response(400,{error:'PAYROLL_RECEIPT_INPUT_INVALID'});
    }

    await apiJson(`${base}/auth/v1/user`, {
      headers:{ apikey:serviceKey, Authorization:`Bearer ${token}` },
    }, 'PAYROLL_AUTH_REQUIRED');

    const context = await rpc(base,serviceKey,token,'get_payroll_receipt_verification_context',{
      p_run_file_id:input.run_file_id,
    }) as Context;

    if (context.storage_bucket !== 'payroll-private' || context.mime_type !== 'application/pdf') {
      throw new Error('PAYROLL_RECEIPT_SCOPE_MISMATCH');
    }
    if (!context.storage_path.startsWith(`${context.payment_request_id}/`)) {
      throw new Error('PAYROLL_RECEIPT_SCOPE_MISMATCH');
    }

    const encodedPath = context.storage_path.split('/').map(encodeURIComponent).join('/');
    const downloaded = await fetch(`${base}/storage/v1/object/authenticated/payroll-private/${encodedPath}`, {
      headers:{ apikey:serviceKey, Authorization:`Bearer ${serviceKey}` },
    });
    if (!downloaded.ok) throw new Error('PAYROLL_RECEIPT_STORAGE_OBJECT_MISSING');
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    if (bytes.byteLength !== Number(context.size_bytes)) throw new Error('PAYROLL_RECEIPT_SIZE_MISMATCH');
    const mime = (downloaded.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (mime && mime !== 'application/pdf') throw new Error('PAYROLL_RECEIPT_MIME_MISMATCH');
    if (!isPdf(bytes)) throw new Error('PAYROLL_RECEIPT_PDF_INVALID');
    const digest = await sha256Hex(bytes);
    if (digest !== context.sha256) throw new Error('PAYROLL_RECEIPT_HASH_MISMATCH');

    const result = await rpc(base,serviceKey,serviceKey,'confirm_payroll_channel_receipt_internal',{
      p_run_file_id:context.run_file_id,
      p_sha256:digest,
      p_size_bytes:bytes.byteLength,
      p_mime_type:'application/pdf',
    });
    return response(200,result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'PAYROLL_RECEIPT_VERIFICATION_FAILED';
    const safe = /^PAYROLL_[A-Z0-9_]+$/.test(code) ? code : 'PAYROLL_RECEIPT_VERIFICATION_FAILED';
    return response(errorStatus(safe),{error:safe});
  }
}

Deno.serve(handler);
export { handler, isPdf, sha256Hex };
