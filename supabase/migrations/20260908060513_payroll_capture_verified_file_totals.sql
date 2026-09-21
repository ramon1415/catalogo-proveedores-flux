-- Reopened captures must use the evidence of their materialized files.
-- Staging deliberately accepts client counts/amounts only for SPEI. Keep that
-- contract intact and derive display aggregates without updating stored files.
create or replace function public.get_payroll_capture_sessions_unscoped_internal(p_session_id uuid default null)
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $function$
begin
  if public.current_profile_id() is null or not public.payroll_has_capture_access() then
    raise exception 'payroll_capture_finance_required';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', session.id,
      'company_id', session.company_id,
      'company_bank_account_id', session.company_bank_account_id,
      'cost_center_id', session.cost_center_id,
      'budget_category_id', session.budget_category_id,
      'budget_month', session.budget_month,
      'payroll_subtype', session.payroll_subtype,
      'period_start', session.period_start,
      'period_end', session.period_end,
      'concept', session.concept,
      'notes', session.notes,
      'expected_channels', session.expected_channels,
      'capture_state', session.capture_state,
      'validation_status', session.validation_status,
      'version', session.version,
      'expires_at', session.expires_at,
      'updated_at', session.updated_at,
      'materialized_payment_request_id', session.materialized_payment_request_id,
      'materialized_at', session.materialized_at,
      'server_verification_summary', session.server_verification_summary,
      'payment_request_number', request.request_number,
      'payment_request_status', request.status::text,
      'finance_confirmation_pending', coalesce(
        request.request_type::text = 'nomina' and request.status::text = 'draft'
        and request.no_presupuestal and request.approver_id is null and request.submitted_at is null, false),
      'payment_ready', case when request.id is null then false else public.payroll_ready_for_dispersion(request.id) end,
      'payment_flow_state', case
        when request.id is null then null
        when request.status::text = 'draft' and request.no_presupuestal and request.approver_id is null then 'pending_finance_confirmation'
        when public.payroll_ready_for_dispersion(request.id) then 'ready_for_payment'
        when request.status::text = 'approved' then 'payment_blocked'
        else request.status::text end,
      'files', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', file.id,
          'kind', file.kind,
          'channel', file.channel,
          'capability_code', file.capability_code,
          'parsing_status', file.parsing_status,
          'validation_authority', file.validation_authority,
          'parser_version', file.parser_version,
          'parser_contract', file.parser_contract,
          'record_count', case
            when session.materialized_payment_request_id is null then file.record_count
            when verified.parsing_metadata->>'row_count' ~ '^[0-9]{1,9}$'
              then (verified.parsing_metadata->>'row_count')::integer
            else null end,
          'total_amount_minor', case
            when session.materialized_payment_request_id is null then file.total_amount_minor
            when verified.id is not null then round(100 * case file.kind
              when 'caratula' then cover.net_amount
              when 'cfdi_vales' then channel.benefit_amount
              when 'layout_mismo_banco' then channel.amount
              when 'layout_spei' then channel.amount
              when 'layout_toka' then channel.amount
              else null end)::bigint
            else null end,
          'issue_codes', file.issue_codes,
          'uploaded_at', file.uploaded_at
        ) order by file.uploaded_at desc)
        from public.payroll_capture_files file
        left join public.payroll_run_files verified
          on session.capture_state = 'materialized'
          and verified.capture_file_id = file.id
          and verified.payment_request_id = request.id
          and verified.kind = file.kind
          and verified.sha256 = file.sha256
          and verified.parsing_status = 'parsed'
          and verified.parsing_metadata->>'evidence_class' = 'SERVER_VERIFIED'
        left join public.payroll_channels channel
          on channel.id = verified.payroll_channel_id
          and channel.payment_request_id = request.id
          and channel.channel = file.channel
        left join lateral (
          select sum(line.net_amount) as net_amount
          from public.payroll_run_lines line
          where file.kind = 'caratula'
            and line.payment_request_id = request.id
            and line.source_file_id = verified.id
        ) cover on true
        where file.session_id = session.id
          and file.upload_state = 'uploaded'
          and file.is_current
      ), '[]'::jsonb)
    ) order by session.updated_at desc)
    from (
      select * from public.payroll_capture_sessions
      where (p_session_id is null or id = p_session_id)
        and (expires_at > now() or (capture_state = 'materialized' and materialized_payment_request_id is not null))
        and public.payroll_capture_company_access(company_id)
      order by updated_at desc
      limit 50
    ) session
    left join public.payment_requests request
      on request.id = session.materialized_payment_request_id
      and request.company_id = session.company_id
      and request.request_type::text = 'nomina'
  ), '[]'::jsonb);
end;
$function$;

-- CREATE OR REPLACE retains the existing ACL: only the public, scoped wrapper
-- is callable by authenticated users. No grants, table data or paid states change.
