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
const dashboardPath = 'app/src/features/dashboard/'

function load(path, imports = {}) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: path,
  })
  const module = { exports: {} }
  const dependency = name => {
    if (Object.hasOwn(imports, name)) return imports[name]
    if (name.startsWith('react')) return require(name)
    throw new Error(`Unexpected dependency: ${name}`)
  }
  new Function('require', 'module', 'exports', outputText)(dependency, module, module.exports)
  return module.exports
}

const roles = load('app/src/lib/roles.ts')
const logic = load(`${dashboardPath}logic.ts`, { '../../lib/roles': roles })
const month = '2026-09-01'
const budgetRow = (overrides = {}) => ({
  budget_category_id: 'qa', budget_month: month,
  budgeted: 1000, committed: 700, executed: 500, available: 300, ...overrides,
})
const requestRow = (overrides = {}) => ({
  id: 'request', status: 'paid', amount_requested: 100, subtotal_amount: 100,
  tax_amount: null, withholding_amount: null, currency: 'MXN', exchange_rate: 1,
  budget_month: month, ...overrides,
})
const categories = new Map([['qa', { id: 'qa', name: 'Servicios QA', category: 'Operación' }]])

test('budget uses committed including paid once and separates pending payment', () => {
  const result = logic.aggregateBudget([budgetRow()], categories, month)
  assert.deepEqual(result.totals, { budgeted: 1000, used: 700, executed: 500, committed: 200, available: 300, pctUsed: 70 })
  assert.equal(result.partidas[0].over, false)
  assert.equal(result.partidas[0].warn, false)
  // Canonical available is preserved rather than recalculated by the UI.
  assert.equal(logic.aggregateBudget([budgetRow({ available: 299.99 })], categories, month).totals.available, 299.99)
})

test('budget aggregates centers with cent precision and filters months; unbudgeted use stays visible', () => {
  const rows = [
    budgetRow({ budgeted: 100.10, committed: 50.05, executed: 30.02, available: 50.05 }),
    budgetRow({ budgeted: 200.20, committed: 75.10, executed: 25.05, available: 125.10 }),
    budgetRow({ budget_category_id: 'unbudgeted', budget_month: '2026-10-01', budgeted: 0, committed: 10, executed: 0, available: -10 }),
    budgetRow({ budget_category_id: 'empty', budgeted: 0, committed: 0, executed: 0, available: 0 }),
  ]
  const september = logic.aggregateBudget(rows, categories, month)
  assert.equal(september.totals.budgeted, 300.30)
  assert.equal(september.totals.used, 125.15)
  assert.equal(september.totals.executed, 55.07)
  assert.equal(september.totals.committed, 70.08)
  assert.equal(september.totals.available, 175.15)
  assert.equal(september.partidas.length, 1)
  assert.equal(september.omittedCount, 1)
  const october = logic.aggregateBudget(rows, categories, '2026-10-01')
  assert.equal(october.totals.pctUsed, Infinity)
  assert.equal(october.partidas[0].over, true)
  assert.equal(logic.aggregateBudget(rows, categories, 'all').totals.used, 135.15)
  assert.equal(logic.aggregateBudget([budgetRow({ available: null })], categories, month).totals.available, 300)
})

test('request amounts convert MXN and USD using the saved rate in every status and stage', () => {
  const rows = [requestRow({ amount_requested: 200 }), requestRow({ currency: 'USD', exchange_rate: 20 })]
  const result = logic.aggregateRequests(rows, month)
  assert.equal(result.funnel.find(row => row.key === 'pagadas').amount, 2200)
  assert.equal(result.byStatus[0].amount, 2200)
  assert.equal(result.total, 2)
  assert.equal(result.unconvertedCount, 0)
  const statuses = ['pending_approval', 'rejected', 'changes_requested', 'finance_validation']
  const other = logic.aggregateRequests(statuses.map(status => requestRow({ status, currency: 'USD', exchange_rate: 20 })), 'all')
  assert.equal(other.funnel.find(row => row.key === 'en_curso').count, 3)
  assert.equal(other.rejected.amount, 2000)
  assert.equal(other.changesRequested.amount, 2000)
  assert.equal(other.inReview.amount, 4000)
  assert.equal(logic.aggregateRequests(rows, '2026-10-01').total, 0)
})

