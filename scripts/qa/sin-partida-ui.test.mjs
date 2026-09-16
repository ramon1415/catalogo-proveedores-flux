import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import test from 'node:test'

const root = resolve(new URL('../..', import.meta.url).pathname)
const require = createRequire(resolve(root,'app/package.json'))
const ts = require('typescript'), React = require('react'), {act,create} = require('react-test-renderer')
const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : text(n?.children ?? n?.props?.children ?? '')
const categories = [{id:'sin',code:'SIN_PARTIDA',name:'Sin partida',no_presupuestal:true}, {id:'normal',code:'NORMAL',name:'Presupuestada'}]
const companies = [{id:'opt',name:'Operadora'},{id:'sf',name:'Fersana'}]
function loader(mocks={},window={setTimeout,clearTimeout}) {
  const cache = new Map()
  function load(file) {
    const path = resolve(root,file)
    for(const [ending,mock] of Object.entries(mocks)) if(path.endsWith(ending)) return mock
    if(cache.has(path))return cache.get(path)
    if(path.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,k)=>k})}
    const module={exports:{}};cache.set(path,module.exports)
    const {outputText}=ts.transpileModule(readFileSync(path,'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}})
    new Function('require','module','exports','window',outputText)(name=>{
      if(name.startsWith('react'))return require(name)
      let dep=resolve(dirname(path),name)
      if(!existsSync(dep))dep=['.tsx','.ts','.js'].map(e=>dep+e).find(existsSync)
      if(!dep)throw Error(`Unexpected dependency ${name}`)
      return load(dep)
    },module,module.exports,window)
    cache.set(path,module.exports);return module.exports
  }
  return load
}
const pure=loader(), labels=pure('app/src/lib/requestClassification.ts'), logic=pure('app/src/features/solicitudes/logic.ts')

test('approved descriptions change the display only: catalog identity and pending labels remain stable',()=>{
  assert.equal(labels.requestCategoryLabel({},categories[0]),'Sin partida')
  for(const description of ['Material de limpieza','Taxi','<script>sin ejecutar</script>']) {
    assert.equal(labels.requestCategoryLabel({sin_partida_description:description},categories[0]),`Sin partida (${description})`)
  }
  assert.equal(categories[0].name,'Sin partida')
  assert.equal(labels.requestCategoryLabel({sin_partida_description:'irrelevante'},categories[1]),'Presupuestada')
})

test('Sin partida remains selectable with no monthly budget or responsible grants',async()=>{
  const calls=[]
  const responses={budget_availability:[],company_cost_center_budget_categories:[],company_cost_center_budget_category_responsibles:[],budget_categories:[{id:'sin',code:'SIN_PARTIDA'}]}
  const load=loader({'/lib/supabase.ts':{supabase:{from(table){calls.push(table);const q={select(){return q},eq(){return q},then(ok){return Promise.resolve({data:responses[table],error:null}).then(ok)}};return q}}}})
  const rows=await load('app/src/features/solicitudes/api.ts').loadBudgetAvailability('sf','cc','2026-09-01','me')
  assert.equal(rows.length,1);assert.equal(rows[0].budget_category_id,'sin');assert.equal(rows[0].no_presupuestal,true)
  assert.equal(rows[0].company_id,'sf');assert.equal(calls.length,4)
})

test('a mixed reimbursement cannot silently skip budget validation',()=>{
  const item=(category,amount)=>({descripcion:'Gasto',budgetCategoryId:category,amount,deducible:false})
  const mixed=[item('normal',500),item('sin',10)]
  assert.equal(logic.reimbursementTotals(mixed,'sin').dominantCategoryId,'sin')
  assert.match(logic.validateReimbursementItems(mixed,'sin'),/Separa los gastos/)
  assert.equal(logic.validateReimbursementItems([item('sin',40),item('sin',60)],'sin'),'')
})

