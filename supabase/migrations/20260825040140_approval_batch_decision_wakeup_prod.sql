begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
begin
  if to_regclass('public.notification_events') is null
     or to_regclass('public.approval_batches') is null
     or to_regprocedure(
          'public.get_approval_batch_decision_notification_document(uuid,text)'
        ) is null
     or to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'approval_batch_decision_wakeup_prerequisites_missing';
  end if;
end
$precheck$;

create or replace function public.claim_approval_batch_decision_events_for_dispatcher(
  p_limit integer default 5,
  p_worker_id text default 'edge-notification-dispatcher-prod',
  p_created_at_after timestamptz default null
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
    coalesce(nullif(btrim(p_worker_id), ''), 'edge-notification-dispatcher-prod'),
    120
  );
begin
  if p_created_at_after is null then
    raise exception 'approval_batch_decision_activation_cutoff_required';
  end if;

  return query
  with candidate as (
    select event.id
    from public.notification_events event
    join public.approval_batches batch
      on batch.id = event.source_id
    join public.profiles submitter
      on submitter.id = batch.submitted_by
    where event.event_type in (
        'approval_batch.approved',
        'approval_batch.partially_approved'
      )
      and event.source_table = 'approval_batches'
      and event.status in ('pending', 'failed')
      and event.created_at > p_created_at_after
      and event.recipient_profile_id = batch.submitted_by
      and coalesce(submitter.active, true)
      and nullif(btrim(coalesce(submitter.email, '')), '') is not null
      and lower(btrim(event.recipient_email)) = lower(btrim(submitter.email))
      and event.payload->>'status' = case event.event_type
        when 'approval_batch.approved' then 'approved'
        else 'partially_approved'
      end
      and batch.decided_at is not null
      and batch.status in (
        case event.event_type
          when 'approval_batch.approved' then 'approved'
          else 'partially_approved'
        end,
        'closed'
      )
      and coalesce(event.next_attempt_at, now()) <= now()
      and event.attempt_count < event.max_attempts
      and coalesce(event.channel, 'email') = 'email'
    order by event.created_at, event.id
    for update of event skip locked
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
  order by claimed.id;
end;
$$;

revoke all on function public.claim_approval_batch_decision_events_for_dispatcher(
  integer,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.claim_approval_batch_decision_events_for_dispatcher(
  integer,
  text,
  timestamptz
) to service_role;

create or replace function public.notification_approval_batch_decision_dispatch_wakeup_internal()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_url text;
  v_secret text;
  v_cutoff text;
  v_cutoff_at timestamptz;
  v_enabled text;
  v_request_id bigint;
begin
  if new.event_type not in (
       'approval_batch.approved',
       'approval_batch.partially_approved'
     )
     or new.status <> 'pending' then
    return new;
  end if;

  begin
    select
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_approval_batch_decision_dispatcher_url'
      ),
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_dispatcher_secret'
      ),
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_approval_batch_decision_cutoff_at'
      ),
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_approval_batch_decision_immediate_enabled'
      )
      into v_url, v_secret, v_cutoff, v_enabled
    from vault.decrypted_secrets secret
    where secret.name = any(array[
      'notification_approval_batch_decision_dispatcher_url',
      'notification_dispatcher_secret',
      'notification_approval_batch_decision_cutoff_at',
      'notification_approval_batch_decision_immediate_enabled'
    ]::text[]);

    if lower(coalesce(v_enabled, 'false')) <> 'true' then
      return new;
    end if;

    if nullif(btrim(v_url), '') is null
       or nullif(btrim(v_secret), '') is null
       or nullif(btrim(v_cutoff), '') is null then
      return new;
    end if;

    if v_url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/notification-dispatcher$' then
      return new;
    end if;

    v_cutoff_at := v_cutoff::timestamptz;
    if new.created_at <= v_cutoff_at then
      return new;
    end if;

    select net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'event_types', jsonb_build_array(
          'approval_batch.approved',
          'approval_batch.partially_approved'
        ),
        'created_at_from', v_cutoff,
        'limit', 5
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-notification-dispatcher-secret', v_secret
      ),
      timeout_milliseconds := 2000
    ) into v_request_id;
  exception when others then
    raise warning 'notification_approval_batch_decision_wakeup_enqueue_failed';
  end;

  return new;
end;
$$;

revoke all on function public.notification_approval_batch_decision_dispatch_wakeup_internal()
from public, anon, authenticated, service_role;

drop trigger if exists notification_approval_batch_decision_dispatch_after_insert
on public.notification_events;

create trigger notification_approval_batch_decision_dispatch_after_insert
after insert on public.notification_events
for each row
when (
  new.event_type in (
    'approval_batch.approved',
    'approval_batch.partially_approved'
  )
  and new.status = 'pending'
)
execute function public.notification_approval_batch_decision_dispatch_wakeup_internal();

comment on function public.claim_approval_batch_decision_events_for_dispatcher(
  integer,
  text,
  timestamptz
) is
  'Claims only final weekly-cut decisions strictly newer than the PROD activation cutoff and only for the active submitted_by recipient.';

comment on function public.notification_approval_batch_decision_dispatch_wakeup_internal() is
  'Best-effort post-commit PROD wake-up for new final weekly-cut decision events using an independent immutable cutoff.';

commit;

