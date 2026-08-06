begin;

do $precheck$
begin
  if to_regprocedure(
       'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)'
     ) is null then
    raise exception 'notification_dispatcher_claim_v2_missing';
  end if;
end
$precheck$;

create or replace function public.claim_notification_events_for_dispatcher_v2(
  p_limit integer default 5,
  p_worker_id text default 'edge-notification-dispatcher',
  p_event_types text[] default null,
  p_created_at_from timestamptz default null
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
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 5);
  v_worker_id text := left(
    coalesce(nullif(btrim(p_worker_id), ''), 'edge-notification-dispatcher'),
    120
  );
  v_event_types text[];
  v_allowed_event_types constant text[] := array[
    'payment_request.created',
    'payment_request.approved',
    'payment_request.rejected',
    'payment_request.changes_requested',
    'payment_request.exception_approved',
    'payment_request.exception_rejected',
    'approval_batch.submitted',
    'approval_batch.approved',
    'approval_batch.partially_approved',
    'approval_batch.item_rejected',
    'payment_request.extraordinary_authorized',
    'approval_batch.item_rebatched',
    'payment_receipt.linked'
  ]::text[];
begin
  select array_agg(
           distinct btrim(requested.event_type)
           order by btrim(requested.event_type)
         )
    into v_event_types
  from unnest(coalesce(p_event_types, array[]::text[])) as requested(event_type)
  where nullif(btrim(coalesce(requested.event_type, '')), '') is not null;

  if coalesce(cardinality(v_event_types), 0) = 0 then
    raise exception 'notification_dispatcher_event_types_required';
  end if;
  if p_created_at_from is null then
    raise exception 'notification_dispatcher_cutoff_required';
  end if;
  if exists (
    select 1
    from unnest(v_event_types) as requested(event_type)
    where not requested.event_type = any(v_allowed_event_types)
  ) then
    raise exception 'notification_dispatcher_event_type_not_allowed';
  end if;

  return query
  with candidate as (
    select event.id
    from public.notification_events event
    where event.event_type = any(v_event_types)
      and event.status in ('pending', 'failed')
      and event.created_at >= p_created_at_from
      and coalesce(event.next_attempt_at, now()) <= now()
      and event.attempt_count < event.max_attempts
      and nullif(btrim(coalesce(event.recipient_email, '')), '') is not null
      and coalesce(event.channel, 'email') = 'email'
    order by
      case event.priority
        when 'critical' then 1
        when 'high' then 2
        when 'normal' then 3
        when 'low' then 4
        else 5
      end,
      event.created_at,
      event.id
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update public.notification_events event
       set status = 'processing',
           locked_at = now(),
           locked_by = v_worker_id,
           last_attempt_at = now(),
           updated_at = now()
      from candidate
     where event.id = candidate.id
     returning
       event.id,
       event.event_type,
       event.source_table,
       event.source_id,
       event.source_folio,
       event.recipient_type,
       event.recipient_profile_id,
       event.recipient_email,
       event.channel,
       event.priority,
       event.subject,
       event.payload,
       event.attempt_count
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

do $postcheck$
declare
  v_definition text;
begin
  select pg_get_functiondef(
           'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)'::regprocedure
         )
    into v_definition;

  if v_definition not like '%btrim(requested.event_type)%'
     or v_definition not like '%coalesce(requested.event_type, ''%'
     or v_definition like '%btrim(event_type) order by btrim(event_type)%' then
    raise exception 'notification_dispatcher_claim_v2_binding_fix_not_applied';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)',
       'execute'
     ) then
    raise exception 'notification_dispatcher_claim_v2_acl_drift';
  end if;
end
$postcheck$;

commit;
