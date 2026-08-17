begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

lock table public.notification_events in share row exclusive mode;
lock table public.notification_delivery_attempts in share mode;

create temporary table payment_request_approver_email_prod_baseline
on commit drop
as
select
  count(*) filter (
    where event.event_type = 'payment_request.created'
  )::integer as created_total,
  count(*) filter (
    where event.event_type = 'payment_request.created'
      and event.status = 'pending'
  )::integer as created_pending,
  count(*) filter (
    where event.event_type = 'payment_request.created'
      and event.status <> 'pending'
  )::integer as created_non_pending,
  md5(coalesce(string_agg(
    concat_ws(
      '|',
      event.id::text,
      event.status,
      coalesce(event.recipient_profile_id::text, ''),
      coalesce(event.recipient_email, ''),
      event.attempt_count::text,
      event.created_at::text,
      event.updated_at::text
    ),
    '|' order by event.id
  ) filter (where event.event_type = 'payment_request.created'), '')) as created_hash,
  count(*) filter (
    where event.event_type = 'payment_receipt.linked'
  )::integer as receipt_total,
  md5(coalesce(string_agg(
    concat_ws(
      '|',
      event.id::text,
      event.status,
      event.attempt_count::text,
      coalesce(event.processed_at::text, ''),
      event.updated_at::text
    ),
    '|' order by event.id
  ) filter (where event.event_type = 'payment_receipt.linked'), '')) as receipt_hash
from public.notification_events event;

do $precheck$
declare
  v_status_constraint text;
  v_created_attempts integer;
  v_created_objects integer;
  v_created_vault_names integer;
begin
  if to_regclass('public.notification_events') is null
     or to_regclass('public.notification_delivery_attempts') is null
     or to_regclass('public.payment_requests') is null
     or to_regclass('public.profiles') is null
     or to_regprocedure('public.enqueue_payment_request_created_notification()') is null
     or to_regprocedure(
          'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)'
        ) is null
     or to_regprocedure(
          'public.notification_receipt_linked_dispatch_wakeup_internal()'
        ) is null
     or to_regprocedure(
          'public.get_payment_receipt_notification_attachment(uuid)'
        ) is null then
    raise exception 'payment_request_approver_email_prod_prerequisites_missing';
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'payment_request_approver_email_prod_vault_missing';
  end if;

  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'payment_request_approver_email_prod_pg_net_missing';
  end if;

  if md5(pg_get_functiondef(
       'public.enqueue_payment_request_created_notification()'::regprocedure
     )) <> '754b799e51721ea9b6f54872d50810ac' then
    raise exception 'payment_request_approver_email_prod_producer_drift';
  end if;

  if md5(pg_get_functiondef(
       'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)'::regprocedure
     )) <> '694e143204841f79e0724ad234ac79d5' then
    raise exception 'payment_request_approver_email_prod_receipt_claim_drift';
  end if;

  if md5(pg_get_functiondef(
       'public.notification_receipt_linked_dispatch_wakeup_internal()'::regprocedure
     )) <> 'dda802d2b5d6a204fd5010c7a5fb8b0a' then
    raise exception 'payment_request_approver_email_prod_receipt_wakeup_drift';
  end if;

  if md5(pg_get_functiondef(
       'public.get_payment_receipt_notification_attachment(uuid)'::regprocedure
     )) <> 'bc3f61e08c8087588b4f3acccb2f0341' then
    raise exception 'payment_request_approver_email_prod_receipt_resolver_drift';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger
    where trigger.tgrelid = 'public.payment_requests'::regclass
      and trigger.tgname = 'payment_request_created_notification_event'
      and not trigger.tgisinternal
      and md5(pg_get_triggerdef(trigger.oid, true))
        = 'bf1aaa79abf7e9be0a7bfe5ada6a7e15'
  ) then
    raise exception 'payment_request_approver_email_prod_producer_trigger_drift';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger
    where trigger.tgrelid = 'public.notification_events'::regclass
      and trigger.tgname = 'notification_receipt_linked_immediate_dispatch_after_insert'
      and not trigger.tgisinternal
      and md5(pg_get_triggerdef(trigger.oid, true))
        = '05e5649de2b2e44120f938e1999d89d6'
  ) then
    raise exception 'payment_request_approver_email_prod_receipt_trigger_drift';
  end if;

  select pg_get_constraintdef(constraint_row.oid, true)
    into v_status_constraint
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.notification_events'::regclass
    and constraint_row.contype = 'c'
    and constraint_row.conname = 'notification_events_status_check';

  if v_status_constraint is distinct from
     'CHECK (status = ANY (ARRAY[''pending''::text, ''processing''::text, ''sent''::text, ''failed''::text, ''dead_letter''::text, ''cancelled''::text]))' then
    raise exception 'payment_request_approver_email_prod_status_constraint_drift';
  end if;

  select count(*)::integer
    into v_created_objects
  from (
    select to_regprocedure(
      'public.claim_payment_request_created_events_for_dispatcher(integer,text,timestamptz)'
    ) as object_id
    union all
    select to_regprocedure(
      'public.notification_payment_request_created_dispatch_wakeup_internal()'
    )
  ) objects
  where objects.object_id is not null;

  if v_created_objects <> 0
     or exists (
       select 1
       from pg_trigger trigger
       where trigger.tgrelid = 'public.notification_events'::regclass
         and trigger.tgname =
           'notification_payment_request_created_immediate_dispatch_after_insert'
         and not trigger.tgisinternal
     ) then
    raise exception 'payment_request_approver_email_prod_target_objects_already_exist';
  end if;

  select count(*)::integer
    into v_created_vault_names
  from vault.decrypted_secrets secret
  where secret.name = any(array[
    'notification_payment_request_created_dispatcher_url',
    'notification_payment_request_created_cutoff_at',
    'notification_payment_request_created_immediate_enabled'
  ]::text[]);

  if v_created_vault_names <> 0 then
    raise exception 'payment_request_approver_email_prod_runtime_already_configured';
  end if;

  select count(*)::integer
    into v_created_attempts
  from public.notification_delivery_attempts attempt
  join public.notification_events event
    on event.id = attempt.notification_event_id
  where event.event_type = 'payment_request.created';

  if v_created_attempts <> 0
     or exists (
       select 1
       from payment_request_approver_email_prod_baseline baseline
       where baseline.created_non_pending <> 0
          or baseline.created_total <> baseline.created_pending
     ) then
    raise exception 'payment_request_approver_email_prod_historical_state_not_pristine';
  end if;
