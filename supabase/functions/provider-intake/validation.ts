import { parseAllowedOrigins } from "./cors.ts";
import {
  ALLOWED_PAYLOAD_FIELDS,
  type IntakeConfig,
  IntakeError,
  type IntakePayload,
  type SubmitEnvelope,
} from "./types.ts";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rfcPattern = /^[A-Z&\u00D1]{3,4}\d{6}[A-Z0-9]{3}$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const invoiceUuidPattern =
  /^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
const tokenPattern = /^[A-Za-z0-9_-]{32,256}$/;
const idempotencyPattern = /^[A-Za-z0-9._:-]{8,128}$/;

type EnvReader = (name: string) => string | undefined;

function hasAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || codePoint === 0x7f)
    ) {
      return true;
    }
  }
  return false;
}

function envNumber(reader: EnvReader, name: string, fallback: number): number {
  const raw = reader(name)?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`invalid_configuration:${name}`);
  return value;
}

function envBoolean(
  reader: EnvReader,
  name: string,
  fallback: boolean,
): boolean {
  const raw = reader(name)?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`invalid_configuration:${name}`);
}

export function readIntakeConfig(reader: EnvReader): IntakeConfig {
  const allowedOrigins = parseAllowedOrigins(
    reader("INTAKE_ALLOWED_ORIGINS") || "",
  );
  const maxFiles = Math.trunc(envNumber(reader, "INTAKE_MAX_FILES", 3));
  const maxTotalMb = envNumber(reader, "INTAKE_MAX_TOTAL_MB", 12);
  const maxAmount = envNumber(reader, "INTAKE_MAX_AMOUNT", 1000000000);
  const fingerprintWindowSeconds = Math.trunc(
    envNumber(reader, "INTAKE_RATE_LIMIT_WINDOW_SECONDS", 86400),
  );
  const allowedCurrencies = (reader("INTAKE_ALLOWED_CURRENCIES") || "MXN")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^[A-Z]{3}$/.test(value));
  const privacyNoticeUrl = reader("INTAKE_PRIVACY_NOTICE_URL")?.trim() || "";

  if (!allowedOrigins.length) {
    throw new Error("invalid_configuration:INTAKE_ALLOWED_ORIGINS");
  }
  if (maxFiles < 0 || maxFiles > 3) {
    throw new Error("invalid_configuration:INTAKE_MAX_FILES");
  }
  if (maxTotalMb <= 0 || maxTotalMb > 15) {
    throw new Error("invalid_configuration:INTAKE_MAX_TOTAL_MB");
  }
  if (maxAmount <= 0) {
    throw new Error("invalid_configuration:INTAKE_MAX_AMOUNT");
  }
  if (fingerprintWindowSeconds < 60 || fingerprintWindowSeconds > 86400) {
    throw new Error("invalid_configuration:INTAKE_RATE_LIMIT_WINDOW_SECONDS");
  }
  if (!allowedCurrencies.length) {
    throw new Error("invalid_configuration:INTAKE_ALLOWED_CURRENCIES");
  }
  try {
    if (!privacyNoticeUrl || new URL(privacyNoticeUrl).protocol !== "https:") {
      throw new Error();
    }
  } catch {
    throw new Error("invalid_configuration:INTAKE_PRIVACY_NOTICE_URL");
  }

  return {
    allowedOrigins,
    allowNoOrigin: envBoolean(reader, "INTAKE_ALLOW_NO_ORIGIN", false),
    maxFiles,
    maxTotalMb,
    maxTotalBytes: Math.floor(maxTotalMb * 1024 * 1024),
    maxAmount,
    allowedCurrencies,
    privacyNoticeUrl,
    fingerprintWindowSeconds,
  };
}

export function intakeToken(req: Request): string {
  const token = req.headers.get("x-intake-token")?.trim() || "";
  if (!tokenPattern.test(token)) {
    throw new IntakeError("link_not_available", 404, "invalid_token_format");
  }
  return token;
}

