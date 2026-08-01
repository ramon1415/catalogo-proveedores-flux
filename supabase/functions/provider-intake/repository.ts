import type {
  CreateIntakeInput,
  CreateIntakeResult,
  FinalizeSubmissionOutcome,
  IntakeRepository,
  LinkResolution,
  PreparedFile,
  StoredFileMetadata,
  SubmissionStateResult,
} from "./types.ts";

type RepositoryOptions = {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
};

const FINALIZE_TIMEOUT_MS = 10_000;
const OFFICIAL_SUPABASE_HOST = /^[a-z0-9]{20}\.supabase\.co$/;
const FINALIZATION_REJECTION_CODES = new Set([
  "provider_intake_not_finalizable",
  "provider_intake_finalization_fields_invalid",
  "provider_intake_finalization_conflict",
  "provider_intake_finalization_file_count_mismatch",
  "provider_intake_storage_object_missing",
  "provider_intake_upload_issue_present",
  "provider_intake_invalid_file_metadata",
  "provider_intake_file_metadata_conflict",
]);

function safeBaseUrl(value: string): string {
  if (!value || value !== value.trim()) {
    throw new Error("invalid_configuration:SUPABASE_URL");
  }
  const hasExplicitPort = /^https:\/\/[^/?#]+:\d+(?:[/?#]|$)/.test(value);
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("invalid_configuration:SUPABASE_URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    hasExplicitPort ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== "" ||
    !OFFICIAL_SUPABASE_HOST.test(url.hostname)
  ) {
    throw new Error("invalid_configuration:SUPABASE_URL");
  }
  return url.origin;
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
    "provider_intake_not_finalizable",
    "provider_intake_finalization_fields_invalid",
    "provider_intake_finalization_conflict",
    "provider_intake_finalization_file_count_mismatch",
    "provider_intake_storage_object_missing",
    "provider_intake_upload_issue_present",
  ];
  return known.find((code) => message.includes(code)) ||
    "provider_intake_repository_error";
}

function confirmedFinalizationResult(
  value: unknown,
): value is Extract<FinalizeSubmissionOutcome, {
  kind: "RPC_COMPLETED_CONFIRMED";
}>["result"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const completions = ["completed", "already_completed"];
  const notifications = [
    "enqueued",
    "no_recipient",
    "rollout_disabled",
    "event_not_enabled",
    "source_before_cutoff",
    "recipient_not_allowlisted",
    "daily_cap_reached",
    "already_exists",
  ];
  return completions.includes(String(result.completion)) &&
    notifications.includes(String(result.notification));
}

function confirmedFinalizationRejection(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = (value as Record<string, unknown>).message;
  return typeof message === "string" &&
      FINALIZATION_REJECTION_CODES.has(message)
    ? message
    : null;
}

export class SupabaseIntakeRepository implements IntakeRepository {
  private readonly options: RepositoryOptions;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RepositoryOptions) {
    this.baseUrl = safeBaseUrl(options.supabaseUrl);
    if (!options.serviceRoleKey.trim()) {
      throw new Error("missing_required_secret:SUPABASE_SERVICE_ROLE_KEY");
    }
    this.options = options;
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
    return this.rpc("resolve_provider_intake_link_internal", {
      p_token_hash: tokenHash,
    });
  }

  createIntake(input: CreateIntakeInput): Promise<CreateIntakeResult> {
    return this.rpc("create_provider_intake_internal", {
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

  async finalizeSubmission(
    intakeId: string,
    expectedFileCount: number,
    files: StoredFileMetadata[],
  ): Promise<FinalizeSubmissionOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FINALIZE_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/rest/v1/rpc/finalize_provider_intake_submission_v1`,
        {
          method: "POST",
          headers: this.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            p_payment_intake_id: intakeId,
            p_expected_file_count: expectedFileCount,
            p_files: files,
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          return { kind: "RPC_OUTCOME_UNKNOWN" };
        }
        const body = await response.json();
        const safeCode = confirmedFinalizationRejection(body);
        if (!safeCode) {
          return { kind: "RPC_OUTCOME_UNKNOWN" };
        }
        return {
          kind: "RPC_REJECTED_CONFIRMED",
          safeCode,
        };
      }

      const result = await response.json();
      return confirmedFinalizationResult(result)
        ? { kind: "RPC_COMPLETED_CONFIRMED", result }
        : { kind: "RPC_OUTCOME_UNKNOWN" };
    } catch {
      return { kind: "RPC_OUTCOME_UNKNOWN" };
    } finally {
      clearTimeout(timeout);
    }
  }

  getSubmissionState(intakeId: string): Promise<SubmissionStateResult> {
    return this.rpc("provider_intake_submission_state_v1", {
      p_payment_intake_id: intakeId,
    });
  }

  async markUploadIssue(intakeId: string, issueCode: string): Promise<void> {
    await this.rpc("mark_provider_intake_upload_issue_internal", {
      p_payment_intake_id: intakeId,
      p_issue_code: issueCode,
    });
  }
}