end
$precheck$;

alter table public.notification_events
  drop constraint notification_events_status_check;

alter table public.notification_events
  add constraint notification_events_status_check
  check (
    status = any(array[
      'pending'::text,
      'processing'::text,
      'sent'::text,
      'failed'::text,
      'dead_letter'::text,
      'cancelled'::text,
      'no_recipient'::text
    ])
  );

create or replace function public.enqueue_payment_request_created_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_role_name text;
  v_status text := 'pending';
  v_last_error text;
  v_payload jsonb;
begin
  if new.approver_id is null then
    v_status := 'dead_letter';
    v_last_error := 'missing_approver_profile_id';
  else
    select * into v_profile
    from public.profiles
    where id = new.approver_id and coalesce(active, true);

    if not found then
      v_status := 'dead_letter';
      v_last_error := 'approver_profile_not_found';
    elsif not public.is_payment_request_approver_for_company(new.approver_id, new.company_id) then
      v_status := 'dead_letter';
      v_last_error := 'approver_not_eligible_for_company';
    elsif nullif(btrim(coalesce(v_profile.email, '')), '') is null then
      v_status := 'no_recipient';
      v_last_error := 'recipient_email_missing';
    end if;
  end if;

  select lower(trim(r.name)) into v_role_name
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.profile_id = new.approver_id
    and lower(trim(r.name)) = any (public.payment_request_approver_role_names())
  order by lower(trim(r.name))
  limit 1;

  v_payload := public.notification_payment_request_payload_with_extra(
    new.id,
    jsonb_build_object(
      'approver', coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email),
      'approver_profile_id', new.approver_id
    )
  );

  insert into public.notification_events (
    event_type, source_table, source_id, source_folio, recipient_type,
    recipient_profile_id, recipient_email, recipient_role, channel, priority,
    subject, payload, idempotency_key, status, last_error, next_attempt_at
  ) values (
    'payment_request.created', 'payment_requests', new.id, new.request_number,
    'administrador_sistema',
    case when v_profile.id is not null then v_profile.id else null end,
    case when v_status = 'pending' then nullif(btrim(v_profile.email), '') else null end,
    v_role_name, 'email', 'normal',
    'Nueva solicitud de pago: ' || coalesce(new.request_number, new.id::text),
    v_payload,
    'payment_request.created:' || new.id::text || ':approver',
    v_status, v_last_error,
    case when v_status = 'pending' then now() else null end
  )
  on conflict (idempotency_key) do nothing;

  return new;
