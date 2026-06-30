-- Flux Operadora - Fase 3 DEV email pilot cleanup
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Uso manual. Cancela eventos piloto pending/processing/failed.
-- No borra historico y no toca eventos sent/cancelled/dead_letter.
-- Nota: provider_message_id vive en public.notification_delivery_attempts,
-- no en public.notification_events.

begin;

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  now() as checked_at;

-- Vista previa de eventos que se cancelaran.
select
  ne.id,
  ne.event_type,
  ne.source_folio,
  ne.status,
  ne.priority,
  latest_attempt.provider_message_id,
  latest_attempt.attempt_status,
  latest_attempt.attempt_created_at,
  ne.locked_by,
  ne.idempotency_key,
  ne.created_at,
  ne.updated_at
from public.notification_events ne
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
where ne.status in ('pending', 'processing', 'failed')
  and (
    ne.idempotency_key like 'phase3-dev:%'
    or ne.locked_by = 'n8n-dev-dispatcher-email-pilot'
    or ne.last_error ilike '%email pilot%'
    or exists (
      select 1
      from public.notification_delivery_attempts da
      where da.notification_event_id = ne.id
        and (
          da.worker_id = 'n8n-dev-dispatcher-email-pilot'
          or da.provider_message_id like 'email-pilot:%'
          or da.error_message ilike '%email pilot%'
        )
    )
  )
order by ne.created_at desc;

-- Cancelar eventos piloto no finalizados.
update public.notification_events ne
set
  status = 'cancelled',
  locked_at = null,
  locked_by = null,
  next_attempt_at = null,
  last_error = 'cancelled during phase3 email pilot cleanup',
  updated_at = now()
where ne.status in ('pending', 'processing', 'failed')
  and (
    ne.idempotency_key like 'phase3-dev:%'
    or ne.locked_by = 'n8n-dev-dispatcher-email-pilot'
    or ne.last_error ilike '%email pilot%'
    or exists (
      select 1
      from public.notification_delivery_attempts da
      where da.notification_event_id = ne.id
        and (
          da.worker_id = 'n8n-dev-dispatcher-email-pilot'
          or da.provider_message_id like 'email-pilot:%'
          or da.error_message ilike '%email pilot%'
        )
    )
  );

-- Postcheck rapido.
with pilot_events as (
  select distinct ne.id
  from public.notification_events ne
  left join public.notification_delivery_attempts da
    on da.notification_event_id = ne.id
  where ne.idempotency_key like 'phase3-dev:%'
     or ne.locked_by = 'n8n-dev-dispatcher-email-pilot'
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

commit;
