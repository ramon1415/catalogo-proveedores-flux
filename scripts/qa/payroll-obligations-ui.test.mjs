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

const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';
async function mount(status,canCapture,canPay,options={}) {
 const calls=[],toasts=[];const row={id:'obligation',company_id:'company',kind:options.kind||'imss',status,version:1,cost_center_id:options.budget?'center':null,budget_month:'2026-07-01',files:[{id:'receipt',kind:status==='draft'?'imss_sipare':'receipt',status:'verified',parsed:{amount:'10.00',paymentDate:'2026-07-15',reference:'QA'}}],amount_minor:1000,period_start:'2026-07-01',period_end:'2026-07-31',payment_date:status==='paid'?'2026-07-15':null};
 const {ObligationsPanel}=load('app/src/features/nomina/ObligationsPanel.tsx',{
 '../../lib/supabase':{supabase:{rpc:async(name,params)=>{
  calls.push(name);
  if(name==='get_payroll_obligation_context')return {data:{can_capture:canCapture,can_pay:canPay,company_rfc:'AAA010101AAA',kinds:[{kind:row.kind,category_name:'IMSS',centers:options.budget?[{id:'center',name:'Centro QA'}]:[]}]},error:null};
  if(name==='save_payroll_obligation'){row.version++;return {data:row.id,error:null}}
  if(name==='submit_reviewed_payroll_obligation'){assert.equal(params.p_reviewed_amount_minor,1000);assert.equal(params.p_version,row.version);row.status=canPay?'approved':'submitted';row.version++;return {data:row.status,error:null}}
  if(name==='reserve_payroll_obligation_file')return {data:{file_id:'file',bucket:'payroll-obligations',path:'reserved.pdf'},error:null};
  return {data:[{...row}],error:null};
 },storage:{from:()=>({upload:async()=>({error:options.uploadError?new Error('OBLIGATION_DOCUMENT_INVALID'):null})})},functions:{invoke:async()=>({data:{parsed:{}},error:null})}}},
 '../../components/ui/Modal':{Modal:props=>React.createElement('dialog',null,props.children,props.actions)},
 '../../components/ui/icons':load('app/src/components/ui/icons.tsx',{}),
 '../../components/ui/Toast':{useToast:()=>({showToast(...args){toasts.push(args)}})},'../../lib/pdfText':{extractPdfLines:async()=>[]},'./obligationDocuments':{parseObligationDocument:()=>({kind:'imss_sipare',taxpayerRfc:'AAA010101AAA',issues:[]})},'./receiptAmount':{},'./logic':{formatMoney:v=>`$${v}`},'./Nomina.module.css':{},
 });
 globalThis.window={location:{search:''}};
 let renderer;await act(async()=>{renderer=create(React.createElement(ObligationsPanel,{companyId:'company',companyName:'QA'}))});
 await act(async()=>renderer.root.findAllByType('button').find(b=>text(b)==='Abrir').props.onClick());
 return {renderer,calls,toasts,buttons:()=>renderer.root.findAllByType('button').map(text)};
}
test('paid obligations are read-only and retain download access',async()=>{
 const {renderer,buttons}=await mount('paid',true,true);try{
 assert.ok(buttons().includes('Descargar'));assert.ok(!buttons().some(t=>/Confirmar|Revalidar|Cancelar solicitud|Guardar borrador|Enviar a Finanzas/.test(t)));
 assert.equal(renderer.root.findAllByType('input').length,0);
 assert.match(text(renderer.root.findByType('dialog')),/Pago registrado el 2026-07-15/);
 }finally{act(()=>renderer.unmount())}
});
test('capture-only cannot confirm or pay; missing budget assignment keeps send disabled',async()=>{
 const {renderer,buttons}=await mount('draft',true,false);try{
 assert.ok(buttons().includes('Guardar borrador'));assert.equal(renderer.root.findAllByType('button').find(b=>text(b)==='Enviar a Finanzas').props.disabled,true);
 assert.ok(!buttons().some(t=>/Confirmar montos|Confirmar pago/.test(t)));
 assert.match(text(renderer.root.findByType('dialog')),/configurar el centro y la partida/);
 }finally{act(()=>renderer.unmount())}
});
test('canceling an empty receipt selector performs no upload and leaves payment modal open',async()=>{
 const {renderer,calls,buttons}=await mount('approved',false,true);try{
 const before=calls.length;const input=renderer.root.findAllByType('input').find(n=>n.props.type==='file');
 await act(async()=>input.props.onChange({target:{files:[],value:''}}));
 assert.equal(calls.length,before);assert.equal(renderer.root.findAllByType('dialog').length,1);
 assert.ok(buttons().includes('Confirmar pago registrado'));assert.ok(!buttons().some(t=>/Nueva solicitud|Guardar borrador/.test(t)));
 }finally{act(()=>renderer.unmount())}
});

