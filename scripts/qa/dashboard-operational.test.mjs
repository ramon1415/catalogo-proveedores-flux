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
const tenantConfig = load('app/src/lib/tenantConfig.ts')
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
  const api = load(`${dashboardPath}api.ts`, { '../../lib/supabase': { supabase }, '../../lib/tenantConfig': tenantConfig, './logic': logic })
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

async function mountPage({ fetchBudget, fetchRequests, fetchActivity, pathname = '/dashboard' } = {}) {
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
    fetchDashboardActivity: async (id, year) => {
      calls.push(['activity', id, year])
      return fetchActivity ? fetchActivity(id, year) : { legacyIncome: id === 'operadora', cash: [], incidents: [], income: [] }
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
    './charts': { ComboChart: props => React.createElement('figure', { 'data-chart': props }) }, './HistoryModal': { HistoryModal: noop }, './ExportModal': { ExportModal: noop },
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
    assert.deepEqual(p.calls.slice(before).map(call => call[0]).sort(), ['activity', 'budget', 'requests'])
    await act(async () => p.renderer.root.findByProps({ 'aria-label': 'Mes operativo' }).props.onChange({ target: { value: '2025-03' } }))
    assert.deepEqual(p.calls.filter(call => call[0] === 'requests').at(-1), ['requests', 'operadora', 2025])
    assert.equal(p.renderer.root.findByProps({ 'aria-label': 'Periodo del resumen' }).props.value, '2025-03-01')
    assert.equal(p.renderer.root.findByProps({ 'aria-label': 'Periodo del resumen' }).findAllByType('option').length, 13)
    assert.match(p.section('sec-requests'), /Marzo de 2025/)
    assert.match(p.section('sec-requests'), /Pagadas1\$100/)
    await act(async () => p.renderer.root.findByProps({ 'aria-label': 'Periodo del resumen' }).props.onChange({ target: { value: 'all' } }))
    assert.match(text(p.renderer.toJSON()), /Resumen anual.*2025.*Cobros, incidencias y solicitudes por atender.*Marzo de 2025.*Efectivo muestra el saldo actual/)
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

const cashRow = (overrides = {}) => ({ id: 'cash', status: 'pending_receipt', assigned_amount: 100, verified_amount: 20, pending_amount: 80, due_date: '2026-08-31', ...overrides })
const incomeRow = (overrides = {}) => ({ id: 'income', period: '2026-09', currency: 'MXN', member_name: 'Socio QA', expected_amount: 100, paid_amount: 20, pending_amount: 80, status: 'partial', ...overrides })

test('activity distinguishes monthly income/incidents from current cash, without double counting overdue funds', () => {
  const result = logic.aggregateDashboardActivity({
    legacyIncome: true,
    cash: [cashRow(), cashRow({ id: 'review', status: 'receipt_review', due_date: '2026-09-30' }), cashRow({ id: 'closed', status: 'closed', assigned_amount: 1000 })],
    income: [incomeRow(), incomeRow({ period: '2026-08' }), incomeRow({ status: 'cancelled' }), incomeRow({ currency: 'USD', expected_amount: 9999 }), incomeRow({ currency: null })],
    incidents: [{ id: '1', status: 'open', incident_date: '2026-09-02' }, { id: '2', status: 'invoiced', incident_date: '2026-09-04' }, { id: '3', status: 'paid', incident_date: '2026-09-05' }, { id: '4', status: 'open', incident_date: '2026-08-04' }],
  }, '2026-09', '2026-09-14')
  assert.deepEqual(result.cash, { active: 2, pending: 2, inReview: 1, overdue: 1, assigned: 200, verified: 40, pendingAmount: 160 })
  assert.deepEqual(result.incidents, { open: 1, invoiced: 1, paid: 1, pending: 2 })
  assert.deepEqual(result.income, { expected: 100, paid: 20, pending: 80, members: 1 })
  assert.equal(result.incomeExcluded, 2)
})

test('activity API selects the income model per company and scopes all tenant data before pagination', async () => {
  const op = tenantConfig.LEGACY_INCOME_COMPANY_IDS[0]
  const fer = '68b61801-74c0-44ea-a33b-f20e4bf53aa7'
  const calls = []
  const tables = {
    cash_funds: [cashRow({ company_id: op }), cashRow({ id: 'fer', company_id: fer }), cashRow({ company_id: fer, status: 'closed' })],
    incident_charges: [{ id: 'op', company_id: op, status: 'open', incident_date: '2026-09-01' }, { id: 'fer', company_id: fer, status: 'invoiced', incident_date: '2026-09-01' }, { id: 'old', company_id: fer, status: 'open', incident_date: '2025-09-01' }],
    maintenance_fee_charges: [{ id: 'fee', expected_amount: 100, paid_amount: 20, pending_amount: 80, status: 'partial', members: { full_name: 'Socio de Operadora', lineage: 'QA' }, billing_periods: { name: 'Septiembre', cutoff_date: '2026-09-01' } }],
    tenant_income_entries: [{ id: 'fer', company_id: fer, period: '2026-09', payer_name: 'Cliente Fersana', amount: 50, currency: 'MXN', status: 'cobrado' }, { id: 'other', company_id: op, period: '2026-09', payer_name: 'Otro', amount: 5000, currency: 'MXN', status: 'pendiente' }],
  }
  const supabase = { from(table) {
    const call = { table, filters: [] }; calls.push(call)
    const builder = {
      select(fields) { call.fields = fields; return builder },
      eq(k, v) { call.filters.push(['eq', k, v]); return builder },
      gte(k, v) { call.filters.push(['gte', k, v]); return builder },
      lt(k, v) { call.filters.push(['lt', k, v]); return builder },
      in(k, v) { call.filters.push(['in', k, v]); return builder },
      order() { return builder },
      async range(from, to) {
        const rows = tables[table].filter(row => call.filters.every(([op, k, value]) => {
          const actual = k.split('.').reduce((obj, key) => obj?.[key], row)
          return op === 'eq' ? actual === value : op === 'gte' ? actual >= value : op === 'lt' ? actual < value : value.includes(actual)
        }))
        return { data: rows.slice(from, to + 1), error: null }
      },
    }
    return builder
  } }
  const api = load(`${dashboardPath}api.ts`, { '../../lib/supabase': { supabase }, '../../lib/tenantConfig': tenantConfig, './logic': logic })
  const operator = await api.fetchDashboardActivity(op, 2026)
  assert.equal(operator.legacyIncome, true)
  assert.equal(operator.income[0].member_name, 'Socio de Operadora')
  assert.equal(operator.income[0].period, '2026-09')
  assert.equal(operator.cash.length, 1)
  assert.equal(operator.incidents[0].id, 'op')
  const before = calls.length
  const fersana = await api.fetchDashboardActivity(fer, 2026)
  assert.equal(fersana.legacyIncome, false)
  assert.equal(fersana.income.length, 1)
  assert.equal(fersana.income[0].member_name, 'Cliente Fersana')
  assert.equal(fersana.income[0].paid_amount, 50)
  assert.equal(fersana.cash.length, 1)
  assert.equal(fersana.incidents.length, 1)
  assert.equal(fersana.incidents[0].id, 'fer')
  assert.ok(calls.slice(before).every(call => call.filters.some(([filter, key, value]) => filter === 'eq' && key === 'company_id' && value === fer)))
  assert.ok(calls.slice(before).every(call => call.table !== 'maintenance_fee_charges'))
  assert.match(calls.find(call => call.table === 'maintenance_fee_charges').fields, /billing_periods!inner/)
  await assert.rejects(() => api.fetchDashboardActivity('', 2026), /Selecciona una empresa/)
})

test('activity hook masks old company/year on the first render, rejects late results, and retries with refresh revision', async () => {
  const calls = [], renders = []
  const api = { fetchDashboardActivity(companyId, year) { const pending = deferred(); calls.push({ companyId, year, ...pending }); return pending.promise } }
  const { useDashboardActivity } = load(`${dashboardPath}useOperationalDashboard.ts`, { './api': api })
  function Probe(props) { renders.push(useDashboardActivity(props.companyId, props.year, true, props.revision)); return null }
  let renderer
  const update = (companyId, year = 2026, revision = 0) => act(() => renderer.update(React.createElement(Probe, { companyId, year, revision })))
  act(() => { renderer = create(React.createElement(Probe, { companyId: 'operadora', year: 2026, revision: 0 })) })
  try {
    await act(async () => calls[0].resolve({ company: 'operadora' }))
    const index = renders.length
    update('fersana')
    assert.equal(renders[index].data, null)
    await act(async () => calls[1].reject(new Error('Unavailable')))
    assert.equal(renders.at(-1).error, true)
    assert.equal(renders.at(-1).data, null)
    update('fersana', 2026, 1)
    update('fersana', 2025, 1)
    await act(async () => calls[3].resolve({ company: 'fersana', year: 2025 }))
    await act(async () => calls[2].resolve({ company: 'fersana', year: 2026 }))
    assert.equal(renders.at(-1).data.year, 2025)
    update('operadora', 2026, 1)
    assert.equal(renders.at(-1).data, null)
    await act(async () => calls[4].resolve({ company: 'operadora' }))
    assert.equal(renders.at(-1).data.company, 'operadora')
  } finally { act(() => renderer.unmount()) }
})

test('page partidas search handles accents, group names and no matches without changing period totals', async () => {
  const cats = new Map([...categories, ['other', { id: 'other', name: 'Administración', category: 'Corporativo' }]])
  const p = await mountPage({ fetchBudget: async () => ({ rows: [budgetRow(), budgetRow({ budget_category_id: 'other' })], categories: cats }) })
  try {
    const search = p.renderer.root.findByProps({ 'aria-label': 'Buscar partida o grupo' })
    await act(async () => search.props.onChange({ target: { value: '  ADMINISTRACION corpo ' } }))
    let section = p.section('sec-budget')
    assert.match(section, /Administración/)
    assert.doesNotMatch(section, /Servicios QA/)
    assert.match(section, /1 de 2 partidas/)
    assert.match(section, /Presupuestado\$2,000Usado\$1,400Disponible\$600/)
    await act(async () => search.props.onChange({ target: { value: 'operacion servicios' } }))
    section = p.section('sec-budget')
    assert.match(section, /Servicios QA/)
    assert.doesNotMatch(section, /Administración/)
    await act(async () => search.props.onChange({ target: { value: 'inexistente' } }))
    assert.match(p.section('sec-budget'), /No hay partidas que coincidan/)
    await act(async () => p.renderer.root.findAllByType('button').find(button => text(button) === 'Limpiar búsqueda').props.onClick())
    assert.match(p.section('sec-budget'), /2 de 2 partidas/)
    assert.match(p.section('sec-budget'), /Administración/)
    assert.match(p.section('sec-budget'), /Servicios QA/)
  } finally { p.unmount() }
})

test('top budget and chart use the same canonical amounts as detail, never the global zero-budget RPC', async () => {
  const p = await mountPage({ fetchRequests: async () => [requestRow({ amount_requested: 8888 })] })
  try {
    assert.equal(p.calls.some(call => call[0] === 'payload'), false)
    const top = text(p.renderer.root.findByProps({ 'aria-label': 'Indicadores operativos' }))
    assert.match(top, /Presupuesto usado\$700.*de \$1,000 presupuestado/)
    assert.doesNotMatch(top, /8,888|bloqueos de cierre/)
    assert.doesNotMatch(text(p.renderer.toJSON()), /Cerrar periodo|Checklist de cierre/)
    const chart = p.renderer.root.findByType('figure').props['data-chart']
    assert.equal(chart.rightTitle, undefined)
    assert.deepEqual(chart.series.map(series => series.data.at(-1)), [1000, 700])
    assert.match(p.section('sec-budget'), /Usado\$700/)
  } finally { p.unmount() }
})

test('company change removes all old cash and payer data even when activity fails, without displaying false zeroes', async () => {
  const p = await mountPage({ fetchActivity: async id => {
    if (id === 'fersana') throw new Error('Income unavailable')
    return { legacyIncome: true, income: [incomeRow({ member_name: 'Socio de Operadora' })], cash: [cashRow({ pending_amount: 4321 })], incidents: [] }
  } })
  try {
    assert.match(p.section('sec-activity'), /Socio de Operadora/)
    await p.switchCompany('fersana')
    const page = text(p.renderer.toJSON())
    assert.doesNotMatch(page, /Socio de Operadora|4,321/)
    assert.match(page, /No se pudieron cargar los cobros/)
    const cards = p.renderer.root.findByProps({ 'aria-label': 'Indicadores operativos' }).children
    for (const card of cards.slice(1)) {
      assert.match(text(card), /—No disponible/)
      assert.doesNotMatch(text(card), /\$0/)
    }
  } finally { p.unmount() }
})

test('foreign-currency income is marked partial and never displayed as an MXN amount', async () => {
  const p = await mountPage({ fetchActivity: async () => ({ legacyIncome: false, cash: [], incidents: [], income: [incomeRow(), incomeRow({ currency: 'USD', paid_amount: 9000 })] }) })
  try {
    const top = text(p.renderer.root.findByProps({ 'aria-label': 'Indicadores operativos' }))
    assert.match(top, /Cobrado en el mes\$20 \(parcial\)/)
    assert.doesNotMatch(top, /9,000|9,020/)
    assert.match(p.section('sec-activity'), /1 cobros en otra moneda o sin moneda/)
    assert.match(p.section('sec-activity'), /Cobros registrados/)
  } finally { p.unmount() }
})
