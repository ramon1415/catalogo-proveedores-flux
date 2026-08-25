begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.get_approval_batch_submitted_notification_document(
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
    'provider_name', coalesce(
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
    'rebatch_release_note', item.rebatch_release_note,
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
  left join public.profiles requester
    on requester.id = request.requested_by
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
      'company_name', v_company_name,
      'status', v_batch.status,
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

comment on function public.get_approval_batch_submitted_notification_document(uuid, text)
  is 'PROD submitted-batch email document with the same row fields used by approval_batches.js PDF export.';

commit;
