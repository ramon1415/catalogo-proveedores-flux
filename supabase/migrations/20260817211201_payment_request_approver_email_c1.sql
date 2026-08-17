begin;

do $precheck$
begin
  if to_regclass('public.notification_events') is null
     or to_regclass('public.notification_delivery_attempts') is null
     or to_regprocedure(
          'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)'
        ) is null
     or to_regprocedure(
          'public.notification_receipt_linked_dispatch_wakeup_internal()'
        ) is null then
    raise exception 'payment_request_approver_email_prerequisites_missing';
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'payment_request_approver_email_vault_missing';
  end if;

  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'payment_request_approver_email_pg_net_missing';
  end if;
end
$precheck$;

create or replace function public.claim_payment_request_created_events_for_dispatcher(
  p_limit integer default 5,
  p_worker_id text default 'edge-notification-dispatcher-payment-request-created',
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
    coalesce(
      nullif(btrim(p_worker_id), ''),
      'edge-notification-dispatcher-payment-request-created'
    ),
    120
  );
begin
  if p_created_at_after is null then
    raise exception 'payment_request_created_activation_cutoff_required';
  end if;

  return query
  with candidate as (
    select event.id
    from public.notification_events event
    where event.event_type = 'payment_request.created'
      and event.status in ('pending', 'failed')
      and event.created_at > p_created_at_after
      and coalesce(event.next_attempt_at, now()) <= now()
      and event.attempt_count < event.max_attempts
      and nullif(btrim(coalesce(event.recipient_email, '')), '') is not null
      and event.recipient_profile_id is not null
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

revoke all on function public.claim_payment_request_created_events_for_dispatcher(
  integer,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.claim_payment_request_created_events_for_dispatcher(
  integer,
  text,
  timestamptz
) to service_role;

create or replace function public.notification_payment_request_created_dispatch_wakeup_internal()
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
  v_enabled text;
  v_request_id bigint;
begin
  if new.event_type <> 'payment_request.created'
     or new.status <> 'pending' then
    return new;
  end if;

  begin
    select
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_payment_request_created_dispatcher_url'
      ),
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_dispatcher_secret'
      ),
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_payment_request_created_cutoff_at'
      ),
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_payment_request_created_immediate_enabled'
      )
      into v_url, v_secret, v_cutoff, v_enabled
    from vault.decrypted_secrets secret
    where secret.name = any(array[
      'notification_payment_request_created_dispatcher_url',
      'notification_dispatcher_secret',
      'notification_payment_request_created_cutoff_at',
      'notification_payment_request_created_immediate_enabled'
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

    perform v_cutoff::timestamptz;

    select net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'event_types', jsonb_build_array('payment_request.created'),
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
    raise warning 'notification_payment_request_created_dispatch_wakeup_enqueue_failed';
  end;

  return new;
end;
$$;

revoke all on function public.notification_payment_request_created_dispatch_wakeup_internal()
from public, anon, authenticated, service_role;

drop trigger if exists notification_payment_request_created_immediate_dispatch_after_insert
on public.notification_events;

create trigger notification_payment_request_created_immediate_dispatch_after_insert
after insert on public.notification_events
for each row
when (
  new.event_type = 'payment_request.created'
  and new.status = 'pending'
)
execute function public.notification_payment_request_created_dispatch_wakeup_internal();

do $postcheck$
declare
  v_claim_definition text;
  v_wakeup_definition text;
  v_created_trigger_definition text;
  v_receipt_trigger_definition text;
  v_receipt_wakeup_definition text;
begin
  select pg_get_functiondef(
           'public.claim_payment_request_created_events_for_dispatcher(integer,text,timestamptz)'::regprocedure
         )
    into v_claim_definition;

  select pg_get_functiondef(
           'public.notification_payment_request_created_dispatch_wakeup_internal()'::regprocedure
         )
    into v_wakeup_definition;

  select pg_get_triggerdef(trigger.oid, true)
    into v_created_trigger_definition
  from pg_trigger trigger
  where trigger.tgrelid = 'public.notification_events'::regclass
    and trigger.tgname = 'notification_payment_request_created_immediate_dispatch_after_insert'
    and not trigger.tgisinternal;

  select pg_get_triggerdef(trigger.oid, true)
    into v_receipt_trigger_definition
  from pg_trigger trigger
  where trigger.tgrelid = 'public.notification_events'::regclass
    and trigger.tgname = 'notification_receipt_linked_immediate_dispatch_after_insert'
    and not trigger.tgisinternal;

  select pg_get_functiondef(
           'public.notification_receipt_linked_dispatch_wakeup_internal()'::regprocedure
         )
    into v_receipt_wakeup_definition;

  if v_claim_definition not like '%event.event_type = ''payment_request.created''%'
     or v_claim_definition not like '%event.created_at > p_created_at_after%'
     or v_claim_definition like '%payment_receipt.linked%'
     or v_claim_definition like '%p_event_types%' then
    raise exception 'payment_request_created_exclusive_claim_contract_invalid';
  end if;

  if v_wakeup_definition not like '%notification_payment_request_created_cutoff_at%'
     or v_wakeup_definition not like '%notification_payment_request_created_immediate_enabled%'
     or position(
          'jsonb_build_array(''payment_request.created'')'
          in v_wakeup_definition
        ) = 0
     or v_wakeup_definition like '%payment_receipt.linked%'
     or v_wakeup_definition like '%api.resend.com%' then
    raise exception 'payment_request_created_wakeup_contract_invalid';
  end if;

  if v_created_trigger_definition is null
     or v_created_trigger_definition not like '%AFTER INSERT%'
     or v_created_trigger_definition not like '%payment_request.created%'
     or v_created_trigger_definition not like '%status = ''pending''%' then
    raise exception 'payment_request_created_trigger_contract_invalid';
  end if;

  if v_receipt_trigger_definition is null
     or v_receipt_trigger_definition not like '%payment_receipt.linked%'
     or v_receipt_trigger_definition like '%payment_request.created%'
     or position(
          'jsonb_build_array(''payment_receipt.linked'')'
          in v_receipt_wakeup_definition
        ) = 0
     or v_receipt_wakeup_definition like '%payment_request.created%' then
    raise exception 'payment_receipt_linked_regression_detected';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.claim_payment_request_created_events_for_dispatcher(integer,text,timestamptz)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.claim_payment_request_created_events_for_dispatcher(integer,text,timestamptz)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.claim_payment_request_created_events_for_dispatcher(integer,text,timestamptz)',
       'execute'
     ) then
    raise exception 'payment_request_created_claim_acl_invalid';
  end if;

  if has_function_privilege(
       'service_role',
       'public.notification_payment_request_created_dispatch_wakeup_internal()',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.notification_payment_request_created_dispatch_wakeup_internal()',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.notification_payment_request_created_dispatch_wakeup_internal()',
       'execute'
     ) then
    raise exception 'payment_request_created_wakeup_acl_invalid';
  end if;
end
$postcheck$;

comment on function public.claim_payment_request_created_events_for_dispatcher(
  integer,
  text,
  timestamptz
) is
  'Claims only payment_request.created events strictly newer than the immutable activation cutoff. Existing and boundary events remain permanently ineligible.';

comment on function public.notification_payment_request_created_dispatch_wakeup_internal() is
  'Best-effort post-commit pg_net wake-up for new payment_request.created events. Uses an independent immutable cutoff and never changes payment_receipt.linked dispatch.';

commit;
