import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { syntheticPng, syntheticJpeg } from './fixtures/payroll-image-fixture.mjs'

const root = resolve(new URL('../..', import.meta.url).pathname)
const require = createRequire(resolve(root, 'app/package.json'))
const ts = require('typescript'), React = require('react'), { act, create } = require('react-test-renderer')
const pdfLib = require(resolve(root, 'pdf-lib-1.17.1.min.js'))
const parser = require(resolve(root, 'payment_batch_parser.js'))
const feature = 'app/src/features/comprobantes/'
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.children ? text(node.children) : node?.props ? text(node.props.children) : ''
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }
function load(path, imports = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), { fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'window', 'setTimeout', 'clearTimeout', outputText)(name => {
    if (Object.hasOwn(imports, name)) return imports[name]
    if (name.startsWith('react')) return require(name)
    throw new Error(`Unexpected dependency: ${name}`)
  }, module, module.exports, globals.window, globals.setTimeout || setTimeout, globals.clearTimeout || clearTimeout)
  return module.exports
}
const preparation = load('app/src/features/nomina/receiptUpload.ts', {}, { window: { PDFLib: pdfLib } })
const logic = load(feature + 'logic.ts')
const pdfjs = require(resolve(root, 'pdfjs-3.11.174.min.js'))
pdfjs.GlobalWorkerOptions.workerSrc = resolve(root, 'pdfjs-worker-3.11.174.min.js')
const lines = [
  'BBVA Net Cash', 'Tipo de operación: Pago Mismo Banco Importe: 1,831.27 MXP',
  'Cuenta de retiro: 000000000199158804 Cuenta de depósito: 999999990117',
  'Beneficiario: SERVICIOS DEMOSTRACION FLUX SA DE CV',
  'Fecha de creación: 15/09/2026 Fecha de aplicación: 15/09/2026',
  'Folio único: 990150926824739562801', 'Estado: Operado', 'Motivo de pago: PAGO DE SERVICIOS',
]
const context = { companies: [{id:'company-a',name:'Operadora'}], upload_policy: { max_file_bytes:25*1024*1024,max_pages:500 } }
const image = (format='png') => new File([format === 'png' ? syntheticPng() : syntheticJpeg], 'receipt.'+format, {type:format==='png'?'image/png':'image/jpeg'})
function harness(options={}) {
  const calls = [], hashes = new Set()
  const runtime = {
    parser, pdfjs,
    hasPdfSignature: bytes => new TextDecoder().decode(bytes.slice(0,5)) === '%PDF-',
    sha256Hex: async bytes => Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),
  }
  runtime.loadPdfRuntime = async () => runtime
  const input = load(feature+'receiptInput.ts', {
    '../nomina/receiptUpload':preparation,'./pdfRuntime':runtime,'./logic':logic,
    '../../lib/pdfText': { extractPdfLines: async(file,maxPages,opts) => {
      calls.push(['ocr',file,maxPages,opts]); assert.equal(file.type,'application/pdf');assert.equal(maxPages,1);assert.equal(opts.ocr,true)
      opts.onOcrProgress(); if(options.wait) await options.wait.promise
      if(options.ocrError) throw Error('OCR unavailable')
      return options.lines || lines
    } },
  },options.globals)
  const workflow = load(feature+'workflows.ts',{'./pdfRuntime':runtime,'./receiptInput':input,'./logic':logic,'./api':{
    createBatch:async args => {
      calls.push(['create',args]);const duplicate=hashes.has(args.sha256);hashes.add(args.sha256)
      return {batch_id:'batch-a',document_id:'document-a',storage_bucket:'payment-batch-documents',storage_path:'company/batch/source.pdf',duplicate:duplicate||options.duplicate,status:options.resume?'extracting':duplicate||options.duplicate?'ready':'awaiting_upload'}
    },
    privateBucket:async bucket => ({upload:async(path,file,opts)=>{calls.push(['upload',bucket,path,file,opts]);return {error:null}}}),
    finalizeBatchUpload:async(...args)=>{calls.push(['finalize',...args]);return {error:null}},
    submitExtractions:async(...args)=>{calls.push(['submit',...args])},
  }})
  const run=(file=image(),signal)=>workflow.uploadBatchWorkflow({companyId:'company-a',file,context,onProgress:()=>{},signal})
  return {input,calls,run}
}
const mutations=calls=>calls.filter(c=>['create','upload','finalize','submit'].includes(c[0]))

test('JPG/JPEG/PNG preserve the original picture in a deterministic one-page PDF for duplicate detection',async()=>{
  for(const format of ['jpg','jpeg','png']) {
    const source=image(format)
    const a=await preparation.prepareReceiptPdf(source,undefined,{deterministic:true})
    const b=await preparation.prepareReceiptPdf(new File([await source.arrayBuffer()],'renamed.'+format),undefined,{deterministic:true})
    assert.deepEqual(Buffer.from(await a.file.arrayBuffer()),Buffer.from(await b.file.arrayBuffer()))
    const pdf=await pdfLib.PDFDocument.load(await a.file.arrayBuffer(),{updateMetadata:false})
    assert.equal(pdf.getPageCount(),1);assert.equal(pdf.getCreationDate().valueOf(),0);assert.equal(pdf.getModificationDate().valueOf(),0)
  }
})

