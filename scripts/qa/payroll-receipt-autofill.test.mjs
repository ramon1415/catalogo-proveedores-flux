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
const { jsPDF } = createRequire(resolve(root, 'package.json'))('jspdf')
const pdfjs = require(resolve(root, 'pdfjs-3.11.174.min.js'))
pdfjs.GlobalWorkerOptions.workerSrc = resolve(root, 'pdfjs-worker-3.11.174.min.js')
const feature = 'app/src/features/nomina/'

function load(path, imports = {}, globals = {}) {
  const source = readFileSync(resolve(root, path), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  }, fileName: path })
  const module = { exports: {} }
  const dependency = (name) => {
    if (Object.hasOwn(imports, name)) return imports[name]
    if (name.startsWith('react')) return require(name)
    throw new Error(`Unexpected dependency: ${name}`)
  }
  new Function('require', 'module', 'exports', 'window', 'document', outputText)(dependency, module, module.exports, globals.window, globals.document)
  return module.exports
}

const amounts = load(feature + 'receiptAmount.ts')
const fields = load(feature + 'receiptFields.ts', { './receiptAmount.ts': amounts })
const friendly = load(feature + 'logic.ts', { './speiParser': {} })
// Resolve the same vendored worker from disk in Node, instead of the browser URL.
const pdfReader = load('app/src/lib/pdfText.ts', {}, { window: { pdfjsLib: {
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (options) => {
    pdfjs.GlobalWorkerOptions.workerSrc = resolve(root, 'pdfjs-worker-3.11.174.min.js')
    return pdfjs.getDocument(options)
  },
} } })
const empty = { amount: '', paymentDate: '', reference: '', currency: null }
const lines = (amount = '100.00', reference = 'REF-001', date = '08/09/2026') => [
  `Importe: $ ${amount} MXN`, `Fecha de pago: ${date}`, `Referencia: ${reference}`,
]
const file = (name = 'receipt.pdf') => new File([new Uint8Array(200)], name, { type: 'application/pdf' })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('BBVA, SPEI and TOKA: actual PDF bytes populate amount, payment date and reference', async () => {
  const cases = [
    { lines: ['BBVA México', 'Importe: $ 1,234.56 MXN', 'Fecha de aplicación: 08/09/2026', 'Folio único: BBVA-000001'], expected: { amount: '1234.56', paymentDate: '2026-09-08', reference: 'BBVA-000001', currency: 'MXN' } },
    { lines: ['SPEI', 'Monto del pago: 150.00 MXN', 'Fecha de operación: 8 de septiembre de 2026', 'Clave de rastreo: 0001234567890123456789012345', 'Referencia: 0000001'], expected: { amount: '150.00', paymentDate: '2026-09-08', reference: '0001234567890123456789012345', currency: 'MXN' } },
    { lines: ['TOKA', 'Total pagado: MXN 51,16', 'Fecha de pago: 2026-09-08', 'Referencia bancaria: QA-TOKA-20260908'], expected: { amount: '51.16', paymentDate: '2026-09-08', reference: 'QA-TOKA-20260908', currency: 'MXN' } },
  ]
  for (const item of cases) {
    const pdf = new jsPDF()
    pdf.text(item.lines, 20, 20)
    const document = new File([pdf.output('arraybuffer')], 'synthetic-receipt.pdf', { type: 'application/pdf' })
    const extracted = await pdfReader.extractPdfLines(document)
    assert.deepEqual(fields.parseReceiptFields(extracted), item.expected)
  }
})

test('row layout, inline labels and split values retain the correct labelled data', () => {
  assert.deepEqual(fields.parseReceiptFields(['Importe: $ 100.00 MXN Fecha de pago: 08/09/2026 Referencia: 000123']), {
    amount: '100.00', paymentDate: '2026-09-08', reference: '000123', currency: 'MXN',
  })
  assert.deepEqual(fields.parseReceiptFields(['Importe:', '100.00 MXN', 'Fecha de aplicación:', '08/sep/2026', 'Folio único:', 'ABC-123']), {
    amount: '100.00', paymentDate: '2026-09-08', reference: 'ABC-123', currency: 'MXN',
  })
})

