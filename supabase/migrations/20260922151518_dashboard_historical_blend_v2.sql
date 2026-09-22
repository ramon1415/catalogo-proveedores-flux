begin;

-- Universo histórico contable para el dashboard.
-- tipo='G' identifica resultado deudor; cta_mayor=2 excluye contra-ventas
-- como 5080000 Devoluciones sobre Ventas sin hardcodear nombres/códigos.
create or replace view private.dashboard_historical_spend_v2
with (security_invoker = true) as
with hist as (
  select
    ha.company_id,
    replace(ha.account_code, '-', '') as code,
    date_trunc('month', ha.period_month)::date as period_month,
    sum(ha.amount) as amount
  from public.historical_actuals ha
  where ha.company_id is not null
  group by
    ha.company_id,
    replace(ha.account_code, '-', ''),
    date_trunc('month', ha.period_month)::date
),
expense as (
  select h.*
  from hist h
  join public.contpaq_accounts a
    on a.company_id = h.company_id
   and a.code = h.code
  where a.tipo = 'G'
    and a.cta_mayor = 2
),
mapcount as (
  select
    company_id,
    contpaq_account_code,
    count(distinct budget_category_id) as category_count,
    (array_agg(distinct budget_category_id))[1] as single_category_id
  from public.budget_account_mappings
  group by company_id, contpaq_account_code
)
select
  e.company_id,
  e.period_month,
  case
    when m.category_count = 1 then 'partida'
    when m.category_count > 1 then 'por_clasificar'
    else 'sin_partida'
  end::text as classification,
  case when m.category_count = 1 then m.single_category_id else null::uuid end as budget_category_id,
  round(sum(e.amount), 2) as historical_executed,
  count(distinct e.code)::integer as account_count
from expense e
left join mapcount m
  on m.company_id = e.company_id
 and m.contpaq_account_code = e.code
group by
  e.company_id,
  e.period_month,
  case
    when m.category_count = 1 then 'partida'
    when m.category_count > 1 then 'por_clasificar'
    else 'sin_partida'
  end,
  case when m.category_count = 1 then m.single_category_id else null::uuid end;

revoke all on table private.dashboard_historical_spend_v2 from public, anon, authenticated;
grant select on table private.dashboard_historical_spend_v2 to service_role;

comment on view private.dashboard_historical_spend_v2 is
'Clasificación histórica de gasto para dashboard v2. Universo: contpaq_accounts.tipo=G y cta_mayor=2. partida=1 mapeo; por_clasificar=>1; sin_partida=0. No decide completitud mensual.';

