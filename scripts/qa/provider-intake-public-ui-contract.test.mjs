import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  IdempotencyController,
  IntakeStateMachine,
  estimateMultipartBytes,
  fitsTotalBudget,
  isAllowedFileKind,
  isRealIsoDate,
  mapPublicResponse,
  parseSubmissionSuccess,
  tokenFromLocation,
  urlWithoutFragment,
  validateFileBatch,
  validateFileSignature,
  validatePayload,
  xmlContainsForbiddenDeclaration,
} from "../../solicitar-core.js";

const validToken = "A".repeat(32);
const portalHtml = fs.readFileSync(new URL("../../solicitar.html", import.meta.url), "utf8");
const portalJs = fs.readFileSync(new URL("../../solicitar.js", import.meta.url), "utf8");
const portalCss = fs.readFileSync(new URL("../../solicitar.css", import.meta.url), "utf8");
const basePayload = {
  provider_name: "Proveedor de Prueba",
  provider_email: "qa@example.test",
  concept: "Servicio ficticio",
  amount_requested: "1200.50",
  currency: "MXN",
};

function bytes(...values) { return new Uint8Array(values); }
function textBytes(value) { return new TextEncoder().encode(value); }
function fakeFile(name, type, content, options = {}) {
  const data = content instanceof Uint8Array ? content : textBytes(content);
  return {
    name,
    type,
    size: options.size ?? data.byteLength,
    lastModified: 1,
    async arrayBuffer() { return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); },
  };
}
const limits = {
  maxFiles: 3,
  maxFileMb: 10,
  maxTotalMb: 12,
  allowedFileTypes: ["application/pdf","application/xml","text/xml","image/jpeg","image/png","image/webp"],
};

test("TOKEN: acepta fragmento canónico válido", () => {
  assert.deepEqual(tokenFromLocation({ hash:`#token=${validToken}`, search:"" }), { ok:true, token:validToken, format:"canonical" });
});
test("TOKEN: acepta fragmento raw compatible", () => {
  assert.deepEqual(tokenFromLocation({ hash:`#${validToken}`, search:"" }), { ok:true, token:validToken, format:"raw" });
});
test("TOKEN: rechaza fragmento ausente", () => assert.equal(tokenFromLocation({ hash:"", search:"" }).reason, "token_absent"));
test("TOKEN: distingue recarga después de consumir fragmento", () => assert.equal(tokenFromLocation({ hash:"", search:"", historyState:{ intakeFragmentConsumed:true } }).reason, "fragment_consumed"));
test("TOKEN: rechaza token en query aunque exista hash válido", () => assert.equal(tokenFromLocation({ hash:`#token=${validToken}`, search:`?token=${validToken}` }).reason, "query_token_rejected"));
test("TOKEN: rechaza token corto", () => assert.equal(tokenFromLocation({ hash:"#token=abc", search:"" }).reason, "token_invalid"));
test("TOKEN: rechaza caracteres inválidos", () => assert.equal(tokenFromLocation({ hash:`#token=${"A".repeat(31)}!`, search:"" }).reason, "token_invalid"));
test("TOKEN: URL limpia retira fragmento y token query", () => assert.equal(urlWithoutFragment({ pathname:"/solicitar.html", search:"?token=secret&lang=es" }), "/solicitar.html?lang=es"));