test('images reach the existing private PDF upload and exact extraction contract, without a financial confirmation',async()=>{
  for(const format of ['jpg','jpeg','png']) {
    const h=harness(); const result=await h.run(image(format))
    assert.equal(result.kind,'ok');assert.equal(result.pageCount,1);assert.match(result.parserVersion,/-image-ocr-v1$/)
    const created=h.calls.find(c=>c[0]==='create')[1], uploaded=h.calls.find(c=>c[0]==='upload')
    assert.equal(created.companyId,'company-a');assert.equal(created.fileName,'receipt.pdf');assert.equal(created.fileSizeBytes,uploaded[3].size)
    assert.equal(created.sha256,Buffer.from(await crypto.subtle.digest('SHA-256',await uploaded[3].arrayBuffer())).toString('hex'))
    assert.equal(uploaded[1],'payment-batch-documents');assert.equal(uploaded[4].contentType,'application/pdf');assert.equal(uploaded[4].upsert,false)
    const pages=h.calls.find(c=>c[0]==='submit')[3]
    assert.equal(pages.length,1)
    assert.deepEqual(pages[0],{page_number:1,amount:'1831.27',currency:'MXN',bank_name:'BBVA',bank_status:'Operado',bank_unique_folio:'990150926824739562801',application_date:'2026-09-15',beneficiary_name:'SERVICIOS DEMOSTRACION FLUX SA DE CV',payment_reason:'PAGO DE SERVICIOS',source_account:'000000000199158804',destination_account:'999999990117',confidence:0.99})
    assert.deepEqual(mutations(h.calls).map(c=>c[0]),['create','upload','finalize','submit'])
  }
})

test('retrying the same image opens the existing batch; interrupted extraction does not upload another PDF',async()=>{
  const h=harness();await h.run();h.calls.length=0
  assert.equal((await h.run()).kind,'duplicate')
  assert.deepEqual(mutations(h.calls).map(c=>c[0]),['create'])
  const resume=harness({duplicate:true,resume:true});await resume.run()
  assert.deepEqual(mutations(resume.calls).map(c=>c[0]),['create','submit'])
})

test('a native PDF keeps its bytes and all pages and never starts image recognition',async()=>{
  const {jsPDF}=createRequire(resolve(root,'package.json'))('jspdf')
  const pdf=new jsPDF();pdf.text(lines,10,20);pdf.addPage();pdf.text(lines.map(l=>l.replace('1,831.27','2,642.58').replace('62801','62802')),10,20)
  const source=new File([pdf.output('arraybuffer')],'two.pdf',{type:'application/pdf'}),h=harness()
  const result=await h.run(source)
  assert.equal(result.pageCount,2);assert.equal(result.parserVersion,parser.PARSER_VERSION)
  assert.equal(h.calls.some(c=>c[0]==='ocr'),false)
  assert.equal(h.calls.find(c=>c[0]==='upload')[3],source)
  assert.deepEqual(h.calls.find(c=>c[0]==='submit')[3].map(p=>p.amount),['1831.27','2642.58'])
})

test('invalid format, extension/signature mismatch, MIME mismatch and size limits fail before any batch exists',async()=>{
  for(const file of [new File([syntheticJpeg],'x.heic'),new File([syntheticJpeg],'x.svg'),new File([syntheticPng()],'x.jpg'),new File([syntheticJpeg],'x.jpg',{type:'image/png'}),new File(['invalid'.repeat(100)],'x.png'),new File([new Uint8Array(10*1024*1024+1)],'x.png')]){
    const h=harness();await assert.rejects(h.run(file));assert.deepEqual(mutations(h.calls),[])
  }
})

test('unreadable, conflicting or multiple payment image facts never create a batch or a partial match',async()=>{
  const variants=[
    lines.map(l=>l.replace('1,831.27','1,[ilegible]31.27')),
    lines.map(l=>l.replace('1,831.27','1O31.27')),
    lines.map(l=>l.replace('1,831.27','1831.27 2.00')),
    lines.map(l=>l.replace('000000000199158804','0000000001991588O4')),
    lines.map(l=>l.replace('999999990117','99999999[ilegible]')),
    lines.map(l=>l.replace('SERVICIOS DEMOSTRACION','SERVICIOS [ilegible]')),
    lines.filter(l=>!l.startsWith('Folio único:')),
    lines.map(l=>l.replace('Estado: Operado','Estado: Rechazado')),
    lines.map(l=>l.replace('Fecha de aplicación: 15/09/2026','Fecha de aplicación: 15/09/20[ilegible]')),
    [...lines,'Importe: 1,831.27 MXP'],[...lines,'Folio único: 990150926824739562802'],
    lines.map(l=>l.replace('Importe: 1,831.27 MXP','Importe: 1,831.27 MXP Importe: 2,000.00 MXP')),
  ]
  for(const bad of variants){const h=harness({lines:bad});await assert.rejects(h.run(),/batch_image_(unreadable_fields|multiple_payments)/);assert.deepEqual(mutations(h.calls),[])}
  const failed=harness({ocrError:true});await assert.rejects(failed.run(),/batch_image_read_failed/);assert.deepEqual(mutations(failed.calls),[])
})