exception
  when others then
    insert into public.notification_events (
      event_type, source_table, source_id, source_folio, recipient_type,
      channel, priority, subject, payload, idempotency_key, status, last_error
    ) values (
      'payment_request.created', 'payment_requests', new.id, new.request_number,
      'administrador_sistema', 'email', 'normal',
      'Nueva solicitud de pago: ' || coalesce(new.request_number, new.id::text),
      jsonb_build_object('folio', new.request_number, 'path', '/solicitudes.html'),
      'payment_request.created:' || new.id::text || ':enqueue-error',
      'dead_letter', 'created_notification_enqueue_failed'
    )
    on conflict (idempotency_key) do nothing;
    return new;
end;
$$;

alter function public.enqueue_payment_request_created_notification()
  owner to postgres;

revoke all on function public.enqueue_payment_request_created_notification()
  from public, anon, authenticated;

grant execute on function public.enqueue_payment_request_created_notification()
  to service_role, postgres;

create function public.claim_payment_request_created_events_for_dispatcher(
  p_limit integer default 5,
  p_worker_id text default 'edge-notification-dispatcher-payment-request-created',
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

alter function public.claim_payment_request_created_events_for_dispatcher(
  integer,
  text,
  timestamp with time zone
) owner to postgres;

revoke all on function public.claim_payment_request_created_events_for_dispatcher(
  integer,
  text,
  timestamp with time zone
) from public, anon, authenticated;

grant execute on function public.claim_payment_request_created_events_for_dispatcher(
  integer,
  text,
  timestamp with time zone
) to service_role;

create function public.notification_payment_request_created_dispatch_wakeup_internal()
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

    v_cutoff_at := v_cutoff::timestamp with time zone;

    if new.created_at <= v_cutoff_at then
      return new;
    end if;

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

alter function public.notification_payment_request_created_dispatch_wakeup_internal()
  owner to postgres;

revoke all on function public.notification_payment_request_created_dispatch_wakeup_internal()
  from public, anon, authenticated, service_role;

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
  v_producer_definition text;
  v_created_trigger_definition text;
  v_status_constraint text;
  v_created_attempts integer;
  v_created_vault_names integer;
begin
  select pg_get_functiondef(
           'public.claim_payment_request_created_events_for_dispatcher(integer,text,timestamptz)'::regprocedure
         )
    into v_claim_definition;

  select pg_get_functiondef(
           'public.notification_payment_request_created_dispatch_wakeup_internal()'::regprocedure
         )
    into v_wakeup_definition;

  select pg_get_functiondef(
           'public.enqueue_payment_request_created_notification()'::regprocedure
         )
    into v_producer_definition;

  select pg_get_triggerdef(trigger.oid, true)
    into v_created_trigger_definition
  from pg_trigger trigger
  where trigger.tgrelid = 'public.notification_events'::regclass
    and trigger.tgname =
      'notification_payment_request_created_immediate_dispatch_after_insert'
    and not trigger.tgisinternal;

  select pg_get_constraintdef(constraint_row.oid, true)
    into v_status_constraint
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.notification_events'::regclass
    and constraint_row.contype = 'c'
    and constraint_row.conname = 'notification_events_status_check';

  if v_status_constraint not like '%''no_recipient''::text%' then
    raise exception 'payment_request_approver_email_prod_no_recipient_constraint_missing';
  end if;

  if v_producer_definition not like
       '%v_status := ''no_recipient'';%v_last_error := ''recipient_email_missing'';%'
     or v_producer_definition not like
       '%''payment_request.created:'' || new.id::text || '':approver''%'
     or v_producer_definition not like '%on conflict (idempotency_key) do nothing%'
     or v_producer_definition not like
       '%v_last_error := ''missing_approver_profile_id'';%'
     or v_producer_definition not like
       '%v_last_error := ''approver_profile_not_found'';%'
     or v_producer_definition not like
       '%v_last_error := ''approver_not_eligible_for_company'';%'
     or (
       length(v_producer_definition)
       - length(replace(v_producer_definition, '''no_recipient''', ''))
     ) / length('''no_recipient''') <> 1 then
    raise exception 'payment_request_approver_email_prod_producer_contract_invalid';
  end if;

  if v_claim_definition not like '%event.event_type = ''payment_request.created''%'
     or v_claim_definition not like '%event.created_at > p_created_at_after%'
     or v_claim_definition like '%event.created_at >= p_created_at_after%'
     or v_claim_definition like '%payment_receipt.linked%'
     or v_claim_definition like '%p_event_types%'
     or v_claim_definition not like '%for update skip locked%' then
    raise exception 'payment_request_approver_email_prod_exclusive_claim_invalid';
  end if;

  if v_wakeup_definition not like
       '%notification_payment_request_created_cutoff_at%'
     or v_wakeup_definition not like
       '%notification_payment_request_created_immediate_enabled%'
     or v_wakeup_definition not like '%new.created_at <= v_cutoff_at%'
     or v_wakeup_definition not like
       '%jsonb_build_array(''payment_request.created'')%'
     or v_wakeup_definition like '%payment_receipt.linked%'
     or v_wakeup_definition like '%api.resend.com%' then
    raise exception 'payment_request_approver_email_prod_wakeup_contract_invalid';
  end if;

  if v_created_trigger_definition is null
     or v_created_trigger_definition not like '%AFTER INSERT%'
     or v_created_trigger_definition not like '%payment_request.created%'
     or v_created_trigger_definition not like '%status = ''pending''%'
     or v_created_trigger_definition like '%UPDATE OF%'
     or v_created_trigger_definition like '%BEFORE INSERT%' then
    raise exception 'payment_request_approver_email_prod_trigger_contract_invalid';
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
    raise exception 'payment_request_approver_email_prod_claim_acl_invalid';
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
    raise exception 'payment_request_approver_email_prod_wakeup_acl_invalid';
  end if;

  if md5(pg_get_functiondef(
       'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)'::regprocedure
     )) <> '694e143204841f79e0724ad234ac79d5'
     or md5(pg_get_functiondef(
       'public.notification_receipt_linked_dispatch_wakeup_internal()'::regprocedure
     )) <> 'dda802d2b5d6a204fd5010c7a5fb8b0a'
     or md5(pg_get_functiondef(
       'public.get_payment_receipt_notification_attachment(uuid)'::regprocedure
     )) <> 'bc3f61e08c8087588b4f3acccb2f0341'
     or not exists (
       select 1
       from pg_trigger trigger
       where trigger.tgrelid = 'public.notification_events'::regclass
         and trigger.tgname =
           'notification_receipt_linked_immediate_dispatch_after_insert'
         and not trigger.tgisinternal
         and md5(pg_get_triggerdef(trigger.oid, true))
           = '05e5649de2b2e44120f938e1999d89d6'
     ) then
    raise exception 'payment_receipt_linked_regression_detected';
  end if;

  select count(*)::integer
    into v_created_vault_names
  from vault.decrypted_secrets secret
  where secret.name = any(array[
    'notification_payment_request_created_dispatcher_url',
    'notification_payment_request_created_cutoff_at',
    'notification_payment_request_created_immediate_enabled'
  ]::text[]);

  if v_created_vault_names <> 0 then
    raise exception 'payment_request_approver_email_prod_cutoff_or_activation_created';
  end if;

  select count(*)::integer
    into v_created_attempts
  from public.notification_delivery_attempts attempt
  join public.notification_events event
    on event.id = attempt.notification_event_id
  where event.event_type = 'payment_request.created';

  if v_created_attempts <> 0
     or exists (
       select 1
       from payment_request_approver_email_prod_baseline baseline
       cross join lateral (
         select
           count(*) filter (
             where event.event_type = 'payment_request.created'
           )::integer as created_total,
           md5(coalesce(string_agg(
             concat_ws(
               '|',
               event.id::text,
               event.status,
               coalesce(event.recipient_profile_id::text, ''),
               coalesce(event.recipient_email, ''),
               event.attempt_count::text,
               event.created_at::text,
               event.updated_at::text
             ),
             '|' order by event.id
           ) filter (where event.event_type = 'payment_request.created'), '')) as created_hash,
           count(*) filter (
             where event.event_type = 'payment_receipt.linked'
           )::integer as receipt_total,
           md5(coalesce(string_agg(
             concat_ws(
               '|',
               event.id::text,
               event.status,
               event.attempt_count::text,
               coalesce(event.processed_at::text, ''),
               event.updated_at::text
             ),
             '|' order by event.id
           ) filter (where event.event_type = 'payment_receipt.linked'), '')) as receipt_hash
         from public.notification_events event
       ) current_state
       where baseline.created_total is distinct from current_state.created_total
          or baseline.created_hash is distinct from current_state.created_hash
          or baseline.receipt_total is distinct from current_state.receipt_total
          or baseline.receipt_hash is distinct from current_state.receipt_hash
     ) then
    raise exception 'payment_request_approver_email_prod_business_rows_changed';
  end if;
end
$postcheck$;

comment on function public.claim_payment_request_created_events_for_dispatcher(
  integer,
  text,
  timestamp with time zone
) is
  'Claims only payment_request.created events strictly newer than the immutable activation cutoff. Boundary and historical events remain permanently ineligible.';

comment on function public.notification_payment_request_created_dispatch_wakeup_internal() is
  'Best-effort post-commit pg_net wake-up for new payment_request.created events strictly after the authoritative cutoff. Runtime remains inert until C4 configuration.';

commit;
