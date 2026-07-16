import { corsHeaders } from "./cors.ts";
import { IntakeError, type PublicErrorCode } from "./types.ts";

const securityHeaders: HeadersInit = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...securityHeaders, ...corsHeaders(origin) },
  });
}

export function publicError(
  code: PublicErrorCode,
  status: number,
  origin: string | null,
  requestId: string,
): Response {
  return jsonResponse(
    { ok: false, error: code, request_id: requestId },
    status,
    origin,
  );
}

export function mapError(error: unknown): IntakeError {
  if (error instanceof IntakeError) return error;
  const message = error instanceof Error ? error.message : "unknown_error";
  if (message.includes("provider_intake_link_not_available")) {
    return new IntakeError("link_not_available", 404, "link_not_available");
  }
  if (message.includes("provider_intake_rate_limited")) {
    return new IntakeError("rate_limited", 429, "rate_limited");
  }
  if (message.includes("provider_intake_invalid_amount")) {
    return new IntakeError("invalid_amount", 400, "invalid_amount");
  }
  if (
    message.includes("provider_intake_invalid") ||
    message.includes("unknown_field")
  ) {
    return new IntakeError("invalid_request", 400, "invalid_request");
  }
  return new IntakeError("service_unavailable", 503, "service_unavailable");
}
