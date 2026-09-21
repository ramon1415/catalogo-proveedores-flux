-- DEV: Nómina deja de depender de presupuesto/aprobador.
-- Flujo nuevo: materializar -> Finanzas revisa montos -> confirmar -> dispersión/comprobantes.
-- No ejecuta pagos; sólo cambia el gate de negocio de la corrida.

begin;

-- 1) Partida técnica no presupuestal exclusiva de Nómina.
insert into public.budget_categories(code,name,category,budget_type,active,no_presupuestal)
values('PAYROLL_NON_BUDGET','Nómina · no presupuestal','Recursos Humanos',null,true,true)
on conflict (code) do update
set name=excluded.name,
    category=excluded.category,
    active=true,
    no_presupuestal=true,
    updated_at=now();

-- Relación de catálogo para empresas/centros con módulo Nómina activo.
insert into public.company_cost_center_budget_categories(company_id,cost_center_id,budget_category_id,active)
select cc.company_id,cc.cost_center_id,bc.id,true
from public.company_cost_centers cc
join public.budget_categories bc on bc.code='PAYROLL_NON_BUDGET'
where cc.active
  and exists (
    select 1 from public.company_modules cm
    where cm.company_id=cc.company_id
      and cm.module_key='nomina'
      and cm.enabled
  )
on conflict (company_id,cost_center_id,budget_category_id)
do update set active=true;

-- 2) Toda NUEVA payment_request de Nómina recibe automáticamente el contexto
-- no presupuestal. No se reescriben solicitudes históricas ya materializadas.
create or replace function public.payroll_force_non_budget_context()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_category_id uuid;
begin
  if new.request_type::text <> 'nomina' then
    return new;
  end if;

  select id into v_category_id
  from public.budget_categories
  where code='PAYROLL_NON_BUDGET' and active and no_presupuestal
  limit 1;

  if v_category_id is null then
    raise exception 'PAYROLL_NON_BUDGET_CATEGORY_REQUIRED';
  end if;

  new.budget_category_id := v_category_id;
  new.budget_month := date_trunc('month',coalesce(new.payroll_period_start,current_date))::date;
  return new;
end;
$function$;

drop trigger if exists yy_payroll_force_non_budget_context on public.payment_requests;
create trigger yy_payroll_force_non_budget_context
before insert on public.payment_requests
for each row
execute function public.payroll_force_non_budget_context();

-- 3) Gate de estado: para Nómina nueva se permite draft -> approved ÚNICAMENTE
-- mediante confirm_payroll_finance_review. Se conserva el flujo legacy
-- draft -> submitted para solicitudes históricas que NO sean no-presupuestales.
create or replace function public.guard_payroll_request_status_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_actor uuid := public.current_profile_id();
  v_channel_count integer;
  v_ready_count integer;
