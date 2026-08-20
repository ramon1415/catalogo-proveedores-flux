import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const migrationPath = new URL(
  "supabase/migrations/20260820170602_prod_request_number_and_legacy_backup_hardening.sql",
  root,
);
const migration = readFileSync(migrationPath, "utf8");
const fixture = readFileSync(
  new URL("scripts/qa/prod-hardening-h1-shadow-fixture.sql", root),
  "utf8",
);
const assertions = readFileSync(
  new URL("scripts/qa/prod-hardening-h1-shadow-assertions.sql", root),
  "utf8",
);

test("migration is transactional, forward-only, and data-neutral", () => {
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(migration, /set local lock_timeout = '5s'/);
  assert.match(migration, /set local statement_timeout = '60s'/);
  assert.doesNotMatch(migration, /^\s*(?:insert\s+into|update|delete\s+from|truncate\s+table)\b/im);
  assert.doesNotMatch(migration, /\bmigration\s+repair\b|\bdrop\s+(?:table|column)\b|\bcascade\b/i);
  assert.doesNotMatch(migration, /alter\s+column\s+request_number\s+set\s+not\s+null/i);
  assert.doesNotMatch(migration, /notifications?|payroll|n8n|provider_intake_runtime_control/i);
});

test("request number hardening preserves the sequence-backed lifecycle", () => {
  assert.match(migration, /payment_request_number_seq/);
  assert.match(migration, /generate_payment_request_number\(integer\)/);
  assert.match(migration, /position\('nextval\('/);
  assert.match(migration, /position\('payment_request_number_seq'/);
  assert.match(
    migration,
    /add constraint payment_requests_request_number_key unique \(request_number\)/,
  );
  assert.match(migration, /request_number is not null[\s\S]*having count\(\*\) > 1/);
  assert.match(assertions, /when unique_violation then null/);
  assert.match(assertions, /nullable request number lifecycle changed/);
});

test("legacy provider backup is deny-by-default for application roles", () => {
  assert.match(
    migration,
    /alter table public\.zzbackup_proveedores_20260709 enable row level security/,
  );
  assert.match(
    migration,
    /revoke all privileges on table public\.zzbackup_proveedores_20260709 from public, anon, authenticated/,
  );
  assert.doesNotMatch(migration, /create\s+policy/i);
  assert.match(migration, /service_role_bypass_contract_missing/);
  assert.match(migration, /legacy_provider_backup_service_role_privilege_lost/);
  assert.match(assertions, /legacy backup rows changed/);
});

test("shadow fixture proves behavior without real business data", () => {
  assert.match(fixture, /Synthetic Provider A/);
  assert.doesNotMatch(fixture, /SOL-2026-|ucantptjhwttexzmslvm|scsirgbuqjcwoaxfacth/);
  assert.match(assertions, /NOTIFICATION_REGRESSION_DELTA=0/);
});

test("candidate scope is exact and excludes runtime releases", () => {
  const base = execFileSync("git", ["merge-base", "origin/main", "HEAD"], {
    cwd: new URL(".", root),
    encoding: "utf8",
  }).trim();
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", `${base}...HEAD`],
    { cwd: new URL(".", root), encoding: "utf8" },
  ).trim().split(/\r?\n/).filter(Boolean);
  const allowed = new Set([
    ".github/workflows/prod-hardening-h1-candidate.yml",
    "scripts/qa/prod-hardening-h1-contract.test.mjs",
    "scripts/qa/prod-hardening-h1-shadow-assertions.sql",
    "scripts/qa/prod-hardening-h1-shadow-fixture.sql",
    "supabase/migrations/20260820170602_prod_request_number_and_legacy_backup_hardening.sql",
  ]);
  for (const file of changed) assert.ok(allowed.has(file), `unexpected H1 scope: ${file}`);
});

test("notification, Provider Portal, and payroll bytes remain at main", () => {
  const base = execFileSync("git", ["merge-base", "origin/main", "HEAD"], {
    cwd: new URL(".", root),
    encoding: "utf8",
  }).trim();
  for (const file of [
    "supabase/functions/notification-dispatcher/index.ts",
    "supabase/functions/provider-intake/index.ts",
    "api/runtime-config.js",
    "solicitudes.js",
  ]) {
    const expected = execFileSync("git", ["show", `${base}:${file}`], {
      cwd: new URL(".", root),
      encoding: "utf8",
    });
    const actual = readFileSync(new URL(file, root), "utf8");
    assert.equal(
      actual.replace(/\r\n/g, "\n"),
      expected.replace(/\r\n/g, "\n"),
      `${file} drifted from current main`,
    );
  }
});
