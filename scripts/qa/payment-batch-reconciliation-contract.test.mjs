import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")

const migration = read("supabase/migrations/032_payment_batch_reconciliation.sql")
const html = read("comprobantes_batch.html")
const client = read("comprobantes_batch.js")
const styles = read("comprobantes_batch.css")
const parser = read("payment_batch_parser.js")

const domainTables = Object.freeze([
  "payment_matching_policy_versions",
  "payable_snapshots",
  "payment_ingestion_batches",
  "payment_documents",
  "payment_document_extractions",
  "bank_payment_operations",
  "payment_operation_documents",
  "payment_allocation_plans",
  "payment_allocation_items",
  "payment_allocation_reservations",
  "payment_allocation_movements",
  "financial_command_receipts",
  "financial_outbox_events",
  "financial_outbox_delivery_attempts",
  "financial_break_glass_audit",
  "legacy_payment_receipt_links",
])

const authenticatedRpcs = Object.freeze([
  "get_payment_batch_context",
  "payment_reconciliation_storage_path_allowed",
  "rotate_payment_matching_policy",
  "create_payment_ingestion_batch",
  "finalize_payment_ingestion_upload",
  "submit_payment_document_extractions",
  "list_payment_ingestion_batches",
  "get_payment_ingestion_batch_detail",
  "accept_payment_document_extraction",
  "reject_payment_document_extraction",
  "find_payment_allocation_candidates",
  "propose_payment_allocations",
  "reserve_payment_allocations",
  "expire_payment_reservation",
  "release_payment_reservation",
  "cancel_payment_allocation_plan",
])

const mutationRpcs = Object.freeze([
  "create_payment_ingestion_batch",
  "finalize_payment_ingestion_upload",
  "submit_payment_document_extractions",
  "accept_payment_document_extraction",
  "reject_payment_document_extraction",
  "propose_payment_allocations",
  "reserve_payment_allocations",
  "expire_payment_reservation",
  "release_payment_reservation",
  "cancel_payment_allocation_plan",
])

const uiRpcContract = Object.freeze({
  context: ["get_payment_batch_context", []],
  createBatch: ["create_payment_ingestion_batch", [
    "p_company_id", "p_file_name", "p_file_size_bytes", "p_document_sha256", "p_idempotency_key",
  ]],
  finalizeBatch: ["finalize_payment_ingestion_upload", [
    "p_batch_id", "p_page_count", "p_idempotency_key",
  ]],
  submitExtractions: ["submit_payment_document_extractions", [
    "p_batch_id", "p_parser_version", "p_pages", "p_idempotency_key",
  ]],
  listBatches: ["list_payment_ingestion_batches", ["p_company_id", "p_status", "p_limit"]],
  batchDetail: ["get_payment_ingestion_batch_detail", ["p_batch_id"]],
  acceptExtraction: ["accept_payment_document_extraction", [
    "p_extraction_id", "p_expected_updated_at", "p_idempotency_key",
  ]],
  rejectExtraction: ["reject_payment_document_extraction", [
    "p_extraction_id", "p_expected_updated_at", "p_reason", "p_idempotency_key",
  ]],
  candidates: ["find_payment_allocation_candidates", ["p_operation_id", "p_limit"]],
  propose: ["propose_payment_allocations", ["p_operation_id", "p_allocations", "p_idempotency_key"]],
  reserve: ["reserve_payment_allocations", ["p_plan_id", "p_expires_at", "p_idempotency_key"]],
  expireReservation: ["expire_payment_reservation", ["p_reservation_id", "p_idempotency_key"]],
  releaseReservation: ["release_payment_reservation", ["p_reservation_id", "p_reason", "p_idempotency_key"]],
  cancelPlan: ["cancel_payment_allocation_plan", ["p_plan_id", "p_reason", "p_idempotency_key"]],
})

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function functionDefinition(name) {
  const marker = new RegExp(
    `create(?:\\s+or\\s+replace)?\\s+function\\s+public\\.${escapeRegex(name)}\\s*\\(`,
    "i",
  )
  const match = marker.exec(migration)
  assert.ok(match, `missing function definition for ${name}`)
  const rest = migration.slice(match.index)
  const end = rest.indexOf("\n$$;")
  assert.notEqual(end, -1, `unterminated function definition for ${name}`)
  return rest.slice(0, end + 4)
}

function functionParameterNames(name) {
  const definition = functionDefinition(name)
  const returnsAt = definition.search(/\)\s*returns\b/i)
  assert.notEqual(returnsAt, -1, `missing returns clause for ${name}`)
  const open = definition.indexOf("(")
  return [...definition.slice(open + 1, returnsAt).matchAll(/\b(p_[a-z0-9_]+)\s+/gi)]
    .map((match) => match[1])
}

function tableDefinition(name) {
  const marker = new RegExp(
    `create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+public\\."?${escapeRegex(name)}"?\\s*\\(`,
    "i",
  )
  const match = marker.exec(migration)
  assert.ok(match, `missing table definition for ${name}`)
  const rest = migration.slice(match.index)
  const end = rest.indexOf(";", match[0].length)
  assert.notEqual(end, -1, `unterminated table definition for ${name}`)
  return rest.slice(0, end + 1)
}

