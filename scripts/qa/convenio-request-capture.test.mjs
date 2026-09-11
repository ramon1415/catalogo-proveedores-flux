import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const root = path.resolve('app/src')
const requireApp = createRequire(path.resolve('app/package.json'))
const ts = requireApp('typescript')
const React = requireApp('react')
const renderer = requireApp('react-test-renderer')
const jsx = requireApp('react/jsx-runtime')
const mocks = new Map()
const cache = new Map()
function load(relative) {
  let file = path.resolve(root, relative)
  if (!existsSync(file)) file += existsSync(file + '.ts') ? '.ts' : '.tsx'
  if (mocks.has(file)) return mocks.get(file)
  if (cache.has(file)) return cache.get(file)
  const exports = {}; cache.set(file, exports)
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  vm.runInNewContext(code, {
    exports, require: name => {
      if (name === 'react') return React
      if (name === 'react/jsx-runtime') return jsx
      if (name.endsWith('.css')) return { default: {} }
      return load(path.resolve(path.dirname(file), name))
    }, window: { setTimeout, clearTimeout }, localStorage: { setItem() {} },
    console, TextEncoder, Blob, URL, setTimeout, clearTimeout, AbortController,
  }, { filename: file })
  return exports
}
const bank = load('features/layouts/logic')
const convenio = load('features/solicitudes/convenio')
const logic = load('features/solicitudes/logic')
const provider = { id: 'qa-cfe', alias: 'CFE QA', nombre_completo: 'Servicio QA', rfc: 'AAA010101AAA', banco: 'BBVA', activo: true, destination_type: 'convenio', convenio_number: '0578869', metodo_pago: 'Transferencia bancaria' }
const reference = '00123456789012345678'
const concept = '0000001234'

test('Convenio is a persisted request type and has a distinct label', () => {
  assert.equal(logic.normalizeRequestType('convenio'), 'convenio')
  assert.equal(logic.requestTypeLabel('convenio'), 'Convenio')
  assert.ok(logic.REQUEST_TYPE_OPTIONS.some(([key, label]) => key === 'convenio' && label === 'Convenio'))
  for (const type of ['provider_payment', 'online_purchase', 'reimbursement', 'nomina']) assert.equal(logic.normalizeRequestType(type), type)
})
test('validate the issuer reference and concept separately without truncation or invented zeros', () => {
  assert.equal(convenio.convenioDataError(provider, reference, concept), null)
  assert.match(convenio.convenioDataError(provider, '10092', concept), /CFE.*20/)
  assert.match(convenio.convenioDataError(provider, reference + concept, concept), /excede 20/)
  assert.match(convenio.convenioDataError(provider, reference, ''), /concepto/)
  assert.match(convenio.convenioDataError(provider, reference, 'X'.repeat(31)), /30/)
  for (const bad of ['a|b', 'LÍNEA', 'a\nb']) assert.ok(convenio.convenioDataError(provider, reference, bad))
  assert.match(convenio.convenioDataError({ ...provider, destination_type: 'cuenta' }, reference, concept), /proveedor con convenio/)
  assert.equal(convenio.convenioDataError({ ...provider, convenio_number: '1234567' }, 'ref-01', concept), null)
})

const rpcCalls = []
mocks.set(path.resolve(root, 'lib/supabase.ts'), { supabase: { rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: { payment_request_id: 'qa-new' }, error: null } } } })
const api = load('features/solicitudes/api')
test('API routes Convenio with and without a document atomically; other creators remain unchanged', async () => {
  const payload = { request_type: 'convenio', payment_method: 'transfer', payment_reference: reference, payment_concept: concept, convenio_number: provider.convenio_number }
  await api.createPaymentRequest(payload)
  await api.createPaymentRequestWithDocument(payload, 'solicitudes/drafts/qa/recibo.pdf')
  assert.equal(rpcCalls[0].name, 'create_convenio_payment_request')
  assert.equal(rpcCalls[1].name, 'create_convenio_payment_request')
  assert.equal(rpcCalls[0].args.p_request, payload)
  assert.equal(rpcCalls[0].args.p_invoice_storage_path, null)
  assert.equal(rpcCalls[1].args.p_invoice_storage_path, 'solicitudes/drafts/qa/recibo.pdf')
  await api.createPaymentRequest({ request_type: 'provider_payment' })
  await api.createPaymentRequestWithDocument({ request_type: 'provider_payment' }, 'qa.pdf')
  assert.equal(rpcCalls[2].name, 'create_payment_request')
  assert.equal(rpcCalls[3].name, 'create_payment_request_with_document')
})

