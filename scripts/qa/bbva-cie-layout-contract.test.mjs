import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const root = new URL("../../", import.meta.url)
const source = readFileSync(new URL("layouts.js", root), "utf8")
const migration = readFileSync(
  new URL("supabase/migrations/20260813011425_049_snapshot_bbva_cie_convenio_number.sql", root),
  "utf8",
)
const docs = readFileSync(new URL("docs/ops/bbva-cie-layout-format.md", root), "utf8")

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
globalThis.__cieContract = {
  BBVA_FORMAT_SAME_BANK,
  BBVA_FORMAT_INTERBANK,
  BBVA_FORMAT_CIE,
  BBVA_CIE_LINE_LENGTH,
  detectBbvaLayoutFormat,
  buildBbvaLayoutFiles,
  buildBbvaSameBankRecord85,
  buildBbvaInterbankRecord128,
  serializeBbvaCieLine,
  buildBbvaCieContent,
  validateBbvaCieContent,
  validateLayoutLines,
  normalizeBbvaCieText,
  formatBbvaCieText,
  parseBbvaCieLine,
  buildBbvaFileName,
}
`, context)

const cie = context.__cieContract
const syntheticCie = (overrides = {}) => ({
  id: "line-cie-1",
  payment_request_id: "request-cie-1",
  request_number: "SOL-CIE-QA-1",
  status: "included",
  destination_type: "convenio",
  destination_value: "CONVENIO DECORADO NO USAR",
  convenio_number: "1234567",
  source_account_number: "1234567890",
  amount: "123.45",
  payment_concept: "PRUEBA CIE DEV",
  payment_reference: "REF20260812TEST",
  ...overrides,
})
const sameBank = {
  status: "included",
  destination_type: "cuenta",
  destination_value: "123456789012345678",
  source_account_number: "000000001234567890",
  amount: "12.34",
  payment_concept: "PRUEBA PAGOSBBV",
}
const interbank = {
  status: "included",
  destination_type: "clabe",
  destination_value: "002345678901234567",
  source_account_number: "000000001234567890",
  amount: "56.78",
  beneficiary_name: "BENEFICIARIO SINTETICO",
  payment_reference: "42",
  payment_concept: "PRUEBA PAGOSINT",
}

test("routing recognizes convenio as first-class CIE rail", () => {
  assert.equal(cie.detectBbvaLayoutFormat(syntheticCie()), cie.BBVA_FORMAT_CIE)
  assert.equal(cie.detectBbvaLayoutFormat(sameBank), cie.BBVA_FORMAT_SAME_BANK)
  assert.equal(cie.detectBbvaLayoutFormat(interbank), cie.BBVA_FORMAT_INTERBANK)
})

test("CIE serializer reproduces recovered 121-byte field order and duplicates concept", () => {
  const row = cie.serializeBbvaCieLine(syntheticCie())
  assert.equal(row.length, 121)
  assert.equal(new TextEncoder().encode(row).length, 121)
  const fields = cie.parseBbvaCieLine(row)
  assert.equal(fields.concept, "PRUEBA CIE DEV".padEnd(30, " "))
  assert.equal(fields.convenio, "1234567")
  assert.equal(fields.sourceAccount, "000000001234567890")
  assert.equal(fields.amount, "0000000000123.45")
  assert.equal(fields.reason, fields.concept)
  assert.equal(fields.reference, "REF20260812TEST".padEnd(20, " "))
})

test("CIE fixed strings pad and truncate like VBA String * N", () => {
  const short = cie.serializeBbvaCieLine(syntheticCie({ payment_concept: "A", payment_reference: "R" }))
  assert.equal(cie.parseBbvaCieLine(short).concept, "A".padEnd(30, " "))
  assert.equal(cie.parseBbvaCieLine(short).reference, "R".padEnd(20, " "))

  const long = cie.serializeBbvaCieLine(syntheticCie({
    payment_concept: "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
    payment_reference: "REFERENCE-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  }))
  assert.equal(cie.parseBbvaCieLine(long).concept, "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234")
  assert.equal(cie.parseBbvaCieLine(long).reference, "REFERENCE-ABCDEFGHIJ")
})

test("RemoveTrash mapping and uppercasing match the recovered VBA table", () => {
  assert.equal(
    cie.normalizeBbvaCieText("áéíóúÁÉÍÓÚ.ñÑ!#$%&/()='?¿¡"),
    "AEIOUAEIOU NN             ",
  )
  const row = cie.serializeBbvaCieLine(syntheticCie({
    payment_concept: "págo.cie!",
    payment_reference: "ref-ñ.01",
  }))
  const fields = cie.parseBbvaCieLine(row)
  assert.equal(fields.concept, "PAGO CIE ".padEnd(30, " "))
  assert.equal(fields.reference, "REF-N 01".padEnd(20, " "))
})

test("CIE requires a raw canonical convenio and never parses destination_value", () => {
  assert.throws(
    () => cie.serializeBbvaCieLine(syntheticCie({ convenio_number: null, destination_value: "CONVENIO 1234567" })),
    /convenio CIE debe contener 6 o 7 digitos/,
  )
  assert.throws(
    () => cie.serializeBbvaCieLine(syntheticCie({ convenio_number: "12345" })),
    /6 o 7 digitos/,
  )
  assert.equal(cie.parseBbvaCieLine(cie.serializeBbvaCieLine(syntheticCie({ convenio_number: "123456" }))).convenio, "0123456")
})

test("CIE rejects missing reference, source account, invalid amount, and missing concept", () => {
  const cases = [
    [{ payment_reference: "" }, /referencia CIE requerido/],
    [{ source_account_number: "" }, /cuenta origen CIE debe ser numerica/],
    [{ source_account_number: "12345678" }, /9 o 10 digitos/],
    [{ amount: 0 }, /mayor a cero/],
    [{ amount: "10000000000000.00" }, /excede la mascara/],
    [{ payment_concept: "   " }, /concepto CIE requerido/],
  ]
  for (const [override, expected] of cases) {
    assert.throws(() => cie.serializeBbvaCieLine(syntheticCie(override)), expected)
  }
})

test("CIE rejects ambiguous non-ASCII and delimiter content fail-closed", () => {
  assert.throws(
    () => cie.serializeBbvaCieLine(syntheticCie({ payment_reference: "REF €" })),
    /ASCII portable/,
  )
  assert.throws(
    () => cie.serializeBbvaCieLine(syntheticCie({ payment_reference: "REF|01" })),
    /caracter \| no permitido/,
  )
})

test("two CIE inputs produce exactly two 121-byte records with final CRLF and no BOM", () => {
  const content = cie.buildBbvaCieContent([
    syntheticCie(),
    syntheticCie({ id: "line-cie-2", request_number: "SOL-CIE-QA-2", payment_reference: "REF2" }),
  ])
  const validation = cie.validateBbvaCieContent(content)
  assert.equal(validation.ok, true, validation.errors.join("\n"))
  assert.equal(validation.lineCount, 2)
  assert.deepEqual(Array.from(validation.lineLengths), [121, 121])
  assert.equal(validation.byteLength, 246)
  assert.equal(content.endsWith("\r\n"), true)
  assert.equal(content.endsWith("\r\n\r\n"), false)
  assert.notEqual(content.charCodeAt(0), 0xfeff)
})

test("three rails remain isolated into separate files", () => {
  const files = cie.buildBbvaLayoutFiles(
    [sameBank, interbank, syntheticCie()],
    { layout_number: "LAY-SYNTHETIC" },
  )
  assert.deepEqual(
    Array.from(files, (file) => file.format),
    [cie.BBVA_FORMAT_SAME_BANK, cie.BBVA_FORMAT_INTERBANK, cie.BBVA_FORMAT_CIE],
  )
  assert.equal(files[0].validation.lineCount, 1)
  assert.equal(files[1].validation.lineCount, 1)
  assert.equal(files[2].validation.lineCount, 1)
  assert.equal(files[0].content.includes("REF20260812TEST"), false)
  assert.equal(files[1].content.includes("REF20260812TEST"), false)
  assert.equal(files[2].content.includes("123456789012345678"), false)
  assert.match(files[2].fileName, /^PAGOSCIE_FLUX_/)
})

test("PAGOSBBV and PAGOSINT fixed-width contracts remain stable", () => {
  const pagosbbv = cie.buildBbvaSameBankRecord85(sameBank)
  const pagosint = cie.buildBbvaInterbankRecord128(interbank)
  assert.equal(pagosbbv.length, 85)
  assert.equal(pagosint.length, 128)
  assert.equal(pagosbbv.slice(36, 39), "MXP")
  assert.equal(pagosint.slice(36, 39), "MXP")
  assert.equal(pagosint.slice(85, 90), "40002")
  assert.equal(pagosint.at(-1), "H")
})

test("line validation reports every required CIE domain field without leaking values", () => {
  const invalid = cie.validateLayoutLines([syntheticCie({
    convenio_number: null,
    source_account_number: null,
    amount: 0,
    payment_concept: "",
    payment_reference: "",
  })])
  assert.equal(invalid.length, 1)
  assert.equal(invalid[0].missing_fields.length, 5)
  assert.doesNotMatch(invalid[0].missing_fields.join(" "), /1234567|1234567890|REF2026/)
})

test("migration adds an immutable canonical snapshot with no historical backfill", () => {
  assert.match(migration, /add column if not exists convenio_number text/i)
  assert.match(migration, /snapshot_payment_layout_line_convenio/i)
  assert.match(migration, /payment_layout_line_convenio_snapshot_immutable/i)
  assert.match(migration, /if tg_op = 'INSERT' then[\s\S]*v_refresh_snapshot := true;[\s\S]*else/i)
  assert.match(migration, /select nullif\(btrim\(p\.convenio_number\), ''\)/i)
  assert.doesNotMatch(migration, /update\s+public\.payment_layout_lines\s+set\s+convenio_number/i)
  assert.doesNotMatch(migration, /regexp_replace\s*\(\s*(?:new\.)?destination_value/i)
})

test("documentation pins both source hashes and the no-golden limitation", () => {
  for (const hash of [
    "66F20373CEEA98AEC461FF91526A182C2155BC1435E807FC0F88FC1FF042450D",
    "A17B7A7C40A4BE506CBE50889A6E49F708D7813B4C419E4EDEA369550C491960",
    "CC5B4376A2BD7C9B8E1DE02B29CAFBF186E03D371BC0B9CE7364BC4DA26DF556",
    "4785E40BC10DAC3AF4698D2F29FE1FCC72BB037CEA0FD8A93F16FA6C02945DCD",
  ]) assert.match(docs, new RegExp(hash))
  assert.match(docs, /CIE_SERIALIZER_MATCHES_RECOVERED_VBA_CONTRACT/)
  assert.doesNotMatch(docs, /CIE_SERIALIZER_BYTE_PARITY_WITH_BBVA_MACRO.*PASS/)
})
