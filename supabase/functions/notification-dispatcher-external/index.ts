import {
  validHmacConfiguration,
  type VerifiedInvocation,
  verifyInvocation,
} from "./auth.ts";
import { renderExternalEmail } from "./renderer.ts";

export const EXTERNAL_WORKER_ID = "external-notification-dispatcher-v1";
export const MAX_DISPATCHER_BODY_BYTES = 64;
export const SAFE_CODES = Object.freeze(
  [
    "external_disabled",
    "external_mode_mismatch",
    "request_not_authorized",
    "request_contract_invalid",
    "replay_detected",
    "provider_rate_limited",
    "provider_server_error",
    "provider_timeout_unknown",
    "provider_auth_failed",
    "provider_contract_rejected",
    "provider_network_unavailable",
    "provider_response_invalid",
    "renderer_contract_failed",
    "manual_review_required",
  ] as const,
);

type SafeCode = typeof SAFE_CODES[number];
type ExternalMode = "disabled" | "test_only" | "pilot";

type ClaimedEvent = {
  id: string;
  event_type: string;
  recipient_email: string;
  payload: Record<string, unknown>;
};

type AttemptReservation = {
  attempt_number: number;
  provider_idempotency_key: string;
};

export type ExternalFailureResult = {
  result: "pending" | "dead_letter";
  retryable: boolean;
  manual_review_required: boolean;
  circuit_breaker_required: boolean;
};

export type ExternalRepository = {
  rolloutMode(): Promise<string>;
  registerInvocation(
    invocation: VerifiedInvocation,
  ): Promise<"registered" | "replay_detected">;
  claim(): Promise<ClaimedEvent[]>;
  reserve(eventId: string): Promise<AttemptReservation>;
  started(eventId: string, attemptNumber: number): Promise<void>;
  sent(
    eventId: string,
    attemptNumber: number,
    providerMessageId: string,
  ): Promise<"sent" | "already_sent">;
  failed(
    eventId: string,
    attemptNumber: number,
    safeCode: SafeCode,
  ): Promise<ExternalFailureResult>;
};

export type SendInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

type Dependencies = {
  mode: ExternalMode;
  keyId: string;
  hmacKey: string;
  repository: ExternalRepository;
  send: (input: SendInput) => Promise<string>;
  now?: () => number;
  logger?: (entry: Record<string, unknown>) => void;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function parseDispatcherBody(rawBody: string): boolean {
  return rawBody === '{"limit":1}';
}

export function validDispatcherContentType(value: string | null): boolean {
  return value !== null &&
    /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(value);
}

export async function readBoundedBody(
  request: Request,
  maximumBytes = MAX_DISPATCHER_BODY_BYTES,
): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) return null;
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length > maximumBytes) return null;
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function durationBucket(durationMs: number): string {
  if (durationMs < 250) return "lt_250ms";
  if (durationMs < 1000) return "lt_1s";
  if (durationMs < 5000) return "lt_5s";
  return "gte_5s";
}

export function classifyProviderFailure(
  status: number,
  failure: unknown,
): SafeCode {
  if (failure instanceof DOMException && failure.name === "AbortError") {
    return "provider_timeout_unknown";
  }
  if (failure instanceof TypeError) return "provider_network_unavailable";
  if (status === 429) return "provider_rate_limited";
  if (status === 401 || status === 403) return "provider_auth_failed";
  if (status >= 500) return "provider_server_error";
  if (status >= 400) return "provider_contract_rejected";
  return "provider_response_invalid";
}

export function validateFailureResult(
  safeCode: SafeCode,
  result: ExternalFailureResult,
): boolean {
  const manualReviewExpected = [
    "provider_timeout_unknown",
    "provider_response_invalid",
    "manual_review_required",
  ].includes(safeCode);
  const circuitBreakerExpected = safeCode === "provider_auth_failed";
  return ["pending", "dead_letter"].includes(result.result) &&
    typeof result.retryable === "boolean" &&
    result.manual_review_required === manualReviewExpected &&
    result.circuit_breaker_required === circuitBreakerExpected &&
    (!circuitBreakerExpected || result.result === "dead_letter");
}

