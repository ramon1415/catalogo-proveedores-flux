import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8")

const migration = read(
  "../../supabase/migrations/040_fix_extraordinary_consumption_and_material_invalidation.sql",
)
const precheck = read("./extraordinary-040-dev-precheck-readonly.sql")
const postcheck = read("./extraordinary-040-dev-postcheck-readonly.sql")
const oldFailure = read("./shadow/040_old_failure_reproduction.sql")
const contracts = read(
  "./shadow/040_consumption_material_guards_contracts.sql",
)
const concurrencyFixture = read("./shadow/040_concurrency_fixture.sql")
const concurrencyAssert = read("./shadow/040_concurrency_assert.sql")
const runner = read("./shadow/run-extraordinary-migrations.ps1")

test("040 is transactional and refuses drift, partial install and residual UAT state", () => {
  assert.match(migration, /^\\set ON_ERROR_STOP on\s+begin;/)
  assert.match(migration, /migration 036 is not installed/)
  assert.match(migration, /migration 037 is not installed/)
  assert.match(migration, /migration 038 is not installed/)
  assert.match(migration, /migration 039 or its final ACL is absent/)
  assert.match(migration, /partial or complete 040 helper exists/)
  assert.match(migration, /residual secure draft or active authorization exists/)
  assert.match(migration, /Operadora extraordinary policy is enabled/)
  assert.match(migration, /vulnerable AFTER readiness recheck is absent/)
  assert.match(migration, /vulnerable material UPDATE OF trigger is absent/)
  assert.match(migration, /MIGRATION_040_STATIC_POSTCHECK_PASS/)
  assert.match(migration, /commit;\s*$/)
})

test("BEFORE validator preserves readiness and closes the post-lock race", () => {
  assert.match(
    migration,
    /create or replace function public\.extraordinary_validate_layout_line\(\)/,
  )
  assert.match(migration, /status in \([\s\S]*'revoked'/)
  assert.match(migration, /limit 1\s+for update;/)
  assert.match(migration, /extraordinary_authorization_is_ready/)
  assert.match(migration, /secure_extraordinary_authorization_changed/)
  assert.match(migration, /secure_extraordinary_company_mismatch/)
  assert.match(migration, /secure_extraordinary_layout_not_available/)
})

test("AFTER consumer allows only the current line and transitions exactly once", () => {
  const consumer = migration.slice(
    migration.indexOf(
      "create or replace function public.extraordinary_consume_layout_line()",
    ),
    migration.indexOf(
      "drop trigger invalidate_extraordinary_on_material_change",
    ),
  )
  assert.doesNotMatch(consumer, /extraordinary_authorization_is_ready/)
  assert.match(
    consumer,
    /extraordinary_authorization_can_consume_layout_line/,
  )
  assert.match(consumer, /for update/)
  assert.match(consumer, /consumed_layout_id = new\.layout_id/)
  assert.match(consumer, /consumed_layout_line_id = new\.id/)
  assert.match(consumer, /get diagnostics v_updated = row_count/)
  assert.match(consumer, /if v_updated <> 1/)
  assert.match(consumer, /authorization_consumed/)
})

test("post-insert predicate remains internal, side-effect-free and fail-closed", () => {
  const helper = migration.slice(
    migration.indexOf(
      "create function public.extraordinary_authorization_can_consume_layout_line",
    ),
    migration.indexOf(
      "create or replace function public.extraordinary_validate_layout_line()",
    ),
  )
  assert.match(helper, /other_line\.id <> line\.id/)
  assert.match(helper, /public\.cash_funds/)
  assert.match(helper, /public\.payment_receipts/)
  assert.match(helper, /public\.payment_request_receipt_links/)
  assert.match(helper, /public\.payment_allocation_items/)
  assert.match(helper, /public\.payment_allocation_movements/)
  assert.match(helper, /public\.payment_allocation_reservations/)
  assert.match(helper, /authorization\.valid_until|extraordinary_auth\.valid_until/)
  assert.match(helper, /request\.approval_material_updated_at/)
  assert.match(
    helper,
    /revoke all on function[\s\S]*from public, anon, authenticated/,
  )
  assert.doesNotMatch(
    helper.slice(
      helper.indexOf("as $$"),
      helper.indexOf("$$;", helper.indexOf("as $$")),
    ),
    /\b(insert|update|delete|truncate|merge|execute|format)\b/i,
  )
})

test("material invalidation uses the row image instead of UPDATE OF", () => {
  const trigger = migration.slice(
    migration.indexOf(
      "drop trigger invalidate_extraordinary_on_material_change",
    ),
    migration.indexOf("do $postcheck$"),
  )
  assert.match(trigger, /after update on public\.payment_requests/)
  assert.match(
    trigger,
    /old\.approval_material_updated_at\s+is distinct from\s+new\.approval_material_updated_at/,
  )
  assert.doesNotMatch(trigger, /after update of/)
})

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

test("040 does not touch Storage definitions or frontend service credentials", () => {
  assert.doesNotMatch(migration, /create policy|alter policy|drop policy/i)
  assert.doesNotMatch(
    migration,
    /\b(create|alter|drop)\s+(?:table|policy|trigger|function)\s+storage\./i,
  )
  assert.doesNotMatch(migration, /service[_-]?role[_-]?key/i)
})
