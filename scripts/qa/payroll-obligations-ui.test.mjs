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
async function mount(status,canCapture,canPay) {
 const calls=[];const row={id:'obligation',company_id:'company',kind:'imss',status,version:1,files:[{id:'receipt',kind:'receipt',status:'verified',parsed:{amount:'10.00',paymentDate:'2026-07-15',reference:'QA'}}],amount_minor:1000,period_start:'2026-07-01',period_end:'2026-07-31',payment_date:status==='paid'?'2026-07-15':null};
 const {ObligationsPanel}=load('app/src/features/nomina/ObligationsPanel.tsx',{
 '../../lib/supabase':{supabase:{rpc:async(name,params)=>{calls.push(name);return {data:name==='get_payroll_obligation_context'?{can_capture:canCapture,can_pay:canPay,company_rfc:'AAA010101AAA',kinds:[{kind:'imss',category_name:'IMSS',centers:[]}]}:[row],error:null}}}},
 '../../components/ui/Modal':{Modal:props=>React.createElement('dialog',null,props.children,props.actions)},
 '../../components/ui/Toast':{useToast:()=>({showToast(){}})},'../../lib/pdfText':{},'./obligationDocuments':{},'./receiptAmount':{},'./logic':{formatMoney:v=>`$${v}`},'./Nomina.module.css':{},
 });
 globalThis.window={location:{search:''}};
 let renderer;await act(async()=>{renderer=create(React.createElement(ObligationsPanel,{companyId:'company',companyName:'QA'}))});
 await act(async()=>renderer.root.findAllByType('button').find(b=>text(b)==='Abrir').props.onClick());
 return {renderer,calls,buttons:()=>renderer.root.findAllByType('button').map(text)};
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
