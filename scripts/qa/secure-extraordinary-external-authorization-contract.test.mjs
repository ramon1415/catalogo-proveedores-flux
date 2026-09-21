import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
const requestUi = readFileSync(new URL("../../solicitudes_batch_execution.js", import.meta.url), "utf8")
const requestHtml = readFileSync(new URL("../../solicitudes.html", import.meta.url), "utf8")
const batchUi = readFileSync(new URL("../../approval_batches.js", import.meta.url), "utf8")
const batchHtml = readFileSync(new URL("../../approval_batches.html", import.meta.url), "utf8")

test("UI captures the secure evidence contract and blocks duplicate submission", () => {
  assert.match(requestHtml, /extraordinaryDirector/)
  assert.match(requestHtml, /extraordinaryAuthorizedAt/)
  assert.match(requestHtml, /extraordinaryEvidenceFile/)
  assert.match(requestHtml, /extraordinaryEvidenceAttestation/)
  assert.match(requestUi, /begin_extraordinary_authorization/)
  assert.match(requestUi, /finalize_extraordinary_authorization/)
  assert.match(requestUi, /crypto\.subtle\.digest\("SHA-256"/)
  assert.match(requestUi, /if \(state\.extraordinarySubmitting\) return/)
  assert.doesNotMatch(requestHtml, /omitira la autorizacion|podra continuar inmediatamente/i)
})

test("Director UI can inspect temporary evidence and ratify or dispute without confirming payment", () => {
  assert.match(batchHtml, /Ratificación de contingencias extraordinarias/)
  assert.match(batchUi, /list_extraordinary_regularizations/)
  assert.match(batchUi, /get_extraordinary_authorization_evidence_access/)
  assert.match(batchUi, /createSignedUrl/)
  assert.match(batchUi, /ratify_extraordinary_authorization/)
  assert.match(batchUi, /dispute_extraordinary_authorization/)
  assert.match(batchUi, /no se confirmó ningún pago/i)
  assert.doesNotMatch(batchUi, /service[_-]?role/i)
})
