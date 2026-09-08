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
    '../../lib/supabase': { isDevSupabaseProject: true },
    './api': api, './physicalParsers': {}, './Nomina.module.css': {},
    './ChannelOperations': { ChannelOperations: props => React.createElement('channel-operations', props) },
    './logic': {
      ALL_SLOTS: [], SLOT_CONFIG: {}, accountsForCompany: () => [], costCentersForCompany: () => [],
      sourceAccountCandidates: () => [], requiredSlots: () => [], defaultPayrollConcept: () => 'Nómina de prueba',
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
