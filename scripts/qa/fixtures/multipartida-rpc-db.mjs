import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../../../supabase/migrations/20260925155322_multipartida_private_settings_fix.sql', import.meta.url), 'utf8')
const definition = name => {
  const start = migration.indexOf(`create or replace function ${name}(`)
  assert.ok(start >= 0)
  return migration.slice(start, migration.indexOf('$function$;', start) + '$function$;'.length)
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const company=id(1), actor=id(2), approver=id(3), provider=id(4), cc=id(5), ordinary=id(6), shared=id(7), other=id(8)

// Real PostgreSQL function bodies, with the production privilege boundary:
// settings has no authenticated SELECT; budget_lines has SELECT-only RLS.
// Unrelated identity/routing integrations use deterministic fixture functions.
export async function fixture(db = new PGlite()) {
  await db.exec(`
    create schema private;
    create role authenticated; create role anon;
    grant usage on schema public, private to authenticated;
    create type public.payment_request_type as enum ('provider_payment','reimbursement');
    create type public.payment_request_status as enum ('submitted','rejected','cancelled');
    create table public.profiles(id uuid, active boolean);
    create table public.proveedores(id uuid);
    create table public.companies(id uuid, active boolean);
    create table public.cost_centers(id uuid);
    create table public.budget_categories(id uuid, code text, no_presupuestal boolean);
    create table public.approver_assignments(id uuid,company_id uuid,requester_id uuid,approver_id uuid,active boolean);
    create table public.payroll_obligation_settings(company_id uuid,budget_category_id uuid,enabled boolean);
    alter table public.payroll_obligation_settings enable row level security;
    create table public.budget_versions(id uuid,active boolean);
    create table public.budget_lines(id uuid,company_id uuid,cost_center_id uuid,budget_category_id uuid,budget_month date,budget_version_id uuid,amount numeric);
    alter table public.budget_lines enable row level security;
    create policy read_only on public.budget_lines for select to authenticated using(true);
    create table public.payment_requests(
      id uuid primary key default gen_random_uuid(), provider_id uuid, proveedor_id uuid, beneficiary_profile_id uuid,
      company_id uuid,cost_center_id uuid,budget_category_id uuid,budget_month date,request_type public.payment_request_type,
      requested_by uuid,approver_id uuid,approver_assignment_id uuid,approver_selection_source text,
      amount_requested numeric,currency text,exchange_rate numeric,requires_invoice boolean,invoice_received boolean,
      subtotal_amount numeric,tax_amount numeric,withholding_amount numeric,invoice_uuid text,
      status public.payment_request_status,concept text,description text,notes text,submitted_at timestamptz,request_number text,
      budget_decision text,budget_block_reason text,budget_available_before numeric,budget_available_after numeric,
      budget_shortfall numeric,budget_checked_at timestamptz,budget_result jsonb,no_presupuestal boolean,
      is_extraordinary_adjustment boolean,partida_unsure boolean,created_at timestamptz,updated_at timestamptz);
    create table public.payment_request_distributions(payment_request_id uuid references payment_requests(id),budget_category_id uuid,cost_center_id uuid,amount numeric check(amount>0));
    create view public.budget_availability with(security_invoker=true) as
      select company_id,cost_center_id,budget_category_id,budget_month,amount as available from public.budget_lines;
    create function public.current_profile_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function public.has_active_company_membership(uuid,uuid) returns boolean language sql as $$select $1='${actor}'::uuid and $2='${company}'::uuid$$;
    create function public.flux_sysadmin_roles() returns text[] language sql as $$select array['sysadmin']$$;
    create function public.current_user_has_role(text[]) returns boolean language sql as $$select false$$;
    create function public.payment_request_has_active_approver_pool(uuid,uuid) returns boolean language sql as $$select false$$;
    create function public.payment_request_rule_allows(uuid,uuid,uuid,numeric,text) returns boolean language sql as $$select true$$;
    create function public.generate_payment_request_number(integer) returns text language sql as $$select 'QA'$$;
    create function public.verify_budget_availability(uuid,uuid,uuid,date,numeric,boolean) returns jsonb language sql as $$select jsonb_build_object('status',case when $5<=(select available from public.budget_availability where company_id=$1 and cost_center_id=$2 and budget_category_id=$3 and budget_month=$4) then 'aprobable' else 'bloqueado' end)$$;
    grant select on all tables in schema public to authenticated;
    revoke all on public.payroll_obligation_settings from authenticated;
    grant update on public.budget_lines to authenticated;
    grant insert,update on public.payment_requests,public.payment_request_distributions to authenticated;
    insert into public.profiles values('${actor}',true);
    insert into public.proveedores values('${provider}');
    insert into public.companies values('${company}',true),('${other}',true);
    insert into public.cost_centers values('${cc}');
    insert into public.budget_categories values('${ordinary}','ORDINARY',false),('${shared}','SHARED',false);
    insert into public.budget_versions values('${company}',true);
    insert into public.budget_lines values('${ordinary}','${company}','${cc}','${ordinary}','2026-09-01','${company}',100),('${shared}','${company}','${cc}','${shared}','2026-09-01','${company}',100);
    insert into public.payroll_obligation_settings values('${company}','${shared}',true);
    set test.actor='${actor}';
  `)
  const hardening = readFileSync(new URL('../../../supabase/migrations/20260925130000_multipartida_prod_hardening.sql', import.meta.url), 'utf8')
  const viewStart = hardening.indexOf('create or replace view public.budget_availability as')
  await db.exec(`create function public.payroll_obligation_budget_totals() returns table(company_id uuid,cost_center_id uuid,budget_category_id uuid,budget_month date,committed numeric,executed numeric) language sql as $$select null::uuid,null::uuid,null::uuid,null::date,null::numeric,null::numeric where false$$;`)
  await db.exec('drop view public.budget_availability')
  await db.exec(hardening.slice(viewStart, hardening.indexOf('-- ── Bloqueo 1b', viewStart)))
  await db.exec('alter view public.budget_availability set (security_invoker=true); grant select on public.budget_availability to authenticated')
  for (const [name, trigger] of [
    ['public.set_payment_request_no_presupuestal_snapshot', 'snapshot_guard'],
    ['private.guard_request_shared_obligation_budget', 'shared_guard'],
  ]) {
    const start=hardening.indexOf(`create or replace function ${name}(`)
    await db.exec(hardening.slice(start,hardening.indexOf('$function$;',start)+'$function$;'.length))
    await db.exec(`create trigger ${trigger} before insert or update on public.payment_requests for each row execute function ${name}()`)
  }
  await db.exec(definition('private.lock_and_check_obligation_budget'))
  await db.exec(definition('public.create_payment_request'))
  await db.exec(`revoke all on function private.lock_and_check_obligation_budget(uuid,uuid,uuid,date,numeric) from public,anon;
    grant execute on function private.lock_and_check_obligation_budget(uuid,uuid,uuid,date,numeric) to authenticated;
    set role authenticated;`)
  return db
}
export const rpc = (db, lines) => db.query(`select public.create_payment_request(
  p_proveedor_id=>'${provider}',p_company_id=>'${company}',p_cost_center_id=>'${cc}',p_budget_category_id=>'${ordinary}',
  p_budget_month=>'2026-09-01',p_amount_requested=>$1,p_approver_id=>'${approver}',p_distributions=>$2::jsonb) as result`,
  [lines.reduce((n,l)=>n+l.amount,0),JSON.stringify(lines)])
export const line=(category,amount)=>({budget_category_id:category,cost_center_id:cc,amount})
