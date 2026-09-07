import assert from 'node:assert/strict'
import test from 'node:test'
import { functionDefinition } from '../database-catalog.mjs'
const functionBody = functionDefinition
const extractFunction = functionDefinition

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
