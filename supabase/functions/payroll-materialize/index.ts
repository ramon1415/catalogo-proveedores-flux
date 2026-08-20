// N3F server trust boundary: all payroll physical formats are parsed from
// server-downloaded bytes. Browser summaries remain diagnostic only.
import "../../../payroll_parser.js";
import "../../../payroll_real_formats.js";

type ParserIssue = { code: string; source?: string; row?: number; field?: string };
type SpeiRecord = { amountMinor: number; sourceAccount: string; clabe: string; employeeName: string; sourceRow: number };
type PayrollParser = {
  PARSER_VERSION: string;
  PAYROLL_SPEI_CONTRACT_VERSION: string;
  parsePayrollSpeiTxt(input: Uint8Array): { parserVersion: string; contractVersion: string; records: SpeiRecord[]; issues: ParserIssue[] };
};
type RealFormats = {
  CONTRACT_VERSION: string;
  COVER_CONTRACT_VERSION: string;
  SAME_BANK_CONTRACT_VERSION: string;
  TOKA_CFDI_CONTRACT_VERSION: string;
  parseCoverXlsx(input: Uint8Array): Promise<any>;
  parseSameBank108(input: Uint8Array): any;
  parseTokaCfdi(input: Uint8Array): any;
  reconcilePackage(input: any): any;
  normalizeAccount(value: unknown): string;
  normalizeName(value: unknown): string;
};
declare global { var FluxPayrollParser: PayrollParser; var FluxPayrollRealFormats: RealFormats; }

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/;
type MaterializeInput = { capture_session_id?: string; expected_version?: number; idempotency_key?: string };
type CaptureFile = { id:string; kind:string; channel:string|null; storage_bucket:string; storage_path:string; mime_type:string; size_bytes:number; sha256:string; capability_code:string; parser_version:string|null; parser_contract:string|null; record_count:number|null; total_amount_minor:number|null; object_size:number|null; object_mime:string|null };
type Context = { id:string; version:number; reserved_payment_request_id:string; company_id:string; capture_state:string; validation_status:string; expires_at:string; cost_center_id:string|null; expected_channels:string[]; source_accounts:Array<string|null>|null; files:CaptureFile[] };
type Verified = { meta:any; parsed:any };