test('missing or invalid currency conversion preserves counts and marks amounts partial or unknown', () => {
  const rows = [null, 0, -1, Infinity].map(exchange_rate => requestRow({ currency: 'USD', exchange_rate }))
  rows.push(requestRow({ currency: null }))
  const unknown = logic.aggregateRequests(rows, month)
  assert.equal(unknown.total, 5)
  assert.equal(unknown.unconvertedCount, 5)
  assert.equal(logic.requestAmountLabel(unknown.byStatus[0]), '—')
  const mixed = logic.aggregateRequests([...rows, requestRow({ amount_requested: 200 })], month)
  assert.equal(mixed.byStatus[0].amount, 200)
  assert.equal(mixed.total, 6)
  assert.match(logic.requestAmountLabel(mixed.byStatus[0]), /200.*parcial/)
})

test('fiscal summary includes only approved, scheduled and paid requests, converts taxes and exposes missing detail/rates', () => {
  const excluded = ['draft', 'submitted', 'pending_approval', 'finance_validation', 'changes_requested', 'rejected', 'cancelled', null]
    .map(status => requestRow({ status, tax_amount: 999, withholding_amount: 999 }))
  assert.deepEqual(logic.aggregateTaxes(excluded, 'all'), { iva: 0, retenciones: 0, withDetail: 0, total: 0, unconvertedCount: 0 })
  const rows = [...excluded,
    requestRow({ status: 'approved', tax_amount: 16 }),
    requestRow({ status: 'scheduled', currency: 'USD', exchange_rate: 20, tax_amount: 2, withholding_amount: 1 }),
    requestRow({ status: 'paid', withholding_amount: 10 }),
    requestRow({ status: 'paid' }),
    requestRow({ currency: 'USD', exchange_rate: null, tax_amount: 5 }),
    requestRow({ budget_month: '2026-10-01', tax_amount: 100 }),
  ]
  assert.deepEqual(logic.aggregateTaxes(rows, month), { iva: 56, retenciones: 30, withDetail: 4, total: 5, unconvertedCount: 1 })
})

