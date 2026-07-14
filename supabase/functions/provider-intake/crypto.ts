const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const input = typeof value === "string" ? encoder.encode(value) : value;
  const buffer = input.slice().buffer as ArrayBuffer;
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)));
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export function stableCanonicalString(entries: Array<[string, string]>): string {
  return entries.map(([key, value]) => `${key.length}:${key}:${value.length}:${value}`).join("|");
}
