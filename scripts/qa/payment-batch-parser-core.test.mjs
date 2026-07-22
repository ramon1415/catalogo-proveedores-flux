import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const parserPath = path.join(root, "payment_batch_parser.js")
const source = fs.readFileSync(parserPath, "utf8")
const require = createRequire(import.meta.url)
const parser = require(parserPath)

test("BBVA parser exposes a frozen, versioned contract in Node", () => {
  assert.equal(parser.PARSER_VERSION, "bbva-pdf-v1")
  assert.equal(Object.isFrozen(parser), true)
  for (const name of [
    "normalizeCurrency",
    "parseMoneyToMinor",
    "linesFromTextItems",
    "parseBbvaPage",
    "parseBbvaDocument",
    "redactSensitiveText",
  ]) {
    assert.equal(typeof parser[name], "function", `missing parser export ${name}`)
  }
})

test("legacy Mexican currency codes normalize to MXN without FX", () => {
  for (const value of ["MXN", "mxp", "M.N.", "MN", "peso", "pesos mexicanos"]) {
    assert.equal(parser.normalizeCurrency(value), "MXN", value)
  }
  assert.equal(parser.normalizeCurrency("USD"), "USD")
  assert.equal(parser.normalizeCurrency("EUR"), "EUR")
  assert.equal(parser.normalizeCurrency("unknown", "MXN"), "MXN")
})

test("money parsing is exact in minor units across BBVA separator formats", () => {
  const cases = [
    ["$1,234.56 MXP", 123456],
    ["MXN 1.234,56", 123456],
    ["0.10", 10],
    ["0.01", 1],
    ["1,234", 123400],
    ["1.234", 123400],
    ["100", 10000],
    ["(25.09)", -2509],
    ["-25,09", -2509],
  ]
  for (const [input, expected] of cases) {
    assert.equal(parser.parseMoneyToMinor(input), expected, input)
  }
  assert.equal(parser.parseMoneyToMinor("sin importe"), null)
  assert.equal(parser.parseMoneyToMinor("90071992547409.92"), null)
  assert.equal(parser.parseMoneyToMinor("1.2", 7), null)
})

