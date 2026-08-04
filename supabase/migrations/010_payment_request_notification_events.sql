-- Flux Operadora - Notification events for payment request lifecycle
-- Creates backend-generated notification events for the DEV notification MVP.

create or replace function public.notification_payment_request_payload(p_payment_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  select jsonb_strip_nulls(jsonb_build_object(
    'folio', pr.request_number,
    'provider', coalesce(p.alias, p.nombre_completo),
    'amount', pr.amount_requested,
    'currency', pr.currency,
    'company', c.name,
    'cost_center', cc.name,
    'budget_category', bc.name,
    'requester', rp.full_name,
    'status', pr.status::text,
    'budget_decision', pr.budget_decision,
    'is_extraordinary_adjustment', pr.is_extraordinary_adjustment,
    'path', '/solicitudes.html'
  ))
    into v_payload
  from public.payment_requests pr
  left join public.proveedores p on p.id = pr.proveedor_id
  left join public.companies c on c.id = pr.company_id
  left join public.cost_centers cc on cc.id = pr.cost_center_id
  left join public.budget_categories bc on bc.id = pr.budget_category_id
  left join public.profiles rp on rp.id = pr.requested_by
  where pr.id = p_payment_request_id;

  return coalesce(v_payload, '{}'::jsonb);
end;
$$;

create or replace function public.enqueue_payment_request_notification_for_profile(
  p_payment_request_id uuid,
  p_event_type text,
  p_recipient_profile_id uuid,
  p_subject text,
  p_idempotency_key text,
  p_priority text default 'normal'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.payment_requests%rowtype;
  v_profile public.profiles%rowtype;
  v_status text := 'pending';
  v_last_error text;
  v_priority text;
begin
  select *
    into v_request
  from public.payment_requests
  where id = p_payment_request_id;

  if not found then
    return;
  end if;

  v_priority := case lower(trim(coalesce(p_priority, 'normal')))
    when 'low' then 'low'
    when 'normal' then 'normal'
    when 'high' then 'high'
    when 'critical' then 'critical'
    else 'normal'
  end;

  if p_recipient_profile_id is null then
    v_status := 'dead_letter';
    v_last_error := 'missing_recipient_profile_id';
  else
    select *
      into v_profile
    from public.profiles
    where id = p_recipient_profile_id
      and coalesce(active, true);

    if not found then
      v_status := 'dead_letter';
      v_last_error := 'recipient_profile_not_found';
    elsif nullif(trim(coalesce(v_profile.email, '')), '') is null then
      v_status := 'dead_letter';
      v_last_error := 'recipient_email_missing';
    end if;
  end if;

  insert into public.notification_events (
    event_type,
    source_table,
    source_id,
    source_folio,
    recipient_type,
    recipient_profile_id,
    recipient_email,
    channel,
    priority,
    subject,
    payload,
    idempotency_key,
    status,
    last_error,
    next_attempt_at
  )
  values (
    p_event_type,
    'payment_requests',
    v_request.id,
    v_request.request_number,
    'usuario_solicitante',
    case when v_status = 'pending' then v_profile.id else null end,
    case when v_status = 'pending' then nullif(trim(coalesce(v_profile.email, '')), '') else null end,
    'email',
    v_priority,
    p_subject,
    public.notification_payment_request_payload(v_request.id),
    p_idempotency_key,
    v_status,
    v_last_error,
    case when v_status = 'pending' then now() else null end
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

create or replace function public.enqueue_payment_request_notification_for_roles(
  p_payment_request_id uuid,
  p_event_type text,
  p_role_names text[],
  p_subject text,
  p_idempotency_prefix text,
  p_priority text default 'normal'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.payment_requests%rowtype;
  v_recipient record;
  v_inserted_count integer := 0;
  v_priority text;
begin
  select *
    into v_request
  from public.payment_requests
  where id = p_payment_request_id;

  if not found then
    return;
  end if;

  v_priority := case lower(trim(coalesce(p_priority, 'normal')))
    when 'low' then 'low'
    when 'normal' then 'normal'
    when 'high' then 'high'
    when 'critical' then 'critical'
    else 'normal'
  end;

  for v_recipient in
    select distinct on (p.id)
      p.id as profile_id,
      nullif(trim(coalesce(p.email, '')), '') as email,
      lower(trim(r.name)) as role_name
    from public.profiles p
    join public.user_roles ur on ur.profile_id = p.id
    join public.roles r on r.id = ur.role_id
    where coalesce(p.active, true)
      and nullif(trim(coalesce(p.email, '')), '') is not null
      and lower(trim(r.name)) = any (
        select lower(trim(role_name))
        from unnest(coalesce(p_role_names, array[]::text[])) as expected_roles(role_name)
      )
    order by p.id, lower(trim(r.name))
  loop
    v_inserted_count := v_inserted_count + 1;

    insert into public.notification_events (
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
      next_attempt_at
    )
    values (
      p_event_type,
      'payment_requests',
      v_request.id,
      v_request.request_number,
      'administrador_sistema',
      v_recipient.profile_id,
      v_recipient.email,
      v_recipient.role_name,
      'email',
      v_priority,
      p_subject,
      public.notification_payment_request_payload(v_request.id),
      p_idempotency_prefix || ':role:' || v_recipient.profile_id::text,
      'pending',
      now()
    )
    on conflict (idempotency_key) do nothing;
  end loop;

  if v_inserted_count = 0 then
    insert into public.notification_events (
      event_type,
      source_table,
      source_id,
      source_folio,
      recipient_type,
      recipient_role,
      channel,
      priority,
      subject,
      payload,
      idempotency_key,
      status,
      last_error
    )
    values (
      p_event_type,
      'payment_requests',
      v_request.id,
      v_request.request_number,
      'administrador_sistema',
      array_to_string(p_role_names, ','),
      'email',
      v_priority,
      p_subject,
      public.notification_payment_request_payload(v_request.id),
      p_idempotency_prefix || ':role:none',
      'dead_letter',
      'role_recipient_missing'
    )
    on conflict (idempotency_key) do nothing;
  end if;
end;
$$;

create or replace function public.enqueue_payment_request_created_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_payment_request_notification_for_roles(
    new.id,
    'payment_request.created',
    array[
      'admin',
      'sysadmin',
      'finance',
      'finanzas',
      'treasury',
      'tesoreria',
      'administracion',
      'director',
      'direccion',
      'approver_2',
      'aprobador_2'
    ],
    'Nueva solicitud de pago: ' || coalesce(new.request_number, new.id::text),
    'payment_request.created:' || new.id::text,
    'normal'
  );

  return new;
exception
  when others then
    raise warning 'notification enqueue failed for payment_request.created: %', sqlerrm;
    return new;
end;
$$;

create or replace function public.enqueue_payment_request_decision_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_type text;
  v_request public.payment_requests%rowtype;
  v_subject text;
  v_idempotency_prefix text;
begin
  select *
    into v_request
  from public.payment_requests
  where id = new.payment_request_id;

  if not found then
    return new;
  end if;

  v_event_type := case new.action
    when 'approved' then 'payment_request.approved'
    when 'rejected' then 'payment_request.rejected'
    when 'changes_requested' then 'payment_request.changes_requested'
    when 'amount_change_requested' then 'payment_request.changes_requested'
    when 'category_change_requested' then 'payment_request.changes_requested'
    when 'budget_adjustment_requested' then 'payment_request.changes_requested'
    when 'exception_approved' then 'payment_request.exception_approved'
    when 'exception_rejected' then 'payment_request.exception_rejected'
    else null
  end;

  if v_event_type is null then
    return new;
  end if;

  v_idempotency_prefix := v_event_type || ':' || new.payment_request_id::text || ':' || new.id::text;
  v_subject := case v_event_type
    when 'payment_request.approved' then 'Solicitud aprobada: '
    when 'payment_request.rejected' then 'Solicitud rechazada: '
    when 'payment_request.changes_requested' then 'Cambios solicitados: '
    when 'payment_request.exception_approved' then 'Excepcion presupuestal aprobada: '
    when 'payment_request.exception_rejected' then 'Excepcion presupuestal rechazada: '
    else 'Actualizacion de solicitud: '
  end || coalesce(v_request.request_number, new.payment_request_id::text);

  perform public.enqueue_payment_request_notification_for_profile(
    new.payment_request_id,
    v_event_type,
    v_request.requested_by,
    v_subject,
    v_idempotency_prefix || ':requester',
    case when v_event_type like 'payment_request.exception_%' then 'high' else 'normal' end
  );

  if v_event_type in ('payment_request.approved', 'payment_request.exception_approved') then
    perform public.enqueue_payment_request_notification_for_roles(
      new.payment_request_id,
      v_event_type,
      case
        when v_event_type = 'payment_request.exception_approved' then
          array['admin', 'sysadmin', 'finance', 'finanzas', 'director', 'direccion']
        else
          array['admin', 'sysadmin', 'finance', 'finanzas', 'treasury', 'tesoreria', 'administracion']
      end,
      v_subject,
      v_idempotency_prefix,
      case when v_event_type = 'payment_request.exception_approved' then 'high' else 'normal' end
    );
  end if;

  return new;
exception
  when others then
    raise warning 'notification enqueue failed for payment_request decision: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists payment_request_created_notification_event on public.payment_requests;
create trigger payment_request_created_notification_event
  after insert on public.payment_requests
  for each row
  execute function public.enqueue_payment_request_created_notification();

drop trigger if exists payment_request_decision_notification_event on public.payment_request_approvals;
create trigger payment_request_decision_notification_event
  after insert on public.payment_request_approvals
  for each row
  execute function public.enqueue_payment_request_decision_notification();

revoke all on function public.notification_payment_request_payload(uuid) from public, anon, authenticated;
revoke all on function public.enqueue_payment_request_notification_for_profile(uuid, text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.enqueue_payment_request_notification_for_roles(uuid, text, text[], text, text, text) from public, anon, authenticated;
revoke all on function public.enqueue_payment_request_created_notification() from public, anon, authenticated;
revoke all on function public.enqueue_payment_request_decision_notification() from public, anon, authenticated;

grant execute on function public.notification_payment_request_payload(uuid) to service_role, postgres;
grant execute on function public.enqueue_payment_request_notification_for_profile(uuid, text, uuid, text, text, text) to service_role, postgres;
grant execute on function public.enqueue_payment_request_notification_for_roles(uuid, text, text[], text, text, text) to service_role, postgres;
grant execute on function public.enqueue_payment_request_created_notification() to service_role, postgres;
grant execute on function public.enqueue_payment_request_decision_notification() to service_role, postgres;
