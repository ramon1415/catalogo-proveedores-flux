import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../../supabase/migrations/20260812210013_047_fix_dev_layout_candidate_recursion.sql",
  import.meta.url,
);
const migration = readFileSync(migrationPath, "utf8");

function extractFunction(name) {
  const startExpression = new RegExp(
    `create or replace function public\\.${name}\\(`,
    "i",
  );
  const start = startExpression.exec(migration);
  assert.ok(start, `${name} definition missing`);
  const end = migration.indexOf("\n$$;", start.index);
  assert.notEqual(end, -1, `${name} terminator missing`);
  return migration.slice(start.index, end + "\n$$;".length);
}

function extractBody(definition) {
  const start = definition.indexOf("\nas $$");
  assert.notEqual(start, -1, "function body delimiter missing");
  return definition.slice(start + "\nas $$".length);
}

test("migration is one transactional DEV-only DDL repair", () => {
  assert.equal((migration.match(/^begin;$/gim) || []).length, 1);
  assert.equal((migration.match(/^commit;$/gim) || []).length, 1);
  assert.equal((migration.split("$precheck$").length - 1) % 2, 0);
  assert.equal((migration.split("$postcheck$").length - 1) % 2, 0);
  assert.doesNotMatch(migration, /create or replace function public\.approval_batch_payment_layout_candidates\(/i);
  assert.doesNotMatch(migration, /create or replace function public\.preview_payment_layout_eligibility\(/i);
  assert.doesNotMatch(migration, /create or replace function public\.create_payment_layout\(/i);
  assert.doesNotMatch(migration, /\b(insert into|update|delete from)\s+public\./i);
  assert.doesNotMatch(migration, /serializeBbvaCieLine|PAGOSCIE|CIE\.txt/i);
});

test("precheck pins the observed recursive drift and preserved public contracts", () => {
  for (const fingerprint of [
    "d68ceef75480c74f84525a66a3c1c580",
    "857d5ead5ba5a9e0db91b5587ed60f2c",
    "2e5efa2fb65d4752bb438732f81cefdb",
    "4398d33162422949e7c5797b7cd91f38",
    "5955ae35697c610ef01586120543c05f",
  ]) assert.match(migration, new RegExp(fingerprint));
  assert.match(migration, /047_precheck: candidate recursion fingerprint changed/);
  assert.match(migration, /047_precheck: preview recursion fingerprint changed/);
  assert.match(migration, /047_precheck: public layout contract drifted/);
});

test("candidate restores the canonical DEV 033 body without self-recursion", () => {
  const definition = extractFunction(
    "approval_batch_payment_layout_candidates_pre_037",
  );
  const body = extractBody(definition);
  assert.doesNotMatch(
    body,
    /approval_batch_payment_layout_candidates_pre_037\s*\(/i,
  );
  for (const marker of [
    "payment_request_layout_missing_fields",
    "approval_batch_budget_validation",
    "approval_batch_request_has_current_direction_approval",
    "approval_batch_request_has_any_execution_record",
    "destination_type",
    "convenio_number",
    "payment_reference",
    "payment_concept",
    "scheduled_payment_date",
    "payment_method",
    "direction_reapproval_required",
    "ready_regular",
  ]) assert.ok(body.includes(marker), marker);
});

test("preview restores canonical 023 behavior and delegates to the public candidate", () => {
  const definition = extractFunction(
    "preview_payment_layout_eligibility_pre_037",
  );
  const body = extractBody(definition);
  assert.doesNotMatch(
    body,
    /preview_payment_layout_eligibility_pre_037\s*\(/i,
  );
  assert.match(
    body,
    /public\.approval_batch_payment_layout_candidates\s*\(/i,
  );
  assert.match(body, /approval_batch_require_finance/);
  assert.match(body, /rejected_history/);
  assert.match(body, /ready_extraordinary/);
  assert.match(body, /totals_by_currency/);
});

test("internal security, grants, and read-only smoke remain fail-closed", () => {
  for (const name of [
    "approval_batch_payment_layout_candidates_pre_037",
    "preview_payment_layout_eligibility_pre_037",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `alter function public\\.${name}\\([\\s\\S]*?security definer`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `alter function public\\.${name}\\([\\s\\S]*?set search_path = public, pg_temp`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all on function[\\s\\S]*?public\\.${name}\\([\\s\\S]*?from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute on function[\\s\\S]*?public\\.${name}\\([\\s\\S]*?to service_role`,
        "i",
      ),
    );
  }
  assert.match(
    migration,
    /from public\.approval_batch_payment_layout_candidates\([\s\S]*date '2026-01-01'[\s\S]*date '2026-12-31'/i,
  );
  assert.match(migration, /047_postcheck: public layout contract changed/);
  assert.match(migration, /047_postcheck: canonical candidate body is incomplete/);
  assert.match(migration, /047_postcheck: canonical preview body is incomplete/);
});
