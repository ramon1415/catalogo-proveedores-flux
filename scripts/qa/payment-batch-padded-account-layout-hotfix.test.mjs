import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migration = readFileSync(
  join(root, "supabase/migrations/20260827202122_payment_batch_bbva_padded_source_account_hotfix.sql"),
  "utf8",
);
const css = readFileSync(join(root, "comprobantes_batch.css"), "utf8");
const html = readFileSync(join(root, "comprobantes_batch.html"), "utf8");

test("BBVA padded source accounts use a dedicated, fail-closed matcher", () => {
  assert.match(migration, /create function public\.payment_reconciliation_source_account_hash_matches/);
  assert.match(migration, /value ~ '\^\[0-9\]\{9,10\}\$'/);
  assert.match(migration, /generate_series\(greatest\(char_length\(value\), 10\), 18\)/);
  assert.match(migration, /lpad\(value, width, '0'\)/);
  assert.match(migration, /000000000113509621[\s\S]*0113509621/);
  assert.match(migration, /000000000113509622[\s\S]*0113509621/);
});

test("accept and insert trigger share the same matcher and preserve ambiguity checks", () => {
  const uses = migration.match(/payment_reconciliation_source_account_hash_matches\(/g) || [];
  assert.ok(uses.length >= 7, "helper must be defined, tested, and used in both server paths");
  assert.match(migration, /cardinality\(v_company_bank_account_ids\) = 0[\s\S]*company_account_mismatch/);
  assert.match(migration, /cardinality\(v_company_bank_account_ids\) <> 1[\s\S]*company_account_ambiguous/);
  assert.match(migration, /create or replace function public\.payment_reconciliation_validate_operation_scope/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated, service_role/);
});

test("migration contains no business-row backfill or destructive DDL", () => {
  assert.doesNotMatch(migration, /\b(?:delete|truncate|drop\s+(?:table|column)|alter\s+table)\b/i);
  assert.doesNotMatch(migration, /\bupdate\s+public\.payment_document_extractions\s+set\s+source_account_hash\b/i);
});

test("desktop batch review uses page scrolling at Chrome 100 percent", () => {
  assert.match(css, /@media\(min-width:821px\)[\s\S]*\.receipt-batch-page\{overflow-x:hidden;overflow-y:auto\}/);
  assert.match(css, /\.receipt-batch-workspace\{flex:0 0 auto;min-height:420px\}/);
  assert.match(css, /\.receipt-batch-detail\{overflow:visible\}/);
  assert.match(html, /comprobantes_batch\.css\?v=20260827-account-layout-hotfix/);
});
