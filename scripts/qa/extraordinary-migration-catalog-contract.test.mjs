import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration036 = readFileSync(
  new URL("../../supabase/migrations/036_quarantine_legacy_extraordinary_authorizations.sql", import.meta.url),
  "utf8",
)
const migration037 = readFileSync(
  new URL("../../supabase/migrations/037_secure_extraordinary_external_authorization.sql", import.meta.url),
  "utf8",
)
const devCatalog = JSON.parse(
  readFileSync(new URL("./extraordinary-dev-catalog-contract.json", import.meta.url), "utf8"),
)

const canonicalStatus = "payment_request_extraordinary_status_check"
const wrongStatus = [
  "payment_request",
  "extraordinary",
  "authorizations",
  "status",
  "check",
].join("_")

function explicitIdentifiers(sql) {
  const patterns = [
    ["constraint", /^\s*(?:add\s+)?constraint\s+([a-z][a-z0-9_]*)/gim],
    ["index", /^\s*create\s+(?:unique\s+)?index\s+([a-z][a-z0-9_]*)/gim],
    ["trigger", /^\s*create\s+trigger\s+([a-z][a-z0-9_]*)/gim],
    ["policy", /^\s*create\s+policy\s+([a-z][a-z0-9_]*)/gim],
    [
      "function",
      /^\s*create\s+(?:or\s+replace\s+)?function\s+public\.([a-z][a-z0-9_]*)/gim,
    ],
    ["function", /^\s*alter\s+function[\s\S]*?\srename\s+to\s+([a-z][a-z0-9_]*)/gim],
  ]
  return patterns.flatMap(([kind, pattern]) =>
    [...sql.matchAll(pattern)].map((match) => ({ kind, name: match[1] })),
  )
}

function assertOneExplicitTransaction(sql) {
  assert.equal((sql.match(/^\s*begin;\s*$/gim) || []).length, 1)
  assert.equal((sql.match(/^\s*commit;\s*$/gim) || []).length, 1)
  assert.match(sql, /\ncommit;\s*$/)
}

function assertIdentifierContract(sql) {
  const identifiers = explicitIdentifiers(sql)
  assert.ok(identifiers.length > 0)

  const overLimit = identifiers.filter(
    ({ name }) => Buffer.byteLength(name, "utf8") > 63,
  )
  assert.deepEqual(overLimit, [])

  const truncationKeys = new Map()
  for (const identifier of identifiers) {
    const truncated = Buffer.from(identifier.name, "utf8")
      .subarray(0, 63)
      .toString("utf8")
    const key = `${identifier.kind}:${truncated}`
    const prior = truncationKeys.get(key)
    if (prior && prior !== identifier.name) {
      assert.fail(
        `identifier truncation collision: ${identifier.kind} ${prior} / ${identifier.name}`,
      )
    }
    truncationKeys.set(key, identifier.name)
  }
}

test("sanitized DEV inventory records the canonical pre-036 catalog", () => {
  assert.equal(devCatalog.project_ref, "scsirgbuqjcwoaxfacth")
  assert.deepEqual(devCatalog.status_counts, { active: 8, revoked: 1 })
  assert.equal(devCatalog.identifier_over_63_bytes, 0)
  assert.deepEqual(
    devCatalog.constraints.map(({ name }) => name),
    [
      "payment_request_extraordinary_authoriza_payment_request_id_fkey",
      "payment_request_extraordinary_authorizations_authorized_by_fkey",
      "payment_request_extraordinary_authorizations_pkey",
      "payment_request_extraordinary_authorizations_revoked_by_fkey",
      "payment_request_extraordinary_category_check",
      "payment_request_extraordinary_reason_check",
      "payment_request_extraordinary_revoke_check",
      canonicalStatus,
    ],
  )
  assert.deepEqual(
    devCatalog.indexes.map(({ name }) => name),
    [
      "payment_request_extraordinary_active_uidx",
      "payment_request_extraordinary_authorizations_pkey",
      "payment_request_extraordinary_request_idx",
    ],
  )
  assert.deepEqual(
    devCatalog.triggers.map(({ name }) => name),
    [
      "enqueue_extraordinary_payment_notification",
      "materialize_extraordinary_payable_snapshot",
      "set_payment_request_extraordinary_updated_at",
    ],
  )
  assert.equal(devCatalog.functions.length, 9)
  assert.equal(devCatalog.function_grants.length, 18)
  assert.equal(
    devCatalog.function_grants.filter(
      ({ grantee, function: functionName }) =>
        grantee === "authenticated"
        && functionName.startsWith(
          "public.authorize_payment_request_extraordinary(",
        ),
    ).length,
    1,
  )
})

