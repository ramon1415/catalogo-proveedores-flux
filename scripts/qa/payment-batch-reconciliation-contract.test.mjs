import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(root, "comprobantes_batch.html"), "utf8");
const client = readFileSync(join(root, "comprobantes_batch.js"), "utf8");

test("the browser uses RPC contracts instead of direct financial table writes", () => {
  assert.doesNotMatch(
    client,
    /\.from\s*\(\s*["'`](bank_payment_operations|payable_snapshots|financial_command_receipts|financial_outbox_events|payment_receipts)["'`]\s*\)\s*\.\s*(insert|update|upsert|delete)/i,
  );
  assert.doesNotMatch(client, /\bservice_role\b/i);
  assert.match(client, /\.rpc\s*\(/i);
});

test("the UI keeps extraction review separate from payment linking", () => {
  assert.match(html, /id=["']acceptExtractionBtn["']/i);
  assert.match(html, /id=["']openCorrectionBtn["']/i);
  assert.match(html, /id=["']findCandidatesBtn["']/i);
  assert.match(html, /id=["']confirmOperationBtn["']/i);
});

test("the base client does not expose secrets or privileged credentials", () => {
  assert.doesNotMatch(
    `${html}\n${client}`,
    /(SUPABASE_SERVICE_ROLE_KEY|postgres(?:ql)?:\/\/|BEGIN PRIVATE KEY)/i,
  );
});
