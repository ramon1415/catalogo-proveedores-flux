export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
export const ALLOWED_FILE_KINDS = Object.freeze([
  "invoice_pdf",
  "invoice_xml",
  "bank_document",
  "support",
  "other",
]);

export const MIME_EXTENSIONS = Object.freeze({
  "application/pdf": Object.freeze(["pdf"]),
  "application/xml": Object.freeze(["xml"]),
  "text/xml": Object.freeze(["xml"]),
  "image/jpeg": Object.freeze(["jpg", "jpeg"]),
  "image/png": Object.freeze(["png"]),
  "image/webp": Object.freeze(["webp"]),
});

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RFC_PATTERN = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/;
const INVOICE_UUID_PATTERN =
  /^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
const SAFE_ACCOUNT_PATTERN = /^[A-Za-z0-9]{4,34}$/;
const FORBIDDEN_XML = /<\s*!\s*(?:DOCTYPE|ENTITY)\b/i;

export const FIELD_LIMITS = Object.freeze({
  provider_name: 200,
  provider_rfc: 20,
  provider_email: 254,
  provider_phone: 50,
  concept: 300,
  description: 4000,
  currency: 3,
  requested_payment_date: 10,
  invoice_folio: 120,
  invoice_uuid: 36,
  invoice_date: 10,
  bank_name: 160,
  bank_account: 34,
  bank_clabe: 30,
  beneficiary_name: 200,
  bank_data_confirmation: 32,
});

export function tokenFromLocation({ hash = "", search = "", historyState = null }) {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (query.has("token")) return { ok: false, reason: "query_token_rejected" };

  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!fragment) {
    return {
      ok: false,
      reason: historyState?.intakeFragmentConsumed ? "fragment_consumed" : "token_absent",
    };
  }

  let candidate = fragment;
  let format = "raw";
  if (fragment.startsWith("token=")) {
    candidate = fragment.slice(6);
    format = "canonical";
  } else if (fragment.includes("=")) {
    return { ok: false, reason: "token_invalid" };
  }

  if (!TOKEN_PATTERN.test(candidate)) return { ok: false, reason: "token_invalid" };
  return { ok: true, token: candidate, format };
}

export function urlWithoutFragment(locationLike) {
  const params = new URLSearchParams(String(locationLike.search || "").replace(/^\?/, ""));
  params.delete("token");
  const query = params.toString();
  return `${locationLike.pathname || ""}${query ? `?${query}` : ""}` || "/";
}

export function hasControlCharacter(value) {
  return CONTROL_CHARACTER.test(String(value ?? ""));
}

function normalizedText(value, maxLength, required = false) {
  const raw = value === null || value === undefined ? "" : String(value);
  const result = raw.trim().replace(/\s+/g, " ");
  if (!result) return required ? { error: "required" } : { value: undefined };
  if (result.length > maxLength || hasControlCharacter(result)) return { error: "invalid" };
  return { value: result };
}

