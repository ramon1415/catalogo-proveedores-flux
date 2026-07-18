import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")
const html = read("provider_intakes.html")
const client = read("provider_intakes.js")
const styles = read("provider_intakes.css")
const providerClient = read("proveedores.js")

test("matching client uses only the three controlled RPCs", () => {
  assert.match(client, /\.rpc\("find_provider_intake_candidates"/)
  assert.match(client, /\.rpc\("get_provider_intake_match_comparison"/)
  assert.match(client, /\.rpc\("set_provider_intake_match"/)
  assert.doesNotMatch(client, /\.from\(["'](?:payment_intake|proveedores|payment_requests)["']\)/)
  assert.doesNotMatch(client, /\binnerHTML\b/)
  assert.doesNotMatch(client, /service_role|serviceRole/i)
  assert.doesNotMatch(client, /console\.(?:log|info|debug|error)/)
})

test("UI exposes required states and explicit actions without conversion controls", () => {
  for (const text of [
    "Sin vincular",
    "Candidatos encontrados",
    "Vinculado",
    "Revisión requerida",
    "Proveedor inactivo",
    "Sin coincidencias",
    "Buscar coincidencias",
    "Comparar",
    "Seleccionar proveedor",
    "Confirmar vínculo",
    "Cambiar vínculo",
    "Retirar vínculo",
    "Abrir proveedor maestro",
  ]) {
    assert.match(`${html}\n${client}`, new RegExp(text))
  }
  assert.match(html, /Conversión disponible en Fase 2B/)
  assert.doesNotMatch(html, />\s*(?:Convertir a solicitud|Crear proveedor|Actualizar proveedor|Seleccionar aprobador|Seleccionar corte)\s*</i)
})

test("comparison dialog has table semantics, audit fields, and accessible errors", () => {
  assert.match(html, /<dialog class="match-dialog" id="matchDialog" aria-labelledby="matchTitle">/)
  assert.match(html, /<form class="dialog-shell match-shell" id="matchForm">/)
  assert.match(html, /for="matchReasonCode"/)
  assert.match(html, /for="matchReason"/)
  assert.match(html, /id="matchError" role="alert"/)
  assert.match(client, /field\.scope = "row"/)
  assert.match(client, /th\.scope = "col"/)
  assert.match(client, /COMPARISON_RESULT/)
  assert.match(client, /Coincide/)
  assert.match(client, /Difiere/)
  assert.match(client, /No informado/)
})

test("bank values are rendered only from masked response properties", () => {
  assert.match(client, /candidate\.clabe_masked/)
  assert.match(client, /candidate\.account_masked/)
  assert.match(client, /current\.clabe_masked/)
  assert.match(client, /current\.account_masked/)
  assert.doesNotMatch(client, /candidate\.(?:clabe|cuenta_bancaria|bank_account)\b/)
  assert.doesNotMatch(client, /current\.(?:clabe|cuenta_bancaria|bank_account)\b/)
})

test("set replace and clear send optimistic concurrency plus an action ID", () => {
  assert.match(client, /p_expected_status: intake\.status/)
  assert.match(client, /p_expected_updated_at: intake\.updated_at/)
  assert.match(client, /p_expected_current_match: currentId/)
  assert.match(client, /p_proveedor_id: action\.providerId/)
  assert.match(client, /p_reason_code: dom\.matchReasonCode\.value/)
  assert.match(client, /p_action_id: action\.actionId/)
  assert.match(client, /actionId: createUuid\(\)/)
  assert.match(client, /provider_intake_conflict: "Esta solicitud fue actualizada por otro usuario\. Recarga el detalle\."/)
})

test("matching layout covers focus, mobile, zoom-safe overflow, and reduced motion", () => {
  assert.match(styles, /button:focus-visible/)
  assert.match(styles, /\.comparison-table-wrap \{ overflow-x: auto;/)
  assert.match(styles, /@media \(max-width: 760px\)/)
  assert.match(styles, /@media \(max-width: 480px\)/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(client, /restoreMatchFocus/)
  assert.match(client, /dom\.matchDialog\.showModal\(\)/)
})

test("replace flow focuses search before an exact candidate action opens the dialog", () => {
  assert.match(
    client,
    /Cambiar vínculo[\s\S]*?document\.getElementById\("providerMatchSearch"\)\?\.focus\(\)/,
  )
  assert.match(
    client,
    /current \? "Seleccionar para cambio" : "Seleccionar proveedor"/,
  )
  assert.match(
    client,
    /select\.addEventListener\("click", \(\) => openMatchComparison\(candidate\.proveedor_id, select\)\)/,
  )
  assert.match(client, /const kind = currentId \? "replace" : "set"/)
  assert.match(client, /dom\.matchDialog\.showModal\(\)/)
})

test("provider master deep link is forced into read-only mode", () => {
  assert.match(client, /proveedores\.html\?provider_id=.*&mode=readonly/)
  assert.match(providerClient, /providerReadOnlyMode/)
  assert.match(providerClient, /control\.disabled = true/)
  assert.match(providerClient, /if \(providerReadOnlyMode\) return/)
  assert.match(providerClient, /canManageProviders\(\) && !providerReadOnlyMode/)
})
