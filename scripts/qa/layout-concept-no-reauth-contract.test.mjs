import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260810175316_layout_concept_no_reauth.sql",
    import.meta.url,
  ),
  "utf8",
)

function dollarBody(tag) {
  const marker = `$${tag}$`
  const start = migration.indexOf(marker)
  assert.notEqual(start, -1, `${tag} must exist`)
  const end = migration.indexOf(marker, start + marker.length)
  assert.notEqual(end, -1, `${tag} must close`)
  return migration.slice(start + marker.length, end)
}

test("migration is transactional, fail-closed, and supports the exact DEV/PROD baselines", () => {
  assert.match(migration, /^begin;/)
  assert.match(migration, /lock table public\.payment_requests in share row exclusive mode/)
  assert.match(
    migration,
    /f7e00297d9231902de5fe07d0aed312e78bf8995c4082851a88251523b7cd677/,
  )
  assert.match(
    migration,
    /8837b98b29bc299b507837c9c3909aa2efb5181ef76033bcdf9667aa9ad00ce8/,
  )
  assert.match(migration, /unexpected material-change baseline/)
  assert.match(migration, /unexpected function security attributes/)
  assert.match(migration, /expected one enabled material-change trigger/)
  assert.match(migration, /commit;\s*$/)
  assert.doesNotMatch(
    migration,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  )
})

test("both target bodies exclude every concept alias and retain economic materiality", () => {
  for (const tag of ["dev_function", "prod_function"]) {
    const body = dollarBody(tag)
    assert.doesNotMatch(body, /payment_concept/)
    assert.doesNotMatch(body, /\b(?:old|new)\.concept\b/)
    assert.doesNotMatch(body, /\b(?:old|new)\.description\b/)
    for (const field of [
      "amount_requested",
      "currency",
      "exchange_rate",
      "request_type",
      "payment_method",
    ]) {
      assert.match(body, new RegExp(`old\\.${field}`))
      assert.match(body, new RegExp(`new\\.${field}`))
    }
  }

  assert.match(dollarBody("prod_function"), /pg_trigger_depth\(\) > 1/)
})

test("isolated trigger probe proves concept is operational while amount remains material", () => {
  assert.match(migration, /create temporary table layout_concept_materiality_probe/)
  assert.match(migration, /payment_concept = coalesce\(payment_concept, ''\) \|\| ' \[probe\]'/)
  assert.match(migration, /concept = coalesce\(concept, ''\) \|\| ' \[probe\]'/)
  assert.match(migration, /description = coalesce\(description, ''\) \|\| ' \[probe\]'/)
  assert.match(migration, /concept-only probe advanced materiality/)
  assert.match(migration, /amount_requested = amount_requested \+ 0\.01/)
  assert.match(migration, /amount probe did not advance materiality/)
  assert.doesNotMatch(migration, /update\s+public\.payment_requests/i)
})