test("VALIDACIÓN: acepta payload válido y aplica trim", () => {
  const result = validatePayload({ ...basePayload, provider_name:"  Proveedor   Prueba  " });
  assert.equal(result.valid, true); assert.equal(result.payload.provider_name, "Proveedor Prueba");
});
test("VALIDACIÓN: campos obligatorios", () => {
  const result = validatePayload({ currency:"MXN" });
  assert.deepEqual(Object.keys(result.errors).sort(), ["amount_requested","concept","provider_email","provider_name"]);
});
test("VALIDACIÓN: correo inválido", () => assert.equal(validatePayload({ ...basePayload, provider_email:"correo" }).errors.provider_email, "No encontramos un correo válido."));
test("VALIDACIÓN: RFC mexicano válido", () => assert.equal(validatePayload({ ...basePayload, provider_rfc:"goca-850101 ab1" }).payload.provider_rfc, "GOCA850101AB1"));
test("VALIDACIÓN: RFC inválido", () => assert.ok(validatePayload({ ...basePayload, provider_rfc:"INVALIDO" }).errors.provider_rfc));
test("VALIDACIÓN: CLABE de 18 dígitos", () => assert.equal(validatePayload({ ...basePayload, bank_clabe:"012345678901234567" }).payload.bank_clabe, "012345678901234567"));
test("VALIDACIÓN: CLABE inválida", () => assert.ok(validatePayload({ ...basePayload, bank_clabe:"123" }).errors.bank_clabe));
test("VALIDACIÓN: monto mayor a cero", () => assert.ok(validatePayload({ ...basePayload, amount_requested:"0" }).errors.amount_requested));
test("VALIDACIÓN: máximo dos decimales", () => assert.ok(validatePayload({ ...basePayload, amount_requested:"1.234" }).errors.amount_requested));
test("VALIDACIÓN: límite configurado", () => assert.ok(validatePayload({ ...basePayload, amount_requested:"101" }, { maxAmount:100, allowedCurrencies:["MXN"] }).errors.amount_requested));
test("VALIDACIÓN: UUID fiscal válido", () => assert.equal(validatePayload({ ...basePayload, invoice_uuid:"123e4567-e89b-12d3-a456-426614174000" }).payload.invoice_uuid, "123E4567-E89B-12D3-A456-426614174000"));
test("VALIDACIÓN: UUID fiscal inválido", () => assert.ok(validatePayload({ ...basePayload, invoice_uuid:"123" }).errors.invoice_uuid));
test("VALIDACIÓN: fecha real", () => { assert.equal(isRealIsoDate("2024-02-29"), true); assert.equal(isRealIsoDate("2023-02-29"), false); });
test("VALIDACIÓN: rechaza caracteres de control", () => assert.ok(validatePayload({ ...basePayload, concept:"texto\u0000" }).errors.concept));
test("VALIDACIÓN: rechaza moneda no permitida", () => assert.ok(validatePayload({ ...basePayload, currency:"USD" }, { allowedCurrencies:["MXN"] }).errors.currency));

