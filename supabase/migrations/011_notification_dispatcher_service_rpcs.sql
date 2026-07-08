-- Flux Operadora - service-only notification dispatcher RPCs
-- Used by the DEV Edge Function PoC. These RPCs are not exposed to frontend users.

create or replace function public.claim_notification_events_for_dispatcher(
  p_limit integer default 5,
  p_worker_id text default 'edge-notification-dispatcher'
)
returns table (
  id uuid,
  event_type text,
  source_table text,
  source_id uuid,
  source_folio text,
  recipient_type text,
  recipient_profile_id uuid,
  recipient_email text,
  channel text,
  priority text,
  subject text,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_worker_id text := left(coalesce(nullif(trim(p_worker_id), ''), 'edge-notification-dispatcher'), 120);
begin
  return query
  with candidate as (
    select e.id
    from public.notification_events e
    where e.status in ('pending', 'failed')
      and coalesce(e.next_attempt_at, now()) <= now()
      and e.attempt_count < e.max_attempts
      and nullif(trim(coalesce(e.recipient_email, '')), '') is not null
      and coalesce(e.channel, 'email') = 'email'
    order by
      case e.priority
        when 'critical' then 1
        when 'high' then 2
        when 'normal' then 3
        when 'low' then 4
        else 5
      end,
      e.created_at,
      e.id
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update public.notification_events e
       set status = 'processing',
           locked_at = now(),
           locked_by = v_worker_id,
           last_attempt_at = now(),
           updated_at = now()
      from candidate c
     where e.id = c.id
     returning
       e.id,
       e.event_type,
       e.source_table,
       e.source_id,
       e.source_folio,
       e.recipient_type,
       e.recipient_profile_id,
       e.recipient_email,
       e.channel,
       e.priority,
       e.subject,
       e.payload,
       e.attempt_count
  )
  select
    claimed.id,
    claimed.event_type,
    claimed.source_table,
    claimed.source_id,
    claimed.source_folio,
    claimed.recipient_type,
    claimed.recipient_profile_id,
    claimed.recipient_email,
    claimed.channel,
    claimed.priority,
    claimed.subject,
    claimed.payload,
    claimed.attempt_count
  from claimed
  order by
    case claimed.priority
      when 'critical' then 1
      when 'high' then 2
      when 'normal' then 3
      when 'low' then 4
      else 5
    end,
    claimed.id;
end;
$$;

create or replace function public.mark_notification_processed_for_dispatcher(
  p_event_id uuid,
  p_worker_id text,
  p_provider_message_id text default null,
  p_resend_email_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.notification_events%rowtype;
  v_attempt_number integer;
  v_worker_id text := left(coalesce(nullif(trim(p_worker_id), ''), 'edge-notification-dispatcher'), 120);
  v_provider_message_id text := left(nullif(trim(coalesce(p_provider_message_id, p_resend_email_id, '')), ''), 255);
begin
  select *
    into v_event
  from public.notification_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'notification_event_not_found';
  end if;

  if v_event.status <> 'processing' then
    raise exception 'notification_event_not_processable:%', v_event.status;
  end if;

  if nullif(trim(coalesce(v_event.locked_by, '')), '') is not null
     and v_event.locked_by <> v_worker_id then
    raise exception 'notification_event_locked_by_different_worker';
  end if;

  v_attempt_number := greatest(v_event.attempt_count + 1, 1);

  insert into public.notification_delivery_attempts (
    notification_event_id,
    attempt_number,
    status,
    provider_message_id,
    worker_id
  )
  values (
    p_event_id,
    v_attempt_number,
    'sent',
    v_provider_message_id,
    v_worker_id
  );

  update public.notification_events
     set status = 'sent',
         processed_at = now(),
         last_attempt_at = now(),
         locked_at = null,
         locked_by = null,
         last_error = null,
         next_attempt_at = null,
         updated_at = now()
   where id = p_event_id;

  return jsonb_build_object(
    'event_id', p_event_id,
    'status', 'sent',
    'attempt_number', v_attempt_number,
    'provider_message_id', v_provider_message_id
  );
end;
$$;

create or replace function public.mark_notification_failed_for_dispatcher(
  p_event_id uuid,
  p_error_message text,
  p_worker_id text,
  p_resend_email_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.notification_events%rowtype;
  v_attempt_number integer;
  v_new_status text;
  v_next_attempt_at timestamptz;
  v_worker_id text := left(coalesce(nullif(trim(p_worker_id), ''), 'edge-notification-dispatcher'), 120);
  v_error_message text := left(coalesce(nullif(trim(p_error_message), ''), 'notification_dispatch_failed'), 1000);
  v_resend_email_id text := left(nullif(trim(coalesce(p_resend_email_id, '')), ''), 255);
begin
  select *
    into v_event
  from public.notification_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'notification_event_not_found';
  end if;

  if v_event.status <> 'processing' then
    raise exception 'notification_event_not_failable:%', v_event.status;
  end if;

  if nullif(trim(coalesce(v_event.locked_by, '')), '') is not null
     and v_event.locked_by <> v_worker_id then
    raise exception 'notification_event_locked_by_different_worker';
  end if;

  v_attempt_number := v_event.attempt_count + 1;

  if v_attempt_number >= v_event.max_attempts then
    v_new_status := 'dead_letter';
    v_next_attempt_at := null;
  else
    v_new_status := 'failed';
    v_next_attempt_at := now() + (interval '5 minutes' * greatest(v_attempt_number, 1));
  end if;

  insert into public.notification_delivery_attempts (
    notification_event_id,
    attempt_number,
    status,
    provider_message_id,
    error_message,
    worker_id
  )
  values (
    p_event_id,
    v_attempt_number,
    v_new_status,
    v_resend_email_id,
    v_error_message,
    v_worker_id
  );

  update public.notification_events
     set status = v_new_status,
         attempt_count = v_attempt_number,
         last_error = v_error_message,
         last_attempt_at = now(),
         next_attempt_at = v_next_attempt_at,
         locked_at = null,
         locked_by = null,
         updated_at = now()
   where id = p_event_id;

  return jsonb_build_object(
    'event_id', p_event_id,
    'status', v_new_status,
    'attempt_number', v_attempt_number,
    'will_retry', v_new_status = 'failed',
    'resend_email_id', v_resend_email_id
  );
end;
$$;

revoke all on function public.claim_notification_events_for_dispatcher(integer, text) from public, anon, authenticated;
revoke all on function public.mark_notification_processed_for_dispatcher(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.mark_notification_failed_for_dispatcher(uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.claim_notification_events_for_dispatcher(integer, text) to service_role, postgres;
grant execute on function public.mark_notification_processed_for_dispatcher(uuid, text, text, text) to service_role, postgres;
grant execute on function public.mark_notification_failed_for_dispatcher(uuid, text, text, text) to service_role, postgres;