test("036 replaces mandatory canonical checks before legacy classification", () => {
  assert.match(
    migration036,
    new RegExp(`drop constraint ${canonicalStatus};`, "i"),
  )
  assert.match(
    migration036,
    new RegExp(`add constraint ${canonicalStatus}\\s+check`, "i"),
  )
  assert.doesNotMatch(migration036, new RegExp(wrongStatus, "i"))
  assert.doesNotMatch(
    migration036,
    new RegExp(`drop constraint if exists ${canonicalStatus}`, "i"),
  )
  assert.doesNotMatch(
    migration036,
    /drop constraint if exists payment_request_extraordinary_revoke_check/i,
  )

  const statusDrop = migration036.indexOf(`drop constraint ${canonicalStatus}`)
  const revokeDrop = migration036.indexOf(
    "drop constraint payment_request_extraordinary_revoke_check",
  )
  const statusAdd = migration036.indexOf(
    `add constraint ${canonicalStatus}`,
  )
  const revokeAdd = migration036.indexOf(
    "add constraint payment_request_extraordinary_revoke_check",
  )
  const legacyAdd = migration036.indexOf(
    "add constraint payment_request_extraordinary_legacy_class_check",
  )
  const firstLegacyUpdate = migration036.indexOf(
    "update public.payment_request_extraordinary_authorizations extraordinary_auth",
  )
  assert.ok(statusDrop > 0)
  assert.ok(revokeDrop > statusDrop)
  assert.ok(statusAdd > revokeDrop)
  assert.ok(revokeAdd > statusAdd)
  assert.ok(legacyAdd > revokeAdd && legacyAdd < firstLegacyUpdate)
  assertOneExplicitTransaction(migration036)
})

test("037 replaces the same canonical check before any draft insert", () => {
  assert.match(
    migration037,
    new RegExp(`drop constraint ${canonicalStatus};`, "i"),
  )
  assert.match(
    migration037,
    new RegExp(`add constraint ${canonicalStatus}\\s+check`, "i"),
  )
  assert.doesNotMatch(migration037, new RegExp(wrongStatus, "i"))
  assert.doesNotMatch(
    migration037,
    new RegExp(`drop constraint if exists ${canonicalStatus}`, "i"),
  )

  const statusDrop = migration037.indexOf(`drop constraint ${canonicalStatus}`)
  const firstDraftInsert = migration037.indexOf(
    "insert into public.payment_request_extraordinary_authorizations",
  )
  assert.ok(statusDrop > 0 && statusDrop < firstDraftInsert)
  assertOneExplicitTransaction(migration037)
})

test("explicit PostgreSQL identifiers fit in 63 bytes without truncation collisions", () => {
  assertIdentifierContract(migration036)
  assertIdentifierContract(migration037)
})

test("036 and 037 each create one canonical status check", () => {
  for (const migration of [migration036, migration037]) {
    const adds = migration.match(
      new RegExp(`add constraint ${canonicalStatus}\\s+check`, "gi"),
    ) || []
    assert.equal(adds.length, 1)
  }
})

test("revoke and lifecycle checks preserve legacy while hardening new states", () => {
  assert.match(
    migration036,
    /status <> 'revoked'[\s\S]*revoked_by is null[\s\S]*revoke_reason is null/i,
  )
  assert.match(
    migration037,
    /status in \(\s*'legacy_consumed_unverified',\s*'legacy_quarantined',\s*'revoked'\s*\)\s*or/i,
  )
  assert.match(migration037, /status = 'draft'/i)
  assert.match(migration037, /evidence_storage_bucket = 'extraordinary-approval-evidence'/i)
})
