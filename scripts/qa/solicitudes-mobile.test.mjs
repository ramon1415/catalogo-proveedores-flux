import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'

const root = resolve(new URL('../..', import.meta.url).pathname)
const require = createRequire(resolve(root, 'app/package.json'))
const React = require('react'), ts = require('typescript'), postcss = require('postcss')
const { create, act } = require('react-test-renderer')
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : text(node?.children ?? node?.props?.children ?? '')
const companies = [{ id: 'opt', name: 'Operadora Tlacatecpan' }, { id: 'sf', name: 'Soporte Fersana' }]
const requests = companies.flatMap(company => ['submitted', 'paid'].map((status, i) => ({
  id: `${company.id}-${i}`, request_number: `SOL-${company.id}-${i}`, company_id: company.id,
  proveedor_id: 'provider', cost_center_id: null, budget_category_id: null, budget_month: '2026-09-01',
  amount_requested: 12345, currency: 'MXN', status, budget_decision: 'aprobable',
  requested_by: i === 0 ? 'me' : 'other', description: 'Compra de prueba', created_at: '2026-09-09',
})))

async function mount({ group = 'sysadmin', failed = false } = {}) {
  let activeCompanyId = 'opt'
  const cache = new Map()
  const auth = { group, profile: { id: 'me' }, roles: ['finance'], memberships: companies.map(c => ({ company_id: c.id })) }
  function load(path) {
    if (cache.has(path)) return cache.get(path)
    if (path.endsWith('/lib/auth.tsx')) return { useAuth: () => auth }
    if (path.endsWith('/lib/company.tsx')) return { useCompany: () => ({ companyId: activeCompanyId }) }
    if (path.endsWith('/ui/Toast.tsx')) return { useToast: () => ({ showToast() {} }) }
    if (path.endsWith('/solicitudes/api.ts')) return {
      loadCompanies: async () => companies, loadCostCenters: async () => [], loadBudgetCategories: async () => [],
      loadProveedores: async () => [{ id: 'provider', alias: 'Proveedor de prueba' }], loadProfiles: async () => [],
      loadPaymentRequests: async () => { if (failed) throw Error('Error de conexión de prueba'); return requests },
      loadFase2Metadata: async () => new Map(), loadExtraordinaryBadges: async () => new Map(),
    }
    if (/\/solicitudes\/(Request|Detail|Edit|ReimbursementEdit)Modal\.tsx$/.test(path)) {
      const name = path.split('/').at(-1).replace('.tsx', '')
      return { [name]: props => React.createElement('dialog', { open: true, 'aria-label': name },
        props.request?.request_number ?? 'Nueva solicitud', React.createElement('button', { onClick: props.onClose }, 'Cerrar')) }
    }
    if (path.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }
    const module = { exports: {} }
    const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
      fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    })
    new Function('require', 'module', 'exports', outputText)(name => {
      if (name === 'react-router-dom') return { useSearchParams: () => [new URLSearchParams()] }
      if (name.startsWith('react')) return require(name)
      let dep = resolve(dirname(path), name)
      if (!existsSync(dep)) dep = ['.tsx', '.ts'].map(ext => dep + ext).find(existsSync)
      if (!dep) throw Error(`Unresolved ${name}`)
      return load(dep)
    }, module, module.exports)
    cache.set(path, module.exports)
    return module.exports
  }
  const Page = load(resolve(root, 'app/src/features/solicitudes/SolicitudesPage.tsx')).default
  let view
  await act(async () => { view = create(React.createElement(Page)) })
  return { view, async company(id) { activeCompanyId = id; await act(async () => view.update(React.createElement(Page))) },
    async click(label) { await act(async () => view.root.findAllByType('button').find(b => text(b) === label).props.onClick()) },
    async change(label, value) { await act(async () => view.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } })) },
    close() { act(() => view.unmount()) },
  }
}

