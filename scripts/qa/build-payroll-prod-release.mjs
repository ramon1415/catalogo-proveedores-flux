import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = JSON.parse(readFileSync(root + 'docs/qa/payroll-prod-dev-catalog-2026-09-08.json', 'utf8'));
const q = value => '"' + value.replaceAll('"', '""') + '"';
const lit = value => "'" + value.replaceAll("'", "''") + "'";
const funcs = new Map(source.functions.map(f => [`${f.schema}.${f.name}`, f]));
const tables = source.tables.filter(t => !t.name.startsWith('payroll_contpaq_'));
const seeds = [
  'get_my_payroll_access', 'get_payroll_capture_context', 'get_payroll_capture_sessions',
  'save_payroll_capture_session_n3g', 'reserve_payroll_capture_file', 'confirm_payroll_capture_file',
  'get_payroll_capture_file_url', 'get_payroll_receipt_file_url',
  'get_payroll_materialization_context_internal', 'materialize_payroll_capture_internal',
  'get_payroll_submission_summary', 'acknowledge_payroll_toka_funding_variance',
  'confirm_payroll_finance_review', 'get_payroll_reconciliation_summary',
  'record_payroll_channel_dispersion', 'reserve_payroll_channel_receipt',
  'get_payroll_receipt_verification_context', 'confirm_payroll_channel_receipt_internal',
  'reconcile_payroll_channel', 'close_payroll_as_paid',
  'claim_payroll_notifications', 'get_payroll_notification_document',
].map(name => `public.${name}`);
seeds.push('private.wake_payroll_notifications');
for (const t of source.triggers) {
  for (const f of funcs.values()) if (t.definition.includes(`${f.schema}.${f.name}(`)
    || (f.schema === 'public' && t.function === f.name)) seeds.push(`${f.schema}.${f.name}`);
}
for (const t of tables) for (const p of t.policies || []) seeds.push(...[...(p.using || '').matchAll(/(?:public|private)\.\w+(?=\()/g), ...(p.check || '').matchAll(/(?:public|private)\.\w+(?=\()/g)].map(m => m[0]));
for (const p of source.storage_policies) seeds.push(...[...(p.using || '').matchAll(/(?:public|private)\.\w+(?=\()/g), ...(p.check || '').matchAll(/(?:public|private)\.\w+(?=\()/g)].map(m => m[0]));
// pg_get_expr omits the public schema when it is on the capture search_path.
for (const policy of [...tables.flatMap(t => t.policies || []), ...source.storage_policies]) {
  const expression=(policy.using || '')+' '+(policy.check || '');
  for (const f of funcs.values()) if (new RegExp('\\b'+f.name+'\\s*\\(').test(expression)) seeds.push(`${f.schema}.${f.name}`);
}
const selected = new Set();
function visit(key) {
  if (selected.has(key) || !funcs.has(key)) return;
  selected.add(key);
  for (const m of funcs.get(key).definition.matchAll(/(?:public|private)\.\w+(?=\()/g)) visit(m[0]);
}
seeds.forEach(visit);
// PROD already has the company-scoped helper, released with its role cutover.
selected.delete('public.payroll_active_company_access');
const ordered = [], visiting = new Set(), done = new Set();
function order(key) {
  if (done.has(key) || visiting.has(key)) return;
  visiting.add(key);
  for (const m of funcs.get(key).definition.matchAll(/(?:public|private)\.\w+(?=\()/g)) if (selected.has(m[0])) order(m[0]);
  visiting.delete(key); done.add(key); ordered.push(funcs.get(key));
}
[...selected].sort().forEach(order);
const lines = [
  '-- Payroll production baseline: captured from the DEV flow validated through PR #574.',
  '-- No prior DEV migrations, unrelated modules, accounting activation or historical backfill.',
  'begin;', "set local lock_timeout='5s';", "set local statement_timeout='120s';",
  "set local search_path='public','extensions','pg_catalog';",
  'do $preflight$ begin',
  "  if to_regclass('public.payroll_capture_sessions') is not null or to_regclass('public.payroll_channels') is not null then raise exception 'PAYROLL_PROD_BASELINE_ALREADY_PRESENT'; end if;",
  "  if not exists(select 1 from pg_enum where enumtypid='public.payment_request_type'::regtype and enumlabel='nomina') then raise exception 'PAYROLL_PROD_REQUEST_TYPE_REQUIRED'; end if;",
  "  if to_regprocedure('private.profile_has_company_role(uuid,uuid,text[])') is null or to_regprocedure('public.payroll_active_company_access(uuid)') is null then raise exception 'PAYROLL_PROD_COMPANY_AUTH_REQUIRED'; end if;",
  "  if to_regprocedure('public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamp with time zone)') is null then raise exception 'PAYROLL_PROD_NOTIFICATION_V2_REQUIRED'; end if;",
  "  if to_regclass('cron.job') is null or to_regclass('vault.decrypted_secrets') is null then raise exception 'PAYROLL_PROD_NOTIFICATION_WAKEUP_REQUIRED'; end if;",
  "  if exists(select 1 from budget_categories where code='PAYROLL_NON_BUDGET') then raise exception 'PAYROLL_PROD_CATEGORY_ALREADY_PRESENT'; end if;",
  "  if (select count(*) from pg_trigger where tgrelid='public.payment_requests'::regclass and (tgname,md5(pg_get_triggerdef(oid))) in (('payment_request_created_notification_event','995c373c7b96dee78458f8d0b93d294d'),('validate_payment_request_approver_scope_insert','d2c6b72bdd58356bcc797087f5eafbee'),('validate_payment_request_approver_scope_update','5ab03b7e7d9bc728f1496fdd6eb8bab2')))<>3 then raise exception 'PAYROLL_PROD_SHARED_TRIGGER_DRIFT'; end if;",
  'end $preflight$;',
];
for (const c of source.request_columns) lines.push(`alter table public.payment_requests add column ${q(c.name)} ${c.type}${c.not_null ? ' not null' : ''}${c.default ? ` default ${c.default}` : ''};`);
for (const c of source.request_constraints.filter(c => !c.definition.startsWith('TRIGGER '))) lines.push(`alter table public.payment_requests add constraint ${q(c.name)} ${c.definition};`);
for (const t of tables) {
  lines.push(`create table public.${q(t.name)} (\n${t.columns.map(c => `  ${q(c.name)} ${c.type}${c.default ? ` default ${c.default}` : ''}${c.not_null ? ' not null' : ''}`).join(',\n')}\n);`);
  lines.push(`alter table public.${q(t.name)} enable row level security;`);
}
for (const type of ['p', 'u']) for (const t of tables) for (const c of t.constraints || []) if (c.type === type) lines.push(`alter table public.${q(t.name)} add constraint ${q(c.name)} ${c.definition};`);
for (const f of ordered) {
  let definition = f.definition;
  if (f.name === 'acknowledge_payroll_toka_funding_variance') {
    const old = ' or v_request.requested_by is distinct from v_actor';
    if (definition.split(old).length !== 2) throw new Error('TOKA ownership guard drifted');
    definition = definition.replace(old,'');
  }
  if (f.name === 'get_payroll_dispersion_summary') {
    const old = 'public.has_active_company_membership(v_actor,v_request.company_id) and v_payment_ready';
    if (definition.split(old).length !== 2) throw new Error('Dispersion action scope drifted');
    definition = definition.replace(old,'public.payroll_active_company_access(v_request.company_id) and v_payment_ready');
  }
  if (f.name === 'payroll_run_file_storage_insert_allowed') {
    const old = 'public.has_active_company_membership(public.current_profile_id(),request.company_id)';
    if (definition.split(old).length !== 2) throw new Error('Receipt Storage scope drifted');
    definition = definition.replace(old, 'public.payroll_active_company_access(request.company_id)');
  }
  lines.push(definition.trim() + ';');
  lines.push(`revoke all on function ${q(f.schema)}.${q(f.name)}(${f.args}) from PUBLIC, anon, authenticated, service_role;`);
  for (const g of f.grants || []) if (!['postgres','PUBLIC','anon'].includes(g.role)) lines.push(`grant ${g.privilege} on function ${q(f.schema)}.${q(f.name)}(${f.args}) to ${q(g.role)}${g.grantable ? ' with grant option' : ''};`);
}
lines.push(readFileSync(root+'scripts/qa/payroll-prod-company-role-adapter.sql','utf8'));
for (const t of tables) {
  for (const c of t.constraints || []) if (!['p','u','t'].includes(c.type)) lines.push(`alter table public.${q(t.name)} add constraint ${q(c.name)} ${c.definition};`);
  for (const index of t.indexes || []) lines.push(index.definition + ';');
  lines.push(`revoke all on table public.${q(t.name)} from PUBLIC, anon, authenticated, service_role;`);
  for (const g of t.grants || []) if (!['postgres','PUBLIC','anon'].includes(g.role)) lines.push(`grant ${g.privilege} on table public.${q(t.name)} to ${q(g.role)}${g.grantable ? ' with grant option' : ''};`);
}
const commands = {r:'SELECT',a:'INSERT',w:'UPDATE',d:'DELETE','*':'ALL'};
function policy(table, p) {
  return `create policy ${q(p.name)} on ${table}${p.permissive === false ? ' as restrictive' : ''} for ${commands[p.command]} to ${(p.roles || []).map(r => r === 'PUBLIC' ? r : q(r)).join(', ')}${p.using ? ` using (${p.using})` : ''}${p.check ? ` with check (${p.check})` : ''};`;
}
for (const t of tables) for (const p of t.policies || []) {
  const scoped = ['payroll_run_files','payroll_run_lines'].includes(t.name)
    ? {...p, using:'private.payroll_request_finance_access(payment_request_id)'} : p;
  lines.push(policy(`public.${q(t.name)}`,scoped));
}
for (const t of source.triggers) lines.push(t.definition + ';');
for (const p of source.storage_policies) lines.push(policy('storage.objects',p));
const b=source.bucket;
lines.push(`insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values (${lit(b.id)},${lit(b.name)},false,${b.file_size_limit},array[${b.allowed_mime_types.map(lit).join(',')}]);`);
lines.push(`insert into public.budget_categories(code,name,active,no_presupuestal) values ('PAYROLL_NON_BUDGET','Nómina · registro no presupuestal',true,true);`);
// Preserve the deployed generic trigger functions. Only their applicability is narrowed.
lines.push(`drop trigger payment_request_created_notification_event on public.payment_requests;
create trigger payment_request_created_notification_event after insert on public.payment_requests for each row
when (new.request_type::text <> 'nomina') execute function public.enqueue_payment_request_created_notification();
drop trigger validate_payment_request_approver_scope_insert on public.payment_requests;
create trigger validate_payment_request_approver_scope_insert before insert on public.payment_requests for each row
when (new.request_type::text <> 'nomina') execute function public.validate_payment_request_approver_scope();
drop trigger validate_payment_request_approver_scope_update on public.payment_requests;
create trigger validate_payment_request_approver_scope_update before update of approver_id,approver_assignment_id,approver_selection_source,company_id,requested_by,cost_center_id,amount_requested on public.payment_requests for each row
when (new.request_type::text <> 'nomina') execute function public.validate_payment_request_approver_scope();`);
lines.push("select cron.schedule('payroll-notification-dispatcher','* * * * *','select private.wake_payroll_notifications();');");
lines.push("notify pgrst, 'reload schema';",'commit;');
const baseline = root+'supabase/migrations/20260908075149_payroll_prod_capture_and_notifications.sql';
writeFileSync(baseline,lines.join('\n\n')+'\n');
const manifest={adaptations:['Company finance membership gates for payments, summaries and receipt uploads','Company finance RLS for raw payroll records','Treasury may acknowledge a TOKA funding variance captured by RH','No anonymous EXECUTE grants on payroll functions'],adapter_sha256:createHash('sha256').update(readFileSync(root+'scripts/qa/payroll-prod-company-role-adapter.sql')).digest('hex'),source_dev_sha:'4339b09cec3c5b1f2b906aceb97e25ddd6cac5f7',prod_base_sha:'b998919341b1e337f0cc2a7b7d31b289b4944e7c',tables:tables.map(t=>t.name),functions:ordered.map(f=>({schema:f.schema,name:f.name,args:f.args,sha256:createHash('sha256').update(f.definition).digest('hex')})),preserved_existing_functions:['public.payroll_active_company_access'],baseline_sha256:createHash('sha256').update(readFileSync(baseline)).digest('hex')};
writeFileSync(root+'docs/qa/payroll-prod-release-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({tables:tables.length,functions:ordered.length,baseline_bytes:readFileSync(baseline).length,baseline_sha256:manifest.baseline_sha256}));
