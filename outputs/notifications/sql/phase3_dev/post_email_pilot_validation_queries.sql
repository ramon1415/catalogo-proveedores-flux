-- Flux Operadora - Fase 3 DEV email pilot postcheck
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: solo SELECT. No modifica datos.

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  now() as checked_at;

-- 01. Eventos procesados por email pilot.
select
  id,
  event_type,
  source_folio,
  recipient_email,
  status,
  priority,
  attempt_count,
  provider_message_id,
  last_error,
  created_at,
  updated_at
from public.notification_events
where provider_message_id like 'email-pilot:%'
   or locked_by = 'n8n-dev-dispatcher-email-pilot'
   or idempotency_key like 'phase3-dev:%'
order by updated_at desc
limit 50;

-- 02. Delivery attempts del piloto.
select
  da.id,
  da.notification_event_id,
  ne.event_type,
  ne.source_folio,
  da.status,
  da.worker_id,
  da.provider_message_id,
  da.n8n_execution_id,
  da.error_message,
  da.created_at
from public.notification_delivery_attempts da
join public.notification_events ne on ne.id = da.notification_event_id
where da.worker_id = 'n8n-dev-dispatcher-email-pilot'
   or da.provider_message_id like 'email-pilot:%'
order by da.created_at desc
limit 50;

-- 03. Resumen por status de eventos tocados por piloto.
select
  status,
  count(*) as total
from public.notification_events
where provider_message_id like 'email-pilot:%'
   or locked_by = 'n8n-dev-dispatcher-email-pilot'
   or idempotency_key like 'phase3-dev:%'
group by status
order by status;

-- 04. Locks colgados del piloto.
select
  count(*) as processing_events,
  count(*) filter (where locked_at < now() - interval '15 minutes') as stale_processing_events,
  min(locked_at) as oldest_lock_at,
  max(locked_at) as newest_lock_at
from public.notification_events
where status = 'processing'
  and locked_by = 'n8n-dev-dispatcher-email-pilot';

-- 05. Failed / dead_letter del piloto.
select
  id,
  event_type,
  source_folio,
  status,
  attempt_count,
  max_attempts,
  last_error,
  updated_at
from public.notification_events
where status in ('failed', 'dead_letter')
  and (
    locked_by = 'n8n-dev-dispatcher-email-pilot'
    or provider_message_id like 'email-pilot:%'
    or last_error ilike '%email pilot%'
  )
order by updated_at desc
limit 50;

-- 06. Resultado resumido.
with checks as (
  select
    count(*) filter (where provider_message_id like 'email-pilot:%') as email_pilot_sent_events,
    count(*) filter (where status = 'failed') as failed_events,
    count(*) filter (where status = 'dead_letter') as dead_letter_events,
    count(*) filter (where status = 'processing') as processing_events,
    count(*) filter (where status = 'processing' and locked_at < now() - interval '15 minutes') as stale_processing_events
  from public.notification_events
  where provider_message_id like 'email-pilot:%'
     or locked_by = 'n8n-dev-dispatcher-email-pilot'
     or idempotency_key like 'phase3-dev:%'
)
select
  *,
  case
    when stale_processing_events = 0 then 'PHASE3_EMAIL_PILOT_REVIEW_RESULTS'
    else 'PHASE3_EMAIL_PILOT_STALE_LOCKS_REVIEW_REQUIRED'
  end as result
from checks;
