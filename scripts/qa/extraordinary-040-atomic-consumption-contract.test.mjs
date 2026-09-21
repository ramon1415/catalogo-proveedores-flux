import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8")
const precheck = read("./extraordinary-040-dev-precheck-readonly.sql")
const postcheck = read("./extraordinary-040-dev-postcheck-readonly.sql")
const oldFailure = read("./shadow/040_old_failure_reproduction.sql")
const contracts = read(
  "./shadow/040_consumption_material_guards_contracts.sql",
)
const concurrencyFixture = read("./shadow/040_concurrency_fixture.sql")
const concurrencyAssert = read("./shadow/040_concurrency_assert.sql")
const runner = read("./shadow/run-extraordinary-migrations.ps1")

test("standalone DEV checks are read-only and expose canonical markers", () => {
  for (const sql of [precheck, postcheck]) {
    assert.match(sql, /set session characteristics as transaction read only/)
    assert.match(sql, /begin transaction read only/)
    assert.match(sql, /rollback;\s*$/)
    assert.doesNotMatch(
      sql,
      /^\s*(insert|update|delete|truncate|merge)\b/im,
    )
  }
  assert.match(precheck, /MEJ05_040_CATALOG_PRECHECK_PASS/)
  assert.match(postcheck, /MIGRATION_040_POSTCHECK_PASS/)
})

test("shadow reproduces the defect and exercises atomicity, invalidation and guards", () => {
  assert.match(oldFailure, /SHADOW_040_OLD_CONSUMPTION_DEFECT_REPRODUCED/)
  assert.match(contracts, /SHADOW_040_CONSUMPTION_PASS/)
  assert.match(contracts, /SHADOW_040_MATERIAL_INVALIDATION_PASS/)
  assert.match(contracts, /SHADOW_040_GUARDS_PASS/)
  assert.match(contracts, /shadow_040_forced_event_failure/)
  assert.match(
    contracts,
    /complete_payment_request_layout_data\([\s\S]*'41999'/
  )
  assert.match(contracts, /materially changed/)
})

test("shadow concurrency uses two independent PostgreSQL sessions and one winner", () => {
  assert.match(concurrencyFixture, /shadow-040-concurrent/)
  assert.match(concurrencyAssert, /SHADOW_040_CONCURRENCY_PASS/)
  assert.match(runner, /Start-Job/)
  assert.match(runner, /winnerCount -ne 1/)
  assert.match(runner, /failureCount -ne 1/)
  assert.match(runner, /Invoke-040Concurrency/)
})
