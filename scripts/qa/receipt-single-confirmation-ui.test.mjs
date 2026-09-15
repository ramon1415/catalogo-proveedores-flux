import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(new URL('../..', import.meta.url).pathname)
const require = createRequire(resolve(root, 'app/package.json'))
const ts = require('typescript'), React = require('react')
const { act, create } = require('react-test-renderer')
const feature = 'app/src/features/comprobantes/'
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node?.children ? text(node.children) : node?.props ? text(node.props.children) : ''
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
function load(file, imports = {}) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(root, feature + file), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(name => {
    if (Object.hasOwn(imports, name)) return imports[name]
    if (name.startsWith('react')) return require(name)
    throw new Error(`Unexpected import ${name}`)
  }, module, module.exports)
  return module.exports
}
const css = new Proxy({}, { get: (_, key) => key })
const logic = load('logic.ts')
const comparison = load('ReceiptComparison.tsx', { './logic': logic, './Comprobantes.module.css': css })
const operation = (id = 'ex-1') => ({ extraction_id: id, extraction_updated_at: '2026-09-15T00:00:00Z', extraction_status: 'review_required', page_number: id === 'ex-1' ? 1 : 2, amount_minor: 147915, currency: 'MXN', beneficiary_name: 'SERVICIOS DEMOSTRACION FLUX SA DE CV', bank_unique_folio: `BANK-${id}`, application_date: '2026-09-15' })
const candidate = (id = 'request-1') => ({ payment_request_id: id, request_number: `SOL-${id}`, proveedor_name: 'Servicios Demo', amount_minor: 147915, currency: 'MXN', account_match: false, name_match: true })
const detail = { batch: { id: 'batch' }, document: { storage_bucket: 'payment-batch-documents', storage_path: '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002/source.pdf' } }
const caps = { can_match: true, can_review: true, can_link: true }

function fixture(options = {}) {
  const calls = [], states = new Map(), previews = new Map()
  const state = id => { const key = id.replace(/^op-/, ''); if (!states.has(key)) states.set(key, { accepted: false, evidence: false, linked: null }); return states.get(key) }
  const candidatesFor = id => options.candidates?.[id] || [candidate(id === 'ex-1' ? 'request-1' : 'request-2')]
  const api = {
    previewReceiptCandidates: async id => {
      calls.push(['preview', id]); previews.set(id, (previews.get(id) || 0) + 1)
      if (options.waitPreview) await options.waitPreview.promise
      if (options.stale && previews.get(id) > 1) throw new Error('stale_payment_extraction')
      const items = candidatesFor(id)
      return { items, outcome: options.blocked ? 'blocked' : items.length === 1 ? 'exact' : items.length ? 'multiple' : 'none', block_reason: options.blocked ? 'payment_extraction_not_conciliable' : null }
    },
    getLinkPreview: async id => {
      calls.push(['linkPreview', id]); const s = state(id), key = id.replace(/^op-/, '')
      if (!s.accepted) throw new Error('bank_payment_operation_not_found')
      return { operation_id: `op-${key}`, evidence: { status: s.evidence ? 'shareable' : 'pending_review' }, link: s.linked && { id: `link-${key}`, payment_request_id: s.linked, request_number: `SOL-${s.linked}` } }
    },
    acceptExtraction: async id => { calls.push(['accept', id]); state(id).accepted = true; return { operation_id: `op-${id}` } },
    findReceiptCandidates: async id => { calls.push(['find', id]); return candidatesFor(id.replace(/^op-/, '')) },
    linkReceiptToRequest: async (id, request) => { calls.push(['link', id, request]); state(id).linked = request; if (options.linkResponseLost) { options.linkResponseLost = false; throw new Error('Network error') }; return { request_number: `SOL-${request}` } },
    privateBucket: async () => ({ download: async () => { calls.push(['download']); return { data: new Blob(['PDF']), error: null } } }),
  }
  const workflows = {
    deriveIndividualReceipt: async params => { calls.push(['derive', params.extractionId]); if (options.pdfError) throw new Error('receipt_preview_unavailable'); return { extractionId: params.extractionId, bytes: new Uint8Array([1,2]), blobUrl: `blob:${params.extractionId}`, pageCount: 1, sha256: 'hash', previewDataUrl: 'data:image/png;base64,TEST' } },
    persistIndividualReceipt: async id => { calls.push(['persist', id]); if (options.persistFailsOnce) { options.persistFailsOnce = false; throw new Error('Upload failed') }; state(id).evidence = true },
  }
  const reconciliation = load('reconciliation.ts', { './api': api, './workflows': workflows })
  const imports = {
    '../../components/ui/CompanyCaptureContext': { ActiveCompanyCaptureContext: () => React.createElement('span', null, 'Operadora') },
    '../../components/ui/Toast': { useToast: () => ({ showToast: (...args) => calls.push(['toast', ...args]) }) },
    '../../components/ui/Badge': { Badge: props => React.createElement('span', null, props.children) },
    './api': api, './workflows': workflows, './reconciliation': reconciliation,
    './ReceiptComparison': comparison, './logic': logic, './Comprobantes.module.css': css,
  }
  return { calls, state, workflows, reconciliation, imports }
}
async function mount(options = {}) {
  const f = fixture(options)
  const { OperationModal } = load('OperationModal.tsx', f.imports)
  let renderer
  await act(async () => { renderer = create(React.createElement(OperationModal, { operation: operation(), detail, capabilities: caps, onClose: () => f.calls.push(['close']), onChanged: async () => f.calls.push(['changed']), onStartNewBatch: () => {} })) })
  const confirm = () => renderer.root.findAllByType('button').find(button => /Confirmar y marcar pagada|Confirmando/.test(text(button)))
  return { ...f, renderer, confirm }
}
const writes = calls => calls.filter(call => ['accept', 'persist', 'link'].includes(call[0]))

