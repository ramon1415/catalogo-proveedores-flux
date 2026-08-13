import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("../../", import.meta.url)
const providerSource = readFileSync(new URL("proveedores.js", root), "utf8")
const layoutsSource = readFileSync(new URL("layouts.js", root), "utf8")

function functionSource(start, end) {
  const startIndex = providerSource.indexOf(start)
  const endIndex = providerSource.indexOf(end, startIndex)
  assert.notEqual(startIndex, -1, `Missing source boundary: ${start}`)
  assert.notEqual(endIndex, -1, `Missing source boundary: ${end}`)
  return providerSource.slice(startIndex, endIndex)
}

const persistSource = functionSource(
  "async function persistSupplier(operation)",
  "\nfunction isPreviewEnvironment()",
)
const payloadBlock = persistSource.match(/const payload = \{([\s\S]*?)\n  \}\n\n  if/)
assert.ok(payloadBlock, "Provider payload block must remain statically auditable")
const payloadKeys = [...payloadBlock[1].matchAll(/^\s{4}([a-z_]+):/gm)].map((match) => match[1])
const expectedPayloadKeys = [
  "alias",
  "nombre_completo",
  "metodo_pago",
  "tipo_cuenta",
  "destination_type",
  "beneficiary_name",
  "banco",
  "clabe",
  "cuenta_bancaria",
  "convenio_number",
  "rfc",
  "persona_tipo",
  "email",
  "telefono",
  "tipo_proveedor",
  "notas",
  "es_personal_eventual",
  "activo",
  "updated_at",
]

test("persistSupplier uses the canonical provider catalog RPC", () => {
  const calls = persistSource.match(/\.rpc\("save_provider_catalog_with_payment_execution_data"/g) || []
  assert.equal(calls.length, 1)
})

test("provider create no longer inserts directly into proveedores", () => {
  assert.doesNotMatch(persistSource, /\.from\("proveedores"\)\.insert\(\s*payload/)
  assert.doesNotMatch(persistSource, /\.insert\(\s*payload\)\.select\("id"\)/)
})

test("provider edit no longer updates payload directly in proveedores", () => {
  assert.doesNotMatch(persistSource, /\.from\("proveedores"\)\.update\(\s*payload/)
  assert.doesNotMatch(persistSource, /\.update\(\s*payload\)\.eq\("id",\s*currentEditingId\)/)
})

test("provider create sends a null canonical provider id", () => {
  assert.match(persistSource, /p_proveedor_id:\s*currentEditingId\s*\|\|\s*null/)
})

test("provider edit sends the existing canonical provider id", () => {
  assert.match(persistSource, /p_proveedor_id:\s*currentEditingId\s*\|\|\s*null/)
  assert.doesNotMatch(persistSource, /p_proveedor_id:\s*null\s*,[\s\S]*p_proveedor_id:/)
})

test("provider RPC payload contains only the live allowlisted keys", () => {
  assert.deepEqual(payloadKeys, expectedPayloadKeys)
  for (const forbidden of ["id", "created_at", "csf_file_path", "supplierId"]) {
    assert.equal(payloadKeys.includes(forbidden), false)
  }
})

test("provider id is obtained from the RPC json response", () => {
  assert.match(persistSource, /const providerId = result\.data\?\.id/)
  assert.doesNotMatch(persistSource, /result\.data\?\.id\s*\|\|\s*currentEditingId/)
  assert.match(persistSource, /provider_rpc_response_invalid/)
})

test("finance-only and provider RPC errors have controlled messages", () => {
  assert.match(
    providerSource,
    /finance_role_required:\s*"Los datos bancarios del proveedor solo pueden ser guardados por Finanzas\."/,
  )
  assert.match(providerSource, /provider_payment_execution_data_invalid:\s*"Revisa los datos bancarios del proveedor\."/)
  assert.match(providerSource, /provider_create_role_required:/)
  assert.match(providerSource, /provider_update_role_required:/)
  assert.match(providerSource, /provider_payload_contains_unsupported_fields:/)
  assert.match(providerSource, /candidate\.includes\(code\)/)
})

test("CLABE uses the same canonical provider RPC", () => {
  assert.match(providerSource, /destination_type === "clabe"/)
  assert.equal((persistSource.match(/save_provider_catalog_with_payment_execution_data/g) || []).length, 1)
  assert.doesNotMatch(persistSource, /save_provider_.*clabe/i)
})

test("bank account uses the same canonical provider RPC", () => {
  assert.match(providerSource, /destination_type === "cuenta"/)
  assert.equal((persistSource.match(/save_provider_catalog_with_payment_execution_data/g) || []).length, 1)
  assert.doesNotMatch(persistSource, /save_provider_.*cuenta/i)
})

test("convenio uses the same canonical provider RPC", () => {
  assert.match(providerSource, /destination_type === "convenio"/)
  assert.equal((persistSource.match(/save_provider_catalog_with_payment_execution_data/g) || []).length, 1)
  assert.doesNotMatch(persistSource, /save_provider_.*cie/i)
})

test("BBVA CIE implementation remains present and isolated from this hotfix", () => {
  assert.match(layoutsSource, /const BBVA_FORMAT_CIE = "cie"/)
  assert.match(layoutsSource, /const BBVA_CIE_LINE_LENGTH =/)
  assert.match(layoutsSource, /function serializeBbvaCieLine\(/)
  assert.match(layoutsSource, /function buildBbvaCieContent\(/)
  assert.match(layoutsSource, /function detectBbvaLayoutFormat\(/)
})
