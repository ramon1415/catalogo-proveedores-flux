from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return content.replace(old, new, 1)


def replace_many(content: str, old: str, new: str, label: str, minimum: int = 1) -> str:
    count = content.count(old)
    if count < minimum:
        raise RuntimeError(f"{label}: expected at least {minimum} matches, found {count}")
    return content.replace(old, new)


def replace_regex_once(content: str, pattern: str, replacement: str, label: str) -> str:
    next_content, count = re.subn(pattern, replacement, content, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex match, found {count}")
    return next_content


# ---------------------------------------------------------------------------
# React serializer and validation.
# ---------------------------------------------------------------------------
react_path = "app/src/features/layouts/logic.ts"
react = read(react_path)
react = replace_once(
    react,
    """export const BBVA_INTERBANK_BENEFICIARY_LENGTH = 30
export const BBVA_INTERBANK_REFERENCE_LENGTH = 5
export const BBVA_INTERBANK_REFERENCE_INPUT_RULE = '1 a 5 digitos; el TXT completa con ceros a la izquierda'
export const BBVA_INTERBANK_CONCEPT_LENGTH = 37
export const BBVA_INTERBANK_INDICATOR = 'H'
export const BBVA_INTERBANK_LINE_LENGTH =
  CXC_ACCOUNT_LENGTH * 2 + CXC_CURRENCY_LENGTH + CXC_AMOUNT_LENGTH +
  BBVA_INTERBANK_BENEFICIARY_LENGTH + BBVA_INTERBANK_REFERENCE_LENGTH + BBVA_INTERBANK_CONCEPT_LENGTH + 1""",
    """export const BBVA_INTERBANK_BENEFICIARY_LENGTH = 30
// `payment_reference` se conserva como dato operativo interno. Las posiciones
// 86-90 del TXT son disponibilidad + banco, no esa referencia.
export const BBVA_INTERBANK_REFERENCE_LENGTH = 5
export const BBVA_INTERBANK_REFERENCE_INPUT_RULE = '1 a 5 digitos como referencia operativa interna'
export const BBVA_INTERBANK_BANK_FIELD_PREFIX = '40'
export const BBVA_INTERBANK_BANK_CODE_LENGTH = 3
export const BBVA_INTERBANK_BANK_FIELD_LENGTH = 5
export const BBVA_INTERBANK_CONCEPT_LENGTH = 37
export const BBVA_INTERBANK_INDICATOR = 'H'
export const BBVA_INTERBANK_LINE_LENGTH =
  CXC_ACCOUNT_LENGTH * 2 + CXC_CURRENCY_LENGTH + CXC_AMOUNT_LENGTH +
  BBVA_INTERBANK_BENEFICIARY_LENGTH + BBVA_INTERBANK_BANK_FIELD_LENGTH + BBVA_INTERBANK_CONCEPT_LENGTH + 1""",
    "react constants",
)
react = replace_once(
    react,
    """export function formatBbvaReference(value: unknown): string {
  const digits = cxcDigits(value)
  if (!digits) throw new Error('referencia numerica PAGOSINT requerida')
  if (digits.length > BBVA_INTERBANK_REFERENCE_LENGTH) throw new Error('referencia numerica PAGOSINT acepta maximo 5 digitos')
  return digits.padStart(BBVA_INTERBANK_REFERENCE_LENGTH, '0')
}""",
    """export function formatBbvaReference(value: unknown): string {
  const digits = cxcDigits(value)
  if (!digits) throw new Error('referencia numerica PAGOSINT requerida')
  if (digits.length > BBVA_INTERBANK_REFERENCE_LENGTH) throw new Error('referencia numerica PAGOSINT acepta maximo 5 digitos')
  return digits.padStart(BBVA_INTERBANK_REFERENCE_LENGTH, '0')
}

// Contrato recuperado de archivos productivos aceptados por BBVA:
// posiciones 86-90 = `40` + las primeras 3 posiciones de la CLABE.
// Ejemplos: 002 -> 40002, 014 -> 40014.
export function formatBbvaInterbankBankField(destinationValue: unknown): string {
  const digits = cxcDigits(destinationValue)
  if (digits.length !== CXC_ACCOUNT_LENGTH) {
    throw new Error('CLABE PAGOSINT debe tener exactamente 18 digitos para derivar el banco')
  }
  const bankCode = digits.slice(0, BBVA_INTERBANK_BANK_CODE_LENGTH)
  if (bankCode === BBVA_CLABE_BANK_CODE) {
    throw new Error('CLABE BBVA 012 debe generarse en PAGOSBBV, no en PAGOSINT')
  }
  return `${BBVA_INTERBANK_BANK_FIELD_PREFIX}${bankCode}`
}""",
    "react bank-field formatter",
)
react = replace_once(
    react,
    "    formatBbvaReference(line.payment_reference),",
    "    formatBbvaInterbankBankField(line.destination_value),",
    "react serializer field",
)
react = replace_once(
    react,
    """    numericReference: line.slice(85, 90),
    concept: line.slice(90, 127),""",
    """    bankField: line.slice(85, 90),
    // Alias temporal para consumidores antiguos; ya no representa una
    // referencia capturada por el usuario.
    numericReference: line.slice(85, 90),
    concept: line.slice(90, 127),""",
    "react parser",
)
react = replace_once(
    react,
    """  if (!/^\\d{5}$/.test(fields.numericReference)) errors.push(`Layout PAGOSINT invalido: referencia numerica de linea ${lineNumber} debe ocupar 5 posiciones numericas; ${BBVA_INTERBANK_REFERENCE_INPUT_RULE}.`)""",
    """  const expectedBankField = `${BBVA_INTERBANK_BANK_FIELD_PREFIX}${fields.destinationAccount.slice(0, BBVA_INTERBANK_BANK_CODE_LENGTH)}`
  if (!/^\\d{5}$/.test(fields.bankField)) {
    errors.push(`Layout PAGOSINT invalido: campo banco de linea ${lineNumber} debe ocupar 5 posiciones numericas.`)
  } else if (fields.destinationAccount.startsWith(BBVA_CLABE_BANK_CODE)) {
    errors.push(`Layout PAGOSINT invalido: la CLABE de linea ${lineNumber} pertenece a BBVA y debe salir en PAGOSBBV.`)
  } else if (fields.bankField !== expectedBankField) {
    errors.push(`Layout PAGOSINT invalido: campo banco de linea ${lineNumber} debe ser ${expectedBankField}.`)
  }""",
    "react validator",
)
react = replace_once(
    react,
    "      `ref ${fields.numericReference || '---'}` ,".replace("'}` ,", "'}`,"),
    "      `banco ${fields.bankField || '---'}` ,".replace("'}` ,", "'}` ,"),
    "react masked diagnostic",
)
# Normalize the replacement above to the repository's comma style.
react = react.replace("      `banco ${fields.bankField || '---'}` ,", "      `banco ${fields.bankField || '---'}`,")
react = replace_once(
    react,
    """  lines.forEach((line) => {
    const format = detectBbvaLayoutFormat(line)""",
    """  lines.filter((line) => line.status === 'included').forEach((line) => {
    const format = detectBbvaLayoutFormat(line)""",
    "react central paid-line exclusion",
)
react = replace_many(
    react,
    ".filter((line) => line.status !== 'bank_rejected')",
    ".filter((line) => line.status === 'included')",
    "react validation paid-line exclusion",
)
react = replace_many(
    react,
    "if (line.status === 'bank_rejected') continue",
    "if (line.status !== 'included') continue",
    "react summary paid-line exclusion",
)
write(react_path, react)

# React page and line modal use the same actionable-line scope.
page_path = "app/src/features/layouts/LayoutsPage.tsx"
page = read(page_path)
page = replace_many(
    page,
    "line.status !== 'bank_rejected'",
    "line.status === 'included'",
    "React LayoutsPage active filters",
)
page = replace_many(
    page,
    "line.status === 'bank_rejected'",
    "line.status !== 'included'",
    "React LayoutsPage skip filters",
)
write(page_path, page)

lines_modal_path = "app/src/features/layouts/LinesModal.tsx"
lines_modal = read(lines_modal_path)
lines_modal = replace_many(
    lines_modal,
    "line.status !== 'bank_rejected'",
    "line.status === 'included'",
    "React LinesModal active filters",
)
write(lines_modal_path, lines_modal)

# ---------------------------------------------------------------------------
# Legacy serializer and validation, still shipped as a browser fallback.
# ---------------------------------------------------------------------------
legacy_path = "layouts.js"
legacy = read(legacy_path)
legacy = replace_once(
    legacy,
    """const BBVA_INTERBANK_BENEFICIARY_LENGTH = 30
const BBVA_INTERBANK_REFERENCE_LENGTH = 5
const BBVA_INTERBANK_REFERENCE_INPUT_RULE = "1 a 5 digitos; el TXT completa con ceros a la izquierda"
const BBVA_INTERBANK_CONCEPT_LENGTH = 37
const BBVA_INTERBANK_INDICATOR = "H"
const BBVA_INTERBANK_LINE_LENGTH = CXC_ACCOUNT_LENGTH * 2 + CXC_CURRENCY_LENGTH + CXC_AMOUNT_LENGTH + BBVA_INTERBANK_BENEFICIARY_LENGTH + BBVA_INTERBANK_REFERENCE_LENGTH + BBVA_INTERBANK_CONCEPT_LENGTH + 1""",
    """const BBVA_INTERBANK_BENEFICIARY_LENGTH = 30
// `payment_reference` se conserva como dato operativo interno. Las posiciones
// 86-90 del TXT son disponibilidad + banco, no esa referencia.
const BBVA_INTERBANK_REFERENCE_LENGTH = 5
const BBVA_INTERBANK_REFERENCE_INPUT_RULE = "1 a 5 digitos como referencia operativa interna"
const BBVA_INTERBANK_BANK_FIELD_PREFIX = "40"
const BBVA_INTERBANK_BANK_CODE_LENGTH = 3
const BBVA_INTERBANK_BANK_FIELD_LENGTH = 5
const BBVA_INTERBANK_CONCEPT_LENGTH = 37
const BBVA_INTERBANK_INDICATOR = "H"
const BBVA_INTERBANK_LINE_LENGTH = CXC_ACCOUNT_LENGTH * 2 + CXC_CURRENCY_LENGTH + CXC_AMOUNT_LENGTH + BBVA_INTERBANK_BENEFICIARY_LENGTH + BBVA_INTERBANK_BANK_FIELD_LENGTH + BBVA_INTERBANK_CONCEPT_LENGTH + 1""",
    "legacy constants",
)
legacy = replace_once(
    legacy,
    """function formatBbvaReference(value) {
  const digits = cxcDigits(value)
  if (!digits) throw new Error("referencia numerica PAGOSINT requerida")
  if (digits.length > BBVA_INTERBANK_REFERENCE_LENGTH) throw new Error("referencia numerica PAGOSINT acepta maximo 5 digitos")
  return digits.padStart(BBVA_INTERBANK_REFERENCE_LENGTH, "0")
}""",
    """function formatBbvaReference(value) {
  const digits = cxcDigits(value)
  if (!digits) throw new Error("referencia numerica PAGOSINT requerida")
  if (digits.length > BBVA_INTERBANK_REFERENCE_LENGTH) throw new Error("referencia numerica PAGOSINT acepta maximo 5 digitos")
  return digits.padStart(BBVA_INTERBANK_REFERENCE_LENGTH, "0")
}

// Contrato recuperado de archivos productivos aceptados por BBVA:
// posiciones 86-90 = `40` + las primeras 3 posiciones de la CLABE.
function formatBbvaInterbankBankField(destinationValue) {
  const digits = cxcDigits(destinationValue)
  if (digits.length !== CXC_ACCOUNT_LENGTH) {
    throw new Error("CLABE PAGOSINT debe tener exactamente 18 digitos para derivar el banco")
  }
  const bankCode = digits.slice(0, BBVA_INTERBANK_BANK_CODE_LENGTH)
  if (bankCode === BBVA_CLABE_BANK_CODE) {
    throw new Error("CLABE BBVA 012 debe generarse en PAGOSBBV, no en PAGOSINT")
  }
  return `${BBVA_INTERBANK_BANK_FIELD_PREFIX}${bankCode}`
}""",
    "legacy bank-field formatter",
)
legacy = replace_once(
    legacy,
    "    formatBbvaReference(line.payment_reference),",
    "    formatBbvaInterbankBankField(line.destination_value),",
    "legacy serializer field",
)
legacy = replace_once(
    legacy,
    """    numericReference: line.slice(85, 90),
    concept: line.slice(90, 127),""",
    """    bankField: line.slice(85, 90),
    // Alias temporal para consumidores antiguos.
    numericReference: line.slice(85, 90),
    concept: line.slice(90, 127),""",
    "legacy parser",
)
legacy = replace_once(
    legacy,
    """  if (!/^\\d{5}$/.test(fields.numericReference)) errors.push(`Layout PAGOSINT invalido: referencia numerica de linea ${lineNumber} debe ocupar 5 posiciones numericas; ${BBVA_INTERBANK_REFERENCE_INPUT_RULE}.`)""",
    """  const expectedBankField = `${BBVA_INTERBANK_BANK_FIELD_PREFIX}${fields.destinationAccount.slice(0, BBVA_INTERBANK_BANK_CODE_LENGTH)}`
  if (!/^\\d{5}$/.test(fields.bankField)) {
    errors.push(`Layout PAGOSINT invalido: campo banco de linea ${lineNumber} debe ocupar 5 posiciones numericas.`)
  } else if (fields.destinationAccount.startsWith(BBVA_CLABE_BANK_CODE)) {
    errors.push(`Layout PAGOSINT invalido: la CLABE de linea ${lineNumber} pertenece a BBVA y debe salir en PAGOSBBV.`)
  } else if (fields.bankField !== expectedBankField) {
    errors.push(`Layout PAGOSINT invalido: campo banco de linea ${lineNumber} debe ser ${expectedBankField}.`)
  }""",
    "legacy validator",
)
legacy = replace_once(
    legacy,
    '      `ref ${fields.numericReference || "---"}`,',
    '      `banco ${fields.bankField || "---"}`,',
    "legacy masked diagnostic",
)
legacy = replace_once(
    legacy,
    """  lines.forEach((line) => {
    const format = detectBbvaLayoutFormat(line)""",
    """  lines.filter((line) => line.status === "included").forEach((line) => {
    const format = detectBbvaLayoutFormat(line)""",
    "legacy central paid-line exclusion",
)
legacy = replace_many(
    legacy,
    '.filter((line) => line.status !== "bank_rejected")',
    '.filter((line) => line.status === "included")',
    "legacy line filters",
)
legacy = replace_many(
    legacy,
    '.filter((item) => item.status !== "bank_rejected")',
    '.filter((item) => item.status === "included")',
    "legacy item filters",
)
legacy = replace_many(
    legacy,
    'if (line.status === "bank_rejected") continue',
    'if (line.status !== "included") continue',
    "legacy summary filters",
)
write(legacy_path, legacy)

# Browser cache-buster.
html_path = "layouts.html"
html = read(html_path)
html = replace_once(
    html,
    "./layouts.js?v=20260903-bbva-clabe-012-routing",
    "./layouts.js?v=20260903-pagosint-bank-field",
    "legacy cache-buster",
)
write(html_path, html)

# ---------------------------------------------------------------------------
# Documentation: fix the field semantics recovered from accepted files.
# ---------------------------------------------------------------------------
docs_path = "docs/ops/layout-cxc-download-format.md"
docs = read(docs_path)
docs = replace_once(
    docs,
    "| 86-90 | 5 | Referencia numerica | Captura de 1 a 5 digitos; el TXT completa con ceros a la izquierda |",
    "| 86-90 | 5 | Campo banco / disponibilidad | `40` + código de banco de 3 dígitos tomado de las primeras 3 posiciones de la CLABE (`002` → `40002`) |",
    "docs field table",
)
docs = replace_regex_once(
    docs,
    r"## Referencia PAGOSINT en layouts ya generados\n[\s\S]*?(?=## Validaciones locales)",
    """## Campo banco PAGOSINT

Las posiciones 86-90 **no son una referencia capturada por el usuario**. Los archivos históricos aceptados por BBVA muestran el contrato:

- prefijo fijo de disponibilidad: `40`;
- código de banco: primeras 3 posiciones de la CLABE;
- ejemplos: CLABE `002...` → `40002`, CLABE `014...` → `40014`.

Flux deriva este campo automáticamente al descargar el archivo. `payment_reference` se conserva como dato operativo interno de la solicitud/layout, pero no se serializa en ese bloque.

Una CLABE `012` pertenece a BBVA y se genera en `PAGOSBBV`, no en `PAGOSINT`.

""",
    "docs bank-field section",
)
docs = replace_once(
    docs,
    "- `PAGOSINT`: 128 caracteres utiles por registro, titular 30, referencia numerica de 5 posiciones en archivo, motivo 37, indicador final `H`.\n- `PAGOSINT`: la referencia capturada no tiene que ser exactamente de 5 digitos; si operacion captura `7`, `42` o `40002`, el archivo sale como `00007`, `00042` o `40002` para conservar las posiciones 86-90.",
    "- `PAGOSINT`: 128 caracteres utiles por registro, titular 30, campo banco/disponibilidad de 5 posiciones, motivo 37, indicador final `H`.\n- `PAGOSINT`: el campo banco debe coincidir con `40` + las primeras 3 posiciones de la CLABE; no se toma de `payment_reference`.",
    "docs validation bullets",
)
docs = replace_once(
    docs,
    "- `destination_type = clabe` con cualquier otro código bancario -> `PAGOSINT`.\n",
    "- `destination_type = clabe` con cualquier otro código bancario -> `PAGOSINT`.\n- Solo las líneas con estado `included` se vuelven a descargar; una línea `paid` nunca se reemite en un archivo accionable.\n",
    "docs paid-line scope",
)
write(docs_path, docs)

# ---------------------------------------------------------------------------
# Existing contracts aligned to the recovered field semantics.
# ---------------------------------------------------------------------------
cie_test_path = "scripts/qa/bbva-cie-layout-contract.test.mjs"
cie_test = read(cie_test_path)
cie_test = replace_once(
    cie_test,
    'test("PAGOSBBV and PAGOSINT record contracts remain unchanged", () => {',
    'test("PAGOSBBV and PAGOSINT fixed-width contracts remain stable", () => {',
    "CIE test title",
)
cie_test = replace_once(
    cie_test,
    '  assert.equal(pagosint.slice(85, 90), "00042")',
    '  assert.equal(pagosint.slice(85, 90), "40002")',
    "CIE PAGOSINT bank field",
)
write(cie_test_path, cie_test)

routing_test_path = "scripts/qa/bbva-clabe-012-routing-hotfix.test.mjs"
routing_test = read(routing_test_path)
routing_test = replace_once(
    routing_test,
    """  assert.equal(interbank.validation.lines[0].slice(0, 3), "002")
  assert.equal(interbank.content.includes("012914000000000007"), false)""",
    """  assert.equal(interbank.validation.lines[0].slice(0, 3), "002")
  assert.equal(interbank.validation.lines[0].slice(85, 90), "40002")
  assert.equal(interbank.validation.lines[1].slice(85, 90), "40646")
  assert.equal(interbank.content.includes("03082"), false)
  assert.equal(interbank.content.includes("012914000000000007"), false)""",
    "routing test bank fields",
)
write(routing_test_path, routing_test)

budget_test_path = "scripts/qa/layout-budget-exception-reference-contract.test.mjs"
budget_test = read(budget_test_path)
budget_test = replace_once(
    budget_test,
    "20260903-bbva-clabe-012-routing",
    "20260903-pagosint-bank-field",
    "cache contract test",
)
write(budget_test_path, budget_test)

# New focused contract.
new_test_path = ROOT / "scripts/qa/bbva-pagosint-bank-field-hotfix.test.mjs"
new_test_path.write_text(
    r'''import assert from "node:assert/strict"
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
''',
    encoding="utf-8",
)

# Final guards: both runtimes and docs must be in lockstep.
legacy = read(legacy_path)
react = read(react_path)
page = read(page_path)
lines_modal = read(lines_modal_path)
docs = read(docs_path)
assert "formatBbvaInterbankBankField(line.destination_value)" in legacy
assert "formatBbvaInterbankBankField(line.destination_value)" in react
assert "BBVA_INTERBANK_BANK_FIELD_PREFIX" in legacy
assert "BBVA_INTERBANK_BANK_FIELD_PREFIX" in react
assert 'line.status !== "bank_rejected"' not in legacy
assert "line.status !== 'bank_rejected'" not in react
assert "line.status !== 'bank_rejected'" not in page
assert "line.status !== 'bank_rejected'" not in lines_modal
assert "20260903-pagosint-bank-field" in read(html_path)
assert "40002" in docs

print("BBVA PAGOSINT bank-field hotfix applied successfully")
