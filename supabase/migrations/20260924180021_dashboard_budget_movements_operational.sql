-- Read-only drilldown; same access checks and consumption rules
-- as the operational dashboard_global_budget_report in PROD.
-- No historical-blend dependencies, changes to payments, or budget gates.
begin;
create function private.dashboard_budget_movements(
  p_company_id uuid, p_year integer, p_category_key text, p_month date default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_profile_id();
  v_category uuid;
  v_start date;
  v_end date;
  v_rows jsonb;
begin
  if auth.uid() is null or v_actor is null then raise exception 'not_authenticated'; end if;
  perform public.dashboard_assert_access();
  if p_company_id is null or not (
    public.has_active_company_membership(v_actor,p_company_id)
    or private.profile_has_company_role(v_actor,p_company_id,array[]::text[])
  ) then raise exception 'company_access_required'; end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception 'invalid_year'; end if;
  if p_category_key is null or btrim(p_category_key) = '' then raise exception 'invalid_category'; end if;
  if p_category_key not in ('__sin_partida__','__por_clasificar__') then
    v_category := p_category_key::uuid;
  end if;
  if p_month is not null and (extract(year from p_month) <> p_year or extract(day from p_month) <> 1) then
    raise exception 'invalid_month';
  end if;
  v_start := coalesce(p_month, make_date(p_year,1,1));
  v_end := case when p_month is null then make_date(p_year+1,1,1) else (p_month + interval '1 month')::date end;
  with requests as (
    select pr.*, case when upper(btrim(pr.currency))='MXN' then 1::numeric
      when nullif(btrim(pr.currency),'') is not null and pr.exchange_rate>0 then pr.exchange_rate else null end as rate
    from public.payment_requests pr
    where pr.company_id=p_company_id and pr.budget_month>=v_start and pr.budget_month<v_end
      and p_category_key<>'__por_clasificar__' and pr.budget_category_id is not distinct from v_category
      and (pr.status::text in ('approved','finance_validation','scheduled','paid')
        or (pr.status::text in ('submitted','pending_approval') and pr.budget_decision='aprobable'))
  ), movements as (
    select r.id::text as id, 'request'::text as source, r.request_number::text as reference,
      coalesce(nullif(p.alias,''),nullif(p.nombre_completo,''),case when r.request_type::text='nomina' then 'Nómina' else 'Sin proveedor' end) as title,
      coalesce(r.description,'') as description, coalesce(r.submitted_at,r.created_at)::date as date,
      r.budget_month, r.status::text as status,
      round(coalesce(r.subtotal_amount,r.amount_requested)*r.rate,2) as amount
    from requests r left join public.proveedores p on p.id=r.proveedor_id
    union all
    select o.id::text, 'obligation', upper(o.kind), upper(o.kind), 'Obligación de nómina',
      coalesce(o.submitted_at,o.created_at)::date,o.budget_month,o.status,o.amount_minor/100::numeric
    from public.payroll_obligations o
    where o.company_id=p_company_id and o.budget_month>=v_start and o.budget_month<v_end
      and p_category_key<>'__por_clasificar__' and o.budget_category_id is not distinct from v_category
      and o.status in ('submitted','approved','paid')

  )
  select coalesce(jsonb_agg(to_jsonb(m) order by m.date desc,m.source,m.id),'[]'::jsonb) into v_rows from movements m;
  if exists(select 1 from jsonb_array_elements(v_rows) r where r->>'amount' is null) then
    raise exception 'budget_movements_conversion_missing';
  end if;
  return v_rows;
end;
$$;
revoke all on function private.dashboard_budget_movements(uuid,integer,text,date) from public,anon;
grant execute on function private.dashboard_budget_movements(uuid,integer,text,date) to authenticated,service_role;
create function public.dashboard_budget_movements(p_company_id uuid,p_year integer,p_category_key text,p_month date default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.dashboard_budget_movements(p_company_id,p_year,p_category_key,p_month);
$$;
revoke all on function public.dashboard_budget_movements(uuid,integer,text,date) from public,anon;
grant execute on function public.dashboard_budget_movements(uuid,integer,text,date) to authenticated,service_role;
commit;
