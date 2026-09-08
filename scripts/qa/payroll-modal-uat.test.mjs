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

function load(path, imports) {
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

test('canceling the file picker or reselecting its file preserves the dialog; its own Escape and close button still close it', () => {
  const { Modal } = load('app/src/components/ui/Modal.tsx', { './Modal.module.css': {} })
  let closed = 0, nativeCloses = 0, renderer
  const dialog = { open: false, showModal() { this.open = true }, close() { this.open = false; nativeCloses++ } }
  act(() => { renderer = create(React.createElement(Modal, { title: 'Nómina', onClose: () => closed++ },
    React.createElement('input', { type: 'file' })), { createNodeMock: node => node.type === 'dialog' ? dialog : {} }) })
  try {
    const handler = renderer.root.findByType('dialog').props.onCancel
    for (const files of [[], [new File(['receipt'], 'BBVA.pdf')]]) {
      const input = { type: 'file', files }
      handler({ target: input, currentTarget: dialog, preventDefault() { throw new Error('File cancel is not dialog dismissal') } })
      assert.equal(dialog.open, true)
      assert.equal(closed, 0)
      assert.equal(nativeCloses, 0)
      assert.equal(input.files, files)
    }
    let prevented = false
    handler({ target: dialog, currentTarget: dialog, preventDefault() { prevented = true } })
    assert.equal(prevented, true)
    assert.equal(dialog.open, false)
    assert.equal(closed, 1)
    dialog.showModal()
    renderer.root.findByProps({ 'aria-label': 'Cerrar' }).props.onClick()
    assert.equal(dialog.open, false)
    assert.equal(closed, 2)
  } finally { act(() => renderer.unmount()) }
})

const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : ''
const payrollLogic = load('app/src/features/nomina/logic.ts', { './speiParser': {} })

test('revalidation waits for server state and disappears immediately after the paid refresh', async () => {
  let resolveSummary, currentSummary, renderer, revalidations = 0
  const firstSummary = new Promise(resolve => { resolveSummary = resolve })
  const api = {
    getSubmissionSummary: async () => currentSummary || firstSummary,
    revalidateMaterializedCapture: async () => { revalidations++; return { file_count: 5, employee_record_count: 3, channels: ['banco', 'spei', 'vales'] } },
  }
  const { CaptureModal } = load('app/src/features/nomina/CaptureModal.tsx', {
    '../../components/ui/Modal': { Modal: props => React.createElement('section', null, props.children, props.actions) },
    '../../components/ui/Toast': { useToast: () => ({ showToast() {} }) },
    '../../components/ui/icons': load('app/src/components/ui/icons.tsx', {}),
    '../../lib/supabase': { isDevSupabaseProject: true },
    './api': api, './physicalParsers': {}, './Nomina.module.css': {},
    './ChannelOperations': { ChannelOperations: props => React.createElement('channel-operations', props) },
    './logic': {
      ALL_SLOTS: [], SLOT_CONFIG: {}, accountsForCompany: () => [], costCentersForCompany: () => [],
      validateFilesSourceAccount: payrollLogic.validateFilesSourceAccount, fileValidationMessage: payrollLogic.fileValidationMessage, sourceAccountCandidates: () => [], requiredSlots: () => [], defaultPayrollConcept: () => 'Nómina de prueba',
      formatMoney: value => `$${value}`, channelLabel: String, friendlyError: String,
    },
  })
  const session = { id: 'capture', version: 1, company_id: 'company', materialized_payment_request_id: 'request',
    company_bank_account_id: 'account', cost_center_id: 'center', payroll_subtype: 'ordinaria', period_start: '2026-09-01',
    period_end: '2026-09-15', concept: 'Nómina de prueba', expected_channels: [], files: [] }
  const props = { session, companies: [], accounts: [], costCenters: [], mappings: [], isFinance: true,
    activeCompanyId: 'company', onClose() {}, onSaved() {} }
  const buttons = () => renderer.root.findAllByType('button').filter(node => text(node).includes('Revalidar paquete'))
  try {
    await act(async () => { renderer = create(React.createElement(CaptureModal, props)) })
    assert.equal(buttons().length, 0, 'unknown server status must not expose revalidation')
    await act(async () => {
      currentSummary = { status: 'approved', employee_net: 300, amount_requested: 301.16, channels: [] }
      resolveSummary(currentSummary)
      await firstSummary
    })
    assert.equal(buttons().length, 1)
    await act(async () => { await buttons()[0].props.onClick() })
    assert.equal(revalidations, 1)
    await act(async () => {
      currentSummary = { ...currentSummary, status: 'paid' }
      await renderer.root.findByType('channel-operations').props.onChanged()
    })
    assert.equal(buttons().length, 0)
    assert.ok(renderer.root.findAllByType('p').some(node => text(node).includes('Nómina pagada')))
    act(() => renderer.unmount())
    await act(async () => { renderer = create(React.createElement(CaptureModal, props)) })
    assert.equal(buttons().length, 0, 'reopening a paid capture must remain read-only')
    assert.equal(revalidations, 1)
  } finally { if (renderer) act(() => renderer.unmount()) }
})

test('reopening a paid capture keeps the server totals for all five files and uses the correct count labels', async () => {
  const { CaptureModal } = load('app/src/features/nomina/CaptureModal.tsx', {
    '../../components/ui/Modal': { Modal: props => React.createElement('section', null, props.children, props.actions) },
    '../../components/ui/Toast': { useToast: () => ({ showToast() {} }) },
    '../../components/ui/icons': load('app/src/components/ui/icons.tsx', {}),
    '../../lib/supabase': { isDevSupabaseProject: true },
    './api': { getSubmissionSummary: async () => ({ status: 'paid', employee_net: 300, amount_requested: 301.16, channels: [] }) },
    './physicalParsers': {}, './Nomina.module.css': {}, './ChannelOperations': { ChannelOperations: () => null },
    './logic': payrollLogic,
  })
  const expected = [
    ['caratula', 3, 30000, '3 personas', 'Neto de nómina', '$300.00'],
    ['layout_mismo_banco', 1, 10000, '1 pago', 'Total BBVA', '$100.00'],
    ['layout_spei', 1, 15000, '1 transferencia', 'Total SPEI', '$150.00'],
    ['layout_toka', 1, 5116, '1 transferencia', 'Fondeo TOKA', '$51.16'],
    ['cfdi_vales', 1, 5000, '1 beneficiario de vales', 'Importe de vales', '$50.00'],
  ]
  const session = { id: 'capture', version: 1, company_id: 'company', materialized_payment_request_id: 'request',
    company_bank_account_id: 'account', cost_center_id: 'center', payroll_subtype: 'ordinaria', period_start: '2026-09-01',
    period_end: '2026-09-15', concept: 'Nómina de prueba', expected_channels: ['banco', 'spei', 'vales'],
    files: expected.map(([kind, record_count, total_amount_minor]) => ({ id: kind, kind, record_count, total_amount_minor, issue_codes: [] })) }
  const props = { session, companies: [], accounts: [], costCenters: [], mappings: [], isFinance: true,
    activeCompanyId: 'company', onClose() {}, onSaved() {} }
  let renderer
  try {
    for (let opening = 0; opening < 2; opening++) {
      await act(async () => { renderer = create(React.createElement(CaptureModal, props)) })
      const rows = renderer.root.findAllByType('article')
      assert.equal(rows.length, 5)
      expected.forEach(([kind, , , count, title, amount], index) => {
        assert.ok(text(rows[index]).includes(payrollLogic.slotLabel(kind)))
        assert.ok(rows[index].findAllByType('span').some(node => text(node) === count), count)
        assert.equal(text(rows[index].findByProps({ title })), amount)
      })
      assert.equal(renderer.root.findAllByType('button').some(node => text(node).includes('Revalidar')), false)
      if (opening === 0) act(() => renderer.unmount())
    }
    await act(async () => { renderer.update(React.createElement(CaptureModal, { ...props, session: { ...session,
      files: session.files.map(file => ({ ...file, record_count: file.kind === 'caratula' ? 1 : 2 })),
    } })) })
    const plural = ['1 persona', '2 pagos', '2 transferencias', '2 transferencias', '2 beneficiarios de vales']
    renderer.root.findAllByType('article').forEach((row, index) => {
      assert.ok(row.findAllByType('span').some(node => text(node) === plural[index]), plural[index])
    })
  } finally { if (renderer) act(() => renderer.unmount()) }
})
