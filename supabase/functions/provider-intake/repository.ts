import type {
  CreateIntakeInput,
  CreateIntakeResult,
  IntakeRepository,
  LinkResolution,
  PreparedFile,
  StoredFileMetadata,
} from "./types.ts";

type RepositoryOptions = {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
};

function safeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("invalid_configuration:SUPABASE_URL");
  }
  return url.toString().replace(/\/$/, "");
}

function knownRpcError(message: string): string {
  const known = [
    "provider_intake_link_not_available",
    "provider_intake_rate_limited",
    "provider_intake_invalid_amount",
    "provider_intake_invalid_submission",
    "provider_intake_unknown_field",
    "provider_intake_invalid_files",
    "provider_intake_invalid_file_metadata",
    "provider_intake_file_metadata_conflict",
    "provider_intake_not_attachable",
    "provider_intake_bank_confirmation_not_allowed",
    "provider_intake_bank_confirmation_required",
    "provider_intake_master_bank_values_not_allowed",
    "provider_intake_bank_change_fields_required",
  ];
  return known.find((code) => message.includes(code)) ||
    "provider_intake_repository_error";
}

export class SupabaseIntakeRepository implements IntakeRepository {
  private readonly options: RepositoryOptions;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RepositoryOptions) {
    this.options = options;
    this.baseUrl = safeBaseUrl(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) {
      throw new Error("missing_required_secret:SUPABASE_SERVICE_ROLE_KEY");
    }
    this.fetchImpl = options.fetchImpl || fetch;
  }

  private headers(extra: HeadersInit = {}): HeadersInit {
    return {
      "Authorization": `Bearer ${this.options.serviceRoleKey}`,
      "apikey": this.options.serviceRoleKey,
      ...extra,
    };
  }

  private async rpc<T>(
    name: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/rest/v1/rpc/${name}`,
      {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      let message = "";
      try {
        const parsed = await response.json() as { message?: string };
        message = parsed.message || "";
      } catch {
        message = "";
      }
      throw new Error(knownRpcError(message));
    }
    return await response.json() as T;
  }

  resolveLink(tokenHash: string): Promise<LinkResolution> {
    return this.rpc("resolve_provider_aware_intake_link_internal", {
      p_token_hash: tokenHash,
    });
  }

  createIntake(input: CreateIntakeInput): Promise<CreateIntakeResult> {
    return this.rpc("create_provider_aware_intake_internal", {
      p_token_hash: input.tokenHash,
      p_submission: input.submission,
      p_submission_fingerprint: input.submissionFingerprint,
      p_idempotency_key_hash: input.idempotencyKeyHash,
      p_client_ip_hash: input.clientIpHash,
      p_user_agent_hash: input.userAgentHash,
      p_captcha_provider: input.captchaProvider,
      p_fingerprint_window_seconds: input.fingerprintWindowSeconds,
    });
  }

  async uploadFile(file: PreparedFile): Promise<void> {
    const encodedPath = file.storagePath.split("/").map(encodeURIComponent)
      .join("/");
    const response = await this.fetchImpl(
      `${this.baseUrl}/storage/v1/object/intake-uploads/${encodedPath}`,
      {
        method: "POST",
        headers: this.headers({
          "Content-Type": file.mimeType,
          "x-upsert": "false",
        }),
        body: file.bytes.slice().buffer as ArrayBuffer,
      },
    );
    if (!response.ok) throw new Error("provider_intake_storage_upload_failed");
  }

  async removeUploadedFiles(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const response = await this.fetchImpl(
      `${this.baseUrl}/storage/v1/object/intake-uploads`,
      {
        method: "DELETE",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ prefixes: paths }),
      },
    );
    if (!response.ok) throw new Error("provider_intake_storage_cleanup_failed");
  }

  async attachFiles(
    intakeId: string,
    files: StoredFileMetadata[],
  ): Promise<void> {
    await this.rpc("attach_provider_intake_files_internal", {
      p_payment_intake_id: intakeId,
      p_files: files,
    });
  }

  async markUploadIssue(intakeId: string, issueCode: string): Promise<void> {
    await this.rpc("mark_provider_intake_upload_issue_internal", {
      p_payment_intake_id: intakeId,
      p_issue_code: issueCode,
    });
  }
}
