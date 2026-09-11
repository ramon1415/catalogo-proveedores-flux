import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const root = new URL('../../', import.meta.url)
const ts = createRequire(new URL('app/package.json', root))('typescript')
const react = {}
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('app/src/features/layouts/logic.ts', root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: react, TextEncoder, Blob, URL, console })
const window = { supabase: { createClient() { return {} } }, setTimeout, clearTimeout }; window.window = window
const context = vm.createContext({ window, document: { documentElement: { dataset: {} }, addEventListener() {}, getElementById() { return null }, body: { appendChild() {} } }, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'synthetic', TextEncoder, Blob, URL, console, setTimeout, clearTimeout })
vm.runInContext(readFileSync(new URL('layouts.js', root), 'utf8') + '\nglobalThis.api = {serializeBbvaCieLine,buildBbvaLayoutFiles,validateBbvaCieContent,cieReferenceError,applyCieReferencePreflight,ciePreviewProviderIds,withCiePreviewConvenios}', context)
const implementations = [['React', react], ['legacy', context.api]]
const capture = '00123456789012345678' // Synthetic issuer reference; never sent to a bank.
const fixture = (company, overrides = {}) => ({ id: 'qa-line', layout_id: 'qa-layout', payment_request_id: 'qa-request', company_id: `qa-${company}`, company_name: company, destination_type: 'convenio', convenio_number: '0578869', source_account_number: '0012345678', amount: 70, payment_concept: 'PRUEBA CFE', payment_reference: capture, status: 'included', ...overrides })

for (const [name, api] of implementations) {
  for (const company of ['Operadora', 'Fersana']) {
    test(`${name}/${company}: reject the reported five-character CFE reference before download`, () => {
      assert.throws(() => api.buildBbvaLayoutFiles([fixture(company, { payment_reference: '10092' })], { layout_number: 'QA' }), /CFE.*20 caracteres/)
      const valid = api.serializeBbvaCieLine(fixture(company))
      const paddedBad = valid.slice(0, 101) + '10092'.padEnd(20, ' ') + '\r\n'
      const result = api.validateBbvaCieContent(paddedBad)
      assert.equal(result.ok, false)
      assert.match(result.errors.join('\n'), /linea 1.*CFE.*20 caracteres/)
    })
    test(`${name}/${company}: preserve all 20 reference characters and the existing bank contract`, () => {
      const row = api.serializeBbvaCieLine(fixture(company))
      assert.equal(row.length, 121)
      assert.equal(row.slice(30, 37), '0578869')
      assert.equal(row.slice(37, 55), '000000000012345678')
      assert.equal(row.slice(55, 71), '0000000000070.00')
      assert.equal(row.slice(101, 121), capture)
      const file = api.buildBbvaLayoutFiles([fixture(company), fixture(company, { id: 'paid', status: 'paid', payment_reference: '10092' })], { layout_number: 'QA' })[0]
      assert.equal(file.validation.ok, true)
      assert.equal(file.validation.lineCount, 1)
      assert.equal(new TextEncoder().encode(file.content).length, 123)
      assert.equal(file.content.endsWith('\r\n'), true)
    })
  }
  test(`${name}: CFE convention rule does not impose 20 non-padding characters on other agreements`, () => {
    for (const convenio of ['0578869', '578869']) assert.match(api.cieReferenceError('10092', convenio), /CFE.*20/)
    assert.equal(api.cieReferenceError('12345678', '1234567'), null)
    const row = api.serializeBbvaCieLine(fixture('QA', { convenio_number: '1234567', payment_reference: 'ref-123' }))
    assert.equal(row.slice(101), 'ref-123'.padEnd(20, ' '))
  })
  test(`${name}: never silently shorten or rewrite the issuer reference`, () => {
    for (const reference of [capture + '9', 'á'.repeat(20), 'A|'.repeat(10), '12345 67890123456789 ']) {
      assert.throws(() => api.serializeBbvaCieLine(fixture('QA', { payment_reference: reference })))
    }
    const longConcept = api.serializeBbvaCieLine(fixture('QA', { payment_concept: 'X'.repeat(90) }))
    assert.equal(longConcept.slice(0, 30), 'X'.repeat(30))
    assert.equal(longConcept.slice(101), capture)
  })
  test(`${name}: preview exposes correction instead of classifying an incomplete CFE payment as ready`, () => {
    // Production RPC omits destination_value. Use its real shape and hydrate the canonical agreement.
    const bad = { payment_request_id: 'qa-bad', proveedor_id: 'qa-provider', destination_type: 'convenio', payment_reference: '10092', amount: 70 }
    const good = { ...bad, payment_request_id: 'qa-good', payment_reference: capture }
    const preview = { ready_regular: [bad, good], ready_extraordinary: [], invalid_data: [] }
    assert.deepEqual(Array.from(api.ciePreviewProviderIds(preview)), ['qa-provider'])
    const hydrated = api.withCiePreviewConvenios(preview, [{ id: 'qa-provider', convenio_number: '0578869' }])
    const next = api.applyCieReferencePreflight(hydrated)
    assert.deepEqual(Array.from(next.ready_regular, r => r.payment_request_id), ['qa-good'])
    assert.equal(next.invalid_data[0].payment_request_id, 'qa-bad')
    assert.equal(next.invalid_data[0].missing_fields.includes('payment_reference_invalid'), true)
    assert.equal(preview.ready_regular.length, 2)
    assert.equal(preview.invalid_data.length, 0)
    assert.equal(preview.ready_regular[0].convenio_number, undefined)
    const unavailable = api.applyCieReferencePreflight(api.withCiePreviewConvenios(preview, []))
    assert.equal(unavailable.ready_regular.length, 0)
    assert.equal(unavailable.invalid_data[0].missing_fields.includes('convenio_number'), true)
  })
}

