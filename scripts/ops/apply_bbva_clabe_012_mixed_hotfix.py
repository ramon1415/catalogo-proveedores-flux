from __future__ import annotations

from pathlib import Path
import re
import textwrap

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


def replace_all(content: str, old: str, new: str, label: str, minimum: int = 1) -> str:
    count = content.count(old)
    if count < minimum:
        raise RuntimeError(f"{label}: expected at least {minimum} matches, found {count}")
    return content.replace(old, new)


def regex_once(content: str, pattern: str, replacement: str, label: str, flags: int = 0) -> str:
    compiled = re.compile(pattern, flags)
    updated, count = compiled.subn(lambda _: replacement, content, count=1)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex match, found {count}")
    return updated


# ---------------------------------------------------------------------------
# React types.
# ---------------------------------------------------------------------------
types_path = "app/src/features/layouts/types.ts"
types = read(types_path)
types = replace_once(
    types,
    "export type BbvaFormat = 'same_bank' | 'interbank' | 'cie'",
    "export type BbvaFormat = 'same_bank' | 'mixed' | 'interbank' | 'cie'",
    "BbvaFormat union",
)
write(types_path, types)


# ---------------------------------------------------------------------------
# React format engine.
# ---------------------------------------------------------------------------
logic_path = "app/src/features/layouts/logic.ts"
logic = read(logic_path)
logic = replace_once(
    logic,
    "archivos bancarios BBVA (PAGOSBBV / PAGOSINT / CIE): fidelidad",
    "archivos bancarios BBVA (PAGOSBBV / PAGOSMIX / PAGOSINT / CIE): fidelidad",
    "logic header",
)
logic = replace_once(
    logic,
    """export const BBVA_FORMAT_SAME_BANK: BbvaFormat = 'same_bank'
export const BBVA_FORMAT_INTERBANK: BbvaFormat = 'interbank'
export const BBVA_FORMAT_CIE: BbvaFormat = 'cie'

export const BBVA_INTERBANK_BENEFICIARY_LENGTH = 30""",
    """export const BBVA_FORMAT_SAME_BANK: BbvaFormat = 'same_bank'
export const BBVA_FORMAT_MIXED: BbvaFormat = 'mixed'
export const BBVA_FORMAT_INTERBANK: BbvaFormat = 'interbank'
export const BBVA_FORMAT_CIE: BbvaFormat = 'cie'

// Pagos Mixtos, registro "Mismo Banco" recuperado del VBA Hoja8.
// UDT uExpTrasBmerMix: PTC(3) + abono(18) + cargo(18) + divisa(3)
// + importe(16) + motivo(30) + CRLF(2).
export const BBVA_MIXED_SAME_BANK_OPERATION = 'PTC'
export const BBVA_MIXED_SAME_BANK_LINE_LENGTH = 3 + CXC_LINE_LENGTH
export const BBVA_MIXED_SAME_BANK_LINE_PATTERN = /^PTC\\d{18}\\d{18}MXP\\d{13}\\.\\d{2}[A-Z0-9 .,&/-]{30}$/

export const BBVA_INTERBANK_BENEFICIARY_LENGTH = 30""",
    "format constants",
)
logic = replace_once(
    logic,
    """export function isBbvaDestinationClabe(value: unknown): boolean {
  const digits = cxcDigits(value)
  return digits.length === CXC_ACCOUNT_LENGTH && digits.startsWith(BBVA_CLABE_BANK_CODE)
}

export function detectBbvaLayoutFormat""",
    """export function isBbvaDestinationClabe(value: unknown): boolean {
  const digits = cxcDigits(value)
  return digits.length === CXC_ACCOUNT_LENGTH && digits.startsWith(BBVA_CLABE_BANK_CODE)
}

export function formatBbvaMixedDestinationClabe(value: unknown): string {
  const digits = cxcDigits(value)
  if (digits.length !== CXC_ACCOUNT_LENGTH || !digits.startsWith(BBVA_CLABE_BANK_CODE)) {
    throw new Error('PAGOSMIX requiere una CLABE BBVA de 18 digitos con prefijo 012')
  }
  return digits
}

export function detectBbvaLayoutFormat""",
    "mixed destination formatter",
)
logic = replace_once(
    logic,
    """  // Una CLABE 012 pertenece a BBVA. Enviarla en PAGOSINT provoca que
  // Net Cash la busque como banco interbancario para un registro de misma institución.
  if (type === 'clabe' && isBbvaDestinationClabe(line.destination_value)) return BBVA_FORMAT_SAME_BANK""",
    """  // Una CLABE 012 pertenece a BBVA, pero el archivo corto PAGOSBBV
  // corresponde al número de cuenta. La macro oficial usa un registro PTC
  // dentro de Pagos Mixtos para el destino BBVA expresado como CLABE.
  if (type === 'clabe' && isBbvaDestinationClabe(line.destination_value)) return BBVA_FORMAT_MIXED""",
    "mixed routing",
)
logic = replace_once(
    logic,
    """export function bbvaFormatLabel(format: BbvaFormat | string): string {
  if (format === BBVA_FORMAT_INTERBANK) return 'PAGOSINT'
  if (format === BBVA_FORMAT_CIE) return 'CIE'
  return 'PAGOSBBV'
}""",
    """export function bbvaFormatLabel(format: BbvaFormat | string): string {
  if (format === BBVA_FORMAT_MIXED) return 'PAGOSMIX'
  if (format === BBVA_FORMAT_INTERBANK) return 'PAGOSINT'
  if (format === BBVA_FORMAT_CIE) return 'CIE'
  return 'PAGOSBBV'
}""",
    "format label",
)
logic = replace_once(
    logic,
    "throw new Error('CLABE BBVA 012 debe generarse en PAGOSBBV, no en PAGOSINT')",
    "throw new Error('CLABE BBVA 012 debe generarse en PAGOSMIX, no en PAGOSINT')",
    "PAGOSINT 012 error",
)
logic = replace_once(
    logic,
    """export function buildBbvaInterbankRecord128(line: PaymentLayoutLine): string {""",
    """export function buildBbvaMixedSameBankRecord88(line: PaymentLayoutLine): string {
  const row = [
    BBVA_MIXED_SAME_BANK_OPERATION,
    formatBbvaMixedDestinationClabe(line.destination_value),
    formatCxcAccount(line.source_account_number, 'cuenta origen PAGOSMIX'),
    CXC_CURRENCY,
    formatCxcAmount(line.amount).padStart(CXC_AMOUNT_LENGTH, '0'),
    formatBbvaText(line.payment_concept, CXC_CONCEPT_LENGTH, 'concepto PAGOSMIX'),
  ].join('')

  if (row.length !== BBVA_MIXED_SAME_BANK_LINE_LENGTH) throw new Error(`bbva_mixed_line_length_invalid_${row.length}`)
  if (!BBVA_MIXED_SAME_BANK_LINE_PATTERN.test(row)) throw new Error('bbva_mixed_line_invalid_characters')
  return row
}

export function buildBbvaInterbankRecord128(line: PaymentLayoutLine): string {""",
    "mixed serializer",
)
logic = replace_once(
    logic,
    """export function buildCxcContent(lines: PaymentLayoutLine[]): string {
  return buildBbvaContent(lines, buildBbvaSameBankRecord85)
}
export function buildBbvaInterbankContent""",
    """export function buildCxcContent(lines: PaymentLayoutLine[]): string {
  return buildBbvaContent(lines, buildBbvaSameBankRecord85)
}
export function buildBbvaMixedContent(lines: PaymentLayoutLine[]): string {
  return buildBbvaContent(lines, buildBbvaMixedSameBankRecord88)
}
export function buildBbvaInterbankContent""",
    "mixed content builder",
)
logic = replace_once(
    logic,
    """export function parseBbvaInterbankLine(line: string) {""",
    """export function parseBbvaMixedLine(line: string) {
  return {
    operation: line.slice(0, 3),
    destinationAccount: line.slice(3, 21),
    sourceAccount: line.slice(21, 39),
    currency: line.slice(39, 42),
    amount: line.slice(42, 58),
    concept: line.slice(58, 88),
  }
}
export function parseBbvaInterbankLine(line: string) {""",
    "mixed parser",
)
logic = replace_once(
    logic,
    """function validateBbvaInterbankFields(line: string, lineNumber: number, errors: string[]) {""",
    """function validateBbvaMixedFields(line: string, lineNumber: number, errors: string[]) {
  const fields = parseBbvaMixedLine(line)
  if (fields.operation !== BBVA_MIXED_SAME_BANK_OPERATION) errors.push(`Layout PAGOSMIX invalido: tipo de operacion de linea ${lineNumber} debe ser ${BBVA_MIXED_SAME_BANK_OPERATION}.`)
  if (!/^012\\d{15}$/.test(fields.destinationAccount)) errors.push(`Layout PAGOSMIX invalido: destino de linea ${lineNumber} debe ser CLABE BBVA 012 de 18 digitos.`)
  if (!/^\\d{18}$/.test(fields.sourceAccount)) errors.push(`Layout PAGOSMIX invalido: cuenta origen de linea ${lineNumber} debe tener 18 digitos sin espacios.`)
  if (fields.currency !== CXC_CURRENCY) errors.push(`Layout PAGOSMIX invalido: moneda de linea ${lineNumber} debe ser ${CXC_CURRENCY}.`)
  if (!/^\\d{13}\\.\\d{2}$/.test(fields.amount)) errors.push(`Layout PAGOSMIX invalido: importe de linea ${lineNumber} debe medir 16 caracteres con punto decimal y 2 decimales.`)
  if (!/^[A-Z0-9 .,&/-]{30}$/.test(fields.concept)) errors.push(`Layout PAGOSMIX invalido: concepto de linea ${lineNumber} contiene caracteres no permitidos.`)
}

function validateBbvaInterbankFields(line: string, lineNumber: number, errors: string[]) {""",
    "mixed field validator",
)
logic = replace_once(
    logic,
    """export function validateBbvaInterbankContent(content: string): LayoutValidation {""",
    """export function validateBbvaMixedContent(content: string): LayoutValidation {
  return validateBbvaContent(content, { formatLabel: 'PAGOSMIX', lineLength: BBVA_MIXED_SAME_BANK_LINE_LENGTH, linePattern: BBVA_MIXED_SAME_BANK_LINE_PATTERN, validateLine: validateBbvaMixedFields })
}
export function validateBbvaInterbankContent(content: string): LayoutValidation {""",
    "mixed content validator",
)
logic = replace_once(
    logic,
    "  const prefix = format === BBVA_FORMAT_INTERBANK ? 'PAGOSINT' : format === BBVA_FORMAT_CIE ? 'PAGOSCIE' : 'PAGOSBBV'",
    "  const prefix = format === BBVA_FORMAT_MIXED ? 'PAGOSMIX' : format === BBVA_FORMAT_INTERBANK ? 'PAGOSINT' : format === BBVA_FORMAT_CIE ? 'PAGOSCIE' : 'PAGOSBBV'",
    "mixed filename prefix",
)
logic = replace_once(
    logic,
    """    [BBVA_FORMAT_SAME_BANK, []],
    [BBVA_FORMAT_INTERBANK, []],""",
    """    [BBVA_FORMAT_SAME_BANK, []],
    [BBVA_FORMAT_MIXED, []],
    [BBVA_FORMAT_INTERBANK, []],""",
    "mixed group",
)
logic = replace_once(
    logic,
    """      if (format === BBVA_FORMAT_SAME_BANK) {
        content = buildCxcContent(groupLines)
        validation = validateCxcContent(content)
        lineLength = CXC_LINE_LENGTH
      } else if (format === BBVA_FORMAT_INTERBANK) {""",
    """      if (format === BBVA_FORMAT_SAME_BANK) {
        content = buildCxcContent(groupLines)
        validation = validateCxcContent(content)
        lineLength = CXC_LINE_LENGTH
      } else if (format === BBVA_FORMAT_MIXED) {
        content = buildBbvaMixedContent(groupLines)
        validation = validateBbvaMixedContent(content)
        lineLength = BBVA_MIXED_SAME_BANK_LINE_LENGTH
      } else if (format === BBVA_FORMAT_INTERBANK) {""",
    "mixed build branch",
)
logic = replace_once(
    logic,
    """export function collectBbvaCieLineIssues(line: PaymentLayoutLine): string[] {""",
    """export function collectBbvaMixedLineIssues(line: PaymentLayoutLine): string[] {
  const issues: string[] = []
  const checks = [
    () => formatBbvaMixedDestinationClabe(line.destination_value),
    () => formatCxcAccount(line.source_account_number, 'cuenta origen PAGOSMIX'),
    () => formatCxcAmount(line.amount),
    () => formatBbvaText(line.payment_concept, CXC_CONCEPT_LENGTH, 'concepto PAGOSMIX'),
  ]
  checks.forEach((check) => {
    try { check() } catch (error: any) { issues.push(error.message) }
  })
  return issues
}

export function collectBbvaCieLineIssues(line: PaymentLayoutLine): string[] {""",
    "mixed line issues",
)
logic = replace_once(
    logic,
    """      if (format === BBVA_FORMAT_CIE) {
        missing.push(...collectBbvaCieLineIssues(line))""",
    """      if (format === BBVA_FORMAT_MIXED) {
        missing.push(...collectBbvaMixedLineIssues(line))
        return { line_id: line.id, payment_request_id: line.payment_request_id, request_number: line.request_number, missing_fields: missing }
      }

      if (format === BBVA_FORMAT_CIE) {
        missing.push(...collectBbvaCieLineIssues(line))""",
    "mixed pre-generation validation",
)
logic = replace_once(
    logic,
    """    [BBVA_FORMAT_SAME_BANK]: { key: BBVA_FORMAT_SAME_BANK, label: 'PAGOSBBV', count: 0, amount: 0, referenceIssues: 0, validationIssues: 0 },
    [BBVA_FORMAT_INTERBANK]:""",
    """    [BBVA_FORMAT_SAME_BANK]: { key: BBVA_FORMAT_SAME_BANK, label: 'PAGOSBBV', count: 0, amount: 0, referenceIssues: 0, validationIssues: 0 },
    [BBVA_FORMAT_MIXED]: { key: BBVA_FORMAT_MIXED, label: 'PAGOSMIX', count: 0, amount: 0, referenceIssues: 0, validationIssues: 0 },
    [BBVA_FORMAT_INTERBANK]:""",
    "mixed summary entry",
)
logic = replace_once(
    logic,
    """      if (format === BBVA_FORMAT_INTERBANK && lineNeedsPagosintReferenceCompletion(line)) summary[format].referenceIssues += 1
      if (format === BBVA_FORMAT_CIE""",
    """      if (format === BBVA_FORMAT_MIXED && collectBbvaMixedLineIssues(line).length) summary[format].validationIssues += 1
      if (format === BBVA_FORMAT_INTERBANK && lineNeedsPagosintReferenceCompletion(line)) summary[format].referenceIssues += 1
      if (format === BBVA_FORMAT_CIE""",
    "mixed summary validation",
)
logic = replace_once(
    logic,
    """export function maskBbvaLine(line: string, format: BbvaFormat | string): string {
  if (format === BBVA_FORMAT_CIE) {""",
    """export function maskBbvaLine(line: string, format: BbvaFormat | string): string {
  if (format === BBVA_FORMAT_MIXED) {
    const fields = parseBbvaMixedLine(line.padEnd(BBVA_MIXED_SAME_BANK_LINE_LENGTH, ' '))
    return [
      `tipo ${fields.operation || '---'}`,
      `destino ${maskSensitiveSuffix(fields.destinationAccount, 4)}`,
      `origen ${maskSensitiveSuffix(fields.sourceAccount, 4)}`,
      `moneda ${fields.currency || '---'}`,
      `importe ${fields.amount || '---'}`,
      `concepto ${fields.concept.trim().slice(0, 18) || '---'}`,
    ].join(' | ')
  }
  if (format === BBVA_FORMAT_CIE) {""",
    "mixed diagnostic mask",
)
write(logic_path, logic)


