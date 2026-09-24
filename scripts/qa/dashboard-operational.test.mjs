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

test('coverage totals are subsets, and failed or incomplete global reports never fall back to the old understated budget', async () => {
  const rows = [budgetRow({ paid_amount: 116, non_budget_used: 100, payroll_used: 75 }), budgetRow({ budget_month: '2026-10-01', paid_amount: 99 })]
  assert.deepEqual(logic.aggregateBudgetCoverage(rows, month), {
    paid: 116, nonBudget: 100, payroll: 75,
    historicalMonths: 0, fluxMonths: 1, sourceMode: 'flux',
  })
  assert.equal(logic.aggregateBudget(rows, categories, month).totals.used, 700)
  for (const result of [{ data: null, error: new Error('unavailable') }, { data: [budgetRow({ unconverted_count: 1 })], error: null }]) {
    const supabase = { rpc: async () => result, from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }) }
    const api = load(`${dashboardPath}api.ts`, { '../../lib/supabase': { supabase }, '../../lib/tenantConfig': tenantConfig, './logic': logic })
    await assert.rejects(() => api.fetchBudgetAvailability('operadora', 2026))
  }
})

test('historical rows keep Por clasificar separate from Sin partida and expose source mode', () => {
  const rows = [
    budgetRow({
      budget_category_id: null, classification: 'por_clasificar', data_source: 'historical',
      budgeted: 0, committed: 40, executed: 40, available: -40,
    }),
    budgetRow({
      budget_category_id: null, classification: 'sin_partida', data_source: 'historical',
      budgeted: 0, committed: 60, executed: 60, available: -60,
    }),
  ]
  const result = logic.aggregateBudget(rows, categories, month)
  assert.equal(result.totals.used, 100)
  assert.equal(result.totals.executed, 100)
  assert.equal(result.totals.committed, 0)
  assert.equal(result.partidas.length, 2)
  assert.deepEqual(
    result.partidas.map(row => [row.name, row.classification]).sort(),
    [['Por clasificar', 'por_clasificar'], ['Sin partida', 'sin_partida']].sort(),
  )
  assert.ok(result.partidas.every(row => row.over === false))
  assert.deepEqual(logic.aggregateBudgetCoverage(rows, month), {
    paid: 0, nonBudget: 0, payroll: 0,
    historicalMonths: 1, fluxMonths: 0, sourceMode: 'historical',
  })
})

