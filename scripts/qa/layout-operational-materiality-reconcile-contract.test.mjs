import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260809214308_reconcile_layout_operational_materiality_sol_2026_0006.sql",
  import.meta.url,
);

const migration = await readFile(migrationUrl, "utf8");

function installedFunctionBody(sql) {
  const match = sql.match(
    /\$function_ddl\$([\s\S]*?)\$function_ddl\$/i,
  );
  assert.ok(match, "conditional function replacement is missing");
  return match[1].toLowerCase();
}

test("migration is transactional and bounded", () => {
  assert.equal((migration.match(/^begin;$/gim) || []).length, 1);
  assert.equal((migration.match(/^commit;$/gim) || []).length, 1);
  assert.match(migration, /set local lock_timeout = '5s'/i);
  assert.match(migration, /set local statement_timeout = '30s'/i);
  assert.doesNotMatch(migration, /\b(?:insert\s+into|delete\s+from|truncate)\b/i);
  assert.doesNotMatch(migration, /\b(?:drop\s+table|create\s+table)\b/i);
  assert.doesNotMatch(migration, /\b(?:grant|revoke)\b/i);
});

test("installed historical function combines both operational hotfixes", () => {
  const body = installedFunctionBody(migration);

  for (const operationalField of [
    "company_bank_account_id",
    "due_date",
    "scheduled_payment_date",
    "payment_reference",
  ]) {
    assert.ok(
      !body.includes(`old.${operationalField}`),
      `${operationalField} must not invalidate Direction approval`,
    );
    assert.ok(!body.includes(`new.${operationalField}`));
  }

  for (const materialField of [
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
    "payment_concept",
  ]) {
    assert.ok(body.includes(`old.${materialField}`));
    assert.ok(body.includes(`new.${materialField}`));
  }

  assert.match(body, /pg_trigger_depth\(\) > 1/i);
  assert.match(
    body,
    /new\.approval_material_updated_at :=\s*old\.approval_material_updated_at/i,
  );
  assert.doesNotMatch(body, /security definer/i);
  assert.match(body, /set search_path = public, pg_temp/i);
});

test("DEV-compatible baseline is preserved instead of overwritten", () => {
  assert.match(migration, /v_expanded_baseline/i);
  assert.match(
    migration,
    /if v_operational_fields_present then[\s\S]*?if not v_historical_baseline or v_expanded_baseline then/i,
  );
  assert.match(migration, /refusing to replace an unknown mixed baseline/i);
});

test("production repair is exact, locked, and retry-safe", () => {
  assert.match(migration, /SOL-2026-0006/g);
  assert.doesNotMatch(
    migration,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  );
  assert.match(migration, /lock table public\.payment_requests in access exclusive mode/i);
  assert.match(
    migration,
    /disable trigger mark_payment_request_material_change/i,
  );
  assert.match(
    migration,
    /enable trigger mark_payment_request_material_change/i,
  );
  assert.match(migration, /disable trigger set_payment_requests_updated_at/i);
  assert.match(migration, /enable trigger set_payment_requests_updated_at/i);
  assert.match(
    migration,
    /disable trigger invalidate_extraordinary_on_material_change/i,
  );
  assert.match(
    migration,
    /enable trigger invalidate_extraordinary_on_material_change/i,
  );
  assert.match(migration, /approval fingerprint changed/i);
  assert.match(migration, /request fingerprint changed/i);
  assert.match(migration, /6671be98c7696b01c711bfc81cafba02387fb4d8c3bb8bf5dbf90f589c0df3ec/i);
  assert.match(migration, /v_request\.budget_month is distinct from date '2026-08-01'/i);
  assert.match(migration, /v_request\.is_extraordinary_adjustment is distinct from false/i);
  assert.match(migration, /from public\.payment_request_receipt_links receipt_link/i);
  assert.match(migration, /batch\.period_start = date '2026-08-06'/i);
  assert.match(migration, /batch\.period_end = date '2026-08-12'/i);
  assert.match(migration, /for update of item, batch/i);
  assert.match(
    migration,
    /from public\.payable_snapshots snapshot[\s\S]*?for update;/i,
  );
  assert.match(migration, /not in the expected regression state/i);
  assert.match(
    migration,
    /approval_material_updated_at =\s*v_snapshot\.source_approval_material_updated_at[\s\S]*?return;/i,
  );
  assert.match(
    migration,
    /set approval_material_updated_at =\s*v_snapshot\.source_approval_material_updated_at/i,
  );
  assert.match(migration, /from public\.payable_snapshots snapshot/i);
  assert.match(
    migration,
    /source_approval_material_updated_at is distinct from[\s\S]*?2026-08-09 20:48:05\.124232\+00/i,
  );
});

test("postcheck proves the existing request is Layout-ready", () => {
  assert.match(migration, /v_classification is distinct from 'ready_regular'/i);
  assert.match(
    migration,
    /v_missing_fields is distinct from array\[\]::text\[\]/i,
  );
  assert.match(migration, /v_direction_current is distinct from true/i);
  assert.match(migration, /v_finance_current is distinct from true/i);
  assert.match(migration, /approval_batch_item_release_block_reason\(v_item\.id\)/i);
  assert.match(
    migration,
    /v_request\.updated_at is distinct from[\s\S]*?2026-08-09 21:18:22\.762217\+00/i,
  );
  assert.match(migration, /did not become Layout-ready/i);
});
