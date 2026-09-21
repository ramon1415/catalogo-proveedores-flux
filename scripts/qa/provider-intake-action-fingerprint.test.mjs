import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")
const postcheck = read(
  "ops/provider-intake/apply-030-action-fingerprint/04_POSTCHECK_READ_ONLY.sql",
)

const stableObject = (value) => {
  if (Array.isArray(value)) return value.map(stableObject)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableObject(item)]),
    )
  }
  return value
}

const normalizedNotes = (value) => {
  const trimmed = String(value ?? "").trim()
  return trimmed || null
}

const fingerprintModel = ({
  contractVersion = 2,
  operation,
  intake = "11111111-1111-4111-8111-111111111111",
  actor = "22222222-2222-4222-8222-222222222222",
  expectedStatus = null,
  expectedUpdatedAt = "2026-01-01T12:34:56.123Z",
  toStatus = null,
  notes = null,
}) => {
  const canonical = stableObject({
    actor_profile_id: actor,
    contract_version: contractVersion,
    expected_status: expectedStatus,
    expected_updated_at: new Date(expectedUpdatedAt).toISOString(),
    notes: normalizedNotes(notes),
    operation,
    payment_intake_id: intake,
    to_status: toStatus,
  })
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}

const base = Object.freeze({
  operation: "transition",
  expectedStatus: "received",
  toStatus: "in_review",
  notes: "Nota QA",
})

test("fingerprint model is deterministic and produces lowercase 64-hex", () => {
  const first = fingerprintModel(base)
  const second = fingerprintModel({ ...base })
  assert.equal(first, second)
  assert.match(first, /^[0-9a-f]{64}$/)
})

test("each material transition field changes the fingerprint", () => {
  const original = fingerprintModel(base)
  const variants = [
    { expectedStatus: "in_review" },
    { expectedUpdatedAt: "2026-01-01T12:34:56.124Z" },
    { toStatus: "rejected" },
    { notes: "Otra nota QA" },
    { actor: "33333333-3333-4333-8333-333333333333" },
  ]
  for (const variant of variants) {
    assert.notEqual(fingerprintModel({ ...base, ...variant }), original)
  }
})

test("trim-equivalent notes model the same RPC material", () => {
  assert.equal(
    fingerprintModel({ ...base, notes: "  Nota QA  " }),
    fingerprintModel({ ...base, notes: "Nota QA" }),
  )
})

test("transition and internal note fingerprints cannot collide by operation", () => {
  assert.notEqual(
    fingerprintModel(base),
    fingerprintModel({
      operation: "internal_note",
      expectedStatus: null,
      toStatus: null,
      notes: "Nota QA",
    }),
  )
})

test("operational postcheck never wraps an aggregate in EXISTS", () => {
  assert.doesNotMatch(postcheck, /exists\s*\(\s*select\s+count\s*\(/i)
})