test('the same mobile rows show only the active company and open its request detail', async () => {
  const h = await mount()
  try {
    for (const company of companies) {
      await h.company(company.id)
      const table = h.view.root.findByProps({ 'aria-label': 'Solicitudes de pago' })
      assert.match(text(table), new RegExp(`SOL-${company.id}-0`))
      assert.doesNotMatch(text(table), new RegExp(`SOL-${company.id === 'opt' ? 'sf' : 'opt'}-`))
      assert.deepEqual(table.findAll(n => n.type === 'td' && n.props['data-label']).map(n => n.props['data-label']),
        ['Folio', 'Proveedor', 'Partida', 'Monto', 'Estatus', 'Acciones'])
      await h.click('Ver detalle')
      assert.match(text(h.view.root.findByType('dialog')), new RegExp(`SOL-${company.id}-0`))
      await h.company(company.id === 'opt' ? 'sf' : 'opt')
      assert.equal(h.view.root.findAllByType('dialog').length, 0)
    }
  } finally { h.close() }
})

test('mobile filters and empty state can recover all requests without crossing companies', async () => {
  const h = await mount()
  try {
    await h.company('sf')
    await h.change('Buscar solicitudes', 'no existe')
    assert.match(text(h.view.toJSON()), /Sin resultados/)
    await h.click('Limpiar filtros')
    const table = () => h.view.root.findByProps({ 'aria-label': 'Solicitudes de pago' })
    assert.match(text(table()), /SOL-sf-0/)
    assert.match(text(table()), /SOL-sf-1/)
    assert.doesNotMatch(text(table()), /SOL-opt/)
    await h.change('Filtrar por estatus', 'paid')
    assert.doesNotMatch(text(table()), /SOL-sf-0/)
    assert.match(text(table()), /SOL-sf-1/)
  } finally { h.close() }
})

test('operator scope still excludes requests by other people in both companies', async () => {
  const h = await mount({ group: 'operation' })
  try {
    await h.click('Ver todas')
    for (const company of companies) {
      await h.company(company.id)
      const table = h.view.root.findByProps({ 'aria-label': 'Solicitudes de pago' })
      assert.match(text(table), new RegExp(`SOL-${company.id}-0`))
      assert.doesNotMatch(text(table), /SOL-(opt|sf)-1/)
    }
  } finally { h.close() }
})

test('a loading failure remains an explicit error rather than an empty request list', async () => {
  const h = await mount({ failed: true })
  try { assert.match(text(h.view.toJSON()), /Error de conexión de prueba/) } finally { h.close() }
})

// Resolve the actual CSS cascade at the target widths. A zero-height flex item
// cannot be detected by React's renderer, so guard the specific collapse here.
const css = postcss.parse(readFileSync(resolve(root, 'app/src/features/solicitudes/Solicitudes.module.css'), 'utf8'))
function styles(selector, width) {
  const result = {}
  css.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && parent.name === 'media') {
        const max = parent.params.match(/max-width:\s*(\d+)px/)
        if (!max) throw Error(`Uncovered media condition: ${parent.params}`)
        if (width > Number(max[1])) return
      }
    }
    rule.walkDecls(decl => { result[decl.prop] = decl.value })
  })
  return result
}

test('phone widths preserve request height even when filters fill the card; detail fits the screen', () => {
  for (const width of [320, 360, 390, 430, 640, 760]) {
    const card = styles('.tableCard', width), wrap = styles('.tableWrap', width)
    assert.equal(card.flex, '0 0 auto', `${width}: card must size from its content`)
    assert.equal(wrap.flex, '0 0 auto', `${width}: requests must not shrink behind filters`)
    assert.ok(parseFloat(wrap['min-height']) >= 200, `${width}: loading/empty state needs visible space`)
    assert.equal(wrap['max-height'], 'none', `${width}: rows must not overflow a shorter card`)
    assert.equal(wrap.overflow, 'visible', `${width}: page scroll must reach every request`)
    assert.equal(styles('.table', width)['min-width'], '0', `${width}: rows fit phone width`)
    assert.equal(styles('.table tbody tr', width).display, 'grid')
    assert.ok(parseFloat(styles('.rowActions .smallBtn', width)['min-height']) >= 44)
  }
  for (const width of [761, 900, 1440]) {
    assert.equal(styles('.tableWrap', width).overflow, 'auto')
    assert.equal(styles('.tableWrap', width).flex, '1')
    assert.equal(styles('.table', width)['min-width'], '820px')
  }
})
