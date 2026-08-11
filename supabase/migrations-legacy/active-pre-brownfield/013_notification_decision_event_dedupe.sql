-- Deduplicate future payment request decision notification events.
-- Keeps one enriched notification per logical recipient and decision.

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
  v_payload jsonb;
  v_priority text;
  v_role_names text[] := array[]::text[];
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

  v_priority := case when v_event_type like 'payment_request.exception_%' then 'high' else 'normal' end;
  v_decision_label := public.notification_decision_label(v_event_type);
  v_payload_extra := jsonb_build_object(
    'decision_action', new.action,
    'decision_comment', nullif(btrim(coalesce(new.comments, '')), ''),
    'decision_label', v_decision_label
  );
  v_payload := public.notification_payment_request_payload_with_extra(v_request.id, v_payload_extra);

  v_idempotency_prefix := v_event_type || ':' || new.payment_request_id::text || ':' || new.id::text;
  v_subject := case v_event_type
    when 'payment_request.approved' then 'Solicitud aprobada: '
    when 'payment_request.rejected' then 'Solicitud rechazada: '
    when 'payment_request.changes_requested' then 'Cambios solicitados: '
    when 'payment_request.exception_approved' then 'Excepcion presupuestal aprobada: '
    when 'payment_request.exception_rejected' then 'Excepcion presupuestal rechazada: '
    else 'Actualizacion de solicitud: '
  end || coalesce(v_request.request_number, new.payment_request_id::text);

  if v_event_type = 'payment_request.approved' then
    v_role_names := array['admin', 'sysadmin', 'finance', 'finanzas', 'treasury', 'tesoreria', 'administracion'];
  elsif v_event_type = 'payment_request.exception_approved' then
    v_role_names := array['admin', 'sysadmin', 'finance', 'finanzas', 'director', 'direccion'];
  end if;

  with requester_candidate as (
    select
      10 as sort_rank,
      'usuario_solicitante'::text as recipient_type,
      p.id as recipient_profile_id,
      null::text as recipient_role,
      nullif(trim(coalesce(p.email, '')), '') as recipient_email,
      case
        when v_request.requested_by is null then 'dead_letter'
        when p.id is null then 'dead_letter'
        when nullif(trim(coalesce(p.email, '')), '') is null then 'dead_letter'
        else 'pending'
      end as status,
      case
        when v_request.requested_by is null then 'missing_recipient_profile_id'
        when p.id is null then 'recipient_profile_not_found'
        when nullif(trim(coalesce(p.email, '')), '') is null then 'recipient_email_missing'
        else null::text
      end as last_error,
      v_idempotency_prefix || ':requester' as idempotency_key
    from (select 1) seed
    left join public.profiles p
      on p.id = v_request.requested_by
     and coalesce(p.active, true)
  ),
  role_candidates as (
    select distinct on (p.id)
      20 as sort_rank,
      'administrador_sistema'::text as recipient_type,
      p.id as recipient_profile_id,
      lower(trim(r.name)) as recipient_role,
      nullif(trim(coalesce(p.email, '')), '') as recipient_email,
      'pending'::text as status,
      null::text as last_error,
      v_idempotency_prefix || ':role:' || p.id::text as idempotency_key
    from public.profiles p
    join public.user_roles ur on ur.profile_id = p.id
    join public.roles r on r.id = ur.role_id
    where coalesce(p.active, true)
      and nullif(trim(coalesce(p.email, '')), '') is not null
      and lower(trim(r.name)) = any (
        select lower(trim(role_name))
        from unnest(coalesce(v_role_names, array[]::text[])) as expected_roles(role_name)
      )
    order by p.id, lower(trim(r.name))
  ),
  role_missing_candidate as (
    select
      30 as sort_rank,
      'administrador_sistema'::text as recipient_type,
      null::uuid as recipient_profile_id,
      array_to_string(v_role_names, ',') as recipient_role,
      null::text as recipient_email,
      'dead_letter'::text as status,
      'role_recipient_missing'::text as last_error,
      v_idempotency_prefix || ':role:none' as idempotency_key
    where array_length(v_role_names, 1) is not null
      and not exists (select 1 from role_candidates)
  ),
  candidates as (
    select * from requester_candidate
    union all
    select * from role_candidates
    union all
    select * from role_missing_candidate
  ),
  keyed_candidates as (
    select
      candidates.*,
      coalesce(
        nullif(lower(trim(candidates.recipient_email)), ''),
        case when candidates.recipient_profile_id is not null then 'profile:' || candidates.recipient_profile_id::text end,
        candidates.recipient_type || ':' || coalesce(candidates.recipient_role, '')
      ) as recipient_key
    from candidates
  ),
  deduped_candidates as (
    select distinct on (recipient_key)
      sort_rank,
      recipient_type,
      recipient_profile_id,
      recipient_role,
      recipient_email,
      status,
      last_error,
      idempotency_key
    from keyed_candidates
    order by recipient_key, sort_rank, recipient_type, coalesce(recipient_role, ''), coalesce(recipient_profile_id::text, '')
  )
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
    last_error,
    next_attempt_at
  )
  select
    v_event_type,
    'payment_requests',
    v_request.id,
    v_request.request_number,
    recipient_type,
    case when status = 'pending' then recipient_profile_id else null end,
    case when status = 'pending' then recipient_email else null end,
    recipient_role,
    'email',
    v_priority,
    v_subject,
    v_payload,
    idempotency_key,
    status,
    last_error,
    case when status = 'pending' then now() else null end
  from deduped_candidates
  on conflict (idempotency_key) do nothing;

  return new;
exception
  when others then
    raise warning 'notification enqueue failed for payment_request decision: %', sqlerrm;
    return new;
end;
$$;

revoke execute on function public.enqueue_payment_request_decision_notification() from public, anon, authenticated;
grant execute on function public.enqueue_payment_request_decision_notification() to service_role, postgres;