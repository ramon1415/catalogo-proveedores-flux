-- Follow-up DEV: la confirmación de Finanzas sólo cambia estado + snapshot de confirmación.
-- Los campos de aprobador ya nacen NULL en la materialización nueva y no deben
-- incluirse en el UPDATE, para no disparar validadores generales de aprobadores.

begin;

create or replace function public.confirm_payroll_finance_review(p_payment_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_category_code text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'PAYROLL_FINANCE_REQUIRED';
  end if;

  select * into v_request
  from public.payment_requests
  where id=p_payment_request_id
  for update;

  if not found or v_request.request_type::text<>'nomina' then
    raise exception 'PAYROLL_REQUEST_REQUIRED';
  end if;

  if not public.has_active_company_membership(v_actor,v_request.company_id) then
    raise exception 'PAYROLL_FINANCE_CONFIRM_COMPANY_MEMBERSHIP_REQUIRED';
  end if;

  if v_request.status::text='approved'
     and v_request.approver_id is null
     and v_request.approved_by is not null then
    return jsonb_build_object(
      'status','already_confirmed',
      'payment_request_id',v_request.id,
      'request_number',v_request.request_number
    );
  end if;

  if v_request.status::text<>'draft' then
    raise exception 'PAYROLL_FINANCE_CONFIRM_REQUIRES_DRAFT';
  end if;

  if not public.payroll_request_has_valid_materialization(v_request.id) then
    raise exception 'PAYROLL_VALID_MATERIALIZATION_REQUIRED';
  end if;

  select code into v_category_code
  from public.budget_categories
  where id=v_request.budget_category_id;

  if not v_request.no_presupuestal or v_category_code is distinct from 'PAYROLL_NON_BUDGET' then
    raise exception 'PAYROLL_NON_BUDGET_CONTEXT_REQUIRED';
  end if;

  if v_request.approver_id is not null
     or v_request.approver_assignment_id is not null
     or v_request.approver_selection_source is not null
     or v_request.submitted_at is not null then
    raise exception 'PAYROLL_APPROVER_NOT_ALLOWED';
  end if;

  if exists(
    select 1 from public.payroll_channels c
    where c.payment_request_id=v_request.id
      and c.channel='vales'
      and c.amount is distinct from c.expected_funding_amount
      and c.funding_variance_acknowledged_at is null
  ) then
    raise exception 'PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED';
  end if;

  perform set_config('app.payroll_finance_confirm',v_request.id::text,true);

  update public.payment_requests
  set status='approved',
      approved_by=v_actor,
      approved_at=now()
  where id=v_request.id;

  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values(
    'payroll_finance_review',
    v_request.id,
    'confirm_amounts',
    jsonb_build_object('status','draft'),
    jsonb_build_object('status','approved','non_budget',true,'payment_execution',false),
    v_actor,
    'Finanzas confirmó los montos de la corrida. Flux no ejecutó pagos.'
  );

  return jsonb_build_object(
    'status','confirmed',
    'payment_request_id',v_request.id,
    'request_number',v_request.request_number,
    'ready_for_dispersion',true
  );
end;
$function$;

revoke all on function public.confirm_payroll_finance_review(uuid) from public,anon;
grant execute on function public.confirm_payroll_finance_review(uuid) to authenticated;

commit;
