import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
const require = createRequire(new URL('../../app/package.json', import.meta.url))
const ts = require('typescript'), React = require('react'), renderer = require('react-test-renderer')
const compile = file => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const parser = {}
vm.runInNewContext(compile('app/src/features/solicitudes/convenioReceipt.ts'), { exports: parser })
const service = '123456789012', reference = `01${service}260831`, concept = '0000000703'
const receipt = (code = reference + concept, payable = '$70') => [
  'Comisión Federal de Electricidad', 'QA TOTAL A PAGAR:', `DOMICILIO QA ${payable}`,
  `NO. DE SERVICIO:${service}`, 'FECHA LÍMITE DE PAGO:31 AGO 2026',
  'Adeudo Anterior 71.01', 'Su Pago -71.00', 'Total 70.35',
  code, '$70', 'Datos fiscales: Folio 000123456789',
]
test('CFE uses the coupon 20+10 and headline payable, preserving zeros', () => {
  for (const code of [reference + concept, `01 ${service} 260831 000000070 3`]) {
    const data = parser.parseConvenioReceipt(receipt(code))
    assert.deepEqual(JSON.parse(JSON.stringify(data)), { convenio: '0578869', reference, concept, amount:'70.00', service, description:`CFE · servicio ${service}` })
  }
  assert.equal(parser.parseConvenioReceipt(receipt().flatMap(line => line === 'DOMICILIO QA $70' ? ['NOMBRE QA','DOMICILIO QA','$70'] : [line])).amount,'70.00')
})
test('CFE rejects partial/ambiguous/illegible identifiers, other service, amount or date', () => {
  for (const code of [reference, concept, reference + concept + '9', reference + ' 0000000[ilegible]0 3', `01999999999999260831${concept}`, `01${service}261331${concept}`, reference + '0000000713']) assert.throws(() => parser.parseConvenioReceipt(receipt(code)))
  assert.throws(() => parser.parseConvenioReceipt([...receipt(), reference + '0000000706']))
  assert.throws(() => parser.parseConvenioReceipt(receipt().map(s => s.replace('31 AGO 2026','01 SEP 2026'))))
  assert.throws(() => parser.parseConvenioReceipt(receipt(reference + concept, '$70.35')))
  assert.throws(() => parser.parseConvenioReceipt(receipt(reference + concept, '$70.345')))
  assert.throws(() => parser.parseConvenioReceipt([...receipt(), 'TOTAL A PAGAR: $80']))
})
test('a different agreement needs explicit fields; CFE segmentation is not guessed', () => {
  const data = parser.parseConvenioReceipt(['Recibo QA','TOTAL A PAGAR: $1,250.00','CONVENIO: 1234567','REFERENCIA: 000123-AB','CONCEPTO: 000789'])
  assert.equal(data.reference, '000123-AB'); assert.equal(data.concept, '000789'); assert.equal(data.amount, '1250.00')
  assert.throws(() => parser.parseConvenioReceipt(['TOTAL A PAGAR: $70', 'CONVENIO: 1234567', reference + concept]))
})

function mountReader(readPdf) {
  const calls = [], attached = [], busy = [], converted = []
  const component = {}
  const imports = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), './Solicitudes.module.css': {default:{}},
    './convenioReceipt': parser, '../../lib/pdfText': {extractPdfLines: readPdf},
    '../nomina/receiptUpload': { RECEIPT_ACCEPT:'application/pdf,image/jpeg,image/png', receiptSelectionError: () => null,
      prepareReceiptPdf: async file => { converted.push(file.name); return {file:{...file,name:file.name.replace(/\.(jpg|png)$/i,'.pdf')},converted:!file.name.endsWith('.pdf')} } },
  }
  vm.runInNewContext(compile('app/src/features/solicitudes/ConvenioReceiptUpload.tsx'), { exports:component, require:name=>imports[name], AbortController, setTimeout, clearTimeout })
  const props = {scopeKey:'company-a', onPrepared:file=>attached.push(file), onRead:data=>calls.push(data), onBusyChange:value=>busy.push(value)}
  let tree
  renderer.act(()=>{ tree=renderer.create(React.createElement(component.ConvenioReceiptUpload,props)) })
  return {tree,props,Component:component.ConvenioReceiptUpload,calls,attached,busy,converted}
}
test('PDF/JPG/PNG use the OCR-capable reader and retain the prepared attachment', async () => {
  for (const extension of ['pdf','jpg','png']) {
    const h=mountReader(async (file,pages,options)=>{assert.equal(file.name,'qa.pdf');assert.equal(pages,20);assert.equal(options.ocr,true);return receipt()})
    await renderer.act(async()=>{await h.tree.root.findByType('input').props.onChange({target:{files:[{name:`qa.${extension}`}]}})})
    assert.equal(h.calls[0].reference,reference);assert.equal(h.attached.at(-1).name,'qa.pdf');assert.equal(h.busy.at(-1),false)
    renderer.act(()=>h.tree.unmount())
  }
})
test('changing company cancels a pending read and cannot fill a new company form', async () => {
  let resolve, signal
  const h=mountReader((_f,_p,options)=>{ signal=options.signal; return new Promise(r=>{resolve=r}) })
  let read
  await renderer.act(async()=>{ read=h.tree.root.findByType('input').props.onChange({target:{files:[{name:'qa.pdf'}]}});await Promise.resolve() })
  renderer.act(()=>h.tree.update(React.createElement(h.Component,{...h.props,scopeKey:'company-b'})))
  assert.equal(signal.aborted,true)
  await renderer.act(async()=>{resolve(receipt());await read})
  assert.equal(h.calls.length,0);assert.equal(h.busy.at(-1),false)
  renderer.act(()=>h.tree.unmount())
})
test('an unreadable document remains attached for manual capture without invented data', async () => {
  const h=mountReader(async()=>['unreadable'])
  await renderer.act(async()=>{await h.tree.root.findByType('input').props.onChange({target:{files:[{name:'qa.pdf'}]}})})
  assert.equal(h.calls.length,0);assert.equal(h.attached.at(-1).name,'qa.pdf');assert.equal(h.busy.at(-1),false)
  renderer.act(()=>h.tree.unmount())
})
