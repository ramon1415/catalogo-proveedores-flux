begin;

create extension if not exists pg_net
with schema extensions;

do $precheck$
begin
  if to_regclass('public.notification_events') is null
     or to_regprocedure(
          'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)'
        ) is null then
    raise exception 'notification_receipt_linked_dispatch_prerequisites_missing';
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'notification_receipt_linked_dispatch_vault_missing';
  end if;

  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'notification_receipt_linked_dispatch_pg_net_missing';
  end if;
end
$precheck$;

create or replace function public.notification_receipt_linked_dispatch_wakeup_internal()
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
  if new.event_type <> 'payment_receipt.linked'
     or new.status <> 'pending' then
    return new;
  end if;

  begin
  select
    max(secret.decrypted_secret) filter (
      where secret.name = 'notification_dispatcher_url'
    ),
    max(secret.decrypted_secret) filter (
      where secret.name = 'notification_dispatcher_secret'
    ),
    max(secret.decrypted_secret) filter (
      where secret.name = 'notification_dispatcher_cutoff_at'
    ),
    max(secret.decrypted_secret) filter (
      where secret.name = 'notification_receipt_linked_immediate_enabled'
    )
    into v_url, v_secret, v_cutoff, v_enabled
  from vault.decrypted_secrets secret
  where secret.name = any(array[
    'notification_dispatcher_url',
    'notification_dispatcher_secret',
    'notification_dispatcher_cutoff_at',
    'notification_receipt_linked_immediate_enabled'
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
        'event_types', jsonb_build_array('payment_receipt.linked'),
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
    -- Wake-up is best effort. The committed ledger event remains eligible for
    -- the permanent five-minute recovery worker.
    raise warning 'notification_receipt_linked_dispatch_wakeup_enqueue_failed';
  end;

  return new;
end;
$$;

revoke all on function public.notification_receipt_linked_dispatch_wakeup_internal()
from public, anon, authenticated, service_role;

drop trigger if exists notification_receipt_linked_immediate_dispatch_after_insert
on public.notification_events;

create trigger notification_receipt_linked_immediate_dispatch_after_insert
after insert on public.notification_events
for each row
when (
  new.event_type = 'payment_receipt.linked'
  and new.status = 'pending'
)
execute function public.notification_receipt_linked_dispatch_wakeup_internal();

do $postcheck$
declare
  v_function_definition text;
  v_trigger_definition text;
begin
  select pg_get_functiondef(
           'public.notification_receipt_linked_dispatch_wakeup_internal()'::regprocedure
         )
    into v_function_definition;

  select pg_get_triggerdef(trigger.oid, true)
    into v_trigger_definition
  from pg_trigger trigger
  where trigger.tgrelid = 'public.notification_events'::regclass
    and trigger.tgname = 'notification_receipt_linked_immediate_dispatch_after_insert'
    and not trigger.tgisinternal;

  if v_function_definition not like '%net.http_post(%'
     or v_function_definition not like '%notification_dispatcher_cutoff_at%'
     or v_function_definition not like '%notification_receipt_linked_immediate_enabled%'
     or v_function_definition like '%now()%'
     or v_function_definition like '%clock_timestamp()%'
     or v_function_definition like '%api.resend.com%' then
    raise exception 'notification_receipt_linked_dispatch_wakeup_contract_invalid';
  end if;

  if v_trigger_definition is null
     or v_trigger_definition not like '%AFTER INSERT%'
     or v_trigger_definition not like '%payment_receipt.linked%'
     or v_trigger_definition not like '%status = ''pending''%'
     or v_trigger_definition like '%UPDATE OF%'
     or v_trigger_definition like '%BEFORE INSERT%' then
    raise exception 'notification_receipt_linked_dispatch_trigger_contract_invalid';
  end if;

  if has_function_privilege(
       'anon',
       'public.notification_receipt_linked_dispatch_wakeup_internal()',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.notification_receipt_linked_dispatch_wakeup_internal()',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'public.notification_receipt_linked_dispatch_wakeup_internal()',
       'execute'
     ) then
    raise exception 'notification_receipt_linked_dispatch_wakeup_acl_invalid';
  end if;
end
$postcheck$;

comment on function public.notification_receipt_linked_dispatch_wakeup_internal() is
  'Best-effort post-commit pg_net wake-up for pending payment_receipt.linked events. notification_events remains authoritative and the five-minute worker remains the recovery fallback.';

commit;