test("ARCHIVOS: firmas PDF, JPEG, PNG y WEBP", () => {
  assert.equal(validateFileSignature("application/pdf", textBytes("%PDF-1.7")), true);
  assert.equal(validateFileSignature("image/jpeg", bytes(0xff,0xd8,0xff,0xdb)), true);
  assert.equal(validateFileSignature("image/png", bytes(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a)), true);
  assert.equal(validateFileSignature("image/webp", bytes(0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50)), true);
});
test("ARCHIVOS: XML seguro", () => assert.equal(validateFileSignature("application/xml", textBytes("<?xml version=\"1.0\"?><cfdi/>")), true));
test("ARCHIVOS: XML con DOCTYPE", () => assert.equal(xmlContainsForbiddenDeclaration(textBytes("< ! DoCtYpE cfdi><cfdi/>")), true));
test("ARCHIVOS: XML con ENTITY", () => assert.equal(xmlContainsForbiddenDeclaration(textBytes("<\n!\tENTITY x SYSTEM 'file:///x'>")), true));
test("ARCHIVOS: máximo tres", async () => {
  const files = [1,2,3,4].map((n) => fakeFile(`${n}.pdf`, "application/pdf", "%PDF-x"));
  const result = await validateFileBatch(files, limits); assert.equal(result.valid, false); assert.match(result.errors[0], /máximo 3/);
});
test("ARCHIVOS: máximo individual 10 MB", async () => {
  const file = fakeFile("large.pdf", "application/pdf", "%PDF-x", { size:10 * 1024 * 1024 + 1 });
  const result = await validateFileBatch([file], limits); assert.equal(result.valid, false); assert.match(result.errors[0], /10 MB/);
});
test("ARCHIVOS: MIME no permitido", async () => {
  const result = await validateFileBatch([fakeFile("x.svg", "image/svg+xml", "<svg/>")], limits); assert.equal(result.valid, false);
});
test("ARCHIVOS: duplicados", async () => {
  const file = fakeFile("x.pdf", "application/pdf", "%PDF-x");
  const result = await validateFileBatch([file,file], limits); assert.equal(result.valid, false); assert.match(result.errors.at(-1), /ya fue agregado/);
});
test("ARCHIVOS: lote de formatos permitidos", async () => {
  const files = [fakeFile("x.pdf","application/pdf","%PDF-x"),fakeFile("x.xml","text/xml","<?xml version=\"1.0\"?><root/>")];
  const result = await validateFileBatch(files, limits); assert.equal(result.valid, true); assert.equal(result.files.length, 2);
});
test("ARCHIVOS: XML DTD bloqueado antes de red", async () => {
  const result = await validateFileBatch([fakeFile("x.xml","application/xml","< !DOCTYPE root><root/>")], limits);
  assert.equal(result.valid, false); assert.match(result.errors[0], /DTD ni entidades/);
});
test("ARCHIVOS: file_kind permitido", () => { assert.equal(isAllowedFileKind("invoice_pdf"), true); assert.equal(isAllowedFileKind("internal"), false); });
test("ARCHIVOS: presupuesto total conservador incluye overhead", () => {
  const files = [{ size:11.8 * 1024 * 1024 }];
  const result = fitsTotalBudget(basePayload, files, ["support"], 12, { safetyBytes:256*1024, baseBytes:16*1024, perFileBytes:4*1024 });
  assert.equal(result.fits, false);
  assert.ok(estimateMultipartBytes(basePayload, files, ["support"]) > files[0].size);
});