function rpcConstants() {
  const block = client.match(/const\s+RPC\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/)
  assert.ok(block, "missing frozen UI RPC registry")
  return Object.fromEntries(
    [...block[1].matchAll(/^\s*([a-zA-Z0-9_]+):\s*["']([a-z0-9_]+)["']/gm)]
      .map((match) => [match[1], match[2]]),
  )
}

function invocationSource(property) {
  const needles = [`.rpc(RPC.${property}`, `mutate(RPC.${property}`]
  const starts = needles.map((needle) => client.indexOf(needle)).filter((index) => index >= 0)
  assert.ok(starts.length > 0, `UI never invokes RPC.${property}`)
  const start = Math.min(...starts)
  const open = client.indexOf("(", start)
  let depth = 0
  let quote = ""
  for (let index = open; index < client.length; index += 1) {
    const character = client[index]
    if (quote) {
      if (character === "\\") index += 1
      else if (character === quote) quote = ""
      continue
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character
      continue
    }
    if (character === "(") depth += 1
    if (character === ")") {
      depth -= 1
      if (depth === 0) return client.slice(start, index + 1)
    }
  }
  assert.fail(`unterminated UI invocation for RPC.${property}`)
}

function invocationParameterNames(property) {
  return [...new Set(
    [...invocationSource(property).matchAll(/\b(p_[a-z0-9_]+)\s*:/g)].map((match) => match[1]),
  )]
}

function authenticatedGrantNames() {
  return [...migration.matchAll(
    /grant\s+execute\s+on\s+function\s+public\.([a-z0-9_]+)\([^;]*\)\s+to\s+authenticated\s*;/gi,
  )].map((match) => match[1])
}

test("migration 032 is additive and does not depend on frozen or legacy authorities", () => {
  for (const table of domainTables) tableDefinition(table)
  for (const forbiddenRelation of ["providers", "provider_intakes", "payment_receipts", "notification_events"]) {
    const relationReference = new RegExp(
      `\\b(?:from|join|into|update|references|table)\\s+(?:only\\s+)?public\\."?${escapeRegex(forbiddenRelation)}"?\\b`,
      "i",
    )
    assert.doesNotMatch(migration, relationReference, `migration depends on ${forbiddenRelation}`)
    assert.doesNotMatch(
      client,
      new RegExp(`\\.from\\(\\s*["']${escapeRegex(forbiddenRelation)}["']\\s*\\)`, "i"),
      `browser depends on ${forbiddenRelation}`,
    )
  }
  assert.match(migration, /\bjoin\s+public\.proveedores\b/i)
  assert.doesNotMatch(migration, /\bdrop\s+table\b/i)
  assert.doesNotMatch(migration, /\btruncate\b/i)
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\./i)
  assert.doesNotMatch(
    migration,
    /\b(?:insert\s+into|update)\s+public\.(?:payment_requests|proveedores|approval_batches|approval_batch_items|payment_receipts)\b/i,
  )
  assert.match(migration, /(?:^|\n)begin;[\s\S]*\ncommit;\s*$/i)
})

test("all persisted financial quantities use integer minor units", () => {
  const definitions = domainTables.map(tableDefinition).join("\n")
  const columns = [...definitions.matchAll(/^\s*([a-z][a-z0-9_]*)\s+(bigint|integer|smallint|numeric(?:\(\d+(?:,\d+)?\))?|text|uuid|timestamptz|jsonb|boolean)\b/gim)]
  const monetaryColumns = columns.filter(([, name]) => /(?:amount|balance|tolerance|reserved|remaining)/i.test(name))
  assert.ok(monetaryColumns.length >= 8, "expected money fields throughout the domain")
  for (const [, name, type] of monetaryColumns) {
    assert.match(name, /_minor$/i, `${name} must be named in minor units`)
    assert.match(type, /^bigint\b/i, `${name} must use bigint`)
  }
  assert.doesNotMatch(definitions, /\b(?:real|double\s+precision|money)\b/i)
})

test("currency policy is versioned, starts at zero tolerance, and never performs implicit FX", () => {
  const policy = tableDefinition("payment_matching_policy_versions")
  assert.match(policy, /currency\s+text\s+not\s+null/i)
  assert.match(policy, /version\s+integer\s+not\s+null/i)
  assert.match(policy, /minor_unit_scale\s+smallint\s+not\s+null/i)
  assert.match(policy, /tolerance_minor\s+bigint\s+not\s+null\s+default\s+0/i)
  assert.match(policy, /check\s*\(\s*tolerance_minor\s+between\s+0\s+and\s+9007199254740991\s*\)/i)
  assert.match(migration, /\('MXN'\s*,\s*1\s*,\s*2\s*,\s*0\s*,/i)
  const normalize = functionDefinition("payment_reconciliation_normalize_currency")
  assert.match(normalize, /v_currency\s*=\s*'MXP'[\s\S]*v_currency\s*:=\s*'MXN'/i)
  for (const name of ["propose_payment_allocations", "reserve_payment_allocations"]) {
    assert.doesNotMatch(functionDefinition(name), /tolerance_minor/i, `${name} must not alter capacity with tolerance`)
  }
  assert.doesNotMatch(migration, /\b(?:exchange_rate|fx_rate|currency_conversion)\b/i)
})

test("payable snapshots are versioned, source-bound, and append-only", () => {
  const snapshot = tableDefinition("payable_snapshots")
  assert.match(snapshot, /payment_request_id\s+uuid\s+not\s+null/i)
  assert.match(snapshot, /version\s+integer\s+not\s+null/i)
  assert.match(snapshot, /amount_minor\s+bigint\s+not\s+null/i)
  assert.match(snapshot, /authorized_by\s+uuid\s+not\s+null/i)
  assert.match(snapshot, /authorized_at\s+timestamptz\s+not\s+null/i)
  assert.match(snapshot, /unique\s*\(\s*payment_request_id\s*,\s*version\s*\)/i)
  assert.match(snapshot, /unique\s*\(\s*source_type\s*,\s*source_id\s*\)/i)
  assert.match(
    migration,
    /create\s+trigger\s+payable_snapshots_immutable\s+before\s+update\s+or\s+delete\s+on\s+public\.payable_snapshots[\s\S]{0,180}payment_reconciliation_protect_immutable/i,
  )
  assert.doesNotMatch(migration, /\b(?:update\s+public\.payable_snapshots|delete\s+from\s+public\.payable_snapshots)\b/i)
  const batchSnapshot = functionDefinition("materialize_closed_batch_payable_snapshots")
  assert.match(batchSnapshot, /new\.status\s*<>\s*'closed'/i)
  assert.match(batchSnapshot, /director_status\s*=\s*'approved'/i)
  assert.match(batchSnapshot, /decided_by[\s\S]*decided_at/i)
})

test("every new table enables RLS and revokes direct browser privileges", () => {
  for (const table of domainTables) {
    assert.match(
      migration,
      new RegExp(`alter\\s+table\\s+public\\."?${escapeRegex(table)}"?\\s+enable\\s+row\\s+level\\s+security`, "i"),
      `${table} must enable RLS`,
    )
    assert.match(
      migration,
      new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\."?${escapeRegex(table)}"?\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, "i"),
      `${table} must revoke browser table access`,
    )
  }
  assert.doesNotMatch(migration, /grant\s+(?:all|select|insert|update|delete)[^;]*on\s+table\s+public\./i)
})

test("authenticated RPC surface is exact, hardened, and derives the actor server-side", () => {
  assert.deepEqual(authenticatedGrantNames().sort(), [...authenticatedRpcs].sort())
  for (const name of authenticatedRpcs) {
    const definition = functionDefinition(name)
    assert.match(definition, /security\s+definer/i, `${name} must be SECURITY DEFINER`)
    assert.match(definition, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i, `${name} must pin search_path`)
    assert.doesNotMatch(definition, /\bp_actor(?:_profile)?_id\b/i, `${name} must not trust a browser actor`)
    assert.match(
      definition,
      /current_profile_id\s*\(|payment_reconciliation_require_finance\s*\(/i,
      `${name} must derive and authorize the actor server-side`,
    )
  }
  assert.doesNotMatch(migration, /grant\s+execute[^;]*\bto\s+(?:public|anon|service_role)\b/i)
})

test("UI RPC names and named arguments match their SQL contracts exactly", () => {
  const registry = rpcConstants()
  assert.deepEqual(Object.keys(registry).sort(), Object.keys(uiRpcContract).sort())
  for (const [property, [name, parameters]] of Object.entries(uiRpcContract)) {
    assert.equal(registry[property], name, `RPC.${property} name drift`)
    assert.deepEqual(functionParameterNames(name), parameters, `${name} SQL signature drift`)
    assert.deepEqual(
      invocationParameterNames(property).sort(),
      [...parameters].sort(),
      `RPC.${property} browser arguments drift`,
    )
  }
  assert.doesNotMatch(`${html}\n${client}`, /\bbatchLabel\b/, "UI must not promise an unpersisted batch label")
})

test("browser extraction stays untrusted until a separate locked human acceptance", () => {
  const submit = functionDefinition("submit_payment_document_extractions")
  assert.match(submit, /insert\s+into\s+public\.payment_document_extractions/i)
  assert.match(submit, /then\s+'review_required'[\s\S]{0,100}else\s+'blocked'/i)
  assert.match(submit, /v_amount_minor\s*:=\s*case\s+when\s+v_amount\s+is\s+null/i)
  assert.doesNotMatch(submit, /(?:insert\s+into|update|delete\s+from)\s+public\.bank_payment_operations/i)
  assert.doesNotMatch(submit, /append_financial_outbox_event_internal/i)

  const accept = functionDefinition("accept_payment_document_extraction")
  assert.match(accept, /payment_document_extractions[\s\S]{0,120}for\s+update/i)
  assert.match(accept, /updated_at\s+is\s+distinct\s+from\s+p_expected_updated_at/i)
  assert.match(accept, /status\s*<>\s*'review_required'/i)
  assert.match(accept, /insert\s+into\s+public\.bank_payment_operations/i)
  assert.match(accept, /payment_operation\.ingested/i)
  assert.match(invocationSource("submitExtractions"), /\.rpc\(RPC\.submitExtractions/i)
  assert.doesNotMatch(client, /\bEXTRACTION_ENDPOINT\b|\bfetch\s*\(/i)
  const redact = functionDefinition("payment_reconciliation_redact_free_text")
  assert.match(redact, /DATO BANCARIO REDACTADO/)
  assert.match(redact, /TOKEN REDACTADO/)
  assert.ok(redact.includes("'([0-9][^[:alnum:]]*){9,19}[0-9]'"))
  assert.equal(migration.split("'([0-9][^[:alnum:]]*){9,19}[0-9]'").length - 1, 10)
  assert.doesNotMatch(migration, /\(\[0-9\]\[\[:space:\]\.\-\]\?\)\{9,19\}\[0-9\]/)
  assert.match(submit, /payment_reconciliation_redact_free_text[\s\S]{0,180}180/)
  assert.match(submit, /payment_reconciliation_redact_free_text[\s\S]{0,180}500/)
  assert.match(submit, /v_amount\s+is\s+null\s+or\s+v_amount\s*<=\s*0\s+or\s+v_currency\s+is\s+null/i)
})

test("all financial commands implement same-key replay and payload-conflict detection", () => {
  const receipts = tableDefinition("financial_command_receipts")
  assert.match(receipts, /idempotency_key\s+text\s+not\s+null/i)
  assert.match(receipts, /payload_hash\s+text\s+not\s+null/i)
  assert.match(receipts, /unique\s*\(\s*company_id\s*,\s*command_scope\s*,\s*idempotency_key\s*\)/i)
  const replay = functionDefinition("payment_reconciliation_command_replay")
  assert.match(replay, /pg_advisory_xact_lock/i)
  assert.match(replay, /receipt\.company_id\s*=\s*p_company_id/i)
  assert.match(replay, /payload_hash\s*<>\s*p_payload_hash/i)
  assert.match(replay, /actor_profile_id\s*<>\s*p_actor_profile_id/i)
  assert.match(replay, /raise\s+exception\s+'idempotency_key_conflict'/i)
  assert.match(replay, /return\s+v_receipt\.result/i)
  for (const name of mutationRpcs) {
    const definition = functionDefinition(name)
    assert.ok(functionParameterNames(name).includes("p_idempotency_key"), `${name} needs an idempotency key`)
    assert.match(definition, /payment_reconciliation_payload_hash/i, `${name} must hash material input`)
    assert.match(definition, /payment_reconciliation_command_replay/i, `${name} must replay safely`)
    assert.match(definition, /payment_reconciliation_store_command/i, `${name} must persist its result`)
  }
})

test("reservation locks and revalidates capacity on operation and snapshot sides", () => {
  const reserve = functionDefinition("reserve_payment_allocations")
  assert.match(reserve, /payment_allocation_plans[\s\S]{0,100}for\s+update/i)
  assert.match(reserve, /bank_payment_operations[\s\S]{0,100}for\s+update/i)
  assert.match(reserve, /payable_snapshots[\s\S]{0,220}order\s+by\s+snapshot\.id[\s\S]{0,80}for\s+update/i)
  assert.match(reserve, /payment_operation_confirmed_minor/i)
  assert.match(reserve, /payment_operation_reserved_minor/i)
  assert.match(reserve, /payable_snapshot_confirmed_minor/i)
  assert.match(reserve, /payable_snapshot_reserved_minor/i)
  assert.match(reserve, /bank_payment_operation_capacity_exceeded/i)
  assert.match(reserve, /payable_snapshot_capacity_exceeded/i)
  assert.match(reserve, /insert\s+into\s+public\.payment_allocation_reservations/i)
  assert.match(reserve, /v_reserved_at\s*:=\s*clock_timestamp\(\)/i)
  assert.match(reserve, /p_expires_at\s*<=\s*v_reserved_at/i)

  const operationReserved = functionDefinition("payment_operation_reserved_minor")
  const snapshotReserved = functionDefinition("payable_snapshot_reserved_minor")
  for (const definition of [operationReserved, snapshotReserved]) {
    assert.match(definition, /status\s*=\s*'active'/i)
    assert.match(definition, /expires_at\s*>\s*now\(\)/i)
  }
  assert.match(snapshotReserved, /join\s+public\.payment_allocation_items/i)
})

test("release, cancellation, and explicit expiry free reserved capacity once and emit events", () => {
  const release = functionDefinition("release_payment_reservation")
  assert.match(release, /payment_allocation_reservations[\s\S]{0,120}for\s+update/i)
  assert.match(release, /status\s*<>\s*'active'/i)
  assert.match(release, /set\s+status\s*=\s*'released'/i)
  assert.match(release, /payment_allocation\.released/i)

  const cancel = functionDefinition("cancel_payment_allocation_plan")
  assert.match(cancel, /payment_allocation_plans[\s\S]{0,100}for\s+update/i)
  assert.match(cancel, /status\s+not\s+in\s*\(\s*'draft'\s*,\s*'reserved'\s*\)/i)
  assert.match(cancel, /status\s*=\s*'cancelled'/i)
  assert.match(cancel, /payment_allocation\.cancelled/i)

  const expire = functionDefinition("expire_payment_reservation")
  assert.match(expire, /payment_allocation_plans[\s\S]{0,120}for\s+update/i)
  assert.match(expire, /bank_payment_operations[\s\S]{0,120}for\s+update/i)
  assert.match(expire, /payment_allocation_reservations[\s\S]{0,120}for\s+update/i)
  assert.match(expire, /status\s*<>\s*'active'/i)
  assert.match(expire, /v_decided_at\s*:=\s*clock_timestamp\(\)/i)
  assert.match(expire, /expires_at\s*>\s*v_decided_at/i)
  assert.match(expire, /set\s+status\s*=\s*'expired'/i)
  assert.match(expire, /payment_allocation\.expired/i)

  for (const definition of [release, cancel]) {
    assert.match(definition, /v_decided_at\s*:=\s*clock_timestamp\(\)/i)
    assert.match(definition, /expires_at\s*<=\s*v_decided_at/i)
  }
})

test("outbox facts are immutable while delivery attempts remain separate", () => {
  const outbox = tableDefinition("financial_outbox_events")
  const deliveries = tableDefinition("financial_outbox_delivery_attempts")
  assert.match(outbox, /id\s+uuid\s+primary\s+key/i)
  assert.match(outbox, /event_type\s+text\s+not\s+null/i)
  assert.match(outbox, /event_version\s+integer\s+not\s+null\s+default\s+1/i)
  assert.match(outbox, /aggregate_type\s+text\s+not\s+null/i)
  assert.match(outbox, /aggregate_id\s+uuid\s+not\s+null/i)
  assert.match(outbox, /payload\s+jsonb\s+not\s+null/i)
  assert.match(deliveries, /event_id\s+uuid\s+not\s+null\s+references\s+public\.financial_outbox_events\(id\)/i)
  assert.match(deliveries, /unique\s*\(\s*event_id\s*,\s*consumer_name\s*,\s*attempt_number\s*\)/i)
  assert.match(
    migration,
    /create\s+trigger\s+financial_outbox_events_immutable\s+before\s+update\s+or\s+delete\s+on\s+public\.financial_outbox_events/i,
  )
  const append = functionDefinition("append_financial_outbox_event_internal")
  assert.match(append, /insert\s+into\s+public\.financial_outbox_events/i)
  assert.match(append, /outbox_payload_contains_unmasked_bank_data/i)
  for (const name of [
    "accept_payment_document_extraction",
    "propose_payment_allocations",
    "reserve_payment_allocations",
    "expire_payment_reservation",
    "release_payment_reservation",
    "cancel_payment_allocation_plan",
  ]) {
    assert.match(functionDefinition(name), /append_financial_outbox_event_internal/i, `${name} needs an atomic event`)
  }
})

test("foundation exposes no confirmation/reversal command and performs no legacy cutover", () => {
  const context = functionDefinition("get_payment_batch_context")
  assert.match(context, /'can_confirm'\s*,\s*false/i)
  assert.match(context, /'can_reverse'\s*,\s*false/i)
  assert.doesNotMatch(
    authenticatedGrantNames().join("\n"),
    /(?:confirm|reverse|reopen).*(?:allocation|reconciliation)|(?:allocation|reconciliation).*(?:confirm|reverse|reopen)/i,
  )
  assert.doesNotMatch(migration, /insert\s+into\s+public\.payment_allocation_movements/i)
  assert.doesNotMatch(client, /\.rpc\(\s*["'][^"']*(?:confirm|reverse|reopen)/i)
})

test("browser financial writes use RPCs and never direct table DML or privileged credentials", () => {
  assert.doesNotMatch(client, /\.from\([^)]*\)[\s\S]{0,220}?\.(?:insert|update|upsert|delete)\s*\(/i)
  assert.doesNotMatch(client, /\bservice[_-]?role\b/i)
  for (const property of [
    "createBatch", "finalizeBatch", "submitExtractions", "acceptExtraction",
    "rejectExtraction", "propose", "reserve", "expireReservation", "releaseReservation", "cancelPlan",
  ]) {
    invocationSource(property)
  }
})

test("terminal UI actions honor server states, capabilities, and mandatory reasons", () => {
  for (const id of ["rejectExtractionBtn", "releaseReservationBtn", "expireReservationBtn", "cancelPlanBtn", "operationReasonInput"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`, "i"), `missing ${id}`)
  }
  assert.match(client, /\["review_required","blocked"\]\.includes\(extractionStatus\)/)
  assert.match(client, /plan\.reservation_status\s*===\s*"active"/)
  assert.match(client, /plan\.reservation_status\s*===\s*"expired"/)
  assert.match(client, /plan\.reservation_expired\s*===\s*true/)
  assert.match(client, /const\s+expirableReservation\s*=\s*plan\.status\s*===\s*"reserved"/)
  assert.match(client, /\["draft","reserved"\]\.includes\(plan\.status\)/)
  assert.match(client, /const\s+validReason\s*=\s*dom\.operationReasonInput\.value\.trim\(\)\.length\s*>=\s*10/)
  assert.match(client, /operationReasonInput\.addEventListener\("input",\s*syncOperationActions\)/)
  assert.equal((client.match(/reason\.length\s*<\s*10/g) || []).length, 3)
  assert.match(client, /state\.candidates\s*=\s*\[\][\s\S]{0,100}operationReasonInput\.value\s*=\s*""/)
  assert.match(client, /function\s+batchOperations[\s\S]*rejection_reason:\s*operation\.rejection_reason\s*\|\|\s*extraction\.rejection_reason/)
  assert.match(client, /catch\s*\(error\)[\s\S]{0,180}await\s+loadBatches\(\)/)
  assert.match(html, /Motivo de rechazo, liberación o cancelación/i)
  assert.match(html, /id="operationReasonInput"[^>]*minlength="10"/i)
  assert.match(client, /function\s+planNotice[\s\S]*plan\.cancel_reason\s*\|\|\s*plan\.close_reason/)
  assert.match(client, /const\s+planItems\s*=\s*array\(plan\.items\)/)
  assert.match(client, /reservePlanBtn\.disabled\s*=[^\n]*!planItems\.length/)
  assert.match(client, /function\s+reservePlan[\s\S]{0,240}!array\(plan\.items\)\.length/)
})

test("PostgREST P0001 errors preserve actionable domain messages", () => {
  const match = client.match(/function\s+friendlyError\(error\)\s*\{([\s\S]*?)\n\s*\}\n\s*function\s+toast/)
  assert.ok(match, "missing friendlyError implementation")
  const friendlyError = Function(`return function friendlyError(error) {${match[1]}\n}`)()
  assert.equal(
    friendlyError({ code: "P0001", message: "stale_payment_extraction" }),
    "La extracción cambió en otra sesión; se actualizaron los datos.",
  )
  assert.equal(
    friendlyError({ code: "P0001", message: "bank_payment_operation_company_account_ambiguous" }),
    "La cuenta origen coincide con más de una cuenta BBVA activa; corrige el catálogo antes de aceptar.",
  )
  assert.equal(
    friendlyError({ code: "PGRST202", message: "Could not find the function" }),
    "El contrato RPC todavía no está disponible en este ambiente.",
  )
})

test("allocation review is complete before proposal and reservation", () => {
  const detail = functionDefinition("get_payment_ingestion_batch_detail")
  assert.match(detail, /'items'|as\s+items/i)
  assert.match(detail, /request_number[\s\S]{0,500}payment_allocation_items/i)
  assert.match(client, /function\s+renderPlanItems\s*\(/)
  assert.match(client, /plan\.items/)
  assert.match(client, /const\s+selectedRows\s*=\s*rows\.filter/)
  assert.match(client, /allocations\.some\(\(item\)\s*=>[\s\S]{0,180}Importes inválidos/)
  assert.doesNotMatch(client, /selectedRows\.map\([^\n]+\)\.filter\(/)
})

test("browser submits only a true bank unique folio to the extraction contract", () => {
  assert.match(client, /bank_unique_folio:\s*operation\.bank_unique_folio\s*,/)
  assert.doesNotMatch(client, /bank_unique_folio:\s*operation\.bank_unique_folio\s*\|\|\s*operation\.bank_reference/)
  assert.match(client, /bank_name:\s*operation\.bank_name\s*,/)
  assert.match(parser, /bank_unique_folio_missing/)
  assert.match(parser, /bank_name:\s*isBbva\s*\?\s*"BBVA"\s*:\s*"UNKNOWN"/)
})

test("strong bank identity is numeric, company-bound, and Folio-unique", () => {
  const operations = tableDefinition("bank_payment_operations")
  const submission = functionDefinition("submit_payment_document_extractions")
  const acceptance = functionDefinition("accept_payment_document_extraction")
  const scope = functionDefinition("payment_reconciliation_validate_operation_scope")
  assert.match(parser, /\^\[0-9\]\{10,18\}\$/)
  assert.match(submission, /v_source_account_material\s*~\s*'\^\[0-9\]\{10,18\}\$'/)
  assert.match(submission, /v_destination_account_material\s*~\s*'\^\[0-9\]\{10,18\}\$'/)
  assert.match(submission, /v_bank_unique_folio\s*:=\s*upper/)
  assert.match(operations, /source_company_bank_account_id\s+uuid\s+not null\s+references\s+public\.company_bank_accounts/i)
  assert.match(operations, /unique\s*\(\s*company_id\s*,\s*bank_unique_folio\s*\)/i)
  assert.match(acceptance, /from\s+public\.company_bank_accounts[\s\S]*account\.company_id\s*=\s*v_extraction\.company_id/i)
  assert.match(acceptance, /payment_reconciliation_normalize_bank_name\(account\.bank_name\)\s*=\s*'BBVA'/i)
  assert.match(acceptance, /account\.currency[\s\S]{0,100}=\s*v_extraction\.currency/i)
  assert.match(acceptance, /array_agg\(matched\.id\s+order\s+by\s+matched\.id\)/i)
  assert.match(acceptance, /for\s+share/i)
  assert.match(acceptance, /bank_payment_operation_company_account_mismatch/)
  assert.match(acceptance, /cardinality\(v_company_bank_account_ids\)\s*<>\s*1/i)
  assert.match(acceptance, /bank_payment_operation_company_account_ambiguous/)
  assert.match(acceptance, /bank_payment_operation_folio_duplicate/)
  assert.match(scope, /new\.source_company_bank_account_id/)
  assert.match(scope, /payment_reconciliation_normalize_bank_name\(account\.bank_name\)\s*=\s*'BBVA'/i)
  assert.match(scope, /account\.currency[\s\S]{0,100}=\s*new\.currency/i)
})

test("extraction submission requires an exact one-to-one page set", () => {
  const submission = functionDefinition("submit_payment_document_extractions")
  assert.match(submission, /p_pages\s+is\s+null/i)
  assert.match(submission, /jsonb_typeof\(p_pages\)\s+is\s+distinct\s+from\s+'array'/i)
  assert.match(submission, /v_batch\.page_count\s+is\s+null\s+or\s+jsonb_array_length\(p_pages\)\s*<>\s*v_batch\.page_count/i)
  assert.match(submission, /v_page_number\s+not\s+between\s+1\s+and\s+v_batch\.page_count/i)
  assert.match(tableDefinition("payment_document_extractions"), /unique\s*\(\s*document_id\s*,\s*page_number\s*\)/i)
})

test("terminal extraction decisions serialize the parent batch rollup", () => {
  for (const name of ["accept_payment_document_extraction", "reject_payment_document_extraction"]) {
    const definition = functionDefinition(name)
    assert.match(definition, /from\s+public\.payment_ingestion_batches\s+batch[\s\S]*for\s+update/i)
    assert.match(definition, /payment_batch_scope_mismatch/)
  }
})

test("reviewer can open short-lived private source evidence at the extracted page", () => {
  const detail = functionDefinition("get_payment_ingestion_batch_detail")
  assert.match(detail, /document\.storage_bucket/i)
  assert.match(detail, /document\.storage_path/i)
  assert.match(html, /id="openSourcePdfBtn"[^>]*type="button"/i)
  assert.match(client, /storage_bucket\s*===\s*"payment-batch-documents"/)
  assert.match(client, /createSignedUrl\(sourceDocument\.storage_path,\s*300\)/)
  assert.match(client, /signedUrl\.hash\s*=\s*`page=\$\{pageNumber\}`/)
  assert.doesNotMatch(client, /localStorage[^\n]*(?:signed|storage|pdf|url)/i)
})

test("browser keeps no financial cache or draft in local persistence", () => {
  const localStorageCalls = [...client.matchAll(
    /localStorage\.(?:getItem|setItem|removeItem)\(\s*["']([^"']+)["']/g,
  )].map((match) => match[1])
  assert.deepEqual([...new Set(localStorageCalls)], ["flux-theme"])
  assert.doesNotMatch(parser, /\blocalStorage\b/)
  for (const source of [client, parser]) {
    assert.doesNotMatch(source, /\bsessionStorage\b/)
    assert.doesNotMatch(source, /\bindexedDB\b/)
    assert.doesNotMatch(source, /\bdocument\.cookie\b/)
    assert.doesNotMatch(source, /flux-transfer-receipts|payment[_-]batch[^"']*(?:state|cache|draft)/i)
  }
})

test("confirmation remains visibly and programmatically disabled", () => {
  const button = html.match(/<button\b[^>]*id="confirmOperationBtn"[^>]*>/i)
  assert.ok(button, "missing confirmation button")
  assert.match(button[0], /\bdisabled\b/i)
  assert.match(button[0], /aria-describedby="confirmDisabledReason"/i)
  assert.match(html, /id="confirmDisabledReason"[^>]*>[\s\S]*cutover/i)
  assert.doesNotMatch(client, /confirmOperationBtn[\s\S]{0,100}disabled\s*=\s*false/i)
  assert.doesNotMatch(client, /dom\.confirmOperationBtn\.addEventListener/i)
})

test("upload path accepts PDF only and verifies its signature before hashing or upload", () => {
  const input = html.match(/<input\b[^>]*id="batchPdfFile"[^>]*>/i)
  assert.ok(input, "missing payment batch file input")
  assert.match(input[0], /type="file"/i)
  assert.match(input[0], /accept="application\/pdf,\.pdf"/i)
  assert.match(input[0], /\brequired\b/i)
  assert.match(html, /pdfjs-dist@3\.11\.174/i)
  assert.match(client, /file\.type\s*!==\s*"application\/pdf"/i)
  assert.match(client, /\.pdf\$\/i/i)
  assert.match(client, /hasPdfSignature\(bytes\)[\s\S]{0,100}sha256Hex\(bytes\)/i)
  assert.match(client, /===\s*"%PDF-"/i)
  assert.match(client, /getDocument\s*\(/i)
  assert.match(client, /isEvalSupported:\s*false/i)
  assert.doesNotMatch(input[0], /image\/|\.png|\.jpe?g|\.xlsx?|\.csv/i)

  assert.match(migration, /'payment-batch-documents'\s*,\s*'payment-batch-documents'\s*,\s*false/i)
  assert.match(migration, /allowed_mime_types[\s\S]{0,180}array\['application\/pdf'\]/i)
  assert.match(migration, /bucket_id\s*=\s*'payment-batch-documents'/i)
})

test("upload freezes company and file identity before its first await", () => {
  const start = client.indexOf("async function submitBatch")
  const end = client.indexOf("\n  async function parsePdf", start)
  assert.ok(start >= 0 && end > start, "missing submitBatch function")
  const submit = client.slice(start, end)
  const companyCapture = submit.indexOf("const companyId =")
  const fileCapture = submit.indexOf("const file =")
  const firstAwait = submit.indexOf("await ")
  assert.ok(companyCapture >= 0 && companyCapture < firstAwait)
  assert.ok(fileCapture >= 0 && fileCapture < firstAwait)
  assert.match(submit, /p_company_id:\s*companyId/)
  assert.doesNotMatch(submit, /p_company_id:\s*dom\.batchCompanyId\.value/)
  assert.match(client, /function\s+setBusy[\s\S]{0,240}batchCompanyId\.disabled\s*=\s*busy/)
  assert.match(client, /function\s+setBusy[\s\S]{0,280}batchPdfFile\.disabled\s*=\s*busy/)
})

test("duplicate document replay is surfaced and cannot silently overwrite the private object", () => {
  const create = functionDefinition("create_payment_ingestion_batch")
  assert.match(create, /document_sha256\s*=\s*v_sha/i)
  assert.match(create, /'duplicate'\s*,\s*true/i)
  assert.match(create, /'status'\s*,\s*v_existing\.status/i)
  assert.match(client, /created\?\.duplicate/i)
  assert.match(client, /const\s+resumeExtraction\s*=\s*created\?\.duplicate\s*&&\s*created\?\.status\s*===\s*"extracting"/)
  assert.match(client, /created\?\.duplicate\s*&&\s*!\["awaiting_upload","extracting"\]\.includes\(created\?\.status\)/)
  assert.match(client, /if\s*\(!resumeExtraction\)\s*\{[\s\S]*bucket\.upload[\s\S]*RPC\.finalizeBatch/)
  assert.match(client, /resumeExtraction\s*\?\s*"Retomando extracción interrumpida…"/)
  assert.match(client, /bucket\.upload\([\s\S]{0,180}upsert:\s*false/i)
  const finalize = functionDefinition("finalize_payment_ingestion_upload")
  assert.match(finalize, /v_batch\.status\s*=\s*'extracting'/i)
  assert.match(finalize, /page_count\s+is\s+distinct\s+from\s+p_page_count/i)
  assert.match(finalize, /uploaded_by\s*=\s*v_actor/i)
})

test("out-of-order detail responses cannot switch the active financial batch", () => {
  assert.match(client, /const\s+requestId\s*=\s*\+\+state\.detailRequest/)
  assert.match(client, /requestId\s*!==\s*state\.detailRequest\s*\|\|\s*state\.selectedId\s*!==\s*batchId/)
  assert.match(client, /state\.operation\s*=\s*null[\s\S]{0,120}operationDialog\.open[\s\S]{0,80}operationDialog\.close\(\)/)
})

test("candidate responses stay bound to their originating bank operation", () => {
  assert.match(client, /candidateOperationId:\s*null/)
  assert.match(client, /candidateRequest:\s*0/)
  assert.match(client, /const\s+requestId\s*=\s*\+\+state\.candidateRequest/)
  assert.match(client, /requestId\s*!==\s*state\.candidateRequest[\s\S]{0,120}state\.operation\?\.bank_operation_id\s*!==\s*operationId[\s\S]{0,100}!dom\.operationDialog\.open/)
  assert.match(client, /state\.candidateOperationId\s*=\s*operationId[\s\S]{0,80}renderOperation\(\)/)
  assert.match(client, /function\s+renderCandidates[\s\S]{0,360}state\.candidateOperationId\s*!==\s*operation\.bank_operation_id/)
  assert.match(client, /function\s+proposePlan[\s\S]{0,320}state\.candidateOperationId\s*!==\s*operationId/)
  assert.match(client, /operationDialog\.addEventListener\("close"[\s\S]{0,180}state\.candidateRequest\s*\+=\s*1/)
})

test("browser rejects an invalid or oversized PDF page count before iterating pages", () => {
  assert.match(client, /const\s+pdf\s*=\s*await\s+window\.pdfjsLib\.getDocument[\s\S]{0,240}const\s+maxPages\s*=\s*Number\(state\.context\?\.upload_policy\?\.max_pages\s*\|\|\s*500\)/)
  assert.match(client, /!Number\.isInteger\(pdf\.numPages\)\s*\|\|\s*pdf\.numPages\s*<\s*1\s*\|\|\s*pdf\.numPages\s*>\s*maxPages/)
  assert.match(client, /throw\s+new\s+Error\("invalid_pdf_page_count"\)[\s\S]{0,120}const\s+pages\s*=\s*\[\]/)
  assert.match(client, /invalid_pdf_page_count:\s*"El PDF no tiene páginas válidas o supera el límite autorizado\."/)
})

test("HTML and CSS preserve keyboard, status, dialog, responsive and reduced-motion support", () => {
  assert.match(html, /class="receipt-batch-skip"[^>]+href="#mainContent"/i)
  assert.match(html, /<main[^>]+id="mainContent"[^>]+tabindex="-1"/i)
  assert.match(html, /aria-live="polite"/i)
  assert.match(html, /role="alert"/i)
  assert.match(html, /<dialog[^>]+aria-labelledby="newBatchTitle"/i)
  assert.match(html, /<dialog[^>]+aria-labelledby="operationTitle"/i)
  assert.match(html, /<label[\s\S]{0,300}id="batchPdfFile"/i)
  assert.match(styles, /:focus-visible/i)
  assert.match(styles, /@media\s*\(max-width:\s*820px\)/i)
  assert.match(styles, /@media\s*\(max-width:\s*560px\)/i)
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/i)
})

test("rendered financial tables expose captions and scoped column headers", () => {
  assert.match(client, /<caption\b/i)
  assert.match(client, /<th\s+scope=["']col["']/i)
  assert.match(client, /aria-label=/i)
  assert.match(client, /metric\("Páginas \/ extracciones",\s*operations\.length\)/)
  assert.match(client, /metric\("Aceptadas",\s*operations\.filter\(\(item\)\s*=>\s*Boolean\(item\.bank_operation_id\)\)\.length\)/)
  assert.doesNotMatch(client, /metric\("Conciliadas"/)
  assert.match(client, /operationCard\("Remanente financiero",[\s\S]{0,120}financial_remainder_minor/)
  assert.match(client, /operationCard\("Disponible para reservar",[\s\S]{0,120}available_minor/)
  assert.match(client, /function\s+formatMinor[^\n]*parser\.formatMinorForDisplay/)
  assert.match(parser, /function\s+formatMinorForDisplay[\s\S]{0,350}BigInt\(safe\)/)
  assert.doesNotMatch(client, /function\s+formatMinor[^\n]*\/\s*100\b/)
})
