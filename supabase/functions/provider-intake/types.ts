export const ALLOWED_PAYLOAD_FIELDS = [
  "provider_name",
  "provider_rfc",
  "provider_email",
  "provider_phone",
  "concept",
  "description",
  "amount_requested",
  "currency",
  "requested_payment_date",
  "invoice_folio",
  "invoice_uuid",
  "invoice_date",
  "bank_name",
  "bank_account",
  "bank_clabe",
  "beneficiary_name",
] as const;

export type IntakePayloadField = typeof ALLOWED_PAYLOAD_FIELDS[number];

export type IntakePayload = {
  provider_name: string;
  provider_rfc?: string;
  provider_email: string;
  provider_phone?: string;
  concept: string;
  description?: string;
  amount_requested: number;
  currency: string;
  requested_payment_date?: string;
  invoice_folio?: string;
  invoice_uuid?: string;
  invoice_date?: string;
  bank_name?: string;
  bank_account?: string;
  bank_clabe?: string;
  beneficiary_name?: string;
};

export type IntakeConfig = {
  allowedOrigins: string[];
  allowNoOrigin: boolean;
  maxFiles: number;
  maxTotalMb: number;
  maxTotalBytes: number;
  maxAmount: number;
  allowedCurrencies: string[];
  privacyNoticeUrl: string;
  fingerprintWindowSeconds: number;
};

export type LinkResolution = {
  intake_link_id: string;
  company_id: string;
  company_display_name: string;
  max_file_mb: number;
  max_submissions_per_day: number;
  allowed_file_types: string[];
};

export type CreateIntakeInput = {
  tokenHash: string;
  submission: IntakePayload;
  submissionFingerprint: string;
  idempotencyKeyHash: string;
  clientIpHash: string | null;
  userAgentHash: string | null;
  captchaProvider: string;
  fingerprintWindowSeconds: number;
};

export type CreateIntakeResult = {
  payment_intake_id: string;
  public_folio: string;
  status: "received";
  duplicate: boolean;
};

export type PreparedFile = {
  fileId: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  fileKind: string;
  sha256: string;
  bytes: Uint8Array;
};

export type StoredFileMetadata = {
  file_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  file_kind: string;
  sha256: string;
};

export type SubmitEnvelope = {
  payload: unknown;
  captchaToken: string;
  honeypot: string;
  files: File[];
  fileKinds: unknown;
};

export type CaptchaVerificationInput = {
  token: string;
  remoteIp?: string;
};

export type CaptchaVerifier = {
  provider: string;
  verify(input: CaptchaVerificationInput): Promise<boolean>;
};

export type IntakeRepository = {
  resolveLink(tokenHash: string): Promise<LinkResolution>;
  createIntake(input: CreateIntakeInput): Promise<CreateIntakeResult>;
  uploadFile(file: PreparedFile): Promise<void>;
  removeUploadedFiles(paths: string[]): Promise<void>;
  attachFiles(intakeId: string, files: StoredFileMetadata[]): Promise<void>;
  markUploadIssue(intakeId: string, issueCode: string): Promise<void>;
};

export type PublicErrorCode =
  | "link_not_available"
  | "invalid_request"
  | "captcha_failed"
  | "rate_limited"
  | "payload_too_large"
  | "file_type_not_allowed"
  | "invalid_amount"
  | "invalid_email"
  | "submit_failed"
  | "service_unavailable";

export class IntakeError extends Error {
  readonly code: PublicErrorCode;
  readonly status: number;
  readonly internalCode: string;

  constructor(
    code: PublicErrorCode,
    status: number,
    internalCode: string,
  ) {
    super(internalCode);
    this.code = code;
    this.status = status;
    this.internalCode = internalCode;
  }
}
