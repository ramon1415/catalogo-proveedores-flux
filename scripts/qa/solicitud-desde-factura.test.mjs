import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(new URL('../..', import.meta.url).pathname)
const require = createRequire(resolve(root, 'app/package.json'))
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')
const feature = 'app/src/features/solicitudes/'

// Se ejecutan el componente y sus handlers reales con React 18. Únicamente
// los adaptadores de red, lectura XML y componentes secundarios se aíslan.
function load(file, imports = {}, domParser) {
  const source = readFileSync(resolve(root, file), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: file,
  })
  const module = { exports: {} }
  const dependency = (name) => {
    if (Object.hasOwn(imports, name)) return imports[name]
    if (name.startsWith('react')) return require(name)
    throw new Error(`Dependencia no aislada: ${name}`)
  }
  new Function('require', 'module', 'exports', 'window', 'DOMParser', outputText)(
    dependency, module, module.exports, { setTimeout: () => 1, clearTimeout: () => {} }, domParser,
  )
  return module.exports
}

const format = load('app/src/lib/format.ts')
const logic = load(feature + 'logic.ts', { '../../lib/format': format })
const cfdiModule = load(feature + 'cfdi.ts')
const companies = [
  { id: 'a', name: 'Empresa A', rfc: 'AAA010101AAA' },
  { id: 'b', name: 'Empresa B', rfc: 'BBB010101BBB' },
]
const providers = [{ id: 'provider-a', alias: 'Proveedor A', rfc: 'CCC010101CCC' }]
const invoice = (overrides = {}) => ({
  uuid: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', rfcReceptor: companies[0].rfc,
  rfcEmisor: providers[0].rfc, nombreEmisor: 'Proveedor A', subtotal: 100, total: 116,
  traslados: 16, retenciones: 0, conceptos: 'Servicio', moneda: 'MXN', tipoCambio: null,
  fecha: '2026-09-07', serie: 'A', folio: '1', ...overrides,
})
const file = (cfdi, xml = 'xml-a') => ({ name: 'factura.xml', type: 'application/xml', size: 100, text: async () => xml, cfdi })
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const text = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : ''

async function mount(t, { activeCompany = 'a', allowed = ['a', 'b'], manage = true, duplicate, allowCreation = false, creation } = {}) {
  const calls = { creates: [], snapshots: [], toasts: [], lookups: [], uploads: [] }
  const api = {
    loadActiveProjects: async () => [], fetchPartidaPrediction: async () => null,
    findRequestByInvoiceUuid: async (company, uuid) => { calls.lookups.push([company, uuid]); return duplicate ? duplicate(company, uuid) : null },
    createPaymentRequest: async (payload) => { calls.creates.push(payload); return creation || { id: 'created', request_number: 'QA-1' } },
    updateFase2Metadata: async () => '', uploadReceipt: async (file) => { calls.uploads.push(file); return 'qa/receipt.xml' }, linkInvoicePath: async () => {},
    saveCfdiData: async (id, snapshot) => { calls.snapshots.push(snapshot); return '' },
  }
  const ProviderCombo = () => null
  const QuickProviderModal = () => null
  const { RequestModal } = load(feature + 'RequestModal.tsx', {
    './api': api, './logic': allowCreation ? { ...logic, validateRequestPayload: () => '' } : logic,
    '../../lib/format': format,
    './cfdi': { ...cfdiModule, parseCfdiFile: async (f) => f.cfdi },
    '../../lib/contpaq/cfdiBrowser': { parseCfdiXml: (xml) => ({ source: xml }) },
    '../../lib/auth': { useAuth: () => ({ memberships: allowed.map((company_id) => ({ company_id })), group: manage ? 'sysadmin' : 'operation', canManageProviders: () => manage }) },
    '../../lib/company': { useCompany: () => ({ companyId: activeCompany }) },
    '../../lib/moduleAccess': { useModules: () => ({ isEnabled: () => false }) },
    '../../components/ui/CompanyCaptureContext': { CompanyCaptureContext: ({ name }) => React.createElement('span', { 'data-company-context': true }, name) },
    '../../components/ui/Toast': { useToast: () => ({ showToast: (...args) => calls.toasts.push(args) }) },
    './ProviderCombo': { ProviderCombo }, './QuickProviderModal': { QuickProviderModal },
    './ReimbursementSection': { ReimbursementSection: () => null, emptyReimbursementItem: () => ({ amount: '', descripcion: '', deducible: false }) },
    './Solicitudes.module.css': {},
  })
  let renderer
  // La identidad estable reproduce los contextos de la aplicación.
  const props = { companies, proveedores: providers, costCenters: [], budgetCategories: [], profile: { id: 'tester' }, canApprove: false, showNomina: false, onProviderCreated() {}, onClose() {}, onCreated() {} }
  await act(async () => { renderer = create(React.createElement(RequestModal, props)) })
  t.after(() => act(() => renderer.unmount()))
  const field = (label) => renderer.root.findAllByType('label').find((n) => text(n.props.children).startsWith(label)).find((n) => ['input', 'select', 'textarea'].includes(n.type))
  return {
    calls, renderer, field, ProviderCombo,
    change: async (label, value) => act(async () => { field(label).props.onChange({ target: { value } }) }),
    upload: async (f) => act(async () => { field('Factura / comprobante').props.onChange({ target: { files: f ? [f] : [] } }) }),
    submit: async () => act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) }),
    button: () => renderer.root.findAllByType('button').find((n) => n.props.type === 'submit'),
    alerts: () => renderer.root.findAllByProps({ role: 'alert' }).map((n) => text(n.props.children)).join(' '),
  }
}