test('cancellation and the reading deadline reject before any writes even when OCR completes late',async()=>{
  const wait=deferred(),h=harness({wait}),controller=new AbortController()
  const pending=h.run(image(),controller.signal)
  await new Promise(r=>setImmediate(r));controller.abort(new Error('batch_read_cancelled'))
  await assert.rejects(pending,/batch_read_cancelled/);wait.resolve();await new Promise(r=>setImmediate(r))
  assert.deepEqual(mutations(h.calls),[])
  let deadline
  const timed=harness({wait:deferred(),globals:{setTimeout:(fn,ms)=>{assert.equal(ms,90000);deadline=fn;return 1},clearTimeout:()=>{}}})
  const late=timed.run();await new Promise(r=>setImmediate(r));deadline()
  await assert.rejects(late,/batch_read_timeout/);assert.deepEqual(mutations(timed.calls),[])
})

async function modal() {
  const calls=[],wait=deferred(),h=harness()
  const Upload=load(feature+'UploadBatchModal.tsx',{
    '../../components/ui/CompanyCaptureContext':{CompanyCaptureContext:()=>React.createElement('span',null,'Operadora')},
    '../../components/ui/Toast':{useToast:()=>({showToast:(...a)=>calls.push(['toast',...a])})},
    './logic':logic,'./receiptInput':h.input,'./Comprobantes.module.css':new Proxy({}, {get:(_,k)=>k}),
    './workflows':{uploadBatchWorkflow:async params=>{calls.push(['run',params]);params.onProgress(20,'Leyendo imagen…');await wait.promise;return {kind:'ok',batchId:'batch',pageCount:1,parserVersion:'test'}}},
  }).UploadBatchModal
  let renderer
  await act(async()=>{renderer=create(React.createElement(Upload,{context,defaultCompanyId:'company-a',onClose:()=>calls.push(['close']),onUploaded:()=>calls.push(['uploaded']),onDuplicate:()=>calls.push(['duplicate'])}))})
  const button=name=>renderer.root.findAllByType('button').find(b=>text(b)===name)
  return {renderer,calls,wait,button}
}

test('the upload dialog exposes PDF/JPG/PNG, guards double click and cancels without a late success',async()=>{
  const h=await modal()
  try {
    const field=h.renderer.root.findByProps({type:'file'})
    assert.match(field.props.accept,/image\/jpeg/);assert.match(field.props.accept,/image\/png/)
    assert.equal(field.props.capture,undefined,'do not force mobile users to the camera')
    assert.match(text(h.renderer.root),/Una imagen completa por pago/)
    assert.equal(h.renderer.root.findByProps({role:'dialog'}).props['aria-modal'],'true')
    await act(async()=>field.props.onChange({target:{files:[image()]}}))
    const click=h.button('Procesar comprobante').props.onClick
    let first,second
    await act(async()=>{first=click();second=click()})
    assert.equal(h.calls.filter(c=>c[0]==='run').length,1)
    assert.equal(h.button('Cancelar lectura').props.disabled,false)
    await act(async()=>h.button('Cancelar lectura').props.onClick())
    assert.equal(h.calls.find(c=>c[0]==='run')[1].signal.aborted,true)
    await act(async()=>{h.wait.resolve();await Promise.all([first,second])})
    assert.equal(h.calls.some(c=>c[0]==='uploaded'||c[0]==='toast'),false)
  } finally {act(()=>h.renderer.unmount())}
})

test('changing company/unmounting aborts reading; once storage begins the cancel button is disabled',async()=>{
  const h=await modal()
  await act(async()=>h.renderer.root.findByProps({type:'file'}).props.onChange({target:{files:[image()]}}))
  let pending
  await act(async()=>{pending=h.button('Procesar comprobante').props.onClick()})
  const params=h.calls.find(c=>c[0]==='run')[1]
  await act(async()=>params.onProgress(40,'Guardando…'))
  assert.equal(h.button('Cancelar lectura').props.disabled,true)
  act(()=>h.renderer.unmount());assert.equal(params.signal.aborted,true)
  h.wait.resolve();await pending
  assert.equal(h.calls.some(c=>c[0]==='uploaded'),false)
})
