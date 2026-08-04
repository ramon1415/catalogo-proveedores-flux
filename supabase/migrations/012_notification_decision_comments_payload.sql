-- Add decision metadata to future notification payloads without rewriting historical events.

create or replace function public.notification_decision_label(p_event_type text)
returns text
language sql
immutable
as $$
  select case p_event_type
    when 'payment_request.approved' then 'Comentario de aprobacion'
    when 'payment_request.rejected' then 'Motivo de rechazo'
    when 'payment_request.changes_requested' then 'Motivo / comentario'
    when 'payment_request.exception_approved' then 'Motivo / comentario de excepcion aprobada'
    when 'payment_request.exception_rejected' then 'Motivo / comentario de excepcion rechazada'
    else 'Comentario'
  end;
$$;

create or replace function public.notification_payment_request_payload_with_extra(
  p_payment_request_id uuid,
  p_extra jsonb default '{}'::jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.notification_payment_request_payload(p_payment_request_id)
    || jsonb_strip_nulls(coalesce(p_extra, '{}'::jsonb));
$$;

create or replace function public.enqueue_payment_request_notification_for_profile(
  p_payment_request_id uuid,
  p_event_type text,
  p_recipient_profile_id uuid,
  p_subject text,
  p_idempotency_key text,
  p_priority text,
  p_payload_extra jsonb
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
    public.notification_payment_request_payload_with_extra(v_request.id, p_payload_extra),
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
  p_priority text,
  p_payload_extra jsonb
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
      public.notification_payment_request_payload_with_extra(v_request.id, p_payload_extra),
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
      public.notification_payment_request_payload_with_extra(v_request.id, p_payload_extra),
      p_idempotency_prefix || ':role:none',
      'dead_letter',
      'role_recipient_missing'
    )
    on conflict (idempotency_key) do nothing;
  end if;
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
  v_decision_label text;
  v_payload_extra jsonb;
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

  v_decision_label := public.notification_decision_label(v_event_type);
  v_payload_extra := jsonb_build_object(
    'decision_action', new.action,
    'decision_comment', nullif(btrim(coalesce(new.comments, '')), ''),
    'decision_label', v_decision_label
  );

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
    case when v_event_type like 'payment_request.exception_%' then 'high' else 'normal' end,
    v_payload_extra
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
      case when v_event_type = 'payment_request.exception_approved' then 'high' else 'normal' end,
      v_payload_extra
    );
  end if;

  return new;
exception
  when others then
    raise warning 'notification enqueue failed for payment_request decision: %', sqlerrm;
    return new;
end;
$$;

revoke execute on function public.notification_decision_label(text) from public, anon, authenticated;
grant execute on function public.notification_decision_label(text) to service_role, postgres;

revoke execute on function public.notification_payment_request_payload_with_extra(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.notification_payment_request_payload_with_extra(uuid, jsonb) to service_role, postgres;

revoke execute on function public.enqueue_payment_request_notification_for_profile(uuid, text, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_payment_request_notification_for_profile(uuid, text, uuid, text, text, text, jsonb) to service_role, postgres;

revoke execute on function public.enqueue_payment_request_notification_for_roles(uuid, text, text[], text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_payment_request_notification_for_roles(uuid, text, text[], text, text, text, jsonb) to service_role, postgres;

revoke execute on function public.enqueue_payment_request_decision_notification() from public, anon, authenticated;
grant execute on function public.enqueue_payment_request_decision_notification() to service_role, postgres;
