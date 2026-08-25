begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.enqueue_approval_batch_status_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_name text;
  v_director public.profiles%rowtype;
  v_submitter public.profiles%rowtype;
  v_totals jsonb;
  v_count integer;
  v_approved_count integer;
  v_rejected_count integer;
  v_event_type text;
begin
  if old.status = new.status then return new; end if;

  select coalesce(nullif(btrim(legal_name), ''), name)
    into v_company_name
  from public.companies
  where id = new.company_id;

  select *
    into v_director
  from public.profiles
  where id = new.director_id;

  select
    count(*)::integer,
    count(*) filter (where abi.director_status = 'approved')::integer,
    count(*) filter (where abi.director_status = 'rejected')::integer
    into v_count, v_approved_count, v_rejected_count
  from public.approval_batch_items abi
  where abi.batch_id = new.id
    and abi.removed_at is null;

  v_totals := public.approval_batch_totals_by_currency(new.id);

  if new.status = 'submitted' then
    perform public.insert_approval_batch_notification(
      'approval_batch.submitted', 'approval_batches', new.id, new.label,
      'administrador_sistema', v_director.id, v_director.email, 'direccion',
      'Corte semanal por autorizar: ' || new.label,
      jsonb_build_object(
        'batch_label', new.label,
        'company', v_company_name,
        'period_start', new.period_start,
        'period_end', new.period_end,
        'item_count', v_count,
        'totals_by_currency', v_totals,
        'status', new.status,
        'path', '/approval_batches.html'
      ),
      'approval_batch.submitted:' || new.id::text || ':' || new.director_id::text,
      'high'
    );
  elsif new.status in ('approved', 'partially_approved') then
    v_event_type := case
      when new.status = 'approved' then 'approval_batch.approved'
      else 'approval_batch.partially_approved'
    end;

    select *
      into v_submitter
    from public.profiles profile
    where profile.id = new.submitted_by
      and coalesce(profile.active, true);

    perform public.insert_approval_batch_notification(
      v_event_type, 'approval_batches', new.id, new.label,
      'administrador_sistema', v_submitter.id, v_submitter.email, 'finanzas',
      case
        when new.status = 'approved' then 'Corte semanal aprobado: '
        else 'Corte semanal aprobado con rechazos: '
      end || new.label,
      jsonb_build_object(
        'batch_label', new.label,
        'company', v_company_name,
        'period_start', new.period_start,
        'period_end', new.period_end,
        'item_count', v_count,
        'approved_count', v_approved_count,
        'rejected_count', v_rejected_count,
        'totals_by_currency', v_totals,
        'status', new.status,
        'decided_at', new.decided_at,
        'director_name', coalesce(nullif(btrim(v_director.full_name), ''), v_director.email),
        'path', '/approval_batches.html'
      ),
      v_event_type || ':' || new.id::text || ':' || coalesce(new.submitted_by::text, 'missing_submitter'),
      'high'
    );
  end if;

  return new;
end;
$$;

comment on function public.enqueue_approval_batch_status_notifications()
  is 'Enqueues one submitted event to the selected Director and one final decision event only to the user who submitted the cut.';

