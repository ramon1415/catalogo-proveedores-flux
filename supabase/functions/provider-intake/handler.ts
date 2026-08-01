import { corsHeaders, validateOrigin } from "./cors.ts";
import { hmacSha256Hex, sha256Hex, stableCanonicalString } from "./crypto.ts";
import { prepareStorageFiles, validateIncomingFiles } from "./files.ts";
import { jsonResponse, mapError, publicError } from "./responses.ts";
import {
  type CaptchaVerifier,
  type IntakeConfig,
  IntakeError,
  type IntakePayload,
  type IntakeRepository,
  type LinkResolution,
  type StoredFileMetadata,
} from "./types.ts";
import {
  idempotencyKey,
  intakeToken,
  readSubmitEnvelope,
  validateCaptchaToken,
  validatePayload,
} from "./validation.ts";

type HandlerDependencies = {
  config: IntakeConfig;
  repository: IntakeRepository;
  captcha: CaptchaVerifier;
  hashPepper: string;
  now?: () => number;
  logger?: (entry: Record<string, unknown>) => void;
};

function routeName(url: URL): "link-info" | "submit" | "unknown" {
  if (url.pathname.endsWith("/provider-intake/link-info")) return "link-info";
  if (url.pathname.endsWith("/provider-intake/submit")) return "submit";
  return "unknown";
}

function clientIp(req: Request): string | undefined {
  const direct = req.headers.get("cf-connecting-ip")?.trim();
  if (direct) return direct;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || undefined;
}

function fingerprintSource(linkId: string, payload: IntakePayload): string {
  const entries = Object.entries(payload)
    .filter((entry): entry is [string, string | number] =>
      entry[1] !== undefined
    )
    .map(([key, value]) => [key, String(value)] as [string, string])
    .sort(([left], [right]) => left.localeCompare(right));
  return stableCanonicalString([["intake_link", linkId], ...entries]);
}

function storedMetadata(
  files: ReturnType<typeof prepareStorageFiles>,
): StoredFileMetadata[] {
  return files.map((file) => ({
    file_id: file.fileId,
    storage_path: file.storagePath,
    original_filename: file.originalFilename,
    mime_type: file.mimeType,
    size_bytes: file.sizeBytes,
    file_kind: file.fileKind,
    sha256: file.sha256,
  }));
}

async function enforceRequestSize(
  req: Request,
  maxTotalBytes: number,
): Promise<void> {
  const rawContentLength = req.headers.get("content-length");
  if (rawContentLength) {
    const contentLength = Number(rawContentLength);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw new IntakeError("invalid_request", 400, "content_length_invalid");
    }
    if (contentLength > maxTotalBytes) {
      throw new IntakeError("payload_too_large", 413, "request_too_large");
    }
    return;
  }

  const requestBytes = (await req.clone().arrayBuffer()).byteLength;
  if (requestBytes > maxTotalBytes) {
    throw new IntakeError("payload_too_large", 413, "request_too_large");
  }
}

async function markIssueBestEffort(
  repository: IntakeRepository,
  intakeId: string,
  issueCode: string,
): Promise<void> {
  try {
    await repository.markUploadIssue(intakeId, issueCode);
  } catch {
    // The public response stays generic; operational reconciliation uses the request_id log.
  }
}

async function cleanupBestEffort(
  repository: IntakeRepository,
  intakeId: string,
  paths: string[],
  preferredIssue: string,
): Promise<void> {
  let issue = preferredIssue;
  try {
    await repository.removeUploadedFiles(paths);
  } catch {
    issue = "storage_cleanup_failed";
  }
  await markIssueBestEffort(repository, intakeId, issue);
}

