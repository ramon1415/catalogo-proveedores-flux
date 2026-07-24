import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  new URL("../../supabase/migrations/036_quarantine_legacy_extraordinary_authorizations.sql", import.meta.url),
  "utf8",
)
const standalonePrecheck = readFileSync(
  new URL("./legacy-extraordinary-direct-lineage-precheck.sql", import.meta.url),
  "utf8",
)

function classifyLegacyPaid({
  requestStatus = "paid",
  receiptLinks = [],
  directAllocationItems = [],
}) {
  if (requestStatus !== "paid") return "legacy_quarantined"
  if (receiptLinks.length !== 1) return "legacy_receipt_link_ambiguous"
  const link = receiptLinks[0]
  if (
    link.evidenceStatus !== "shareable"
    || link.snapshotRequestId !== link.requestId
    || link.snapshotSourceId !== link.authorizationId
    || link.requestAmountMinor !== link.evidenceAmountMinor
    || link.requestCurrency !== link.evidenceCurrency
  ) {
    return "legacy_evidence_financial_mismatch"
  }
  if (directAllocationItems.some((item) => item.snapshotRequestId === link.requestId)) {
    return "direct_execution_path_open"
  }
  return "legacy_consumed_unverified"
}

function validLink(overrides = {}) {
  return {
    requestId: "REQUEST-A",
    authorizationId: "AUTH-A",
    snapshotRequestId: "REQUEST-A",
    snapshotSourceId: "AUTH-A",
    evidenceStatus: "shareable",
    requestAmountMinor: 2991600,
    evidenceAmountMinor: 2991600,
    requestCurrency: "MXN",
    evidenceCurrency: "MXN",
    ...overrides,
  }
}

test("case A: an unrelated reserved plan never blocks direct legacy lineage", () => {
  const result = classifyLegacyPaid({
    receiptLinks: [validLink()],
    directAllocationItems: [
      { snapshotRequestId: "REQUEST-B", companyId: "COMPANY-1", amountMinor: 2991600, currency: "MXN" },
    ],
  })
  assert.equal(result, "legacy_consumed_unverified")
})

test("case B: an allocation item on A's direct snapshot blocks classification", () => {
  const result = classifyLegacyPaid({
    receiptLinks: [validLink()],
    directAllocationItems: [{ snapshotRequestId: "REQUEST-A" }],
  })
  assert.equal(result, "direct_execution_path_open")
})

test("case C: two direct receipt links are ambiguous", () => {
  const result = classifyLegacyPaid({
    receiptLinks: [validLink(), validLink()],
  })
  assert.equal(result, "legacy_receipt_link_ambiguous")
})

test("case D: amount or currency mismatch blocks classification", () => {
  assert.equal(
    classifyLegacyPaid({ receiptLinks: [validLink({ evidenceAmountMinor: 1 })] }),
    "legacy_evidence_financial_mismatch",
  )
  assert.equal(
    classifyLegacyPaid({ receiptLinks: [validLink({ evidenceCurrency: "USD" })] }),
    "legacy_evidence_financial_mismatch",
  )
})

test("migration 036 encodes direct FK lineage and the exact 7/1/1 matrix", () => {
  assert.match(migration, /receipt_link\.payment_request_id\s*=\s*request\.id/)
  assert.match(migration, /snapshot\.payment_request_id\s*=\s*request\.id/)
  assert.match(migration, /snapshot\.source_id\s*=\s*extraordinary_auth\.id/)
  assert.match(migration, /allocation_snapshot\.id\s*=\s*allocation_item\.snapshot_id/)
  assert.match(migration, /allocation_snapshot\.payment_request_id\s*=\s*request\.id/)
  assert.match(migration, /v_consumed\s*<>\s*7/)
  assert.match(migration, /v_quarantined\s*<>\s*1/)
  assert.match(migration, /v_revoked\s*<>\s*1/)
})

test("migration 036 cannot mutate ALLOC-001 tables", () => {
  const updateTargets = [...migration.matchAll(/\bupdate\s+public\.([a-z0-9_]+)/gi)].map((match) => match[1])
  assert.deepEqual([...new Set(updateTargets)], ["payment_request_extraordinary_authorizations"])
  assert.doesNotMatch(migration, /^\s*(delete|truncate)\b/im)
  assert.doesNotMatch(migration, /\bupdate\s+public\.(payment_allocation_plans|payment_allocation_reservations|bank_payment_operations)\b/i)
})

test("standalone precheck is read-only, sanitized and uses the same direct lineage", () => {
  assert.match(standalonePrecheck, /begin transaction read only/)
  assert.match(standalonePrecheck, /LEGACY_DIRECT_LINEAGE_PRECHECK_PASS/)
  assert.match(standalonePrecheck, /allocation_snapshot\.payment_request_id\s*=\s*request\.id/)
  assert.match(standalonePrecheck, /direct_allocation_item_count/)
  assert.match(standalonePrecheck, /rollback;/)
  assert.doesNotMatch(standalonePrecheck, /\bauthorization\.(?:[a-z_*])/i)
  assert.doesNotMatch(migration, /\bauthorization\.(?:[a-z_*])/i)
  assert.doesNotMatch(standalonePrecheck, /select\s+ranked\.id|select\s+request\.id/i)
  assert.doesNotMatch(standalonePrecheck, /^\s*(insert|update|delete|truncate)\b/im)
})