test('period, UAT date, balances, accounts and unrelated numbers are never payment defaults', () => {
  assert.deepEqual(fields.parseReceiptFields([
    'Periodo: 01/09/2026 al 15/09/2026', 'UAT 08/09/2026', 'Saldo: $ 100.00',
    'Cuenta origen: 000123456789', 'Fecha de impresión: 09/09/2026',
  ]), empty)
})

test('conflicting payments stay blank; an explicit channel total takes priority over line items', () => {
  const mixed = [...lines('100.00', 'REF-1'), ...lines('150.00', 'REF-2')]
  assert.deepEqual(fields.parseReceiptFields(mixed), { ...empty, paymentDate: '2026-09-08', currency: 'MXN' })
  assert.equal(fields.parseReceiptFields(['Importe total: $ 250.00', ...mixed]).amount, '250.00')
  assert.equal(fields.parseReceiptFields(['Importe total: N/A', ...lines()]).amount, '')
  assert.equal(fields.parseReceiptFields([...lines(), 'Fecha de pago: 10/09/2026']).paymentDate, '')
  assert.equal(fields.parseReceiptFields(['Importe: 100.00 MXN Importe: 150.00 MXN']).amount, '')
  assert.equal(fields.parseReceiptFields(['Importe: 100.00 150.00 MXN']).amount, '')
})

test('amounts use exact cents and dates reject invalid calendars', () => {
  for (const value of ['-100.00', '100.001', '1,00,0.00', '0', 'NaN', '1e2', '90071992547409.92']) {
    assert.equal(fields.parseReceiptFields([`Importe: ${value}`]).amount, '', value)
  }
  assert.equal(fields.parseReceiptFields(['Monto: 1.234,56 EUR']).amount, '1234.56')
  for (const date of ['31/02/2026', '29/02/2026', '13/13/2026', '2026-00-01']) assert.equal(fields.parseReceiptFields([`Fecha de pago: ${date}`]).paymentDate, '')
  assert.equal(fields.parseReceiptFields(['Fecha de pago: 29/02/2028']).paymentDate, '2028-02-29')
  assert.equal(fields.parseReceiptFields(['Fecha de pago: 08/09/2026', 'Fecha de impresión: 09/09/2026']).paymentDate, '2026-09-08')
  assert.equal(fields.parseReceiptFields(['Importe: 100.00 USD']).currency, 'USD')
})

test('invalid PDFs and receipts over the page limit cannot produce partial suggestions', async () => {
  await assert.rejects(pdfReader.extractPdfLines(file()), /invalid_pdf_signature/)
  const pdf = new jsPDF()
  pdf.text(lines(), 20, 20)
  pdf.addPage()
  pdf.text(lines('150.00'), 20, 20)
  const document = new File([pdf.output('arraybuffer')], 'two-pages.pdf', { type: 'application/pdf' })
  await assert.rejects(pdfReader.extractPdfLines(document, 1), /receipt_page_limit/)
  assert.equal(fields.parseReceiptFields(await pdfReader.extractPdfLines(document)).amount, '')
})

async function hookHarness(t, reader) {
  const { useReceiptAutofill } = load(feature + 'useReceiptAutofill.ts', { '../../lib/pdfText': { extractPdfLines: reader }, './receiptFields': fields })
  let result, renderer
  function Harness({ scope }) { result = useReceiptAutofill(scope); return null }
  await act(async () => { renderer = create(React.createElement(Harness, { scope: 'run-a' })) })
  t.after(() => act(() => renderer.unmount()))
  return {
    get current() { return result },
    scope: (scope) => act(async () => renderer.update(React.createElement(Harness, { scope }))),
  }
}

test('replacing a PDF clears old fields and a stale read cannot overwrite the new receipt', async (t) => {
  const first = deferred(), second = deferred()
  const h = await hookHarness(t, (f) => f.name === 'first.pdf' ? first.promise : second.promise)
  let pending1, pending2
  await act(async () => { pending1 = h.current.selectReceipt('bbva', file('first.pdf')) })
  await act(async () => { pending2 = h.current.selectReceipt('bbva', file('second.pdf')) })
  assert.equal(h.current.drafts.bbva.amount, '')
  await act(async () => { first.resolve(lines('999.00')); await pending1 })
  assert.equal(h.current.drafts.bbva.reading, true)
  await act(async () => { second.resolve(lines('100.00')); await pending2 })
  assert.equal(h.current.drafts.bbva.amount, '100.00')
  assert.equal(h.current.drafts.bbva.file.name, 'second.pdf')
})