export function createExternalDispatcherHandler(dependencies: Dependencies) {
  const now = dependencies.now || Date.now;
  const logger = dependencies.logger ||
    ((entry) => console.info(JSON.stringify(entry)));

  return async (request: Request): Promise<Response> => {
    const startedAt = now();
    let processed = 0;
    let sent = 0;
    let failed = 0;
    const codes: SafeCode[] = [];

    const finish = (response: Response): Response => {
      logger({
        outcome: codes[0] || (sent ? "sent" : "empty"),
        safe_error_code: codes[0] || "none",
        processed_count: processed,
        sent_count: sent,
        failed_count: failed,
        duration_bucket: durationBucket(Math.max(0, now() - startedAt)),
      });
      return response;
    };

    if (request.method !== "POST") {
      codes.push("request_contract_invalid");
      return finish(json({ processed: 0, sent: 0, failed: 0, codes }, 405));
    }
    if (!validDispatcherContentType(request.headers.get("content-type"))) {
      codes.push("request_contract_invalid");
      return finish(json({ processed: 0, sent: 0, failed: 0, codes }, 415));
    }
    const rawBody = await readBoundedBody(request);
    if (rawBody === null) {
      codes.push("request_contract_invalid");
      return finish(json({ processed: 0, sent: 0, failed: 0, codes }, 413));
    }
    if (!parseDispatcherBody(rawBody)) {
      codes.push("request_contract_invalid");
      return finish(json({ processed: 0, sent: 0, failed: 0, codes }, 400));
    }
    if (dependencies.mode === "disabled") {
      codes.push("external_disabled");
      return finish(json({ processed: 0, sent: 0, failed: 0, codes }));
    }

    const url = new URL(request.url);
    const invocation = await verifyInvocation({
      method: request.method,
      pathname: url.pathname,
      rawBody,
      headers: request.headers,
      expectedKeyId: dependencies.keyId,
      key: dependencies.hmacKey,
      nowMs: now(),
    });
    if (!invocation) {
      codes.push("request_not_authorized");
      return finish(json({ processed: 0, sent: 0, failed: 0, codes }, 401));
    }

    let dbMode: string;
    try {
      dbMode = await dependencies.repository.rolloutMode();
    } catch {
      codes.push("external_mode_mismatch");
      return finish(json({ processed: 0, sent: 0, failed: 0, codes }, 503));
    }
    if (
      dbMode !== dependencies.mode || !["test_only", "pilot"].includes(dbMode)
    ) {
      codes.push("external_mode_mismatch");
      return finish(json({ processed: 0, sent: 0, failed: 0, codes }));
    }

    try {
      const registration = await dependencies.repository.registerInvocation(
        invocation,
      );
      if (registration !== "registered") {
        codes.push("request_not_authorized");
        return finish(json({ processed: 0, sent: 0, failed: 0, codes }, 401));
      }

      const events = await dependencies.repository.claim();
      if (events.length === 0) {
        return finish(json({ processed: 0, sent: 0, failed: 0, codes }));
      }
      const event = events[0];
      processed = 1;
      const reservation = await dependencies.repository.reserve(event.id);

      let rendered;
      try {
        rendered = renderExternalEmail(event.event_type, event.payload);
      } catch {
        codes.push("renderer_contract_failed");
        failed = 1;
        const failureResult = await dependencies.repository.failed(
          event.id,
          reservation.attempt_number,
          "renderer_contract_failed",
        );
        if (!validateFailureResult("renderer_contract_failed", failureResult)) {
          throw new Error("failure_result_contract_invalid");
        }
        return finish(json({ processed, sent, failed, codes }));
      }

      await dependencies.repository.started(
        event.id,
        reservation.attempt_number,
      );
      let providerMessageId: string;
      try {
        providerMessageId = await dependencies.send({
          to: event.recipient_email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          idempotencyKey: reservation.provider_idempotency_key,
        });
      } catch (error) {
        const safeCode = error instanceof ProviderError
          ? error.safeCode
          : classifyProviderFailure(0, error);
        codes.push(safeCode);
        failed = 1;
        const failureResult = await dependencies.repository.failed(
          event.id,
          reservation.attempt_number,
          safeCode,
        );
        if (!validateFailureResult(safeCode, failureResult)) {
          throw new Error("failure_result_contract_invalid");
        }
        if (failureResult.manual_review_required) {
          codes.push("manual_review_required");
        }
        return finish(json({ processed, sent, failed, codes }));
      }

      let sentAcknowledged = false;
      for (let acknowledgement = 0; acknowledgement < 2; acknowledgement += 1) {
        try {
          const result = await dependencies.repository.sent(
            event.id,
            reservation.attempt_number,
            providerMessageId,
          );
          if (result !== "sent" && result !== "already_sent") {
            throw new Error("sent_result_contract_invalid");
          }
          sentAcknowledged = true;
          break;
        } catch {
          // Retry only the same DB acknowledgement. Resend is never called again.
        }
      }
      if (!sentAcknowledged) {
        codes.push("manual_review_required");
        failed = 1;
        return finish(json({ processed, sent, failed, codes }, 503));
      }
      sent = 1;
      return finish(json({ processed, sent, failed, codes }));
    } catch {
      codes.push("manual_review_required");
      failed = processed ? 1 : 0;
      return finish(json({ processed, sent, failed, codes }, 503));
    }
  };
}

