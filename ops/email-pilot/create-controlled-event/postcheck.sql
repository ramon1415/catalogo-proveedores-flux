-- Flux Operadora - DEV email pilot controlled event postcheck
-- Read-only checks after the controlled event load.

select
  'DEV'::text as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co'::text as expected_supabase_host,
  current_database() as database_name,
  now() as checked_at;

with pilot_events as (
  select
    ne.id,
    ne.event_type::text as event_type,
    ne.source_table,
    ne.source_id,
    ne.source_folio,
    ne.recipient_type,
    ne.recipient_profile_id,
    ne.recipient_email,
    ne.recipient_role,
    ne.channel::text as channel,
    ne.priority::text as priority,
    ne.subject,
    ne.payload,
    ne.idempotency_key,
    ne.status::text as status,
    ne.locked_at,
    ne.locked_by,
    ne.processed_at,
    ne.created_at
  from public.notification_events ne
  where ne.idempotency_key like 'phase3-dev:email-pilot:%'
)
select
  id,
  event_type,
  source_table,
  source_id,
  source_folio,
  recipient_type,
  recipient_email,
  recipient_role,
  channel,
  priority,
  status,
  idempotency_key,
  payload ->> 'email_pilot' as email_pilot,
  locked_at,
  locked_by,
  processed_at,
  created_at
from pilot_events
order by created_at desc, id
limit 10;

with pilot_events as (
  select
    ne.id,
    ne.event_type::text as event_type,
    ne.recipient_email,
    ne.channel::text as channel,
    ne.payload,
    ne.idempotency_key,
    ne.status::text as status,
    ne.locked_at,
    ne.locked_by,
    ne.processed_at,
    ne.created_at
  from public.notification_events ne
  where ne.idempotency_key like 'phase3-dev:email-pilot:%'
), checks as (
  select
    count(*) filter (where status = 'pending') as pending_pilot_events,
    count(*) filter (where status = 'pending' and event_type = 'payment_request.created') as pending_created_events,
    count(*) filter (where status = 'pending' and idempotency_key like 'phase3-dev:email-pilot:%') as pending_matching_key_events,
    count(*) filter (where status = 'pending' and nullif(btrim(coalesce(recipient_email, '')), '') is not null) as pending_with_recipient_email,
    count(*) filter (where status = 'pending' and channel = 'email') as pending_email_channel_events,
    count(*) filter (where status = 'pending' and payload ->> 'email_pilot' = 'true') as pending_email_pilot_payload_events,
    count(*) filter (where status = 'pending' and locked_at is null and locked_by is null and processed_at is null) as pending_without_locks,
    max(created_at) filter (where status = 'pending') as newest_pending_created_at
  from pilot_events
)
select
  pending_pilot_events,
  pending_created_events,
  pending_matching_key_events,
  pending_with_recipient_email,
  pending_email_channel_events,
  pending_email_pilot_payload_events,
  pending_without_locks,
  newest_pending_created_at,
  case
    when pending_pilot_events = 1
      and pending_created_events = 1
      and pending_matching_key_events = 1
      and pending_with_recipient_email = 1
      and pending_email_channel_events = 1
      and pending_email_pilot_payload_events = 1
      and pending_without_locks = 1
      and newest_pending_created_at >= now() - interval '10 minutes'
      then 'PHASE3_EMAIL_PILOT_EVENT_READY'
    when pending_pilot_events = 1
      and pending_created_events = 1
      and pending_matching_key_events = 1
      and pending_with_recipient_email = 1
      and pending_email_channel_events = 1
      and pending_email_pilot_payload_events = 1
      and pending_without_locks = 1
      then 'PHASE3_EMAIL_PILOT_EVENT_ALREADY_EXISTS_READY'
    else 'PHASE3_EMAIL_PILOT_EVENT_REVIEW_REQUIRED'
  end as result
from checks;
