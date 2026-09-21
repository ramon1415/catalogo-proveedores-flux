begin;

create or replace function public.payroll_uses_weekly_cut_flow(p_payment_request_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $function$
  select exists (
    select 1
    from public.payment_requests request
    join public.budget_categories category on category.id=request.budget_category_id
    where request.id=p_payment_request_id
      and request.request_type::text='nomina'
      and request.no_presupuestal
      and category.code='PAYROLL_NON_BUDGET'
      and request.approver_id is null
  );
$function$;

create or replace function public.payroll_ready_for_dispersion(p_payment_request_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $function$
  select case
    when not exists (
      select 1 from public.payment_requests request
      where request.id=p_payment_request_id and request.request_type::text='nomina'
    ) then false
    when public.payroll_uses_weekly_cut_flow(p_payment_request_id)
      then public.approval_batch_request_has_current_direction_approval(p_payment_request_id)
    else true
  end;
$function$;

create or replace function public.approval_batch_request_has_any_execution_record(p_payment_request_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $function$
  select
    exists (select 1 from public.payment_layout_lines pll where pll.payment_request_id=p_payment_request_id)
    or exists (select 1 from public.cash_funds cf where cf.payment_request_id=p_payment_request_id)
    or exists (select 1 from public.payment_receipts prc where prc.payment_request_id=p_payment_request_id)
    or exists (
      select 1 from public.payroll_channels channel
      where channel.payment_request_id=p_payment_request_id
        and (
          channel.dispersion_status<>'pending'
          or channel.reconciliation_status<>'pending'
          or channel.receipt_file_id is not null
        )
    );
$function$;

create or replace function public.payroll_weekly_cut_eligibility(p_payment_request_id uuid,p_exclude_batch_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $function$
declare
  v_request public.payment_requests%rowtype;
  v_latest record;
  v_budget jsonb;
  v_origin text := 'new';
  v_review_sequence integer := 1;
  v_eligible boolean := false;
  v_classification text;
  v_reason text;
begin
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found then return jsonb_build_object('eligible',false,'classification','invalid_data','reason','payment_request_not_found'); end if;
  if not public.payroll_uses_weekly_cut_flow(v_request.id) then
    return jsonb_build_object('eligible',false,'classification','invalid_data','reason','payroll_uses_separate_flow');
  end if;

  select item.id,item.batch_id,batch.label as batch_label,batch.status as batch_status,
         item.director_status,item.director_reject_reason,item.rebatch_status,item.rebatch_release_note,
         item.decided_at,item.decided_by,item.review_sequence
    into v_latest
  from public.approval_batch_items item
  join public.approval_batches batch on batch.id=item.batch_id
  where item.payment_request_id=v_request.id
    and item.removed_at is null
    and (p_exclude_batch_id is null or item.batch_id<>p_exclude_batch_id)
  order by item.review_sequence desc,item.created_at desc,item.id desc
  limit 1;

  if v_latest.id is not null then
    v_review_sequence := coalesce(v_latest.review_sequence,1)+1;
    if v_latest.director_status='rejected' and v_latest.rebatch_status='released' then
      v_origin := 'resubmission';
    elsif v_latest.director_status='approved' and coalesce(v_latest.decided_at<v_request.approval_material_updated_at,true) then
      v_origin := 'material_change_review';
    end if;
  end if;

  v_budget := public.approval_batch_budget_validation(v_request.id);

  if public.approval_batch_request_has_any_execution_record(v_request.id) then
    v_classification := 'already_executed'; v_reason := 'payment_request_already_executed';
  elsif public.approval_batch_request_open_elsewhere(v_request.id,p_exclude_batch_id) then
    v_classification := 'already_in_open_batch'; v_reason := 'payment_request_in_another_open_batch';
  elsif public.approval_batch_request_has_current_direction_approval(v_request.id) then
    v_classification := 'already_authorized'; v_reason := 'direction_approval_already_current';
  elsif v_latest.director_status='rejected' and v_latest.rebatch_status='blocked' then
    v_classification := 'rejected_by_direction'; v_reason := 'direction_rejection_requires_correction';
  elsif v_latest.director_status='approved'
    and v_latest.batch_status in ('approved','partially_approved')
    and coalesce(v_latest.decided_at>=v_request.approval_material_updated_at,false) then
    v_classification := 'pending_finance_close'; v_reason := 'finance_close_required';
  elsif v_request.status::text<>'approved' or v_request.approved_by is null then
    v_classification := 'invalid_data'; v_reason := 'payroll_finance_confirmation_required';
  elsif not public.payroll_request_has_valid_materialization(v_request.id) then
    v_classification := 'invalid_data'; v_reason := 'payroll_materialization_required';
  elsif coalesce(v_budget->>'status','bloqueado')<>'aprobable'
     or coalesce((v_budget->>'no_presupuestal')::boolean,false) is not true then
    v_classification := 'invalid_data'; v_reason := 'payroll_nonbudget_snapshot_invalid';
  else
    v_classification := 'ready_for_batch'; v_reason := null; v_eligible := true;
  end if;

  return jsonb_build_object(
    'eligible',v_eligible,'classification',v_classification,'reason',v_reason,
    'origin',v_origin,'review_sequence',v_review_sequence,'missing_fields','[]'::jsonb,
    'budget_status',v_budget->>'status','budget_reason',v_budget->>'motivo',
    'budget_available',nullif(v_budget->>'disponible_actual','')::numeric,
    'budget_after',nullif(v_budget->>'disponible_despues','')::numeric,
    'budget_shortfall',nullif(v_budget->>'faltante','')::numeric,
    'previous_item_id',v_latest.id,'previous_batch_id',v_latest.batch_id,
    'previous_batch_label',v_latest.batch_label,'previous_director_status',v_latest.director_status,
    'previous_reject_reason',v_latest.director_reject_reason,
    'previous_correction_note',v_latest.rebatch_release_note,'previous_decided_at',v_latest.decided_at
  );
end;
$function$;

create or replace function public.approval_batch_request_base_eligible(p_payment_request_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $function$
  select coalesce((
    case
      when public.payroll_uses_weekly_cut_flow(p_payment_request_id)
        then public.payroll_weekly_cut_eligibility(p_payment_request_id,null)
      else public.approval_batch_request_eligibility(p_payment_request_id,null)
    end ->> 'eligible'
  )::boolean,false);
$function$;

create or replace function public.add_request_to_approval_batch(p_batch_id uuid,p_payment_request_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
  v_eligibility jsonb;
  v_previous record;
  v_review_sequence integer;
  v_item_id uuid;
  v_resubmission_note text;
begin
  v_actor := public.approval_batch_require_finance();
  select * into v_batch from public.approval_batches where id=p_batch_id for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status<>'draft' then raise exception 'batch_must_be_draft'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_payment_request_id::text,21021));
  v_eligibility := case
    when public.payroll_uses_weekly_cut_flow(p_payment_request_id)
      then public.payroll_weekly_cut_eligibility(p_payment_request_id,null)
    else public.approval_batch_request_eligibility(p_payment_request_id,null)
  end;
  if not coalesce((v_eligibility->>'eligible')::boolean,false) then
    raise exception 'payment_request_not_batch_eligible:%',coalesce(v_eligibility->>'classification','unknown');
  end if;
  if not exists (
    select 1 from public.payment_requests request
    where request.id=p_payment_request_id and request.company_id=v_batch.company_id
  ) then raise exception 'batch_request_company_mismatch'; end if;

  select item.id,item.review_sequence,item.director_status,item.rebatch_status,item.rebatch_release_note
    into v_previous
  from public.approval_batch_items item
  where item.payment_request_id=p_payment_request_id and item.removed_at is null
  order by item.review_sequence desc,item.created_at desc,item.id desc limit 1;

  select coalesce(max(item.review_sequence),0)+1 into v_review_sequence
  from public.approval_batch_items item
  where item.payment_request_id=p_payment_request_id and item.removed_at is null;

  v_resubmission_note := case
    when v_previous.id is null then null
    when nullif(btrim(v_previous.rebatch_release_note),'') is not null then v_previous.rebatch_release_note
    else 'Nueva revision requerida por cambio material posterior a la decision anterior.'
  end;

  insert into public.approval_batch_items(
    batch_id,payment_request_id,finance_reviewed_by,finance_reviewed_at,
    previous_item_id,review_sequence,resubmitted_at,resubmitted_by,resubmission_note
  ) values (
    p_batch_id,p_payment_request_id,v_actor,now(),v_previous.id,v_review_sequence,
    case when v_previous.id is null then null else now() end,
    case when v_previous.id is null then null else v_actor end,v_resubmission_note
  ) returning id into v_item_id;

  return jsonb_build_object('item_id',v_item_id,'status','pending','review_sequence',v_review_sequence,
    'previous_item_id',v_previous.id,'origin',v_eligibility->>'origin');
end;
$function$;

create or replace function public.list_batch_eligible_requests(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
begin
  perform public.approval_batch_require_finance();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',pr.id,'request_number',pr.request_number,'request_type',pr.request_type::text,
      'company_id',pr.company_id,'company_name',coalesce(nullif(btrim(company.legal_name),''),company.name),
      'provider_name',case when pr.request_type::text='nomina' then 'Nómina' else coalesce(nullif(btrim(provider.alias),''),provider.nombre_completo) end,
      'cost_center',coalesce(nullif(btrim(center.code),'')||' - ','')||center.name,
      'budget_category',coalesce(nullif(btrim(category.code),'')||' - ','')||category.name,
      'payment_method',coalesce(nullif(pr.payment_method,''),case when pr.request_type::text in ('cash','check') then pr.request_type::text else 'transfer' end),
      'currency',pr.currency,'amount',pr.amount_requested,'status',pr.status,
      'requested_by',pr.requested_by,'requester_name',requester.full_name,'created_at',pr.created_at,
      'eligible',coalesce((eligibility.result->>'eligible')::boolean,false),
      'classification',eligibility.result->>'classification','classification_reason',eligibility.result->>'reason',
      'origin',eligibility.result->>'origin','review_sequence',coalesce((eligibility.result->>'review_sequence')::integer,1),
      'budget_status',eligibility.result->>'budget_status','budget_reason',eligibility.result->>'budget_reason',
      'budget_available',nullif(eligibility.result->>'budget_available','')::numeric,
      'budget_after',nullif(eligibility.result->>'budget_after','')::numeric,
      'budget_shortfall',nullif(eligibility.result->>'budget_shortfall','')::numeric,
      'missing_fields',coalesce(eligibility.result->'missing_fields','[]'::jsonb),
      'previous_item_id',nullif(eligibility.result->>'previous_item_id','')::uuid,
      'previous_batch_id',nullif(eligibility.result->>'previous_batch_id','')::uuid,
      'previous_batch_label',eligibility.result->>'previous_batch_label',
      'previous_reject_reason',eligibility.result->>'previous_reject_reason',
      'previous_correction_note',eligibility.result->>'previous_correction_note',
      'previous_decided_at',nullif(eligibility.result->>'previous_decided_at','')::timestamptz
    ) order by coalesce((eligibility.result->>'eligible')::boolean,false) desc,pr.created_at,pr.id)
    from public.payment_requests pr
    join public.companies company on company.id=pr.company_id
    left join public.proveedores provider on provider.id=pr.proveedor_id
    left join public.cost_centers center on center.id=pr.cost_center_id
    left join public.budget_categories category on category.id=pr.budget_category_id
    left join public.profiles requester on requester.id=pr.requested_by
    cross join lateral (
      select case
        when public.payroll_uses_weekly_cut_flow(pr.id) then public.payroll_weekly_cut_eligibility(pr.id,null)
        else public.approval_batch_request_eligibility(pr.id,null)
      end as result
    ) eligibility
    where pr.company_id=p_company_id
      and pr.status::text in ('submitted','pending_approval','approved','rejected','changes_requested')
  ),'[]'::jsonb);
end;
$function$;

create or replace function public.get_payroll_capture_sessions_unscoped_internal(p_session_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $function$
begin
  if public.current_profile_id() is null or not public.payroll_has_finance_pii_access() then raise exception 'payroll_capture_finance_required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',session.id,'company_id',session.company_id,'company_bank_account_id',session.company_bank_account_id,
      'cost_center_id',session.cost_center_id,'budget_category_id',session.budget_category_id,'budget_month',session.budget_month,
      'payroll_subtype',session.payroll_subtype,'period_start',session.period_start,'period_end',session.period_end,
      'concept',session.concept,'notes',session.notes,'expected_channels',session.expected_channels,
      'capture_state',session.capture_state,'validation_status',session.validation_status,'version',session.version,
      'expires_at',session.expires_at,'updated_at',session.updated_at,
      'materialized_payment_request_id',session.materialized_payment_request_id,'materialized_at',session.materialized_at,
      'server_verification_summary',session.server_verification_summary,
      'payment_request_number',request.request_number,'payment_request_status',request.status::text,
      'finance_confirmation_pending',coalesce(public.payroll_uses_weekly_cut_flow(request.id) and request.status::text='draft',false),
      'weekly_cut_ready',case when request.id is null then false else public.payroll_ready_for_dispersion(request.id) end,
      'weekly_cut_state',case
        when request.id is null then null
        when public.payroll_uses_weekly_cut_flow(request.id) and request.status::text='draft' then 'pending_finance_confirmation'
        when public.payroll_uses_weekly_cut_flow(request.id) and public.approval_batch_request_has_current_direction_approval(request.id) then 'released_from_cut'
        when public.payroll_uses_weekly_cut_flow(request.id) and cut.batch_status in ('draft','submitted','approved','partially_approved') then 'in_weekly_cut'
        when public.payroll_uses_weekly_cut_flow(request.id) and request.status::text='approved' then 'ready_for_weekly_cut'
        else 'legacy_separate_flow' end,
      'weekly_cut_id',cut.batch_id,'weekly_cut_label',cut.batch_label,'weekly_cut_status',cut.batch_status,
      'files',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',file.id,'kind',file.kind,'channel',file.channel,'capability_code',file.capability_code,
          'parsing_status',file.parsing_status,'validation_authority',file.validation_authority,
          'parser_version',file.parser_version,'parser_contract',file.parser_contract,'record_count',file.record_count,
          'total_amount_minor',file.total_amount_minor,'issue_codes',file.issue_codes,'uploaded_at',file.uploaded_at
        ) order by file.uploaded_at desc)
        from public.payroll_capture_files file
        where file.session_id=session.id and file.upload_state='uploaded' and file.is_current
      ),'[]'::jsonb)
    ) order by session.updated_at desc)
    from (
      select * from public.payroll_capture_sessions
      where (p_session_id is null or id=p_session_id) and expires_at>now()
      order by updated_at desc limit 50
    ) session
    left join public.payment_requests request on request.id=session.materialized_payment_request_id
    left join lateral (
      select item.batch_id,batch.label as batch_label,batch.status as batch_status
      from public.approval_batch_items item
      join public.approval_batches batch on batch.id=item.batch_id
      where item.payment_request_id=request.id and item.removed_at is null
      order by item.review_sequence desc,item.created_at desc,item.id desc limit 1
    ) cut on true
  ),'[]'::jsonb);
