-- Flux Operadora - Migracion 003g
-- Funciones: dashboard_period_key, dashboard_period_start, dashboard_period_end, dashboard_assert_access, dashboard_kpis, dashboard_budget_comparison, dashboard_ytd, dashboard_income_members, dashboard_closure_checklist, dashboard_export_payload

CREATE OR REPLACE FUNCTION public.dashboard_period_key(p_period_key text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$

  select coalesce(nullif(trim(p_period_key), ''), to_char(current_date, 'YYYY-MM'));

$function$;

CREATE OR REPLACE FUNCTION public.dashboard_period_start(p_period_key text DEFAULT NULL::text)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$

  select to_date(public.dashboard_period_key(p_period_key) || '-01', 'YYYY-MM-DD');

$function$;

CREATE OR REPLACE FUNCTION public.dashboard_period_end(p_period_key text DEFAULT NULL::text)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$

  select (

    public.dashboard_period_start(p_period_key)

    + interval '1 month'

    - interval '1 day'

  )::date;

$function$;

CREATE OR REPLACE FUNCTION public.dashboard_assert_access()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if not public.current_user_has_role(array[
    'admin',
    'superadmin',
    'sysadmin',
    'system_admin',
    'finance',
    'finanzas',
    'treasury',
    'tesoreria',
    'administracion',
    'approver_2',
    'aprobador_2',
    'direccion',
    'director'
  ]) then
    raise exception 'not_allowed_to_view_dashboard';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_kpis(p_period_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_period_key text := public.dashboard_period_key(p_period_key);

  v_start date := public.dashboard_period_start(p_period_key);

  v_end date := public.dashboard_period_end(p_period_key);



  v_total_requested numeric := 0;

  v_total_approved numeric := 0;

  v_total_paid numeric := 0;

  v_total_pending_payment numeric := 0;

  v_pending_payment_requests integer := 0;

  v_approved_ready_to_operate integer := 0;

  v_active_layouts integer := 0;

  v_confirmed_layouts integer := 0;



  v_active_cash_funds integer := 0;

  v_pending_cash_reconciliation integer := 0;

  v_cash_in_review integer := 0;

  v_overdue_cash_funds integer := 0;

  v_cash_assigned_amount numeric := 0;

  v_cash_verified_amount numeric := 0;

  v_cash_pending_amount numeric := 0;



  v_active_members integer := 0;

  v_maintenance_expected numeric := 0;

  v_maintenance_collected numeric := 0;

  v_maintenance_pending numeric := 0;

  v_open_incidents integer := 0;

  v_paid_incidents integer := 0;

  v_issued_invoices integer := 0;

  v_paid_invoices integer := 0;

  v_pending_invoices integer := 0;



  v_closure_status text := 'not_created';

  v_closure_closed_at timestamptz := null;

  v_last_export_at timestamptz := null;

begin

  perform public.dashboard_assert_access();



  select

    coalesce(sum(pr.amount_requested) filter (

      where coalesce(pr.created_at, pr.updated_at)::date between v_start and v_end

    ), 0),



    coalesce(sum(pr.amount_requested) filter (

      where pr.status in ('approved','finance_validation','scheduled','paid')

        and coalesce(pr.updated_at, pr.created_at)::date between v_start and v_end

    ), 0),



    coalesce(sum(pr.amount_requested) filter (

      where pr.status = 'paid'

        and coalesce(pr.updated_at, pr.created_at)::date between v_start and v_end

    ), 0),



    coalesce(sum(pr.amount_requested) filter (

      where pr.status in ('approved','finance_validation','scheduled')

        and coalesce(pr.updated_at, pr.created_at)::date between v_start and v_end

    ), 0),



    count(*) filter (

      where pr.status in ('submitted','changes_requested','finance_validation')

        and coalesce(pr.updated_at, pr.created_at)::date between v_start and v_end

    ),



    count(*) filter (

      where pr.status = 'approved'

        and coalesce(pr.updated_at, pr.created_at)::date between v_start and v_end

        and not exists (

          select 1

          from public.payment_layout_lines pll

          join public.payment_layouts pl on pl.id = pll.layout_id

          where pll.payment_request_id = pr.id

            and pl.status <> 'cancelled'

        )

        and not exists (

          select 1

          from public.cash_funds cf

          where cf.payment_request_id = pr.id

            and cf.status <> 'cancelled'

        )

    )

  into

    v_total_requested,

    v_total_approved,

    v_total_paid,

    v_total_pending_payment,

    v_pending_payment_requests,

    v_approved_ready_to_operate

  from public.payment_requests pr;



  select

    count(*) filter (

      where status in ('draft','generated','uploaded')

        and coalesce(updated_at, created_at)::date between v_start and v_end

    ),

    count(*) filter (

      where status = 'confirmed'

        and coalesce(updated_at, created_at)::date between v_start and v_end

    )

  into

    v_active_layouts,

    v_confirmed_layouts

  from public.payment_layouts;



  select

    count(*) filter (where status in ('active','pending_receipt','blocked','receipt_review')),

    count(*) filter (where status in ('pending_receipt','blocked')),

    count(*) filter (where status = 'receipt_review'),

    count(*) filter (

      where status in ('active','pending_receipt','blocked','receipt_review')

        and due_date < current_date

    ),

    coalesce(sum(assigned_amount), 0),

    coalesce(sum(verified_amount), 0),

    coalesce(sum(pending_amount), 0)

  into

    v_active_cash_funds,

    v_pending_cash_reconciliation,

    v_cash_in_review,

    v_overdue_cash_funds,

    v_cash_assigned_amount,

    v_cash_verified_amount,

    v_cash_pending_amount

  from public.cash_funds

  where assignment_date between v_start and v_end

     or due_date between v_start and v_end

     or status in ('active','pending_receipt','blocked','receipt_review');



  select count(*)

  into v_active_members

  from public.members

  where active = true;



  select

    coalesce(sum(mfc.expected_amount), 0),

    coalesce(sum(mfc.paid_amount), 0),

    coalesce(sum(mfc.pending_amount), 0)

  into

    v_maintenance_expected,

    v_maintenance_collected,

    v_maintenance_pending

  from public.maintenance_fee_charges mfc

  join public.billing_periods bp on bp.id = mfc.billing_period_id

  where bp.cutoff_date between v_start and v_end;



  select

    count(*) filter (where status in ('open','invoiced')),

    count(*) filter (where status = 'paid')

  into

    v_open_incidents,

    v_paid_incidents

  from public.incident_charges

  where incident_date between v_start and v_end;



  select

    count(*) filter (where status = 'issued'),

    count(*) filter (where status = 'paid'),

    count(*) filter (where status = 'issued')

  into

    v_issued_invoices,

    v_paid_invoices,

    v_pending_invoices

  from public.invoices

  where issue_date between v_start and v_end

     or payment_date between v_start and v_end;



  select

    mc.status,

    mc.closed_at

  into

    v_closure_status,

    v_closure_closed_at

  from public.monthly_closures mc

  where mc.period_key = v_period_key;



  if v_closure_status is null then

    v_closure_status := 'not_created';

  end if;



  select max(mce.completed_at)

  into v_last_export_at

  from public.monthly_closure_exports mce

  join public.monthly_closures mc on mc.id = mce.monthly_closure_id

  where mc.period_key = v_period_key

    and mce.status = 'completed';



  return jsonb_build_object(

    'period_key', v_period_key,

    'egresos', jsonb_build_object(

      'total_requested', coalesce(v_total_requested, 0),

      'total_approved', coalesce(v_total_approved, 0),

      'total_paid', coalesce(v_total_paid, 0),

      'total_pending_payment', coalesce(v_total_pending_payment, 0),

      'pending_payment_requests', coalesce(v_pending_payment_requests, 0),

      'approved_ready_to_operate', coalesce(v_approved_ready_to_operate, 0),

      'active_layouts', coalesce(v_active_layouts, 0),

      'confirmed_layouts', coalesce(v_confirmed_layouts, 0)

    ),

    'efectivo', jsonb_build_object(

      'active_cash_funds', coalesce(v_active_cash_funds, 0),

      'pending_cash_reconciliation', coalesce(v_pending_cash_reconciliation, 0),

      'cash_in_review', coalesce(v_cash_in_review, 0),

      'overdue_cash_funds', coalesce(v_overdue_cash_funds, 0),

      'cash_assigned_amount', coalesce(v_cash_assigned_amount, 0),

      'cash_verified_amount', coalesce(v_cash_verified_amount, 0),

      'cash_pending_amount', coalesce(v_cash_pending_amount, 0)

    ),

    'ingresos', jsonb_build_object(

      'active_members', coalesce(v_active_members, 0),

      'maintenance_expected', coalesce(v_maintenance_expected, 0),

      'maintenance_collected', coalesce(v_maintenance_collected, 0),

      'maintenance_pending', coalesce(v_maintenance_pending, 0),

      'open_incidents', coalesce(v_open_incidents, 0),

      'paid_incidents', coalesce(v_paid_incidents, 0),

      'issued_invoices', coalesce(v_issued_invoices, 0),

      'paid_invoices', coalesce(v_paid_invoices, 0),

      'pending_invoices', coalesce(v_pending_invoices, 0)

    ),

    'balance', jsonb_build_object(

      'total_outflows', coalesce(v_total_paid, 0) + coalesce(v_cash_assigned_amount, 0),

      'total_inflows', coalesce(v_maintenance_collected, 0),

      'net_balance', coalesce(v_maintenance_collected, 0) - (coalesce(v_total_paid, 0) + coalesce(v_cash_assigned_amount, 0))

    ),

    'cierre', jsonb_build_object(

      'closure_status', v_closure_status,

      'closure_closed_at', v_closure_closed_at,

      'last_export_at', v_last_export_at

    ),

    'last_updated', now()

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.dashboard_budget_comparison(p_period_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_start date := public.dashboard_period_start(p_period_key);

  v_end date := public.dashboard_period_end(p_period_key);

  v_result jsonb;

begin

  perform public.dashboard_assert_access();



  with grouped as (

    select

      pr.company_id,

      coalesce(c.legal_name, c.name, 'Sin empresa') as company,



      pr.cost_center_id,

      coalesce(cc.name, cc.code, 'Sin centro') as cost_center,



      pr.budget_category_id,

      coalesce(bc.name, bc.category, 'Sin partida') as budget_category,

      coalesce(bc.code, '') as category_code,



      0::numeric as budget_amount,



      coalesce(sum(pr.amount_requested) filter (

        where pr.status in ('approved','finance_validation','scheduled')

      ), 0) as committed_amount,



      coalesce(sum(pr.amount_requested) filter (

        where pr.status = 'paid'

      ), 0) as executed_amount

    from public.payment_requests pr

    left join public.companies c on c.id = pr.company_id

    left join public.cost_centers cc on cc.id = pr.cost_center_id

    left join public.budget_categories bc on bc.id = pr.budget_category_id

    where coalesce(pr.updated_at, pr.created_at)::date between v_start and v_end

    group by

      pr.company_id,

      coalesce(c.legal_name, c.name, 'Sin empresa'),

      pr.cost_center_id,

      coalesce(cc.name, cc.code, 'Sin centro'),

      pr.budget_category_id,

      coalesce(bc.name, bc.category, 'Sin partida'),

      coalesce(bc.code, '')

  )

  select coalesce(

    jsonb_agg(

      jsonb_build_object(

        'company_id', company_id,

        'company', company,

        'cost_center_id', cost_center_id,

        'cost_center', cost_center,

        'budget_category_id', budget_category_id,

        'budget_category', budget_category,

        'category_code', category_code,

        'budget_amount', budget_amount,

        'committed_amount', committed_amount,

        'executed_amount', executed_amount,

        'available_amount', budget_amount - committed_amount - executed_amount,

        'variance_amount', budget_amount - executed_amount,

        'variance_pct',

          case

            when budget_amount > 0 then round(((budget_amount - executed_amount) / budget_amount) * 100, 2)

            else 0

          end

      )

      order by abs(budget_amount - executed_amount) desc, company, cost_center, category_code

    ),

    '[]'::jsonb

  )

  into v_result

  from grouped;



  return v_result;

end;

$function$;

CREATE OR REPLACE FUNCTION public.dashboard_ytd(p_year integer DEFAULT NULL::integer, p_through_month integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_year integer := coalesce(p_year, extract(year from current_date)::integer);

  v_month integer := coalesce(p_through_month, extract(month from current_date)::integer);

  v_start date;

  v_end date;

  v_result jsonb;

begin

  perform public.dashboard_assert_access();



  if v_month < 1 or v_month > 12 then

    raise exception 'invalid_month';

  end if;



  v_start := make_date(v_year, 1, 1);

  v_end := (make_date(v_year, v_month, 1) + interval '1 month' - interval '1 day')::date;



  with grouped as (

    select

      coalesce(c.legal_name, c.name, 'Sin empresa') as company,

      coalesce(cc.name, cc.code, 'Sin centro') as cost_center,

      coalesce(bc.name, bc.category, 'Sin partida') as budget_category,



      0::numeric as ytd_budget,



      coalesce(sum(pr.amount_requested) filter (

        where pr.status in ('approved','finance_validation','scheduled')

      ), 0) as ytd_committed,



      coalesce(sum(pr.amount_requested) filter (

        where pr.status = 'paid'

      ), 0) as ytd_executed

    from public.payment_requests pr

    left join public.companies c on c.id = pr.company_id

    left join public.cost_centers cc on cc.id = pr.cost_center_id

    left join public.budget_categories bc on bc.id = pr.budget_category_id

    where coalesce(pr.updated_at, pr.created_at)::date between v_start and v_end

    group by

      coalesce(c.legal_name, c.name, 'Sin empresa'),

      coalesce(cc.name, cc.code, 'Sin centro'),

      coalesce(bc.name, bc.category, 'Sin partida')

  )

  select coalesce(

    jsonb_agg(

      jsonb_build_object(

        'company', company,

        'cost_center', cost_center,

        'budget_category', budget_category,

        'ytd_budget', ytd_budget,

        'ytd_committed', ytd_committed,

        'ytd_executed', ytd_executed,

        'ytd_available', ytd_budget - ytd_committed - ytd_executed,

        'ytd_variance_amount', ytd_budget - ytd_executed,

        'ytd_variance_pct',

          case

            when ytd_budget > 0 then round(((ytd_budget - ytd_executed) / ytd_budget) * 100, 2)

            else 0

          end

      )

      order by abs(ytd_budget - ytd_executed) desc, company, cost_center, budget_category

    ),

    '[]'::jsonb

  )

  into v_result

  from grouped;



  return v_result;

end;

$function$;

CREATE OR REPLACE FUNCTION public.dashboard_income_members(p_year integer DEFAULT NULL::integer, p_period_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_year integer := coalesce(p_year, extract(year from current_date)::integer);

  v_start date;

  v_end date;

  v_result jsonb;

begin

  perform public.dashboard_assert_access();



  if p_period_key is not null then

    v_start := public.dashboard_period_start(p_period_key);

    v_end := public.dashboard_period_end(p_period_key);

  else

    v_start := make_date(v_year, 1, 1);

    v_end := make_date(v_year, 12, 31);

  end if;



  with base as (

    select

      m.id as member_id,

      m.full_name as member_name,

      m.lineage,

      bp.name as billing_period,

      bp.cutoff_date,

      mfc.expected_amount,

      mfc.paid_amount,

      mfc.pending_amount,

      mfc.status,

      mfc.invoice_id

    from public.maintenance_fee_charges mfc

    join public.members m on m.id = mfc.member_id

    join public.billing_periods bp on bp.id = mfc.billing_period_id

    where bp.cutoff_date between v_start and v_end

  )

  select coalesce(

    jsonb_agg(

      jsonb_build_object(

        'member_id', b.member_id,

        'member_name', b.member_name,

        'lineage', b.lineage,

        'billing_period', b.billing_period,

        'cutoff_date', b.cutoff_date,

        'expected_amount', coalesce(b.expected_amount, 0),

        'paid_amount', coalesce(b.paid_amount, 0),

        'pending_amount', coalesce(b.pending_amount, 0),

        'status', b.status,

        'open_incidents', coalesce((

          select count(*)

          from public.incident_charges ic

          where ic.member_id = b.member_id

            and ic.status in ('open','invoiced')

            and ic.incident_date between v_start and v_end

        ), 0),

        'paid_incidents', coalesce((

          select count(*)

          from public.incident_charges ic

          where ic.member_id = b.member_id

            and ic.status = 'paid'

            and ic.incident_date between v_start and v_end

        ), 0),

        'issued_invoices', coalesce((

          select count(*)

          from public.invoices inv

          where inv.member_id = b.member_id

            and inv.status = 'issued'

            and inv.issue_date between v_start and v_end

        ), 0),

        'paid_invoices', coalesce((

          select count(*)

          from public.invoices inv

          where inv.member_id = b.member_id

            and inv.status = 'paid'

            and coalesce(inv.payment_date, inv.issue_date) between v_start and v_end

        ), 0)

      )

      order by b.member_name, b.cutoff_date

    ),

    '[]'::jsonb

  )

  into v_result

  from base b;



  return v_result;

end;

$function$;

CREATE OR REPLACE FUNCTION public.dashboard_closure_checklist(p_period_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_start date;

  v_end date;



  v_pending_payment_requests integer := 0;

  v_approved_without_operation integer := 0;

  v_unconfirmed_layouts integer := 0;

  v_unpaid_approved_requests integer := 0;

  v_overdue_cash_funds integer := 0;

  v_cash_reconciliations_in_review integer := 0;

  v_open_incidents integer := 0;

  v_issued_unpaid_invoices integer := 0;

  v_overdue_maintenance_fees integer := 0;

  v_missing_budget_comments integer := 0;



  v_blocking_reasons jsonb := '[]'::jsonb;

  v_warnings jsonb := '[]'::jsonb;

  v_can_close boolean := true;

begin

  perform public.dashboard_assert_access();



  if p_period_key is null or trim(p_period_key) = '' then

    raise exception 'period_key_required';

  end if;



  v_start := public.dashboard_period_start(p_period_key);

  v_end := public.dashboard_period_end(p_period_key);



  select count(*)

  into v_pending_payment_requests

  from public.payment_requests pr

  where pr.status in ('submitted','changes_requested','finance_validation')

    and coalesce(pr.updated_at, pr.created_at)::date between v_start and v_end;



  select count(*)

  into v_approved_without_operation

  from public.payment_requests pr

  where pr.status = 'approved'

    and coalesce(pr.updated_at, pr.created_at)::date between v_start and v_end

    and not exists (

      select 1

      from public.payment_layout_lines pll

      join public.payment_layouts pl on pl.id = pll.layout_id

      where pll.payment_request_id = pr.id

        and pl.status <> 'cancelled'

    )

    and not exists (

      select 1

      from public.cash_funds cf

      where cf.payment_request_id = pr.id

        and cf.status <> 'cancelled'

    )

    and not exists (

      select 1

      from public.payment_receipts prc

      where prc.payment_request_id = pr.id

    );



  select count(*)

  into v_unconfirmed_layouts

  from public.payment_layouts pl

  where pl.status in ('generated','uploaded')

    and coalesce(pl.updated_at, pl.created_at)::date between v_start and v_end;



  select count(*)

  into v_unpaid_approved_requests

  from public.payment_requests pr

  where pr.status in ('approved','scheduled','finance_validation')

    and coalesce(pr.updated_at, pr.created_at)::date between v_start and v_end;



  select count(*)

  into v_overdue_cash_funds

  from public.cash_funds cf

  where cf.status in ('active','pending_receipt','blocked','receipt_review')

    and cf.due_date < current_date;



  select count(*)

  into v_cash_reconciliations_in_review

  from public.cash_reconciliations cr

  where cr.status = 'submitted';



  select count(*)

  into v_open_incidents

  from public.incident_charges ic

  where ic.status = 'open'

    and ic.incident_date between v_start and v_end;



  select count(*)

  into v_issued_unpaid_invoices

  from public.invoices inv

  where inv.status = 'issued'

    and inv.issue_date between v_start and v_end;



  select count(*)

  into v_overdue_maintenance_fees

  from public.maintenance_fee_charges mfc

  join public.billing_periods bp on bp.id = mfc.billing_period_id

  where mfc.status = 'overdue'

    and bp.cutoff_date <= v_end;



  v_missing_budget_comments := 0;

  v_warnings := v_warnings || jsonb_build_array(

    'budget_variance_comment_check_pending_model_confirmation'

  );



  if v_pending_payment_requests > 0 then

    v_blocking_reasons := v_blocking_reasons || jsonb_build_array('pending_payment_requests');

  end if;



  if v_approved_without_operation > 0 then

    v_blocking_reasons := v_blocking_reasons || jsonb_build_array('approved_without_operation');

  end if;



  if v_unconfirmed_layouts > 0 then

    v_blocking_reasons := v_blocking_reasons || jsonb_build_array('unconfirmed_layouts');

  end if;



  if v_unpaid_approved_requests > 0 then

    v_blocking_reasons := v_blocking_reasons || jsonb_build_array('unpaid_approved_requests');

  end if;



  if v_overdue_cash_funds > 0 then

    v_blocking_reasons := v_blocking_reasons || jsonb_build_array('overdue_cash_funds');

  end if;



  if v_cash_reconciliations_in_review > 0 then

    v_blocking_reasons := v_blocking_reasons || jsonb_build_array('cash_reconciliations_in_review');

  end if;



  if v_open_incidents > 0 then

    v_blocking_reasons := v_blocking_reasons || jsonb_build_array('open_incidents');

  end if;



  if v_issued_unpaid_invoices > 0 then

    v_blocking_reasons := v_blocking_reasons || jsonb_build_array('issued_unpaid_invoices');

  end if;



  if v_overdue_maintenance_fees > 0 then

    v_blocking_reasons := v_blocking_reasons || jsonb_build_array('overdue_maintenance_fees');

  end if;



  v_can_close := jsonb_array_length(v_blocking_reasons) = 0;



  return jsonb_build_object(

    'period_key', p_period_key,

    'can_close', v_can_close,

    'blocking_reasons', v_blocking_reasons,

    'warnings', v_warnings,

    'checks', jsonb_build_object(

      'pending_payment_requests', v_pending_payment_requests,

      'approved_without_operation', v_approved_without_operation,

      'unconfirmed_layouts', v_unconfirmed_layouts,

      'unpaid_approved_requests', v_unpaid_approved_requests,

      'overdue_cash_funds', v_overdue_cash_funds,

      'cash_reconciliations_in_review', v_cash_reconciliations_in_review,

      'open_incidents', v_open_incidents,

      'issued_unpaid_invoices', v_issued_unpaid_invoices,

      'overdue_maintenance_fees', v_overdue_maintenance_fees,

      'missing_budget_comments', v_missing_budget_comments

    )

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.dashboard_export_payload(p_period_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_period_key text := public.dashboard_period_key(p_period_key);

  v_year integer;

  v_month integer;



  v_kpis jsonb;

  v_budget jsonb;

  v_ytd jsonb;

  v_income jsonb;

  v_checklist jsonb;

  v_comments jsonb;

  v_top_variances jsonb;

begin

  perform public.dashboard_assert_access();



  if p_period_key is null or trim(p_period_key) = '' then

    raise exception 'period_key_required';

  end if;



  v_year := split_part(v_period_key, '-', 1)::integer;

  v_month := split_part(v_period_key, '-', 2)::integer;



  v_kpis := public.dashboard_kpis(v_period_key);

  v_budget := public.dashboard_budget_comparison(v_period_key);

  v_ytd := public.dashboard_ytd(v_year, v_month);

  v_income := public.dashboard_income_members(v_year, v_period_key);

  v_checklist := public.dashboard_closure_checklist(v_period_key);



  select coalesce(

    jsonb_agg(

      jsonb_build_object(

        'section', mcc.section,

        'comment', mcc.comment,

        'created_by', mcc.created_by,

        'created_at', mcc.created_at

      )

      order by mcc.section, mcc.created_at

    ),

    '[]'::jsonb

  )

  into v_comments

  from public.monthly_closure_comments mcc

  join public.monthly_closures mc on mc.id = mcc.monthly_closure_id

  where mc.period_key = v_period_key;



  select coalesce(

    jsonb_agg(item order by abs(coalesce((item->>'variance_amount')::numeric, 0)) desc),

    '[]'::jsonb

  )

  into v_top_variances

  from (

    select item

    from jsonb_array_elements(v_budget) as item

    order by abs(coalesce((item->>'variance_amount')::numeric, 0)) desc

    limit 10

  ) s;



  return jsonb_build_object(

    'metadata', jsonb_build_object(

      'generated_at', now(),

      'period_key', v_period_key,

      'year', v_year,

      'month', v_month

    ),

    'kpis', v_kpis,

    'budget_comparison', v_budget,

    'ytd', v_ytd,

    'income_members', v_income,

    'closure_checklist', v_checklist,

    'closure_comments', v_comments,

    'top_variances', v_top_variances

  );

end;

$function$;
