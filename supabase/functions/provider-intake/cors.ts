import { type IntakeConfig, IntakeError } from "./types.ts";

export function parseAllowedOrigins(raw: string): string[] {
  const origins = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const unique = new Set<string>();
  for (const origin of origins) {
    if (origin === "*") {
      throw new Error("invalid_configuration:INTAKE_ALLOWED_ORIGINS");
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("invalid_configuration:INTAKE_ALLOWED_ORIGINS");
    }
    if (
      parsed.protocol !== "https:" || parsed.origin !== origin ||
      parsed.username || parsed.password
    ) {
      throw new Error("invalid_configuration:INTAKE_ALLOWED_ORIGINS");
    }
    unique.add(origin);
  }
  return [...unique];
}

export function validateOrigin(
  req: Request,
  config: IntakeConfig,
): string | null {
  const origin = req.headers.get("origin");
  if (!origin) {
    if (!config.allowNoOrigin) {
      throw new IntakeError("invalid_request", 403, "origin_required");
    }
    return null;
  }
  if (!config.allowedOrigins.includes(origin)) {
    throw new IntakeError("invalid_request", 403, "origin_not_allowed");
  }
  return origin;
}

export function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "Content-Type, X-Intake-Token, Idempotency-Key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
