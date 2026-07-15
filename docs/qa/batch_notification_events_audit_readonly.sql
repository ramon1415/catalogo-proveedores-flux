-- Cierre QA de Cortes - auditoria read-only de notification_events en DEV.
-- Proyecto esperado: scsirgbuqjcwoaxfacth.
-- Este archivo no reclama eventos, no invoca el dispatcher y no modifica datos.

begin;
set transaction read only;

-- Ajustar qa_started_at si la ejecucion funcional comienza mas tarde. El prefijo
-- cubre labels/notas QA; la ventana incluye folios SOL generados por el sistema.
with params as (
  select
    'QA-CIERRE-BATCH%'::text as qa_prefix,
    timestamptz '2026-07-13 21:00:00-06' as qa_started_at
),
audit_scope as (
  select ne.*
  from public.notification_events ne
  cross join params p
  where ne.event_type in (
    'approval_batch.submitted',
    'approval_batch.approved',
    'approval_batch.partially_approved',
    'approval_batch.item_rejected',
    'approval_batch.item_rebatched',
    'payment_request.extraordinary_authorized'
  )
    and (
      ne.source_folio ilike p.qa_prefix
      or ne.payload ->> 'batch_label' ilike p.qa_prefix
      or ne.payload ->> 'source_batch' ilike p.qa_prefix
      or ne.payload ->> 'folio' ilike p.qa_prefix
      or ne.created_at >= p.qa_started_at
    )
)
select
  id,
  event_type,
  source_table,
  source_id,
  source_folio,
  recipient_profile_id,
  recipient_email,
  recipient_role,
  subject,
  payload,
  idempotency_key,
  status,
  created_at
from audit_scope
order by created_at, event_type, recipient_email nulls last;

-- Debe devolver cero filas: idempotency_key duplicada dentro del alcance QA.
with params as (
  select 'QA-CIERRE-BATCH%'::text as qa_prefix,
    timestamptz '2026-07-13 21:00:00-06' as qa_started_at
),
audit_scope as (
  select ne.*
  from public.notification_events ne
  cross join params p
  where ne.event_type in (
    'approval_batch.submitted', 'approval_batch.approved',
    'approval_batch.partially_approved', 'approval_batch.item_rejected',
    'approval_batch.item_rebatched', 'payment_request.extraordinary_authorized'
  )
    and (
      ne.source_folio ilike p.qa_prefix
      or ne.payload ->> 'batch_label' ilike p.qa_prefix
      or ne.payload ->> 'source_batch' ilike p.qa_prefix
      or ne.payload ->> 'folio' ilike p.qa_prefix
      or ne.created_at >= p.qa_started_at
    )
)
select idempotency_key, count(*) as duplicate_count, array_agg(id order by created_at) as event_ids
from audit_scope
group by idempotency_key
having count(*) > 1;

-- Debe devolver cero filas: payload incompleto para item_rebatched.
with params as (
  select timestamptz '2026-07-13 21:00:00-06' as qa_started_at
)
select
  ne.id,
  ne.source_folio,
  ne.payload,
  array_remove(array[
    case when ne.payload ? 'previous_batch_id' then null else 'previous_batch_id' end,
    case when ne.payload ? 'previous_item_id' then null else 'previous_item_id' end,
    case when ne.payload ? 'previous_reject_reason' then null else 'previous_reject_reason' end,
    case when ne.payload ? 'correction_note' then null else 'correction_note' end,
    case when ne.payload ? 'new_batch_id' then null else 'new_batch_id' end,
    case when ne.payload ? 'new_item_id' then null else 'new_item_id' end,
    case when ne.payload ? 'review_sequence' then null else 'review_sequence' end,
    case when ne.payload ? 'resubmitted_by' then null else 'resubmitted_by' end,
    case when ne.payload ? 'resubmitted_at' then null else 'resubmitted_at' end
  ], null) as missing_payload_keys
from public.notification_events ne
cross join params p
where ne.event_type = 'approval_batch.item_rebatched'
  and ne.created_at >= p.qa_started_at
  and not (ne.payload ?& array[
    'previous_batch_id', 'previous_item_id', 'previous_reject_reason',
    'correction_note', 'new_batch_id', 'new_item_id', 'review_sequence',
    'resubmitted_by', 'resubmitted_at'
  ]);

-- Resumen de destinatarios para contrastar con el contrato esperado.
with params as (
  select timestamptz '2026-07-13 21:00:00-06' as qa_started_at
)
select
  ne.event_type,
  coalesce(ne.recipient_role, '(sin rol)') as recipient_role,
  count(*) as events,
  count(*) filter (where ne.recipient_profile_id is null) as missing_profile,
  count(*) filter (where nullif(btrim(ne.recipient_email), '') is null) as missing_email
from public.notification_events ne
cross join params p
where ne.event_type in (
  'approval_batch.submitted', 'approval_batch.approved',
  'approval_batch.partially_approved', 'approval_batch.item_rejected',
  'approval_batch.item_rebatched', 'payment_request.extraordinary_authorized'
)
  and ne.created_at >= p.qa_started_at
group by ne.event_type, ne.recipient_role
order by ne.event_type, ne.recipient_role;

-- Sin dispatcher en este cierre: los eventos QA no deben mostrar intentos o
-- procesamiento inesperado. Debe devolver cero filas para el batch actual.
with params as (
  select timestamptz '2026-07-13 21:00:00-06' as qa_started_at
)
select
  ne.id,
  ne.event_type,
  ne.source_folio,
  ne.status,
  ne.attempt_count,
  ne.locked_at,
  ne.locked_by,
  ne.processed_at,
  ne.last_error,
  ne.created_at
from public.notification_events ne
cross join params p
where ne.event_type in (
  'approval_batch.submitted', 'approval_batch.approved',
  'approval_batch.partially_approved', 'approval_batch.item_rejected',
  'approval_batch.item_rebatched', 'payment_request.extraordinary_authorized'
)
  and ne.created_at >= p.qa_started_at
  and (
    ne.status <> 'pending'
    or ne.attempt_count <> 0
    or ne.locked_at is not null
    or ne.locked_by is not null
    or ne.processed_at is not null
  )
order by ne.created_at;

commit;
