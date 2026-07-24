import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/038_materialize_only_released_batch_items.sql",
    import.meta.url,
  ),
  "utf8",
)

const replacement = migration.slice(
  migration.indexOf(
    "create or replace function public.materialize_closed_batch_payable_snapshots()",
  ),
  migration.indexOf("do $postcheck$"),
)

test("A/H: mixed close materializes released items and ignores blocked siblings", () => {
  assert.match(replacement, /item\.finance_release_status = 'released'/)
  assert.doesNotMatch(replacement, /finance_release_status\s*=\s*'blocked'/)
  assert.match(replacement, /create_payable_snapshot_internal/)
})

test("B: all-ready batches keep the canonical per-item materialization loop", () => {
  assert.match(replacement, /for v_item in[\s\S]*loop/)
  assert.match(replacement, /perform public\.create_payable_snapshot_internal/)
})

test("C: zero released items create zero snapshots", () => {
  assert.match(replacement, /where item\.batch_id = new\.id/)
  assert.match(replacement, /item\.finance_release_status = 'released'/)
  assert.doesNotMatch(replacement, /insert into public\.payable_snapshots/i)
})

test("D: released inconsistencies remain fail-closed in the canonical helper", () => {
  assert.match(replacement, /create_payable_snapshot_internal/)
  assert.doesNotMatch(replacement, /exception when|on conflict do nothing/i)
  assert.match(
    migration,
    /canonical_definition_md5[\s\S]*create_payable_snapshot_internal/,
  )
})

test("E: idempotency and source uniqueness are not reimplemented or weakened", () => {
  assert.doesNotMatch(replacement, /on conflict|insert into public\.payable_snapshots/i)
  assert.match(migration, /payable_snapshots[\s\S]*business row counts changed during LOAD/)
})

test("F: removed items are excluded", () => {
  assert.match(replacement, /item\.removed_at is null/)
})

test("G: rejected items cannot materialize even with inconsistent release data", () => {
  assert.match(replacement, /item\.director_status = 'approved'/)
  assert.match(replacement, /item\.finance_release_status = 'released'/)
})

test("migration is forward-only, transactional and does not mutate business rows", () => {
  assert.match(migration, /^begin;/m)
  assert.match(migration, /^commit;/m)
  assert.doesNotMatch(migration, /\b(?:delete|truncate)\b/i)
  assert.doesNotMatch(migration, /\b(?:insert|update)\s+public\./i)
  assert.match(migration, /MIGRATION_038_POSTCHECK_PASS/)
})

test("precheck proves the known defect and refuses an unknown prior correction", () => {
  assert.match(
    migration,
    /item\.director_status = ''approved''[\s\S]*known 032 contract/,
  )
  assert.match(
    migration,
    /item\.finance_release_status = ''released''[\s\S]*correction already exists/,
  )
})

test("postcheck preserves trigger, grants, adjacent functions and business counts", () => {
  assert.match(migration, /trigger definition changed/)
  assert.match(migration, /materializer attributes or grants changed/)
  assert.match(migration, /adjacent function changed during LOAD/)
  assert.match(migration, /business row counts changed during LOAD/)
})