# ---------------------------------------------------------------------------
# React page and detail modal.
# ---------------------------------------------------------------------------
page_path = "app/src/features/layouts/LayoutsPage.tsx"
page = read(page_path)
page = replace_once(
    page,
    "CXC_MIME_TYPE, BBVA_FORMAT_SAME_BANK, BBVA_FORMAT_INTERBANK, BBVA_FORMAT_CIE,",
    "CXC_MIME_TYPE, BBVA_FORMAT_SAME_BANK, BBVA_FORMAT_MIXED, BBVA_FORMAT_INTERBANK, BBVA_FORMAT_CIE,",
    "LayoutsPage mixed import",
)
page = replace_once(
    page,
    "if (![BBVA_FORMAT_SAME_BANK, BBVA_FORMAT_INTERBANK, BBVA_FORMAT_CIE].includes(format))",
    "if (![BBVA_FORMAT_SAME_BANK, BBVA_FORMAT_MIXED, BBVA_FORMAT_INTERBANK, BBVA_FORMAT_CIE].includes(format))",
    "LayoutsPage allowed formats",
)
page = replace_once(
    page,
    "Solo se pueden descargar PAGOSBBV, PAGOSINT o CIE.",
    "Solo se pueden descargar PAGOSBBV, PAGOSMIX, PAGOSINT o CIE.",
    "LayoutsPage unsupported copy",
)
page = replace_once(
    page,
    """    const sameBank = summary[BBVA_FORMAT_SAME_BANK]
    const interbank = summary[BBVA_FORMAT_INTERBANK]""",
    """    const sameBank = summary[BBVA_FORMAT_SAME_BANK]
    const mixed = summary[BBVA_FORMAT_MIXED]
    const interbank = summary[BBVA_FORMAT_INTERBANK]""",
    "LayoutsPage mixed summary variable",
)
page = replace_once(
    page,
    """    if (sameBank.count > 0) {
      actions.push(<button key="bbv" className={s.smallBtn} type="button" onClick={() => downloadLayoutBbvaFormat(layout.id, BBVA_FORMAT_SAME_BANK)}>▾ Pagos BBVA</button>)
    }
    if (interbank.count > 0) {""",
    """    if (sameBank.count > 0) {
      actions.push(<button key="bbv" className={s.smallBtn} type="button" onClick={() => downloadLayoutBbvaFormat(layout.id, BBVA_FORMAT_SAME_BANK)}>▾ Pagos BBVA</button>)
    }
    if (mixed.count > 0) {
      if (mixed.validationIssues > 0) actions.push(<button key="mix-w" className={`${s.smallBtn} ${s.warning}`} type="button" onClick={() => openLayoutLines(layout.id)}>Revisar Mixtos ({mixed.validationIssues})</button>)
      else actions.push(<button key="mix" className={s.smallBtn} type="button" onClick={() => downloadLayoutBbvaFormat(layout.id, BBVA_FORMAT_MIXED)}>▾ Pagos Mixtos</button>)
    }
    if (interbank.count > 0) {""",
    "LayoutsPage mixed action",
)
write(page_path, page)

