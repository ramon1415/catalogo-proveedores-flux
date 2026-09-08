-- Serialize normal requests with private obligations only on enabled IMSS/ISN budget scopes.
begin;
set local lock_timeout='5s';
create function private.guard_request_shared_obligation_budget()
returns trigger language plpgsql security definer set search_path='' as $$
declare new_commit numeric; old_commit numeric:=0; available_now numeric;
begin
 if new.no_presupuestal or new.budget_decision is distinct from 'aprobable'
 or new.status::text not in('submitted','pending_approval','approved','finance_validation','scheduled','paid')
 or not exists(select 1 from public.payroll_obligation_settings s where s.company_id=new.company_id
   and s.budget_category_id=new.budget_category_id and s.enabled) then return new; end if;
 new_commit:=coalesce(new.subtotal_amount,new.amount_requested)*coalesce(new.exchange_rate,1);
 if tg_op='UPDATE' and not old.no_presupuestal and old.budget_decision='aprobable'
 and old.status::text in('submitted','pending_approval','approved','finance_validation','scheduled','paid')
 and (old.company_id,old.cost_center_id,old.budget_category_id,old.budget_month)
   is not distinct from (new.company_id,new.cost_center_id,new.budget_category_id,new.budget_month) then
  old_commit:=coalesce(old.subtotal_amount,old.amount_requested)*coalesce(old.exchange_rate,1);
 end if;
 -- Reductions, cancellation and status-only changes cannot consume new funds.
 if new_commit<=old_commit then return new; end if;
 perform 1 from public.budget_lines bl join public.budget_versions bv on bv.id=bl.budget_version_id and bv.active
 where bl.company_id=new.company_id and bl.cost_center_id=new.cost_center_id
 and bl.budget_category_id=new.budget_category_id and bl.budget_month=new.budget_month
 order by bl.id for update of bl;
 if not found then raise exception 'OBLIGATION_BUDGET_LINE_REQUIRED'; end if;
 -- This is a separate statement in a VOLATILE function: refresh the snapshot after waiting for the lock.
 select b.available into available_now from public.budget_availability b
 where b.company_id=new.company_id and b.cost_center_id=new.cost_center_id
 and b.budget_category_id=new.budget_category_id and b.budget_month=new.budget_month;
 if available_now is null or available_now+old_commit<new_commit then
  raise exception using errcode='40001',message='El presupuesto cambió por otra solicitud. Actualiza y vuelve a revisar el monto.';
 end if;
 return new;
end; $$;
revoke all on function private.guard_request_shared_obligation_budget() from public,anon,authenticated,service_role;
-- Run after the existing no-presupuestal snapshot trigger; preserve every existing trigger.
create trigger zzz_request_shared_obligation_budget before insert or update of
 company_id,cost_center_id,budget_category_id,budget_month,amount_requested,subtotal_amount,exchange_rate,status,budget_decision,no_presupuestal
 on public.payment_requests for each row execute function private.guard_request_shared_obligation_budget();
commit;