begin
  if old.request_type::text<>'nomina' or new.status is not distinct from old.status then
    return new;
  end if;

  if old.status::text='draft' then
    -- Flujo nuevo: confirmación explícita de Finanzas, sin presupuesto ni aprobador.
    if new.status::text='approved' then
      if current_setting('app.payroll_finance_confirm',true) is distinct from old.id::text then
        raise exception 'PAYROLL_FINANCE_CONFIRM_RPC_REQUIRED';
      end if;
      if v_actor is null or not public.payroll_has_finance_pii_access() then
        raise exception 'PAYROLL_FINANCE_REQUIRED';
      end if;
      if not public.has_active_company_membership(v_actor,old.company_id) then
        raise exception 'PAYROLL_FINANCE_CONFIRM_COMPANY_MEMBERSHIP_REQUIRED';
      end if;
      if not public.payroll_request_has_valid_materialization(old.id) then
        raise exception 'PAYROLL_VALID_MATERIALIZATION_REQUIRED';
      end if;
      if not old.no_presupuestal then
        raise exception 'PAYROLL_NON_BUDGET_CONTEXT_REQUIRED';
      end if;
      if exists(
        select 1 from public.payroll_channels c
        where c.payment_request_id=old.id
          and c.channel='vales'
          and c.amount is distinct from c.expected_funding_amount
          and c.funding_variance_acknowledged_at is null
      ) then
        raise exception 'PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED';
      end if;
      if new.approver_id is not null
         or new.approver_assignment_id is not null
         or new.approver_selection_source is not null
         or new.submitted_at is not null then
        raise exception 'PAYROLL_APPROVER_NOT_ALLOWED';
      end if;
      if new.approved_by is distinct from v_actor or new.approved_at is null then
        raise exception 'PAYROLL_FINANCE_CONFIRM_SNAPSHOT_REQUIRED';
      end if;
      return new;
    end if;

    -- Legacy: sólo solicitudes históricas presupuestales pueden seguir a aprobación.
    if new.status::text='submitted' then
      if old.no_presupuestal then
        raise exception 'PAYROLL_APPROVAL_FLOW_DISABLED';
      end if;
      if current_setting('app.payroll_n5a_submit',true) is distinct from old.id::text then
        raise exception 'PAYROLL_BUDGET_SUBMIT_RPC_REQUIRED';
      end if;
      if old.budget_category_id is null
         or old.budget_month is null
         or old.budget_decision<>'aprobable'
         or old.budget_checked_at is null then
        raise exception 'PAYROLL_BUDGET_NOT_APPROVABLE';
      end if;
      if v_actor is null
         or not public.payroll_has_finance_pii_access()
         or old.requested_by is distinct from v_actor
         or new.approver_id is null
         or new.approver_selection_source is null
         or new.submitted_at is null
         or not public.payroll_request_has_valid_materialization(old.id) then
        raise exception 'PAYROLL_NOT_READY_FOR_SUBMISSION';
      end if;
      return new;
    end if;

    raise exception 'PAYROLL_STATUS_TRANSITION_NOT_ENABLED';
  end if;

  -- Compatibilidad con solicitudes legacy ya enviadas a aprobación.
  if old.status::text='submitted' then
    if new.status::text not in ('approved','rejected','changes_requested') then
      raise exception 'PAYROLL_INVALID_APPROVAL_STATUS_TRANSITION';
    end if;
    if v_actor is null or old.approver_id is distinct from v_actor then
      raise exception 'selected_approver_only';
    end if;
    if not exists (
      select 1 from public.payment_request_approvals a
      where a.payment_request_id=old.id
        and a.actor_profile_id=v_actor
        and a.from_status='submitted'
        and a.to_status=new.status::text
        and a.created_at>=transaction_timestamp()
    ) then
      raise exception 'PAYROLL_DECISION_RECORD_REQUIRED';
    end if;
    return new;
  end if;

  if old.status::text='approved' then
    if new.status::text<>'paid' then
      raise exception 'PAYROLL_POST_DECISION_TRANSITION_NOT_ENABLED';
    end if;
    if current_setting('app.payroll_n4b_close_request',true) is distinct from old.id::text then
      raise exception 'PAYROLL_PAID_CLOSE_RPC_REQUIRED';
    end if;
    if v_actor is null or not public.payroll_has_finance_pii_access() then
      raise exception 'PAYROLL_FINANCE_REQUIRED';
    end if;
    if not public.has_active_company_membership(v_actor,old.company_id) then
      raise exception 'PAYROLL_PAID_COMPANY_MEMBERSHIP_REQUIRED';
    end if;
    if not public.payroll_request_has_valid_materialization(old.id) then
      raise exception 'PAYROLL_PAID_MATERIALIZATION_REQUIRED';
    end if;

    select count(*)::integer,
           count(*) filter(where channel.dispersion_status='dispersed'
                              and channel.reconciliation_status='reconciled'
                              and channel.receipt_file_id is not null
                              and file.id is not null
                              and file.parsing_status='parsed'
                              and file.parsing_version='payroll-channel-receipt-v1')::integer
      into v_channel_count,v_ready_count
    from public.payroll_channels channel
    left join public.payroll_run_files file on file.id=channel.receipt_file_id
    where channel.payment_request_id=old.id;

    if v_channel_count=0 or v_ready_count<>v_channel_count then
      raise exception 'PAYROLL_PAID_RECONCILIATION_REQUIRED';
    end if;
    if new.paid_at is null or new.paid_by is distinct from v_actor then
      raise exception 'PAYROLL_PAID_SNAPSHOT_REQUIRED';
    end if;
    return new;
  end if;

  if old.status::text in ('rejected','changes_requested') then
    raise exception 'PAYROLL_POST_DECISION_TRANSITION_NOT_ENABLED';
  end if;
  raise exception 'PAYROLL_STATUS_TRANSITION_NOT_ENABLED';
end;
$function$;

-- 4) Acción explícita que sustituye la aprobación.
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
      approved_at=now(),
      approver_id=null,
      approver_assignment_id=null,
      approver_selection_source=null,
      submitted_at=null
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
