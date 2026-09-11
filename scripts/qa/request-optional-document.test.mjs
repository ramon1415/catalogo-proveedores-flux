import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'

const require = createRequire(resolve('app/package.json'))
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')
const feature = 'app/src/features/solicitudes/'
function load(path, imports = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  })
  const module = { exports: {} }
  const dependency = (name) => {
    if (Object.hasOwn(imports, name)) return imports[name]
    if (name.startsWith('react')) return require(name)
    if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => String(key) })
    throw new Error(`Unexpected import ${name}`)
  }
  new Function('require', 'module', 'exports', 'window', outputText)(dependency, module, module.exports, globals.window)
  return module.exports
}
const format = load('app/src/lib/format.ts')
const logic = load(feature + 'logic.ts', { '../../lib/format': format })
const bank = load('app/src/features/layouts/logic.ts')
const convenio = load(feature + 'convenio.ts', { '../layouts/logic': bank })
const companies = [{ id: 'operadora', name: 'Operadora Tlacatecpan' }, { id: 'fersana', name: 'Soporte Fersana' }]
const profile = { id: 'requester', email: 'qa@example.com' }
const provider = { id: 'provider', razon_social: 'Proveedor QA' }
const category = { id: 'category', name: 'Servicios' }
const center = { id: 'center', name: 'Centro QA' }
const availability = { budget_category_id: category.id, available: 10000, budgeted: 10000, no_presupuestal: false }
const text = (node) => typeof node === 'string' ? node : (node.children || []).map(text).join('')
const labelControl = (view, label, type) => view.root.findAllByType('label').find(n => text(n).startsWith(label)).findByType(type)

async function mount(companyId, options = {}) {
  const calls = [], toasts = [], timers = new Map()
  let timerId = 0
  const result = { payment_request_id: 'created', request_number: 'QA-ONLY' }
  const api = {
    loadBudgetAvailability: async () => [availability],
    listApproverOptions: async () => [{ profile_id: 'approver', source: 'approval_rules', full_name: 'Aprobador QA' }],
    fetchPartidaPrediction: async () => null,
    createPaymentRequest: async payload => { calls.push(['create', payload]); return result },
    createPaymentRequestWithDocument: async (payload, path) => {
      calls.push(['createWithDocument', payload, path])
      if (options.rejectDocument) throw new Error('request_document_not_found_or_not_owned')
      return result
    },
    createReimbursementRequestWithDocuments: async () => { throw new Error('Unexpected reimbursement') },
    updateFase2Metadata: async () => '',
    uploadReceipt: async (file, folder) => {
      calls.push(['upload', file.name, folder])
      if (options.rejectUpload) throw new Error('Upload failed')
      return `${folder}/${file.name}`
    },
    removeReceipt: async path => { calls.push(['remove', path]) },
    updatePaymentRequest: async (id, payload) => { calls.push(['update', id, payload]) },
  }
  function ProviderCombo(props) {
    return React.createElement('input', { 'data-provider': true, onChange: () => props.onSelect(provider.id, provider.razon_social) })
  }
  const imports = {
    './api': api, './logic': logic, '../../lib/format': format,
    './convenio': convenio, './ConvenioFields': { ConvenioFields: () => null },
    '../../components/ui/CompanyCaptureContext': { CompanyCaptureContext: ({ name }) => React.createElement('span', { 'data-company-context': true }, name) },
    '../../components/ui/Toast': { useToast: () => ({ showToast: (...args) => toasts.push(args) }) },
    './ProviderCombo': { ProviderCombo }, './QuickProviderModal': { QuickProviderModal: () => null },
    './ReimbursementSection': { ReimbursementSection: () => null, emptyReimbursementItem: () => ({ amount: '', descripcion: '', budgetCategoryId: '', deducible: false }) },
    './cfdi': { parseCfdiFile: async () => null },
    '../../lib/auth': { useAuth: () => ({ memberships: companies.map(c => ({ company_id: c.id })), group: 'operator' }) },
    '../../lib/company': { useCompany: () => ({ companyId }) },
    '../../lib/moduleAccess': { useModules: () => ({ isEnabled: () => false }) },
  }
  const component = options.edit ? 'EditModal' : 'RequestModal'
  const Component = load(feature + component + '.tsx', imports, { window: {
    setTimeout: fn => { timers.set(++timerId, fn); return timerId },
    clearTimeout: id => timers.delete(id),
  } })[component]
  const props = {
    companies, costCenters: [center], budgetCategories: [category], proveedores: [provider], profile,
    canApprove: false, showNomina: false, onProviderCreated() {}, onClose() {}, onCreated() {}, onSaved() {},
    request: { id: 'existing', company_id: companyId, cost_center_id: center.id, budget_category_id: category.id,
      budget_month: '2026-09-01', proveedor_id: provider.id, amount_requested: 100, currency: 'MXN', description: 'Solicitud QA',
      invoice_storage_path: options.existingPath || null },
  }
  let view
  await act(async () => { view = create(React.createElement(Component, props)) })
  if (!options.edit) {
    await act(async () => { view.root.findByProps({ 'data-provider': true }).props.onChange() })
    await act(async () => { labelControl(view, 'Centro de costo', 'select').props.onChange({ target: { value: center.id } }) })
    await act(async () => { labelControl(view, 'Monto', 'input').props.onChange({ target: { value: '100' } }) })
    await act(async () => { for (const [id, fn] of timers) { timers.delete(id); await fn() } })
    await act(async () => { labelControl(view, 'Partida presupuestal', 'select').props.onChange({ target: { value: category.id } }) })
    await act(async () => { labelControl(view, 'Descripcion', 'textarea').props.onChange({ target: { value: 'Solicitud QA' } }) })
  }
  return { view, calls, toasts, async submit() { await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }) }) },
    async attach() { await act(async () => { await view.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [new File(['PDF QA'], 'test.pdf', { type: 'application/pdf' })] } }) }) },
    close() { act(() => view.unmount()) },
  }
}

