import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require=createRequire(new URL('../../app/package.json',import.meta.url)), ts=require('typescript'),React=require('react')
const {act,create}=require('react-test-renderer')
const dir='app/src/features/dashboard/'
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8')
function load(path,mocks={}) {const out={};new Function('exports','require',ts.transpileModule(read(path),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(out,n=>n in mocks?mocks[n]:require(n));return out}
const movements=load(dir+'budgetMovements.ts',{'../../lib/supabase':{supabase:{}}})
const css={__esModule:true,default:new Proxy({},{get:(_,k)=>String(k)})}
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.children?.map(text).join('')||''
const base={categoryId:'a',name:'Combustible',group:'Operación',classification:'partida',budgeted:1000,used:500,executed:0,committed:500,available:500,pctUsed:50,over:false,warn:false}
const records=n=>Array.from({length:n},(_,i)=>({id:`r${i}`,source:'request',reference:`QA-${i}`,title:'Proveedor QA',description:'Concepto QA',date:'2026-09-01',budget_month:'2026-09-01',status:'approved',amount:100}))
async function mount(fetch){let refreshes=0;const calls=[];const {BudgetAccordion}=load(dir+'BudgetAccordion.tsx',{'./logic':{money:n=>`$${n}`,pct:n=>`${n.toFixed(1)}%`,REQUEST_STATUS_LABELS:{approved:'Aprobada'}},'./budgetMovements':{...movements,fetchBudgetMovements:(...args)=>{calls.push(args);return fetch(...args)}},'./Dashboard.module.css':css,'./BudgetAccordion.module.css':css,'react-router-dom':{Link:p=>React.createElement('a',{href:p.to},p.children)}})
 let view;const props={curated:[base,{...base,categoryId:'b',name:'Seguridad'}],noUse:[],search:'',companyId:'company-a',year:2026,period:'2026-09-01',periodLabel:'Septiembre 2026',onRefresh:()=>refreshes++}
 const render=key=>React.createElement(BudgetAccordion,{...props,key});await act(async()=>{view=create(render('initial'))})
 const toggle=i=>view.root.findAllByType('button').filter(b=>b.props['aria-controls'])[i]
 return {view,calls,toggle,refreshes:()=>refreshes,async changeScope(){props.companyId='company-b';props.period='2026-10-01';await act(async()=>view.update(render('changed')))},close(){act(()=>view.unmount())}}
}
test('one open card; four/five rows retained, request links, fixed summary and inner scrolling contract',async()=>{
 const f=await mount(async()=>records(5));try{
 assert.equal(f.calls.length,0)
 await act(async()=>f.toggle(0).props.onClick())
 assert.deepEqual(f.calls[0],['company-a',2026,'a','2026-09-01'])
 assert.equal(f.view.root.findAllByType('tbody')[0].findAllByType('tr').length,5)
 assert.equal(f.view.root.findAllByType('a')[0].props.href,'/solicitudes?request_id=r0')
 assert.match(text(f.view.toJSON()),/Total de la partida/)
 assert.match(text(f.view.toJSON()),/Presupuestado\$1000/)
 await act(async()=>f.toggle(1).props.onClick())
 assert.equal(f.toggle(0).props['aria-expanded'],false);assert.equal(f.toggle(1).props['aria-expanded'],true)
 assert.equal(f.view.root.findAllByType('tbody').length,1)
 await act(async()=>f.toggle(1).props.onClick());assert.equal(f.view.root.findAllByType('tbody').length,0)
 }finally{f.close()}
 const css=read(dir+'BudgetAccordion.module.css');assert.match(css,/4 \* var\(--movement-row-height\)/);assert.match(css,/overflow: auto/);assert.match(css,/position: sticky; top: 0/)
})
test('four entries need no scroll hint, empty rows are explicit and mismatch never claims a reconciled total',async()=>{
 for(const n of [0,4]) {const f=await mount(async()=>records(n));try{await act(async()=>f.toggle(0).props.onClick());assert.doesNotMatch(text(f.view.toJSON()),/Desplázate/);assert.match(text(f.view.toJSON()),/no coinciden/);assert.doesNotMatch(text(f.view.toJSON()),/Total de la partida/);if(!n)assert.match(text(f.view.toJSON()),/Sin movimientos/)}finally{f.close()}}
})
test('changing company/period removes previous details and late results; next click requests the new scope',async()=>{
 let resolve;const f=await mount(()=>new Promise(r=>resolve=r));try{await act(async()=>f.toggle(0).props.onClick());assert.match(text(f.view.toJSON()),/Cargando/);await f.changeScope();await act(async()=>resolve(records(5)));assert.equal(f.view.root.findAllByType('tbody').length,0);await act(async()=>f.toggle(0).props.onClick());assert.deepEqual(f.calls[1],['company-b',2026,'a','2026-10-01'])}finally{f.close()}
})
test('failure exposes retry and never becomes a zero total',async()=>{
 let count=0;const f=await mount(async()=>{if(!count++)throw new Error('offline');return records(5)});try{await act(async()=>f.toggle(0).props.onClick());assert.match(text(f.view.toJSON()),/No se pudo cargar/);assert.doesNotMatch(text(f.view.toJSON()),/Total del detalle/);await act(async()=>f.view.root.findAllByType('button').find(b=>text(b)==='Reintentar').props.onClick());assert.match(text(f.view.toJSON()),/Total de la partida/)}finally{f.close()}
})
