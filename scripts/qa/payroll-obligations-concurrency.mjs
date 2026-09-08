import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {obligationSchemaSQL} from './fixtures/payroll-obligations-schema.mjs';
// Only a disposable local PostgreSQL service. Never accepts a remote database.
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'obligation_concurrency');
const args=['-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=s=>execFileSync('psql',args,{input:s,encoding:'utf8'}).trim();
const asyncSql=s=>{const p=spawn('psql',args);let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);const done=new Promise(resolve=>p.on('close',code=>resolve({code,out,err})));p.stdin.end(s);return done;};
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [company,,rh,,,category,center]=[1,2,3,4,5,6,7].map(id);
const context=`set test.profile='${rh}';set request.jwt.claim.role='authenticated';`;
sql(obligationSchemaSQL);
for(const name of ['20260908172940_payroll_obligations_imss_isn','20260908173408_payroll_obligations_app_origin','20260908182623_payroll_obligations_review_feedback','20260908184710_payroll_obligations_shared_budget_guard'])sql(readFileSync(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8'));
sql(`insert into payroll_obligation_settings(company_id,kind,enabled,budget_category_id) values('${company}','imss',true,'${category}');`);
const normal=`insert into payment_requests(company_id,cost_center_id,budget_category_id,budget_month,amount_requested,status) values('${company}','${center}','${category}','2026-07-01',600,'submitted');`;
function prepare(n){
 const o=id(n),f=id(n+100);
 sql(`${context}select save_payroll_obligation('${o}','${company}','imss',null,'${center}','2026-07-01');
 insert into payroll_obligation_files(id,obligation_id,kind,created_by,size_bytes,sha256,storage_path,status,parsed) values('${f}','${o}','imss_sipare','${rh}',100,repeat('a',64),'${o}.pdf','verified',jsonb_build_object('kind','imss_sipare','taxpayerRfc','AAA010101AAA','employerRegistration','Z9912345678','periodStart','2026-07-01','periodEnd','2026-07-31','amountMinor',60000));
 update payroll_obligations set taxpayer_rfc='AAA010101AAA',employer_registration='Z9912345678',period_start='2026-07-01',period_end='2026-07-31',amount_minor=60000 where id='${o}';`);
 return `select transition_payroll_obligation('${o}',1,'submit');`;
}
async function race(first,second,label){
 const holder=asyncSql(`${context}begin;${first}select pg_advisory_xact_lock(918583);select pg_sleep(3);commit;`);
 let ready=false;
 for(let i=0;i<60;i++){if(sql("select exists(select 1 from pg_locks where locktype='advisory' and objid=918583 and granted)")==='t'){ready=true;break;}await new Promise(r=>setTimeout(r,50));}
 assert.ok(ready,'first transaction must hold its actual budget lock');
 const contender=asyncSql(`${context}begin;${second}commit;`);
 let blocked=false;
 for(let i=0;i<40;i++){if(Number(sql("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0"))>0){blocked=true;break;}await new Promise(r=>setTimeout(r,50));}
 const [a,b]=await Promise.all([holder,contender]);
 assert.ok(blocked,'second transaction must wait on the first budget lock');
 assert.equal(a.code,0,a.err);assert.notEqual(b.code,0,'second commitment must be rejected');
 assert.match(b.err,/OBLIGATION_BUDGET_UNAVAILABLE|presupuesto cambió/);
 assert.equal(Number(sql(`${context}select available from budget_availability;`)),400);
 console.log(`${label}: observed blocking; winner commits 600; loser rejected; remaining 400: PASS`);
}
await race(prepare(20),normal,'IMSS first / normal request second');
sql('truncate payroll_obligation_audit,payroll_obligation_files,payroll_obligations,payment_requests,notification_events;');
await race(normal,prepare(30),'Normal request first / IMSS second');
