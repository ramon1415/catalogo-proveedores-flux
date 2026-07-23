import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"

const root = process.cwd()
const batchClient = await readFile(join(root, "comprobantes_batch.js"), "utf8")
const requestEvidence = await readFile(
  join(root, "payment_request_reconciliation_evidence.js"),
  "utf8",
)

test("linked operations derive their visible status from the canonical link preview", () => {
  assert.match(batchClient, /loadOperationLinkStatuses/)
  assert.match(batchClient, /client\.rpc\(RPC\.linkPreview/)
  assert.match(
    batchClient,
    /state\.operationLinkStatuses\[item\.bank_operation_id\].*item\.reconciliation_status/,
  )
  assert.match(batchClient, /linked:"Vinculado"/)
})

test("multiple exact candidates expose the facts needed for a human choice", () => {
  assert.match(batchClient, /Concepto:.*candidate\.concept/s)
  assert.match(batchClient, /Coincidencia/)
  assert.match(batchClient, /candidate\.account_match \? "Cuenta bancaria" : "Beneficiario"/)
  assert.match(batchClient, /state\.candidates\.length === 1 \? state\.candidates\[0\]/)
})

test("Finance can share a private receipt without creating public provider access", () => {
  assert.match(requestEvidence, /Descargar para compartir/)
  assert.match(requestEvidence, /Compartición controlada/)
  assert.match(requestEvidence, /no genera enlaces públicos/i)
  assert.match(requestEvidence, /get_payment_operation_evidence_access/)
  assert.match(requestEvidence, /createSignedUrl/)
})
