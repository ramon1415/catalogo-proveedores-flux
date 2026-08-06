-- NOTIFICATIONS-RECEIPT-LINKED
-- Produces notification ledger rows only for newly materialized 1:1 receipt links.
-- No backfill, replay, email send, Storage mutation, or historical event mutation.

begin;

do $precheck$
begin
  if to_regclass('public.notification_events') is null
     or to_regclass('public.notification_delivery_attempts') is null
     or to_regclass('public.financial_outbox_events') is null
     or to_regclass('public.payment_request_receipt_links') is null
     or to_regclass('public.payment_operation_evidence') is null
     or to_regclass('public.bank_payment_operations') is null
     or to_regclass('public.payment_requests') is null
     or to_regclass('public.payment_intake') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.proveedores') is null
     or to_regprocedure(
       'public.link_payment_receipt_to_request(uuid,uuid,text)'
     ) is null
     or to_regprocedure(
       'public.append_financial_outbox_event_internal(text,text,uuid,uuid,uuid,jsonb,uuid,uuid,text)'
     ) is null
     or to_regprocedure(
       'public.claim_notification_events_for_dispatcher(integer,text)'
     ) is null then
    raise exception 'notifications_receipt_linked_dependencies_missing';
  end if;

  if to_regprocedure(
       'public.enqueue_payment_receipt_linked_notifications_internal(uuid)'
     ) is not null
     or to_regprocedure(
       'public.get_payment_receipt_notification_attachment(uuid)'
     ) is not null
     or to_regprocedure(
       'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)'
     ) is not null then
    raise exception 'notifications_receipt_linked_objects_already_exist';
  end if;
end
$precheck$;

