import assert from 'node:assert/strict'
import test from 'node:test'
import { functionDefinition } from '../database-catalog.mjs'
const functionBody = functionDefinition
const extractFunction = functionDefinition

test("candidate search is read-only and stable", () => {
  const search = functionBody("find_payment_receipt_candidates");
  assert.match(search, /stable/i);
  assert.doesNotMatch(
    search,
    /\b(insert\s+into|update\s+public\.|delete\s+from)\b/i,
  );
});

test("candidate search requires exact amount and normalized currency", () => {
  const search = functionBody("find_payment_receipt_candidates");
  assert.match(
    search,
    /snapshot\.amount_minor\s*=\s*v_operation\.amount_minor/i,
  );
  assert.match(
    search,
    /snapshot\.currency\s*=\s*v_operation\.currency/i,
  );
});

test("candidate search returns approved or confirmed-paid, matchable, and unlinked requests only", () => {
  const search = functionBody("find_payment_receipt_candidates");
  assert.match(search, /payment_reconciliation_snapshot_is_receipt_matchable/i);
  assert.match(search, /payment_request_receipt_links/i);
  assert.match(search, /payment_receipts/i);
  assert.match(search, /(approved|aprob)/i);
});

test("provider compatibility is revalidated during candidate search", () => {
  assert.match(
    functionBody("find_payment_receipt_candidates"),
    /(provider|proveedor)/i,
  );
});

test("final link accepts only operation, request, and idempotency inputs", () => {
  const declaration = functionDefinition("link_payment_receipt_to_request").match(
    /create\s+(?:or\s+replace\s+)?function\s+public\.link_payment_receipt_to_request\s*\(([\s\S]*?)\)\s*returns/i,
  );
  assert.ok(declaration);
  const args = declaration[1].toLowerCase();
  assert.match(args, /p_operation_id/);
  assert.match(args, /p_payment_request_id/);
  assert.match(args, /p_idempotency_key/);
  assert.doesNotMatch(args, /p_(amount|currency|allocation|reservation)/);
});

test("final link locks every financial authority before validating", () => {
  const link = functionBody("link_payment_receipt_to_request");
  assert.ok((link.match(/for update/gi) || []).length >= 4);
  assert.match(link, /payment_requests/i);
  assert.match(link, /payable_snapshots/i);
  assert.match(link, /payment_operation_evidence/i);
});

test("final link revalidates accepted extraction, approval, exact facts, and provider", () => {
  const link = functionBody("link_payment_receipt_to_request");
  assert.match(link, /accepted/i);
  assert.match(link, /(approved|aprob)/i);
  assert.match(link, /amount_minor/i);
  assert.match(link, /currency/i);
  assert.match(link, /(provider|proveedor)/i);
});

test("final link is idempotent and stores the command result", () => {
  const link = functionBody("link_payment_receipt_to_request");
  assert.match(link, /idempotency/i);
  assert.match(link, /payment_reconciliation_command_replay/i);
  assert.match(link, /payment_reconciliation_store_command/i);
});

test("link, paid state, audit, and outbox share one database transaction", () => {
  const link = functionBody("link_payment_receipt_to_request");
  assert.match(link, /insert into public\.payment_request_receipt_links/i);
  assert.match(link, /update public\.payment_requests/i);
  assert.match(link, /append_financial_outbox_event_internal/i);
  assert.doesNotMatch(link, /\bcommit\b/i);
});

test("the outbox event is financial and contains no full account data", () => {
  const link = functionBody("link_payment_receipt_to_request");
  const outboxStart = link.indexOf(
    "v_event_id := public.append_financial_outbox_event_internal",
  );
  const outboxEnd = link.indexOf("v_result :=", outboxStart);
  assert.notEqual(outboxStart, -1);
  assert.notEqual(outboxEnd, -1);
  const outboxCall = link.slice(outboxStart, outboxEnd);
  assert.match(outboxCall, /payment_receipt\.linked/i);
  assert.doesNotMatch(
    outboxCall,
    /(clabe|account_number|cuenta_completa|cuenta_bancaria)/i,
  );
});
