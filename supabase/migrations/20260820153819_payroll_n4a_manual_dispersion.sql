-- N4A: manual payroll dispersion tracking by channel.
-- Flux records an external Finance action; it does not execute bank payments,
-- generate layouts, upload to a bank, reconcile receipts, or change request status.

begin;

do $precheck$
begin
  if to_regclass('public.payroll_channels') is null
     or to_regprocedure('public.payroll_request_has_valid_materialization(uuid)') is null
     or to_regprocedure('public.payroll_can_read_summary(uuid)') is null
     or to_regprocedure('public.payroll_has_finance_pii_access()') is null then
    raise exception 'payroll_n4a_prerequisite_missing';
  end if;
end;
$precheck$;

create function public.get_payroll_dispersion_summary(p_payment_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
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
begin
  if v_actor is null then
    raise exception 'PAYROLL_AUTH_REQUIRED';
  end if;

  select * into v_request
  from public.payment_requests
  where id=p_payment_request_id;

  if not found or v_request.request_type::text <> 'nomina' then
    raise exception 'PAYROLL_REQUEST_REQUIRED';
  end if;

  select company.name into v_company_name
  from public.companies company
  where company.id=v_request.company_id;

  if not public.payroll_can_read_summary(v_request.id) then
    raise exception 'PAYROLL_SUMMARY_ACCESS_DENIED';
  end if;

  select
    count(*)::integer,
    count(*) filter (where channel.dispersion_status='pending')::integer,
    count(*) filter (where channel.dispersion_status='dispersed')::integer,
    count(*) filter (where channel.dispersion_status='failed')::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'id',channel.id,
      'channel',channel.channel,
      'amount',channel.amount,
      'currency',channel.currency,
      'dispersion_status',channel.dispersion_status,
      'dispersed_at',channel.dispersed_at,
      'has_failure_note',channel.dispersion_note is not null,
      'reconciliation_status',channel.reconciliation_status
    ) order by case channel.channel when 'banco' then 1 when 'spei' then 2 else 3 end),'[]'::jsonb)
  into v_channel_count,v_pending_count,v_dispersed_count,v_failed_count,v_channels
  from public.payroll_channels channel
  where channel.payment_request_id=v_request.id;

  if v_request.status::text='approved' and v_channel_count>0 and public.payroll_request_has_valid_materialization(v_request.id) then
    v_overall_status := case
      when v_failed_count>0 then 'failed'
      when v_dispersed_count=v_channel_count then 'dispersed'
      when v_dispersed_count>0 then 'partial'
      else 'pending'
    end;
  end if;

  v_action_allowed := public.payroll_has_finance_pii_access()
    and public.has_active_company_membership(v_actor,v_request.company_id)
    and v_request.status::text='approved'
    and v_channel_count>0
    and public.payroll_request_has_valid_materialization(v_request.id);

  return jsonb_build_object(
    'payment_request_id',v_request.id,
    'request_number',v_request.request_number,
    'company_id',v_request.company_id,
    'company_name',v_company_name,
    'request_status',v_request.status,
    'amount_requested',v_request.amount_requested,
    'currency',v_request.currency,
    'overall_status',v_overall_status,
    'action_allowed',v_action_allowed,
    'channel_count',v_channel_count,
    'pending_count',v_pending_count,
    'dispersed_count',v_dispersed_count,
    'failed_count',v_failed_count,
    'all_dispersed',(v_channel_count>0 and v_dispersed_count=v_channel_count),
    'channels',v_channels
  );
end;
$$;

revoke all on function public.get_payroll_dispersion_summary(uuid) from public,anon;
grant execute on function public.get_payroll_dispersion_summary(uuid) to authenticated;

create function public.get_payroll_dispersion_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'PAYROLL_FINANCE_REQUIRED';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'payment_request_id',row.id,
      'request_number',row.request_number,
      'company_id',row.company_id,
      'company_name',row.company_name,
      'amount_requested',row.amount_requested,
      'currency',row.currency,
      'approved_at',row.approved_at,
      'overall_status',case
        when row.failed_count>0 then 'failed'
        when row.channel_count>0 and row.dispersed_count=row.channel_count then 'dispersed'
        when row.dispersed_count>0 then 'partial'
        else 'pending'
      end,
      'channel_count',row.channel_count,
      'dispersed_count',row.dispersed_count,
      'failed_count',row.failed_count
    ) order by row.approved_at desc nulls last,row.id)
    from (
      select
        request.id,
        request.request_number,
        request.company_id,
        company.name as company_name,
        request.amount_requested,
        request.currency,
        request.approved_at,
        counts.channel_count,
        counts.dispersed_count,
        counts.failed_count
      from public.payment_requests request
      join public.companies company on company.id=request.company_id
      cross join lateral (
        select
          count(*)::integer as channel_count,
          count(*) filter (where channel.dispersion_status='dispersed')::integer as dispersed_count,
          count(*) filter (where channel.dispersion_status='failed')::integer as failed_count
        from public.payroll_channels channel
        where channel.payment_request_id=request.id
      ) counts
      where request.request_type::text='nomina'
        and request.status::text='approved'
        and counts.channel_count>0
        and public.payroll_request_has_valid_materialization(request.id)
        and public.has_active_company_membership(v_actor,request.company_id)
      order by request.approved_at desc nulls last,request.id
      limit 50
    ) row
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.get_payroll_dispersion_queue() from public,anon;
grant execute on function public.get_payroll_dispersion_queue() to authenticated;