export function isRealIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function validatePayload(raw, options = {}) {
  const errors = {};
  const payload = {};
  const maxAmount = Number.isFinite(options.maxAmount) ? options.maxAmount : 1_000_000_000;
  const currencies = options.allowedCurrencies || ["MXN"];
  const copy = (name, required = false) => {
    const result = normalizedText(raw[name], FIELD_LIMITS[name], required);
    if (result.error === "required") errors[name] = "Este campo es obligatorio.";
    else if (result.error) errors[name] = "Revisa la longitud y elimina caracteres no permitidos.";
    else if (result.value !== undefined) payload[name] = result.value;
    return result.value;
  };

  copy("provider_name", true);
  const email = copy("provider_email", true);
  if (email && !EMAIL_PATTERN.test(email)) errors.provider_email = "No encontramos un correo válido.";
  else if (email) payload.provider_email = email.toLowerCase();
  copy("provider_phone");
  copy("concept", true);
  copy("description");
  copy("invoice_folio");
  copy("bank_name");
  copy("beneficiary_name");

  const bankConfirmation = copy("bank_data_confirmation");
  if (options.providerAware) {
    if (!bankConfirmation) errors.bank_data_confirmation = "Confirma si tus datos bancarios siguen vigentes.";
    else if (!["MASTER_CONFIRMED", "CHANGE_DECLARED"].includes(bankConfirmation)) errors.bank_data_confirmation = "Selecciona una opción válida.";
  } else if (bankConfirmation) {
    errors.bank_data_confirmation = "Esta confirmación no corresponde a un enlace genérico.";
  }

  const rfc = copy("provider_rfc");
  if (rfc) {
    const normalized = rfc.toUpperCase().replace(/[\s-]/g, "");
    if (!RFC_PATTERN.test(normalized)) errors.provider_rfc = "El RFC no tiene un formato mexicano válido.";
    else payload.provider_rfc = normalized;
  }

  const amountText = String(raw.amount_requested ?? "").trim();
  const amount = Number(amountText);
  if (!/^\d+(?:\.\d{1,2})?$/.test(amountText) || !Number.isFinite(amount) || amount <= 0 || amount > maxAmount) {
    errors.amount_requested = "El monto debe ser mayor a cero y usar máximo dos decimales.";
  } else {
    payload.amount_requested = amount;
  }

  const currency = String(raw.currency ?? "MXN").trim().toUpperCase();
  if (!currencies.includes(currency)) errors.currency = "Selecciona una moneda permitida.";
  else payload.currency = currency;

  for (const field of ["requested_payment_date", "invoice_date"]) {
    const date = copy(field);
    if (date && !isRealIsoDate(date)) errors[field] = "Captura una fecha válida.";
  }

  const invoiceUuid = copy("invoice_uuid");
  if (invoiceUuid) {
    const normalized = invoiceUuid.toUpperCase();
    if (!INVOICE_UUID_PATTERN.test(normalized)) errors.invoice_uuid = "El UUID fiscal no tiene un formato válido.";
    else payload.invoice_uuid = normalized;
  }

  const account = copy("bank_account");
  if (account) {
    const normalized = account.replace(/[\s-]/g, "");
    if (!SAFE_ACCOUNT_PATTERN.test(normalized)) errors.bank_account = "La cuenta debe contener de 4 a 34 letras o números.";
    else payload.bank_account = normalized;
  }

  const clabe = copy("bank_clabe");
  if (clabe) {
    const normalized = clabe.replace(/[\s-]/g, "");
    if (!/^\d{18}$/.test(normalized)) errors.bank_clabe = "La CLABE debe contener exactamente 18 dígitos.";
    else payload.bank_clabe = normalized;
  }

  if (options.providerAware && bankConfirmation === "MASTER_CONFIRMED") {
    delete payload.bank_name;
    delete payload.bank_account;
    delete payload.bank_clabe;
    delete payload.beneficiary_name;
  }
  if (options.providerAware && bankConfirmation === "CHANGE_DECLARED") {
    if (!payload.bank_name) errors.bank_name = "Captura el banco reportado.";
    if (!payload.beneficiary_name) errors.beneficiary_name = "Captura el beneficiario reportado.";
    if (!payload.bank_account && !payload.bank_clabe) {
      errors.bank_account = "Captura al menos la cuenta o la CLABE reportada.";
    }
  }

  return { valid: Object.keys(errors).length === 0, errors, payload };
}

export function extensionOf(filename) {
  return filename.toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1] || "";
}

export function suggestFileKind(file) {
  const extension = extensionOf(file.name || "");
  if (extension === "xml") return "invoice_xml";
  if (extension === "pdf") return "invoice_pdf";
  if (["jpg", "jpeg", "png", "webp"].includes(extension)) return "support";
  return "other";
}

export function isAllowedFileKind(value) {
  return ALLOWED_FILE_KINDS.includes(value);
}