create or replace function private.dashboard_global_budget_report_v2(
  p_company_id uuid,
  p_year integer
) returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_result jsonb;
begin
  if auth.uid() is null or v_actor is null then
    raise exception 'not_authenticated';
  end if;

  perform public.dashboard_assert_access();

  if p_company_id is null or not (
    public.has_active_company_membership(v_actor, p_company_id)
    or private.profile_has_company_role(v_actor, p_company_id, array[]::text[])
  ) then
    raise exception 'company_access_required';
  end if;

  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'invalid_year';
  end if;

  with certified_months as (
    select hp.period_month
    from public.historical_actuals_periods hp
    where hp.company_id = p_company_id
      and hp.status = 'certified'
      and hp.period_month >= make_date(p_year, 1, 1)
      and hp.period_month < make_date(p_year + 1, 1, 1)
  ),
  requests as (
    select
      pr.*,
      case
        when upper(btrim(pr.currency)) = 'MXN' then 1::numeric
        when nullif(btrim(pr.currency), '') is not null and pr.exchange_rate > 0
          then pr.exchange_rate
        else null
      end as rate
    from public.payment_requests pr
    where pr.company_id = p_company_id
      and pr.budget_month >= make_date(p_year, 1, 1)
      and pr.budget_month < make_date(p_year + 1, 1, 1)
      and not exists (
        select 1 from certified_months cm where cm.period_month = pr.budget_month
      )
      and (
        pr.status::text in ('approved','finance_validation','scheduled','paid')
        or (
          pr.status::text in ('submitted','pending_approval')
          and pr.budget_decision = 'aprobable'
        )
      )
  ),
  entries as (
    -- El presupuesto siempre permanece; solo cambia la fuente del gasto.
    select
      bl.budget_category_id,
      bl.budget_month,
      'partida'::text as classification,
      bl.amount as budgeted,
      0::numeric as committed,
      0::numeric as executed,
      0::numeric as paid_amount,
      0::numeric as non_budget_used,
      0::numeric as payroll_used,
      0::integer as unconverted_count
    from public.budget_lines bl
    join public.budget_versions bv
      on bv.id = bl.budget_version_id
     and bv.active
    where bl.company_id = p_company_id
      and bl.budget_month >= make_date(p_year, 1, 1)
      and bl.budget_month < make_date(p_year + 1, 1, 1)

    union all

    -- Mes no certificado: conserva exactamente la capa Flux vigente.
    select
      r.budget_category_id,
      r.budget_month,
      case when r.budget_category_id is null then 'sin_partida' else 'partida' end,
      0,
      round(coalesce(r.subtotal_amount, r.amount_requested) * r.rate, 2),
      case
        when r.status::text = 'paid'
          then round(coalesce(r.subtotal_amount, r.amount_requested) * r.rate, 2)
        else 0
      end,
      case
        when r.status::text = 'paid'
          then round(r.amount_requested * r.rate, 2)
        else 0
      end,
      case
        when r.no_presupuestal
          then round(coalesce(r.subtotal_amount, r.amount_requested) * r.rate, 2)
        else 0
      end,
      case
        when r.request_type::text = 'nomina'
          then round(coalesce(r.subtotal_amount, r.amount_requested) * r.rate, 2)
        else 0
      end,
      case when r.rate is null then 1 else 0 end
    from requests r

    union all

    -- IMSS/ISN se suma solo en meses Flux. En un mes certificado el histórico
    -- reemplaza toda la capa de gasto y no se vuelve a sumar payroll_obligations.
    select
      o.budget_category_id,
      o.budget_month,
      case when o.budget_category_id is null then 'sin_partida' else 'partida' end,
      0,
      o.amount_minor / 100::numeric,
      case when o.status = 'paid' then o.amount_minor / 100::numeric else 0 end,
      case when o.status = 'paid' then o.amount_minor / 100::numeric else 0 end,
      case when o.no_presupuestal then o.amount_minor / 100::numeric else 0 end,
      0,
      0
    from public.payroll_obligations o
    where o.company_id = p_company_id
      and o.budget_month >= make_date(p_year, 1, 1)
      and o.budget_month < make_date(p_year + 1, 1, 1)
      and o.status in ('submitted','approved','paid')
      and not exists (
        select 1 from certified_months cm where cm.period_month = o.budget_month
      )

    union all

    -- Mes certificado: histórico es la única fuente de gasto. Como es gasto
    -- contable realizado, committed = executed para que pendiente = 0.
    select
      h.budget_category_id,
      h.period_month,
      h.classification,
      0,
      h.historical_executed,
      h.historical_executed,
      0,
      0,
      0,
      0
    from private.dashboard_historical_spend_v2 h
    join certified_months cm
      on cm.period_month = h.period_month
    where h.company_id = p_company_id
  ),
  totals as (
    select
      budget_category_id,
      budget_month,
      classification,
      sum(budgeted) as budgeted,
      coalesce(sum(committed), 0) as committed,
      coalesce(sum(executed), 0) as executed,
      sum(budgeted) - coalesce(sum(committed), 0) as available,
      coalesce(sum(paid_amount), 0) as paid_amount,
      coalesce(sum(non_budget_used), 0) as non_budget_used,
      coalesce(sum(payroll_used), 0) as payroll_used,
      sum(unconverted_count) as unconverted_count
    from entries
    group by budget_category_id, budget_month, classification
  )
  select coalesce(
    jsonb_agg(
      to_jsonb(t) || jsonb_build_object(
        'data_source',
        case
          when exists (
            select 1 from certified_months cm where cm.period_month = t.budget_month
          ) then 'historical'
          else 'flux'
        end
      )
      order by t.budget_month, t.classification, t.budget_category_id
    ),
    '[]'::jsonb
  )
  into v_result
  from totals t;

  return v_result;
end;
$$;

revoke all on function private.dashboard_global_budget_report_v2(uuid, integer)
  from public, anon;
grant execute on function private.dashboard_global_budget_report_v2(uuid, integer)
  to authenticated, service_role;

create or replace function public.dashboard_global_budget_report_v2(
  p_company_id uuid,
  p_year integer
) returns jsonb
language sql
stable
set search_path to ''
as $$
  select private.dashboard_global_budget_report_v2(p_company_id, p_year);
$$;

revoke all on function public.dashboard_global_budget_report_v2(uuid, integer)
  from public, anon;
grant execute on function public.dashboard_global_budget_report_v2(uuid, integer)
  to authenticated, service_role;

comment on function public.dashboard_global_budget_report_v2(uuid, integer) is
'Dashboard budget report v2. Mes certificado usa historical_actuals como única capa de gasto; mes no certificado conserva Flux. No modifica budget_availability ni el RPC v1.';

commit;