end;
$function$;

create or replace function public.get_payroll_submission_summary(p_payment_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $function$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_employee_net numeric;
  v_channels jsonb;
  v_cut record;
  v_new_cut_flow boolean := false;
  v_cut_ready boolean := false;
  v_cut_state text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_SUBMIT_COMPANY_MEMBERSHIP_REQUIRED'; end if;

  select coalesce(sum(net_amount),0) into v_employee_net from public.payroll_run_lines where payment_request_id=v_request.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'channel',channel.channel,'amount',channel.amount,'benefit_amount',channel.benefit_amount,
    'fee_amount',channel.fee_amount,'tax_amount',channel.tax_amount,
    'expected_funding_amount',channel.expected_funding_amount,
    'funding_variance',case when channel.channel='vales' then channel.amount-channel.expected_funding_amount else null end,
    'funding_variance_acknowledged',channel.funding_variance_acknowledged_at is not null,
    'funding_variance_acknowledged_at',channel.funding_variance_acknowledged_at
  ) order by channel.channel),'[]'::jsonb) into v_channels
  from public.payroll_channels channel where channel.payment_request_id=v_request.id;

  select item.batch_id,batch.label as batch_label,batch.status as batch_status,item.director_status,item.finance_release_status
    into v_cut
  from public.approval_batch_items item
  join public.approval_batches batch on batch.id=item.batch_id
  where item.payment_request_id=v_request.id and item.removed_at is null
  order by item.review_sequence desc,item.created_at desc,item.id desc limit 1;

  v_new_cut_flow := public.payroll_uses_weekly_cut_flow(v_request.id);
  v_cut_ready := public.payroll_ready_for_dispersion(v_request.id);
  v_cut_state := case
    when v_new_cut_flow and v_request.status::text='draft' then 'pending_finance_confirmation'
    when v_new_cut_flow and public.approval_batch_request_has_current_direction_approval(v_request.id) then 'released_from_cut'
    when v_new_cut_flow and v_cut.batch_status in ('draft','submitted','approved','partially_approved') then 'in_weekly_cut'
    when v_new_cut_flow and v_request.status::text='approved' then 'ready_for_weekly_cut'
    else 'legacy_separate_flow' end;

  return jsonb_build_object(
    'payment_request_id',v_request.id,'request_number',v_request.request_number,'status',v_request.status,
    'company_id',v_request.company_id,'cost_center_id',v_request.cost_center_id,
    'amount_requested',v_request.amount_requested,'employee_net',v_employee_net,'currency',v_request.currency,
    'payroll_subtype',v_request.payroll_subtype,'period_start',v_request.payroll_period_start,'period_end',v_request.payroll_period_end,
    'approver_id',v_request.approver_id,'approver_assignment_id',v_request.approver_assignment_id,
    'approver_selection_source',v_request.approver_selection_source,'submitted_at',v_request.submitted_at,
    'budget_category_id',v_request.budget_category_id,'budget_month',v_request.budget_month,
    'budget_decision',v_request.budget_decision,'budget_block_reason',v_request.budget_block_reason,
    'budget_available_before',v_request.budget_available_before,'budget_available_after',v_request.budget_available_after,
    'budget_shortfall',v_request.budget_shortfall,'budget_checked_at',v_request.budget_checked_at,
    'budget_ready',(v_request.budget_decision='aprobable' and v_request.budget_category_id is not null and v_request.budget_month is not null),
    'finance_confirmation_pending',(v_new_cut_flow and v_request.status::text='draft'),
    'weekly_cut_ready',v_cut_ready,'weekly_cut_state',v_cut_state,
    'weekly_cut_id',v_cut.batch_id,'weekly_cut_label',v_cut.batch_label,'weekly_cut_status',v_cut.batch_status,
    'channels',v_channels
  );
