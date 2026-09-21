import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
const privateBackup = readFileSync(
  new URL("./post-yanin-036-037-private-logical-backup.sql", import.meta.url),
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

test("private logical backup is read-only and covers legacy plus ALLOC state", () => {
  assert.match(privateBackup, /begin transaction read only/)
  assert.match(privateBackup, /legacy_authorizations/)
  assert.match(privateBackup, /allocation_plans/)
  assert.match(privateBackup, /allocation_reservations/)
  assert.match(privateBackup, /bank_operations/)
  assert.match(privateBackup, /replaced_function_definitions/)
  assert.match(privateBackup, /affected_trigger_definitions/)
  assert.match(privateBackup, /rollback;/)
  assert.doesNotMatch(privateBackup, /^\s*(insert|update|delete|truncate|create|alter|drop)\b/im)
})