let activeCompany = 'qa-operadora'
const companies = [{ id: 'qa-operadora', name: 'Operadora' }, { id: 'qa-fersana', name: 'Fersana' }]
const createCalls = [], toasts = []
const row = { budget_category_id: 'qa-category', available_amount: 999999, budgeted_amount: 999999, no_presupuestal: true }
const formApi = {
  ...api, loadBudgetAvailability: async () => [row],
  listApproverOptions: async () => [{ profile_id: 'qa-approver', full_name: 'Aprobador QA', assignment_id: null, source: 'approval_rules' }],
  fetchPartidaPrediction: async () => null,
  loadIncidencias: async () => ({ incidents: [], membersById: new Map() }),
  createPaymentRequest: async payload => { createCalls.push({ payload, path: null }); return { payment_request_id: 'qa-new', request_number: 'QA' } },
  createPaymentRequestWithDocument: async (payload, path) => { createCalls.push({ payload, path }); return { payment_request_id: 'qa-new', request_number: 'QA' } },
  updateFase2Metadata: async () => { throw new Error('Convenio must not need a post-creation metadata write') },
  uploadReceipt: async () => 'solicitudes/drafts/qa-profile/recibo.pdf',
}
const stub = (file, exports) => mocks.set(path.resolve(root, file), exports)
stub('features/solicitudes/api.ts', formApi)
stub('lib/auth.tsx', { useAuth: () => ({ memberships: companies.map(c => ({ company_id: c.id })), group: 'operator' }) })
stub('lib/company.tsx', { useCompany: () => ({ companyId: activeCompany }) })
stub('lib/moduleAccess.tsx', { useModules: () => ({ isEnabled: () => false }) })
stub('components/ui/Toast.tsx', { useToast: () => ({ showToast: (...args) => toasts.push(args) }) })
stub('components/ui/CompanyCaptureContext.tsx', { CompanyCaptureContext: () => null })
stub('features/solicitudes/QuickProviderModal.tsx', { QuickProviderModal: () => null })
stub('features/solicitudes/ProviderCombo.tsx', { ProviderCombo: ({ proveedores, value, onSelect }) => React.createElement('select', {
  value, 'data-provider': true, onChange: e => onSelect(e.target.value, proveedores.find(p => p.id === e.target.value)?.alias || ''),
}, [React.createElement('option', { key: '', value: '' }, 'Seleccionar'), ...proveedores.map(p => React.createElement('option', { key: p.id, value: p.id }, p.alias))]) })
stub('features/solicitudes/ReimbursementSection.tsx', { ReimbursementSection: () => null, emptyReimbursementItem: () => ({ id: 'qa-item' }) })
stub('features/solicitudes/cfdi.ts', { parseCfdiFile: async () => null })
const { RequestModal } = load('features/solicitudes/RequestModal')
function field(tree, label, type = 'input') {
  const parent = tree.root.findAllByType('label').find(node => typeof node.props.children?.[0] === 'string' && node.props.children[0].trim() === label)
  assert.ok(parent, `missing label ${label}`)
  return parent.findByType(type)
}
const change = async (node, value) => renderer.act(async () => { node.props.onChange({ target: { value } }) })
for (const company of companies) {
  test(`${company.name}: capture Convenio from request type, save fields, and preserve CIE layout bytes`, async () => {
    activeCompany = company.id
    let tree
    await renderer.act(async () => { tree = renderer.create(React.createElement(RequestModal, {
      companies, costCenters: [{ id: 'qa-center', name: 'Centro QA' }], budgetCategories: [{ id: 'qa-category', name: 'Servicio QA', no_presupuestal: true }],
      proveedores: [provider, { ...provider, id: 'qa-normal', destination_type: 'cuenta', convenio_number: null }],
      profile: { id: 'qa-profile' }, canApprove: false, showNomina: false, onProviderCreated() {}, onClose() {}, onCreated() {},
    })) })
    await change(field(tree, 'Tipo de solicitud *', 'select'), 'convenio')
    assert.equal(field(tree, 'Metodo de pago *', 'select').props.disabled, true)
    assert.equal(field(tree, 'Moneda *', 'select').props.value, 'MXN')
    assert.equal(tree.root.findByProps({ 'data-provider': true }).findAllByType('option').length, 2)
    await change(field(tree, 'Proveedor *', 'select'), provider.id)
    assert.equal(field(tree, 'Número de convenio').props.value, provider.convenio_number)
    await change(field(tree, 'Referencia / línea de captura *'), reference)
    await change(field(tree, 'Concepto del pago CIE *'), concept)
    await change(field(tree, 'Centro de costo *', 'select'), 'qa-center')
    await change(field(tree, 'Partida presupuestal *', 'select'), 'qa-category')
    await change(field(tree, 'Monto solicitado *'), '70')
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 450)) })
    const approverSelect = tree.root.findAllByType('select').find(n => n.findAllByType('option').some(o => o.props.value === 'qa-approver'))
    assert.ok(approverSelect, 'approver loaded')
    await change(approverSelect, 'qa-approver')
    const description = tree.root.findAllByType('textarea').find(n => n.props.required)
    await change(description, 'Servicio QA')
    if (company.name === 'Fersana') {
      const input = tree.root.findAllByType('input').find(n => n.props.type === 'file')
      await renderer.act(async () => input.props.onChange({ target: { files: [{ name: 'recibo.pdf', type: 'application/pdf', size: 100 }] } }))
      // Unreadable replacement clears previous bank instructions. Manual entry
      // remains possible with the selected receipt attached.
      assert.equal(field(tree, 'Referencia / línea de captura *').props.value, '')
      await change(field(tree, 'Referencia / línea de captura *'), reference)
      await change(field(tree, 'Concepto del pago CIE *'), concept)
      await change(field(tree, 'Monto solicitado *'), '70')
      await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 450)) })
    }
    const before = createCalls.length
    await renderer.act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }))
    assert.equal(createCalls.length, before + 1, JSON.stringify(toasts))
    const saved = createCalls.at(-1)
    assert.equal(saved.payload.company_id, company.id)
    assert.equal(saved.payload.request_type, 'convenio')
    assert.equal(saved.payload.payment_reference, reference)
    assert.equal(saved.payload.payment_concept, concept)
    assert.equal(saved.payload.convenio_number, provider.convenio_number)
    assert.equal(!!saved.path, company.name === 'Fersana')
    const line = bank.serializeBbvaCieLine({ ...saved.payload, source_account_number: '0012345678', amount: 70, destination_type: 'convenio' })
    assert.equal(line.slice(0, 30), concept.padEnd(30, ' '))
    assert.equal(line.slice(101, 121), reference)
    await renderer.act(async () => tree.unmount())
  })
}

