-- Nómina: restaurar el flujo propio de pago decidido con Contraloría/RH.
-- DEV candidate. Nómina NO entra a los cortes semanales ordinarios.
-- Flujo: materializar -> confirmar montos -> pago por canales -> comprobantes -> cierre contable.
-- El constraint de snapshot vigente ya acepta la confirmación directa no presupuestal;
-- esta migración no lo recrea para evitar drift con columnas históricas retiradas.

begin;

create or replace function public.payroll_uses_weekly_cut_flow(p_payment_request_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$ select false; $$;

create or replace function public.payroll_weekly_cut_eligibility(p_payment_request_id uuid,p_exclude_batch_id uuid default null)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('eligible',false,'classification','separate_payroll_flow','reason','payroll_uses_separate_flow','payment_request_id',p_payment_request_id);
$$;

create or replace function public.payroll_ready_for_dispersion(p_payment_request_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(
    select 1 from public.payment_requests request
    where request.id=p_payment_request_id and request.request_type::text='nomina'
      and request.status::text='approved' and request.approved_by is not null and request.approved_at is not null
      and public.payroll_request_has_valid_materialization(request.id)
      and not exists(
        select 1 from public.payroll_channels channel
        where channel.payment_request_id=request.id and channel.channel='vales'
          and channel.amount is distinct from channel.expected_funding_amount
          and channel.funding_variance_acknowledged_at is null
      )
  );
$$;

create or replace function public.confirm_payroll_finance_review(p_payment_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_category_code text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_FINANCE_CONFIRM_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if v_request.status::text='approved' and v_request.approver_id is null and v_request.approved_by is not null then
    return jsonb_build_object('status','already_confirmed','payment_request_id',v_request.id,'request_number',v_request.request_number,'payment_ready',public.payroll_ready_for_dispersion(v_request.id),'payment_flow_state','ready_for_payment','ready_for_dispersion',public.payroll_ready_for_dispersion(v_request.id));
  end if;
  if v_request.status::text<>'draft' then raise exception 'PAYROLL_FINANCE_CONFIRM_REQUIRES_DRAFT'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_VALID_MATERIALIZATION_REQUIRED'; end if;
  select code into v_category_code from public.budget_categories where id=v_request.budget_category_id;
  if not v_request.no_presupuestal or v_category_code is distinct from 'PAYROLL_NON_BUDGET' then raise exception 'PAYROLL_NON_BUDGET_CONTEXT_REQUIRED'; end if;
  if v_request.approver_id is not null or v_request.approver_assignment_id is not null or v_request.approver_selection_source is not null or v_request.submitted_at is not null then raise exception 'PAYROLL_APPROVER_NOT_ALLOWED'; end if;
  if exists(select 1 from public.payroll_channels channel where channel.payment_request_id=v_request.id and channel.channel='vales' and channel.amount is distinct from channel.expected_funding_amount and channel.funding_variance_acknowledged_at is null) then raise exception 'PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED'; end if;
  perform set_config('app.payroll_finance_confirm',v_request.id::text,true);
  update public.payment_requests set status='approved',approved_by=v_actor,approved_at=now() where id=v_request.id;
  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values('payroll_finance_review',v_request.id,'confirm_amounts',jsonb_build_object('status','draft'),jsonb_build_object('status','approved','non_budget',true,'payment_flow_state','ready_for_payment','payment_execution',false),v_actor,'Finanzas confirmó los montos. La corrida quedó lista para su flujo propio de pago; no se envió a corte semanal y Flux no ejecutó pagos.');
  return jsonb_build_object('status','confirmed','payment_request_id',v_request.id,'request_number',v_request.request_number,'payment_ready',true,'payment_flow_state','ready_for_payment','ready_for_dispersion',true);
end; $$;

create or replace function public.get_payroll_submission_summary(p_payment_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_employee_net numeric; v_channels jsonb; v_category_code text; v_direct_flow boolean:=false; v_payment_ready boolean:=false; v_flow_state text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_SUBMIT_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  select code into v_category_code from public.budget_categories where id=v_request.budget_category_id;
  v_direct_flow:=coalesce(v_request.no_presupuestal,false) and v_category_code='PAYROLL_NON_BUDGET' and v_request.approver_id is null and v_request.submitted_at is null;
  v_payment_ready:=public.payroll_ready_for_dispersion(v_request.id);
  v_flow_state:=case when v_direct_flow and v_request.status::text='draft' then 'pending_finance_confirmation' when v_payment_ready then 'ready_for_payment' when v_request.status::text='approved' then 'payment_blocked' else v_request.status::text end;
  select coalesce(sum(net_amount),0) into v_employee_net from public.payroll_run_lines where payment_request_id=v_request.id;
  select coalesce(jsonb_agg(jsonb_build_object('channel',channel.channel,'amount',channel.amount,'benefit_amount',channel.benefit_amount,'fee_amount',channel.fee_amount,'tax_amount',channel.tax_amount,'expected_funding_amount',channel.expected_funding_amount,'funding_variance',case when channel.channel='vales' then channel.amount-channel.expected_funding_amount else null end,'funding_variance_acknowledged',channel.funding_variance_acknowledged_at is not null,'funding_variance_acknowledged_at',channel.funding_variance_acknowledged_at) order by channel.channel),'[]'::jsonb) into v_channels from public.payroll_channels channel where channel.payment_request_id=v_request.id;
  return jsonb_build_object('payment_request_id',v_request.id,'request_number',v_request.request_number,'status',v_request.status,'company_id',v_request.company_id,'cost_center_id',v_request.cost_center_id,'amount_requested',v_request.amount_requested,'employee_net',v_employee_net,'currency',v_request.currency,'payroll_subtype',v_request.payroll_subtype,'period_start',v_request.payroll_period_start,'period_end',v_request.payroll_period_end,'approver_id',v_request.approver_id,'approver_assignment_id',v_request.approver_assignment_id,'approver_selection_source',v_request.approver_selection_source,'submitted_at',v_request.submitted_at,'budget_category_id',v_request.budget_category_id,'budget_month',v_request.budget_month,'budget_decision',v_request.budget_decision,'budget_block_reason',v_request.budget_block_reason,'budget_available_before',v_request.budget_available_before,'budget_available_after',v_request.budget_available_after,'budget_shortfall',v_request.budget_shortfall,'budget_checked_at',v_request.budget_checked_at,'budget_ready',(coalesce(v_request.no_presupuestal,false) or (v_request.budget_decision='aprobable' and v_request.budget_category_id is not null and v_request.budget_month is not null)),'finance_confirmation_pending',(v_direct_flow and v_request.status::text='draft'),'payment_ready',v_payment_ready,'payment_flow_state',v_flow_state,'channels',v_channels);
end; $$;

create or replace function public.get_payroll_capture_sessions_unscoped_internal(p_session_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if public.current_profile_id() is null or not public.payroll_has_finance_pii_access() then raise exception 'payroll_capture_finance_required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',session.id,'company_id',session.company_id,'company_bank_account_id',session.company_bank_account_id,'cost_center_id',session.cost_center_id,'budget_category_id',session.budget_category_id,'budget_month',session.budget_month,'payroll_subtype',session.payroll_subtype,'period_start',session.period_start,'period_end',session.period_end,'concept',session.concept,'notes',session.notes,'expected_channels',session.expected_channels,'capture_state',session.capture_state,'validation_status',session.validation_status,'version',session.version,'expires_at',session.expires_at,'updated_at',session.updated_at,'materialized_payment_request_id',session.materialized_payment_request_id,'materialized_at',session.materialized_at,'server_verification_summary',session.server_verification_summary,'payment_request_number',request.request_number,'payment_request_status',request.status::text,'finance_confirmation_pending',coalesce(request.request_type::text='nomina' and request.status::text='draft' and request.no_presupuestal and request.approver_id is null and request.submitted_at is null,false),'payment_ready',case when request.id is null then false else public.payroll_ready_for_dispersion(request.id) end,'payment_flow_state',case when request.id is null then null when request.status::text='draft' and request.no_presupuestal and request.approver_id is null then 'pending_finance_confirmation' when public.payroll_ready_for_dispersion(request.id) then 'ready_for_payment' when request.status::text='approved' then 'payment_blocked' else request.status::text end,'files',coalesce((select jsonb_agg(jsonb_build_object('id',file.id,'kind',file.kind,'channel',file.channel,'capability_code',file.capability_code,'parsing_status',file.parsing_status,'validation_authority',file.validation_authority,'parser_version',file.parser_version,'parser_contract',file.parser_contract,'record_count',file.record_count,'total_amount_minor',file.total_amount_minor,'issue_codes',file.issue_codes,'uploaded_at',file.uploaded_at) order by file.uploaded_at desc) from public.payroll_capture_files file where file.session_id=session.id and file.upload_state='uploaded' and file.is_current),'[]'::jsonb)) order by session.updated_at desc) from (select * from public.payroll_capture_sessions where (p_session_id is null or id=p_session_id) and expires_at>now() order by updated_at desc limit 50) session left join public.payment_requests request on request.id=session.materialized_payment_request_id),'[]'::jsonb);
end; $$;

create or replace function public.get_payroll_dispersion_summary(p_payment_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_company_name text; v_channels jsonb; v_channel_count integer:=0; v_pending_count integer:=0; v_dispersed_count integer:=0; v_failed_count integer:=0; v_overall_status text:='not_ready'; v_action_allowed boolean:=false; v_payment_ready boolean:=false;
begin
  if v_actor is null then raise exception 'PAYROLL_AUTH_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  select company.name into v_company_name from public.companies company where company.id=v_request.company_id;
  if not public.payroll_can_read_summary(v_request.id) then raise exception 'PAYROLL_SUMMARY_ACCESS_DENIED'; end if;
  select count(*)::integer,count(*) filter(where channel.dispersion_status='pending')::integer,count(*) filter(where channel.dispersion_status='dispersed')::integer,count(*) filter(where channel.dispersion_status='failed')::integer,coalesce(jsonb_agg(jsonb_build_object('id',channel.id,'channel',channel.channel,'amount',channel.amount,'currency',channel.currency,'dispersion_status',channel.dispersion_status,'dispersed_at',channel.dispersed_at,'has_failure_note',channel.dispersion_note is not null,'reconciliation_status',channel.reconciliation_status) order by case channel.channel when 'banco' then 1 when 'spei' then 2 else 3 end),'[]'::jsonb) into v_channel_count,v_pending_count,v_dispersed_count,v_failed_count,v_channels from public.payroll_channels channel where channel.payment_request_id=v_request.id;
  v_payment_ready:=public.payroll_ready_for_dispersion(v_request.id);
  if v_payment_ready and v_channel_count>0 then v_overall_status:=case when v_failed_count>0 then 'failed' when v_dispersed_count=v_channel_count then 'dispersed' when v_dispersed_count>0 then 'partial' else 'pending' end; end if;
  v_action_allowed:=public.payroll_has_finance_pii_access() and public.has_active_company_membership(v_actor,v_request.company_id) and v_payment_ready and v_channel_count>0;
  return jsonb_build_object('payment_request_id',v_request.id,'request_number',v_request.request_number,'company_id',v_request.company_id,'company_name',v_company_name,'request_status',v_request.status,'amount_requested',v_request.amount_requested,'currency',v_request.currency,'overall_status',v_overall_status,'action_allowed',v_action_allowed,'payment_ready',v_payment_ready,'payment_flow_state',case when v_payment_ready then 'ready_for_payment' else 'pending_finance_confirmation' end,'channel_count',v_channel_count,'pending_count',v_pending_count,'dispersed_count',v_dispersed_count,'failed_count',v_failed_count,'all_dispersed',(v_channel_count>0 and v_dispersed_count=v_channel_count),'channels',v_channels);
end; $$;

create or replace function public.record_payroll_channel_dispersion(p_payment_request_id uuid,p_payroll_channel_id uuid,p_action text,p_failure_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_channel public.payroll_channels%rowtype; v_action text:=lower(btrim(coalesce(p_action,''))); v_note text:=nullif(btrim(coalesce(p_failure_note,'')),''); v_result text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  if v_action not in ('dispersed','failed') then raise exception 'PAYROLL_DISPERSION_ACTION_INVALID'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.status::text<>'approved' then raise exception 'PAYROLL_FINANCE_CONFIRMATION_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_DISPERSION_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_DISPERSION_MATERIALIZATION_REQUIRED'; end if;
  if not public.payroll_ready_for_dispersion(v_request.id) then raise exception 'PAYROLL_FINANCE_CONFIRMATION_REQUIRED'; end if;
  select * into v_channel from public.payroll_channels where id=p_payroll_channel_id and payment_request_id=v_request.id for update;
  if not found then raise exception 'PAYROLL_DISPERSION_CHANNEL_REQUIRED'; end if;
  if v_channel.reconciliation_status<>'pending' then raise exception 'PAYROLL_DISPERSION_RECONCILIATION_ALREADY_STARTED'; end if;
  if v_channel.dispersion_status='dispersed' then if v_action='dispersed' then return jsonb_build_object('result','already_dispersed','summary',public.get_payroll_dispersion_summary(v_request.id)); end if; raise exception 'PAYROLL_DISPERSION_ALREADY_FINAL'; end if;
  if v_action='failed' then
    if v_note is null or length(v_note)<3 or length(v_note)>500 then raise exception 'PAYROLL_DISPERSION_FAILURE_NOTE_REQUIRED'; end if;
    if v_channel.dispersion_status='failed' then if v_channel.dispersion_note=v_note then return jsonb_build_object('result','already_failed','summary',public.get_payroll_dispersion_summary(v_request.id)); end if; raise exception 'PAYROLL_DISPERSION_FAILURE_ALREADY_RECORDED'; end if;
    update public.payroll_channels set dispersion_status='failed',dispersed_at=now(),dispersed_by=v_actor,dispersion_note=v_note where id=v_channel.id; v_result:='failed_recorded';
  else
    if v_note is not null then raise exception 'PAYROLL_DISPERSION_NOTE_ONLY_FOR_FAILURE'; end if;
    update public.payroll_channels set dispersion_status='dispersed',dispersed_at=now(),dispersed_by=v_actor,dispersion_note=null where id=v_channel.id; v_result:='dispersed';
  end if;
  return jsonb_build_object('result',v_result,'summary',public.get_payroll_dispersion_summary(v_request.id));
end; $$;

commit;
