-- N1 recovery: the N0 trigger function is shared by payment_requests and
-- payroll_channels. Route by relation and operation before extracting a key
-- so PostgreSQL never resolves a field from the other table's rowtype.

begin;

do $precheck$
begin
  if to_regprocedure('public.payroll_enforce_request_total()') is null then
    raise exception 'payroll_total_guard_function_missing';
  end if;

  if (
    select count(*)
    from pg_trigger trigger_info
    where not trigger_info.tgisinternal
      and trigger_info.tgrelid in (
        'public.payment_requests'::regclass,
        'public.payroll_channels'::regclass
      )
      and trigger_info.tgname in (
        'payment_requests_payroll_total_guard',
        'payroll_channels_total_guard'
      )
  ) <> 2 then
    raise exception 'payroll_total_guard_triggers_missing';
  end if;
end
$precheck$;

create or replace function public.payroll_enforce_request_total()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_id uuid;
  v_request_type text;
  v_request_amount numeric;
  v_channel_count integer;
  v_channel_total numeric;
begin
  if tg_relid = 'public.payment_requests'::regclass then
    if tg_op not in ('INSERT', 'UPDATE') then
      raise exception 'payroll_total_guard_unexpected_payment_request_op';
    end if;

    v_request_id := nullif(to_jsonb(new) ->> 'id', '')::uuid;
  elsif tg_relid = 'public.payroll_channels'::regclass then
    if tg_op = 'DELETE' then
      v_request_id :=
        nullif(to_jsonb(old) ->> 'payment_request_id', '')::uuid;
    elsif tg_op in ('INSERT', 'UPDATE') then
      v_request_id :=
        nullif(to_jsonb(new) ->> 'payment_request_id', '')::uuid;
    else
      raise exception 'payroll_total_guard_unexpected_payroll_channel_op';
    end if;
  else
    raise exception 'payroll_total_guard_unexpected_trigger_source';
  end if;

  if v_request_id is null then
    raise exception 'payroll_total_guard_request_id_missing';
  end if;

  select request.request_type::text, request.amount_requested
    into v_request_type, v_request_amount
  from public.payment_requests request
  where request.id = v_request_id;

  if not found then
    return null;
  end if;

  select count(*), coalesce(sum(channel.amount), 0)
    into v_channel_count, v_channel_total
  from public.payroll_channels channel
  where channel.payment_request_id = v_request_id;

  if v_request_type <> 'nomina' then
    if v_channel_count > 0 then
      raise exception 'payroll_channels_require_nomina_request';
    end if;
    return null;
  end if;

  if v_channel_count = 0 or v_channel_total <> v_request_amount then
    raise exception 'payroll_total_mismatch';
  end if;

  return null;
end;
$$;

commit;