test('changing company or request type clears the previous receipt instructions', async () => {
  activeCompany = companies[0].id
  let tree
  await renderer.act(async () => { tree = renderer.create(React.createElement(RequestModal, {
    companies, costCenters: [], budgetCategories: [], proveedores: [provider], profile: { id: 'qa-profile' },
    canApprove: false, showNomina: false, onProviderCreated() {}, onClose() {}, onCreated() {},
  })) })
  await change(field(tree, 'Tipo de solicitud *', 'select'), 'convenio')
  await change(field(tree, 'Proveedor *', 'select'), provider.id)
  await change(field(tree, 'Referencia / línea de captura *'), reference)
  await change(field(tree, 'Concepto del pago CIE *'), concept)
  await change(field(tree, 'Empresa *', 'select'), companies[1].id)
  assert.equal(field(tree, 'Referencia / línea de captura *').props.value, '')
  assert.equal(field(tree, 'Concepto del pago CIE *').props.value, '')
  await change(field(tree, 'Tipo de solicitud *', 'select'), 'provider_payment')
  assert.equal(field(tree, 'Proveedor *', 'select').props.value, '')
  assert.equal(tree.root.findAllByType('h3').filter(n => n.props.children === 'Datos del convenio BBVA CIE').length, 0)
  await renderer.act(async () => tree.unmount())
})

test('editing a Convenio reloads and saves its reference and concept separately', async () => {
  const changes=[]
  formApi.updatePaymentRequest=async (id,payload) => { changes.push({id,payload}) }
  const {EditModal}=load('features/solicitudes/EditModal')
  let tree
  await renderer.act(async () => { tree=renderer.create(React.createElement(EditModal, {
    request: {id:'qa-existing',request_type:'convenio',company_id:companies[0].id,proveedor_id:provider.id,
      cost_center_id:'qa-center',budget_category_id:'qa-category',budget_month:'2026-09-01',amount_requested:70,currency:'MXN',
      description:'Servicio QA',payment_reference:reference,payment_concept:concept},
    companies,costCenters:[{id:'qa-center',name:'QA'}],budgetCategories:[{id:'qa-category',name:'QA'}],proveedores:[provider],onClose() {},onSaved() {},
  })) })
  assert.equal(field(tree,'Referencia / línea de captura *').props.value,reference)
  assert.equal(field(tree,'Concepto del pago CIE *').props.value,concept)
  await change(field(tree,'Concepto del pago CIE *'),'0000001235')
  await renderer.act(async () => tree.root.findByType('form').props.onSubmit({preventDefault() {}}))
  assert.equal(changes.length,1)
  assert.equal(changes[0].payload.payment_reference,reference)
  assert.equal(changes[0].payload.payment_concept,'0000001235')
  await renderer.act(async () => tree.unmount())
})