test("ACCESIBILIDAD DOCUMENTOS: file-input tiene label explícito", () => {
  assert.match(portalHtml, /<label[^>]*for="file-input"[^>]*>\s*Seleccionar documentos para adjuntar\s*<\/label>/);
});
test("ACCESIBILIDAD DOCUMENTOS: dropzone no es botón ni entra al tab order", () => {
  const tag = portalHtml.match(/<div id="dropzone"[^>]*>/)?.[0] || "";
  assert.doesNotMatch(tag, /role="button"/);
  assert.doesNotMatch(tag, /tabindex=/);
  assert.match(tag, /role="group"/);
});
test("ACCESIBILIDAD DOCUMENTOS: no hay ancestro interactivo para el botón selector", () => {
  const tag = portalHtml.match(/<div id="dropzone"[^>]*>/)?.[0] || "";
  assert.doesNotMatch(tag, /role="button"|tabindex="0"/);
  assert.match(portalHtml, /<button id="choose-files-button"[^>]*>/);
});
test("ACCESIBILIDAD DOCUMENTOS: botón visible controla file-input", () => {
  const tag = portalHtml.match(/<button id="choose-files-button"[^>]*>/)?.[0] || "";
  assert.match(tag, /aria-controls="file-input"/);
});
test("ACCESIBILIDAD DOCUMENTOS: dropzone conserva drag and drop", () => {
  for (const eventName of ["dragover", "dragleave", "drop"]) {
    assert.match(portalJs, new RegExp(`dropzone\\.addEventListener\\("${eventName}"`));
  }
});
test("ACCESIBILIDAD DOCUMENTOS: botón conserva el flujo de selección", () => {
  assert.match(portalJs, /byId\("choose-files-button"\)\.addEventListener\("click", \(\) => byId\("file-input"\)\.click\(\)\)/);
  assert.doesNotMatch(portalJs, /dropzone\.addEventListener\("(click|keydown)"/);
});
test("ACCESIBILIDAD DOCUMENTOS: IDs HTML sin duplicados", () => {
  const ids = [...portalHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});
test("ACCESIBILIDAD DOCUMENTOS: landmarks y affordance son semánticos", () => {
  assert.match(portalHtml, /<aside class="dev-banner" aria-label="Aviso del ambiente de pruebas">/);
  assert.match(portalHtml, /<section class="summary-aside" aria-labelledby="summary-title">/);
  assert.match(portalHtml, /id="dropzone-title"/);
  assert.doesNotMatch(portalCss, /\.dropzone:hover|\.dropzone\{[^}]*cursor:pointer/);
});

test("ERRORES: JSON 400 inválido", () => assert.equal(mapPublicResponse(400,"application/json",{ error:"invalid_request" }).code, "invalid_request"));
test("ERRORES: JSON 413", () => assert.match(mapPublicResponse(413,"application/json",{ error:"payload_too_large" },12).message, /12 MB/));
test("ERRORES: no JSON 403", () => assert.equal(mapPublicResponse(403,"text/html","gateway").code, "security_rejected"));
test("ERRORES: no JSON 413", () => assert.equal(mapPublicResponse(413,"text/plain","large").code, "payload_too_large"));
test("ERRORES: no JSON 502 y 503", () => { assert.equal(mapPublicResponse(502,"text/html","x").code,"platform_boundary"); assert.equal(mapPublicResponse(503,"text/html","x").code,"platform_boundary"); });
test("ERRORES: rate_limited", () => assert.match(mapPublicResponse(429,"application/json",{ error:"rate_limited" }).message, /límite temporal/));
test("ERRORES: request_id sanitizado", () => { assert.equal(mapPublicResponse(400,"application/json",{ error:"invalid_request", request_id:"safe_123" }).requestId,"safe_123"); assert.equal(mapPublicResponse(400,"application/json",{ error:"invalid_request", request_id:"<html>" }).requestId,""); });
test("ERRORES: duplicate=true es éxito con mismo folio", () => assert.deepEqual(parseSubmissionSuccess(200,"application/json",{ ok:true, public_folio:"INT-2026-000001", duplicate:true }), { folio:"INT-2026-000001", duplicate:true }));

test("IDEMPOTENCIA: misma versión reutiliza key", () => {
  let i = 0; const keys = new IdempotencyController(() => `00000000-0000-4000-8000-${String(++i).padStart(12,"0")}`);
  assert.equal(keys.keyFor("v1"), keys.keyFor("v1"));
});
test("IDEMPOTENCIA: cambio material regenera key", () => {
  let i = 0; const keys = new IdempotencyController(() => `00000000-0000-4000-8000-${String(++i).padStart(12,"0")}`);
  assert.notEqual(keys.keyFor("v1"), keys.keyFor("v2"));
});
test("IDEMPOTENCIA: doble clic bloqueado", () => {
  const keys = new IdempotencyController(() => "00000000-0000-4000-8000-000000000001");
  assert.equal(keys.begin("v1"), true); assert.equal(keys.begin("v1"), false); keys.finish(); assert.equal(keys.begin("v1"), true);
});

test("ESTADOS: flujo válido", () => {
  const state = new IntakeStateMachine();
  for (const next of ["link_validating","link_valid","editing","reviewing","captcha_pending","ready_to_submit","submitting","submit_success"]) state.transition(next);
  assert.equal(state.state, "submit_success");
});
test("ESTADOS: submit desde booting bloqueado", () => assert.throws(() => new IntakeStateMachine().transition("submitting"), /invalid_transition/));
test("ESTADOS: doble submit bloqueado", () => {
  const state = new IntakeStateMachine("ready_to_submit"); state.transition("submitting"); assert.equal(state.canTransition("submitting"), false);
});
test("ESTADOS: editar después de éxito bloqueado", () => assert.equal(new IntakeStateMachine("submit_success").canTransition("editing"), false));