lines_path = "app/src/features/layouts/LinesModal.tsx"
lines = read(lines_path)
lines = replace_once(
    lines,
    "BBVA_FORMAT_SAME_BANK, BBVA_FORMAT_INTERBANK, BBVA_FORMAT_CIE,",
    "BBVA_FORMAT_SAME_BANK, BBVA_FORMAT_MIXED, BBVA_FORMAT_INTERBANK, BBVA_FORMAT_CIE,",
    "LinesModal mixed import",
)
lines = replace_once(
    lines,
    """    { item: summary[BBVA_FORMAT_SAME_BANK], key: BBVA_FORMAT_SAME_BANK },
    { item: summary[BBVA_FORMAT_INTERBANK], key: BBVA_FORMAT_INTERBANK },""",
    """    { item: summary[BBVA_FORMAT_SAME_BANK], key: BBVA_FORMAT_SAME_BANK },
    { item: summary[BBVA_FORMAT_MIXED], key: BBVA_FORMAT_MIXED },
    { item: summary[BBVA_FORMAT_INTERBANK], key: BBVA_FORMAT_INTERBANK },""",
    "LinesModal mixed summary row",
)
lines = replace_once(
    lines,
    """                      if (key === BBVA_FORMAT_SAME_BANK) {
                        actionNode = <button className={s.smallBtn} type="button" onClick={() => onDownloadFormat(BBVA_FORMAT_SAME_BANK)}>▾ Pagos BBVA</button>
                      } else if (key === BBVA_FORMAT_INTERBANK) {""",
    """                      if (key === BBVA_FORMAT_SAME_BANK) {
                        actionNode = <button className={s.smallBtn} type="button" onClick={() => onDownloadFormat(BBVA_FORMAT_SAME_BANK)}>▾ Pagos BBVA</button>
                      } else if (key === BBVA_FORMAT_MIXED) {
                        if (item.validationIssues > 0) {
                          statusNode = <Badge variant="warning">{item.validationIssues} linea(s) mixta(s) por corregir</Badge>
                          actionNode = <span style={{ color: 'var(--text-2)', fontSize: 12 }}>Revisa CLABE BBVA, cuenta origen, importe y concepto</span>
                        } else {
                          actionNode = <button className={s.smallBtn} type="button" onClick={() => onDownloadFormat(BBVA_FORMAT_MIXED)}>▾ Pagos Mixtos</button>
                        }
                      } else if (key === BBVA_FORMAT_INTERBANK) {""",
    "LinesModal mixed action",
)
write(lines_path, lines)