function response(status:number,body:Record<string,unknown>):Response { return new Response(JSON.stringify(body),{status,headers:JSON_HEADERS}); }
function requiredEnv(name:string):string { const value=Deno.env.get(name)?.trim(); if(!value) throw new Error(`missing_required_secret:${name}`); return value.replace(/\/$/,""); }
function bearer(req:Request):string { const value=req.headers.get("authorization")||""; if(!/^Bearer\s+\S+$/i.test(value)) throw new Error("PAYROLL_AUTH_REQUIRED"); return value.replace(/^Bearer\s+/i,""); }
async function apiJson(url:string,init:RequestInit,code:string):Promise<any>{ const result=await fetch(url,init); if(!result.ok) throw new Error(code); return await result.json(); }
async function rpc(base:string,key:string,token:string,name:string,body:unknown):Promise<any>{ return await apiJson(`${base}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)},`PAYROLL_RPC_${name.toUpperCase()}_FAILED`); }
async function requireFinanceCaptureAccess(base:string,serviceKey:string,token:string,captureSessionId:string):Promise<any[]>{ try { const visible=await rpc(base,serviceKey,token,"get_payroll_capture_sessions",{p_session_id:captureSessionId}); if(Array.isArray(visible)&&visible.length===1) return visible; } catch {} throw new Error("PAYROLL_FINANCE_REQUIRED"); }
function errorStatus(code:string):number { if(code==="PAYROLL_AUTH_REQUIRED") return 401; if(code.endsWith("REQUIRED")) return 403; return 409; }
async function sha256Hex(bytes:Uint8Array):Promise<string>{ const digest=await crypto.subtle.digest("SHA-256",bytes.slice().buffer as ArrayBuffer); return Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,"0")).join(""); }
async function hashText(value:string):Promise<string>{ return sha256Hex(new TextEncoder().encode(value)); }
function normalizeAccounts(values:Array<string|null>|null):Set<string>{ return new Set((values||[]).map(v=>String(v||"").replace(/\D/g,"")).filter(Boolean).map(v=>v.padStart(18,"0"))); }
function safeMeta(file:CaptureFile,digest:string,parserVersion:string,parserContract:string,recordCount:number,totalAmountMinor:number){ return {capture_file_id:file.id,kind:file.kind,authority:"server_verified",sha256:digest,parser_version:parserVersion,parser_contract:parserContract,record_count:recordCount,total_amount_minor:totalAmountMinor,browser_server_match:file.record_count===recordCount&&file.total_amount_minor===totalAmountMinor}; }

async function verifyFile(base:string,serviceKey:string,context:Context,file:CaptureFile):Promise<Verified>{
  if(file.storage_bucket!=="payroll-private"||!PATH_RE.test(file.storage_path)) throw new Error("PAYROLL_FILE_PATH_MISMATCH");
  const parts=file.storage_path.split("/"); if(parts[0]!==context.company_id||parts[1]!==context.reserved_payment_request_id) throw new Error("PAYROLL_FILE_PATH_MISMATCH");
  if(file.object_size===null) throw new Error("PAYROLL_STORAGE_OBJECT_MISSING");
  if(Number(file.object_size)!==Number(file.size_bytes)) throw new Error("PAYROLL_FILE_SIZE_MISMATCH");
  const path=file.storage_path.split("/").map(encodeURIComponent).join("/");
  const downloaded=await fetch(`${base}/storage/v1/object/authenticated/payroll-private/${path}`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}});
  if(!downloaded.ok) throw new Error("PAYROLL_STORAGE_OBJECT_MISSING");
  const bytes=new Uint8Array(await downloaded.arrayBuffer()); if(bytes.byteLength!==Number(file.size_bytes)) throw new Error("PAYROLL_FILE_SIZE_MISMATCH");
  const mime=(downloaded.headers.get("content-type")||"").split(";")[0].toLowerCase(); if(mime&&mime!==file.mime_type.toLowerCase()) throw new Error("PAYROLL_FILE_MIME_MISMATCH");
  const digest=await sha256Hex(bytes); if(digest!==file.sha256) throw new Error("PAYROLL_FILE_HASH_MISMATCH");

  if(file.kind==="caratula"){
    const parsed=await globalThis.FluxPayrollRealFormats.parseCoverXlsx(bytes); if(!parsed.valid) throw new Error("PAYROLL_COVER_SHEET_SERVER_PARSE_FAILED");
    return {meta:safeMeta(file,digest,globalThis.FluxPayrollRealFormats.CONTRACT_VERSION,parsed.contractVersion,parsed.people.length,parsed.totals.netAmountMinor),parsed};
  }
  if(file.kind==="layout_mismo_banco"){
    const parsed=globalThis.FluxPayrollRealFormats.parseSameBank108(bytes); if(!parsed.valid) throw new Error("PAYROLL_SAME_BANK_SERVER_PARSE_FAILED");
    return {meta:safeMeta(file,digest,globalThis.FluxPayrollRealFormats.CONTRACT_VERSION,parsed.contractVersion,parsed.recordCount,parsed.totalAmountMinor),parsed};
  }
  if(file.kind==="cfdi_vales"){
    const parsed=globalThis.FluxPayrollRealFormats.parseTokaCfdi(bytes); if(!parsed.valid) throw new Error("PAYROLL_TOKA_CFDI_SERVER_PARSE_FAILED");
    return {meta:safeMeta(file,digest,globalThis.FluxPayrollRealFormats.CONTRACT_VERSION,parsed.contractVersion,parsed.recordCount,parsed.benefitAmountMinor),parsed};
  }
  if(file.kind==="layout_spei"||file.kind==="layout_toka"){
    const parsed=globalThis.FluxPayrollParser.parsePayrollSpeiTxt(bytes); if(parsed.issues.length||!parsed.records.length) throw new Error(file.kind==="layout_toka"?"PAYROLL_TOKA_FUNDING_SERVER_PARSE_FAILED":"PAYROLL_SPEI_SERVER_PARSE_FAILED");
    const allowed=normalizeAccounts(context.source_accounts); if(!allowed.size||parsed.records.some(r=>!allowed.has(r.sourceAccount))) throw new Error("PAYROLL_SOURCE_ACCOUNT_MISMATCH");
    const total=parsed.records.reduce((sum,r)=>{ if(!Number.isSafeInteger(r.amountMinor)||r.amountMinor<=0||!Number.isSafeInteger(sum+r.amountMinor)) throw new Error("PAYROLL_CHANNEL_TOTAL_INVALID"); return sum+r.amountMinor; },0);
    return {meta:safeMeta(file,digest,parsed.parserVersion,parsed.contractVersion,parsed.records.length,total),parsed};
  }
  throw new Error("PAYROLL_FILE_KIND_UNSUPPORTED");
}

function pickSourceAccount(context:Context,verified:Map<string,Verified>):string{
  const candidates=normalizeAccounts(context.source_accounts);
  const records=[...(verified.get("layout_spei")?.parsed?.records||[]),...(verified.get("layout_toka")?.parsed?.records||[])];
  const source=records[0]?.sourceAccount||""; if(!source||!candidates.has(source)||records.some((r:any)=>r.sourceAccount!==source)) throw new Error("PAYROLL_SOURCE_ACCOUNT_MISMATCH"); return source;
}

async function handler(req:Request):Promise<Response>{
  if(req.method!=="POST") return response(405,{error:"METHOD_NOT_ALLOWED"});
  try{
    const base=requiredEnv("SUPABASE_URL"),serviceKey=requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),token=bearer(req); const input=await req.json() as MaterializeInput;
    if(!input.capture_session_id||!Number.isInteger(input.expected_version)||!input.idempotency_key?.trim()) return response(400,{error:"PAYROLL_MATERIALIZATION_INPUT_INVALID"});
    const user=await apiJson(`${base}/auth/v1/user`,{headers:{apikey:serviceKey,Authorization:`Bearer ${token}`}},"PAYROLL_AUTH_REQUIRED");
    await requireFinanceCaptureAccess(base,serviceKey,token,input.capture_session_id);
    const profiles=await apiJson(`${base}/rest/v1/profiles?select=id&auth_user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`}},"PAYROLL_ACTOR_PROFILE_REQUIRED");
    if(!Array.isArray(profiles)||profiles.length!==1) throw new Error("PAYROLL_ACTOR_PROFILE_REQUIRED");
    const context=await rpc(base,serviceKey,serviceKey,"get_payroll_materialization_context_internal",{p_capture_session_id:input.capture_session_id,p_expected_version:input.expected_version}) as Context;
    if(context.capture_state==="materialized") throw new Error("PAYROLL_CAPTURE_ALREADY_MATERIALIZED");
    if(new Date(context.expires_at).getTime()<=Date.now()) throw new Error("PAYROLL_CAPTURE_EXPIRED");
    if(!context.cost_center_id) throw new Error("PAYROLL_CAPTURE_ACCOUNTING_CONTEXT_REQUIRED");
    if(!context.files.length) throw new Error("PAYROLL_REQUIRED_FILES_MISSING");

    const verified=new Map<string,Verified>();
    for(const file of context.files) verified.set(file.kind,await verifyFile(base,serviceKey,context,file));
    const expected=new Set(context.expected_channels||[]);
    for(const kind of ["caratula",...(expected.has("banco")?["layout_mismo_banco"]:[]),...(expected.has("spei")?["layout_spei"]:[]),...(expected.has("vales")?["layout_toka","cfdi_vales"]:[])]) if(!verified.has(kind)) throw new Error("PAYROLL_REQUIRED_FILES_MISSING");

    const packageResult=globalThis.FluxPayrollRealFormats.reconcilePackage({
      cover:verified.get("caratula")?.parsed,
      sameBank:verified.get("layout_mismo_banco")?.parsed,
      spei:verified.get("layout_spei")?.parsed,
      tokaCfdi:verified.get("cfdi_vales")?.parsed,
      tokaFunding:verified.get("layout_toka")?.parsed,
      sourceAccount:pickSourceAccount(context,verified),
      expectedChannels:context.expected_channels,
    });
    if(!packageResult.valid||packageResult.issues.length) throw new Error("PAYROLL_SERVER_PACKAGE_VALIDATION_FAILED");
    const coverFileId=verified.get("caratula")!.meta.capture_file_id;
    const lines=packageResult.people.map((p:any)=>({source_capture_file_id:coverFileId,source_sheet:verified.get("caratula")!.parsed.sheetName,source_row_number:p.sourceRow,extraction_version:verified.get("caratula")!.parsed.contractVersion,employee_name:p.employeeName,rfc:p.rfc,curp:p.curp,nss:p.nss,bank_name:p.bankName,bank_account:p.account,clabe:p.clabe,net_amount_minor:p.netAmountMinor,bank_amount_minor:p.bankAmountMinor,spei_amount_minor:p.speiAmountMinor,vouchers_amount_minor:p.vouchersAmountMinor}));
    const channels=packageResult.channels.map((c:any)=>({channel:c.channel,amount_minor:c.amountMinor,benefit_amount_minor:c.benefitAmountMinor??null,fee_amount_minor:c.feeAmountMinor??null,tax_amount_minor:c.taxAmountMinor??null,expected_funding_amount_minor:c.expectedFundingAmountMinor??null,funding_variance_minor:c.fundingVarianceMinor??0}));
    const verifiedFiles=Array.from(verified.values()).map(v=>v.meta);
    const result=await rpc(base,serviceKey,serviceKey,"materialize_payroll_capture_internal",{p_capture_session_id:context.id,p_expected_version:context.version,p_idempotency_key_hash:await hashText(input.idempotency_key),p_server_result:{contract_version:globalThis.FluxPayrollParser.PARSER_VERSION,valid:true,issues:[],warnings:packageResult.warnings,capture_session_id:context.id,capture_version:context.version,actor_profile_id:profiles[0].id,verified_at:new Date().toISOString(),parser_versions:[globalThis.FluxPayrollParser.PARSER_VERSION,globalThis.FluxPayrollRealFormats.CONTRACT_VERSION],finance_review_required:Boolean(packageResult.financeReviewRequired),files:verifiedFiles,channels,lines}});
    return response(200,result);
  }catch(error){ const code=error instanceof Error?error.message:"PAYROLL_MATERIALIZATION_FAILED"; const safe=/^PAYROLL_[A-Z0-9_]+$/.test(code)?code:"PAYROLL_MATERIALIZATION_FAILED"; return response(errorStatus(safe),{error:safe}); }
}
Deno.serve(handler);
export {errorStatus,handler,requireFinanceCaptureAccess,sha256Hex,verifyFile,pickSourceAccount};