for (const company of companies) {
  test(`${company.name}: crear sin adjunto conserva empresa y envía una sola solicitud`, async () => {
    const h = await mount(company.id)
    assert.equal(text(h.view.root.findByProps({ 'data-company-context': true })), company.name)
    assert.ok(!h.view.root.findByProps({ type: 'file' }).props.required)
    await h.submit()
    assert.deepEqual(h.calls.map(c => c[0]), ['create'])
    assert.equal(h.calls[0][1].company_id, company.id)
    assert.equal(h.calls[0][1].amount_requested, 100)
    assert.ok(h.toasts.some(t => t[0] === 'Solicitud creada'))
    h.close()
  })
  test(`${company.name}: editar sin adjunto no borra ni exige documentos`, async () => {
    const h = await mount(company.id, { edit: true })
    await h.submit()
    assert.deepEqual(h.calls.map(c => c[0]), ['update'])
    assert.equal(h.calls[0][2].company_id, company.id)
    assert.ok(!Object.hasOwn(h.calls[0][2], 'invoice_storage_path'))
    h.close()
  })
}
test('adjuntar conserva la carga previa y creación atómica con documento', async () => {
  const h = await mount('fersana')
  await h.attach(); await h.submit()
  assert.deepEqual(h.calls.map(c => c[0]), ['upload', 'createWithDocument'])
  assert.equal(h.calls[1][2], 'solicitudes/drafts/requester/test.pdf')
  h.close()
})
for (const failure of ['rejectUpload', 'rejectDocument']) {
  test(`${failure}: nunca crea silenciosamente una solicitud sin el archivo elegido`, async () => {
    const h = await mount('operadora', { [failure]: true })
    await h.attach(); await h.submit()
    assert.ok(!h.calls.some(c => c[0] === 'create'))
    assert.ok(h.toasts.some(t => t[0] === 'No se pudo crear la solicitud'))
    if (failure === 'rejectDocument') assert.equal(h.calls.at(-1)[0], 'remove')
    h.close()
  })
}
test('editar un documento existente sin reemplazarlo conserva su vínculo', async () => {
  const h = await mount('fersana', { edit: true, existingPath: 'solicitudes/existing/original.pdf' })
  await h.submit()
  assert.ok(!Object.hasOwn(h.calls[0][2], 'invoice_storage_path'))
  h.close()
})