# ---------------------------------------------------------------------------
# Legacy engine and UI fallback.
# ---------------------------------------------------------------------------
legacy_path = "layouts.js"
legacy = read(legacy_path)
legacy = replace_once(
    legacy,
    """const BBVA_FORMAT_SAME_BANK = "same_bank"
const BBVA_FORMAT_INTERBANK = "interbank"
const BBVA_FORMAT_CIE = "cie"
const BBVA_INTERBANK_BENEFICIARY_LENGTH = 30""",
    """const BBVA_FORMAT_SAME_BANK = "same_bank"
const BBVA_FORMAT_MIXED = "mixed"
const BBVA_FORMAT_INTERBANK = "interbank"
const BBVA_FORMAT_CIE = "cie"
// Pagos Mixtos, registro Mismo Banco recuperado del VBA Hoja8.
const BBVA_MIXED_SAME_BANK_OPERATION = "PTC"
const BBVA_MIXED_SAME_BANK_LINE_LENGTH = 3 + CXC_LINE_LENGTH
const BBVA_MIXED_SAME_BANK_LINE_PATTERN = /^PTC\\d{18}\\d{18}MXP\\d{13}\\.\\d{2}[A-Z0-9 .,&\\/-]{30}$/
const BBVA_INTERBANK_BENEFICIARY_LENGTH = 30""",
    "legacy constants",
)
legacy = replace_once(
    legacy,
    """function isBbvaDestinationClabe(value) {
  const digits = cxcDigits(value)
  return digits.length === CXC_ACCOUNT_LENGTH && digits.startsWith(BBVA_CLABE_BANK_CODE)
}

function detectBbvaLayoutFormat""",
    """function isBbvaDestinationClabe(value) {
  const digits = cxcDigits(value)
  return digits.length === CXC_ACCOUNT_LENGTH && digits.startsWith(BBVA_CLABE_BANK_CODE)
}

function formatBbvaMixedDestinationClabe(value) {
  const digits = cxcDigits(value)
  if (digits.length !== CXC_ACCOUNT_LENGTH || !digits.startsWith(BBVA_CLABE_BANK_CODE)) {
    throw new Error("PAGOSMIX requiere una CLABE BBVA de 18 digitos con prefijo 012")
  }
  return digits
}

function detectBbvaLayoutFormat""",
    "legacy mixed formatter",
)
legacy = replace_once(
    legacy,
    """  // Una CLABE 012 pertenece a BBVA y debe ir por Pagos BBVA, no Pagos Inter.
  if (type === "clabe" && isBbvaDestinationClabe(line.destination_value)) return BBVA_FORMAT_SAME_BANK""",
    """  // Una CLABE 012 expresada como CLABE usa el registro PTC del archivo mixto.
  if (type === "clabe" && isBbvaDestinationClabe(line.destination_value)) return BBVA_FORMAT_MIXED""",
    "legacy mixed routing",
)
legacy = replace_once(
    legacy,
    "throw new Error(\"CLABE BBVA 012 debe generarse en PAGOSBBV, no en PAGOSINT\")",
    "throw new Error(\"CLABE BBVA 012 debe generarse en PAGOSMIX, no en PAGOSINT\")",
    "legacy PAGOSINT 012 error",
)
legacy = replace_once(
    legacy,
    """function bbvaFormatLabel(format) {
  if (format === BBVA_FORMAT_INTERBANK) return "PAGOSINT"
  if (format === BBVA_FORMAT_CIE) return "CIE"
  return "PAGOSBBV"
}""",
    """function bbvaFormatLabel(format) {
  if (format === BBVA_FORMAT_MIXED) return "PAGOSMIX"
  if (format === BBVA_FORMAT_INTERBANK) return "PAGOSINT"
  if (format === BBVA_FORMAT_CIE) return "CIE"
  return "PAGOSBBV"
}""",
    "legacy format label",
)
legacy = replace_once(
    legacy,
    """function buildBbvaInterbankRecord128(line) {""",
    """function buildBbvaMixedSameBankRecord88(line) {
  const row = [
    BBVA_MIXED_SAME_BANK_OPERATION,
    formatBbvaMixedDestinationClabe(line.destination_value),
    formatCxcAccount(line.source_account_number, "cuenta origen PAGOSMIX"),
    CXC_CURRENCY,
    formatCxcAmount(line.amount).padStart(CXC_AMOUNT_LENGTH, "0"),
    formatBbvaText(line.payment_concept, CXC_CONCEPT_LENGTH, "concepto PAGOSMIX"),
  ].join("")

  if (row.length !== BBVA_MIXED_SAME_BANK_LINE_LENGTH) throw new Error(`bbva_mixed_line_length_invalid_${row.length}`)
  if (!BBVA_MIXED_SAME_BANK_LINE_PATTERN.test(row)) throw new Error("bbva_mixed_line_invalid_characters")
  return row
}

function buildBbvaInterbankRecord128(line) {""",
    "legacy mixed serializer",
)
legacy = replace_once(
    legacy,
    """function buildCxcContent(lines) {
  return buildBbvaContent(lines, buildBbvaSameBankRecord85)
}

function buildBbvaInterbankContent""",
    """function buildCxcContent(lines) {
  return buildBbvaContent(lines, buildBbvaSameBankRecord85)
}

function buildBbvaMixedContent(lines) {
  return buildBbvaContent(lines, buildBbvaMixedSameBankRecord88)
}

function buildBbvaInterbankContent""",
    "legacy mixed content builder",
)
legacy = replace_once(
    legacy,
    """function parseBbvaInterbankLine(line) {""",
    """function parseBbvaMixedLine(line) {
  return {
    operation: line.slice(0, 3),
    destinationAccount: line.slice(3, 21),
    sourceAccount: line.slice(21, 39),
    currency: line.slice(39, 42),
    amount: line.slice(42, 58),
    concept: line.slice(58, 88),
  }
}

function parseBbvaInterbankLine(line) {""",
    "legacy mixed parser",
)
legacy = replace_once(
    legacy,
    """function validateBbvaInterbankFields(line, lineNumber, errors) {""",
    """function validateBbvaMixedFields(line, lineNumber, errors) {
  const fields = parseBbvaMixedLine(line)
  if (fields.operation !== BBVA_MIXED_SAME_BANK_OPERATION) errors.push(`Layout PAGOSMIX invalido: tipo de operacion de linea ${lineNumber} debe ser ${BBVA_MIXED_SAME_BANK_OPERATION}.`)
  if (!/^012\\d{15}$/.test(fields.destinationAccount)) errors.push(`Layout PAGOSMIX invalido: destino de linea ${lineNumber} debe ser CLABE BBVA 012 de 18 digitos.`)
  if (!/^\\d{18}$/.test(fields.sourceAccount)) errors.push(`Layout PAGOSMIX invalido: cuenta origen de linea ${lineNumber} debe tener 18 digitos sin espacios.`)
  if (fields.currency !== CXC_CURRENCY) errors.push(`Layout PAGOSMIX invalido: moneda de linea ${lineNumber} debe ser ${CXC_CURRENCY}.`)
  if (!/^\\d{13}\\.\\d{2}$/.test(fields.amount)) errors.push(`Layout PAGOSMIX invalido: importe de linea ${lineNumber} debe medir 16 caracteres con punto decimal y 2 decimales.`)
  if (!/^[A-Z0-9 .,&\\/-]{30}$/.test(fields.concept)) errors.push(`Layout PAGOSMIX invalido: concepto de linea ${lineNumber} contiene caracteres no permitidos.`)
}

function validateBbvaInterbankFields(line, lineNumber, errors) {""",
    "legacy mixed validator",
)
legacy = replace_once(
    legacy,
    """function validateBbvaInterbankContent(content) {""",
    """function validateBbvaMixedContent(content) {
  return validateBbvaContent(content, {
    formatLabel: "PAGOSMIX",
    lineLength: BBVA_MIXED_SAME_BANK_LINE_LENGTH,
    linePattern: BBVA_MIXED_SAME_BANK_LINE_PATTERN,
    validateLine: validateBbvaMixedFields,
  })
}

function validateBbvaInterbankContent(content) {""",
    "legacy mixed content validator",
)
legacy = replace_once(
    legacy,
    '  const prefix = format === BBVA_FORMAT_INTERBANK ? \"PAGOSINT\" : format === BBVA_FORMAT_CIE ? \"PAGOSCIE\" : \"PAGOSBBV\"',
    '  const prefix = format === BBVA_FORMAT_MIXED ? \"PAGOSMIX\" : format === BBVA_FORMAT_INTERBANK ? \"PAGOSINT\" : format === BBVA_FORMAT_CIE ? \"PAGOSCIE\" : \"PAGOSBBV\"',
    "legacy mixed filename",
)
legacy = replace_once(
    legacy,
    """    [BBVA_FORMAT_SAME_BANK, []],
    [BBVA_FORMAT_INTERBANK, []],""",
    """    [BBVA_FORMAT_SAME_BANK, []],
    [BBVA_FORMAT_MIXED, []],
    [BBVA_FORMAT_INTERBANK, []],""",
    "legacy mixed group",
)
legacy = replace_once(
    legacy,
    """      if (format === BBVA_FORMAT_SAME_BANK) {
        content = buildCxcContent(groupLines)
        validation = validateCxcContent(content)
        lineLength = CXC_LINE_LENGTH
      } else if (format === BBVA_FORMAT_INTERBANK) {""",
    """      if (format === BBVA_FORMAT_SAME_BANK) {
        content = buildCxcContent(groupLines)
        validation = validateCxcContent(content)
        lineLength = CXC_LINE_LENGTH
      } else if (format === BBVA_FORMAT_MIXED) {
        content = buildBbvaMixedContent(groupLines)
        validation = validateBbvaMixedContent(content)
        lineLength = BBVA_MIXED_SAME_BANK_LINE_LENGTH
      } else if (format === BBVA_FORMAT_INTERBANK) {""",
    "legacy mixed build branch",
)
legacy = replace_once(
    legacy,
    """function collectBbvaCieLineIssues(line) {""",
    """function collectBbvaMixedLineIssues(line) {
  const issues = []
  const checks = [
    () => formatBbvaMixedDestinationClabe(line.destination_value),
    () => formatCxcAccount(line.source_account_number, "cuenta origen PAGOSMIX"),
    () => formatCxcAmount(line.amount),
    () => formatBbvaText(line.payment_concept, CXC_CONCEPT_LENGTH, "concepto PAGOSMIX"),
  ]
  checks.forEach((check) => {
    try { check() } catch (error) { issues.push(error.message) }
  })
  return issues
}

function collectBbvaCieLineIssues(line) {""",
    "legacy mixed line issues",
)
legacy = replace_once(
    legacy,
    """      if (format === BBVA_FORMAT_CIE) {
        missing.push(...collectBbvaCieLineIssues(line))""",
    """      if (format === BBVA_FORMAT_MIXED) {
        missing.push(...collectBbvaMixedLineIssues(line))
        return { line_id: line.id, payment_request_id: line.payment_request_id, request_number: line.request_number, missing_fields: missing }
      }

      if (format === BBVA_FORMAT_CIE) {
        missing.push(...collectBbvaCieLineIssues(line))""",
    "legacy mixed line validation",
)
legacy = replace_once(
    legacy,
    """    [BBVA_FORMAT_SAME_BANK]: { key: BBVA_FORMAT_SAME_BANK, label: "PAGOSBBV", count: 0, amount: 0, referenceIssues: 0, validationIssues: 0 },
    [BBVA_FORMAT_INTERBANK]:""",
    """    [BBVA_FORMAT_SAME_BANK]: { key: BBVA_FORMAT_SAME_BANK, label: "PAGOSBBV", count: 0, amount: 0, referenceIssues: 0, validationIssues: 0 },
    [BBVA_FORMAT_MIXED]: { key: BBVA_FORMAT_MIXED, label: "PAGOSMIX", count: 0, amount: 0, referenceIssues: 0, validationIssues: 0 },
    [BBVA_FORMAT_INTERBANK]:""",
    "legacy mixed summary entry",
)
legacy = replace_once(
    legacy,
    """      if (format === BBVA_FORMAT_INTERBANK && lineNeedsPagosintReferenceCompletion(line)) summary[format].referenceIssues += 1
      if (format === BBVA_FORMAT_CIE""",
    """      if (format === BBVA_FORMAT_MIXED && collectBbvaMixedLineIssues(line).length) summary[format].validationIssues += 1
      if (format === BBVA_FORMAT_INTERBANK && lineNeedsPagosintReferenceCompletion(line)) summary[format].referenceIssues += 1
      if (format === BBVA_FORMAT_CIE""",
    "legacy mixed summary validation",
)
legacy = replace_once(
    legacy,
    """function maskBbvaLine(line, format) {
  if (format === BBVA_FORMAT_CIE) {""",
    """function maskBbvaLine(line, format) {
  if (format === BBVA_FORMAT_MIXED) {
    const fields = parseBbvaMixedLine(line.padEnd(BBVA_MIXED_SAME_BANK_LINE_LENGTH, " "))
    return [
      `tipo ${fields.operation || "---"}`,
      `destino ${maskSensitiveSuffix(fields.destinationAccount, 4)}`,
      `origen ${maskSensitiveSuffix(fields.sourceAccount, 4)}`,
      `moneda ${fields.currency || "---"}`,
      `importe ${fields.amount || "---"}`,
      `concepto ${fields.concept.trim().slice(0, 18) || "---"}`,
    ].join(" | ")
  }
  if (format === BBVA_FORMAT_CIE) {""",
    "legacy mixed diagnostic mask",
)
legacy = replace_once(
    legacy,
    """    renderFormatSummaryRow(summary[BBVA_FORMAT_SAME_BANK], BBVA_FORMAT_SAME_BANK),
    renderFormatSummaryRow(summary[BBVA_FORMAT_INTERBANK], BBVA_FORMAT_INTERBANK),""",
    """    renderFormatSummaryRow(summary[BBVA_FORMAT_SAME_BANK], BBVA_FORMAT_SAME_BANK),
    renderFormatSummaryRow(summary[BBVA_FORMAT_MIXED], BBVA_FORMAT_MIXED),
    renderFormatSummaryRow(summary[BBVA_FORMAT_INTERBANK], BBVA_FORMAT_INTERBANK),""",
    "legacy summary row",
)
legacy = replace_once(
    legacy,
    """  if (key === BBVA_FORMAT_SAME_BANK) {
    action = `<button class="small-btn" type="button" onclick="downloadLayoutBbvaFormat('${activeLinesLayoutId}','${BBVA_FORMAT_SAME_BANK}')">▾ Pagos BBVA</button>`
  } else if (key === BBVA_FORMAT_INTERBANK) {""",
    """  if (key === BBVA_FORMAT_SAME_BANK) {
    action = `<button class="small-btn" type="button" onclick="downloadLayoutBbvaFormat('${activeLinesLayoutId}','${BBVA_FORMAT_SAME_BANK}')">▾ Pagos BBVA</button>`
  } else if (key === BBVA_FORMAT_MIXED) {
    if (item.validationIssues > 0) {
      status = `<span class="badge warning">${item.validationIssues} linea(s) mixta(s) por corregir</span>`
      action = `<span style="color:var(--text-2);font-size:12px">Revisa CLABE BBVA, cuenta origen, importe y concepto</span>`
    } else {
      action = `<button class="small-btn" type="button" onclick="downloadLayoutBbvaFormat('${activeLinesLayoutId}','${BBVA_FORMAT_MIXED}')">▾ Pagos Mixtos</button>`
    }
  } else if (key === BBVA_FORMAT_INTERBANK) {""",
    "legacy modal mixed action",
)
legacy = replace_once(
    legacy,
    """  const sameBank = summary[BBVA_FORMAT_SAME_BANK]
  const interbank = summary[BBVA_FORMAT_INTERBANK]""",
    """  const sameBank = summary[BBVA_FORMAT_SAME_BANK]
  const mixed = summary[BBVA_FORMAT_MIXED]
  const interbank = summary[BBVA_FORMAT_INTERBANK]""",
    "legacy row mixed variable",
)
legacy = replace_once(
    legacy,
    """  if (sameBank.count > 0) {
    actions.push(`<button class="small-btn" type="button" onclick="downloadLayoutBbvaFormat('${layout.id}','${BBVA_FORMAT_SAME_BANK}')" style="white-space:nowrap">▾ Pagos BBVA</button>`)
  }

  if (interbank.count > 0) {""",
    """  if (sameBank.count > 0) {
    actions.push(`<button class="small-btn" type="button" onclick="downloadLayoutBbvaFormat('${layout.id}','${BBVA_FORMAT_SAME_BANK}')" style="white-space:nowrap">▾ Pagos BBVA</button>`)
  }

  if (mixed.count > 0) {
    if (mixed.validationIssues > 0) {
      actions.push(`<button class="small-btn warning" type="button" onclick="openLayoutLines('${layout.id}')" style="white-space:nowrap">Revisar Mixtos (${mixed.validationIssues})</button>`)
    } else {
      actions.push(`<button class="small-btn" type="button" onclick="downloadLayoutBbvaFormat('${layout.id}','${BBVA_FORMAT_MIXED}')" style="white-space:nowrap">▾ Pagos Mixtos</button>`)
    }
  }

  if (interbank.count > 0) {""",
    "legacy row mixed action",
)
legacy = replace_all(
    legacy,
    "[BBVA_FORMAT_SAME_BANK, BBVA_FORMAT_INTERBANK, BBVA_FORMAT_CIE]",
    "[BBVA_FORMAT_SAME_BANK, BBVA_FORMAT_MIXED, BBVA_FORMAT_INTERBANK, BBVA_FORMAT_CIE]",
    "legacy allowed format arrays",
)
legacy = replace_all(
    legacy,
    "Solo se pueden descargar PAGOSBBV, PAGOSINT o CIE.",
    "Solo se pueden descargar PAGOSBBV, PAGOSMIX, PAGOSINT o CIE.",
    "legacy unsupported format copy",
)
write(legacy_path, legacy)