create function public.record_payroll_channel_dispersion(
  p_payment_request_id uuid,
  p_payroll_channel_id uuid,
  p_action text,
  p_failure_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_channel public.payroll_channels%rowtype;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_note text := nullif(btrim(coalesce(p_failure_note,'')),'');
  v_result text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'PAYROLL_FINANCE_REQUIRED';
  end if;

  if v_action not in ('dispersed','failed') then
    raise exception 'PAYROLL_DISPERSION_ACTION_INVALID';
  end if;

  select * into v_request
  from public.payment_requests
  where id=p_payment_request_id
  for update;

  if not found or v_request.request_type::text<>'nomina' then
    raise exception 'PAYROLL_REQUEST_REQUIRED';
  end if;
  if v_request.status::text<>'approved' then
    raise exception 'PAYROLL_DISPERSION_REQUIRES_APPROVED_REQUEST';
  end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then
    raise exception 'PAYROLL_DISPERSION_COMPANY_MEMBERSHIP_REQUIRED';
  end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then
    raise exception 'PAYROLL_DISPERSION_MATERIALIZATION_REQUIRED';
  end if;

  select * into v_channel
  from public.payroll_channels
  where id=p_payroll_channel_id
    and payment_request_id=v_request.id
  for update;

  if not found then
    raise exception 'PAYROLL_DISPERSION_CHANNEL_REQUIRED';
  end if;
  if v_channel.reconciliation_status<>'pending' then
    raise exception 'PAYROLL_DISPERSION_RECONCILIATION_ALREADY_STARTED';
  end if;

  if v_channel.dispersion_status='dispersed' then
    if v_action='dispersed' then
      return jsonb_build_object(
        'result','already_dispersed',
        'summary',public.get_payroll_dispersion_summary(v_request.id)
      );
    end if;
    raise exception 'PAYROLL_DISPERSION_ALREADY_FINAL';
  end if;

  if v_action='failed' then
    if v_note is null or length(v_note)<3 or length(v_note)>500 then
      raise exception 'PAYROLL_DISPERSION_FAILURE_NOTE_REQUIRED';
    end if;
    if v_channel.dispersion_status='failed' then
      if v_channel.dispersion_note=v_note then
        return jsonb_build_object(
          'result','already_failed',
          'summary',public.get_payroll_dispersion_summary(v_request.id)
        );
      end if;
      raise exception 'PAYROLL_DISPERSION_FAILURE_ALREADY_RECORDED';
    end if;

    update public.payroll_channels
    set dispersion_status='failed',
        dispersed_at=now(),
        dispersed_by=v_actor,
        dispersion_note=v_note
    where id=v_channel.id;
    v_result := 'failed_recorded';
  else
    if v_note is not null then
      raise exception 'PAYROLL_DISPERSION_NOTE_ONLY_FOR_FAILURE';
    end if;

    update public.payroll_channels
    set dispersion_status='dispersed',
        dispersed_at=now(),
        dispersed_by=v_actor,
        dispersion_note=null
    where id=v_channel.id;
    v_result := 'dispersed';
  end if;

  return jsonb_build_object(
    'result',v_result,
    'summary',public.get_payroll_dispersion_summary(v_request.id)
  );
end;
$$;

revoke all on function public.record_payroll_channel_dispersion(uuid,uuid,text,text) from public,anon;
grant execute on function public.record_payroll_channel_dispersion(uuid,uuid,text,text) to authenticated;

do $postcheck$
begin
  if to_regprocedure('public.get_payroll_dispersion_summary(uuid)') is null
     or to_regprocedure('public.get_payroll_dispersion_queue()') is null
     or to_regprocedure('public.record_payroll_channel_dispersion(uuid,uuid,text,text)') is null then
    raise exception 'payroll_n4a_contract_incomplete';
  end if;
end;
$postcheck$;

commit;