test('opening the modal automatically shows the PDF and unique request without any writes; one click completes reconciliation', async () => {
  const f = await mount()
  try {
    assert.equal(f.renderer.root.findAllByType('img').length, 1)
    assert.match(text(f.renderer.root), /SOL-request-1/)
    assert.deepEqual(writes(f.calls), [])
    assert.equal(f.renderer.root.findAllByProps({ role: 'dialog' }).length, 1)
    assert.equal(f.renderer.root.findAllByType('input').filter(i => i.props.type === 'checkbox').length, 0)
    assert.ok(!f.renderer.root.findAllByType('button').some(button => /Datos correctos, continuar|Comprobante revisado, continuar|Buscar solicitud aprobada/i.test(text(button))))
    assert.equal(f.confirm().props.disabled, false)
    await act(async () => { await f.confirm().props.onClick() })
    assert.deepEqual(writes(f.calls).map(call => call[0]), ['accept', 'persist', 'link'])
    assert.match(text(f.renderer.root), /Conciliación confirmada/)
  } finally { act(() => f.renderer.unmount()) }
})

test('double click has only one writer and no nested confirmation', async () => {
  const f = await mount()
  try {
    const click = f.confirm().props.onClick
    await act(async () => { await Promise.all([click(), click()]) })
    assert.equal(f.calls.filter(call => call[0] === 'link').length, 1)
    assert.equal(f.renderer.root.findAllByProps({ role: 'dialog' }).length, 1)
  } finally { act(() => f.renderer.unmount()) }
})

for (const options of [{ candidates: { 'ex-1': [] } }, { blocked: true }, { pdfError: true }]) {
  test(`missing candidate, blocked data or failed PDF prevent confirmation: ${JSON.stringify(options)}`, async () => {
    const f = await mount(options)
    try { assert.equal(f.confirm().props.disabled, true); await act(async () => f.confirm().props.onClick()); assert.deepEqual(writes(f.calls), []) }
    finally { act(() => f.renderer.unmount()) }
  })
}