# Browser cache-buster.
html_path = "layouts.html"
html = read(html_path)
html = replace_once(
    html,
    "./layouts.js?v=20260903-pagosint-bank-field",
    "./layouts.js?v=20260903-bbva-clabe-mixed",
    "layouts cache-buster",
)
write(html_path, html)


# ---------------------------------------------------------------------------
# Operational documentation grounded in the original workbook and VBA.
# ---------------------------------------------------------------------------
docs_path = "docs/ops/layout-cxc-download-format.md"
docs = read(docs_path)
docs = replace_once(
    docs,
    """- `PAGOSBBV`: pagos mismo banco / CxC, 85 caracteres utiles por registro + CRLF.
- `PAGOSINT`: pagos interbancarios, 128 caracteres utiles por registro + CRLF.""",
    """- `PAGOSBBV`: pagos mismo banco por número de cuenta, 85 caracteres utiles por registro + CRLF.
- `PAGOSMIX`: registro mixto `PTC` para CLABE BBVA `012`, 88 caracteres utiles por registro + CRLF.
- `PAGOSINT`: pagos interbancarios, 128 caracteres utiles por registro + CRLF.""",
    "docs intro formats",
)
docs = replace_once(
    docs,
    """  - Hoja `Pagos Mixtos`: existe, pero no se implementa sin confirmacion operativa.""",
    """  - Hoja `Pagos Mixtos`: contrato recuperado directamente de `Qna 15_2026 AFE Macro Cuentas interbancarias.xlsm` (SHA-256 `CC5B4376A2BD7C9B8E1DE02B29CAFBF186E03D371BC0B9CE7364BC4DA26DF556`) y su `vbaProject.bin` (SHA-256 `4785E40BC10DAC3AF4698D2F29FE1FCC72BB037CEA0FD8A93F16FA6C02945DCD`).""",
    "docs evidence mixed",
)
docs = replace_once(
    docs,
    """| `PAGOSBBV` | `PAGOSBBV020726` | 85 | CRLF por registro | Cuenta/tarjeta BBVA compatible, mismo banco |
| `PAGOSINT` | `PAGOSINT180626` | 128 | CRLF por registro | CLABE/interbancario/TDC cuando aplique |""",
    """| `PAGOSBBV` | `PAGOSBBV020726` | 85 | CRLF por registro | Número de cuenta BBVA, mismo banco |
| `PAGOSMIX` | VBA `Pagos Mixtos` / registro `PTC` | 88 | CRLF por registro | CLABE BBVA de 18 dígitos con prefijo `012` |
| `PAGOSINT` | `PAGOSINT180626` | 128 | CRLF por registro | CLABE de banco externo/TDC cuando aplique |""",
    "docs matrix mixed",
)
mixed_section = """## PAGOSMIX / Pagos Mixtos / registro PTC / 88 caracteres

El procedimiento `Microft_Mixtos` de la hoja VBA `Hoja8` asigna `PTC` cuando el tipo de operación es `Mismo Banco`. El UDT `uExpTrasBmerMix` define el registro exacto:

| Posicion | Longitud | Campo | Regla |
| --- | ---: | --- | --- |
| 1-3 | 3 | Tipo de operación | `PTC` |
| 4-21 | 18 | Cuenta/CLABE de abono | Para este routing: CLABE BBVA completa con prefijo `012` |
| 22-39 | 18 | Cuenta cargo | Número de cuenta origen con ceros a la izquierda |
| 40-42 | 3 | Divisa | `MXP` |
| 43-58 | 16 | Importe | `0000000000000.00` |
| 59-88 | 30 | Motivo | Mayúsculas, normalizado y rellenado con espacios |
| 89-90 | 2 | Terminador físico | `CRLF` |

Ejemplo sintético:

```text
PTC012914000000000007000000000191134094MXP0000000000100.00PRUEBA CLABE BBVA            \\r\\n
```

La macro permite que el campo de abono ocupe 18 posiciones. Flux usa este rail únicamente cuando `destination_type = clabe` y la CLABE comienza con `012`; no intenta recortar ni deducir una cuenta BBVA de 10 dígitos.

"""
docs = replace_once(
    docs,
    "## PAGOSINT / interbancario / 128 caracteres",
    mixed_section + "## PAGOSINT / interbancario / 128 caracteres",
    "docs mixed section",
)
docs = replace_once(
    docs,
    """- `destination_type = cuenta` -> `PAGOSBBV`.
- `destination_type = clabe` con código bancario `012` -> `PAGOSBBV` (misma institución BBVA).
- `destination_type = clabe` con cualquier otro código bancario -> `PAGOSINT`.""",
    """- `destination_type = cuenta` -> `PAGOSBBV`.
- `destination_type = clabe` con código bancario `012` -> `PAGOSMIX`, registro `PTC`.
- `destination_type = clabe` con cualquier otro código bancario -> `PAGOSINT`.""",
    "docs routing",
)
docs = replace_once(
    docs,
    """- `PAGOSBBV_FLUX_<FOLIO>_<YYYYMMDD>.txt`
- `PAGOSINT_FLUX_<FOLIO>_<YYYYMMDD>.txt`""",
    """- `PAGOSBBV_FLUX_<FOLIO>_<YYYYMMDD>.txt`
- `PAGOSMIX_FLUX_<FOLIO>_<YYYYMMDD>.txt`
- `PAGOSINT_FLUX_<FOLIO>_<YYYYMMDD>.txt`""",
    "docs filenames",
)
docs = replace_once(
    docs,
    """La convencion deja el tipo de layout al inicio (`PAGOSBBV` o `PAGOSINT`),""",
    """La convencion deja el tipo de layout al inicio (`PAGOSBBV`, `PAGOSMIX` o `PAGOSINT`),""",
    "docs filename convention",
)
docs = replace_once(
    docs,
    """Una CLABE `012` pertenece a BBVA y se genera en `PAGOSBBV`, no en `PAGOSINT`.""",
    """Una CLABE `012` pertenece a BBVA y se genera en `PAGOSMIX` con tipo `PTC`, no en `PAGOSINT` ni en el archivo corto `PAGOSBBV`.""",
    "docs 012 statement",
)
docs = replace_once(
    docs,
    """- `PAGOSBBV`: 85 caracteres utiles por registro.
- `PAGOSINT`: 128 caracteres utiles por registro,""",
    """- `PAGOSBBV`: 85 caracteres utiles por registro.
- `PAGOSMIX`: 88 caracteres utiles por registro, prefijo `PTC`, CLABE BBVA `012` completa y CRLF final.
- `PAGOSINT`: 128 caracteres utiles por registro,""",
    "docs validations mixed",
)
docs = replace_once(
    docs,
    """- Si operacion requiere lote mixto en un solo archivo, debe validarse contra la hoja `Pagos Mixtos` antes de implementarlo.""",
    """- `PAGOSMIX` reproduce el registro `PTC` recuperado de la macro. La aceptación bancaria final se confirma con el primer upload real usando la opción **Lote mixto** de Net Cash.""",
    "docs risk mixed",
)
write(docs_path, docs)