test('save and file upload display explicit success inside the modal after completion',async()=>{
 const {renderer,toasts}=await mount('draft',true,false);
 try {
  await act(async()=>renderer.root.findAllByType('button').find(b=>text(b)==='Guardar borrador').props.onClick());
  assert.ok(toasts.some(t=>t[0]==='Borrador guardado'&&t[2]==='success'));
  assert.match(text(renderer.root.findByProps({role:'status'})),/Borrador guardado/);
  const input=renderer.root.findAllByType('input').find(i=>i.props.type==='file');
  await act(async()=>input.props.onChange({target:{files:[new File(['x'.repeat(100)],'source.pdf')],value:''}}));
  assert.ok(toasts.some(t=>t[0]==='Carga completada'&&t[1]==='1 archivo guardado correctamente.'));
  assert.match(text(renderer.root.findByProps({role:'status'})),/Carga completada/);
 }finally{act(()=>renderer.unmount())}
});
test('failed upload never announces success',async()=>{
 const {renderer,toasts}=await mount('draft',true,false,{uploadError:true});
 try {
  const input=renderer.root.findAllByType('input').find(i=>i.props.type==='file');
  await act(async()=>input.props.onChange({target:{files:[new File(['x'.repeat(100)],'source.pdf')],value:''}}));
  assert.ok(!toasts.some(t=>t[2]==='success'));assert.equal(renderer.root.findAllByProps({role:'alert'}).length,1);
 }finally{act(()=>renderer.unmount())}
});
test('IMSS and ISN review occurs before send; Finance captures do not ask for confirmation again',async()=>{
 for(const kind of ['imss','isn_cdmx']){
  const {renderer,calls,buttons}=await mount('draft',true,true,{budget:true,kind});
  try {
   await act(async()=>renderer.root.findAllByType('button').find(b=>text(b)==='Enviar a Finanzas').props.onClick());
   assert.ok(renderer.root.findByProps({'aria-label':'Revisión antes del envío'}));
   assert.ok(!calls.includes('submit_reviewed_payroll_obligation'));
   await act(async()=>renderer.root.findAllByType('button').find(b=>text(b)==='Volver a editar').props.onClick());
   assert.ok(!calls.includes('submit_reviewed_payroll_obligation'));
   await act(async()=>renderer.root.findAllByType('button').find(b=>text(b)==='Enviar a Finanzas').props.onClick());
   await act(async()=>renderer.root.findAllByType('button').find(b=>text(b)==='Confirmar y enviar a Finanzas').props.onClick());
   assert.equal(calls.filter(c=>c==='submit_reviewed_payroll_obligation').length,1);
   assert.ok(buttons().includes('Confirmar pago registrado'));assert.ok(!buttons().includes('Confirmar montos correctos'));
   assert.match(text(renderer.root.findByProps({role:'status'})),/Solicitud enviada a Finanzas/);
  }finally{act(()=>renderer.unmount())}
 }
});
