begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
declare
  v_missing text[] := array[]::text[];
  v_status_constraint text;
begin
  if to_regclass('public.notification_events') is null then
    v_missing := array_append(v_missing, 'public.notification_events');
  end if;
  if to_regclass('public.notification_delivery_attempts') is null then
    v_missing := array_append(v_missing, 'public.notification_delivery_attempts');
  end if;
  if to_regclass('public.approval_batches') is null then
    v_missing := array_append(v_missing, 'public.approval_batches');
  end if;
  if to_regclass('public.approval_batch_items') is null then
    v_missing := array_append(v_missing, 'public.approval_batch_items');
  end if;
  if to_regclass('public.payment_requests') is null then
    v_missing := array_append(v_missing, 'public.payment_requests');
  end if;
  if to_regclass('public.profiles') is null then
    v_missing := array_append(v_missing, 'public.profiles');
  end if;
  if to_regclass('public.proveedores') is null then
    v_missing := array_append(v_missing, 'public.proveedores');
  end if;
  if to_regclass('public.companies') is null then
    v_missing := array_append(v_missing, 'public.companies');
  end if;
  if to_regclass('public.cost_centers') is null then
    v_missing := array_append(v_missing, 'public.cost_centers');
  end if;
  if to_regclass('public.budget_categories') is null then
    v_missing := array_append(v_missing, 'public.budget_categories');
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    v_missing := array_append(v_missing, 'vault.decrypted_secrets');
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    v_missing := array_append(v_missing, 'net.http_post(text,jsonb,jsonb,jsonb,integer)');
  end if;
  if to_regprocedure('public.mark_notification_processed_for_dispatcher(uuid,text,text,text)') is null then
    v_missing := array_append(v_missing, 'public.mark_notification_processed_for_dispatcher(uuid,text,text,text)');
  end if;
  if to_regprocedure('public.mark_notification_failed_for_dispatcher(uuid,text,text,text)') is null then
    v_missing := array_append(v_missing, 'public.mark_notification_failed_for_dispatcher(uuid,text,text,text)');
  end if;
  if to_regprocedure('public.approval_batch_totals_by_currency(uuid)') is null then
    v_missing := array_append(v_missing, 'public.approval_batch_totals_by_currency(uuid)');
  end if;
  if to_regprocedure('public.enqueue_approval_batch_status_notifications()') is null then
    v_missing := array_append(v_missing, 'public.enqueue_approval_batch_status_notifications()');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'approval_batch_submitted_email_prerequisites_missing:%', array_to_string(v_missing, ',');
  end if;

  if not exists (
    select 1
    from pg_trigger trigger
    where trigger.tgrelid = 'public.approval_batches'::regclass
      and trigger.tgname = 'enqueue_approval_batch_status_notifications'
      and not trigger.tgisinternal
  ) then
    raise exception 'approval_batch_submitted_producer_trigger_missing';
  end if;

  select pg_get_constraintdef(constraint_row.oid, true)
    into v_status_constraint
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.notification_events'::regclass
    and constraint_row.contype = 'c'
    and constraint_row.conname = 'notification_events_status_check';

  if v_status_constraint is null
     or position('cancelled' in lower(v_status_constraint)) = 0 then
    raise exception 'notification_events_cancelled_status_required';
  end if;

  if to_regprocedure(
       'public.claim_approval_batch_submitted_events_for_dispatcher(integer,text,timestamptz)'
     ) is not null
     or to_regprocedure(
       'public.get_approval_batch_submitted_notification_document(uuid,text)'
     ) is not null
     or to_regprocedure(
       'public.cancel_approval_batch_submitted_event_for_dispatcher(uuid,text,text)'
     ) is not null
     or to_regprocedure(
       'public.notification_approval_batch_submitted_dispatch_wakeup_internal()'
     ) is not null
     or exists (
       select 1
       from pg_trigger trigger
       where trigger.tgrelid = 'public.notification_events'::regclass
         and trigger.tgname = 'notification_approval_batch_submitted_dispatch_after_insert'
         and not trigger.tgisinternal
     ) then
    raise exception 'approval_batch_submitted_email_objects_already_exist';
  end if;