function startsWithBytes(bytes, signature) {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

export function validateFileSignature(mimeType, bytes) {
  if (mimeType === "application/pdf") {
    return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  }
  if (mimeType === "image/jpeg") return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === "image/png") return startsWithBytes(bytes, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if (mimeType === "image/webp") {
    return startsWithBytes(bytes, [0x52,0x49,0x46,0x46]) &&
      bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  if (mimeType === "application/xml" || mimeType === "text/xml") {
    const sample = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "").trimStart();
    if (FORBIDDEN_XML.test(sample)) return false;
    return sample.startsWith("<?xml") || /^<[A-Za-z_][A-Za-z0-9_.:-]*(?:\s|>)/.test(sample);
  }
  return false;
}

export function xmlContainsForbiddenDeclaration(bytes) {
  return FORBIDDEN_XML.test(new TextDecoder().decode(bytes));
}

export async function validateFileBatch(files, limits) {
  const errors = [];
  const validFiles = [];
  const maxFiles = Math.min(3, Number(limits.maxFiles) || 0);
  const maxFileBytes = Number(limits.maxFileMb) * 1024 * 1024;
  const allowedTypes = new Set(limits.allowedFileTypes || []);
  if (files.length > maxFiles) errors.push(`Puedes adjuntar máximo ${maxFiles} archivos.`);

  const seen = new Set();
  for (const file of files.slice(0, maxFiles)) {
    const mime = String(file.type || "").toLowerCase();
    const extension = extensionOf(file.name || "");
    const duplicateKey = `${String(file.name || "").toLowerCase()}|${file.size}|${mime}`;
    let error = "";
    if (seen.has(duplicateKey)) error = "Este archivo ya fue agregado.";
    else if (!allowedTypes.has(mime) || !MIME_EXTENSIONS[mime]?.includes(extension)) error = "El archivo no tiene un formato permitido.";
    else if (file.size < 1 || file.size > maxFileBytes) error = `El archivo debe pesar máximo ${limits.maxFileMb} MB.`;
    else if (String(file.name || "").length > 255 || /[/\\]|\.\.|[\u0000-\u001f\u007f]/.test(String(file.name || ""))) error = "El nombre del archivo no es válido.";

    let bytes;
    if (!error) {
      bytes = new Uint8Array(await file.arrayBuffer());
      if ((mime === "application/xml" || mime === "text/xml") && xmlContainsForbiddenDeclaration(bytes)) {
        error = "El XML contiene una definición no permitida. Solicita una versión sin DTD ni entidades.";
      } else if (!validateFileSignature(mime, bytes)) {
        error = "El contenido del archivo no coincide con su formato.";
      }
    }
    seen.add(duplicateKey);
    if (error) errors.push(`${file.name}: ${error}`);
    else validFiles.push(file);
  }
  return { valid: errors.length === 0, errors, files: validFiles };
}

export function estimateMultipartBytes(payload, files, fileKinds, overhead = {}) {
  const encoder = new TextEncoder();
  const fileBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  const dataBytes = encoder.encode(JSON.stringify(payload || {})).length +
    encoder.encode(JSON.stringify(fileKinds || [])).length + 4096;
  const base = Number(overhead.baseBytes) || 16 * 1024;
  const perFile = (Number(overhead.perFileBytes) || 4 * 1024) * files.length;
  const safety = Number(overhead.safetyBytes) || 256 * 1024;
  return fileBytes + dataBytes + base + perFile + safety;
}

export function fitsTotalBudget(payload, files, fileKinds, maxTotalMb, overhead) {
  const estimatedBytes = estimateMultipartBytes(payload, files, fileKinds, overhead);
  const maxBytes = Number(maxTotalMb) * 1024 * 1024;
  return { fits: estimatedBytes <= maxBytes, estimatedBytes, maxBytes };
}

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  link_not_available: "Este enlace no está disponible.",
  captcha_failed: "No pudimos validar el control de seguridad. Inténtalo nuevamente.",
  invalid_request: "Revisa los datos marcados antes de continuar.",
  invalid_email: "El correo electrónico no tiene un formato válido.",
  invalid_amount: "El monto capturado no es válido.",
  file_type_not_allowed: "Uno de los archivos no tiene un formato permitido.",
  payload_too_large: "El tamaño total excede el límite permitido.",
  rate_limited: "Se alcanzó el límite temporal de envíos para este enlace. Contacta a Finanzas.",
  submit_failed: "No fue posible completar la carga de documentos. Inténtalo nuevamente.",
  service_unavailable: "El servicio no está disponible temporalmente. Inténtalo más tarde.",
});

