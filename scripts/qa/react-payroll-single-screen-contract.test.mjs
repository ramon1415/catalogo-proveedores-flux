import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const modal = fs.readFileSync('app/src/features/nomina/CaptureModal.tsx', 'utf8')
const logic = fs.readFileSync('app/src/features/nomina/logic.ts', 'utf8')
const physical = fs.readFileSync('app/src/features/nomina/physicalParsers.ts', 'utf8')
const types = fs.readFileSync('app/src/features/nomina/types.ts', 'utf8')

test('WS4 collapses new payroll capture to one multi-file dropzone and one primary CTA', () => {
  assert.match(modal, /type="file"[\s\S]*?multiple/)
  assert.match(modal, /Arrastra aquí los archivos de la corrida/)
  assert.match(modal, /Registrar y enviar a aprobación/)
  assert.doesNotMatch(modal, /type="checkbox"/)
  assert.match(modal, /channelsFromFiles\(nextFiles\)/)
})

test('file detection reuses the canonical certified physical parsers', () => {
  assert.match(physical, /import '\.\.\/\.\.\/\.\.\/\.\.\/payroll_real_formats\.js'/)
  assert.match(physical, /parseCoverXlsx\(buffer\)/)
  assert.match(physical, /parseSameBank108\(buffer\)/)
  assert.match(physical, /parseTokaCfdi\(buffer\)/)
  assert.match(physical, /parsePayrollSpeiTxt\(buffer\)/)
  assert.match(physical, /TOKA INTERNACIONAL/)
})

test('browser state retains only aggregate diagnostics and never renders employee PII', () => {
  assert.match(types, /export type LocalFileDiagnostic/)
  assert.match(types, /recordCount: number \| null/)
  assert.match(types, /totalAmountMinor: number \| null/)
  assert.doesNotMatch(types.match(/export type LocalFileDiagnostic[\s\S]*?\n}/)?.[0] || '', /employeeName|rfc|curp|nss|clabe/i)
  assert.doesNotMatch(modal, /\.people|\.records/)
  assert.match(modal, /Esta vista no muestra nombres, RFC, CURP, NSS, cuentas, CLABE ni referencias de empleados/)
})

test('period inference is deterministic for period 1-24 and derives semimonthly boundaries', () => {
  assert.match(logic, /fwdnom\\s\*0\?\(\\d\{1,2\}\)\[_-\]\(20\\d\{2\}\)/)
  assert.match(logic, /period >= 1 && period <= 24/)
  assert.match(logic, /function isValidIsoDate/)
  assert.match(logic, /Math\.ceil\(periodNumber \/ 2\)/)
  assert.match(logic, /periodNumber % 2 === 0/)
  assert.match(logic, /new Date\(Date\.UTC\(year, month, 0\)\)\.getUTCDate\(\)/)
})

test('defaults and accounting context remain inside the existing contract', () => {
  assert.match(modal, /useState<PayrollSubtype>\('ordinaria'\)/)
  assert.match(modal, /<select value=\{companyId\} disabled>/)
  assert.match(modal, /flux:payroll:\$\{kind\}:\$\{companyId\}/)
  assert.match(modal, /companyAccounts\.length === 1/)
  assert.match(modal, /companyCostCenters\.length === 1/)
})

test('one action preserves N3G ordering, private upload, SHA and server authority', () => {
  const start = modal.indexOf('async function registerAndAdvance()')
  const end = modal.indexOf('async function revalidate()', start)
  assert.ok(start >= 0 && end > start)
  const workflow = modal.slice(start, end)
  const ordered = [
    'validatePendingFiles()',
    'saveCaptureSession({',
    'uploadReservedFile(',
    'materializeCapture(',
    'loadSubmissionSummary(',
    'submitForApproval(',
  ]
  let previous = -1
  for (const token of ordered) {
    const position = workflow.indexOf(token)
    assert.ok(position > previous, `${token} must preserve its contract order`)
    previous = position
  }
  assert.match(modal, /carga privada, SHA-256, validación del servidor y auditoría/)
})

test('concurrency, duplicate and fallback edges stay fail-closed', () => {
  assert.match(modal, /classificationEpoch/)
  assert.match(modal, /Se reemplazó el archivo anterior/)
  assert.match(modal, /elige el tipo manualmente/)
  assert.match(modal, /Máximo cinco archivos/)
  assert.match(modal, /unrecognized\.length === 0/)
  assert.match(modal, /Clasifica o quita los archivos no reconocidos/)
  assert.match(modal, /PAYROLL_SOURCE_ACCOUNT_MISMATCH/)
})

test('unknown browser MIME falls back to the slot contract without weakening byte validation', () => {
  assert.match(logic, /observedMime === 'application\/octet-stream'/)
  assert.match(logic, /config\?\.mimes\?\.\[0\]/)
  assert.match(logic, /isZipSignature\(bytes\)/)
  assert.match(logic, /hasBinaryNull\(bytes\)/)
  assert.match(logic, /looksLikeXml\(bytes\)/)
})
