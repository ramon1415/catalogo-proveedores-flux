-- REVIEW ARTIFACT ONLY. Do not apply without Ramon GO for Supabase PROD.
-- Adds the missing payment_request.approved wake-up and a fail-closed recovery
-- loop. Every cutoff must be reset to the production cutover instant so old
-- pending events are never replayed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
begin
  if to_regclass('public.notification_events') is null
     or to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regprocedure(
          'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)'
        ) is null
     or to_regprocedure(
          'public.claim_payment_request_created_events_for_dispatcher(integer,text,timestamptz)'
        ) is null
     or to_regprocedure(
          'public.claim_approval_batch_decision_events_for_dispatcher(integer,text,timestamptz)'
        ) is null
     or to_regprocedure(
          'public.claim_approval_batch_submitted_events_for_dispatcher(integer,text,timestamptz)'
        ) is null then
    raise exception 'notification_prod_recovery_prerequisites_missing';
  end if;
end
$precheck$;

do $extension$
begin
  if not exists (
    select 1 from pg_extension where extname = 'pg_cron'
  ) then
    execute 'create extension pg_cron with schema pg_catalog';
  end if;
end
$extension$;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create or replace function public.notification_payment_request_approved_wakeup_internal()
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
  if new.event_type <> 'payment_request.approved' or new.status <> 'pending' then
    return new;
  end if;

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

  if lower(coalesce(v_enabled, 'false')) <> 'true'
     or nullif(btrim(v_url), '') is null
     or nullif(btrim(v_secret), '') is null
     or nullif(btrim(v_cutoff), '') is null
     or v_url <> 'https://ucantptjhwttexzmslvm.supabase.co/functions/v1/notification-dispatcher'
     or new.created_at <= v_cutoff::timestamptz then
    return new;
  end if;

  select net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'event_types', jsonb_build_array('payment_request.approved'),
      'created_at_from', v_cutoff,
      'limit', 5
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notification-dispatcher-secret', v_secret
    ),
    timeout_milliseconds := 2000
  ) into v_request_id;

  return new;
exception when others then
  raise warning 'notification_payment_request_approved_wakeup_enqueue_failed';
  return new;
end;
$$;

revoke all on function public.notification_payment_request_approved_wakeup_internal()
from public, anon, authenticated, service_role;

drop trigger if exists notification_payment_request_approved_dispatch_after_insert
on public.notification_events;

create trigger notification_payment_request_approved_dispatch_after_insert
after insert on public.notification_events
for each row
when (
  new.event_type = 'payment_request.approved'
  and new.status = 'pending'
)
execute function public.notification_payment_request_approved_wakeup_internal();

create or replace function public.notification_prod_recovery_post_internal(
  p_url_secret_name text,
  p_cutoff_secret_name text,
  p_enabled_secret_name text,
  p_function_slug text,
  p_event_types text[],
  p_created_at_key text
)
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
  v_expected_url text;
  v_request_id bigint;
begin
  if p_function_slug not in (
       'notification-dispatcher',
       'approval-batch-submitted-dispatcher'
     )
     or p_created_at_key not in ('created_at_from', 'created_at_after')
     or coalesce(cardinality(p_event_types), 0) = 0 then
    raise exception 'notification_prod_recovery_lane_invalid';
  end if;

  v_expected_url :=
    'https://ucantptjhwttexzmslvm.supabase.co/functions/v1/' || p_function_slug;

  select
    max(secret.decrypted_secret) filter (where secret.name = p_url_secret_name),
    max(secret.decrypted_secret) filter (where secret.name = 'notification_dispatcher_secret'),
    max(secret.decrypted_secret) filter (where secret.name = p_cutoff_secret_name),
    max(secret.decrypted_secret) filter (where secret.name = p_enabled_secret_name)
    into v_url, v_secret, v_cutoff, v_enabled
  from vault.decrypted_secrets secret
  where secret.name = any(array[
    p_url_secret_name,
    'notification_dispatcher_secret',
    p_cutoff_secret_name,
    p_enabled_secret_name
  ]::text[]);

  if lower(coalesce(v_enabled, 'false')) <> 'true'
     or nullif(btrim(v_url), '') is null
     or nullif(btrim(v_secret), '') is null
     or nullif(btrim(v_cutoff), '') is null
     or v_url <> v_expected_url then
    return null;
  end if;

  perform v_cutoff::timestamptz;

  select net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'event_types', to_jsonb(p_event_types),
      p_created_at_key, v_cutoff,
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
  raise warning 'notification_prod_recovery_lane_enqueue_failed';
  return null;
