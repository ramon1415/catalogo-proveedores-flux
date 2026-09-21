-- DEV-only, audit-safe retry lane for the two payment-outcome emails from
-- SOL-2026-0118. The dispatcher remains in test_only globally. A retry may
-- preserve its intended recipient only when this service-only function proves
-- that it is an exact clone of a previously sent event.

do $$
declare
  v_original_count integer;
begin
  if current_database() is null then
    raise exception 'database_identity_unavailable';
  end if;

  select count(*)
    into v_original_count
  from (
    select distinct on (event.event_type) event.id
    from public.notification_events event
    where event.source_folio = 'SOL-2026-0118'
      and lower(btrim(event.recipient_email)) = 'ramon@quantta.mx'
      and event.event_type in (
        'payment_request.approved',
        'payment_receipt.linked'
      )
      and event.status = 'sent'
      and event.processed_at is not null
    order by event.event_type, event.processed_at desc, event.id desc
  ) originals;

  if v_original_count <> 2 then
    raise exception 'payment_outcome_retry_original_contract_invalid';
  end if;
end;
$$;

create or replace function public.notification_dev_intended_recipient_retry_authorized(
  p_event_id uuid,
  p_recipient_email text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.notification_events retry
    join public.notification_events original
      on original.id = case
        when coalesce(retry.payload ->> 'dev_retry_original_event_id', '')
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (retry.payload ->> 'dev_retry_original_event_id')::uuid
        else null
      end
    where retry.id = p_event_id
      and retry.status = 'processing'
      and retry.event_type in (
        'payment_request.approved',
        'payment_receipt.linked'
      )
      and retry.payload ->> 'dev_intended_recipient_retry' = 'true'
      and retry.idempotency_key =
        'dev-intended-recipient-retry:v1:' || original.id::text
      and retry.recipient_email = lower(btrim(p_recipient_email))
      and retry.recipient_email = original.recipient_email
      and retry.recipient_profile_id is not distinct from original.recipient_profile_id
      and retry.event_type = original.event_type
      and retry.source_table is not distinct from original.source_table
      and retry.source_id is not distinct from original.source_id
      and retry.source_folio is not distinct from original.source_folio
      and retry.audience = 'internal'
      and original.status = 'sent'
      and original.processed_at is not null
      and retry.created_at >= original.processed_at
      and retry.created_at >= now() - interval '24 hours'
      and retry.created_at <= now() + interval '5 minutes'
  );
$$;

revoke all on function public.notification_dev_intended_recipient_retry_authorized(uuid, text)
  from public, anon, authenticated;
grant execute on function public.notification_dev_intended_recipient_retry_authorized(uuid, text)
  to service_role;

comment on function public.notification_dev_intended_recipient_retry_authorized(uuid, text) is
  'DEV-only service check for an exact, audited payment-outcome retry. Fails closed unless the retry matches a previously sent original event.';

with originals as materialized (
  select distinct on (event.event_type) event.*
  from public.notification_events event
  where event.source_folio = 'SOL-2026-0118'
    and lower(btrim(event.recipient_email)) = 'ramon@quantta.mx'
    and event.event_type in (
      'payment_request.approved',
      'payment_receipt.linked'
    )
    and event.status = 'sent'
    and event.processed_at is not null
  order by event.event_type, event.processed_at desc, event.id desc
),
retries as materialized (
  select gen_random_uuid() as retry_id, original.*
  from originals original
)
insert into public.notification_events (
  id,
  event_type,
  source_table,
  source_id,
  source_folio,
  recipient_type,
  recipient_profile_id,
  recipient_email,
  recipient_role,
  channel,
  priority,
  subject,
  payload,
  idempotency_key,
  status,
  attempt_count,
  max_attempts,
  next_attempt_at,
  audience,
  event_version
)
select
  retry.retry_id,
  retry.event_type,
  retry.source_table,
  retry.source_id,
  retry.source_folio,
  retry.recipient_type,
  retry.recipient_profile_id,
  retry.recipient_email,
  retry.recipient_role,
  retry.channel,
  retry.priority,
  retry.subject,
  retry.payload || jsonb_build_object(
    'dev_intended_recipient_retry', true,
    'dev_retry_original_event_id', retry.id::text,
    'dev_retry_reason', 'authorized_delivery_to_ramon_quantta_after_test_only_redirect',
    'dev_retry_authorized_at', now()
  ),
  'dev-intended-recipient-retry:v1:' || retry.id::text,
  'pending',
  0,
  retry.max_attempts,
  now(),
  'internal',
  retry.event_version
from retries retry
on conflict (idempotency_key) do nothing;

do $$
declare
  v_retry_count integer;
  v_public_acl boolean;
begin
  select count(*)
    into v_retry_count
  from public.notification_events event
  where event.idempotency_key like 'dev-intended-recipient-retry:v1:%'
    and event.source_folio = 'SOL-2026-0118'
    and event.recipient_email = 'ramon@quantta.mx'
    and event.event_type in (
      'payment_request.approved',
      'payment_receipt.linked'
    )
    and event.payload ->> 'dev_intended_recipient_retry' = 'true';

  if v_retry_count <> 2 then
    raise exception 'payment_outcome_retry_insert_contract_invalid';
  end if;

  select exists (
      select 1
      from pg_proc procedure
      cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where procedure.oid =
        'public.notification_dev_intended_recipient_retry_authorized(uuid,text)'::regprocedure
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
    into v_public_acl;

  if v_public_acl then
    raise exception 'payment_outcome_retry_authorization_acl_invalid';
  end if;
end;
$$;