test('both operational API queries isolate company/year across pages and retrieve conversion fields', async () => {
  const calls = []
  const data = {
    payment_requests: Array.from({ length: 1001 }, (_, i) => requestRow({ id: String(i).padStart(4, '0'), company_id: 'operadora' })),
    budget_availability: Array.from({ length: 1001 }, (_, i) => budgetRow({ cost_center_id: String(i).padStart(4, '0'), company_id: 'operadora' })),
    budget_categories: [...categories.values()],
  }
  for (const table of ['payment_requests', 'budget_availability']) {
    data[table].push({ ...data[table][0], company_id: 'fersana' }, { ...data[table][0], budget_month: '2025-09-01' }, { ...data[table][0], budget_month: '2027-01-01' })
  }
  const supabase = { from(table) {
    const call = { table, filters: [], orders: [] }
    calls.push(call)
    const builder = {
      select(fields) { call.fields = fields; return builder },
      eq(field, value) { call.filters.push(['eq', field, value]); return builder },
      gte(field, value) { call.filters.push(['gte', field, value]); return builder },
      lt(field, value) { call.filters.push(['lt', field, value]); return builder },
      order(field) { call.orders.push(field); return builder },
      limit(limit) { return builder.range(0, limit - 1) },
      range(from, to) {
        call.range = [from, to]
        const rows = data[table].filter(row => call.filters.every(([op, key, value]) => op === 'eq' ? row[key] === value : row[key] != null && (op === 'gte' ? row[key] >= value : row[key] < value)))
        rows.sort((a, b) => {
          for (const key of call.orders) { if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1 }
          return 0
        })
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
      },
    }
    return builder
  } }
  const api = load(`${dashboardPath}api.ts`, { '../../lib/supabase': { supabase }, './logic': logic })
  const requests = await api.fetchPaymentRequests('operadora', 2026)
  const budget = await api.fetchBudgetAvailability('operadora', 2026)
  assert.equal(requests.length, 1001)
  assert.equal(new Set(requests.map(row => row.id)).size, 1001)
  assert.equal(budget.rows.length, 1001)
  assert.equal(budget.categories.get('qa').name, 'Servicios QA')
  for (const call of calls.filter(call => call.table !== 'budget_categories')) {
    assert.deepEqual(call.filters, [['eq', 'company_id', 'operadora'], ['gte', 'budget_month', '2026-01-01'], ['lt', 'budget_month', '2027-01-01']])
    assert.deepEqual(call.orders, call.table === 'payment_requests' ? ['budget_month', 'id'] : ['budget_month', 'cost_center_id', 'budget_category_id'])
    if (call.table === 'payment_requests') assert.match(call.fields, /currency,exchange_rate/)
  }
})

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function mountHook() {
  const calls = []
  const api = Object.fromEntries(['fetchBudgetAvailability', 'fetchPaymentRequests'].map(name => [name, (companyId, year) => {
    const pending = deferred()
    calls.push({ name, companyId, year, ...pending })
    return pending.promise
  }]))
  const { useOperationalDashboard } = load(`${dashboardPath}useOperationalDashboard.ts`, { './api': api })
  const renders = []
  function Probe(props) {
    renders.push(useOperationalDashboard(props.companyId, props.year, props.enabled))
    return null
  }
  let renderer
  act(() => { renderer = create(React.createElement(Probe, { companyId: 'operadora', year: 2026, enabled: true })) })
  return {
    calls, renders, latest: () => renders.at(-1),
    update(props) { act(() => renderer.update(React.createElement(Probe, { year: 2026, enabled: true, ...props }))) },
    unmount() { act(() => renderer.unmount()) },
  }
}

async function settle(calls, company, fail = false) {
  await act(async () => {
    for (const call of calls) {
      if (fail) call.reject(new Error('Synthetic unavailable'))
      else call.resolve(call.name === 'fetchBudgetAvailability' ? { rows: [budgetRow()], categories, company } : [requestRow({ id: company })])
    }
  })
}

test('switching either company masks previous data on the first render and after a failed load', async () => {
  const h = mountHook()
  try {
    await settle(h.calls.slice(0, 2), 'operadora')
    assert.equal(h.latest().reqData[0].id, 'operadora')
    const index = h.renders.length
    h.update({ companyId: 'fersana' })
    assert.equal(h.renders[index].budgetData, null)
    assert.equal(h.renders[index].reqData, null)
    assert.equal(h.latest().loading, true)
    await settle(h.calls.slice(2, 4), 'fersana', true)
    assert.equal(h.latest().reqData, null)
    assert.equal(h.latest().budgetData, null)
    assert.equal(h.latest().budgetError, true)
    assert.equal(h.latest().reqError, true)
    act(() => h.latest().refresh())
    await settle(h.calls.slice(4, 6), 'fersana')
    assert.equal(h.latest().reqData[0].id, 'fersana')
    h.update({ companyId: 'operadora' })
    assert.equal(h.latest().reqData, null)
    await settle(h.calls.slice(6, 8), 'operadora', true)
    assert.equal(h.latest().reqData, null)
  } finally { h.unmount() }
})

test('late company/year responses cannot overwrite the active scope and refresh fetches both sources', async () => {
  const h = mountHook()
  try {
    h.update({ companyId: 'fersana', year: 2025 })
    await settle(h.calls.slice(2, 4), 'fersana')
    await settle(h.calls.slice(0, 2), 'operadora')
    assert.equal(h.latest().reqData[0].id, 'fersana')
    act(() => h.latest().refresh())
    assert.equal(h.latest().reqData, null)
    assert.deepEqual(h.calls.slice(4).map(c => [c.companyId, c.year]), [['fersana', 2025], ['fersana', 2025]])
    await settle(h.calls.slice(4), 'fersana-refreshed')
    assert.equal(h.latest().reqData[0].id, 'fersana-refreshed')
  } finally { h.unmount() }
})