export function idempotencyKey(req: Request): string | null {
  const value = req.headers.get("idempotency-key")?.trim() || "";
  if (!value) return null;
  if (!idempotencyPattern.test(value)) {
    throw new IntakeError("invalid_request", 400, "invalid_idempotency_key");
  }
  return value;
}

function normalizedText(
  value: unknown,
  field: string,
  maxLength: number,
  required = false,
): string | undefined {
  if (value === null || value === undefined) {
    if (required) {
      throw new IntakeError("invalid_request", 400, `${field}_required`);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    throw new IntakeError("invalid_request", 400, `${field}_invalid_type`);
  }
  const result = value.trim().replace(/\s+/g, " ");
  if (!result) {
    if (required) {
      throw new IntakeError("invalid_request", 400, `${field}_required`);
    }
    return undefined;
  }
  if (result.length > maxLength || hasAsciiControlCharacter(result)) {
    throw new IntakeError("invalid_request", 400, `${field}_invalid`);
  }
  return result;
}

function isoDate(value: unknown, field: string): string | undefined {
  const result = normalizedText(value, field, 10);
  if (!result) return undefined;
  if (!isoDatePattern.test(result)) {
    throw new IntakeError("invalid_request", 400, `${field}_invalid`);
  }
  const [year, month, day] = result.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new IntakeError("invalid_request", 400, `${field}_invalid`);
  }
  return result;
}

export function validatePayload(
  value: unknown,
  config: IntakeConfig,
): IntakePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IntakeError("invalid_request", 400, "payload_invalid");
  }
  const raw = value as Record<string, unknown>;
  const allowed = new Set<string>(ALLOWED_PAYLOAD_FIELDS);
  const unknown = Object.keys(raw).find((key) => !allowed.has(key));
  if (unknown) {
    throw new IntakeError("invalid_request", 400, "payload_unknown_field");
  }

  const providerName = normalizedText(
    raw.provider_name,
    "provider_name",
    200,
    true,
  )!;
  const providerEmail = normalizedText(
    raw.provider_email,
    "provider_email",
    254,
    true,
  )!.toLowerCase();
  if (!emailPattern.test(providerEmail)) {
    throw new IntakeError("invalid_email", 400, "provider_email_invalid");
  }

  const amount = typeof raw.amount_requested === "number"
    ? raw.amount_requested
    : Number(String(raw.amount_requested ?? "").trim());
  const cents = amount * 100;
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > config.maxAmount ||
    Math.abs(Math.round(cents) - cents) > 1e-8
  ) {
    throw new IntakeError("invalid_amount", 400, "amount_invalid");
  }

  const currency = normalizedText(raw.currency ?? "MXN", "currency", 3, true)!
    .toUpperCase();
  if (!config.allowedCurrencies.includes(currency)) {
    throw new IntakeError("invalid_request", 400, "currency_invalid");
  }

  const providerRfc = normalizedText(raw.provider_rfc, "provider_rfc", 20)
    ?.toUpperCase().replace(/[\s-]/g, "");
  if (providerRfc && !rfcPattern.test(providerRfc)) {
    throw new IntakeError("invalid_request", 400, "provider_rfc_invalid");
  }

  const bankClabe = normalizedText(raw.bank_clabe, "bank_clabe", 30)?.replace(
    /[\s-]/g,
    "",
  );
  if (bankClabe && !/^\d{18}$/.test(bankClabe)) {
    throw new IntakeError("invalid_request", 400, "bank_clabe_invalid");
  }

  const bankAccount = normalizedText(raw.bank_account, "bank_account", 34)
    ?.replace(/[\s-]/g, "");
  if (bankAccount && !/^[A-Za-z0-9]{4,34}$/.test(bankAccount)) {
    throw new IntakeError("invalid_request", 400, "bank_account_invalid");
  }

  const invoiceUuid = normalizedText(raw.invoice_uuid, "invoice_uuid", 36)
    ?.toUpperCase();
  if (invoiceUuid && !invoiceUuidPattern.test(invoiceUuid)) {
    throw new IntakeError("invalid_request", 400, "invoice_uuid_invalid");
  }

  const bankDataConfirmation = normalizedText(
    raw.bank_data_confirmation,
    "bank_data_confirmation",
    32,
  )?.toUpperCase();
  if (
    bankDataConfirmation &&
    !["MASTER_CONFIRMED", "CHANGE_DECLARED"].includes(bankDataConfirmation)
  ) {
    throw new IntakeError(
      "invalid_request",
      400,
      "bank_data_confirmation_invalid",
    );
  }

  return {
    provider_name: providerName,
    provider_rfc: providerRfc,
    provider_email: providerEmail,
    provider_phone: normalizedText(raw.provider_phone, "provider_phone", 50),
    concept: normalizedText(raw.concept, "concept", 300, true)!,
    description: normalizedText(raw.description, "description", 4000),
    amount_requested: amount,
    currency,
    requested_payment_date: isoDate(
      raw.requested_payment_date,
      "requested_payment_date",
    ),
    invoice_folio: normalizedText(raw.invoice_folio, "invoice_folio", 120),
    invoice_uuid: invoiceUuid,
    invoice_date: isoDate(raw.invoice_date, "invoice_date"),
    bank_name: normalizedText(raw.bank_name, "bank_name", 160),
    bank_account: bankAccount,
    bank_clabe: bankClabe,
    beneficiary_name: normalizedText(
      raw.beneficiary_name,
      "beneficiary_name",
      200,
    ),
    bank_data_confirmation: bankDataConfirmation as
      | "MASTER_CONFIRMED"
      | "CHANGE_DECLARED"
      | undefined,
  };
}

