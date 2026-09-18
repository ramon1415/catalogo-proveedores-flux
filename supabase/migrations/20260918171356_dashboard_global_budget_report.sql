-- Read-only operational reporting. Approval/payment gates and budget allocations
-- are deliberately unchanged: an authorized overrun is spending, not new budget.
create or replace function private.dashboard_global_budget_report(p_company_id uuid, p_year integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_profile_id(); v_result jsonb;
begin
  if auth.uid() is null or v_actor is null then raise exception 'not_authenticated'; end if;
  perform public.dashboard_assert_access();
  if p_company_id is null or not (
    public.has_active_company_membership(v_actor, p_company_id)
    or private.profile_has_company_role(v_actor, p_company_id, array[]::text[])
  ) then raise exception 'company_access_required'; end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception 'invalid_year'; end if;

  with requests as (
    select pr.*,
      case when upper(btrim(pr.currency)) = 'MXN' then 1::numeric
           when nullif(btrim(pr.currency),'') is not null and pr.exchange_rate > 0
             then pr.exchange_rate else null end as rate
    from public.payment_requests pr
    where pr.company_id=p_company_id
      and pr.budget_month >= make_date(p_year,1,1) and pr.budget_month < make_date(p_year+1,1,1)
      and (pr.status::text in ('approved','finance_validation','scheduled','paid')
        or (pr.status::text in ('submitted','pending_approval') and pr.budget_decision='aprobable'))
  ), entries as (
    select bl.budget_category_id,bl.budget_month,bl.amount as budgeted,
      0::numeric as committed,0::numeric as executed,0::numeric as paid_amount,
      0::numeric as non_budget_used,0::numeric as payroll_used,0::integer as unconverted_count
    from public.budget_lines bl join public.budget_versions bv on bv.id=bl.budget_version_id and bv.active
    where bl.company_id=p_company_id
      and bl.budget_month >= make_date(p_year,1,1) and bl.budget_month < make_date(p_year+1,1,1)
    union all
    select r.budget_category_id,r.budget_month,0,
      round(coalesce(r.subtotal_amount,r.amount_requested)*r.rate,2),
      case when r.status::text='paid' then round(coalesce(r.subtotal_amount,r.amount_requested)*r.rate,2) else 0 end,
      case when r.status::text='paid' then round(r.amount_requested*r.rate,2) else 0 end,
      case when r.no_presupuestal then round(coalesce(r.subtotal_amount,r.amount_requested)*r.rate,2) else 0 end,
      case when r.request_type::text='nomina' then round(coalesce(r.subtotal_amount,r.amount_requested)*r.rate,2) else 0 end,
      case when r.rate is null then 1 else 0 end
    from requests r
    union all
    -- IMSS/ISN live outside payment_requests. Include them once, even without a budget line.
    select o.budget_category_id,o.budget_month,0,o.amount_minor/100::numeric,
      case when o.status='paid' then o.amount_minor/100::numeric else 0 end,
      case when o.status='paid' then o.amount_minor/100::numeric else 0 end,
      case when o.no_presupuestal then o.amount_minor/100::numeric else 0 end,0,0
    from public.payroll_obligations o where o.company_id=p_company_id
      and o.budget_month >= make_date(p_year,1,1) and o.budget_month < make_date(p_year+1,1,1)
      and o.status in ('submitted','approved','paid')
  ), totals as (
    select budget_category_id,budget_month,sum(budgeted) as budgeted,
      coalesce(sum(committed),0) as committed,coalesce(sum(executed),0) as executed,
      sum(budgeted)-coalesce(sum(committed),0) as available,
      coalesce(sum(paid_amount),0) as paid_amount,coalesce(sum(non_budget_used),0) as non_budget_used,
      coalesce(sum(payroll_used),0) as payroll_used,sum(unconverted_count) as unconverted_count
    from entries group by budget_category_id,budget_month
  ) select coalesce(jsonb_agg(to_jsonb(t) order by t.budget_month,t.budget_category_id),'[]'::jsonb)
    into v_result from totals t;
  return v_result;
end;
$$;
revoke all on function private.dashboard_global_budget_report(uuid,integer) from public,anon,authenticated;
grant execute on function private.dashboard_global_budget_report(uuid,integer) to authenticated;

create or replace function public.dashboard_global_budget_report(p_company_id uuid,p_year integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.dashboard_global_budget_report(p_company_id,p_year);
$$;
revoke all on function public.dashboard_global_budget_report(uuid,integer) from public,anon,authenticated;
grant execute on function public.dashboard_global_budget_report(uuid,integer) to authenticated;
