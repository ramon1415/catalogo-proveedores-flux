import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const root = new URL("../../", import.meta.url)
const source = readFileSync(new URL("layouts.js", root), "utf8")
const reactSource = readFileSync(new URL("app/src/features/layouts/logic.ts", root), "utf8")
const pageSource = readFileSync(new URL("app/src/features/layouts/LayoutsPage.tsx", root), "utf8")
const modalSource = readFileSync(new URL("app/src/features/layouts/LinesModal.tsx", root), "utf8")
const docs = readFileSync(new URL("docs/ops/bbva-mixed-clabe-format.md", root), "utf8")

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
globalThis.__mixed = {
  BBVA_FORMAT_SAME_BANK,
  BBVA_FORMAT_MIXED,
  BBVA_FORMAT_INTERBANK,
  BBVA_MIXED_SAME_BANK_OPERATION,
  BBVA_MIXED_SAME_BANK_LINE_LENGTH,
  detectBbvaLayoutFormat,
  buildBbvaMixedSameBankRecord88,
  buildBbvaMixedContent,
  validateBbvaMixedContent,
  parseBbvaMixedLine,
  buildBbvaLayoutFiles,
}
`, context)

const mixed = context.__mixed
const bbvaClabe = {
  id: "mixed-line",
  layout_id: "layout",
  payment_request_id: "request",
  request_number: "SOL-QA-MIXED",
  status: "included",
  destination_type: "clabe",
  destination_value: "012914000000000007",
  source_account_number: "0191134094",
  amount: "3527.90",
  beneficiary_name: "BENEFICIARIO BBVA",
  payment_reference: "03092",
  payment_concept: "PRUEBA CLABE BBVA",
}

const expected = "PTC012914000000000007000000000191134094MXP0000000003527.90" + "PRUEBA CLABE BBVA".padEnd(30, " ")

test("VBA PTC contract is reproduced byte-for-byte for a BBVA CLABE", () => {
  const row = mixed.buildBbvaMixedSameBankRecord88(bbvaClabe)
  assert.equal(row, expected)
  assert.equal(row.length, 88)
  assert.equal(new TextEncoder().encode(row).length, 88)
  const parsed = mixed.parseBbvaMixedLine(row)
  assert.equal(parsed.operation, "PTC")
  assert.equal(parsed.destinationAccount, "012914000000000007")
  assert.equal(parsed.sourceAccount, "000000000191134094")
  assert.equal(parsed.currency, "MXP")
  assert.equal(parsed.amount, "0000000003527.90")
})

test("PAGOSMIX content has one CRLF terminator and no header, BOM, or blank record", () => {
  const content = mixed.buildBbvaMixedContent([bbvaClabe])
  const validation = mixed.validateBbvaMixedContent(content)
  assert.equal(validation.ok, true, validation.errors.join("\n"))
  assert.equal(validation.lineCount, 1)
  assert.deepEqual(Array.from(validation.lineLengths), [88])
  assert.equal(validation.byteLength, 90)
  assert.equal(content, `${expected}\r\n`)
  assert.equal(content.endsWith("\r\n\r\n"), false)
  assert.notEqual(content.charCodeAt(0), 0xfeff)
})

test("routing distinguishes account, BBVA CLABE mixed, and external CLABE", () => {
  assert.equal(mixed.detectBbvaLayoutFormat({ destination_type: "cuenta", destination_value: "0108301492" }), mixed.BBVA_FORMAT_SAME_BANK)
  assert.equal(mixed.detectBbvaLayoutFormat(bbvaClabe), mixed.BBVA_FORMAT_MIXED)
  assert.equal(mixed.detectBbvaLayoutFormat({ destination_type: "clabe", destination_value: "002180700287444966" }), mixed.BBVA_FORMAT_INTERBANK)
})

test("layout creates a dedicated PAGOSMIX file and never treats 012 as PAGOSBBV/PAGOSINT", () => {
  const files = mixed.buildBbvaLayoutFiles([bbvaClabe], { layout_number: "LAY-QA" })
  assert.equal(files.length, 1)
  assert.equal(files[0].format, mixed.BBVA_FORMAT_MIXED)
  assert.match(files[0].fileName, /^PAGOSMIX_FLUX_LAY_QA_\d{8}\.txt$/)
  assert.equal(files[0].lineLength, 88)
  assert.equal(files[0].content.startsWith("PTC012"), true)
})

test("paid BBVA CLABE lines remain historical and are not regenerated", () => {
  const files = mixed.buildBbvaLayoutFiles([{ ...bbvaClabe, status: "paid" }], { layout_number: "LAY-QA" })
  assert.deepEqual(Array.from(files), [])
})

test("React, legacy, UX and source documentation stay in lockstep", () => {
  assert.match(source, /BBVA_FORMAT_MIXED = "mixed"/)
  assert.match(source, /BBVA_MIXED_SAME_BANK_OPERATION = "PTC"/)
  assert.match(source, /formatBbvaMixedDestinationClabe/)
  assert.match(reactSource, /BBVA_FORMAT_MIXED: BbvaFormat = 'mixed'/)
  assert.match(reactSource, /BBVA_MIXED_SAME_BANK_OPERATION = 'PTC'/)
  assert.match(pageSource, /Pagos Mixtos/)
  assert.match(modalSource, /Pagos Mixtos/)
  assert.match(docs, /CC5B4376A2BD7C9B8E1DE02B29CAFBF186E03D371BC0B9CE7364BC4DA26DF556/)
  assert.match(docs, /4785E40BC10DAC3AF4698D2F29FE1FCC72BB037CEA0FD8A93F16FA6C02945DCD/)
  assert.match(docs, /uExpTrasBmerMix/)
  assert.match(docs, /88 bytes ASCII/)
})