export class ProviderError extends Error {
  constructor(readonly safeCode: SafeCode) {
    super(safeCode);
  }
}

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_configuration:${name}`);
  return value;
}

function requiredExact(name: string): string {
  const value = Deno.env.get(name);
  if (!value || value !== value.trim()) {
    throw new Error(`invalid_configuration:${name}`);
  }
  return value;
}

export function normalizeSupabaseUrl(value: string): string {
  if (!value || value !== value.trim()) {
    throw new Error("invalid_configuration:SUPABASE_URL");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_configuration:SUPABASE_URL");
  }
  if (
    url.protocol !== "https:" || url.username || url.password || url.port ||
    url.search || url.hash || !["", "/"].includes(url.pathname) ||
    !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname)
  ) {
    throw new Error("invalid_configuration:SUPABASE_URL");
  }
  return url.origin;
}

function externalMode(): ExternalMode {
  const value = (Deno.env.get("NOTIFICATION_EXTERNAL_SEND_MODE") || "disabled")
    .trim();
  return value === "test_only" || value === "pilot" ? value : "disabled";
}

function supabaseRepository(
  url: string,
  serviceRoleKey: string,
): ExternalRepository {
  const rpc = async <T>(
    name: string,
    body: Record<string, unknown> = {},
  ): Promise<T> => {
    const response = await fetch(
      `${url}/rest/v1/rpc/${name}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceRoleKey}`,
          "apikey": serviceRoleKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) throw new Error("repository_unavailable");
    return await response.json() as T;
  };
  return {
    rolloutMode: () => rpc<string>("get_external_notification_rollout_mode"),
    registerInvocation: (invocation) =>
      rpc("register_external_notification_dispatch_invocation", {
        p_key_id: invocation.keyId,
        p_invocation_id: invocation.invocationId,
        p_request_hash: invocation.requestHash,
        p_issued_at: invocation.issuedAt,
      }),
    claim: () =>
      rpc("claim_external_notification_events_for_dispatcher", {
        p_limit: 1,
        p_worker_id: EXTERNAL_WORKER_ID,
      }),
    reserve: (eventId) =>
      rpc("reserve_external_notification_attempt", {
        p_notification_event_id: eventId,
        p_worker_id: EXTERNAL_WORKER_ID,
      }),
    started: async (eventId, attemptNumber) => {
      await rpc("mark_external_provider_request_started", {
        p_notification_event_id: eventId,
        p_attempt_number: attemptNumber,
        p_worker_id: EXTERNAL_WORKER_ID,
      });
    },
    sent: (eventId, attemptNumber, providerMessageId) =>
      rpc("mark_external_notification_sent", {
        p_notification_event_id: eventId,
        p_attempt_number: attemptNumber,
        p_worker_id: EXTERNAL_WORKER_ID,
        p_provider_message_id: providerMessageId,
      }),
    failed: (eventId, attemptNumber, safeCode) =>
      rpc("mark_external_notification_failed", {
        p_notification_event_id: eventId,
        p_attempt_number: attemptNumber,
        p_worker_id: EXTERNAL_WORKER_ID,
        p_safe_error_code: safeCode,
      }),
  };
}

export function resendRequestInit(
  input: SendInput,
  apiKey: string,
  from: string,
): RequestInit {
  return {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  };
}

async function resendSender(input: SendInput): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      ...resendRequestInit(
        input,
        required("RESEND_API_KEY"),
        required("NOTIFICATION_FROM_EMAIL"),
      ),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ProviderError(classifyProviderFailure(0, error));
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new ProviderError(classifyProviderFailure(response.status, null));
  }
  let parsed: { id?: string };
  try {
    parsed = await response.json();
  } catch {
    throw new ProviderError("provider_response_invalid");
  }
  if (!parsed.id || typeof parsed.id !== "string" || parsed.id.length > 255) {
    throw new ProviderError("provider_response_invalid");
  }
  return parsed.id;
}

if (import.meta.main) {
  const mode = externalMode();
  let handler: (request: Request) => Promise<Response>;
  if (mode === "disabled") {
    handler = createExternalDispatcherHandler({
      mode,
      keyId: "",
      hmacKey: "",
      repository: {} as ExternalRepository,
      send: resendSender,
    });
  } else {
    const keyId = requiredExact("NOTIFICATION_EXTERNAL_DISPATCHER_HMAC_KEY_ID");
    const hmacKey = requiredExact("NOTIFICATION_EXTERNAL_DISPATCHER_HMAC_KEY");
    if (!validHmacConfiguration(keyId, hmacKey)) {
      throw new Error(
        "invalid_configuration:NOTIFICATION_EXTERNAL_DISPATCHER_HMAC",
      );
    }
    handler = createExternalDispatcherHandler({
      mode,
      keyId,
      hmacKey,
      repository: supabaseRepository(
        normalizeSupabaseUrl(requiredExact("SUPABASE_URL")),
        required("SUPABASE_SERVICE_ROLE_KEY"),
      ),
      send: resendSender,
    });
  }
  Deno.serve(handler);
}