for (const activeCompany of ['a', 'b']) {
  test(`permite crear sin adjunto en empresa ${activeCompany}`, async (t) => {
    const h = await mount(t, { activeCompany, allowCreation: true })
    assert.notEqual(h.field('Factura / comprobante').props.required, true)
    await h.submit()
    assert.equal(h.calls.creates.length, 1)
    assert.equal(h.calls.creates[0].company_id, activeCompany)
    assert.equal(h.calls.uploads.length, 0)
    assert.equal(h.calls.snapshots.length, 0)
    assert.equal(h.calls.toasts.at(-1)[0], 'Solicitud creada')
  })
}

test('RFC normalizado: empresa única, desconocida, sin acceso y ambigua', () => {
  assert.equal(cfdiModule.resolveCfdiCompany(' aaa010101aaa ', companies, ['a']).company.id, 'a')
  assert.match(cfdiModule.resolveCfdiCompany('XXX010101XXX', companies, ['a']).error, /no corresponde/)
  assert.match(cfdiModule.resolveCfdiCompany(companies[1].rfc, companies, ['a']).error, /No tienes acceso/)
  assert.match(cfdiModule.resolveCfdiCompany(companies[0].rfc, [...companies, { ...companies[0], id: 'c' }], ['a', 'c']).error, /varias empresas/)
  assert.match(cfdiModule.resolveCfdiCompany(null, companies, ['a']).error, /no contiene/)
})

test('no confunde el USD de la factura con el MXN predeterminado; exige TC si falta', async (t) => {
  const h = await mount(t)
  await h.upload(file(invoice({ moneda: 'USD', tipoCambio: 18.25 })))
  assert.equal(h.field('Moneda').props.value, 'USD')
  assert.equal(h.field('Tipo de cambio').props.value, '18.25')
  await h.upload(file(invoice({ moneda: 'USD' })))
  assert.equal(h.field('Tipo de cambio').props.value, '')
  assert.equal(h.field('Tipo de cambio').props.required, true)
  await h.change('Moneda', 'MXN')
  await h.change('Moneda', 'USD')
  assert.equal(h.field('Tipo de cambio').props.value, '')
})

test('conserva moneda y TC elegidos manualmente y bloquea la discrepancia', async (t) => {
  const h = await mount(t)
  await h.change('Moneda', 'MXN')
  await h.change('Tipo de cambio', '19')
  await h.upload(file(invoice({ moneda: 'USD', tipoCambio: 18.25 })))
  assert.equal(h.field('Moneda').props.value, 'MXN')
  assert.equal(h.field('Tipo de cambio').props.value, '19')
  assert.match(h.alerts(), /factura está en USD/)
  await h.submit()
  assert.equal(h.calls.creates.length, 0)
  assert.equal(h.calls.toasts.at(-1)[0], 'Revisa la factura')
})

