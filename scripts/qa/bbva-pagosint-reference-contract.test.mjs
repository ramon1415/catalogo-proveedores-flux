import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const root = new URL('../../', import.meta.url)
const requireApp = createRequire(new URL('app/package.json', root))
const ts = requireApp('typescript')
const legacySource = readFileSync(new URL('layouts.js', root), 'utf8')
const reactSource = readFileSync(new URL('app/src/features/layouts/logic.ts', root), 'utf8')

const document = { documentElement: { dataset: {} }, addEventListener() {}, getElementById() { return null }, body: { appendChild() {} } }
const window = { supabase: { createClient() { return {} } }, setTimeout, clearTimeout }
window.window = window
const legacyContext = vm.createContext({ window, document, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'synthetic', TextEncoder, Blob, URL, console, setTimeout, clearTimeout })
vm.runInContext(`${legacySource}\nglobalThis.contract = {buildBbvaInterbankRecord128, buildBbvaInterbankContent, buildBbvaLayoutFiles, parseBbvaInterbankLine, validateBbvaInterbankContent, formatBbvaReference}`, legacyContext)
const react = {}
const compiled = ts.transpileModule(reactSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
vm.runInNewContext(compiled.outputText, { exports: react, TextEncoder, Blob, URL, console })
const implementations = [['legacy', legacyContext.contract], ['React', react]]

// Synthetic fixture. Field offsets come from VBA Hoja5 / uExpPagInter,
// independently recovered from the original bank workbook (see ops document).
const line = (overrides = {}) => ({
  id: 'line-1', layout_id: 'layout-qa', payment_request_id: 'request-1',
  request_number: 'SOL-QA-1', status: 'included', destination_type: 'clabe',
  destination_value: '021180000000000001', source_account_number: '0123456789',
  amount: '8060.84', beneficiary_name: 'BENEFICIARIO DE PRUEBA',
  payment_reference: '42',
  payment_concept: 'SUMINISTRO DE 4 EXTINTORES NUEVOS PARA AREA COMUN',
  ...overrides,
})

for (const [name, api] of implementations) {
  test(`${name}: long concept ends at column 120 and cannot overwrite the seven-digit reference`, () => {
    const input = line()
    const row = api.buildBbvaInterbankRecord128(input)
    assert.equal(row.length, 128)
    assert.equal(row.slice(0, 18), input.destination_value)
    assert.equal(row.slice(18, 36), '000000000123456789')
    assert.equal(row.slice(39, 55), '0000000008060.84')
    assert.equal(row.slice(85, 90), '40021')
    assert.equal(row.slice(90, 120), 'SUMINISTRO DE 4 EXTINTORES NUE')
    assert.equal(row.slice(120, 127), '0000042')
    assert.equal(row.slice(127), 'H')
    const parsed = api.parseBbvaInterbankLine(row)
    assert.equal(parsed.bankField, '40021')
    assert.equal(parsed.numericReference, '0000042')
    assert.equal(parsed.concept.length, 30)
    assert.equal(input.payment_concept, 'SUMINISTRO DE 4 EXTINTORES NUEVOS PARA AREA COMUN')
  })

  test(`${name}: captured references become seven bank digits without silently removing non-digits`, () => {
    for (const [input, expected] of [['7', '0000007'], ['00042', '0000042'], ['03082', '0003082'], ['99999', '0099999'], ['0', '0000000']]) {
      assert.equal(api.formatBbvaReference(input), expected)
      assert.equal(api.buildBbvaInterbankRecord128(line({ payment_reference: input })).slice(120, 127), expected)
    }
    for (const input of [null, undefined, '', 'ABC42', '12 34', '-2', '1.2', '123456']) {
      assert.throws(() => api.buildBbvaInterbankRecord128(line({ payment_reference: input })), /referencia numerica PAGOSINT/)
    }
  })

  test(`${name}: the reported bad second record is rejected with a reference-specific reason`, () => {
    const inputs = [line({ payment_concept: 'PAGINA WEB' }), line()]
    const malformed = inputs.map((input) => api.buildBbvaInterbankRecord128(input).slice(0, 90) + input.payment_concept.slice(0, 37).padEnd(37, ' ') + 'H').join('\r\n') + '\r\n'
    assert.equal(malformed.split('\r\n')[1].slice(120, 127), 'VOS PAR')
    const result = api.validateBbvaInterbankContent(malformed)
    assert.equal(result.ok, false)
    assert.match(result.errors.join('\n'), /referencia numerica de linea 2.*7 digitos.*121-127/)
    assert.match(result.errors.join('\n'), /referencia numerica de linea 1/)
  })

  test(`${name}: interbank output remains 128 ASCII bytes per record with CRLF and no BOM`, () => {
    const content = api.buildBbvaInterbankContent([line({ destination_value: '002180000000000001', payment_concept: 'PAGINA WEB', amount: '1078.99' }), line()])
    const result = api.validateBbvaInterbankContent(content)
    assert.equal(result.ok, true, result.errors.join('\n'))
    assert.equal(result.lineCount, 2)
    assert.deepEqual(Array.from(result.lineLengths), [128, 128])
    assert.equal(new TextEncoder().encode(content).length, 260)
    assert.equal(content.endsWith('\r\n'), true)
    assert.equal(content.endsWith('\r\n\r\n'), false)
    assert.notEqual(content.charCodeAt(0), 0xfeff)
    assert.equal(content.split('\r\n')[0].slice(90, 120), 'PAGINA WEB'.padEnd(30, ' '))
  })

  test(`${name}: BBVA accounts, BBVA CLABEs and external CLABEs keep separate files and exclude settled lines`, () => {
    const inputs = [
      line({ id: 'bbva-account', destination_type: 'cuenta', destination_value: '0123456789' }),
      line({ id: 'bbva-clabe', destination_value: '012180000000000001' }),
      line({ id: 'external-002', destination_value: '002180000000000001' }),
      line({ id: 'external-021' }),
      ...['paid', 'cancelled', 'bank_rejected'].map((status) => line({ id: status, status, payment_concept: 'NO VOLVER A PAGAR', payment_reference: null })),
    ]
    const files = api.buildBbvaLayoutFiles(inputs, { layout_number: 'LAY-QA' })
    assert.deepEqual(Array.from(files, (file) => [file.format, file.validation.lineCount]), [['same_bank', 1], ['mixed', 1], ['interbank', 2]])
    for (const file of files) {
      assert.equal(file.validation.ok, true, file.validation.errors.join('\n'))
      assert.equal(file.content.includes('NO VOLVER A PAGAR'), false)
    }
    assert.equal(files[0].validation.lines[0].length, 85)
    assert.equal(files[1].content.startsWith('PTC012'), true)
    assert.equal(files[1].validation.lines[0].length, 88)
    assert.equal(files[2].validation.lines[0].slice(85, 90), '40002')
    assert.equal(files[2].validation.lines[1].slice(85, 90), '40021')
  })
}

test('React and legacy produce identical complete bank files', () => {
  const inputs = [line(), line({ destination_value: '002180000000000001', payment_reference: '12345', payment_concept: 'PAGINA WEB' })]
  assert.equal(react.buildBbvaInterbankContent(inputs), legacyContext.contract.buildBbvaInterbankContent(inputs))
})