function parseJson(value: FormDataEntryValue | null, label: string): unknown {
  if (typeof value !== "string") {
    throw new IntakeError("invalid_request", 400, `${label}_invalid`);
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new IntakeError("invalid_request", 400, `${label}_invalid_json`);
  }
}

export async function readSubmitEnvelope(
  req: Request,
): Promise<SubmitEnvelope> {
  const contentType = req.headers.get("content-type")?.toLowerCase() || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const fileEntries = form.getAll("files");
    if (fileEntries.some((entry) => !(entry instanceof File))) {
      throw new IntakeError("invalid_request", 400, "files_invalid");
    }
    const files = fileEntries as File[];
    return {
      payload: parseJson(form.get("payload"), "payload"),
      captchaToken: typeof form.get("captcha_token") === "string"
        ? String(form.get("captcha_token")).trim()
        : "",
      honeypot: typeof form.get("honeypot") === "string"
        ? String(form.get("honeypot")).trim()
        : "",
      files,
      fileKinds: form.has("file_kinds")
        ? parseJson(form.get("file_kinds"), "file_kinds")
        : [],
    };
  }

  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new IntakeError("invalid_request", 400, "invalid_json");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new IntakeError("invalid_request", 400, "invalid_json_envelope");
    }
    const envelope = body as Record<string, unknown>;
    const unknown = Object.keys(envelope).find((key) =>
      !["payload", "captcha_token", "honeypot"].includes(key)
    );
    if (unknown) {
      throw new IntakeError("invalid_request", 400, "envelope_unknown_field");
    }
    return {
      payload: envelope.payload,
      captchaToken: typeof envelope.captcha_token === "string"
        ? envelope.captcha_token.trim()
        : "",
      honeypot: typeof envelope.honeypot === "string"
        ? envelope.honeypot.trim()
        : "",
      files: [],
      fileKinds: [],
    };
  }

  throw new IntakeError("invalid_request", 415, "content_type_not_supported");
}

export function validateCaptchaToken(token: string): string {
  if (!token || token.length > 4096 || hasAsciiControlCharacter(token)) {
    throw new IntakeError("captcha_failed", 400, "captcha_token_invalid");
  }
  return token;
}