test('conserva empresa seleccionada y ofrece corregirla; un cambio posterior también se valida', async (t) => {
  const h = await mount(t)
  await h.upload(file(invoice({ rfcReceptor: companies[1].rfc })))
  assert.equal(h.field('Empresa').props.value, 'a')
  assert.match(h.alerts(), /Empresa B/)
  assert.equal(h.button().props.disabled, true)
  await act(async () => { h.renderer.root.findAllByType('button').find((n) => text(n.props.children) === 'Usar Empresa B').props.onClick() })
  assert.equal(h.field('Empresa').props.value, 'b')
  assert.equal(text(h.renderer.root.findByProps({ 'data-company-context': true }).props.children), 'Empresa B')
  assert.equal(h.alerts(), '')
  await h.change('Empresa', 'a')
  assert.equal(text(h.renderer.root.findByProps({ 'data-company-context': true }).props.children), 'Empresa A')
  await h.submit()
  assert.equal(h.calls.creates.length, 0)
  assert.equal(h.calls.toasts.at(-1)[0], 'Revisa la factura')
})

test('precarga empresa vacía y bloquea RFC desconocido o sin acceso', async (t) => {
  const h = await mount(t, { activeCompany: '', allowed: ['a', 'b'] })
  await h.upload(file(invoice({ rfcReceptor: companies[1].rfc })))
  assert.equal(h.field('Empresa').props.value, 'b')
  await h.upload(file(invoice({ rfcReceptor: 'XXX010101XXX' })))
  assert.match(h.alerts(), /no corresponde/)
  const restricted = await mount(t, { allowed: ['a'] })
  await restricted.upload(file(invoice({ rfcReceptor: companies[1].rfc })))
  assert.match(restricted.alerts(), /No tienes acceso/)
  assert.equal(restricted.field('Empresa').props.value, 'a')
})

test('una moneda no admitida nunca se transforma silenciosamente en MXN', async (t) => {
  const h = await mount(t)
  await h.upload(file(invoice({ moneda: 'EUR' })))
  assert.match(h.alerts(), /no es compatible/)
  await h.submit()
  assert.equal(h.calls.creates.length, 0)
})

test('reemplazar XML retira la precarga anterior y conserva los campos editados', async (t) => {
  const h = await mount(t)
  await h.upload(file(invoice()))
  await h.change('Descripcion', 'Mi concepto')
  await h.upload(file(invoice({ subtotal: 200, total: 232, traslados: 32, conceptos: 'Otro concepto' })))
  assert.equal(h.field('Monto solicitado').props.value, '232')
  assert.equal(h.field('Subtotal').props.value, '200')
  assert.equal(h.field('Descripcion').props.value, 'Mi concepto')
  await h.change('Monto solicitado', '250')
  await h.upload(file(invoice({ total: 348, subtotal: 300, traslados: 48 })))
  assert.equal(h.field('Monto solicitado').props.value, '250')
})