create or replace function public.get_approval_batch_decision_notification_document(
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
  v_submitter public.profiles%rowtype;
  v_director public.profiles%rowtype;
  v_company_name text;
  v_expected_status text;
  v_item_count integer;
  v_approved_count integer;
  v_rejected_count integer;
  v_totals jsonb;
  v_items jsonb;
  v_worker_id text := left(
    coalesce(nullif(btrim(p_worker_id), ''), 'edge-notification-dispatcher'),
    120
  );
begin
  select *
    into v_event
  from public.notification_events event
  where event.id = p_notification_event_id;

  if not found then
    raise exception 'approval_batch_decision_event_not_found';
  end if;

  v_expected_status := case v_event.event_type
    when 'approval_batch.approved' then 'approved'
    when 'approval_batch.partially_approved' then 'partially_approved'
    else null
  end;

  if v_expected_status is null
     or v_event.source_table <> 'approval_batches'
     or v_event.source_id is null then
    raise exception 'approval_batch_decision_event_invalid';
  end if;

  if v_event.status <> 'processing'
     or nullif(btrim(coalesce(v_event.locked_by, '')), '') is null
     or v_event.locked_by <> v_worker_id then
    raise exception 'approval_batch_decision_event_not_claimed_by_worker';
  end if;

  if v_event.payload->>'status' is distinct from v_expected_status then
    raise exception 'approval_batch_decision_event_status_drift';
  end if;

  select *
    into v_batch
  from public.approval_batches batch
  where batch.id = v_event.source_id;

  if not found
     or v_batch.status not in (v_expected_status, 'closed')
     or v_batch.decided_at is null then
    raise exception 'approval_batch_decision_no_longer_valid';
  end if;

  select *
    into v_submitter
  from public.profiles profile
  where profile.id = v_batch.submitted_by
    and coalesce(profile.active, true);

  if not found
     or v_event.recipient_profile_id is distinct from v_submitter.id
     or nullif(btrim(coalesce(v_submitter.email, '')), '') is null
     or lower(btrim(v_event.recipient_email)) is distinct from lower(btrim(v_submitter.email)) then
    raise exception 'approval_batch_decision_recipient_drift';
  end if;

  select *
    into v_director
  from public.profiles profile
  where profile.id = v_batch.decided_by;

  select coalesce(nullif(btrim(company.legal_name), ''), company.name)
    into v_company_name
  from public.companies company
  where company.id = v_batch.company_id;

  select
    count(*)::integer,
    count(*) filter (where item.director_status = 'approved')::integer,
    count(*) filter (where item.director_status = 'rejected')::integer
    into v_item_count, v_approved_count, v_rejected_count
  from public.approval_batch_items item
  where item.batch_id = v_batch.id
    and item.removed_at is null;

  if v_item_count < 1 then
    raise exception 'approval_batch_decision_requires_items';
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
    'provider_name', coalesce(
      nullif(btrim(provider.alias), ''),
      nullif(btrim(provider.nombre_completo), ''),
      'Proveedor sin nombre'
    ),
    'cost_center', case
      when cost_center.id is null then null
      else coalesce(nullif(btrim(cost_center.code), '') || ' - ', '') || cost_center.name
    end,
    'budget_category', case
      when budget_category.id is null then null
      else coalesce(nullif(btrim(budget_category.code), '') || ' - ', '') || budget_category.name
    end,
    'payment_method', coalesce(
      nullif(btrim(request.payment_method), ''),
      case when request.request_type::text in ('cash', 'check') then request.request_type::text else 'transfer' end
    ),
    'amount', request.amount_requested,
    'currency', coalesce(nullif(upper(btrim(request.currency)), ''), 'MXN'),
    'requester_name', requester.full_name,
    'director_status', item.director_status,
    'reject_reason', item.director_reject_reason,
    'rebatch_release_note', item.rebatch_release_note
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
  left join public.profiles requester
    on requester.id = request.requested_by
  where item.batch_id = v_batch.id
    and item.removed_at is null;

  return jsonb_build_object(
    'event_id', v_event.id,
    'recipient_email', v_submitter.email,
    'recipient_profile_id', v_submitter.id,
    'batch', jsonb_build_object(
      'id', v_batch.id,
      'label', v_batch.label,
      'company', v_company_name,
      'company_name', v_company_name,
      'status', v_expected_status,
      'period_start', v_batch.period_start,
      'period_end', v_batch.period_end,
      'submitted_at', v_batch.submitted_at,
      'decided_at', v_batch.decided_at,
      'director_name', coalesce(nullif(btrim(v_director.full_name), ''), v_director.email),
      'item_count', v_item_count,
      'approved_count', v_approved_count,
      'rejected_count', v_rejected_count,
      'totals_by_currency', coalesce(v_totals, '[]'::jsonb)
    ),
    'items', v_items
  );
end;
$$;

alter function public.get_approval_batch_decision_notification_document(uuid, text)
  owner to postgres;

revoke all on function public.get_approval_batch_decision_notification_document(uuid, text)
  from public, anon, authenticated;

grant execute on function public.get_approval_batch_decision_notification_document(uuid, text)
  to service_role;

comment on function public.get_approval_batch_decision_notification_document(uuid, text)
  is 'Service-only final weekly-cut decision document for the single submitted_by recipient.';

commit;


