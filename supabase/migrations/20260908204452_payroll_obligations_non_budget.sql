-- IMSS/ISN without budget, as requested by Ramon. Existing sent obligations retain their accounting.
begin;
set local lock_timeout='5s';
alter table public.payroll_obligations add column no_presupuestal boolean not null default false;
alter table public.payroll_obligations alter column no_presupuestal set default true;
alter table public.payroll_obligations drop constraint payroll_obligations_check1;
alter table public.payroll_obligations add constraint payroll_obligations_submission_check check (
 status not in ('submitted','approved','paid') or
 (period_start is not null and period_end is not null and amount_minor is not null and
 (no_presupuestal or (cost_center_id is not null and budget_category_id is not null and budget_month is not null
 and coalesce(budget_result->>'status'='aprobable',false))))
);
-- Drafts have no reserved budget to release. Never rewrite submitted/approved/paid rows.
update public.payroll_obligations set no_presupuestal=true,version=version+1,updated_at=now() where status='draft';

create or replace function public.save_payroll_obligation(p_id uuid,p_company_id uuid,p_kind text,p_version integer default null,p_cost_center_id uuid default null,p_budget_month date default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.payroll_obligation_actor(p_company_id,'capture'); o public.payroll_obligations%rowtype; cfg public.payroll_obligation_settings%rowtype; begin
 select * into cfg from public.payroll_obligation_settings where company_id=p_company_id and kind=p_kind and enabled;
 if not found then raise exception 'OBLIGATION_NOT_ENABLED'; end if;
 if p_id is null then raise exception 'OBLIGATION_ID_REQUIRED'; end if;
 select * into o from public.payroll_obligations where id=p_id for update;
 if found then
  if o.company_id<>p_company_id or o.kind<>p_kind then raise exception 'OBLIGATION_SCOPE_MISMATCH'; end if;
  if o.status<>'draft' then raise exception 'OBLIGATION_DRAFT_REQUIRED'; end if;
  if o.version is distinct from p_version then raise exception 'OBLIGATION_STALE_VERSION'; end if;
 end if;
 if coalesce(o.no_presupuestal,true) then p_cost_center_id:=null; p_budget_month:=null; end if;
 if not coalesce(o.no_presupuestal,true) and p_cost_center_id is not null and not exists(select 1 from public.company_cost_center_budget_categories a
 join public.cost_centers c on c.id=a.cost_center_id and c.active join public.budget_categories b on b.id=a.budget_category_id and b.active and not b.no_presupuestal
 where a.company_id=p_company_id and a.cost_center_id=p_cost_center_id and a.budget_category_id=cfg.budget_category_id and a.active)
 then raise exception 'OBLIGATION_BUDGET_ASSIGNMENT_REQUIRED'; end if;
 if o.id is null then
  insert into public.payroll_obligations(id,company_id,kind,created_by,cost_center_id,budget_category_id,budget_month)
  values(p_id,p_company_id,p_kind,actor,null,null,date_trunc('month',p_budget_month)::date);
 else update public.payroll_obligations set cost_center_id=p_cost_center_id,budget_category_id=case when o.no_presupuestal then null else cfg.budget_category_id end,
 budget_month=date_trunc('month',p_budget_month)::date,version=version+1,updated_at=now() where id=p_id; end if;
 insert into public.payroll_obligation_audit(obligation_id,actor_id,action) values(p_id,actor,'save_draft'); return p_id;
end; $$;

create or replace function public.transition_payroll_obligation(p_id uuid,p_version integer,p_action text,p_amount_minor bigint default null,p_payment_date date default null,p_reference text default null)
returns text language plpgsql security definer set search_path='' as $$
declare o public.payroll_obligations%rowtype; actor uuid; result jsonb; primary_kind text; begin
 select * into o from public.payroll_obligations where id=p_id for update;
 if not found then raise exception 'OBLIGATION_NOT_FOUND'; end if;
 actor:=private.payroll_obligation_actor(o.company_id,case when p_action in('confirm','pay') or (p_action='cancel' and o.status<>'draft') then 'pay' else 'capture' end);
 if (p_action='submit' and o.status='submitted') or (p_action='confirm' and o.status='approved') or (p_action='pay' and o.status='paid') or (p_action='cancel' and o.status='cancelled') then return o.status; end if;
 if o.version is distinct from p_version then raise exception 'OBLIGATION_STALE_VERSION'; end if;
 if p_action='submit' then
  if o.status<>'draft' then raise exception 'OBLIGATION_DRAFT_REQUIRED'; end if;
  if not exists(select 1 from public.payroll_obligation_settings where company_id=o.company_id and kind=o.kind and enabled and (o.no_presupuestal or budget_category_id=o.budget_category_id))
  then raise exception 'OBLIGATION_NOT_ENABLED'; end if;
  primary_kind:=case when o.kind='imss' then 'imss_sipare' else 'isn_cdmx' end;
  if not exists(select 1 from public.payroll_obligation_files where obligation_id=o.id and active and kind=primary_kind and status='verified')
  or exists(select 1 from public.payroll_obligation_files f where f.obligation_id=o.id and f.active and (f.status<>'verified'
  or f.parsed->>'taxpayerRfc' is distinct from o.taxpayer_rfc or (f.parsed->>'amountMinor')::bigint is distinct from o.amount_minor
  or (f.parsed->>'periodStart')::date is distinct from o.period_start or (f.parsed->>'periodEnd')::date is distinct from o.period_end
  or (o.kind='imss' and f.parsed->>'employerRegistration' is distinct from o.employer_registration)
  or (nullif(f.parsed->>'dueDate','') is not null and (f.parsed->>'dueDate')::date is distinct from o.due_date)))
  then raise exception 'OBLIGATION_DOCUMENTS_INCONSISTENT'; end if;
  if o.no_presupuestal then
   result:=jsonb_build_object('status','no_presupuestal');
  else
  if o.cost_center_id is null or o.budget_category_id is null or o.budget_month is null or o.amount_minor is null
  or not exists(select 1 from public.budget_categories where id=o.budget_category_id and active and not no_presupuestal)
  then raise exception 'OBLIGATION_BUDGET_ASSIGNMENT_REQUIRED'; end if;
  perform 1 from public.budget_lines bl join public.budget_versions bv on bv.id=bl.budget_version_id and bv.active
  where bl.company_id=o.company_id and bl.cost_center_id=o.cost_center_id and bl.budget_category_id=o.budget_category_id and bl.budget_month=o.budget_month for update of bl;
  if not found then raise exception 'OBLIGATION_BUDGET_LINE_REQUIRED'; end if;
  result:=public.verify_budget_availability(o.company_id,o.cost_center_id,o.budget_category_id,o.budget_month,o.amount_minor/100::numeric,false,false);
  if result->>'status' is distinct from 'aprobable' then raise exception 'OBLIGATION_BUDGET_UNAVAILABLE'; end if;
  end if;
  update public.payroll_obligations set status='submitted',submitted_at=now(),budget_result=result where id=o.id;
  perform private.enqueue_payroll_obligation_event(o.id,'payroll.obligation.registered');
 elsif p_action='confirm' then
  if o.status<>'submitted' then raise exception 'OBLIGATION_SUBMITTED_REQUIRED'; end if;
  if not o.no_presupuestal and not exists(select 1 from public.budget_availability b where b.company_id=o.company_id and b.cost_center_id=o.cost_center_id
    and b.budget_category_id=o.budget_category_id and b.budget_month=o.budget_month and b.available>=0)
  then raise exception 'OBLIGATION_BUDGET_UNAVAILABLE'; end if;
  update public.payroll_obligations set status='approved',confirmed_by=actor,confirmed_at=now() where id=o.id;
 elsif p_action='pay' then
  if o.status<>'approved' then raise exception 'OBLIGATION_CONFIRMATION_REQUIRED'; end if;
  if p_amount_minor is distinct from o.amount_minor or p_payment_date is null or p_payment_date>current_date
  or nullif(btrim(p_reference),'') is null or length(p_reference)>120 then raise exception 'OBLIGATION_PAYMENT_FIELDS_INVALID'; end if;
  if not exists(select 1 from public.payroll_obligation_files where obligation_id=o.id and kind='receipt' and active and status='verified') then raise exception 'OBLIGATION_RECEIPT_REQUIRED'; end if;
  if exists(select 1 from public.payroll_obligation_files f where f.obligation_id=o.id and f.kind='receipt' and f.active and (
   nullif(f.parsed->>'currency','') is not null and f.parsed->>'currency'<>'MXN'
   or nullif(f.parsed->>'amount','') is not null and (f.parsed->>'amount')::numeric*100<>p_amount_minor
   or nullif(f.parsed->>'paymentDate','') is not null and (f.parsed->>'paymentDate')::date<>p_payment_date
   or nullif(f.parsed->>'reference','') is not null and f.parsed->>'reference'<>btrim(p_reference)))
  then raise exception 'OBLIGATION_PAYMENT_FIELDS_INVALID'; end if;
  update public.payroll_obligations set status='paid',paid_by=actor,paid_at=now(),payment_date=p_payment_date,bank_reference=btrim(p_reference) where id=o.id;
  perform private.enqueue_payroll_obligation_event(o.id,'payroll.obligation.paid');
 elsif p_action='cancel' then
  if o.status not in('draft','submitted','approved') then raise exception 'OBLIGATION_CANCEL_STATE_INVALID'; end if;
  update public.payroll_obligations set status='cancelled' where id=o.id;
  update public.notification_events set status='cancelled',next_attempt_at=null where source_table='payroll_obligations' and source_id=o.id and status in('pending','failed');
 else raise exception 'OBLIGATION_ACTION_INVALID'; end if;
 update public.payroll_obligations set version=version+1,updated_at=now() where id=o.id returning status into p_action;
 insert into public.payroll_obligation_audit(obligation_id,actor_id,action) values(o.id,actor,p_action); return p_action;
end; $$;

create or replace function public.payroll_obligation_budget_totals()
returns table(company_id uuid,cost_center_id uuid,budget_category_id uuid,budget_month date,committed numeric,executed numeric)
language sql stable security definer set search_path='' as $$
 select o.company_id,o.cost_center_id,o.budget_category_id,o.budget_month,sum(o.amount_minor)/100::numeric,
 coalesce(sum(o.amount_minor) filter(where o.status='paid'),0)/100::numeric
 from public.payroll_obligations o where not o.no_presupuestal and o.status in('submitted','approved','paid')
 and (coalesce(auth.jwt()->>'role','')='service_role' or public.has_active_company_membership(public.current_profile_id(),o.company_id)
 or private.profile_has_company_role(public.current_profile_id(),o.company_id,array[]::text[]))
 group by o.company_id,o.cost_center_id,o.budget_category_id,o.budget_month;
$$;

-- CREATE OR REPLACE preserves the existing API grants and security-definer permission checks.
commit;