end
$precheck$;

create function public.claim_approval_batch_submitted_events_for_dispatcher(
  p_limit integer default 5,
  p_worker_id text default 'edge-approval-batch-submitted-prod',
  p_created_at_after timestamp with time zone default null
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
    coalesce(nullif(btrim(p_worker_id), ''), 'edge-approval-batch-submitted-prod'),
    120
  );
begin
  if p_created_at_after is null then
    raise exception 'approval_batch_submitted_activation_cutoff_required';
  end if;

  return query
  with candidate as (
    select event.id
    from public.notification_events event
    join public.approval_batches batch
      on batch.id = event.source_id
     and event.source_table = 'approval_batches'
    join public.profiles director
      on director.id = batch.director_id
    where event.event_type = 'approval_batch.submitted'
      and event.status in ('pending', 'failed')
      and event.created_at > p_created_at_after
      and coalesce(event.next_attempt_at, now()) <= now()
      and event.attempt_count < event.max_attempts
      and coalesce(event.channel, 'email') = 'email'
      and batch.status = 'submitted'
      and batch.submitted_at is not null
      and event.recipient_profile_id = batch.director_id
      and event.recipient_profile_id = director.id
      and coalesce(director.active, true)
      and nullif(btrim(coalesce(director.email, '')), '') is not null
      and lower(btrim(event.recipient_email)) = lower(btrim(director.email))
      and lower(btrim(coalesce(event.recipient_role, ''))) in ('direccion', 'director')
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

alter function public.claim_approval_batch_submitted_events_for_dispatcher(
  integer,
  text,
  timestamp with time zone
) owner to postgres;

revoke all on function public.claim_approval_batch_submitted_events_for_dispatcher(
  integer,
  text,
  timestamp with time zone
) from public, anon, authenticated;

grant execute on function public.claim_approval_batch_submitted_events_for_dispatcher(
  integer,
  text,
  timestamp with time zone
) to service_role;

create function public.get_approval_batch_submitted_notification_document(
  p_notification_event_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.notification_events%rowtype;
  v_batch public.approval_batches%rowtype;
  v_director public.profiles%rowtype;
  v_company_name text;
  v_item_count integer;
  v_totals jsonb;
  v_items jsonb;
  v_worker_id text := left(
    coalesce(nullif(btrim(p_worker_id), ''), 'edge-approval-batch-submitted-prod'),
    120
  );
begin
  select *
    into v_event
  from public.notification_events event
  where event.id = p_notification_event_id;

  if not found then
    raise exception 'approval_batch_notification_event_not_found';
  end if;
  if v_event.event_type <> 'approval_batch.submitted'
     or v_event.source_table <> 'approval_batches'
     or v_event.source_id is null then
    raise exception 'approval_batch_notification_event_invalid';
  end if;
  if v_event.status <> 'processing'
     or nullif(btrim(coalesce(v_event.locked_by, '')), '') is null
     or v_event.locked_by <> v_worker_id then
    raise exception 'approval_batch_notification_event_not_claimed_by_worker';
  end if;

  select *
    into v_batch
  from public.approval_batches batch
  where batch.id = v_event.source_id;

  if not found or v_batch.status <> 'submitted' or v_batch.submitted_at is null then
    raise exception 'approval_batch_no_longer_submitted';
  end if;

  select *
    into v_director
  from public.profiles profile
  where profile.id = v_batch.director_id
    and coalesce(profile.active, true);

  if not found
     or v_event.recipient_profile_id is distinct from v_director.id
     or nullif(btrim(coalesce(v_director.email, '')), '') is null
     or lower(btrim(v_event.recipient_email)) is distinct from lower(btrim(v_director.email)) then
    raise exception 'approval_batch_notification_recipient_drift';
  end if;

  select coalesce(nullif(btrim(company.legal_name), ''), company.name)
    into v_company_name
  from public.companies company
  where company.id = v_batch.company_id;

  select count(*)::integer
    into v_item_count
  from public.approval_batch_items item
  where item.batch_id = v_batch.id
    and item.removed_at is null;

  if v_item_count < 1 then
    raise exception 'approval_batch_notification_requires_items';
  end if;

  v_totals := public.approval_batch_totals_by_currency(v_batch.id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', item.id,
    'request_number', request.request_number,
    'provider', coalesce(
      nullif(btrim(provider.alias), ''),
      nullif(btrim(provider.nombre_completo), ''),
      'Proveedor sin nombre'
    ),
    'concept', coalesce(
      nullif(btrim(request.payment_concept), ''),
      nullif(btrim(request.concept), ''),
      nullif(btrim(request.description), ''),
      'Sin concepto'
    ),
    'cost_center', case
      when cost_center.id is null then null
      else concat_ws(' - ', nullif(btrim(cost_center.code), ''), nullif(btrim(cost_center.name), ''))
    end,
    'budget_category', case
      when budget_category.id is null then null
      else concat_ws(' - ', nullif(btrim(budget_category.code), ''), nullif(btrim(budget_category.name), ''))
    end,
    'payment_method', coalesce(
      nullif(btrim(request.payment_method), ''),
      nullif(btrim(request.request_type::text), ''),
      'otro'
    ),
    'amount', request.amount_requested,
    'currency', coalesce(nullif(upper(btrim(request.currency)), ''), 'MXN'),
    'scheduled_payment_date', request.scheduled_payment_date,
    'payment_reference', nullif(btrim(request.payment_reference), ''),
    'finance_reviewed_at', item.finance_reviewed_at
  ) order by request.request_number, item.created_at, item.id), '[]'::jsonb)
    into v_items
  from public.approval_batch_items item
  join public.payment_requests request
    on request.id = item.payment_request_id
  left join public.proveedores provider
    on provider.id = request.proveedor_id
  left join public.cost_centers cost_center
    on cost_center.id = request.cost_center_id
  left join public.budget_categories budget_category
    on budget_category.id = request.budget_category_id
  where item.batch_id = v_batch.id
    and item.removed_at is null;

  return jsonb_build_object(
    'event_id', v_event.id,
    'recipient_email', v_director.email,
    'recipient_profile_id', v_director.id,
    'batch', jsonb_build_object(
      'id', v_batch.id,
      'label', v_batch.label,
      'company', v_company_name,
      'period_start', v_batch.period_start,
      'period_end', v_batch.period_end,
      'submitted_at', v_batch.submitted_at,
      'director_name', coalesce(nullif(btrim(v_director.full_name), ''), v_director.email),
      'director_email', v_director.email,
      'item_count', v_item_count,
      'totals_by_currency', coalesce(v_totals, '[]'::jsonb)
    ),
    'items', v_items
  );