test("money implementation never uses floating-point parsers", () => {
  assert.match(source, /BigInt\(/)
  assert.doesNotMatch(source, /\bparseFloat\s*\(/)
  assert.doesNotMatch(source, /\bMath\.(?:round|floor|ceil|trunc)\s*\(/)
  assert.doesNotMatch(source, /\btoFixed\s*\(/)
})

test("financial display preserves the largest browser-safe cent exactly", () => {
  assert.equal(
    parser.formatMinorForDisplay(Number.MAX_SAFE_INTEGER, "MXN"),
    "MXN 90,071,992,547,409.91",
  )
  assert.equal(parser.formatMinorForDisplay(-1, "USD"), "-USD 0.01")
})

test("PDF text items are grouped top-to-bottom and left-to-right", () => {
  assert.deepEqual(parser.linesFromTextItems([
    { str: "1,234.56", transform: [1, 0, 0, 1, 120, 700] },
    { str: "Importe", transform: [1, 0, 0, 1, 10, 700] },
    { str: "Referencia: ABC-42", transform: [1, 0, 0, 1, 10, 650] },
  ]), [
    "Importe 1,234.56",
    "Referencia: ABC-42",
  ])
})

test("one BBVA page yields exact minor units, MXN, ISO date and redacted account data", () => {
  const result = parser.parseBbvaPage({
    pageNumber: 3,
    lines: [
      "BBVA México",
      "Estado: Operado",
      "Fecha de operación: 21/07/2026",
      "Importe: MXP 1,234.56",
      "Folio único: REF-20260721",
      "Clave de rastreo: ABCD1234EFGH5678",
      "Beneficiario: Proveedor de Prueba",
      "Concepto: Pago controlado",
      "Cuenta de retiro: 0123456789",
      "Cuenta destino: 012345678901234567",
    ],
  }, { fileName: "comprobante-controlado.pdf" })

  assert.equal(Object.isFrozen(result), true)
  assert.equal(result.parser_version, "bbva-pdf-v1")
  assert.equal(result.source_page, 3)
  assert.equal(result.bank_code, "BBVA_MX")
  assert.equal(result.bank_status, "Operado")
  assert.equal(result.operation_date, "2026-07-21")
  assert.equal(result.amount_minor, 123456)
  assert.equal(result.currency, "MXN")
  assert.equal(result.bank_reference, "REF-20260721")
  assert.equal(result.bank_unique_folio, "REF-20260721")
  assert.equal(result.beneficiary_name, "Proveedor de Prueba")
  assert.equal(result.destination_masked, "••••4567")
  assert.deepEqual(result.review_issues, [])
  assert.equal(result.confidence, "high")
  assert.equal(result.source_filename, "comprobante-controlado.pdf")
  assert.doesNotMatch(JSON.stringify(result), /01234567890123/)
})

test("incomplete pages stay reviewable and never invent missing financial facts", () => {
  const page = parser.parseBbvaPage({
    pageNumber: 1,
    lines: ["Documento sin estructura bancaria", "Concepto: prueba"],
  })
  assert.equal(page.operation_date, null)
  assert.equal(page.amount_minor, null)
  assert.equal(page.bank_reference, null)
  assert.equal(page.beneficiary_name, null)
  assert.equal(page.confidence, "low")
  assert.deepEqual(page.review_issues, [
    "bank_not_identified",
    "operation_date_missing",
    "amount_missing_or_invalid",
    "currency_missing_or_invalid",
    "bank_unique_folio_missing",
    "strong_bank_identity_missing",
    "beneficiary_missing",
    "bank_status_not_operated",
  ])
})

test("a non-operated bank status stays blocked for human review", () => {
  const page = parser.parseBbvaPage({
    pageNumber: 1,
    lines: [
      "BBVA México",
      "Estado: Pendiente",
      "Fecha de aplicación: 21/07/2026",
      "Importe: 100.00 MXN",
      "Folio único: ABC-1234",
      "Beneficiario: Alpha",
      "Cuenta de retiro: 0123456789",
      "Cuenta destino: 012345678901234567",
    ],
  })
  assert.equal(page.bank_status, "Pendiente")
  assert.deepEqual(page.review_issues, ["bank_status_not_operated"])
  assert.equal(page.confidence, "medium")
})

test("alphanumeric lookalikes never qualify as strong BBVA account identity", () => {
  const page = parser.parseBbvaPage({
    pageNumber: 1,
    lines: [
      "BBVA México",
      "Estado: Operado",
      "Fecha de aplicación: 21/07/2026",
      "Importe: 100.00 MXN",
      "Folio único: ABCD-1234",
      "Beneficiario: Alpha",
      "Cuenta de retiro: ABCDEFGHIJ",
      "Cuenta destino: 012345678901234567",
    ],
  })
  assert.deepEqual(page.review_issues, ["strong_bank_identity_missing"])
})

test("document parsing preserves one proposed operation per source page", () => {
  const document = parser.parseBbvaDocument([
    {
      pageNumber: 1,
      lines: [
        "BBVA",
        "Estado: Operado",
        "Fecha: 20 de julio de 2026",
        "Monto: $10.00 MXN",
        "Folio único: UNO-0001",
        "Beneficiario: Alpha",
        "Cuenta de retiro: 0123456789",
        "Cuenta destino: 012345678901234567",
      ],
    },
    { pageNumber: 2, lines: ["Texto no estructurado"] },
  ])
  assert.equal(Object.isFrozen(document), true)
  assert.equal(document.page_count, 2)
  assert.equal(document.operations.length, 2)
  assert.equal(document.operations[0].amount_minor, 1000)
  assert.equal(document.operations[0].operation_date, "2026-07-20")
  assert.equal(document.review_required_count, 1)
})

test("sensitive numeric and token-like text is masked deterministically", () => {
  const redacted = parser.redactSensitiveText(
    "Cuenta 012345678901234567 token ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
  )
  assert.equal(redacted, "Cuenta ••••4567 token ABCD…3456")
  assert.doesNotMatch(redacted, /01234567890123/)
  assert.doesNotMatch(redacted, /EFGHIJKLMNOPQRSTUVW/)
})

test("account redaction cannot be bypassed with non-alphanumeric separators", () => {
  for (const value of [
    "Cuenta 1234/5678/9012/3456",
    "CLABE 1234  5678  9012  3456",
    "Cuenta 1234--5678--9012--3456",
    "Cuenta 1234:5678:9012:3456",
    "CLABE 1234_5678_9012_3456",
  ]) {
    const redacted = parser.redactSensitiveText(value)
    assert.match(redacted, /••••3456/)
    assert.doesNotMatch(redacted, /1234|5678|9012/)
  }
})
