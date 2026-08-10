import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../../supabase/migrations/20260810185817_paid_layout_receipt_match.sql",
  import.meta.url,
);
const migration = readFileSync(migrationPath, "utf8");

function extractFunction(name) {
  const startExpression = new RegExp(
    `create or replace function public\\.${name}\\(`,
    "i",
  );
  const start = startExpression.exec(migration);
  assert.ok(start, `${name} definition missing`);
  const end = migration.indexOf("\n$function$;", start.index);
  assert.notEqual(end, -1, `${name} terminator missing`);
  return migration.slice(start.index, end + "\n$function$;".length);
}

test("migration is transactional, fail-closed, and DDL-only", () => {
  assert.equal((migration.match(/^begin;$/gim) || []).length, 1);
  assert.equal((migration.match(/^commit;$/gim) || []).length, 1);
  assert.equal((migration.split("$precheck$").length - 1) % 2, 0);
  assert.equal((migration.split("$postcheck$").length - 1) % 2, 0);
  for (const hash of [
    "45ad9582b74cc4ae92c9a5f606bb8b872567bd96d6c5197b6a4272481557297d",
    "065dc49e727dcdb9b8a4f2c44955edde2f273269ecec2580a79c45de2c76443e",
    "c9f80a57b7fb7d750961f3f9912b4c1858596459eafee62471d70182c3aa70e3",
  ]) assert.match(migration, new RegExp(hash));
  assert.doesNotMatch(migration, /delete\s+from\s+public\.payment_receipts/i);
  assert.doesNotMatch(migration, /update\s+public\.payment_receipts/i);
});

test("paid matching requires one confirmed layout line and its one legacy receipt", () => {
  const fn = extractFunction(
    "payment_reconciliation_snapshot_is_receipt_matchable",
  );
  assert.match(fn, /status::text not in \('finance_validation', 'paid'\)/);
  assert.match(fn, /v_total_layout_lines <> 1 or v_matching_layout_lines <> 1/);
  assert.match(fn, /line\.status = 'paid'/);
  assert.match(fn, /layout\.status = 'confirmed'/);
  assert.match(fn, /v_total_legacy_receipts <> 1 or v_matching_legacy_receipts <> 1/);
  assert.match(fn, /legacy\.layout_id = v_paid_layout_id/);
  assert.match(fn, /legacy\.registered_by is not distinct from v_request\.paid_by/);
  assert.match(fn, /legacy\.created_at is not distinct from v_request\.paid_at/);
  assert.match(fn, /payment_request_receipt_links/);
  assert.match(fn, /approval_batch_request_has_current_direction_approval/);
});

test("candidate search admits paid requests without widening amount, currency, or provider gates", () => {
  const fn = extractFunction("find_payment_receipt_candidates");
  assert.match(fn, /status::text in \('approved', 'finance_validation', 'paid'\)/);
  assert.match(fn, /snapshot\.amount_minor = v_operation\.amount_minor/);
  assert.match(fn, /snapshot\.currency = v_operation\.currency/);
  assert.match(fn, /payment_reconciliation_snapshot_is_receipt_matchable/);
  assert.match(fn, /account_match or name_match/);
  assert.match(fn, /not exists \([\s\S]*payment_request_receipt_links/);
  assert.match(fn, /request\.status::text = 'paid'[\s\S]*or not exists \([\s\S]*payment_receipts legacy/);
});

test("linking a paid-layout request preserves its paid audit trail and layout state", () => {
  const fn = extractFunction("link_payment_receipt_to_request");
  assert.match(fn, /status::text not in \('approved', 'finance_validation', 'paid'\)/);
  assert.match(fn, /paid_request_confirmed_layout_line_required/);
  assert.match(fn, /paid_request_single_layout_receipt_required/);
  assert.match(fn, /paid_request_layout_receipt_provenance_mismatch/);
  assert.match(fn, /layout_receipt_snapshot_amount_mismatch/);
  assert.match(fn, /if v_request\.status::text <> 'paid' then[\s\S]*update public\.payment_requests/);
  assert.match(fn, /if v_request\.status::text = 'finance_validation' then[\s\S]*update public\.payment_layout_lines/);
  assert.match(fn, /elsif v_request\.status::text = 'paid' then\s+v_layout_final_status := 'confirmed'/);
  assert.doesNotMatch(fn, /update public\.payment_receipts/);
  assert.doesNotMatch(fn, /delete from public\.payment_receipts/);
});

test("idempotency, evidence, event, notification, and ACL contracts remain intact", () => {
  const fn = extractFunction("link_payment_receipt_to_request");
  for (const marker of [
    "payment_reconciliation_command_replay",
    "accepted_payment_extraction_required",
    "shareable_single_page_evidence_required",
    "payment_request_receipt_links",
    "payment_reconciliation_store_command",
    "enqueue_payment_receipt_linked_notifications_internal",
    "append_financial_outbox_event_internal",
  ]) assert.ok(fn.includes(marker), marker);
  assert.match(migration, /grant execute on function public\.find_payment_receipt_candidates\(uuid, integer\)\s+to authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.link_payment_receipt_to_request\(uuid, uuid, text\)\s+to authenticated, service_role/i);
  assert.match(migration, /payment_reconciliation_snapshot_is_receipt_matchable\(uuid\)\s+to service_role/i);
});