test('lectura tardía de A no pisa B ni el snapshot que se persiste; enviar mientras lee se bloquea', async (t) => {
  const h = await mount(t, { allowCreation: true })
  const old = deferred()
  await h.upload(file(old.promise, 'xml-antiguo'))
  assert.equal(h.button().props.disabled, true)
  await h.submit()
  assert.equal(h.calls.creates.length, 0)
  await h.upload(file(invoice({ moneda: 'USD', tipoCambio: 18, uuid: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB' }), 'xml-vigente'))
  await act(async () => old.resolve(invoice()))
  assert.equal(h.field('Moneda').props.value, 'USD')
  await h.submit()
  assert.equal(h.calls.creates.length, 1)
  assert.equal(h.calls.creates[0].invoice_uuid, 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB')
  assert.equal(h.calls.creates[0].currency, 'USD')
  assert.deepEqual(h.calls.snapshots, [{ source: 'xml-vigente' }])
})

test('limpiar adjunto invalida lectura pendiente y permite seguir con PDF', async (t) => {
  const h = await mount(t)
  const pending = deferred()
  await h.upload(file(pending.promise))
  await h.upload(null)
  await act(async () => pending.resolve(invoice({ moneda: 'USD' })))
  assert.equal(h.field('Moneda').props.value, 'MXN')
  assert.equal(h.field('Monto solicitado').props.value, '')
  await h.upload({ name: 'recibo.pdf', type: 'application/pdf', size: 100 })
  assert.equal(h.alerts(), '')
  assert.equal(h.button().props.disabled, false)
})

test('snapshot se fija al enviar aunque cambie el adjunto durante el RPC', async (t) => {
  const creating = deferred()
  const h = await mount(t, { allowCreation: true, creation: creating.promise })
  await h.upload(file(invoice(), 'factura-enviada'))
  let submission
  await act(async () => { submission = h.renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  await h.upload(file(invoice({ uuid: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB' }), 'factura-posterior'))
  await act(async () => { creating.resolve({ id: 'created', request_number: 'QA-1' }); await submission })
  assert.equal(h.calls.creates[0].invoice_uuid, invoice().uuid)
  assert.deepEqual(h.calls.snapshots, [{ source: 'factura-enviada' }])
})

test('crear otra solicitud limpia el snapshot y conserva una empresa única utilizable', async (t) => {
  const h = await mount(t, { allowed: ['a'], allowCreation: true })
  await h.upload(file(invoice(), 'factura-anterior'))
  await h.submit()
  await act(async () => { h.renderer.root.findAllByType('button').find((n) => text(n.props.children) === 'Crear otra solicitud').props.onClick() })
  assert.equal(h.field('Empresa').props.value, 'a')
  assert.equal(h.field('Empresa').props.disabled, true)
  await h.upload({ name: 'recibo.pdf', type: 'application/pdf', size: 100 })
  await h.change('Monto solicitado', '50')
  await h.submit()
  assert.equal(h.calls.creates.length, 2)
  assert.equal(h.calls.creates[1].invoice_uuid, null)
  assert.deepEqual(h.calls.snapshots, [{ source: 'factura-anterior' }])
})

test('duplicado se reconsulta por empresa y respuesta anterior no deja un bloqueo falso', async (t) => {
  const old = deferred()
  const h = await mount(t, { duplicate: (company) => company === 'a' ? old.promise : null })
  await h.upload(file(invoice()))
  await h.change('Empresa', 'b')
  await act(async () => old.resolve({ id: 'old', request_number: 'ANTERIOR', status: 'paid' }))
  assert.equal(h.renderer.root.findAllByType('a').length, 0)
  assert.deepEqual(h.calls.lookups.map(([company]) => company), ['a', 'b'])
})

test('duplicado vigente ofrece enlace y bloquea creación; no habilita alta a un operador', async (t) => {
  const h = await mount(t, { manage: false, duplicate: () => ({ id: 'original', request_number: 'SOL-1', status: 'paid' }) })
  await h.upload(file(invoice({ rfcEmisor: 'DDD010101DDD' })))
  assert.equal(h.renderer.root.findByType('a').props.href, '/solicitudes?request_id=original')
  assert.equal(h.button().props.disabled, true)
  assert.equal(h.renderer.root.findByType(h.ProviderCombo).props.onPlus, undefined)
  assert.equal(h.renderer.root.findAllByType('button').some((n) => text(n.props.children) === 'Darlo de alta'), false)
  await h.submit()
  assert.equal(h.calls.creates.length, 0)
})

test('consulta de UUID usa comparación sin mayúsculas y excluye los estados liberados por el índice', async () => {
  const calls = []
  const query = new Proxy({}, { get: (_, name) => (...args) => {
    calls.push([name, ...args])
    return name === 'maybeSingle' ? Promise.resolve({ data: null, error: null }) : query
  } })
  const api = load(feature + 'api.ts', { '../../lib/supabase': { supabase: { from: () => query } }, './logic': logic })
  assert.equal(await api.findRequestByInvoiceUuid('a', invoice().uuid), null)
  assert.ok(calls.some(([name, field, value]) => name === 'eq' && field === 'company_id' && value === 'a'))
  assert.ok(calls.some(([name, field]) => name === 'ilike' && field === 'invoice_uuid'))
  assert.ok(calls.some(([name, field, op, value]) => name === 'not' && field === 'status' && op === 'in' && value === '(rejected,cancelled)'))
})

test('parser obtiene Moneda y TipoCambio del Comprobante del DOM', async () => {
  const attrs = { SubTotal: '100', Total: '116', Moneda: 'usd', TipoCambio: '18.125' }
  const comprobante = { getAttribute: (key) => attrs[key] ?? null, getElementsByTagNameNS: () => [] }
  const parser = load(feature + 'cfdi.ts', {}, class {
    parseFromString() { return { querySelector: () => null, getElementsByTagNameNS: () => [comprobante] } }
  })
  const parsed = await parser.parseCfdiFile({ text: async () => '<Comprobante />' })
  assert.equal(parsed.moneda, 'USD')
  assert.equal(parsed.tipoCambio, 18.125)
})
