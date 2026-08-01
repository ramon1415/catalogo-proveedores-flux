export const AUTH_WINDOW_SECONDS = 300;

export type VerifiedInvocation = {
  keyId: string;
  invocationId: string;
  issuedAt: string;
  requestHash: string;
};

const encoder = new TextEncoder();
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX_64 = /^[0-9a-f]{64}$/;

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

function hexBytes(value: string): Uint8Array | null {
  if (!HEX_64.test(value)) return null;
  return new Uint8Array(
    value.match(/../g)!.map((pair) => Number.parseInt(pair, 16)),
  );
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export function canonicalInvocation(
  method: string,
  pathname: string,
  timestamp: string,
  invocationId: string,
  requestHash: string,
): string {
  return [method.toUpperCase(), pathname, timestamp, invocationId, requestHash]
    .join("\n");
}

export async function hmacSha256Hex(
  key: string,
  value: string,
): Promise<string> {
  const imported = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign("HMAC", imported, encoder.encode(value)),
  );
}

export function constantTimeHexEqual(left: string, right: string): boolean {
  const leftBytes = hexBytes(left);
  const rightBytes = hexBytes(right);
  if (!leftBytes || !rightBytes) return false;
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

export async function verifyInvocation(input: {
  method: string;
  pathname: string;
  rawBody: string;
  headers: Headers;
  expectedKeyId: string;
  key: string;
  nowMs: number;
}): Promise<VerifiedInvocation | null> {
  const keyId = input.headers.get("x-flux-key-id")?.trim() || "";
  const timestamp = input.headers.get("x-flux-timestamp")?.trim() || "";
  const invocationId = input.headers.get("x-flux-invocation-id")?.trim() || "";
  const signature =
    input.headers.get("x-flux-signature")?.trim().toLowerCase() || "";
  if (!input.expectedKeyId || keyId !== input.expectedKeyId || !input.key) {
    return null;
  }
  if (!UUID_V4.test(invocationId) || !/^\d{10}$/.test(timestamp)) return null;
  const timestampMs = Number(timestamp) * 1000;
  if (
    !Number.isSafeInteger(timestampMs) ||
    Math.abs(input.nowMs - timestampMs) > AUTH_WINDOW_SECONDS * 1000
  ) {
    return null;
  }
  const requestHash = await sha256Hex(input.rawBody);
  const canonical = canonicalInvocation(
    input.method,
    input.pathname,
    timestamp,
    invocationId,
    requestHash,
  );
  const expected = await hmacSha256Hex(input.key, canonical);
  if (!constantTimeHexEqual(expected, signature)) return null;
  return {
    keyId,
    invocationId,
    issuedAt: new Date(timestampMs).toISOString(),
    requestHash,
  };
}