test('ambiguous requests are not preselected; Finance selects one then confirms once', async () => {
  const f = await mount({ candidates: { 'ex-1': [candidate('a'), candidate('b')] } })
  try {
    assert.equal(f.confirm().props.disabled, true)
    const radios = f.renderer.root.findAllByType('input').filter(i => i.props.type === 'radio')
    assert.ok(radios.every(radio => !radio.props.checked))
    await act(async () => radios[1].props.onChange())
    assert.equal(f.confirm().props.disabled, false)
    await act(async () => f.confirm().props.onClick())
    assert.equal(f.calls.find(call => call[0] === 'link')[2], 'b')
  } finally { act(() => f.renderer.unmount()) }
})

test('an extraction changed since preview is rejected before any acceptance or payment', async () => {
  const f = await mount({ stale: true })
  try {
    await act(async () => f.confirm().props.onClick())
    assert.deepEqual(writes(f.calls), [])
    assert.match(text(f.renderer.root), /extracción cambió/)
  } finally { act(() => f.renderer.unmount()) }
})

test('closing during automatic loading never accepts, reviews or links', async () => {
  const waitPreview = deferred(), f = await mount({ waitPreview })
  act(() => f.renderer.unmount())
  await act(async () => waitPreview.resolve())
  assert.deepEqual(writes(f.calls), [])
})

for (const options of [{ persistFailsOnce: true }, { linkResponseLost: true }]) {
  test(`retry resumes existing acceptance/link without duplicates: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options), op = operation(), receipt = await f.workflows.deriveIndividualReceipt({ extractionId: op.extraction_id })
    const args = { operation: op, candidate: candidate(), receipt }
    await assert.rejects(f.reconciliation.confirmReceiptMatch(args))
    await f.reconciliation.confirmReceiptMatch(args)
    assert.equal(f.calls.filter(call => call[0] === 'accept').length, 1)
    assert.equal(f.calls.filter(call => call[0] === 'link').length, 1)
  })
}

test('bulk confirmation prepares unreviewed PDFs automatically, downloads source once and writes only on one confirmation', async () => {
  const f = fixture(), { BulkLinkModal } = load('BulkLinkModal.tsx', f.imports)
  let renderer
  await act(async () => { renderer = create(React.createElement(BulkLinkModal, { operations: [operation(), operation('ex-2')], detail, capabilities: caps, onClose: () => {}, onReview: () => {}, onLinked: async () => {} })) })
  try {
    assert.equal(renderer.root.findAllByType('img').length, 2)
    assert.equal(f.calls.filter(call => call[0] === 'download').length, 1)
    assert.deepEqual(writes(f.calls), [])
    const confirm = renderer.root.findAllByType('button').find(button => text(button) === 'Confirmar 2 coincidencias')
    assert.equal(confirm.props.disabled, false)
    await act(async () => confirm.props.onClick())
    assert.equal(f.calls.filter(call => call[0] === 'link').length, 2)
    assert.equal(renderer.root.findAllByType('input').filter(i => i.props.type === 'checkbox').length, 0)
  } finally { act(() => renderer.unmount()) }
})

test('two unique pages competing for the same request or bank folio are excluded from bulk confirmation', () => {
  const f = fixture()
  for (const matches of [
    [{ operation: operation(), candidate: candidate() }, { operation: operation('ex-2'), candidate: candidate() }],
    [{ operation: operation(), candidate: candidate() }, { operation: { ...operation('ex-2'), bank_unique_folio: operation().bank_unique_folio }, candidate: candidate('b') }],
  ]) {
    const result = f.reconciliation.nonConflictingMatches(matches)
    assert.equal(result.exact.length, 0)
    assert.equal(result.conflicts.length, 2)
  }
})