mixed_doc_path = ROOT / "docs/ops/bbva-mixed-clabe-format.md"
mixed_doc_path.write_text(
    """# BBVA Pagos Mixtos — CLABE BBVA 012 mediante registro PTC

Estado: `PAGOSMIX_PTC_MATCHES_RECOVERED_VBA_CONTRACT`.

## Fuente física

- Workbook: `Qna 15_2026 AFE Macro Cuentas interbancarias.xlsm`.
- SHA-256 workbook: `CC5B4376A2BD7C9B8E1DE02B29CAFBF186E03D371BC0B9CE7364BC4DA26DF556`.
- SHA-256 `xl/vbaProject.bin`: `4785E40BC10DAC3AF4698D2F29FE1FCC72BB037CEA0FD8A93F16FA6C02945DCD`.
- Hoja visible/oculta usada: `Pagos Mixtos` (`Hoja8`).
- Procedimiento: `Microft_Mixtos`.
- Tipo VBA: `uExpTrasBmerMix`.

La revisión fue estática; no se ejecutaron macros ni se modificó el workbook.

## Routing solicitado

| Dato de destino | Rail Flux |
| --- | --- |
| Número de cuenta BBVA | `PAGOSBBV` |
| CLABE BBVA de 18 dígitos con código `012` | `PAGOSMIX` / `PTC` |
| CLABE de banco externo | `PAGOSINT` |
| Convenio | `CIE` |

El código bancario se obtiene de la propia CLABE; no se consulta ni transforma el proveedor vivo al descargar un layout ya creado.

## Registro PTC

Longitud útil: 88 bytes ASCII. Longitud física: 90 bytes con CRLF.

| Campo | Ancho | Valor |
| --- | ---: | --- |
| Tipo de operación | 3 | `PTC` |
| Cuenta/CLABE de abono | 18 | CLABE `012...` completa |
| Cuenta cargo | 18 | Cuenta origen, cero-padding |
| Divisa | 3 | `MXP` |
| Importe | 16 | `0000000000000.00` |
| Motivo | 30 | mayúsculas, ancho fijo |
| Terminador | 2 | CRLF |

La secuencia coincide con `GenerateRow` de `Hoja8`: `TipOper`, abono, cargo, divisa, importe, motivo y CRLF. Para `Mismo Banco`, `Microft_Mixtos` asigna `TipOper = "PTC"`.

## Seguridad operativa

- Sólo se serializan líneas con estado `included`.
- Una línea `paid`, `bank_rejected` o `cancelled` permanece en el historial pero no vuelve a un archivo accionable.
- Una CLABE `012` no puede caer en `PAGOSINT`.
- `PAGOSMIX` exige exactamente 18 dígitos y prefijo `012`; no recorta la CLABE a 10 dígitos.
- El archivo no lleva BOM, encabezado, trailer, pipes, comas ni tabs.
- Cada registro termina en CRLF, incluido el último.

## Operación en BBVA Net Cash

El archivo debe importarse usando **Lote mixto**. La primera aceptación bancaria real sigue siendo el gate operativo definitivo; el serializer declara paridad con la macro recuperada, no una aceptación bancaria inventada.
""",
    encoding="utf-8",
)