test('channels remain independent and a new run discards all previous file results', async (t) => {
  const pending = deferred()
  const h = await hookHarness(t, (f) => f.name === 'pending.pdf' ? pending.promise : Promise.resolve(lines('51.16', 'TOKA-1')))
  let read
  await act(async () => { read = h.current.selectReceipt('bbva', file('pending.pdf')) })
  await act(async () => { await h.current.selectReceipt('toka', file()) })
  assert.equal(h.current.drafts.bbva.reading, true)
  assert.equal(h.current.drafts.toka.amount, '51.16')
  await h.scope('run-b')
  await act(async () => { pending.resolve(lines()); await read })
  assert.deepEqual(h.current.drafts, {})
})

test('removal and invalid replacement clear old facts; unreadable receipts allow explicit correction', async (t) => {
  const h = await hookHarness(t, (f) => f.name === 'scan.pdf' ? Promise.reject(new Error('image_only')) : Promise.resolve(lines()))
  await act(async () => { await h.current.selectReceipt('bbva', file()) })
  await act(async () => { await h.current.selectReceipt('bbva', file('wrong.txt')) })
  assert.equal(h.current.drafts.bbva.amount, '')
  assert.equal(h.current.drafts.bbva.file, undefined)
  await act(async () => { await h.current.selectReceipt('bbva', file('scan.pdf')) })
  assert.equal(h.current.drafts.bbva.reading, false)
  assert.match(h.current.drafts.bbva.notice, /No pudimos leer/)
  await act(async () => h.current.updateReceipt('bbva', 'amount', '125.25'))
  assert.equal(h.current.drafts.bbva.amount, '125.25')
  await act(async () => h.current.clearReceipt('bbva'))
  assert.equal(h.current.drafts.bbva.file, undefined)
  assert.equal(h.current.drafts.bbva.amount, '')
})

const nodeText = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(nodeText).join('') : node?.props ? nodeText(node.props.children) : ''

async function componentHarness(t, pdfLines, serverError = null) {
  const calls = [], toasts = []
  const summary = { payment_request_id: 'run-a', request_status: 'approved', request_created_date: '2026-09-07', can_close_paid: false, channels: [
    { id: 'bbva', channel: 'same_bank', amount: 100, currency: 'MXN', dispersion_status: 'dispersed', reconciliation_status: 'pending' },
  ] }
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'get_payroll_reconciliation_summary') return { data: summary }
      if (name === 'reserve_payroll_channel_receipt') return { data: { run_file_id: 'receipt-1', storage_bucket: 'private-test', storage_path: 'private/receipt.pdf' } }
      if (name === 'reconcile_payroll_channel' && serverError) return { error: serverError }
      return { data: null }
    },
    storage: { from: () => ({ upload: async () => { calls.push({ name: 'upload' }); return {} } }) },
    functions: { invoke: async () => { calls.push({ name: 'verify' }); return { data: { status: 'verified' } } } },
  }
  const autofill = load(feature + 'useReceiptAutofill.ts', { '../../lib/pdfText': { extractPdfLines: async () => pdfLines }, './receiptFields': fields })
  const { ChannelOperations } = load(feature + 'ChannelOperations.tsx', {
    '../../components/ui/Toast': { useToast: () => ({ showToast: (...args) => toasts.push(args) }) },
    '../../components/ui/icons': load('app/src/components/ui/icons.tsx'),
    '../../lib/supabase': { supabase },
    './logic': { BUCKET: 'private-test', channelLabel: () => 'BBVA', formatMoney: (value) => `$${value}`, friendlyError: friendly.friendlyError },
    './Nomina.module.css': {}, './receiptAmount': amounts, './receiptFields': fields, './useReceiptAutofill': autofill,
    './api': { getReceiptFileUrl: async () => 'unused' },
  })
  let renderer
  await act(async () => { renderer = create(React.createElement(ChannelOperations, { paymentRequestId: 'run-a', canPay: true })) })
  t.after(() => act(() => renderer.unmount()))
  const field = (label) => renderer.root.findAllByType('label').find((node) => nodeText(node).startsWith(label)).findByType('input')
  return { calls, toasts, field, alerts: () => renderer.root.findAllByProps({ role: 'alert' }).map(nodeText),
    upload: () => act(async () => { await field('Comprobante PDF').props.onChange({ target: { files: [file()] } }) }),
    submit: () => act(async () => {
      renderer.root.findAllByType('button').find((node) => nodeText(node).includes('Subir y conciliar')).props.onClick()
      for (let attempt = 0; attempt < 500 && !toasts.length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1))
    }),
  }
}