test('budget API falls back to v1 only when v2 is not deployed', async () => {
  const calls = []
  const supabase = {
    rpc: async name => {
      calls.push(name)
      if (name === 'dashboard_global_budget_report_v2') return { data: null, error: { code: 'PGRST202', message: 'missing' } }
      return { data: [budgetRow()], error: null }
    },
    from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
  }
  const api = load(`${dashboardPath}api.ts`, { '../../lib/supabase': { supabase }, '../../lib/tenantConfig': tenantConfig, './logic': logic })
  const result = await api.fetchBudgetAvailability('operadora', 2026)
  assert.deepEqual(calls, ['dashboard_global_budget_report_v2', 'dashboard_global_budget_report'])
  assert.equal(result.rows.length, 1)

  calls.length = 0
  supabase.rpc = async name => {
    calls.push(name)
    return { data: null, error: { code: '42501', message: 'denied' } }
  }
  await assert.rejects(() => api.fetchBudgetAvailability('operadora', 2026))
  assert.deepEqual(calls, ['dashboard_global_budget_report_v2'])
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
  assert.equal(october.partidas[0].over, false)
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
  const supabase = { async rpc(name, args) {
    assert.equal(name, 'dashboard_global_budget_report_v2')
    assert.deepEqual(args, { p_company_id: 'operadora', p_year: 2026 })
    return { data: data.budget_availability.filter(row => row.company_id === args.p_company_id && row.budget_month.startsWith(String(args.p_year))), error: null }
  }, from(table) {
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

async function mountPage({ fetchBudget, fetchRequests, fetchActivity, pathname = '/dashboard', initialCompanyId = 'operadora' } = {}) {
  let companyId = initialCompanyId
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
    '../../lib/company': { useCompany: () => ({ companyId, companyName: companyId === 'operadora' || companyId === tenantConfig.LEGACY_INCOME_COMPANY_IDS[0] ? 'Operadora QA' : 'Fersana QA' }) },
    '../../lib/tenantConfig': { ...tenantConfig, usesPropertyIncidents: id => tenantConfig.usesPropertyIncidents(id === 'operadora' ? tenantConfig.LEGACY_INCOME_COMPANY_IDS[0] : id) },
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
    // El desglose canónico global conserva el monto comprometido/pendiente ($200) y el saldo ($300),
    // ahora con las etiquetas de la tabla compacta: "Comprometido por pagar" y "Saldo restante".
    assert.match(p.section('sec-budget'), /Comprometido por pagar\$200/)
    assert.match(p.section('sec-budget'), /Saldo restante\$300/)
    assert.doesNotMatch(p.section('sec-budget'), /Sobregirado ·/)
    // Por partida, el pendiente de pago ($200) y el disponible ($300) se muestran SOLO al expandir la
    // fila (rediseño compacto). Se expande y se sigue verificando el dato, no se elimina la aserción.
    await act(async () => {
      p.renderer.root.findAll(node => typeof node.props?.className === 'string' && node.props.className.split(' ')[0] === 'budgetTr')[0].props.onClick()
    })
    assert.match(p.section('sec-budget'), /pendiente de pago\$200/)
    assert.match(p.section('sec-budget'), /Disponible\$300/)
    assert.match(p.section('sec-taxes'), /IVA registrado/)
    assert.match(p.section('sec-taxes'), /Retenciones registradas/)
    assert.doesNotMatch(p.section('sec-taxes'), /acreditable|por enterar|tax_amount|withholding_amount/)
  } finally { p.unmount() }
})

test('global overrun is visible in headline, alerts and details while gross paid remains separate', async () => {
  const p = await mountPage({ fetchBudget: async () => ({ rows: [budgetRow({ budgeted: 1000, committed: 1200, executed: 1000, available: -200, paid_amount: 1160, non_budget_used: 400, payroll_used: 300 })], categories }) })
  try {
    const page = text(p.renderer.toJSON())
    assert.match(page, /Consumo global del presupuesto\$1,200/)
    assert.match(page, /Saldo restante: -\$200/)
    assert.match(page, /\$200de excedente sobre el presupuesto global/)
    assert.match(p.section('sec-budget'), /Pagado registrado en Flux\$1,160/)
    assert.match(p.section('sec-budget'), /Comprometido por pagar\$200/)
    assert.doesNotMatch(page, /Sin alertas destacadas/)
  } finally { p.unmount() }
})

test('unallocated categories remain in global consumption but never appear as category overruns', async () => {
  const rows = [budgetRow({ budgeted: 1000, committed: 1129, executed: 1129, available: -129 }),
    budgetRow({ budget_category_id: 'unallocated', budgeted: 0, committed: 300, executed: 300, available: -300 })]
  const result = logic.aggregateBudget(rows, categories, month)
  assert.equal(result.totals.used, 1429)
  assert.equal(result.totals.available, -429)
  assert.equal(result.partidas.filter(p => p.over).length, 1)
  assert.equal(result.partidas[0].categoryId, 'qa')
  const p = await mountPage({ fetchBudget: async () => ({ rows, categories }) })
  try {
    const dataRow = (name) => p.renderer.root.findAll(node => typeof node.props?.className === 'string' && node.props.className.split(' ')[0] === 'budgetTr' && text(node).includes(name))[0]
    const over = dataRow('Servicios QA')
    const unallocated = dataRow('Sin partida')
    // Sobregiro real: la tabla compacta lo marca con la flecha ↑ + el % USADO total (112.9%, no el
    // excedente 12.9%) y el estado sobregirado (clase de tono "alert"), no con el texto "por encima".
    assert.match(text(over), /↑ 112\.9%/)
    assert.ok(over.props.className.includes('alert'))
    // "Sin partida" (sin asignar) nunca cuenta como sobregiro de partida: se muestra como "s/p" en la
    // columna de % y no lleva ningún indicador de exceso (flecha, "Sobregirado", disponible negativo).
    assert.match(text(unallocated), /s\/p/)
    assert.doesNotMatch(text(unallocated), /Sobregirado|Disponible|%|↑|-\$300/)
    assert.equal(unallocated.findAll(node => node.props?.role === 'img').length, 0)
    // Al expandir, el detalle confirma el excedente real ($129) y que el gasto sin presupuesto consume
    // el saldo global pero "no genera sobregiro de partida".
    for (const name of ['Servicios QA', 'Sin partida']) {
      await act(async () => { dataRow(name).props.onClick() })
    }
    const section = p.section('sec-budget')
    assert.match(section, /Excedente\$129/)
    assert.match(section, /no genera sobregiro de partida/)
    assert.match(text(p.renderer.toJSON()), /1partida sobregirada/)
  } finally { p.unmount() }
})

test('budget delta handles small overruns and exact budget without a false zero-percent overrun', async () => {
  // La tabla compacta expresa el % como % USADO total. Un sobregiro (aun mínimo, 100.001%) debe
  // marcarse como sobregirado (flecha ↑ + estado "alert"); el gasto EXACTO al 100% no debe marcarse
  // como sobregiro falso (sin flecha, sin estado alert), mostrando "100.0%" pero no un exceso.
  for (const { used, pctLabel, over } of [
    { used: 1039, pctLabel: '103.9%', over: true },
    { used: 1000.01, pctLabel: '100.0%', over: true },
    { used: 1000, pctLabel: '100.0%', over: false },
  ]) {
    const p = await mountPage({ fetchBudget: async () => ({ rows: [budgetRow({ budgeted: 1000, committed: used, executed: used, available: 1000-used })], categories }) })
    try {
      const row = p.renderer.root.findAll(node => typeof node.props?.className === 'string' && node.props.className.split(' ')[0] === 'budgetTr')[0]
      assert.ok(text(row).includes(pctLabel))
      if (over) {
        assert.match(text(row), new RegExp(`↑ ${pctLabel.replace('.', '\\.')}`))
        assert.ok(row.props.className.includes('alert'))
      } else {
        assert.doesNotMatch(text(row), /↑/)
        assert.ok(!row.props.className.includes('alert'))
      }
    } finally { p.unmount() }
  }
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
    // Sin embudo: la tabla (única representación) muestra la fila Pagada con su conteo y monto.
    assert.match(p.section('sec-requests'), /Pagada1\$100/)
    await act(async () => p.renderer.root.findByProps({ 'aria-label': 'Periodo del resumen' }).props.onChange({ target: { value: 'all' } }))
    assert.match(text(p.renderer.toJSON()), /Resumen anual.*2025.*Cobros, incidencias y solicitudes por atender.*Marzo de 2025.*Efectivo muestra el saldo actual/)
    await act(async () => p.renderer.root.findByProps({ 'aria-label': 'Periodo del resumen' }).props.onChange({ target: { value: '2025-10-01' } }))
    assert.equal(p.renderer.root.findByProps({ 'aria-label': 'Mes operativo' }).props.value, '2025-10')
    assert.match(p.section('sec-requests'), /Sin solicitudes/)
  } finally { p.unmount() }
})

test('month field opens on click or keyboard in both companies and preserves native fallback without changing the period', async () => {
  const p = await mountPage()
  try {
    for (const company of ['operadora', 'fersana']) {
      await p.switchCompany(company)
      const input = p.renderer.root.findByProps({ 'aria-label': 'Mes operativo' })
      const previousPeriod = input.props.value
      const callsBefore = p.calls.length
      let opened = 0
      const currentTarget = { showPicker() { opened++ } }
      // A click on the text and a touch-generated click use the same user-activation handler.
      input.props.onClick({ currentTarget })
      assert.equal(opened, 1)
      let prevented = 0
      for (const event of [{ key: 'Enter' }, { key: ' ' }, { key: 'ArrowDown', altKey: true }]) {
        input.props.onKeyDown({ ...event, currentTarget, preventDefault() { prevented++ } })
      }
      assert.equal(opened, 4)
      assert.equal(prevented, 3)
      input.props.onKeyDown({ key: 'ArrowRight', currentTarget, preventDefault() { throw new Error('Native month editing must remain available') } })
      assert.equal(opened, 4)
      for (const fallback of [{}, { showPicker() { throw new Error('Picker unavailable') } }]) {
        assert.doesNotThrow(() => input.props.onClick({ currentTarget: fallback }))
        input.props.onKeyDown({ key: 'Enter', currentTarget: fallback, preventDefault() { throw new Error('Native fallback must remain available') } })
      }
      assert.equal(p.renderer.root.findByProps({ 'aria-label': 'Mes operativo' }).props.value, previousPeriod)
      assert.equal(p.calls.length, callsBefore, 'Opening or cancelling the picker must not refresh or change the period')
    }
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

test('cash renders as a Solicitudes-style summary + table (concepto · cantidad · monto), not a hero', async () => {
  // Fechas explícitas (pasado / futuro lejano) para que "vencidos" sea determinista sin importar la fecha de ejecución.
  const p = await mountPage({ fetchActivity: async () => ({ legacyIncome: true, income: [], incidents: [], cash: [
    cashRow({ due_date: '2000-01-01' }),                                     // activo · por comprobar · vencido
    cashRow({ id: 'review', status: 'receipt_review', due_date: '2999-12-31' }), // activo · en revisión · NO vencido
    cashRow({ id: 'closed', status: 'closed', assigned_amount: 1000 }),      // cerrado: excluido de fondos activos
  ] }) })
  try {
    const section = p.section('sec-cash')
    // Resumen accionable estilo Solicitudes (fondos activos · por comprobar · vencidos).
    assert.match(section, /2fondos activos/)
    assert.match(section, /\$160 por comprobar/)
    assert.match(section, /1 vencido/)
    // Tabla concepto · cantidad · monto (ya no el héroe cash).
    assert.match(section, /ConceptoCantidadMonto/)
    assert.match(section, /Fondos activos2\$200/)          // count active · entregado
    assert.match(section, /Con saldo por comprobar2\$160/) // count pending · pendingAmount
    assert.match(section, /En revisión1/)                  // inReview count
    assert.match(section, /Vencidos1/)                     // overdue count, tono de atención
    // Datos entregado/comprobado preservados en la nota; el héroe anterior desaparece.
    assert.match(section, /Entregado \$200 · comprobado \$40/)
    assert.doesNotMatch(section, /Monto comprobado/)       // etiqueta del héroe anterior
    // Invariantes: importe por comprobar no se duplica y los vencidos no se doble-cuentan.
    assert.equal(section.match(/\$160/g).length, 2)        // solo en resumen y en la fila "por comprobar"
    assert.match(section, /no se suman de nuevo/)
    assert.match(section, /Ver módulo completo/)
  } finally { p.unmount() }
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
  assert.deepEqual(fersana.incidents, [])
  assert.ok(calls.slice(before).every(call => call.filters.some(([filter, key, value]) => filter === 'eq' && key === 'company_id' && value === fer)))
  assert.ok(calls.slice(before).every(call => !['maintenance_fee_charges', 'incident_charges'].includes(call.table)), 'Fersana never queries Operadora fees or property incidents')
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
    // Héroe rediseñado: usado de presupuestado + saldo restante (mismos importes canónicos).
    assert.match(section, /\$1,400usado de \$2,000/)
    assert.match(section, /Saldo restante\$600/)
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
    assert.match(top, /Consumo global del presupuesto\$700.*de \$1,000 presupuestado/)
    assert.doesNotMatch(top, /8,888|bloqueos de cierre/)
    assert.doesNotMatch(text(p.renderer.toJSON()), /Cerrar periodo|Checklist de cierre/)
    const chart = p.renderer.root.findByType('figure').props['data-chart']
    assert.equal(chart.rightTitle, 'Ingresos')
    assert.deepEqual(chart.series.map(series => series.kind), ['bar', 'bar', 'line', 'line'])
    assert.deepEqual(chart.series.slice(0, 2).map(series => series.data.at(-1)), [1000, 700])
    assert.match(p.section('sec-budget'), /\$700usado de \$1,000/)
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

test('Fersana omits every incident surface and falls back to cash when switching from Operadora incidents', async () => {
  const op = '9680353c-9b86-4730-82e1-fce664f048a2'
  const fer = '68b61801-74c0-44ea-a33b-f20e4bf53aa7'
  const waiting = deferred()
  const activity = { legacyIncome: false, cash: [], income: [], incidents: [{ id: 'incident', status: 'open', incident_date: '2026-09-02' }] }
  const p = await mountPage({
    initialCompanyId: op,
    fetchActivity: async id => id === fer ? waiting.promise : { ...activity, legacyIncome: true },
    fetchBudget: async id => ({ rows: [budgetRow(id === fer ? { budgeted: 641845.50, committed: 596, executed: 0, available: 641249.50 } : {})], categories }),
  })
  const cards = () => p.renderer.root.findByProps({ 'aria-label': 'Indicadores operativos' }).findAll(node => node.type === 'div' && node.props.className?.split(' ').includes('kpiCard'))
  const assertNoIncidents = () => {
    assert.doesNotMatch(text(p.renderer.toJSON()), /incidencias/i)
    assert.equal(cards().length, 3)
    assert.match(text(p.renderer.toJSON()), /Efectivo y comprobaciones/)
  }
  try {
    assert.equal(cards().length, 4)
    assert.match(text(p.renderer.toJSON()), /Incidencias pendientes/)
    act(() => p.renderer.root.findAllByType('button').find(button => text(button) === 'Incidencias').props.onClick())
    assert.match(text(p.renderer.toJSON()), /Incidencias del mes/)
    await p.switchCompany(fer)
    assertNoIncidents()
    // Even unexpected incident rows cannot surface in a company where they do not apply.
    await act(async () => waiting.resolve(activity))
    assertNoIncidents()
    assert.match(text(cards()[0]), /Consumo global del presupuesto\$596/)
    const chart = p.renderer.root.findByType('figure').props['data-chart']
    assert.equal(chart.presentation, 'operational')
    assert.deepEqual(chart.series.map(row => row.kind), ['bar', 'bar', 'line', 'line'])
    assert.deepEqual(chart.series.slice(0, 2).map(row => row.data.at(-1)), [641845.50, 596])
    await act(async () => p.renderer.root.findByProps({ 'aria-label': 'Periodo del resumen' }).props.onChange({ target: { value: 'all' } }))
    assertNoIncidents()
    await p.switchCompany(op)
    assert.equal(cards().length, 4)
    assert.match(text(p.renderer.toJSON()), /Incidencias del mes/)
    assert.match(p.section('sec-activity'), /Incidencias pendientes del mes1/)
  } finally { p.unmount() }
})

test('foreign-currency income is marked partial and never displayed as an MXN amount', async () => {
  const p = await mountPage({ fetchActivity: async () => ({ legacyIncome: false, cash: [], incidents: [], income: [incomeRow(), incomeRow({ currency: 'USD', paid_amount: 9000 })] }) })
  try {
    const top = text(p.renderer.root.findByProps({ 'aria-label': 'Indicadores operativos' }))
    assert.match(top, /Ingreso cobrado en el mes\$20 \(parcial\)/)
    assert.doesNotMatch(top, /9,000|9,020/)
    assert.match(p.section('sec-activity'), /1 cobros en otra moneda o sin moneda/)
    assert.match(p.section('sec-activity'), /Cobros registrados/)
  } finally { p.unmount() }
})

test('restored income lines use scoped monthly data, preserve genuine zeros and omit incomplete currency months', async () => {
  const p = await mountPage({ fetchActivity: async id => ({ legacyIncome: id === 'operadora', cash: [], incidents: [], income: id === 'operadora'
    ? [incomeRow(), incomeRow({ period: '2026-08', expected_amount: 700, paid_amount: 350 }), incomeRow({ period: '2026-07', currency: 'USD' })]
    : [incomeRow({ expected_amount: 30, paid_amount: 15 })] }) })
  try {
    const chart = () => p.renderer.root.findByType('figure').props['data-chart']
    assert.deepEqual(chart().series[2].data, [0, 0, 0, 0, 0, 0, null, 700, 100])
    assert.deepEqual(chart().series[3].data, [0, 0, 0, 0, 0, 0, null, 350, 20])
    assert.equal(chart().series[2].dashed, true)
    assert.equal(chart().series[3].axis, 'y2')
    assert.match(text(p.renderer.toJSON()), /sin conversión completa a MXN se muestran sin punto/)
    await p.switchCompany('fersana')
    assert.deepEqual(chart().series[2].data, [0, 0, 0, 0, 0, 0, 0, 0, 30])
    assert.equal(chart().series[3].data.at(-1), 15)
  } finally { p.unmount() }
})

test('income query failure leaves gaps instead of zeroes while retaining the budget chart', async () => {
  const p = await mountPage({ fetchActivity: async () => { throw new Error('Unavailable') } })
  try {
    const chart = p.renderer.root.findByType('figure').props['data-chart']
    assert.ok(chart.series[2].data.every(value => value === null))
    assert.ok(chart.series[3].data.every(value => value === null))
    assert.equal(chart.series[1].data.at(-1), 700)
    assert.match(text(p.renderer.toJSON()), /Ingresos no disponibles/)
  } finally { p.unmount() }
})

function mountChart(width = 1440, months = 9, overrides = {}) {
  const css = new Proxy({}, { get: (_, key) => String(key) })
  const { ComboChart } = load(`${dashboardPath}charts.tsx`, { './Dashboard.module.css': { __esModule: true, default: css } })
  const chartBox = { clientWidth: width, clientHeight: 288, getBoundingClientRect: () => ({ left: 0, top: 0 }) }
  const tooltipBox = { clientWidth: Math.min(260, width - 12), clientHeight: 152 }
  const previousObserver = globalThis.ResizeObserver
  const observers = new Map()
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback }
    observe(element) { this.element = element; if (!observers.has(element)) observers.set(element, new Set()); observers.get(element).add(this.callback) }
    disconnect() { observers.get(this.element)?.delete(this.callback) }
  }
  const labels = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'].slice(0, months)
  const series = [
    { kind: 'bar', label: 'Presupuesto', data: labels.map(() => 861700.58), color: '#72998a' },
    { kind: 'bar', label: 'Usado', data: labels.map(() => 36249.97), color: '#3c725d' },
    { kind: 'line', label: 'Ingreso esperado', data: labels.map(() => 2858856), color: '#168a86', axis: 'y2', dashed: true },
    { kind: 'line', label: 'Ingreso cobrado', data: labels.map(() => 0), color: '#007c50', axis: 'y2' },
  ]
  let renderer
  const props = { labels, series, leftTitle: 'Presupuesto y uso', rightTitle: 'Ingresos', presentation: 'operational', ...overrides }
  act(() => { renderer = create(React.createElement(ComboChart, props), {
    createNodeMock: element => element.props.className === 'chartTooltip' ? tooltipBox : chartBox,
  }) })
  const wrapper = () => renderer.root.findAllByType('div').find(node => typeof node.props.onMouseMove === 'function')
  return {
    renderer, chartBox, tooltipBox, props,
    update(next) { act(() => renderer.update(React.createElement(ComboChart, { ...props, ...next }))) },
    move(x, y) { act(() => wrapper().props.onMouseMove({ clientX: x, clientY: y, currentTarget: chartBox })) },
    resize(w, tooltipWidth, tooltipHeight) {
      act(() => {
        chartBox.clientWidth = w; tooltipBox.clientWidth = tooltipWidth; tooltipBox.clientHeight = tooltipHeight
        for (const callback of [...(observers.get(chartBox) || []), ...(observers.get(tooltipBox) || [])]) callback()
      })
    },
    tooltip() { return renderer.root.findByProps({ className: 'chartTooltip' }) },
    unmount() { act(() => renderer.unmount()); globalThis.ResizeObserver = previousObserver },
  }
}

test('chart tooltip remains fully inside both axes at the edges and after resizing, including its four amounts', () => {
  const p = mountChart()
  const fits = () => {
    const { left, top } = p.tooltip().props.style
    assert.ok(left >= 0 && top >= 0)
    assert.ok(left + p.tooltipBox.clientWidth <= p.chartBox.clientWidth, 'tooltip must not overflow horizontally')
    assert.ok(top + p.tooltipBox.clientHeight <= p.chartBox.clientHeight, 'tooltip must not overflow vertically')
    assert.match(text(p.tooltip()), /Presupuesto: \$861,700\.58/)
    assert.match(text(p.tooltip()), /Usado: \$36,249\.97/)
    assert.match(text(p.tooltip()), /Ingreso esperado: \$2,858,856\.00/)
    assert.match(text(p.tooltip()), /Ingreso cobrado: \$0\.00/)
  }
  try {
    p.move(1360, 287); fits()
    p.move(76, 1); fits()
    p.resize(700, 252, 190)
    p.move(618, 287); fits()
    p.move(76, 1); fits()
  } finally { p.unmount() }
})

test('mobile splits axes into two charts, browses every month, and exposes exact amounts without hover', () => {
  const p = mountChart(280, 12)
  try {
    const root = p.renderer.root
    assert.equal(root.findAllByType('svg').length, 2)
    const select = () => root.findByType('select')
    assert.equal(select().findAllByType('option').length, 12)
    assert.equal(select().props.value, 11)
    const button = label => root.findByProps({ 'aria-label': label })
    assert.equal(button('Ver meses siguientes').props.disabled, true)
    const months = () => root.findAllByType('svg')[0].findAllByType('text').map(text).filter(value => /^(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)$/.test(value))
    assert.deepEqual(months(), ['sep', 'oct', 'nov', 'dic'])
    assert.equal(root.findAllByProps({ className: 'chartTooltip' }).length, 0)
    assert.match(text(root.findByType('dl')), /\$861,700\.58/)
    assert.match(text(root.findByType('dl')), /\$0\.00/)
    act(() => button('Ver meses anteriores').props.onClick())
    assert.deepEqual(months(), ['may', 'jun', 'jul', 'ago'])
    act(() => button('Ver meses anteriores').props.onClick())
    assert.deepEqual(months(), ['ene', 'feb', 'mar', 'abr'])
    assert.equal(button('Ver meses anteriores').props.disabled, true)
    act(() => button('Ver meses siguientes').props.onClick())
    assert.deepEqual(months(), ['may', 'jun', 'jul', 'ago'])
    act(() => select().props.onChange({ target: { value: '11' } }))
    assert.deepEqual(months(), ['sep', 'oct', 'nov', 'dic'])
    const plot = root.findAllByType('div').find(node => typeof node.props.onClick === 'function')
    act(() => plot.props.onClick({ clientX: 65, clientY: 100, currentTarget: p.chartBox }))
    assert.equal(select().props.value, 8, 'tap selects the same month for both plots and detail')
    for (const svg of root.findAllByType('svg')) {
      assert.equal(svg.props.width, 280)
      for (const rect of svg.findAllByType('rect')) {
        assert.ok(rect.props.width >= 16, 'bars remain readable on a narrow phone')
        assert.ok(rect.props.x >= 0 && rect.props.x + rect.props.width <= 280)
      }
    }
  } finally { p.unmount() }
})

test('mobile keeps missing income distinct from zero, refreshes company data and survives resizing and period changes', () => {
  const p = mountChart(320, 9)
  try {
    const root = p.renderer.root
    const replacement = p.props.series.map((se, i) => ({ ...se, data: se.data.map(() => i === 2 ? null : 0) }))
    p.update({ series: replacement })
    const detail = text(root.findByType('dl'))
    assert.match(detail, /esperadoSin datos/i)
    assert.match(detail, /cobrado\$0\.00/i)
    assert.doesNotMatch(detail, /861,700/)
    p.resize(1000, 260, 152)
    assert.equal(root.findAllByType('svg').length, 1)
    assert.equal(root.findAllByType('select').length, 0)
    p.resize(320, 260, 152)
    assert.equal(root.findAllByType('svg').length, 2)
    p.update({ labels: ['ene'], series: replacement.map(se => ({ ...se, data: [0] })) })
    assert.equal(root.findByType('select').props.value, 0)
    for (const button of root.findAllByType('button')) assert.equal(button.props.disabled, true)
  } finally { p.unmount() }
})

test('mobile historical single-axis chart remains navigable and preserves the full-period scale', () => {
  const p = mountChart(280, 12, { presentation: undefined, series: [{ kind: 'bar', label: 'Egresos', data: [900000, ...Array(11).fill(100)], color: '#72998a' }] })
  try {
    const root = p.renderer.root
    assert.equal(root.findAllByType('svg').length, 1)
    assert.match(text(root.findByType('svg')), /\$1000k/)
    act(() => root.findByType('select').props.onChange({ target: { value: '0' } }))
    assert.match(text(root.findByType('dl')), /\$900,000\.00/)
    assert.match(text(root.findByType('svg')), /\$1000k/)
  } finally { p.unmount() }
})