# ---------------------------------------------------------------------------
# Regression tests.
# ---------------------------------------------------------------------------
routing_test_path = "scripts/qa/bbva-clabe-012-routing-hotfix.test.mjs"
routing_test = read(routing_test_path)
routing_test = replace_once(
    routing_test,
    """  BBVA_FORMAT_SAME_BANK,
  BBVA_FORMAT_INTERBANK,""",
    """  BBVA_FORMAT_SAME_BANK,
  BBVA_FORMAT_MIXED,
  BBVA_FORMAT_INTERBANK,""",
    "routing test context mixed",
)
routing_test = replace_once(
    routing_test,
    """test("CLABE 012 is routed to PAGOSBBV while external CLABEs remain PAGOSINT", () => {
  assert.equal(bbva.detectBbvaLayoutFormat(bbvaClabe), bbva.BBVA_FORMAT_SAME_BANK)""",
    """test("CLABE 012 is routed to PAGOSMIX while account stays PAGOSBBV and external CLABEs stay PAGOSINT", () => {
  assert.equal(bbva.detectBbvaLayoutFormat(bbvaClabe), bbva.BBVA_FORMAT_MIXED)""",
    "routing test title and expectation",
)
routing_test = replace_once(
    routing_test,
    """  assert.deepEqual(Array.from(files, (file) => file.format), [
    bbva.BBVA_FORMAT_SAME_BANK,
    bbva.BBVA_FORMAT_INTERBANK,
  ])
  const sameBank = files.find((file) => file.format === bbva.BBVA_FORMAT_SAME_BANK)
  const interbank = files.find((file) => file.format === bbva.BBVA_FORMAT_INTERBANK)""",
    """  assert.deepEqual(Array.from(files, (file) => file.format), [
    bbva.BBVA_FORMAT_SAME_BANK,
    bbva.BBVA_FORMAT_MIXED,
    bbva.BBVA_FORMAT_INTERBANK,
  ])
  const sameBank = files.find((file) => file.format === bbva.BBVA_FORMAT_SAME_BANK)
  const mixed = files.find((file) => file.format === bbva.BBVA_FORMAT_MIXED)
  const interbank = files.find((file) => file.format === bbva.BBVA_FORMAT_INTERBANK)""",
    "routing test file groups",
)
routing_test = replace_once(
    routing_test,
    """  assert.equal(sameBank.validation.ok, true, sameBank.validation.errors.join("\\n"))
  assert.equal(interbank.validation.ok, true, interbank.validation.errors.join("\\n"))
  assert.equal(sameBank.validation.lineCount, 2)
  assert.equal(interbank.validation.lineCount, 2)
  assert.deepEqual(Array.from(sameBank.validation.lineLengths), [85, 85])
  assert.deepEqual(Array.from(interbank.validation.lineLengths), [128, 128])""",
    """  assert.equal(sameBank.validation.ok, true, sameBank.validation.errors.join("\\n"))
  assert.equal(mixed.validation.ok, true, mixed.validation.errors.join("\\n"))
  assert.equal(interbank.validation.ok, true, interbank.validation.errors.join("\\n"))
  assert.equal(sameBank.validation.lineCount, 1)
  assert.equal(mixed.validation.lineCount, 1)
  assert.equal(interbank.validation.lineCount, 2)
  assert.deepEqual(Array.from(sameBank.validation.lineLengths), [85])
  assert.deepEqual(Array.from(mixed.validation.lineLengths), [88])
  assert.deepEqual(Array.from(interbank.validation.lineLengths), [128, 128])""",
    "routing test line counts",
)
routing_test = replace_once(
    routing_test,
    """  assert.equal(interbank.content.includes("012914000000000007"), false)
  assert.equal(sameBank.content.includes("012914000000000007"), true)""",
    """  assert.equal(interbank.content.includes("012914000000000007"), false)
  assert.equal(sameBank.content.includes("012914000000000007"), false)
  assert.equal(mixed.content.startsWith("PTC012914000000000007"), true)
  assert.equal(mixed.fileName.startsWith("PAGOSMIX_FLUX_"), true)""",
    "routing test mixed content",
)
routing_test = replace_once(
    routing_test,
    """  assert.match(docs, /clabe` con código bancario `012` -> `PAGOSBBV`/)""",
    """  assert.match(docs, /clabe` con código bancario `012` -> `PAGOSMIX`/)""",
    "routing test docs",
)
write(routing_test_path, routing_test)

