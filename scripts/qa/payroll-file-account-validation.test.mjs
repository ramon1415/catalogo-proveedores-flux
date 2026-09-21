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


const spei = load('app/src/features/nomina/speiParser.ts', {})
const logic = load('app/src/features/nomina/logic.ts', { './speiParser': spei })
const source = '000000001234567890'
function layout() {
  return '012345678901234567' + source + 'MXP' + '0000000000100.00'
    + 'PERSONA PRUEBA'.padEnd(30) + '40' + '012' + 'NOMINA'.padEnd(30) + ' '.repeat(7) + 'H\r\n'
}
const file = () => new File([layout()], 'nomina-spei.txt', { type: 'text/plain' })

test('source validation follows the current account in both directions without reuploading; padded account numbers match', async () => {
  for (const slot of ['layout_spei', 'layout_toka']) {
    const initial = await logic.inspectFile(slot, file(), ['9999999999'])
    assert.equal(initial.uploadable, false)
    assert.deepEqual(initial.issueCodes, ['PAYROLL_SOURCE_ACCOUNT_MISMATCH'])
    assert.match(logic.fileValidationMessage(initial), /cuenta origen.*no coincide/)
    const ready = logic.validateFilesSourceAccount({ [slot]: initial }, ['1234567890'])[slot]
    assert.equal(ready.uploadable, true)
    assert.equal(ready.file, initial.file)
    assert.equal(ready.sha256, initial.sha256)
    assert.equal(logic.fileValidationMessage(ready), '')
    assert.equal(logic.validateFilesSourceAccount({ [slot]: ready }, ['9999999999'])[slot].uploadable, false)
  }
})

test('physical errors and persisted server validation cannot be cleared by changing the account', async () => {
  const broken = await logic.inspectFile('layout_spei', new File(['broken'], 'layout.txt'), [source])
  assert.equal(logic.validateFileSourceAccount('layout_spei', broken, [source]), broken)
  assert.equal(broken.uploadable, false)
  const stored = { ...(await logic.inspectFile('layout_spei', file(), [source])), uploaded: true, uploadable: false, status: 'failed' }
  assert.equal(logic.validateFileSourceAccount('layout_spei', stored, [source]), stored)
})

const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.props?.children ?? node.children ?? '') : ''
test('the real modal clears stale red files after account correction and blocks them again for a different account', async () => {
  let renderer
  const { CaptureModal } = load('app/src/features/nomina/CaptureModal.tsx', {
    '../../components/ui/Modal': { Modal: props => React.createElement('section', null, props.headerContext, props.children, props.actions) },
    '../../components/ui/CompanyCaptureContext': { CompanyCaptureContext: ({ name }) => React.createElement('span', { 'data-company-context': true }, name) },
    '../../components/ui/Toast': { useToast: () => ({ showToast() {} }) },
    '../../components/ui/icons': load('app/src/components/ui/icons.tsx', {}),
    '../../lib/supabase': { isDevSupabaseProject: false },
    './api': {}, './Nomina.module.css': {},
    './ChannelOperations': { ChannelOperations: () => null },
    './logic': logic,
    './physicalParsers': { classifyPayrollFile: async () => ({ slot: 'layout_spei', diagnostic: { recordCount: 1, totalAmountMinor: 10000 } }) },
  })
  const baseAccount = { company_id: 'company', account_type: 'bank', active: true, currency: 'MXN', bank_name: 'BBVA', clabe: null }
  const props = { session: null, companies: [{id:'company',name:'Empresa de prueba'}],
    accounts: [{...baseAccount,id:'wrong',name:'Otra cuenta',account_number:'9999999999'}, {...baseAccount,id:'right',name:'Cuenta correcta',account_number:'1234567890'}],
    costCenters: [], mappings: [], isFinance: true, activeCompanyId:'company', onClose(){}, onSaved(){} }
  try {
    await act(async () => { renderer = create(React.createElement(CaptureModal,props)) })
    assert.equal(text(renderer.root.findByProps({ 'data-company-context': true })), 'Empresa de prueba')
    const details = renderer.root.findAllByType('button').find(n=>text(n).includes('Datos de la corrida'))
    if(details) await act(async()=>details.props.onClick())
    const account = () => renderer.root.findByProps({id:'payroll-source-account'})
    await act(async()=>account().props.onChange({target:{value:'wrong'}}))
    const input = renderer.root.findAllByType('input').find(n=>n.props.type==='file')
    await act(async()=>{
      input.props.onChange({target:{files:[file()],value:'file'},currentTarget:{value:'file'}})
      for(let i=0;i<100;i++){
        await new Promise(resolve=>setTimeout(resolve,5))
        if(text(renderer.toJSON()).includes('nomina-spei.txt')) break
      }
    })
    assert.match(text(renderer.toJSON()),/cuenta origen.*no coincide/)
    await act(async()=>account().props.onChange({target:{value:'right'}}))
    assert.doesNotMatch(text(renderer.toJSON()),/cuenta origen.*no coincide/)
    assert.match(text(renderer.toJSON()),/Listo/)
    await act(async()=>account().props.onChange({target:{value:'wrong'}}))
    assert.match(text(renderer.toJSON()),/cuenta origen.*no coincide/)
  } finally { if(renderer) act(()=>renderer.unmount()) }
})

test('unsafe aggregate amounts remain blocked', async () => {
  const large = layout().replace('0000000000100.00', '9999999999999.99')
  const result = await logic.inspectFile('layout_spei', new File([large.repeat(10)], 'layout.txt'), [source])
  assert.equal(result.uploadable, false)
  assert.equal(result.status, 'parser_error')
})
