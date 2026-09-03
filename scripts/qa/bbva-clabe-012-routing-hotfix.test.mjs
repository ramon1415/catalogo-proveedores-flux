import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const root = new URL("../../", import.meta.url)
const source = readFileSync(new URL("layouts.js", root), "utf8")
const reactSource = readFileSync(new URL("app/src/features/layouts/logic.ts", root), "utf8")
const docs = readFileSync(new URL("docs/ops/layout-cxc-download-format.md", root), "utf8")

const document = {
  documentElement: { dataset: {} },
  addEventListener() {},
  getElementById() { return null },
  body: { appendChild() {} },
}
const window = {
  supabase: { createClient() { return {} } },
  setTimeout,
  clearTimeout,
}
window.window = window

const context = vm.createContext({
  window,
  document,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "synthetic",
  TextEncoder,
  Blob,
  URL,
  console: { info() {}, warn() {}, error() {} },
  setTimeout,
  clearTimeout,
})

vm.runInContext(`${source}
globalThis.__bbvaRouting = {
  BBVA_FORMAT_SAME_BANK,
  BBVA_FORMAT_MIXED,
  BBVA_FORMAT_INTERBANK,
  detectBbvaLayoutFormat,
  buildBbvaLayoutFiles,
}
`, context)

const bbva = context.__bbvaRouting
const base = {
  id: "line",
  payment_request_id: "request",
  request_number: "SOL-QA",
  status: "included",
  source_account_number: "0191134094",
  amount: "100.00",
  beneficiary_name: "BENEFICIARIO PRUEBA",
  payment_reference: "123",
  payment_concept: "PAGO PRUEBA",
}

const bbvaClabe = {
  ...base,
  id: "bbva-clabe",
  destination_type: "clabe",
  destination_value: "012914000000000007",
  beneficiary_name: "DESTINO BBVA",
}
const bbvaAccount = {
  ...base,
  id: "bbva-account",
  destination_type: "cuenta",
  destination_value: "0108301492",
  beneficiary_name: "CUENTA BBVA",
}
const banamexReimbursement = {
  ...base,
  id: "banamex-1",
  destination_type: "clabe",
  destination_value: "002180000000000001",
  beneficiary_name: "REEMBOLSO UNO",
  payment_reference: "3082",
  payment_concept: "REEMBOLSO PRUEBA UNO",
}
const anotherInterbank = {
  ...base,
  id: "interbank-2",
  destination_type: "clabe",
  destination_value: "646180000000000002",
  beneficiary_name: "REEMBOLSO DOS",
  payment_reference: "3082",
  payment_concept: "REEMBOLSO PRUEBA DOS",
}

test("CLABE 012 is routed to PAGOSMIX while account stays PAGOSBBV and external CLABEs stay PAGOSINT", () => {
  assert.equal(bbva.detectBbvaLayoutFormat(bbvaClabe), bbva.BBVA_FORMAT_MIXED)
  assert.equal(bbva.detectBbvaLayoutFormat(bbvaAccount), bbva.BBVA_FORMAT_SAME_BANK)
  assert.equal(bbva.detectBbvaLayoutFormat(banamexReimbursement), bbva.BBVA_FORMAT_INTERBANK)
  assert.equal(bbva.detectBbvaLayoutFormat(anotherInterbank), bbva.BBVA_FORMAT_INTERBANK)
})

test("mixed Soporte-style layout downloads two valid records per rail", () => {
  const files = bbva.buildBbvaLayoutFiles(
    [bbvaClabe, banamexReimbursement, bbvaAccount, anotherInterbank],
    { layout_number: "LAY-2026-QA" },
  )
  assert.deepEqual(Array.from(files, (file) => file.format), [
    bbva.BBVA_FORMAT_SAME_BANK,
    bbva.BBVA_FORMAT_MIXED,
    bbva.BBVA_FORMAT_INTERBANK,
  ])
  const sameBank = files.find((file) => file.format === bbva.BBVA_FORMAT_SAME_BANK)
  const mixed = files.find((file) => file.format === bbva.BBVA_FORMAT_MIXED)
  const interbank = files.find((file) => file.format === bbva.BBVA_FORMAT_INTERBANK)
  assert.equal(sameBank.validation.ok, true, sameBank.validation.errors.join("\n"))
  assert.equal(mixed.validation.ok, true, mixed.validation.errors.join("\n"))
  assert.equal(interbank.validation.ok, true, interbank.validation.errors.join("\n"))
  assert.equal(sameBank.validation.lineCount, 1)
  assert.equal(mixed.validation.lineCount, 1)
  assert.equal(interbank.validation.lineCount, 2)
  assert.deepEqual(Array.from(sameBank.validation.lineLengths), [85])
  assert.deepEqual(Array.from(mixed.validation.lineLengths), [88])
  assert.deepEqual(Array.from(interbank.validation.lineLengths), [128, 128])
  assert.equal(interbank.validation.lines[0].slice(0, 3), "002")
  assert.equal(interbank.validation.lines[0].slice(85, 90), "40002")
  assert.equal(interbank.validation.lines[1].slice(85, 90), "40646")
  assert.equal(interbank.content.includes("03082"), false)
  assert.equal(interbank.content.includes("012914000000000007"), false)
  assert.equal(sameBank.content.includes("012914000000000007"), false)
  assert.equal(mixed.content.startsWith("PTC012914000000000007"), true)
  assert.equal(mixed.fileName.startsWith("PAGOSMIX_FLUX_"), true)
})

test("React and legacy generators preserve the same routing rule", () => {
  assert.match(reactSource, /BBVA_CLABE_BANK_CODE = '012'/)
  assert.match(reactSource, /type === 'clabe' && isBbvaDestinationClabe\(line\.destination_value\)/)
  assert.match(source, /BBVA_CLABE_BANK_CODE = "012"/)
  assert.match(source, /type === "clabe" && isBbvaDestinationClabe\(line\.destination_value\)/)
  assert.match(docs, /clabe` con código bancario `012` -> `PAGOSMIX`/)
})