export function createProviderIntakeHandler(dependencies: HandlerDependencies) {
  const now = dependencies.now || Date.now;
  const logger = dependencies.logger ||
    ((entry: Record<string, unknown>) => console.info(JSON.stringify(entry)));
  if (!dependencies.hashPepper.trim()) {
    throw new Error("missing_required_secret:INTAKE_HASH_PEPPER");
  }

  return async (req: Request): Promise<Response> => {
    const startedAt = now();
    const requestId = crypto.randomUUID();
    const route = routeName(new URL(req.url));
    let origin: string | null = null;
    let statusCode = 500;
    let outcome = "failed";
    let internalErrorCode = "none";
    let fileCount = 0;
    let duplicate = false;

    try {
      origin = validateOrigin(req, dependencies.config);

      if (req.method === "OPTIONS") {
        statusCode = 204;
        outcome = "preflight";
        return new Response(null, {
          status: statusCode,
          headers: {
            ...corsHeaders(origin),
            "Cache-Control": "no-store",
            "Content-Security-Policy":
              "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      if (route === "unknown") {
        throw new IntakeError("invalid_request", 404, "route_not_found");
      }
      if (route === "link-info" && req.method !== "GET") {
        throw new IntakeError("invalid_request", 405, "method_not_allowed");
      }
      if (route === "submit" && req.method !== "POST") {
        throw new IntakeError("invalid_request", 405, "method_not_allowed");
      }

      if (route === "submit") {
        await enforceRequestSize(req, dependencies.config.maxTotalBytes);
      }

      const tokenHash = await sha256Hex(intakeToken(req));
      let link: LinkResolution;
      try {
        link = await dependencies.repository.resolveLink(tokenHash);
      } catch (error) {
        const mapped = mapError(error);
        if (mapped.code === "link_not_available") throw mapped;
        throw new IntakeError(
          "service_unavailable",
          503,
          "link_repository_unavailable",
        );
      }

      if (route === "link-info") {
        statusCode = 200;
        outcome = "link_available";
        return jsonResponse(
          {
            ok: true,
            company: { display_name: link.company_display_name },
            link: {
              max_file_mb: link.max_file_mb,
              max_files: dependencies.config.maxFiles,
              max_total_mb: dependencies.config.maxTotalMb,
              allowed_file_types: link.allowed_file_types,
            },
            privacy_notice: { url: dependencies.config.privacyNoticeUrl },
          },
          statusCode,
          origin,
        );
      }

      const envelope = await readSubmitEnvelope(req);
      fileCount = envelope.files.length;
      if (envelope.honeypot) {
        throw new IntakeError("invalid_request", 400, "honeypot_triggered");
      }

      const payload = validatePayload(envelope.payload, dependencies.config);
      const captchaToken = validateCaptchaToken(envelope.captchaToken);
      const remoteIp = clientIp(req);
      const captchaOk = await dependencies.captcha.verify({
        token: captchaToken,
        remoteIp,
      });
      if (!captchaOk) {
        throw new IntakeError("captcha_failed", 400, "captcha_failed");
      }

      const validatedFiles = await validateIncomingFiles(
        envelope.files,
        envelope.fileKinds,
        link,
        dependencies.config,
      );

      const submissionFingerprint = await hmacSha256Hex(
        dependencies.hashPepper,
        `submission:${fingerprintSource(link.intake_link_id, payload)}`,
      );
      const suppliedIdempotencyKey = idempotencyKey(req);
      const bucket = Math.floor(
        now() / (dependencies.config.fingerprintWindowSeconds * 1000),
      );
      const idempotencyKeyHash = await hmacSha256Hex(
        dependencies.hashPepper,
        suppliedIdempotencyKey
          ? `idempotency:${suppliedIdempotencyKey}`
          : `derived:${submissionFingerprint}:${bucket}`,
      );
      const clientIpHash = remoteIp
        ? await hmacSha256Hex(dependencies.hashPepper, `ip:${remoteIp}`)
        : null;
      const userAgent = req.headers.get("user-agent")?.trim();
      const userAgentHash = userAgent
        ? await hmacSha256Hex(dependencies.hashPepper, `ua:${userAgent}`)
        : null;

      const created = await dependencies.repository.createIntake({
        tokenHash,
        submission: payload,
        submissionFingerprint,
        idempotencyKeyHash,
        clientIpHash,
        userAgentHash,
        captchaProvider: dependencies.captcha.provider,
        fingerprintWindowSeconds: dependencies.config.fingerprintWindowSeconds,
      });
      duplicate = created.duplicate;

      if (!created.duplicate) {
        const storageFiles = prepareStorageFiles(
          validatedFiles,
          created.payment_intake_id,
        );
        const uploadedPaths: string[] = [];
        try {
          for (const file of storageFiles) {
            await dependencies.repository.uploadFile(file);
            uploadedPaths.push(file.storagePath);
          }
        } catch {
          await cleanupBestEffort(
            dependencies.repository,
            created.payment_intake_id,
            uploadedPaths,
            "storage_upload_failed",
          );
          throw new IntakeError("submit_failed", 503, "storage_upload_failed");
        }

        try {
          await dependencies.repository.finalizeSubmission(
            created.payment_intake_id,
            storageFiles.length,
            storedMetadata(storageFiles),
          );
        } catch {
          await cleanupBestEffort(
            dependencies.repository,
            created.payment_intake_id,
            uploadedPaths,
            "file_metadata_failed",
          );
          throw new IntakeError(
            "submit_failed",
            503,
            "submission_finalization_failed",
          );
        }
      }

      statusCode = created.duplicate ? 200 : 201;
      outcome = created.duplicate ? "duplicate" : "created";
      return jsonResponse(
        {
          ok: true,
          public_folio: created.public_folio,
          status: "received",
          duplicate: created.duplicate,
          message: created.duplicate
            ? "Esta solicitud ya habia sido recibida."
            : "Solicitud recibida correctamente.",
        },
        statusCode,
        origin,
      );
    } catch (error) {
      const mapped = mapError(error);
      statusCode = mapped.status;
      internalErrorCode = mapped.internalCode;
      outcome = "rejected";
      return publicError(mapped.code, mapped.status, origin, requestId);
    } finally {
      logger({
        request_id: requestId,
        route,
        method: req.method,
        outcome,
        status_code: statusCode,
        duration_ms: Math.max(0, now() - startedAt),
        file_count: fileCount,
        duplicate,
        error_code: internalErrorCode,
      });
    }
  };
}