end;
$$;

alter function public.get_approval_batch_submitted_notification_document(uuid, text)
  owner to postgres;

revoke all on function public.get_approval_batch_submitted_notification_document(uuid, text)
  from public, anon, authenticated;

grant execute on function public.get_approval_batch_submitted_notification_document(uuid, text)
  to service_role;

create function public.cancel_approval_batch_submitted_event_for_dispatcher(
  p_event_id uuid,
  p_worker_id text,
  p_reason text default 'approval_batch_no_longer_submitted'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.notification_events%rowtype;
  v_worker_id text := left(
    coalesce(nullif(btrim(p_worker_id), ''), 'edge-approval-batch-submitted-prod'),
    120
  );
  v_reason text := left(
    coalesce(nullif(btrim(p_reason), ''), 'approval_batch_no_longer_submitted'),
    300
  );
begin
  select *
    into v_event
  from public.notification_events event
  where event.id = p_event_id
  for update;

  if not found then
    raise exception 'approval_batch_notification_event_not_found';
  end if;
  if v_event.event_type <> 'approval_batch.submitted' then
    raise exception 'approval_batch_notification_event_invalid';
  end if;
  if v_event.status <> 'processing'
     or nullif(btrim(coalesce(v_event.locked_by, '')), '') is null
     or v_event.locked_by <> v_worker_id then
    raise exception 'approval_batch_notification_event_not_claimed_by_worker';
  end if;

  update public.notification_events
     set status = 'cancelled',
         last_error = v_reason,
         next_attempt_at = null,
         locked_at = null,
         locked_by = null,
         updated_at = now()
   where id = p_event_id;

  return jsonb_build_object(
    'event_id', p_event_id,
    'status', 'cancelled',
    'reason', v_reason
  );
end;
$$;

alter function public.cancel_approval_batch_submitted_event_for_dispatcher(uuid, text, text)
  owner to postgres;

revoke all on function public.cancel_approval_batch_submitted_event_for_dispatcher(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.cancel_approval_batch_submitted_event_for_dispatcher(uuid, text, text)
  to service_role;

create function public.notification_approval_batch_submitted_dispatch_wakeup_internal()
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
  v_cutoff_at timestamp with time zone;
  v_enabled text;
  v_request_id bigint;
begin
  if new.event_type <> 'approval_batch.submitted'
     or new.status <> 'pending' then
    return new;
  end if;

  begin
    select
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_approval_batch_submitted_dispatcher_url'
      ),
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_dispatcher_secret'
      ),
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_approval_batch_submitted_cutoff_at'
      ),
      max(secret.decrypted_secret) filter (
        where secret.name = 'notification_approval_batch_submitted_immediate_enabled'
      )
      into v_url, v_secret, v_cutoff, v_enabled
    from vault.decrypted_secrets secret
    where secret.name = any(array[
      'notification_approval_batch_submitted_dispatcher_url',
      'notification_dispatcher_secret',
      'notification_approval_batch_submitted_cutoff_at',
      'notification_approval_batch_submitted_immediate_enabled'
    ]::text[]);

    if lower(coalesce(v_enabled, 'false')) <> 'true' then
      return new;
    end if;

    if nullif(btrim(v_url), '') is null
       or nullif(btrim(v_secret), '') is null
       or nullif(btrim(v_cutoff), '') is null then
      return new;
    end if;

    if v_url !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/approval-batch-submitted-dispatcher$' then
      return new;
    end if;

    v_cutoff_at := v_cutoff::timestamp with time zone;
    if new.created_at <= v_cutoff_at then
      return new;
    end if;

    select net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'created_at_after', v_cutoff,
        'limit', 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-notification-dispatcher-secret', v_secret
      ),
      timeout_milliseconds := 2000
    ) into v_request_id;
  exception when others then
    raise warning 'notification_approval_batch_submitted_dispatch_wakeup_enqueue_failed';
  end;

  return new;