end;
$$;

create or replace function public.notification_prod_recovery_wakeup_internal()
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform public.notification_prod_recovery_post_internal(
    'notification_payment_request_created_dispatcher_url',
    'notification_payment_request_created_cutoff_at',
    'notification_payment_request_created_recovery_enabled',
    'notification-dispatcher',
    array['payment_request.created']::text[],
    'created_at_from'
  );

  perform public.notification_prod_recovery_post_internal(
    'notification_approval_batch_submitted_dispatcher_url',
    'notification_approval_batch_submitted_cutoff_at',
    'notification_approval_batch_submitted_recovery_enabled',
    'approval-batch-submitted-dispatcher',
    array['approval_batch.submitted']::text[],
    'created_at_after'
  );

  perform public.notification_prod_recovery_post_internal(
    'notification_approval_batch_decision_dispatcher_url',
    'notification_approval_batch_decision_cutoff_at',
    'notification_approval_batch_decision_recovery_enabled',
    'notification-dispatcher',
    array['approval_batch.approved', 'approval_batch.partially_approved']::text[],
    'created_at_from'
  );

  perform public.notification_prod_recovery_post_internal(
    'notification_payment_outcome_dispatcher_url',
    'notification_payment_outcome_cutoff_at',
    'notification_payment_outcome_recovery_enabled',
    'notification-dispatcher',
    array['payment_request.approved', 'payment_receipt.linked']::text[],
    'created_at_from'
  );
end;
$$;

revoke all on function public.notification_prod_recovery_post_internal(
  text, text, text, text, text[], text
) from public, anon, authenticated, service_role;

revoke all on function public.notification_prod_recovery_wakeup_internal()
from public, anon, authenticated, service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'notification-prod-recovery';

select cron.schedule(
  'notification-prod-recovery',
  '*/5 * * * *',
  $cron$select public.notification_prod_recovery_wakeup_internal();$cron$
);

do $postcheck$
declare
  v_job record;
  v_trigger_definition text;
begin
  select jobid, schedule, command, active
    into v_job
  from cron.job
  where jobname = 'notification-prod-recovery';

  select pg_get_triggerdef(trigger.oid, true)
    into v_trigger_definition
  from pg_trigger trigger
  where trigger.tgrelid = 'public.notification_events'::regclass
    and trigger.tgname = 'notification_payment_request_approved_dispatch_after_insert'
    and not trigger.tgisinternal;

  if v_job.jobid is null
     or v_job.schedule <> '*/5 * * * *'
     or v_job.command <> 'select public.notification_prod_recovery_wakeup_internal();'
     or not v_job.active then
    raise exception 'notification_prod_recovery_cron_contract_invalid';
  end if;

  if v_trigger_definition is null
     or v_trigger_definition not like '%payment_request.approved%'
     or v_trigger_definition not like '%status = ''pending''%' then
    raise exception 'notification_payment_request_approved_trigger_contract_invalid';
  end if;

  if has_function_privilege(
       'service_role',
       'public.notification_prod_recovery_wakeup_internal()',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.notification_prod_recovery_wakeup_internal()',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.notification_prod_recovery_wakeup_internal()',
       'execute'
     ) then
    raise exception 'notification_prod_recovery_acl_invalid';
  end if;
end
$postcheck$;

comment on function public.notification_payment_request_approved_wakeup_internal() is
  'Fail-closed PROD wake-up for payment_request.approved after the immutable cutover cutoff.';

comment on function public.notification_prod_recovery_wakeup_internal() is
  'Five-minute PROD recovery for the four business email lanes; each lane is independently cutoff-bound and disabled by default.';

commit;