bank_test_path = "scripts/qa/bbva-pagosint-bank-field-hotfix.test.mjs"
bank_test = read(bank_test_path)
bank_test = replace_once(
    bank_test,
    """  BBVA_FORMAT_SAME_BANK,
  BBVA_FORMAT_INTERBANK,""",
    """  BBVA_FORMAT_SAME_BANK,
  BBVA_FORMAT_MIXED,
  BBVA_FORMAT_INTERBANK,""",
    "bank test context mixed",
)
bank_test = replace_once(
    bank_test,
    """test("BBVA CLABE 012 stays on PAGOSBBV and external CLABE stays on PAGOSINT", () => {
  assert.equal(
    bbva.detectBbvaLayoutFormat(line({ destination_value: "012914002012607667" })),
    bbva.BBVA_FORMAT_SAME_BANK,
  )""",
    """test("BBVA CLABE 012 routes to PAGOSMIX and external CLABE stays on PAGOSINT", () => {
  assert.equal(
    bbva.detectBbvaLayoutFormat(line({ destination_value: "012914002012607667" })),
    bbva.BBVA_FORMAT_MIXED,
  )""",
    "bank test routing",
)
bank_test = replace_once(
    bank_test,
    """    /PAGOSBBV/,
  )
})""",
    """    /PAGOSMIX/,
  )
})""",
    "bank test error copy",
)
write(bank_test_path, bank_test)

cache_test_path = "scripts/qa/layout-budget-exception-reference-contract.test.mjs"
cache_test = read(cache_test_path)
cache_test = replace_once(
    cache_test,
    "20260903-pagosint-bank-field",
    "20260903-bbva-clabe-mixed",
    "layout cache contract",
)
write(cache_test_path, cache_test)

new_test_path = ROOT / "scripts/qa/bbva-mixed-clabe-macro-contract.test.mjs"
new_test_path.write_text(
    r'''import assert from "node:assert/strict"
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

const expected = "PTC012914000000000007000000000191134094MXP0000000003527.90PRUEBA CLABE BBVA            "

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
''',
    encoding="utf-8",
)


# Final fail-closed guards.
for path, token in [
    (logic_path, "BBVA_FORMAT_MIXED"),
    (legacy_path, "BBVA_FORMAT_MIXED"),
    (page_path, "Pagos Mixtos"),
    (lines_path, "Pagos Mixtos"),
    (docs_path, "PAGOSMIX"),
]:
    if token not in read(path):
        raise RuntimeError(f"final guard missing {token} in {path}")

if "clabe' && isBbvaDestinationClabe(line.destination_value)) return BBVA_FORMAT_SAME_BANK" in read(logic_path):
    raise RuntimeError("React still routes BBVA CLABE to PAGOSBBV")
if 'clabe" && isBbvaDestinationClabe(line.destination_value)) return BBVA_FORMAT_SAME_BANK' in read(legacy_path):
    raise RuntimeError("Legacy still routes BBVA CLABE to PAGOSBBV")

print("BBVA CLABE 012 mixed-format hotfix applied")