end;
$function$;

create or replace function public.record_payroll_channel_dispersion(p_payment_request_id uuid,p_payroll_channel_id uuid,p_action text,p_failure_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_channel public.payroll_channels%rowtype;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_note text := nullif(btrim(coalesce(p_failure_note,'')),'');
  v_result text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  if v_action not in ('dispersed','failed') then raise exception 'PAYROLL_DISPERSION_ACTION_INVALID'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.status::text<>'approved' then raise exception 'PAYROLL_DISPERSION_REQUIRES_APPROVED_REQUEST'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_DISPERSION_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_DISPERSION_MATERIALIZATION_REQUIRED'; end if;
  if not public.payroll_ready_for_dispersion(v_request.id) then raise exception 'PAYROLL_WEEKLY_CUT_REQUIRED'; end if;

  select * into v_channel from public.payroll_channels where id=p_payroll_channel_id and payment_request_id=v_request.id for update;
  if not found then raise exception 'PAYROLL_DISPERSION_CHANNEL_REQUIRED'; end if;
  if v_channel.reconciliation_status<>'pending' then raise exception 'PAYROLL_DISPERSION_RECONCILIATION_ALREADY_STARTED'; end if;

  if v_channel.dispersion_status='dispersed' then
    if v_action='dispersed' then return jsonb_build_object('result','already_dispersed','summary',public.get_payroll_dispersion_summary(v_request.id)); end if;
    raise exception 'PAYROLL_DISPERSION_ALREADY_FINAL';
  end if;

  if v_action='failed' then
    if v_note is null or length(v_note)<3 or length(v_note)>500 then raise exception 'PAYROLL_DISPERSION_FAILURE_NOTE_REQUIRED'; end if;
    if v_channel.dispersion_status='failed' then
      if v_channel.dispersion_note=v_note then return jsonb_build_object('result','already_failed','summary',public.get_payroll_dispersion_summary(v_request.id)); end if;
      raise exception 'PAYROLL_DISPERSION_FAILURE_ALREADY_RECORDED';
    end if;
    update public.payroll_channels set dispersion_status='failed',dispersed_at=now(),dispersed_by=v_actor,dispersion_note=v_note where id=v_channel.id;
    v_result := 'failed_recorded';
  else
    if v_note is not null then raise exception 'PAYROLL_DISPERSION_NOTE_ONLY_FOR_FAILURE'; end if;
    update public.payroll_channels set dispersion_status='dispersed',dispersed_at=now(),dispersed_by=v_actor,dispersion_note=null where id=v_channel.id;
    v_result := 'dispersed';
  end if;

  return jsonb_build_object('result',v_result,'summary',public.get_payroll_dispersion_summary(v_request.id));
end;
$function$;

create or replace function public.get_payroll_dispersion_summary(p_payment_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $function$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_company_name text;
  v_channels jsonb;
  v_channel_count integer := 0;
  v_pending_count integer := 0;
  v_dispersed_count integer := 0;
  v_failed_count integer := 0;
  v_overall_status text := 'not_ready';
  v_action_allowed boolean := false;
  v_cut_ready boolean := false;
begin
  if v_actor is null then raise exception 'PAYROLL_AUTH_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  select company.name into v_company_name from public.companies company where company.id=v_request.company_id;
  if not public.payroll_can_read_summary(v_request.id) then raise exception 'PAYROLL_SUMMARY_ACCESS_DENIED'; end if;

  select count(*)::integer,
    count(*) filter(where channel.dispersion_status='pending')::integer,
    count(*) filter(where channel.dispersion_status='dispersed')::integer,
    count(*) filter(where channel.dispersion_status='failed')::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'id',channel.id,'channel',channel.channel,'amount',channel.amount,'currency',channel.currency,
      'dispersion_status',channel.dispersion_status,'dispersed_at',channel.dispersed_at,
      'has_failure_note',channel.dispersion_note is not null,'reconciliation_status',channel.reconciliation_status
    ) order by case channel.channel when 'banco' then 1 when 'spei' then 2 else 3 end),'[]'::jsonb)
  into v_channel_count,v_pending_count,v_dispersed_count,v_failed_count,v_channels
  from public.payroll_channels channel where channel.payment_request_id=v_request.id;

  v_cut_ready := public.payroll_ready_for_dispersion(v_request.id);
  if v_request.status::text='approved' and v_channel_count>0 and public.payroll_request_has_valid_materialization(v_request.id) and v_cut_ready then
    v_overall_status := case when v_failed_count>0 then 'failed' when v_dispersed_count=v_channel_count then 'dispersed' when v_dispersed_count>0 then 'partial' else 'pending' end;
  end if;

  v_action_allowed := public.payroll_has_finance_pii_access()
    and public.has_active_company_membership(v_actor,v_request.company_id)
    and v_request.status::text='approved' and v_channel_count>0
    and public.payroll_request_has_valid_materialization(v_request.id) and v_cut_ready;

  return jsonb_build_object(
    'payment_request_id',v_request.id,'request_number',v_request.request_number,
    'company_id',v_request.company_id,'company_name',v_company_name,'request_status',v_request.status,
    'amount_requested',v_request.amount_requested,'currency',v_request.currency,'overall_status',v_overall_status,
    'action_allowed',v_action_allowed,'weekly_cut_ready',v_cut_ready,
    'channel_count',v_channel_count,'pending_count',v_pending_count,'dispersed_count',v_dispersed_count,
    'failed_count',v_failed_count,'all_dispersed',(v_channel_count>0 and v_dispersed_count=v_channel_count),'channels',v_channels
  );
end;
$function$;

commit;