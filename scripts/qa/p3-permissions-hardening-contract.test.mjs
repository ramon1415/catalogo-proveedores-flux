import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/044_harden_approval_rules_for_explicit_routing.sql",
  import.meta.url,
);
const documentationUrl = new URL(
  "../../docs/ops/p3-permissions-dev.md",
  import.meta.url,
);

const migration = await readFile(migrationUrl, "utf8");
const documentation = await readFile(documentationUrl, "utf8");

test("Migration 044 is transactional and forward-only", () => {
  assert.match(migration, /^begin;$/m);
  assert.match(migration, /^commit;$/m);
  assert.doesNotMatch(migration, /\b(drop|truncate)\s+(table|schema)\b/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
  assert.doesNotMatch(migration, /migration\s+repair|db\s+reset|db\s+push/i);
});

test("Migration 044 targets only the five financial catch-all families", () => {
  for (const role of [
    "administracion",
    "finance",
    "finanzas",
    "tesoreria",
    "treasury",
  ]) {
    assert.match(migration, new RegExp(`'${role}'`));
  }

  for (const privilegedRole of [
    "admin",
    "superadmin",
    "sysadmin",
    "system_admin",
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(`'${privilegedRole}'`),
    );
  }

  assert.match(migration, /company_id is null/i);
  assert.match(migration, /cost_center_id is null/i);
  assert.match(migration, /amount_max is null/i);
  assert.match(migration, /set active = false/i);
});

test("Migration 044 contains a fail-closed postcheck", () => {
  assert.match(migration, /v_active_catch_all <> 0/i);
  assert.match(
    migration,
    /p3_permissions_financial_catch_all_remains/i,
  );
  assert.match(migration, /information_schema\.columns/i);
});

test("P3 does not materialize directors or environment identities", () => {
  assert.doesNotMatch(migration, /company_directors/i);
  assert.doesNotMatch(
    migration,
    /francisco|alfredo|yanin|felipe|c[eé]sar|admin-temporal/i,
  );
});

test("Documentation preserves dynamic multi-director behavior", () => {
  assert.match(documentation, /operational snapshot/i);
  assert.match(documentation, /no person name or identifier may be hardcoded/i);
  assert.match(documentation, /zero, one or multiple active directors/i);
  assert.match(documentation, /034_support_multiple_active_company_directors/i);
  assert.match(documentation, /P3 does not write `company_directors`/i);
});
