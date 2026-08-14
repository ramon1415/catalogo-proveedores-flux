import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("../../", import.meta.url)
const migration = readFileSync(
  new URL("supabase/migrations/20260814004000_provider_catalog_canonical_rpc_prod.sql", root),
  "utf8",
)

test("provider PROD migration is transaction wrapped and fingerprint gated", () => {
  assert.match(migration, /^begin;/)
  assert.match(migration, /PROD_PROVIDER_CANONICAL_RPC_PARTIAL_STATE/)
  assert.match(migration, /6b88286f47700e5d57eed478e111b955/)
  assert.match(migration, /6ea861e3577b031deb68719fe4599110/)
  assert.match(migration, /9b7c53a5b3895dfdd50b25ec68e943d7/)
  assert.match(migration, /commit;\s*$/)
})

test("migration creates only the three approved provider functions", () => {
  const names = [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/gi)]
    .map((match) => match[1].toLowerCase())
  assert.deepEqual(names, [
    "guard_provider_payment_execution_data_insert",
    "mark_provider_payment_material_change",
    "save_provider_catalog_with_payment_execution_data",
  ])
})

test("existing PROD dependencies are reused rather than recreated", () => {
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.provider_payment_execution_missing_fields/i)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.approval_batch_require_finance/i)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.flux_(member|approver)_roles/i)
})

test("insert guard requires Finance and the transaction-local RPC GUC", () => {
  assert.match(migration, /perform public\.approval_batch_require_finance\(\)/i)
  assert.match(migration, /current_setting\('flux\.provider_payment_execution_rpc', true\)/)
  assert.match(migration, /provider_payment_execution_rpc_required/)
  assert.match(migration, /provider_payment_execution_data_insert_guard/)
  assert.match(migration, /before insert on public\.proveedores/i)
})

test("canonical RPC allowlists the live frontend payload", () => {
  for (const key of [
    "alias", "nombre_completo", "metodo_pago", "tipo_cuenta",
    "destination_type", "beneficiary_name", "banco", "clabe",
    "cuenta_bancaria", "convenio_number", "rfc", "persona_tipo",
    "email", "telefono", "tipo_proveedor", "notas",
    "es_personal_eventual", "activo", "updated_at",
  ]) {
    assert.match(migration, new RegExp(`'${key}'`))
  }
  assert.match(migration, /provider_payload_contains_unsupported_fields/)
})

test("banking execution changes remain Finance-only", () => {
  assert.match(migration, /v_execution_changed/)
  assert.match(migration, /perform public\.approval_batch_require_finance\(\)/i)
  assert.match(migration, /set_config\(\s*'flux\.provider_payment_execution_rpc'/)
  assert.match(migration, /provider_payment_execution_data_invalid/)
})

test("activation remains part of the canonical payload without becoming a banking shortcut", () => {
  assert.match(migration, /'activo'/)
  assert.match(migration, /v_execution_changed := row\(/)
  assert.doesNotMatch(migration, /old\.activo is distinct from new\.activo/)
})

test("material changes keep the existing approval invalidation and add redacted audit", () => {
  assert.match(migration, /payment_execution_data_updated/)
  assert.match(migration, /Provider payment-execution audit; banking values intentionally omitted\./)
  assert.match(migration, /changed_fields/)
  assert.match(migration, /completed_fields/)
  assert.doesNotMatch(migration, /jsonb_build_object\([^)]*clabe[^)]*old\.clabe/is)
})

test("create audit does not store banking values", () => {
  assert.match(migration, /payment_execution_data_created/)
  assert.match(migration, /banking values intentionally omitted/)
  assert.doesNotMatch(migration, /old_values[\s\S]{0,500}v_after\.clabe/)
})

test("security contract is fail closed", () => {
  assert.match(migration, /security definer/gi)
  assert.match(migration, /set search_path = public, pg_temp/gi)
  assert.match(migration, /revoke all on function public\.guard_provider_payment_execution_data_insert\(\)/i)
  assert.match(migration, /revoke all on function public\.mark_provider_payment_material_change\(\)/i)
  assert.match(migration, /grant execute on function public\.save_provider_catalog_with_payment_execution_data\(uuid, jsonb\)\s+to authenticated/i)
})

test("migration has no backfill or provider row mutation at apply time", () => {
  const beforeDefinitions = migration.slice(0, migration.indexOf("CREATE OR REPLACE FUNCTION"))
  assert.doesNotMatch(beforeDefinitions, /\b(update|insert into|delete from)\s+public\.proveedores\b/i)
  assert.doesNotMatch(migration, /\bbackfill\b/i)
})

test("excluded DEV migrations and legacy 033 are not embedded", () => {
  for (const excluded of [
    "043_provider_intake_draft",
    "044_provider_intake_conversion",
    "045_provider_intake",
    "046_provider_aware",
    "047_fix_dev_layout_candidate_recursion",
    "048_allow_sysadmin_provider_intake_links",
    "033_payment_batch_final_reconciliation",
  ]) {
    assert.equal(migration.includes(excluded), false)
  }
})
