import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migration032 = readFileSync(
  join(root, "supabase", "migrations", "032_payment_batch_reconciliation.sql"),
  "utf8",
);
const html = readFileSync(join(root, "comprobantes_batch.html"), "utf8");
const client = readFileSync(join(root, "comprobantes_batch.js"), "utf8");

function normalizedFunctionSignatures(sql) {
  const signatures = [];
  const pattern =
    /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*returns/gi;
  let match;

  while ((match = pattern.exec(sql)) !== null) {
    signatures.push(
      `${match[1]}(${match[2].replace(/\s+/g, " ").trim().toLowerCase()})`,
    );
  }

  return signatures;
}

test("032 remains the immutable base migration for batch reconciliation", () => {
  assert.match(
    migration032,
    /create table public\.payment_document_extractions/i,
  );
  assert.match(migration032, /create table public\.bank_payment_operations/i);
  assert.match(migration032, /create table public\.payable_snapshots/i);
});

test("032 contains no destructive reset of financial data", () => {
  assert.doesNotMatch(migration032, /\b(drop|truncate)\s+(table|schema)\b/i);
  assert.doesNotMatch(migration032, /\bdelete\s+from\s+public\.payment_receipts\b/i);
});

test("document extraction lifecycle is guarded in the database", () => {
  assert.match(
    migration032,
    /review_required[\s\S]*accepted[\s\S]*rejected[\s\S]*blocked/i,
  );
  assert.match(
    migration032,
    /accept_payment_document_extraction[\s\S]*for update/i,
  );
});

test("accepted extraction creates the canonical bank operation from accepted facts", () => {
  assert.match(migration032, /accept_payment_document_extraction/i);
  assert.match(migration032, /insert into public\.bank_payment_operations/i);
  assert.match(migration032, /amount_minor/i);
  assert.match(migration032, /currency/i);
  assert.match(migration032, /(bank_reference|reference)/i);
});

test("bank operations have deterministic duplicate protection beyond the PDF hash", () => {
  assert.match(
    migration032,
    /bank_payment_operations[\s\S]*(fingerprint|operation_fingerprint)/i,
  );
  assert.match(
    migration032,
    /unique[\s\S]*(fingerprint|operation_fingerprint)/i,
  );
});

test("payable snapshots preserve approved amount and currency", () => {
  assert.match(
    migration032,
    /payable_snapshots[\s\S]*amount_minor[\s\S]*currency/i,
  );
  assert.match(
    migration032,
    /payment_reconciliation_snapshot_is_payable/i,
  );
});

test("financial commands have an idempotent receipt contract", () => {
  assert.match(migration032, /financial_command_receipts/i);
  assert.match(migration032, /(idempotency_key|command_key)/i);
  assert.match(migration032, /\bunique\b/i);
  assert.match(
    migration032,
    /payment_reconciliation_command_replay/i,
  );
  assert.match(migration032, /payment_reconciliation_store_command/i);
});

test("financial outbox is versioned separately from notification delivery", () => {
  assert.match(migration032, /financial_outbox_events/i);
  assert.match(
    migration032,
    /append_financial_outbox_event_internal/i,
  );
  assert.doesNotMatch(
    migration032,
    /insert\s+into\s+public\.notification_events/i,
  );
});

test("finance authorization is centralized in the database", () => {
  assert.match(
    migration032,
    /payment_reconciliation_require_finance\s*\(/i,
  );
});

test("RLS is enabled for the base financial tables", () => {
  for (const table of [
    "payment_document_extractions",
    "bank_payment_operations",
    "payable_snapshots",
    "financial_command_receipts",
    "financial_outbox_events",
  ]) {
    assert.match(
      migration032,
      new RegExp(
        `alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`,
        "i",
      ),
    );
  }
});

test("authenticated users do not receive unrestricted table mutation grants", () => {
  assert.doesNotMatch(
    migration032,
    /grant\s+(all|insert|update|delete)[\s\S]{0,120}\bto\s+authenticated\b/i,
  );
});

test("032 keeps the expected unique PostgreSQL function inventory", () => {
  const signatures = normalizedFunctionSignatures(migration032);
  assert.equal(new Set(signatures).size, signatures.length);
  assert.equal(signatures.length, 49);
});

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
