// Runs only against a disposable loopback PostgreSQL cluster; never accepts a remote DSN.
// Install pinned tooling separately if needed:
// npm install --prefix /tmp/flux-pg-qa --save-exact embedded-postgres@17.6.0-beta.15
// FLUX_QA_RUNTIME_PACKAGE=/tmp/flux-pg-qa/package.json node scripts/qa/multipartida-concurrency.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { fixture, rpc, line, actor, ordinary, shared } from './fixtures/multipartida-rpc-db.mjs'

const require = createRequire(process.env.FLUX_QA_RUNTIME_PACKAGE || new URL('../../package.json', import.meta.url))
const module = require('embedded-postgres')
const EmbeddedPostgres = module.default || module
const directory = await mkdtemp(join(tmpdir(), 'flux-multipartida-pg-'))
const listener = createServer()
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
const port = listener.address().port
await new Promise(resolve => listener.close(resolve))
const logs=[]
const server = new EmbeddedPostgres({databaseDir:join(directory,'data'),user:'postgres',password:randomUUID(),port,
 persistent:false,initdbFlags:['--locale=C'],postgresFlags:['-h','127.0.0.1'],onLog:m=>logs.push(String(m)),onError:m=>logs.push(String(m))})
const connections=[]
let started=false
const connect=async()=>{const c=server.getPgClient(); await c.connect();connections.push(c);return c}
const asActor=async c=>{await c.query(`begin; set local role authenticated; set local statement_timeout='8s'; select set_config('test.actor','${actor}',true)`)}
try {
 await server.initialise();await server.start();started=true
 const observer=await connect()
 await fixture({exec:q=>observer.query(q),query:(q,p)=>observer.query(q,p)})
 await observer.query('reset role')
 const a=await connect(),b=await connect()
 const aPid=(await a.query('select pg_backend_pid() as pid')).rows[0].pid
 const bPid=(await b.query('select pg_backend_pid() as pid')).rows[0].pid
 assert.notEqual(aPid,bPid)
 const version=(await observer.query('show server_version')).rows[0].server_version
 const evidence={server_version:version,independent_backend_pids:[aPid,bPid],scenarios:[]}
 for (const outcome of ['commit','rollback']) {
  await observer.query('truncate public.payment_request_distributions,public.payment_requests')
  await asActor(a);await asActor(b)
  await rpc(a,[line(ordinary,10),line(shared,70)])
  // Capture errors immediately; B must remain pending while A owns the row lock.
  let finished=false
  const pending=rpc(b,[line(ordinary,10),line(shared,40)]).then(result=>({result}),error=>({error})).finally(()=>{finished=true})
  let blocked=false
  const deadline=Date.now()+4000
  while(Date.now()<deadline && !finished) {
   const row=(await observer.query('select $1::int=any(pg_blocking_pids($2::int)) as blocked',[aPid,bPid])).rows[0]
   if(row.blocked){blocked=true;break}
   await new Promise(resolve=>setTimeout(resolve,25))
  }
  assert.equal(blocked,true,'B must wait on A in pg_blocking_pids')
  assert.equal(finished,false)
  await a.query(outcome)
  const result=await pending
  if(outcome==='commit') {
   assert.equal(result.error?.code,'40001','B must re-read the remaining 30 after A commits 70')
   await b.query('rollback')
  } else {
   if(result.error)throw result.error
   assert.equal(result.result.rows[0].result.distribution_count,2)
   await b.query('commit')
  }
  const rows=await observer.query(`select committed,available from public.budget_availability where budget_category_id=$1`,[shared])
  const expected=outcome==='commit'?70:40
  assert.equal(Number(rows.rows[0].committed),expected)
  assert.equal(Number(rows.rows[0].available),100-expected)
  assert.equal(Number((await observer.query('select count(*) as count from public.payment_requests')).rows[0].count),1)
  evidence.scenarios.push({a:outcome,b_waited_on_a:true,b_result:outcome==='commit'?'40001':'committed',committed:expected,available:100-expected})
 }
 console.log(JSON.stringify(evidence,null,2))
} catch(error) {
 console.error(logs.slice(-8).join('\n'))
 throw error
} finally {
 for(const c of connections)await c.end().catch(()=>{})
 if(started)await server.stop()
 await rm(directory,{recursive:true,force:true})
}
