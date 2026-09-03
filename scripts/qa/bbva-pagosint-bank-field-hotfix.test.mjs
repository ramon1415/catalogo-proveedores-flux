import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const root = new URL("../../", import.meta.url)
const source = readFileSync(new URL("layouts.js", root), "utf8")
const reactSource = readFileSync(new URL("app/src/features/layouts/logic.ts", root), "utf8")
const reactPage = readFileSync(new URL("app/src/features/layouts/LayoutsPage.tsx", root), "utf8")
const reactLines = readFileSync(new URL("app/src/features/layouts/LinesModal.tsx", root), "utf8")
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
globalThis.__bankFieldContract = {
  BBVA_FORMAT_SAME_BANK,
  BBVA_FORMAT_INTERBANK,
  detectBbvaLayoutFormat,
  formatBbvaInterbankBankField,
  buildBbvaInterbankRecord128,
  buildBbvaInterbankContent,
  buildBbvaLayoutFiles,
  validateBbvaInterbankContent,
  validateLayoutLines,
  summarizeLayoutFormats,
}
`, context)

const bbva = context.__bankFieldContract
const line = (overrides = {}) => ({
  id: "line-1",
  layout_id: "layout-1",
  payment_request_id: "request-1",
  request_number: "SOL-QA-1",
  status: "included",
  destination_type: "clabe",
  destination_value: "002180700287444966",
  source_account_number: "0191134094",
  amount: "806.00",
  beneficiary_name: "BENEFICIARIO PRUEBA",
  payment_reference: "03082",
  payment_concept: "REEMBOLSO",
  ...overrides,
})

test("PAGOSINT derives availability+bank from CLABE and never serializes operational reference", () => {
  const row = bbva.buildBbvaInterbankRecord128(line())
  assert.equal(row.length, 128)
  assert.equal(row.slice(85, 90), "40002")
  assert.equal(row.includes("03082"), false)
  assert.equal(bbva.formatBbvaInterbankBankField("014180568222970573"), "40014")
  assert.equal(bbva.formatBbvaInterbankBankField("137443105288819697"), "40137")
})

test("PAGOSINT validation rejects an operational reference placed in the bank field", () => {
  const correct = bbva.buildBbvaInterbankRecord128(line())
  const tampered = `${correct.slice(0, 85)}03082${correct.slice(90)}\r\n`
  const validation = bbva.validateBbvaInterbankContent(tampered)
  assert.equal(validation.ok, false)
  assert.match(validation.errors.join("\n"), /campo banco.*40002/i)
})

test("BBVA CLABE 012 stays on PAGOSBBV and external CLABE stays on PAGOSINT", () => {
  assert.equal(
    bbva.detectBbvaLayoutFormat(line({ destination_value: "012914002012607667" })),
    bbva.BBVA_FORMAT_SAME_BANK,
  )
  assert.equal(bbva.detectBbvaLayoutFormat(line()), bbva.BBVA_FORMAT_INTERBANK)
  assert.throws(
    () => bbva.formatBbvaInterbankBankField("012914002012607667"),
    /PAGOSBBV/,
  )
})

test("paid lines remain historical but are never regenerated", () => {
  const pending = line()
  const paid = line({
    id: "line-paid",
    payment_request_id: "request-paid",
    request_number: "SOL-QA-PAID",
    status: "paid",
    destination_value: "014180568222970573",
    payment_concept: "PAGO YA LIQUIDADO",
  })
  const files = bbva.buildBbvaLayoutFiles([pending, paid], { layout_number: "LAY-QA" })
  const interbank = files.find((file) => file.format === bbva.BBVA_FORMAT_INTERBANK)
  assert.equal(interbank.validation.lineCount, 1)
  assert.equal(interbank.content.includes("PAGO YA LIQUIDADO"), false)
  assert.equal(bbva.summarizeLayoutFormats([pending, paid]).interbank.count, 1)
  assert.equal(bbva.validateLayoutLines([pending, { ...paid, destination_value: "" }]).length, 0)
})

test("React, legacy, docs, and browser cache contract agree", () => {
  assert.match(source, /BBVA_INTERBANK_BANK_FIELD_PREFIX = "40"/)
  assert.match(source, /formatBbvaInterbankBankField\(line\.destination_value\)/)
  assert.match(source, /filter\(\(line\) => line\.status === "included"\)/)
  assert.doesNotMatch(source, /filter\(\(line\) => line\.status !== "bank_rejected"\)/)
  assert.match(reactSource, /BBVA_INTERBANK_BANK_FIELD_PREFIX = '40'/)
  assert.match(reactSource, /formatBbvaInterbankBankField\(line\.destination_value\)/)
  assert.match(reactPage, /line\.status === 'included'/)
  assert.match(reactLines, /line\.status === 'included'/)
  assert.match(docs, /`002` → `40002`/)
  assert.match(docs, /líneas con estado `included`/)
})