async function mount(t,{company='opt',group='operation'}={}){
  const calls={created:[],routing:[],toasts:[]},timers=[]
  const profile={id:'me',email:'me@example.test',full_name:'Solicitante QA'}, memberships=companies.map(c=>({company_id:c.id}))
  const api={
    loadActiveProjects:async()=>[],fetchPartidaPrediction:async()=>null,
    loadBudgetAvailability:async()=>categories.map(c=>({budget_category_id:c.id,responsible_email:c.id==='sin'?null:'someone-else@example.test',no_presupuestal:c.no_presupuestal})),
    listApproverOptions:async()=>[{profile_id:'other',source:'approval_rules',display_name:'Otro'}],
    getSinPartidaApprover:async(id)=>{calls.routing.push(id);return[{profile_id:'cesar',source:'sin_partida',display_name:'César'}]},
    createPaymentRequest:async(payload)=>{calls.created.push(payload);return{id:'new',request_number:'QA-SIN',beneficiary_profile_id:payload.beneficiary_profile_id}},
    createReimbursementRequestWithDocuments:async(payload,items)=>{calls.created.push(payload);return{id:'new',request_number:'QA-SIN',beneficiary_profile_id:payload.beneficiary_profile_id}},
    updateFase2Metadata:async()=>'',loadActiveProfiles:async()=>[profile],
    loadEmployeeBankAccount:async()=>({banco:'BBVA',beneficiary_name:'QA',clabe:'000000000000000000'}),
    insertReimbursementItems:async()=>'',
  }
  const load=loader({
    '/solicitudes/api.ts':api,
    '/lib/auth.tsx':{useAuth:()=>({profile,group,memberships,canManageProviders:()=>false})},
    '/lib/company.tsx':{useCompany:()=>({companyId:company})},
    '/lib/moduleAccess.tsx':{useModules:()=>({isEnabled:()=>false})},
    '/ui/Toast.tsx':{useToast:()=>({showToast:(...args)=>calls.toasts.push(args)})},
    '/ui/CompanyCaptureContext.tsx':{CompanyCaptureContext:()=>null},
    '/solicitudes/ProviderCombo.tsx':{ProviderCombo:props=>React.createElement('button',{type:'button',onClick:()=>props.onSelect('provider','QA')} ,'Elegir QA')},
    '/solicitudes/ConvenioReceiptUpload.tsx':{ConvenioReceiptUpload:()=>null},
    '/solicitudes/QuickProviderModal.tsx':{QuickProviderModal:()=>null},
    '/lib/contpaq/cfdiBrowser.js':{},
  },{setTimeout(fn){timers.push(fn);return timers.length},clearTimeout(n){if(n)timers[n-1]=null}})
  const Modal=load('app/src/features/solicitudes/RequestModal.tsx').RequestModal
  let view;await act(async()=>{view=create(React.createElement(Modal,{companies,costCenters:[{id:'cc',name:'Centro'}],budgetCategories:categories,
    proveedores:[{id:'provider',alias:'QA'}],profile,canApprove:group!=='operation',showNomina:false,onClose(){},onCreated(){},onProviderCreated(){}}))})
  t.after(()=>act(()=>view.unmount()))
  const field=(label,type)=>view.root.findAllByType('label').find(n=>text(n).startsWith(label)).findAll(n=>type?n.type===type:['input','select','textarea'].includes(n.type))[0]
  async function flush(){await act(async()=>{for(const fn of timers.splice(0))if(fn)await fn()})}
  return{view,calls,field,
    async change(label,value,type){await act(async()=>field(label,type).props.onChange({target:{value}}));await flush()},
    async submit(){await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}))},
    async provider(){await act(async()=>view.root.findAllByType('button').find(b=>text(b)==='Elegir QA').props.onClick())},
    async item(label,value){await act(async()=>view.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));await flush()},
  }
}

for(const company of ['opt','sf'])for(const group of ['operation','admin_finance','direction','sysadmin']) {
  test(`Sin partida routes automatically in ${company} for ${group}`,async t=>{
    const h=await mount(t,{company,group})
    await h.change('Centro de costo','cc','select');await h.change('Monto solicitado','100')
    const select=h.field('Partida presupuestal','select')
    assert.match(text(select),/Sin partida/)
    if(group!=='sysadmin')assert.doesNotMatch(text(select),/Presupuestada/)
    await h.change('Partida presupuestal','sin','select');await h.change('Descripcion','Taxi')
    const approver=h.field('¿Quién revisará esta solicitud?','select')
    assert.equal(approver.props.value,'cesar');assert.equal(approver.props.disabled,true)
    await h.provider();await h.submit()
    assert.equal(h.calls.created.length,1,JSON.stringify(h.calls.toasts))
    const payload=h.calls.created[0]
    assert.equal(payload.budget_category_id,'sin');assert.equal(payload.approver_id,'cesar')
    assert.equal(payload.company_id,company);assert.equal(payload.description,'Taxi')
    assert.equal(payload.is_extraordinary_adjustment,false)
    assert.ok(h.calls.routing.includes(company))
  })
}