end;
$$;

alter function public.notification_approval_batch_submitted_dispatch_wakeup_internal()
  owner to postgres;

revoke all on function public.notification_approval_batch_submitted_dispatch_wakeup_internal()
  from public, anon, authenticated, service_role;

create trigger notification_approval_batch_submitted_dispatch_after_insert
  after insert on public.notification_events
  for each row
  when (
    new.event_type = 'approval_batch.submitted'
    and new.status = 'pending'
  )
  execute function public.notification_approval_batch_submitted_dispatch_wakeup_internal();

comment on function public.claim_approval_batch_submitted_events_for_dispatcher(integer, text, timestamp with time zone)
  is 'Claims only new approval_batch.submitted events after an exclusive activation cutoff and only while the selected Director still has a submitted batch to decide.';
comment on function public.get_approval_batch_submitted_notification_document(uuid, text)
  is 'Returns the Director-scoped current submitted batch snapshot used to render the Flux email and attached PDF.';
comment on function public.cancel_approval_batch_submitted_event_for_dispatcher(uuid, text, text)
  is 'Cancels a claimed submitted-batch notification when the batch or selected Director no longer matches the claim.';
comment on function public.notification_approval_batch_submitted_dispatch_wakeup_internal()
  is 'Best-effort post-COMMIT wake-up for new approval_batch.submitted events only; recovery remains independent.';

commit;