test('both implementations generate identical CIE bytes', () => {
  assert.equal(react.serializeBbvaCieLine(fixture('QA')), context.api.serializeBbvaCieLine(fixture('QA')))
})

test('CIE correction form blocks incomplete input and requires bank-rejection confirmation for uploaded layouts', async () => {
  const source = readFileSync(new URL('app/src/features/layouts/CieReferenceModal.tsx', root), 'utf8')
  const calls = []
  const errors = []
  const jsx = (type, props) => ({ type, props })
  const component = {}
  const modules = {
    react: { useState: initial => [initial, value => errors.push(value)] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '../../components/ui/Modal': { Modal: 'Modal' },
    '../../components/ui/CompanyCaptureContext': { CompanyCaptureContext: 'Company' },
    '../../components/ui/Toast': { useToast: () => ({ showToast() {} }) },
    './logic': react,
    './api': { updateCieInstructions: async params => { calls.push(params) } },
    '../solicitudes/ConvenioReceiptUpload': { ConvenioReceiptUpload: 'ReceiptUpload' },
    '../solicitudes/convenio': { convenioConceptError: value => value ? null : 'Concepto requerido' },
    './Layouts.module.css': { default: {} },
  }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports: component, require: name => { assert.ok(name in modules, name); return modules[name] } })
  for (const [reference, uploaded] of [['10092', false], [capture, true]]) {
    const form = component.CieReferenceModal({ line: fixture('QA', { payment_reference: reference }), bankUploadRecorded: uploaded, onClose() {}, reload: async () => [] })
    await form.props.onSubmit({ preventDefault() {} })
  }
  assert.equal(calls.length, 0)
  assert.ok(errors.some(value => typeof value === 'string' && /20 caracteres/.test(value)))
  assert.ok(errors.some(value => typeof value === 'string' && /banco rechazó/.test(value)))

  let hookIndex = 0
  let closed = false
  modules.react.useState = initial => [hookIndex++ === 0 ? capture : initial, () => {}]
  const successful = component.CieReferenceModal({
    line: fixture('QA', { payment_reference: '10092' }), bankUploadRecorded: false,
    onClose() { closed = true }, reload: async () => [fixture('QA')],
  })
  await successful.props.onSubmit({ preventDefault() {} })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].p_line_id, 'qa-line')
  assert.equal(calls[0].p_payment_reference, capture)
  assert.equal(calls[0].p_expected_reference, '10092')
  assert.equal(calls[0].p_payment_concept, 'PRUEBA CFE')
  assert.equal(calls[0].p_expected_concept, 'PRUEBA CFE')
  assert.equal(closed, true)
})
