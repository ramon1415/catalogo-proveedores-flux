begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
begin
  if to_regclass('public.notification_events') is null
     or to_regclass('public.notification_delivery_attempts') is null
     or to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure(
          'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)'
        ) is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'notification_payment_outcome_dispatch_prerequisites_missing';
  end if;
end
$precheck$;

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create or replace function public.notification_payment_outcome_dispatch_wakeup_internal()
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
       'payment_request.approved',
       'payment_receipt.linked'
     )
     or new.status <> 'pending' then
    return new;
  end if;

  begin
    select
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_payment_outcome_dispatcher_url'
      ),
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_dispatcher_secret'
      ),
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_payment_outcome_cutoff_at'
      ),
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_payment_outcome_immediate_enabled'
      )
      into v_url, v_secret, v_cutoff, v_enabled
    from vault.decrypted_secrets secret
    where secret.name = any(array[
      'notification_payment_outcome_dispatcher_url',
      'notification_dispatcher_secret',
      'notification_payment_outcome_cutoff_at',
      'notification_payment_outcome_immediate_enabled'
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
          'payment_request.approved',
          'payment_receipt.linked'
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
    raise warning 'notification_payment_outcome_wakeup_enqueue_failed';
  end;

  return new;
end;
$$;

create or replace function public.notification_payment_outcome_recovery_wakeup_internal()
returns bigint
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
  select
    max(secret.decrypted_secret) filter (
      where secret.name = 'notification_payment_outcome_dispatcher_url'
    ),
    max(secret.decrypted_secret) filter (
      where secret.name = 'notification_dispatcher_secret'
    ),
    max(secret.decrypted_secret) filter (
      where secret.name = 'notification_payment_outcome_cutoff_at'
    ),
    max(secret.decrypted_secret) filter (
      where secret.name = 'notification_payment_outcome_recovery_enabled'
    )
    into v_url, v_secret, v_cutoff, v_enabled
  from vault.decrypted_secrets secret
  where secret.name = any(array[
    'notification_payment_outcome_dispatcher_url',
    'notification_dispatcher_secret',
    'notification_payment_outcome_cutoff_at',
    'notification_payment_outcome_recovery_enabled'
  ]::text[]);

  if lower(coalesce(v_enabled, 'false')) <> 'true' then
    return null;
  end if;

  if nullif(btrim(v_url), '') is null
     or nullif(btrim(v_secret), '') is null
     or nullif(btrim(v_cutoff), '') is null then
    return null;
  end if;

  if v_url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/notification-dispatcher$' then
    return null;
  end if;

  perform v_cutoff::timestamptz;

  select net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'event_types', jsonb_build_array(
        'payment_request.approved',
        'payment_receipt.linked'
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

  return v_request_id;
exception when others then
  raise warning 'notification_payment_outcome_recovery_enqueue_failed';
  return null;
end;
$$;

revoke all on function public.notification_payment_outcome_dispatch_wakeup_internal()
from public, anon, authenticated, service_role;

revoke all on function public.notification_payment_outcome_recovery_wakeup_internal()
from public, anon, authenticated, service_role;

drop trigger if exists notification_receipt_linked_immediate_dispatch_after_insert
on public.notification_events;

drop trigger if exists notification_payment_outcome_dispatch_after_insert
on public.notification_events;

create trigger notification_payment_outcome_dispatch_after_insert
after insert on public.notification_events
for each row
when (
  new.event_type in (
    'payment_request.approved',
    'payment_receipt.linked'
  )
  and new.status = 'pending'
)
execute function public.notification_payment_outcome_dispatch_wakeup_internal();

select cron.schedule(
  'notification-payment-outcome-recovery-dev',
  '*/5 * * * *',
  $cron$select public.notification_payment_outcome_recovery_wakeup_internal();$cron$
);

do $postcheck$
declare
  v_trigger_definition text;
  v_wakeup_definition text;
  v_recovery_definition text;
  v_job record;
begin
  select pg_get_triggerdef(trigger.oid, true)
    into v_trigger_definition
  from pg_trigger trigger
  where trigger.tgrelid = 'public.notification_events'::regclass
    and trigger.tgname = 'notification_payment_outcome_dispatch_after_insert'
    and not trigger.tgisinternal;

  select pg_get_functiondef(
           'public.notification_payment_outcome_dispatch_wakeup_internal()'::regprocedure
         )
    into v_wakeup_definition;

  select pg_get_functiondef(
           'public.notification_payment_outcome_recovery_wakeup_internal()'::regprocedure
         )
    into v_recovery_definition;

  select jobid, schedule, command, active
    into v_job
  from cron.job
  where jobname = 'notification-payment-outcome-recovery-dev';

  if v_trigger_definition is null
     or v_trigger_definition not like '%AFTER INSERT%'
     or v_trigger_definition not like '%payment_request.approved%'
     or v_trigger_definition not like '%payment_receipt.linked%'
     or v_trigger_definition not like '%status = ''pending''%' then
    raise exception 'notification_payment_outcome_trigger_contract_invalid';
  end if;

  if v_wakeup_definition not like '%notification_payment_outcome_immediate_enabled%'
     or v_wakeup_definition not like '%notification_payment_outcome_cutoff_at%'
     or v_wakeup_definition not like '%payment_request.approved%'
     or v_wakeup_definition not like '%payment_receipt.linked%'
     or v_wakeup_definition like '%api.resend.com%' then
    raise exception 'notification_payment_outcome_wakeup_contract_invalid';
  end if;

  if v_recovery_definition not like '%notification_payment_outcome_recovery_enabled%'
     or v_recovery_definition not like '%payment_request.approved%'
     or v_recovery_definition not like '%payment_receipt.linked%'
     or v_recovery_definition like '%api.resend.com%' then
    raise exception 'notification_payment_outcome_recovery_contract_invalid';
  end if;

  if v_job.jobid is null
     or v_job.schedule <> '*/5 * * * *'
     or v_job.command <> 'select public.notification_payment_outcome_recovery_wakeup_internal();'
     or not v_job.active then
    raise exception 'notification_payment_outcome_cron_contract_invalid';
  end if;

  if has_function_privilege(
       'service_role',
       'public.notification_payment_outcome_dispatch_wakeup_internal()',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.notification_payment_outcome_dispatch_wakeup_internal()',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.notification_payment_outcome_dispatch_wakeup_internal()',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'public.notification_payment_outcome_recovery_wakeup_internal()',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.notification_payment_outcome_recovery_wakeup_internal()',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.notification_payment_outcome_recovery_wakeup_internal()',
       'execute'
     ) then
    raise exception 'notification_payment_outcome_acl_invalid';
  end if;
end
$postcheck$;

comment on function public.notification_payment_outcome_dispatch_wakeup_internal() is
  'Best-effort post-commit DEV wake-up for payment_request.approved and payment_receipt.linked using an immutable activation cutoff.';

comment on function public.notification_payment_outcome_recovery_wakeup_internal() is
  'Fail-closed five-minute DEV recovery wake-up for pending payment outcome notifications. Claim locking and Resend idempotency prevent duplicate delivery.';

commit;
