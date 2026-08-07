import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260807215143_preserve_layout_source_account_approval.sql",
  import.meta.url,
);

const migration = await readFile(migrationUrl, "utf8");

function materialFieldPairs(sql) {
  const match = sql.match(
    /if row\(([\s\S]*?)\) is distinct from row\(([\s\S]*?)\) then/i,
  );
  assert.ok(match, "material-field comparison is missing");

  const fields = (side, prefix) => side
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(new RegExp(`^${prefix}\\.`), ""));

  return {
    oldFields: fields(match[1], "old"),
    newFields: fields(match[2], "new"),
  };
}

test("hotfix is transactional, forward-only, and changes one function", () => {
  assert.equal((migration.match(/^begin;$/gim) || []).length, 1);
  assert.equal((migration.match(/^commit;$/gim) || []).length, 1);
  assert.equal(
    (migration.match(/create or replace function public\./gi) || []).length,
    1,
  );
  assert.match(
    migration,
    /create or replace function public\.mark_payment_request_material_change\(\)/i,
  );
  assert.match(migration, /language plpgsql\s+set search_path = public, pg_temp/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update|delete\s+from|truncate)\b/i);
  assert.doesNotMatch(migration, /\b(?:drop|alter|create)\s+(?:table|trigger)\b/i);
  assert.doesNotMatch(migration, /\b(?:grant|revoke)\b/i);
  assert.doesNotMatch(
    migration,
    /complete_payment_request_layout_data|extraordinary|storage|notification/i,
  );
});

test("only the Layout source account stops being approval material", () => {
  const { oldFields, newFields } = materialFieldPairs(migration);
  assert.deepEqual(newFields, oldFields);
  assert.ok(!oldFields.includes("company_bank_account_id"));

  for (const unchangedMaterialField of [
    "provider_id",
    "provider_bank_account_id",
    "proveedor_id",
    "company_id",
    "cost_center_id",
    "budget_category_id",
    "amount_requested",
    "currency",
    "exchange_rate",
    "request_type",
    "payment_method",
    "due_date",
    "scheduled_payment_date",
    "payment_reference",
    "payment_concept",
  ]) {
    assert.ok(
      oldFields.includes(unchangedMaterialField),
      `${unchangedMaterialField} must remain approval material`,
    );
  }
});

test("source-account-only completion preserves the approval timestamp", () => {
  const { oldFields } = materialFieldPairs(migration);
  const before = {
    company_bank_account_id: null,
    amount_requested: 1250,
    currency: "MXN",
    payment_reference: "12345",
  };
  const after = {
    ...before,
    company_bank_account_id: "account-selected-after-direction-approval",
  };
  const materialChanged = oldFields.some(
    (field) => before[field] !== after[field],
  );

  assert.equal(materialChanged, false);
  assert.match(
    migration,
    /new\.approval_material_updated_at := old\.approval_material_updated_at/i,
  );
});

test("material changes still advance the approval timestamp", () => {
  const { oldFields } = materialFieldPairs(migration);
  assert.ok(oldFields.includes("amount_requested"));
  assert.match(
    migration,
    /new\.approval_material_updated_at := clock_timestamp\(\)/i,
  );
  assert.match(migration, /pg_trigger_depth\(\) > 1/i);
});

test("migration fails closed on baseline drift and verifies the installed result", () => {
  assert.match(migration, /\$precheck\$/);
  assert.match(migration, /unexpected material-change baseline/i);
  assert.match(migration, /\$postcheck\$/);
  assert.doesNotMatch(migration, /position\([\s\S]*?',\s*v_source\s*\)/i);
  assert.match(migration, /source account is still material/i);
  assert.match(migration, /unrelated materiality behavior changed/i);
  assert.match(migration, /function security attributes changed/i);
  assert.match(migration, /material-change trigger is missing or disabled/i);
});