create function public.payment_receipt_notification_email_state(p_email text)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case
    when nullif(btrim(coalesce(p_email, '')), '') is null then 'missing'
    when lower(btrim(p_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'eligible'
    else 'invalid'
  end;
$$;

create function public.enqueue_payment_receipt_linked_notifications_internal(
  p_link_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.payment_request_receipt_links%rowtype;
  v_request public.payment_requests%rowtype;
  v_evidence public.payment_operation_evidence%rowtype;
  v_requester_profile public.profiles%rowtype;
  v_provider public.proveedores%rowtype;
  v_company_name text;
  v_intake_folio text;
  v_external_folio text;
  v_requester_email text;
  v_provider_email text;
  v_requester_state text;
  v_provider_state text;
  v_unique_recipient_count integer := 0;
  v_notification_resolution jsonb;
  v_notification_event_ids uuid[] := array[]::uuid[];
  v_notification_events_created integer := 0;
  v_base_payload jsonb;
  v_recipient record;
  v_event_id uuid;
  v_idempotency_key text;
begin
  if p_link_id is null then
    raise exception 'payment_receipt_notification_link_id_required';
  end if;

  select *
    into v_link
  from public.payment_request_receipt_links
  where id = p_link_id;
  if not found then
    raise exception 'payment_receipt_notification_link_not_found';
  end if;

  select *
    into v_request
  from public.payment_requests
  where id = v_link.payment_request_id;
  if not found then
    raise exception 'payment_receipt_notification_request_not_found';
  end if;

  select *
    into v_evidence
  from public.payment_operation_evidence
  where id = v_link.evidence_id;
  if not found then
    raise exception 'payment_receipt_notification_evidence_not_found';
  end if;

  if v_request.id <> v_link.payment_request_id
     or v_request.company_id <> v_link.company_id
     or v_evidence.id <> v_link.evidence_id
     or v_evidence.operation_id <> v_link.operation_id
     or v_evidence.company_id <> v_link.company_id
     or v_request.status::text <> 'paid'
     or v_evidence.status <> 'shareable'
     or v_evidence.page_count is distinct from 1
     or not v_evidence.single_operation_attested
     or v_evidence.storage_bucket <> 'payment-batch-documents'
     or v_evidence.mime_type <> 'application/pdf'
     or v_evidence.file_size_bytes is null
     or v_evidence.file_size_bytes not between 1 and 26214400
     or v_evidence.individual_sha256 is null
     or v_evidence.individual_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'payment_receipt_notification_contract_invalid';
  end if;

  if v_request.requested_by is not null then
    select *
      into v_requester_profile
    from public.profiles
    where id = v_request.requested_by
      and coalesce(active, true);
  end if;

  select *
    into v_provider
  from public.proveedores
  where id = v_request.proveedor_id;
  if not found then
    raise exception 'payment_receipt_notification_provider_not_found';
  end if;

  select c.name
    into v_company_name
  from public.companies c
  where c.id = v_link.company_id;

  select pi.public_folio
    into v_intake_folio
  from public.payment_intake pi
  where pi.created_payment_request_id = v_request.id
  limit 1;

  v_external_folio := coalesce(
    nullif(btrim(v_intake_folio), ''),
    nullif(btrim(v_request.request_number), '')
  );
  v_requester_email := lower(btrim(coalesce(v_requester_profile.email, '')));
  v_provider_email := lower(btrim(coalesce(v_provider.email, '')));
  v_requester_state := public.payment_receipt_notification_email_state(
    v_requester_profile.email
  );
  v_provider_state := public.payment_receipt_notification_email_state(
    v_provider.email
  );

  select count(distinct candidate.email_normalized)::integer
    into v_unique_recipient_count
  from (
    values
      (v_requester_email, v_requester_state),
      (v_provider_email, v_provider_state)
  ) as candidate(email_normalized, resolution)
  where candidate.resolution = 'eligible';

  v_notification_resolution := jsonb_build_object(
    'requester', v_requester_state,
    'provider', v_provider_state,
    'unique_recipient_count', v_unique_recipient_count
  );

  if v_external_folio is null then
    return jsonb_build_object(
      'notification_resolution', v_notification_resolution,
      'notification_event_ids', to_jsonb(v_notification_event_ids),
      'notification_events_created', 0,
      'notification_events_total', 0,
      'notification_block_reason', 'missing_external_folio'
    );
  end if;

  v_base_payload := jsonb_build_object(
    'contract_version', 'v1',
    'folio', v_external_folio,
    'provider', coalesce(
      nullif(btrim(v_provider.alias), ''),
      nullif(btrim(v_provider.nombre_completo), ''),
      'Proveedor'
    ),
    'company', coalesce(nullif(btrim(v_company_name), ''), 'Empresa'),
    'concept', coalesce(
      nullif(btrim(v_request.concept), ''),
      nullif(btrim(v_request.payment_concept), ''),
      'Solicitud de pago'
    ),
    'amount', v_request.amount_requested,
    'currency', v_request.currency,
    'payment_date', v_link.payment_date,
    'reference_hint', v_link.reference_hint,
    'status', 'paid',
    'recipient_roles', '[]'::jsonb
  );

  for v_recipient in
    with candidates as (
      select
        'requester'::text as recipient_role,
        v_requester_email as email_normalized,
        v_requester_state as resolution,
        v_request.requested_by as profile_id
      union all
      select
        'provider'::text,
        v_provider_email,
        v_provider_state,
        null::uuid
    )
    select
      candidate.email_normalized,
      array_agg(
        candidate.recipient_role
        order by case candidate.recipient_role when 'requester' then 1 else 2 end
      ) as recipient_roles,
      case
        when bool_or(candidate.recipient_role = 'requester')
          then 'usuario_solicitante'
        else 'proveedor'
      end as recipient_type,
      (
        array_agg(candidate.profile_id) filter (
          where candidate.recipient_role = 'requester'
        )
      )[1] as recipient_profile_id
    from candidates candidate
    where candidate.resolution = 'eligible'
    group by candidate.email_normalized
    order by min(
      case candidate.recipient_role when 'requester' then 1 else 2 end
    )
  loop
    v_idempotency_key := format(
      'notification:payment_receipt.linked:%s:%s:v1',
      v_link.id,
      md5(v_recipient.email_normalized)
    );

    insert into public.notification_events(
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
    ) values (
      'payment_receipt.linked',
      'payment_request_receipt_links',
      v_link.id,
      v_external_folio,
      v_recipient.recipient_type,
      v_recipient.recipient_profile_id,
      v_recipient.email_normalized,
      case
        when v_recipient.recipient_roles = array['requester', 'provider']::text[]
          then 'requester_provider'
        else v_recipient.recipient_roles[1]
      end,
      'email',
      'normal',
      case
        when 'requester' = any(v_recipient.recipient_roles)
          then format('Comprobante de pago disponible — %s', v_external_folio)
        else format('Comprobante de pago — %s', v_external_folio)
      end,
      jsonb_set(
        v_base_payload,
        '{recipient_roles}',
        to_jsonb(v_recipient.recipient_roles),
        true
      ),
      v_idempotency_key,
      'pending',
      clock_timestamp()
    )
    on conflict (idempotency_key) do nothing
    returning id into v_event_id;

    if v_event_id is null then
      select event.id
        into v_event_id
      from public.notification_events event
      where event.idempotency_key = v_idempotency_key;
    else
      v_notification_events_created := v_notification_events_created + 1;
    end if;

    if v_event_id is not null then
      v_notification_event_ids := array_append(
        v_notification_event_ids,
        v_event_id
      );
    end if;
    v_event_id := null;
  end loop;

  return jsonb_build_object(
    'notification_resolution', v_notification_resolution,
    'notification_event_ids', to_jsonb(v_notification_event_ids),
    'notification_events_created', v_notification_events_created,
    'notification_events_total', cardinality(v_notification_event_ids)
  );
end;
$$;

create function public.get_payment_receipt_notification_attachment(
  p_notification_event_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.notification_events%rowtype;
  v_link public.payment_request_receipt_links%rowtype;
  v_request public.payment_requests%rowtype;
  v_operation public.bank_payment_operations%rowtype;
  v_evidence public.payment_operation_evidence%rowtype;
  v_provider public.proveedores%rowtype;
  v_safe_folio text;
  v_safe_provider text;
  v_filename text;
begin
  if p_notification_event_id is null then
    raise exception 'notification_event_required';
  end if;

  select *
    into v_event
  from public.notification_events
  where id = p_notification_event_id;
  if not found then
    raise exception 'notification_event_not_found';
  end if;
  if v_event.event_type <> 'payment_receipt.linked'
     or v_event.source_table <> 'payment_request_receipt_links'
     or v_event.source_id is null then
    raise exception 'notification_event_source_invalid';
  end if;

  select *
    into v_link
  from public.payment_request_receipt_links
  where id = v_event.source_id;
  if not found then
    raise exception 'payment_receipt_link_not_found';
  end if;

  select *
    into v_request
  from public.payment_requests
  where id = v_link.payment_request_id;
  if not found then
    raise exception 'payment_request_not_found';
  end if;

  select *
    into v_operation
  from public.bank_payment_operations
  where id = v_link.operation_id;
  if not found then
    raise exception 'bank_payment_operation_not_found';
  end if;

  select *
    into v_evidence
  from public.payment_operation_evidence
  where id = v_link.evidence_id;
  if not found then
    raise exception 'payment_evidence_not_found';
  end if;

  select *
    into v_provider
  from public.proveedores
  where id = v_request.proveedor_id;
  if not found then
    raise exception 'payment_request_provider_not_found';
  end if;

  if v_event.source_id <> v_link.id
     or v_request.id <> v_link.payment_request_id
     or v_operation.id <> v_link.operation_id
     or v_evidence.id <> v_link.evidence_id
     or v_evidence.operation_id <> v_operation.id
     or v_request.company_id <> v_link.company_id
     or v_operation.company_id <> v_link.company_id
     or v_evidence.company_id <> v_link.company_id
     or v_evidence.status <> 'shareable'
     or v_evidence.page_count is distinct from 1
     or not v_evidence.single_operation_attested
     or v_evidence.storage_bucket <> 'payment-batch-documents'
     or v_evidence.storage_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/evidence/[0-9a-f-]{36}\.pdf$'
     or v_evidence.mime_type <> 'application/pdf'
     or v_evidence.file_size_bytes is null
     or v_evidence.file_size_bytes not between 1 and 26214400
     or v_evidence.individual_sha256 is null
     or v_evidence.individual_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'payment_receipt_attachment_contract_invalid';
  end if;

  v_safe_folio := regexp_replace(
    coalesce(nullif(btrim(v_event.source_folio), ''), 'sin-folio'),
    '[^a-zA-Z0-9._-]',
    '-',
    'g'
  );
  v_safe_provider := regexp_replace(
    coalesce(
      nullif(btrim(v_provider.alias), ''),
      nullif(btrim(v_provider.nombre_completo), ''),
      'proveedor'
    ),
    '[^a-zA-Z0-9._-]',
    '-',
    'g'
  );
  v_filename := left(
    format('Comprobante_%s_%s.pdf', v_safe_folio, v_safe_provider),
    120
  );

  return jsonb_build_object(
    'bucket', v_evidence.storage_bucket,
    'path', v_evidence.storage_path,
    'mime_type', v_evidence.mime_type,
    'size_bytes', v_evidence.file_size_bytes,
    'sha256', v_evidence.individual_sha256,
    'filename', v_filename
  );
end;
$$;

create function public.claim_notification_events_for_dispatcher_v2(
  p_limit integer default 5,
  p_worker_id text default 'edge-notification-dispatcher',
  p_event_types text[] default null,
  p_created_at_from timestamptz default null
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
    coalesce(nullif(btrim(p_worker_id), ''), 'edge-notification-dispatcher'),
    120
  );
  v_event_types text[];
  v_allowed_event_types constant text[] := array[
    'payment_request.created',
    'payment_request.approved',
    'payment_request.rejected',
    'payment_request.changes_requested',
    'payment_request.exception_approved',
    'payment_request.exception_rejected',
    'approval_batch.submitted',
    'approval_batch.approved',
    'approval_batch.partially_approved',
    'approval_batch.item_rejected',
    'payment_request.extraordinary_authorized',
    'approval_batch.item_rebatched',
    'payment_receipt.linked'
  ]::text[];
begin
  select array_agg(distinct btrim(event_type) order by btrim(event_type))
    into v_event_types
  from unnest(coalesce(p_event_types, array[]::text[])) as requested(event_type)
  where nullif(btrim(coalesce(event_type, '')), '') is not null;

  if coalesce(cardinality(v_event_types), 0) = 0 then
    raise exception 'notification_dispatcher_event_types_required';
  end if;
  if p_created_at_from is null then
    raise exception 'notification_dispatcher_cutoff_required';
  end if;
  if exists (
    select 1
    from unnest(v_event_types) as requested(event_type)
    where not requested.event_type = any(v_allowed_event_types)
  ) then
    raise exception 'notification_dispatcher_event_type_not_allowed';
  end if;

  return query
  with candidate as (
    select event.id
    from public.notification_events event
    where event.event_type = any(v_event_types)
      and event.status in ('pending', 'failed')
      and event.created_at >= p_created_at_from
      and coalesce(event.next_attempt_at, now()) <= now()
      and event.attempt_count < event.max_attempts
      and nullif(btrim(coalesce(event.recipient_email, '')), '') is not null
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

alter table public.notification_events
  drop constraint notification_events_recipient_type_check;
alter table public.notification_events
  add constraint notification_events_recipient_type_check
  check (
    recipient_type = any(
      array[
        'usuario_solicitante'::text,
        'administrador_sistema'::text,
        'proveedor'::text
      ]
    )
  );

create or replace function public.link_payment_receipt_to_request(
  p_operation_id uuid,
  p_payment_request_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_initial public.bank_payment_operations%rowtype;
  v_operation public.bank_payment_operations%rowtype;
  v_request public.payment_requests%rowtype;
  v_snapshot public.payable_snapshots%rowtype;
  v_evidence public.payment_operation_evidence%rowtype;
  v_provider record;
  v_actor uuid;
  v_payload jsonb;
  v_payload_hash text;
  v_replay jsonb;
  v_provider_match boolean;
  v_link_id uuid;
  v_event_id uuid;
  v_linked_at timestamptz;
  v_result jsonb;
  v_notification jsonb;
  v_updated integer;
begin
  select * into v_initial
  from public.bank_payment_operations
  where id = p_operation_id;
  if not found then raise exception 'bank_payment_operation_not_found'; end if;
  v_actor := public.payment_reconciliation_require_finance(v_initial.company_id);
  v_payload := jsonb_build_object(
    'operation_id', p_operation_id,
    'payment_request_id', p_payment_request_id
  );
  v_payload_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_initial.company_id,
    'payment_receipt.link',
    p_idempotency_key,
    v_payload_hash,
    v_actor
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_operation
  from public.bank_payment_operations
  where id = p_operation_id
  for update;
  if v_operation.company_id <> v_initial.company_id then
    raise exception 'bank_payment_operation_company_changed';
  end if;
  if v_operation.status = 'cancelled' then
    raise exception 'bank_payment_operation_not_linkable';
  end if;
  if exists (
    select 1 from public.payment_request_receipt_links
    where operation_id = v_operation.id
  ) then
    raise exception 'bank_receipt_already_linked';
  end if;
  if not exists (
    select 1 from public.payment_document_extractions extraction
    where extraction.id = v_operation.extraction_id
      and extraction.status = 'accepted'
  ) then
    raise exception 'accepted_payment_extraction_required';
  end if;

  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  if v_request.company_id <> v_operation.company_id then
    raise exception 'payment_request_company_mismatch';
  end if;
  if v_request.status::text <> 'approved' then
    raise exception 'payment_request_must_be_approved';
  end if;
  if exists (
    select 1 from public.payment_request_receipt_links
    where payment_request_id = v_request.id
  ) or exists (
    select 1 from public.payment_receipts legacy
    where legacy.payment_request_id = v_request.id
  ) then
    raise exception 'payment_request_already_has_receipt';
  end if;

  select * into v_snapshot
  from public.payable_snapshots
  where payment_request_id = v_request.id
  order by version desc
  limit 1
  for update;
  if not found or not public.payment_reconciliation_snapshot_is_payable(v_snapshot.id) then
    raise exception 'payment_request_not_payable';
  end if;
  if v_snapshot.amount_minor <> v_operation.amount_minor then
    raise exception 'receipt_request_amount_mismatch';
  end if;
  if v_snapshot.currency <> v_operation.currency then
    raise exception 'receipt_request_currency_mismatch';
  end if;

  select
    proveedor.alias,
    proveedor.nombre_completo,
    proveedor.clabe,
    proveedor.cuenta_bancaria
    into v_provider
  from public.proveedores proveedor
  where proveedor.id = v_request.proveedor_id;
  if not found then raise exception 'payment_request_provider_not_found'; end if;

  v_provider_match := (
    v_operation.destination_account_hash is not null
    and (
      v_operation.destination_account_hash =
        public.payment_reconciliation_account_hash(v_provider.clabe)
      or v_operation.destination_account_hash =
        public.payment_reconciliation_account_hash(v_provider.cuenta_bancaria)
    )
  ) or (
    nullif(public.payment_receipt_normalize_match_text(v_operation.beneficiary_name), '') is not null
    and (
      (
        nullif(public.payment_receipt_normalize_match_text(v_provider.alias), '') is not null
        and public.payment_receipt_normalize_match_text(v_operation.beneficiary_name)
          like '%' || public.payment_receipt_normalize_match_text(v_provider.alias) || '%'
      )
      or (
        nullif(public.payment_receipt_normalize_match_text(v_provider.nombre_completo), '') is not null
        and public.payment_receipt_normalize_match_text(v_operation.beneficiary_name)
          like '%' || public.payment_receipt_normalize_match_text(v_provider.nombre_completo) || '%'
      )
    )
  );
  if not v_provider_match then
    raise exception 'receipt_request_provider_mismatch';
  end if;

  select * into v_evidence
  from public.payment_operation_evidence
  where operation_id = v_operation.id
    and status = 'shareable'
    and page_count = 1
    and single_operation_attested
  for update;
  if not found then
    raise exception 'shareable_single_page_evidence_required';
  end if;

  v_linked_at := clock_timestamp();
  begin
    insert into public.payment_request_receipt_links(
      company_id, operation_id, payment_request_id, snapshot_id, evidence_id,
      amount_minor, currency, payment_date, reference_hint, linked_by, linked_at
    ) values (
      v_operation.company_id, v_operation.id, v_request.id, v_snapshot.id,
      v_evidence.id, v_operation.amount_minor, v_operation.currency,
      v_operation.application_date, right(v_operation.bank_unique_folio, 6),
      v_actor, v_linked_at
    ) returning id into v_link_id;
  exception when unique_violation then
    raise exception 'receipt_or_request_already_linked';
  end;

  update public.payment_requests
  set status = 'paid'::public.payment_request_status,
      paid_by = v_actor,
      paid_at = v_linked_at,
      updated_at = v_linked_at
  where id = v_request.id
    and status::text = 'approved';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'payment_request_changed_during_link';
  end if;

  v_notification :=
    public.enqueue_payment_receipt_linked_notifications_internal(v_link_id);

  v_event_id := public.append_financial_outbox_event_internal(
    'payment_receipt.linked',
    'payment_request_receipt_link',
    v_link_id,
    v_operation.company_id,
    v_actor,
    jsonb_build_object(
      'amount_minor', v_operation.amount_minor,
      'currency', v_operation.currency,
      'evidence_id', v_evidence.id,
      'operation_id', v_operation.id,
      'payment_request_id', v_request.id
    ) || jsonb_build_object(
      'notification_resolution', v_notification -> 'notification_resolution'
    ),
    v_operation.id,
    null,
    'receipt-linked:' || v_payload_hash
  );

  v_result := jsonb_build_object(
    'amount_minor', v_operation.amount_minor,
    'currency', v_operation.currency,
    'evidence_id', v_evidence.id,
    'event_id', v_event_id,
    'link_id', v_link_id,
    'operation_id', v_operation.id,
    'payment_date', v_operation.application_date,
    'payment_request_id', v_request.id,
    'reference_hint', right(v_operation.bank_unique_folio, 6),
    'request_number', v_request.request_number,
    'request_status', 'paid'
  );
  return public.payment_reconciliation_store_command(
    v_operation.company_id,
    'payment_receipt.link',
    p_idempotency_key,
    v_payload_hash,
    v_actor,
    v_result
  );
end
$$;

revoke all on function public.payment_receipt_notification_email_state(text)
  from public, anon, authenticated, service_role;
revoke all on function public.enqueue_payment_receipt_linked_notifications_internal(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_payment_receipt_notification_attachment(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_notification_events_for_dispatcher_v2(
  integer, text, text[], timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.get_payment_receipt_notification_attachment(uuid)
  to service_role, postgres;
grant execute on function public.claim_notification_events_for_dispatcher_v2(
  integer, text, text[], timestamptz
) to service_role, postgres;

do $postcheck$
declare
  v_recipient_constraint text;
  v_link_result_type text;
begin
  if to_regprocedure(
       'public.enqueue_payment_receipt_linked_notifications_internal(uuid)'
     ) is null
     or to_regprocedure(
       'public.get_payment_receipt_notification_attachment(uuid)'
     ) is null
     or to_regprocedure(
       'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)'
     ) is null then
    raise exception 'notifications_receipt_linked_function_postcheck_failed';
  end if;

  select pg_get_constraintdef(oid)
    into v_recipient_constraint
  from pg_constraint
  where conrelid = 'public.notification_events'::regclass
    and conname = 'notification_events_recipient_type_check';
  if v_recipient_constraint not like '%proveedor%'
     or v_recipient_constraint not like '%usuario_solicitante%'
     or v_recipient_constraint not like '%administrador_sistema%' then
    raise exception 'notifications_receipt_linked_recipient_constraint_postcheck_failed';
  end if;

  select pg_get_function_result(
    'public.link_payment_receipt_to_request(uuid,uuid,text)'::regprocedure
  ) into v_link_result_type;
  if v_link_result_type <> 'jsonb'
     or not has_function_privilege(
       'authenticated',
       'public.link_payment_receipt_to_request(uuid,uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.link_payment_receipt_to_request(uuid,uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'notifications_receipt_linked_financial_rpc_postcheck_failed';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.get_payment_receipt_notification_attachment(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.get_payment_receipt_notification_attachment(uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.get_payment_receipt_notification_attachment(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamptz)',
       'EXECUTE'
     ) then
    raise exception 'notifications_receipt_linked_service_acl_postcheck_failed';
  end if;
end
$postcheck$;

comment on function public.get_payment_receipt_notification_attachment(uuid) is
  'Service-only resolver for the private, single-page PDF attached to payment_receipt.linked notifications.';
comment on function public.claim_notification_events_for_dispatcher_v2(
  integer, text, text[], timestamptz
) is
  'Service-only queue claim requiring an explicit event allowlist and temporal cutoff. Does not replay historical backlog.';

commit;
