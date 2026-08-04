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
  assert.match(migration, /do \$migration\$/);
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
    assert.doesNotMatch(migration, new RegExp(`'${privilegedRole}'`));
  }

  assert.match(migration, /company_id is null/i);
  assert.match(migration, /cost_center_id is null/i);
  assert.match(migration, /coalesce\(rule\.amount_min, 0\) = 0/i);
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

test("Migration 044 contains no environment identity or director hardcode", () => {
  assert.doesNotMatch(migration, /company_directors/i);
  assert.doesNotMatch(migration, /@[a-z0-9.-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(
    migration,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
  assert.doesNotMatch(migration, /c[eé]sar/i);
});

test("Runbook records the release-specific identity decision", () => {
  assert.match(
    documentation,
    /Por decisión operativa de este release, los usuarios nominales no se crearán\s+en DEV\./i,
  );
  assert.match(
    documentation,
    /validación funcional fue realizada con usuarios equivalentes/i,
  );
  assert.match(
    documentation,
    /dados de alta por Ramón\s+directamente en PROD mediante el módulo web/i,
  );
  assert.doesNotMatch(
    documentation,
    /SECURITY_POLICY_PROHIBITS_NAMED_PRODUCTION_USERS_IN_DEV/i,
  );
  assert.match(
    documentation,
    /not a general security\s+policy prohibiting named users in DEV/i,
  );
});

test("Runbook forbids nominal DEV seed, memberships and routing", () => {
  const devSection = documentation.match(
    /### DEV([\s\S]*?)### PROD/i,
  )?.[1] ?? "";

  assert.ok(devSection);
  assert.match(devSection, /No identity SQL seed is executed/i);
  assert.match(devSection, /No nominal memberships are created/i);
  assert.match(devSection, /No nominal approval routing is configured/i);
  assert.doesNotMatch(devSection, /→/);
  assert.doesNotMatch(
    devSection,
    /\b(apply|execute|create|resolve|configure)\b[^\n]*\b(seed|membership|routing)\b/i,
  );
});

test("Runbook assigns PROD configuration to Ramón through the platform", () => {
  const prodSection = documentation.match(
    /### PROD([\s\S]*?)## Directors/i,
  )?.[1] ?? "";

  assert.ok(prodSection);
  assert.match(prodSection, /Ramón will create or enable the real users/i);
  assert.match(prodSection, /assign company, roles, permissions and assignments/i);
  assert.match(prodSection, /configure the correct approval routes/i);
  assert.match(prodSection, /No SQL identity seed will be used/i);
  assert.match(prodSection, /No UUID, email address or person will be hardcoded/i);
});

test("Runbook records the applied migration and completed DEV UAT", () => {
  for (const state of [
    "M044=APPLIED_ONCE",
    "M044_HISTORY_VERSION=20260804210918",
    "MANUAL_DEV_UAT=PASS",
    "UAT_MODE=EQUIVALENT_EXISTING_USERS",
    "DEV_NAMED_USER_CONFIGURATION=NOT_REQUIRED",
    "PROD_NAMED_USER_CONFIGURATION=PENDING_RAMON",
    "PROD_MUTATIONS=0",
  ]) {
    assert.match(documentation, new RegExp(state));
  }

  assert.doesNotMatch(
    documentation,
    /M044=NOT_APPLIED|UAT=NOT_EXECUTED|DEV_SEED=NOT_APPLIED/i,
  );
});

test("Documentation preserves dynamic multi-director behavior", () => {
  assert.match(documentation, /no person name or identifier is hardcoded/i);
  assert.match(documentation, /zero, one or multiple active directors/i);
  assert.match(documentation, /034_support_multiple_active_company_directors/i);
  assert.match(documentation, /P3 does not write `company_directors`/i);
  assert.doesNotMatch(documentation, /c[eé]sar/i);
});

test("Runbook contains no UUID or email address", () => {
  assert.doesNotMatch(
    documentation,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
  assert.doesNotMatch(documentation, /@[a-z0-9.-]+\.[a-z]{2,}/i);
});
