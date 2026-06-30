-- Flux Operadora - Fase 3 DEV email pilot postcheck
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: solo SELECT. No modifica datos.
-- Nota: provider_message_id vive en public.notification_delivery_attempts,
-- no en public.notification_events.

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  now() as checked_at;

-- Eventos relacionados con el email pilot.
with pilot_events as (
  select distinct ne.id
  from public.notification_events ne
  left join public.notification_delivery_attempts da
    on da.notification_event_id = ne.id
  where ne.locked_by = 'n8n-dev-dispatcher-email-pilot'
     or ne.idempotency_key like 'phase3-dev:%'
     or ne.last_error ilike '%email pilot%'
     or da.worker_id = 'n8n-dev-dispatcher-email-pilot'
     or da.provider_message_id like 'email-pilot:%'
     or da.error_message ilike '%email pilot%'
)
select
  ne.id,
  ne.event_type,
  ne.source_folio,
  ne.recipient_email,
  ne.status,
  ne.priority,
  ne.attempt_count,
  latest_attempt.provider_message_id,
  latest_attempt.attempt_status,
  latest_attempt.attempt_created_at,
  ne.last_error,
  ne.created_at,
  ne.updated_at
from pilot_events pe
join public.notification_events ne on ne.id = pe.id
left join lateral (
  select
    da.provider_message_id,
    da.status as attempt_status,
    da.created_at as attempt_created_at
  from public.notification_delivery_attempts da
  where da.notification_event_id = ne.id
  order by da.created_at desc
  limit 1
) latest_attempt on true
order by ne.updated_at desc
limit 50;

-- Delivery attempts del piloto.
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
   or da.error_message ilike '%email pilot%'
order by da.created_at desc
limit 50;

-- Resumen por status de eventos tocados por piloto.
with pilot_events as (
  select distinct ne.id
  from public.notification_events ne
  left join public.notification_delivery_attempts da
    on da.notification_event_id = ne.id
  where ne.locked_by = 'n8n-dev-dispatcher-email-pilot'
     or ne.idempotency_key like 'phase3-dev:%'
     or ne.last_error ilike '%email pilot%'
     or da.worker_id = 'n8n-dev-dispatcher-email-pilot'
     or da.provider_message_id like 'email-pilot:%'
     or da.error_message ilike '%email pilot%'
)
select
  ne.status,
  count(*) as total
from pilot_events pe
join public.notification_events ne on ne.id = pe.id
group by ne.status
order by ne.status;

-- Locks colgados del piloto.
select
  count(*) as processing_events,
  count(*) filter (where locked_at < now() - interval '15 minutes') as stale_processing_events,
  min(locked_at) as oldest_lock_at,
  max(locked_at) as newest_lock_at
from public.notification_events
where status = 'processing'
  and locked_by = 'n8n-dev-dispatcher-email-pilot';

-- Failed / dead_letter del piloto.
with pilot_events as (
  select distinct ne.id
  from public.notification_events ne
  left join public.notification_delivery_attempts da
    on da.notification_event_id = ne.id
  where ne.locked_by = 'n8n-dev-dispatcher-email-pilot'
     or ne.idempotency_key like 'phase3-dev:%'
     or ne.last_error ilike '%email pilot%'
     or da.worker_id = 'n8n-dev-dispatcher-email-pilot'
     or da.provider_message_id like 'email-pilot:%'
     or da.error_message ilike '%email pilot%'
)
select
  ne.id,
  ne.event_type,
  ne.source_folio,
  ne.status,
  ne.attempt_count,
  ne.max_attempts,
  ne.last_error,
  ne.updated_at
from pilot_events pe
join public.notification_events ne on ne.id = pe.id
where ne.status in ('failed', 'dead_letter')
order by ne.updated_at desc
limit 50;

-- Resultado resumido.
with pilot_events as (
  select distinct ne.id
  from public.notification_events ne
  left join public.notification_delivery_attempts da
    on da.notification_event_id = ne.id
  where ne.locked_by = 'n8n-dev-dispatcher-email-pilot'
     or ne.idempotency_key like 'phase3-dev:%'
     or ne.last_error ilike '%email pilot%'
     or da.worker_id = 'n8n-dev-dispatcher-email-pilot'
     or da.provider_message_id like 'email-pilot:%'
     or da.error_message ilike '%email pilot%'
), checks as (
  select
    count(*) filter (
      where exists (
        select 1
        from public.notification_delivery_attempts da
        where da.notification_event_id = ne.id
          and da.provider_message_id like 'email-pilot:%'
      )
    ) as email_pilot_sent_events,
    count(*) filter (where ne.status = 'failed') as failed_events,
    count(*) filter (where ne.status = 'dead_letter') as dead_letter_events,
    count(*) filter (where ne.status = 'processing') as processing_events,
    count(*) filter (where ne.status = 'processing' and ne.locked_at < now() - interval '15 minutes') as stale_processing_events
  from pilot_events pe
  join public.notification_events ne on ne.id = pe.id
)
select
  *,
  case
    when stale_processing_events = 0 then 'PHASE3_EMAIL_PILOT_REVIEW_RESULTS'
    else 'PHASE3_EMAIL_PILOT_STALE_LOCKS_REVIEW_REQUIRED'
  end as result
from checks;