test('selecting a PDF only prefills; explicit reconciliation sends its extracted facts to the server', async (t) => {
  const h = await componentHarness(t, lines('100.00', 'REF-ORIGINAL', '07/09/2026'))
  assert.equal(h.field('Fecha de pago').props.value, '')
  await h.upload()
  assert.equal(h.field('Importe del comprobante').props.value, '100.00')
  assert.equal(h.field('Fecha de pago').props.value, '2026-09-07')
  assert.equal(h.field('Referencia').props.value, 'REF-ORIGINAL')
  assert.deepEqual(h.calls.map((call) => call.name), ['get_payroll_reconciliation_summary'])
  await h.submit()
  const reconciled = h.calls.find((call) => call.name === 'reconcile_payroll_channel')
  assert.equal(reconciled.args.p_receipt_amount, 100)
  assert.equal(reconciled.args.p_payment_date, '2026-09-07')
  assert.equal(reconciled.args.p_reference_hint, 'REF-ORIGINAL')
  assert.ok(h.calls.findIndex((call) => call.name === 'verify') < h.calls.findIndex((call) => call.name === 'reconcile_payroll_channel'))
})

test('amount and currency mismatches block mutation instead of replacing PDF facts with channel defaults', async (t) => {
  for (const pdfLines of [lines('100.01'), lines().map((line) => line.replace('MXN', 'USD'))]) {
    const h = await componentHarness(t, pdfLines)
    await h.upload()
    await h.submit()
    assert.equal(h.calls.some((call) => call.name === 'reserve_payroll_channel_receipt'), false)
    assert.match(h.toasts.at(-1)[0], /Revisa/)
  }
})

test('dates before creation stay visible with a reason and never reserve or upload a receipt', async (t) => {
  const h = await componentHarness(t, lines('100.00', 'REF-OLD', '06/09/2026'))
  await h.upload()
  await h.submit()
  assert.equal(h.field('Fecha de pago').props.min, '2026-09-07')
  assert.equal(h.field('Fecha de pago').props.max, undefined)
  assert.equal(h.field('Fecha de pago').props.value, '2026-09-06')
  assert.equal(h.calls.some((call) => call.name === 'reserve_payroll_channel_receipt'), false)
  assert.match(h.alerts().join(' '), /no puede ser anterior al 07\/09\/2026/)
})

test('same creation day and distant future are accepted without a today-based cap', async (t) => {
  for (const date of ['2026-09-07', '2026-09-08', '2099-12-31']) {
    const h = await componentHarness(t, lines('100.00', 'REF-DATE', date))
    await h.upload()
    await h.submit()
    assert.equal(h.calls.find((call) => call.name === 'reconcile_payroll_channel').args.p_payment_date, date)
  }
  assert.match(fields.receiptDateError('2026-02-30', '2026-01-01'), /válida/)
  assert.equal(fields.receiptDateError('2100-01-01', '2026-09-07'), null)
})

test('server date rejection remains inline with its authoritative creation date', async (t) => {
  const h = await componentHarness(t, lines(), {
    message: 'PAYROLL_RECONCILIATION_PAYMENT_DATE_BEFORE_REQUEST',
    details: 'La fecha de pago no puede ser anterior al 09/09/2026, fecha de creación de la solicitud.',
  })
  await h.upload()
  await h.submit()
  assert.match(h.alerts().join(' '), /no puede ser anterior al 09\/09\/2026/)
  assert.equal(h.field('Fecha de pago').props.value, '2026-09-08')
  assert.equal(h.field('Referencia').props.value, 'REF-001')
})