for(const company of ['opt','sf'])for(const group of ['operation','admin_finance','direction','sysadmin'])test(`production reimbursement layout keeps Sin partida and locked Cesar in ${company} for ${group}`,async t=>{
  const h=await mount(t,{company,group})
  await h.change('Tipo de solicitud','reimbursement','select')
  assert.equal(text(h.view.root.findByType('h2')),'Nueva solicitud de reembolso')
  assert.match(text(h.view.root.findByProps({className:'captureIdentities'})),/Solicitante QA/)
  const sections=h.view.root.findAllByType('section')
  const breakdown=sections.find(n=>text(n).startsWith('Desglose de gastos'))
  assert.match(text(breakdown),/Empresa y periodo del reembolso/)
  assert.equal(h.view.root.findAllByType('label').filter(n=>text(n).startsWith('Centro de costo *')).length,1)
  assert.equal(breakdown.findAllByType('label').filter(n=>text(n).startsWith('Centro de costo *')).length,1)
  assert.equal(sections.some(n=>text(n).startsWith('Clasificacion presupuestal')),false)
  assert.equal(h.view.root.findAllByType('label').some(n=>text(n).startsWith('Monto solicitado')),false)
  assert.equal(text(h.view.root.findByType('aside').findByType('h3')),'Resumen del reembolso')
  assert.equal(text(h.view.root.findAllByType('button').find(b=>b.props.type==='submit')),'Crear reembolso')
  assert.match(text(breakdown.findByProps({className:'filePicker'})),/Seleccionar archivoSin archivo/)
  await h.change('Centro de costo','cc','select')
  await h.item('Descripción del gasto 1','Traslado de trabajo')
  await h.item('Monto del gasto 1','100')
  await h.item('Partida del gasto 1','sin')
  assert.equal(h.field('¿Quién revisará esta solicitud?','select').props.value,'cesar')
  assert.equal(h.field('¿Quién revisará esta solicitud?','select').props.disabled,true)
  assert.match(text(h.view.root.findByType('aside')),/\$100\.00/)
  await act(async()=>h.view.root.findAllByType('label').find(n=>text(n).includes('Sin comprobante fiscal')).findByType('input').props.onChange({target:{checked:true}}))
  await h.change('Descripcion','Traslado de trabajo')
  await h.submit()
  assert.equal(h.calls.created.length,1,JSON.stringify(h.calls.toasts))
  assert.equal(h.calls.created[0].request_type,'reimbursement');assert.equal(h.calls.created[0].beneficiary_profile_id,'me')
  assert.equal(h.calls.created[0].budget_category_id,'sin');assert.equal(h.calls.created[0].approver_id,'cesar')
})

for(const type of ['provider_payment','reimbursement'])test(`switching away from Sin partida restores the normal approver selector in ${type}`,async t=>{
  const h=await mount(t,{group:'sysadmin'})
  await h.change('Tipo de solicitud',type,'select')
  await h.change('Centro de costo','cc','select')
  if(type==='reimbursement')await h.item('Monto del gasto 1','100')
  else await h.change('Monto solicitado','100')
  const selectCategory=async value=>type==='reimbursement'?h.item('Partida del gasto 1',value):h.change('Partida presupuestal',value,'select')
  await selectCategory('sin')
  assert.equal(h.field('¿Quién revisará esta solicitud?','select').props.disabled,true)
  await selectCategory('normal')
  const approver=h.field('¿Quién revisará esta solicitud?','select')
  assert.equal(approver.props.disabled,false);assert.equal(approver.props.value,'other')
  assert.doesNotMatch(text(approver),/César/)
})


test('weekly cuts and exports use approved descriptions from production category labels',async()=>{
  const source=readFileSync(resolve(root,'approval_batches.js'),'utf8')
  const helper=source.slice(source.indexOf('async function withSinPartidaDescriptions'),source.indexOf('async function openBatch'))
  const calls=[]
  const client={from(table){assert.equal(table,'payment_requests');return{select(columns){assert.equal(columns,'id,sin_partida_description');return{async in(column,ids){calls.push(ids);return{data:[{id:'one',sin_partida_description:'Taxi'},{id:'two',sin_partida_description:null}],error:null}}}}}}}
  const enrich=new Function('supabaseClient',helper+';return withSinPartidaDescriptions')(client)
  const rows=[{payment_request_id:'one',budget_category:'SIN_PARTIDA - Sin partida'},{payment_request_id:'two',budget_category:'Sin partida'},{payment_request_id:'normal',budget_category:'NORMAL - Material'}]
  const result=await enrich(rows,r=>r.payment_request_id)
  assert.deepEqual(calls,[['one','two']]);assert.equal(result[0].budget_category,'Sin partida (Taxi)')
  assert.deepEqual(result.slice(1),rows.slice(1));assert.equal(rows[0].budget_category,'SIN_PARTIDA - Sin partida')
  assert.match(source,/escapeHtml\(item\.budget_category/)
})
