import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowPath = ".github/workflows/supabase-prod-main-exact-migration.yml";
const ciPath = ".github/workflows/prod-main-exact-migration-contract.yml";
const workflow = readFileSync(workflowPath, "utf8");
const ci = readFileSync(ciPath, "utf8");

const exactVersion = "20260820170602";
const exactSha = "58c2cc6d1532ca53a53e6550356c2988bf3f45e556df66bb7ec826f950ea390d";
const exactPath = `supabase/migrations/${exactVersion}_prod_request_number_and_legacy_backup_hardening.sql`;

test("release workflow is dispatch-only and least privilege", () => {
  const triggerBlock = workflow.match(/^on:\n([\s\S]*?)\npermissions:/m)?.[1] ?? "";
  assert.match(triggerBlock, /^  workflow_dispatch:/m);
  assert.doesNotMatch(triggerBlock, /^  (push|pull_request|schedule|repository_dispatch):/m);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(workflow, /contents:\s*write|pull-requests:\s*write|issues:\s*write/);
});

test("inputs separate preflight from exact explicitly confirmed apply", () => {
  for (const input of ["mode", "expected_main_sha", "expected_migration_version", "expected_migration_sha256", "confirm_prod", "confirm_apply"]) {
    assert.match(workflow, new RegExp(`^      ${input}:`, "m"));
  }
  assert.match(workflow, /^          - preflight$/m);
  assert.match(workflow, /^          - apply$/m);
  assert.match(workflow, /APPLY-EXACT-MIGRATION-20260820170602/);
  assert.match(workflow, /if: inputs\.mode == 'apply'/);
  assert.match(workflow, /if: inputs\.mode == 'preflight'/);
  assert.match(workflow, /APPLY_CONFIRMATION_FORBIDDEN_IN_PREFLIGHT/);
});

test("current main is the only Git authority and checkout is immutable", () => {
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /git\/ref\/heads\/main/);
  assert.match(workflow, /expected_is_live_main/);
  assert.match(workflow, /workflow_sha_is_live_main/);
  assert.match(workflow, /uses: actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.match(workflow, /ref: \$\{\{ inputs\.expected_main_sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /ref:\s*(dev|\$\{\{\s*github\.head_ref)|git\/ref\/heads\/dev/);
});

test("PROD and the authorized migration are hard-coded and input-verified", () => {
  assert.match(workflow, /EXPECTED_PROD_REF: ucantptjhwttexzmslvm/);
  assert.match(workflow, /EXPECTED_PROD_NAME: financieraflux/);
  assert.match(workflow, /environment: supabase-production/);
  assert.match(workflow, new RegExp(`TARGET_VERSION: "${exactVersion}"`));
  assert.match(workflow, new RegExp(exactPath.replaceAll(".", "\\.")));
  assert.match(workflow, new RegExp(`TARGET_SHA256: ${exactSha}`));
  assert.match(workflow, /MIGRATION_FILENAME_VERSION_MISMATCH/);
  assert.match(workflow, /MIGRATION_CANONICAL_SHA_MISMATCH/);
  assert.match(workflow, /PROD_IDENTITY_MISMATCH/);
  assert.doesNotMatch(workflow, /scsirgbuqjcwoaxfacth/);
});

test("preflight uses a remote-history mirror and requires the exact one-item dry run", () => {
  assert.match(workflow, /select version from supabase_migrations\.schema_migrations order by version/);
  assert.match(workflow, /remote_history\.sql/);
  assert.match(workflow, /\[\[ "\$version" =~ \^\[0-9\]\+\$ \]\]/);
  assert.match(workflow, /db push[\s\S]*--dry-run --include-all/);
  assert.match(workflow, /versions == expected/);
  assert.match(workflow, /"pending_count": len\(versions\)/);
  assert.match(workflow, /DRY_RUN_PENDING_SET_MISMATCH/);
  assert.match(workflow, /cmp --silent "\$EVIDENCE_DIR\/prewrite\.json" "\$EVIDENCE_DIR\/post-dry-run\.json"/);
  assert.match(workflow, /"business_writes": 0/);
  assert.match(workflow, /"prod_schema_writes": 0/);
});

test("apply reuses the exact mirror and enforces ledger and H1 postconditions", () => {
  assert.match(workflow, /cd "\$RELEASE_DIR"[\s\S]*db push[\s\S]*--include-all --yes/);
  assert.match(workflow, /version='20260820170602' and name='prod_request_number_and_legacy_backup_hardening'/);
  assert.match(workflow, /exact_history_delta/);
  assert.match(workflow, /added == \[os\.environ\["TARGET_VERSION"\]\]/);
  for (const marker of [
    "request_number_unique",
    "request_number_remains_nullable",
    "request_numbers_unchanged",
    "payment_requests_unchanged",
    "request_sequence_unchanged",
    "backup_rows_unchanged",
    "backup_rls_enabled",
    "backup_policies_zero",
    "backup_public_roles_revoked",
    "backup_privileged_roles_preserved",
    "provider_runtime_unchanged",
    "notifications_unchanged",
  ]) assert.match(workflow, new RegExp(marker));
});

test("forbidden release mechanisms and unrelated mutation surfaces are absent", () => {
  assert.doesNotMatch(workflow, /migration\s+repair/i);
  assert.doesNotMatch(workflow, /insert\s+into\s+supabase_migrations\.schema_migrations/i);
  assert.doesNotMatch(workflow, /update\s+supabase_migrations\.schema_migrations/i);
  assert.doesNotMatch(workflow, /apply_migration|mcp[_ -]?apply/i);
  assert.doesNotMatch(workflow, /functions\s+(deploy|invoke)|resend|payroll/i);
  assert.doesNotMatch(workflow, /\b(git push|gh pr|gh issue)\b/i);
  assert.equal((workflow.match(/db push[\s\\]*\n?/g) ?? []).length >= 2, true);
});

test("PR CI is non-PROD, scoped, and runs the executable contract", () => {
  assert.match(ci, /^  pull_request:/m);
  assert.match(ci, /node --test scripts\/qa\/prod-main-exact-migration-release-contract\.test\.mjs/);
  assert.match(ci, /git diff --check/);
  assert.match(ci, /Enforce exact PR scope/);
  assert.doesNotMatch(ci, /environment: supabase-production|SUPABASE_ACCESS_TOKEN|SUPABASE_PROD_SESSION_POOLER_DB_URL|db push/);
});