export function mapPublicResponse(status, contentType, body, maxTotalMb = 12) {
  const isJson = String(contentType || "").toLowerCase().includes("application/json");
  if (isJson && body && typeof body === "object") {
    const code = typeof body.error === "string" ? body.error :
      typeof body.code === "string" ? body.code : "service_unavailable";
    const base = PUBLIC_ERROR_MESSAGES[code] || PUBLIC_ERROR_MESSAGES.service_unavailable;
    return {
      code,
      message: code === "payload_too_large" ? `El tamaño total excede el límite permitido de ${maxTotalMb} MB.` : base,
      requestId: typeof body.request_id === "string" && /^[A-Za-z0-9_-]{4,80}$/.test(body.request_id) ? body.request_id : "",
    };
  }
  if (status === 403) return { code: "security_rejected", message: "El contenido fue rechazado por los controles de seguridad.", requestId: "" };
  if (status === 413) return { code: "payload_too_large", message: `El tamaño total excede el límite permitido de ${maxTotalMb} MB.`, requestId: "" };
  if (status === 502 || status === 503) {
    return { code: "platform_boundary", message: `No pudimos procesar el envío. Verifica que los archivos no excedan el límite total de ${maxTotalMb} MB y vuelve a intentarlo.`, requestId: "" };
  }
  return { code: "service_unavailable", message: PUBLIC_ERROR_MESSAGES.service_unavailable, requestId: "" };
}

export function parseSubmissionSuccess(status, contentType, body) {
  const isJson = String(contentType || "").toLowerCase().includes("application/json");
  if (!isJson || ![200, 201].includes(status) || body?.ok !== true || !/^INT-\d{4}-\d{6}$/.test(body.public_folio || "")) {
    return null;
  }
  return { folio: body.public_folio, duplicate: body.duplicate === true };
}

export function materialVersion(payload, files, fileKinds) {
  const normalized = Object.keys(payload || {}).sort().map((key) => [key, payload[key]]);
  const fileState = files.map((file, index) => [file.name, file.size, file.type, file.lastModified || 0, fileKinds[index]]);
  return JSON.stringify([normalized, fileState]);
}

export class IdempotencyController {
  constructor(randomUuid = () => crypto.randomUUID()) {
    this.randomUuid = randomUuid;
    this.version = "";
    this.key = "";
    this.active = false;
  }
  keyFor(version) {
    if (!this.key || this.version !== version) {
      this.version = version;
      this.key = `intake:${this.randomUuid()}`;
    }
    return this.key;
  }
  begin(version) {
    if (this.active) return false;
    this.keyFor(version);
    this.active = true;
    return true;
  }
  finish() { this.active = false; }
  clear() { this.version = ""; this.key = ""; this.active = false; }
}

export const STATE_TRANSITIONS = Object.freeze({
  booting: Object.freeze(["link_validating", "unavailable"]),
  link_validating: Object.freeze(["link_valid", "recoverable_error", "unavailable"]),
  link_valid: Object.freeze(["editing"]),
  editing: Object.freeze(["reviewing", "unavailable"]),
  reviewing: Object.freeze(["editing", "captcha_pending", "ready_to_submit"]),
  captcha_pending: Object.freeze(["editing", "ready_to_submit", "recoverable_error"]),
  ready_to_submit: Object.freeze(["editing", "captcha_pending", "submitting"]),
  submitting: Object.freeze(["submit_success", "recoverable_error"]),
  submit_success: Object.freeze([]),
  recoverable_error: Object.freeze(["link_validating", "editing", "reviewing", "captcha_pending", "ready_to_submit", "submitting", "unavailable"]),
  unavailable: Object.freeze([]),
});

export class IntakeStateMachine {
  constructor(initial = "booting") {
    if (!Object.hasOwn(STATE_TRANSITIONS, initial)) throw new Error("unknown_state");
    this.state = initial;
  }
  canTransition(next) { return STATE_TRANSITIONS[this.state].includes(next); }
  transition(next) {
    if (!this.canTransition(next)) throw new Error(`invalid_transition:${this.state}:${next}`);
    this.state = next;
    return this.state;
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(0.01, bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
