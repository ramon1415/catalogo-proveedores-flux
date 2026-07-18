import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")
const bytes = (relative) => fs.readFileSync(path.join(root, relative))

const migrationPath = "supabase/migrations/030_provider_intake_action_fingerprint.sql"
const loadPath = "ops/provider-intake/apply-030-action-fingerprint/03_LOAD_030_EXACT.sql"
const migration029Path = "supabase/migrations/029_provider_intake_triage.sql"
const migration = read(migrationPath)
const postcheck = read(
  "ops/provider-intake/apply-030-action-fingerprint/04_POSTCHECK_READ_ONLY.sql",
)

const functionDefinition = (name) => {
  const pattern = new RegExp(
    `create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  )
  const match = migration.match(pattern)
  assert.ok(match, `missing function definition for ${name}`)
  return match[0]
}

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

test("Migration 030 and its operational LOAD are byte-identical", () => {
  assert.deepEqual(bytes(migrationPath), bytes(loadPath))
})

test("Migration 029 remains byte-identical to the applied contract", () => {
  const digest = crypto.createHash("sha256").update(bytes(migration029Path)).digest("hex")
  assert.equal(digest, "57ab35263fa0a6dfa53aeef1fc1b1fa76fcede2f5d0413e05cea1642f42438eb")
})

test("server helper computes lowercase SHA-256 over canonical material", () => {
  const helper = functionDefinition("provider_intake_action_fingerprint")
  for (const field of [
    "contract_version",
    "operation",
    "payment_intake_id",
    "actor_profile_id",
    "expected_status",
    "expected_updated_at",
    "to_status",
    "notes",
  ]) {
    assert.match(helper, new RegExp(`'${field}'`))
  }
  assert.match(helper, /extensions\.digest\(/)
  assert.match(helper, /'sha256'/)
  assert.match(helper, /pg_catalog\.encode\(/)
  assert.match(helper, /'hex'/)
  assert.match(helper, /at time zone 'UTC'/)
  assert.match(helper, /SS\.US"Z"/)
  assert.doesNotMatch(helper, /\bp_action_id\b/)
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

test("both RPCs write metadata v2 without duplicating material", () => {
  for (const name of ["transition_provider_intake", "add_provider_intake_note"]) {
    const definition = functionDefinition(name)
    assert.match(definition, /'action_id', p_action_id/)
    assert.match(definition, /'action_fingerprint', v_action_fingerprint/)
    assert.match(definition, /'action_kind', '(?:transition|internal_note)'/)
    assert.match(definition, /'contract_version', 2/)
    assert.doesNotMatch(definition, /'expected_status'\s*,/)
    assert.doesNotMatch(definition, /'expected_updated_at'\s*,/)
    assert.doesNotMatch(definition, /'to_status'\s*,/)
  }
})

test("replay compares actor, fingerprint, kind, and version before idempotent return", () => {
  for (const name of ["transition_provider_intake", "add_provider_intake_note"]) {
    const definition = functionDefinition(name)
    const firstReplay = definition.slice(
      definition.indexOf("if found then"),
      definition.indexOf("if v_intake.", definition.indexOf("if found then")),
    )
    assert.match(firstReplay, /actor_profile_id is distinct from v_actor_profile_id/)
    assert.match(firstReplay, /action_fingerprint is distinct from v_action_fingerprint/)
    assert.match(firstReplay, /action_kind is distinct from/)
    assert.match(firstReplay, /contract_version is distinct from '2'/)
    assert.match(firstReplay, /'idempotent', true/)
    assert.doesNotMatch(firstReplay, /update public\.payment_intake/)
    assert.doesNotMatch(firstReplay, /insert into public\.payment_intake_events/)
  }
})

test("material, actor, operation, and legacy conflicts fail closed", () => {
  for (const name of ["transition_provider_intake", "add_provider_intake_note"]) {
    const definition = functionDefinition(name)
    assert.match(definition, /provider_intake_action_id_conflict/)
    assert.match(definition, /provider_intake_action_id_material_conflict/)
    assert.match(definition, /provider_intake_action_id_legacy_conflict/)
    assert.match(definition, /action_fingerprint is null/)
    assert.match(definition, /action_kind is null/)
    assert.match(definition, /contract_version is null/)
  }
})

test("unique-violation handlers repeat all material replay checks", () => {
  for (const name of ["transition_provider_intake", "add_provider_intake_note"]) {
    const handler = functionDefinition(name).split("when unique_violation then")[1]
    assert.ok(handler)
    assert.match(handler, /actor_profile_id is distinct from v_actor_profile_id/)
    assert.match(handler, /action_fingerprint is distinct from v_action_fingerprint/)
    assert.match(handler, /action_kind is distinct from/)
    assert.match(handler, /contract_version is distinct from '2'/)
    assert.match(handler, /provider_intake_action_id_legacy_conflict/)
    assert.match(handler, /provider_intake_action_id_material_conflict/)
  }
})

test("one insert site per RPC and the unique action ID index remain in force", () => {
  for (const name of ["transition_provider_intake", "add_provider_intake_note"]) {
    const definition = functionDefinition(name)
    assert.equal(
      definition.match(/insert into public\.payment_intake_events/g)?.length,
      1,
    )
  }
  assert.match(migration, /payment_intake_events_action_id_uidx/)
})

test("RPC signatures, grants, SECURITY DEFINER, and search path are preserved", () => {
  for (const name of ["transition_provider_intake", "add_provider_intake_note"]) {
    const definition = functionDefinition(name)
    assert.match(definition, /returns jsonb/)
    assert.match(definition, /volatile\s+security definer/)
    assert.match(definition, /set search_path = public, pg_temp/)
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to authenticated;`),
    )
  }
  assert.doesNotMatch(migration, /grant execute[\s\S]{0,180}\bto anon\b/i)
})

test("operational postcheck never wraps an aggregate in EXISTS", () => {
  assert.doesNotMatch(postcheck, /exists\s*\(\s*select\s+count\s*\(/i)
})

test("Migration 030 has no business-table or ledger-destructive operations", () => {
  assert.doesNotMatch(migration, /\bdrop\s+(table|constraint|trigger|index)\b/i)
  assert.doesNotMatch(migration, /\b(delete|truncate)\b/i)
  assert.doesNotMatch(
    migration,
    /\binsert\s+into\s+public\.(payment_requests|proveedores|providers|approval_batches|payment_layouts|payment_layout_lines|cash_funds)\b/i,
  )
  assert.doesNotMatch(
    migration,
    /\bupdate\s+public\.(payment_requests|proveedores|providers|approval_batches|payment_layouts|payment_layout_lines|cash_funds)\b/i,
  )
})
