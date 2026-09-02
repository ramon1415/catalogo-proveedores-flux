import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260902030000_fix_extraordinary_execution_context_recursion.sql",
    import.meta.url,
  ),
  "utf8",
)

test("restored pre-037 execution context cannot recurse into itself", () => {
  assert.match(
    migration,
    /function public\.get_payment_request_execution_context_pre_037\(/,
  )
  assert.doesNotMatch(
    migration,
    /v_base\s*:=\s*public\.get_payment_request_execution_context_pre_037\s*\(/,
  )
})

test("restored base preserves the fields consumed by the secure wrapper and UI", () => {
  for (const field of [
    "is_finance",
    "can_authorize_extraordinary",
    "authorization_block_reason",
    "executed",
    "latest_batch",
    "approval_history",
  ]) {
    assert.match(migration, new RegExp(`'${field}'`))
  }
  assert.match(migration, /security definer/i)
  assert.match(migration, /set search_path = public, pg_temp/i)
})
