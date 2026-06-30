-- Flux Operadora - Fase 3 DEV email pilot cleanup
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Uso manual. Cancela eventos piloto pending/processing/failed.
-- No borra historico y no toca eventos sent/cancelled/dead_letter.

begin;

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  now() as checked_at;

-- 01. Vista previa de eventos que se cancelaran.
select
  id,
  event_type,
  source_folio,
  status,
  priority,
  provider_message_id,
  locked_by,
  idempotency_key,
  created_at,
  updated_at
from public.notification_events
where status in ('pending', 'processing', 'failed')
  and (
    idempotency_key like 'phase3-dev:%'
    or locked_by = 'n8n-dev-dispatcher-email-pilot'
    or last_error ilike '%email pilot%'
  )
order by created_at desc;

-- 02. Cancelar eventos piloto no finalizados.
update public.notification_events
set
  status = 'cancelled',
  locked_at = null,
  locked_by = null,
  next_attempt_at = null,
  last_error = 'cancelled during phase3 email pilot cleanup',
  updated_at = now()
where status in ('pending', 'processing', 'failed')
  and (
    idempotency_key like 'phase3-dev:%'
    or locked_by = 'n8n-dev-dispatcher-email-pilot'
    or last_error ilike '%email pilot%'
  );

-- 03. Postcheck rapido.
select
  status,
  count(*) as total
from public.notification_events
where idempotency_key like 'phase3-dev:%'
   or provider_message_id like 'email-pilot:%'
   or locked_by = 'n8n-dev-dispatcher-email-pilot'
group by status
order by status;

commit;