test('partial fetch failures retain only the successful current source and disabled mode fetches nothing', async () => {
  const h = mountHook()
  try {
    await act(async () => {
      h.calls[0].reject(new Error('Budget unavailable'))
      h.calls[1].resolve([requestRow()])
    })
    assert.equal(h.latest().budgetError, true)
    assert.equal(h.latest().reqError, false)
    assert.equal(h.latest().reqData.length, 1)
    h.update({ companyId: 'fersana', enabled: false })
    assert.equal(h.calls.length, 2)
    assert.equal(h.latest().reqData, null)
    assert.equal(h.latest().loading, false)
    h.update({ companyId: null })
    assert.equal(h.calls.length, 2)
  } finally { h.unmount() }
})

function text(node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  return text(node.children ?? node.props?.children)
}

async function mountPage({ fetchBudget, fetchRequests, pathname = '/dashboard' } = {}) {
  let companyId = 'operadora'
  const calls = []
  const api = {
    fetchDashboardPayload: async pk => { calls.push(['payload', pk]); return { kpis: { cierre: { closure_status: 'closed' } } } },
    fetchBudgetAvailability: async (id, year) => {
      calls.push(['budget', id, year])
      return fetchBudget ? fetchBudget(id, year) : { rows: [budgetRow()], categories }
    },
    fetchPaymentRequests: async (id, year) => {
      calls.push(['requests', id, year])
      return fetchRequests ? fetchRequests(id, year) : [requestRow({ tax_amount: 16, withholding_amount: 10 })]
    },
    fetchHistoricalPeriods: async () => [], fetchHistoricalYear: async () => [], fetchHistoricalAll: async () => [], loadHistMapeo: async () => new Map(),
  }
  const noop = () => null
  const span = props => React.createElement('span', null, props.children)
  const showToast = () => {}
  const { default: Page } = load(`${dashboardPath}DashboardPage.tsx`, {
    'react-router-dom': { useSearchParams: () => [new URLSearchParams()], useLocation: () => ({ pathname }), Link: span },
    '../../lib/auth': { useAuth: () => ({ group: roles.ROLE_GROUPS.SYSADMIN }) },
    '../../lib/company': { useCompany: () => ({ companyId, companyName: companyId === 'operadora' ? 'Operadora QA' : 'Fersana QA' }) },
    '../../components/ui/Toast': { useToast: () => ({ showToast }) },
    '../../components/ui/Badge': { Badge: span },
    '../../components/ui/Skeleton': { TableSkeletonRows: noop, Skeleton: noop },
    './api': api, './logic': { ...logic, currentPeriodKey: () => '2026-09' },
    './useOperationalDashboard': load(`${dashboardPath}useOperationalDashboard.ts`, { './api': api }),
    './charts': { ComboChart: noop }, './HistoryModal': { HistoryModal: noop }, './ExportModal': { ExportModal: noop },
    './Dashboard.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  })
  const previousDocument = globalThis.document
  globalThis.document = { title: '', getElementById: () => null }
  let renderer
  await act(async () => { renderer = create(React.createElement(Page)) })
  return {
    renderer, calls,
    async switchCompany(id) { companyId = id; await act(async () => renderer.update(React.createElement(Page))) },
    section(id) { return text(renderer.root.findByProps({ id })) },
    unmount() { act(() => renderer.unmount()); globalThis.document = previousDocument },
  }
}

test('actual page renders canonical budget split and neutral fiscal labels', async () => {
  const p = await mountPage()
  try {
    assert.match(p.section('sec-budget'), /Pendiente de pago\$200/)
    assert.match(p.section('sec-budget'), /Disponible\$300/)
    assert.doesNotMatch(p.section('sec-budget'), /Sobregirado ·/)
    assert.match(p.section('sec-taxes'), /IVA registrado/)
    assert.match(p.section('sec-taxes'), /Retenciones registradas/)
    assert.doesNotMatch(p.section('sec-taxes'), /acreditable|por enterar|tax_amount|withholding_amount/)
  } finally { p.unmount() }
})

test('page refresh reloads both sources; month/year controls stay aligned even without a budget', async () => {
  const p = await mountPage({ fetchBudget: async () => ({ rows: [], categories }), fetchRequests: async () => [requestRow({ budget_month: '2025-03-01' })] })
  try {
    const before = p.calls.length
    await act(async () => p.renderer.root.findAllByType('button').find(button => text(button) === 'Actualizar').props.onClick())
    assert.deepEqual(p.calls.slice(before).filter(call => call[0] !== 'payload').map(call => call[0]).sort(), ['budget', 'requests'])
    await act(async () => p.renderer.root.findByProps({ 'aria-label': 'Mes operativo' }).props.onChange({ target: { value: '2025-03' } }))
    assert.deepEqual(p.calls.filter(call => call[0] === 'requests').at(-1), ['requests', 'operadora', 2025])
    assert.equal(p.renderer.root.findByProps({ 'aria-label': 'Periodo del resumen' }).props.value, '2025-03-01')
    assert.equal(p.renderer.root.findByProps({ 'aria-label': 'Periodo del resumen' }).findAllByType('option').length, 13)
    assert.match(p.section('sec-requests'), /Marzo de 2025/)
    assert.match(p.section('sec-requests'), /Pagadas1\$100/)
    await act(async () => p.renderer.root.findByProps({ 'aria-label': 'Periodo del resumen' }).props.onChange({ target: { value: 'all' } }))
    assert.match(text(p.renderer.toJSON()), /Resumen anual.*2025.*Cierre, cobranza y efectivo.*Marzo de 2025/)
    await act(async () => p.renderer.root.findByProps({ 'aria-label': 'Periodo del resumen' }).props.onChange({ target: { value: '2025-10-01' } }))
    assert.equal(p.renderer.root.findByProps({ 'aria-label': 'Mes operativo' }).props.value, '2025-10')
    assert.match(p.section('sec-requests'), /Sin solicitudes/)
  } finally { p.unmount() }
})

test('page never reports all clear while loading or failing and removes old company alerts', async () => {
  const waiting = deferred()
  const p = await mountPage({
    fetchBudget: async id => id === 'fersana' ? waiting.promise : { rows: [budgetRow({ budgeted: 50, committed: 75, executed: 0, available: -25 })], categories },
    fetchRequests: async id => {
      if (id === 'fersana') throw new Error('Requests unavailable')
      return [requestRow({ status: 'rejected' })]
    },
  })
  try {
    assert.match(text(p.renderer.root.findByProps({ 'aria-label': 'Alertas del periodo' })), /sobregirada/)
    await p.switchCompany('fersana')
    let alerts = text(p.renderer.root.findByProps({ 'aria-label': 'Alertas del periodo' }))
    assert.match(alerts, /Cargando alertas de Fersana QA/)
    assert.doesNotMatch(alerts, /sobregirada|rechazadas|Todo en orden/)
    await act(async () => waiting.reject(new Error('Budget unavailable')))
    alerts = text(p.renderer.root.findByProps({ 'aria-label': 'Alertas del periodo' }))
    assert.match(alerts, /Resumen incompleto/)
    assert.doesNotMatch(alerts, /sobregirada|rechazadas|Todo en orden/)
    assert.match(p.section('sec-budget'), /No se pudo cargar/)
  } finally { p.unmount() }
})

test('annual route does not request or render the operational summary', async () => {
  const p = await mountPage({ pathname: '/dashboard-anual' })
  try {
    assert.equal(p.calls.filter(call => call[0] !== 'payload').length, 0)
    assert.equal(p.renderer.root.findAllByProps({ id: 'sec-budget' }).length, 0)
    assert.equal(p.renderer.root.findAllByProps({ id: 'sec-taxes' }).length, 0)
  } finally { p.unmount() }
})
