import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
const source=readFileSync('comprobantes_batch.js','utf8')
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002'
const a={id:'batch-a',company_id:A,company_name:'Operadora',status:'ready'},b={id:'batch-b',company_id:B,company_name:'Fersana',status:'review_required'}
function harness(company=A,rpc=async(name)=>({data:name==='list_payment_ingestion_batches'?[a,b]:{batch:b}})) {
  const elements={}
  function element(id){return elements[id] ||= {value:'',innerHTML:'',textContent:'',open:false,disabled:false,hidden:false,files:[],addEventListener(){},setAttribute(){},classList:{toggle(){}},reset(){},focus(){},showModal(){this.open=true},close(){this.open=false}}}
  const calls=[]
  const context=vm.createContext({window:{supabase:{createClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return rpc(name,args)}})}},document:{addEventListener(){},getElementById:element,querySelectorAll:()=>[]},SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'qa',Components:{showToast(){}},console,URL,URLSearchParams,Intl,Date,setTimeout,clearTimeout})
  vm.runInContext(source.replace(/\}\)\(\)\s*$/,`globalThis.qa={state,dom,bindDom,loadBatches,openBatch,openNewBatch,submitBatch,populateCompanies,reconcileOperation};})()`),context)
  const qa=context.qa;qa.bindDom();qa.state.companyScopeId=company
  return {...qa,elements,calls}
}
for(const [company,expected] of [[A,'batch-a'],[B,'batch-b']]) test(`list and counters only contain selected company ${expected}`,async()=>{
  const h=harness(company);await h.loadBatches()
  assert.equal(h.calls[0].args.p_company_id,company)
  assert.deepEqual(Array.from(h.state.batches,row=>row.id),[expected]);assert.equal(h.elements.countTotal.textContent,'1')
  h.populateCompanies([{id:A,name:'Operadora'},{id:B,name:'Fersana'}]);h.openNewBatch()
  assert.equal(h.elements.batchCompanyId.value,company);assert.equal(h.elements.batchCompanyId.disabled,true)
})
test('a foreign-company detail or stale selection cannot remain visible',async()=>{
  const h=harness();h.state.selectedId='batch-b';h.state.detail={batch:b};await h.loadBatches()
  assert.equal(h.state.selectedId,null);assert.equal(h.state.detail,null)
  await h.openBatch('batch-b')
  assert.equal(h.state.detail,null);assert.equal(h.state.selectedId,null)
})
test('missing company makes no list request; tampering cannot create for another company',async()=>{
  const h=harness(null);await h.loadBatches();assert.equal(h.calls.length,0)
  h.state.companyScopeId=A;h.elements.batchCompanyId.value=B
  await h.submitBatch({preventDefault(){}});assert.equal(h.calls.length,0);assert.match(h.elements.uploadError.textContent,/no coincide/)
})
test('late list responses cannot replace newer results',async()=>{
  const pending=[];const h=harness(A,()=>new Promise(resolve=>pending.push(resolve)))
  const first=h.loadBatches(),second=h.loadBatches();pending[1]({data:[a]});await second;pending[0]({data:[]});await first
  assert.equal(h.state.batches[0].id,a.id)
})
test('reconciliation refresh is scoped and refuses a foreign detail',async()=>{
  const h=harness();const context={batchId:'batch-a',extractionId:'extract-a',epoch:1}
  h.state.operationEpoch=1;h.state.selectedId='batch-a';h.state.operation={extraction_id:'extract-a'};h.elements.operationDialog.open=true
  await h.reconcileOperation(context,null)
  assert.equal(h.calls.find(c=>c.name==='list_payment_ingestion_batches').args.p_company_id,A)
  assert.equal(h.state.detail,null);assert.equal(h.state.selectedId,null)
})
test('company switch recreates the iframe, and missing active company stays explicit',()=>{
  const frame=readFileSync('app/src/pages/LegacyModuleFrame.tsx','utf8')
  assert.match(frame,/key=\{frameSrc\}/);assert.match(frame,/company_id=`/)
  assert.doesNotMatch(source,/p_company_id:\s*null/)
})
