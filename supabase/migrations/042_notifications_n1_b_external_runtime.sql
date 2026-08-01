-- Flux Operadora - Notifications N1-B external runtime candidate.
-- Static candidate only: applying this migration is a separate, explicitly gated action.
-- The migration creates no events, attempts, rollout activation, cutoff or allowlist rows.

begin;

do $$
begin
  if to_regprocedure(
    'public.notification_external_payload_valid(text,smallint,jsonb)'
  ) is null
     or to_regprocedure(
       'public.claim_external_notification_events_for_dispatcher(integer,text)'
     ) is null
     or to_regprocedure(
       'public.protect_payment_intake_submission_completed()'
     ) is null then
    raise exception 'notifications_n1_a_contract_missing';
  end if;

  if to_regclass('public.notification_external_dispatch_invocations') is not null
     or to_regprocedure(
       'public.enqueue_provider_intake_external_notification_v1(uuid)'
     ) is not null
     or to_regprocedure(
       'public.finalize_provider_intake_submission_v1(uuid,smallint,jsonb)'
     ) is not null
     or to_regprocedure(
       'public.transition_provider_intake_external_v1(uuid,text,timestamptz,text,text,text,text[],uuid)'
     ) is not null then
    raise exception 'notifications_n1_b_object_collision';
  end if;
end
$$;

create function public.enqueue_provider_intake_external_notification_v1(
  p_source_event_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_source record;
  v_rollout public.notification_external_rollouts%rowtype;
  v_event_type text;
  v_recipient text;
  v_recipient_hash text;
  v_payload jsonb;
  v_key text;
  v_status text;
begin
  select
    pie.id,
    pie.payment_intake_id,
    pie.event_type,
    pie.external_message,
    pie.external_field_codes,
    pie.external_contract_version,
    pie.created_at,
    pi.public_folio,
    pi.provider_email,
    pi.submission_completed_at
    into v_source
  from public.payment_intake_events pie
  join public.payment_intake pi on pi.id = pie.payment_intake_id
  where pie.id = p_source_event_id
  for share of pie, pi;

  if not found then
    raise exception 'external_source_event_not_found';
  end if;

  v_event_type := case v_source.event_type
    when 'submission_completed' then 'provider_intake.received'
    when 'correction_requested' then 'provider_intake.correction_requested'
    when 'rejected' then 'provider_intake.rejected'
    else null
  end;

  if v_event_type is null then
    return jsonb_build_object('result', 'event_not_enabled');
  end if;

  if v_event_type = 'provider_intake.received'
     and v_source.submission_completed_at is null then
    raise exception 'external_received_requires_submission_completed';
  end if;

  if v_event_type = 'provider_intake.correction_requested'
     and exists (
       select 1
       from public.payment_intake_events earlier
       where earlier.payment_intake_id = v_source.payment_intake_id
         and earlier.event_type = 'correction_requested'
         and earlier.id <> v_source.id
         and (earlier.created_at, earlier.id) < (v_source.created_at, v_source.id)
     ) then
    return jsonb_build_object('result', 'manual_follow_up_required');
  end if;

  v_key := format(
    'external:%s:%s:v1',
    v_event_type,
    v_source.payment_intake_id
  );

  if exists (
    select 1
    from public.notification_events e
    where e.idempotency_key = v_key
  ) then
    return jsonb_build_object('result', 'already_exists');
  end if;

  select r.*
    into v_rollout
  from public.notification_external_rollouts r
  where r.id = 'provider-intake-v1';

  if not found or v_rollout.mode in ('disabled', 'paused') then
    return jsonb_build_object('result', 'rollout_disabled');
  end if;

  if v_rollout.cutoff_at is null then
    return jsonb_build_object('result', 'rollout_disabled');
  end if;

  if v_source.created_at < v_rollout.cutoff_at then
    return jsonb_build_object('result', 'source_before_cutoff');
  end if;

  if not (v_event_type = any (v_rollout.enabled_event_types))
     or not public.notification_external_event_mode_allowed(
       v_event_type,
       v_rollout.mode
     ) then
    return jsonb_build_object('result', 'event_not_enabled');
  end if;

  v_payload := jsonb_build_object(
    'event_version', 1,
    'template_version', 1,
    'locale', 'es-MX',
    'public_folio', v_source.public_folio,
    'occurred_on', to_char(
      v_source.created_at at time zone 'America/Mexico_City',
      'YYYY-MM-DD'
    )
  );

  if v_event_type = 'provider_intake.correction_requested' then
    v_payload := v_payload || jsonb_build_object(
      'external_message', v_source.external_message,
      'field_codes', to_jsonb(v_source.external_field_codes)
    );
  elsif v_event_type = 'provider_intake.rejected' then
    v_payload := v_payload || jsonb_build_object(
      'external_message', v_source.external_message
    );
  end if;

  if not public.notification_external_payload_valid(
    v_event_type,
    1::smallint,
    v_payload
  ) or not public.notification_external_idempotency_valid(
    v_event_type,
    v_source.payment_intake_id,
    1::smallint,
    v_key
  ) then
    raise exception 'external_notification_contract_invalid';
  end if;

  v_recipient := lower(btrim(v_source.provider_email));
  if v_recipient is null
     or v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    v_status := 'no_recipient';
    v_recipient := null;
  else
    v_recipient_hash := encode(
      extensions.digest(convert_to(v_recipient, 'UTF8'), 'sha256'),
      'hex'
    );
    if not (v_recipient_hash = any (v_rollout.recipient_allowlist_hashes)) then
      return jsonb_build_object('result', 'recipient_not_allowlisted');
    end if;
    v_status := 'pending';
  end if;

  insert into public.notification_events (
    event_type,
    source_table,
    source_id,
    source_folio,
    recipient_type,
    recipient_email,
    channel,
    priority,
    subject,
    payload,
    idempotency_key,
    status,
    attempt_count,
    max_attempts,
    next_attempt_at,
    audience,
    event_version,
    rollout_id,
    external_subject_type,
    external_subject_id,
    terminal_reason
  ) values (
    v_event_type,
    'payment_intake_events',
    v_source.id,
    v_source.public_folio,
    'external_provider',
    v_recipient,
    'email',
    'normal',
    null,
    v_payload,
    v_key,
    v_status,
    0,
    3,
    case when v_status = 'pending' then now() else null end,
    'external',
    1,
    v_rollout.id,
    'payment_intake',
    v_source.payment_intake_id,
    case when v_status = 'no_recipient' then 'no_recipient' else null end
  )
  on conflict (idempotency_key) do nothing;

  if not found then
    return jsonb_build_object('result', 'already_exists');
  end if;

  return jsonb_build_object(
    'result',
    case when v_status = 'pending' then 'enqueued' else 'no_recipient' end
  );
end
$$;

create function public.finalize_provider_intake_submission_v1(
  p_payment_intake_id uuid,
  p_expected_file_count smallint,
  p_files jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_intake record;
  v_item jsonb;
  v_file_id uuid;
  v_storage_path text;
  v_original_filename text;
  v_mime_type text;
  v_size_bytes bigint;
  v_file_kind text;
  v_sha256 text;
  v_source_event_id uuid;
  v_actual_file_count integer;
  v_notification jsonb;
begin
  if p_payment_intake_id is null
     or p_expected_file_count is null
     or p_expected_file_count not between 0 and 3
     or p_files is null
     or jsonb_typeof(p_files) <> 'array'
     or jsonb_array_length(p_files) <> p_expected_file_count then
    raise exception 'provider_intake_finalization_fields_invalid';
  end if;

  select
    pi.id,
    pi.status,
    pi.expected_file_count,
    pi.submission_completed_at,
    il.max_file_mb,
    il.allowed_file_types
    into v_intake
  from public.payment_intake pi
  join public.intake_links il on il.id = pi.intake_link_id
  where pi.id = p_payment_intake_id
  for update of pi;

  if not found or v_intake.status <> 'received' then
    raise exception 'provider_intake_not_finalizable';
  end if;

  if v_intake.submission_completed_at is not null then
    if v_intake.expected_file_count is distinct from p_expected_file_count
       or not exists (
         select 1
         from public.payment_intake_events pie
         where pie.payment_intake_id = p_payment_intake_id
           and pie.event_type = 'submission_completed'
       ) then
      raise exception 'provider_intake_finalization_conflict';
    end if;
    return jsonb_build_object(
      'completion', 'already_completed',
      'notification', 'already_exists'
    );
  end if;

  if exists (
    select 1
    from public.payment_intake_events pie
    where pie.payment_intake_id = p_payment_intake_id
      and pie.metadata ->> 'issue_code' in (
        'storage_upload_failed',
        'storage_cleanup_failed',
        'file_metadata_failed',
        'storage_unavailable'
      )
  ) then
    raise exception 'provider_intake_upload_issue_present';
  end if;

  if exists (
    select 1 from public.payment_intake_files pif
    where pif.payment_intake_id = p_payment_intake_id
  ) then
    raise exception 'provider_intake_file_metadata_conflict';
  end if;

  for v_item in select value from jsonb_array_elements(p_files) loop
    begin
      v_file_id := (v_item ->> 'file_id')::uuid;
      v_storage_path := btrim(v_item ->> 'storage_path');
      v_original_filename := btrim(v_item ->> 'original_filename');
      v_mime_type := lower(btrim(v_item ->> 'mime_type'));
      v_size_bytes := (v_item ->> 'size_bytes')::bigint;
      v_file_kind := lower(btrim(v_item ->> 'file_kind'));
      v_sha256 := lower(btrim(v_item ->> 'sha256'));
    exception when others then
      raise exception 'provider_intake_invalid_file_metadata';
    end;

    if v_storage_path !~ (
         '^' || p_payment_intake_id::text || '/' || v_file_id::text ||
         '(\.[a-z0-9]{1,10})?$'
       )
       or nullif(v_original_filename, '') is null
       or position('/' in v_original_filename) > 0
       or position(chr(92) in v_original_filename) > 0
       or v_original_filename ~ '[[:cntrl:]]'
       or not (v_mime_type = any (v_intake.allowed_file_types))
       or v_size_bytes < 1
       or v_size_bytes > (v_intake.max_file_mb::bigint * 1048576)
       or v_file_kind not in (
         'invoice_pdf', 'invoice_xml', 'bank_document', 'support', 'other'
       )
       or v_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'provider_intake_invalid_file_metadata';
    end if;

    if not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'intake-uploads'
        and o.name = v_storage_path
    ) then
      raise exception 'provider_intake_storage_object_missing';
    end if;

    insert into public.payment_intake_files (
      id, payment_intake_id, bucket_id, storage_path, original_filename,
      mime_type, size_bytes, file_kind, quarantine_status, sha256
    ) values (
      v_file_id, p_payment_intake_id, 'intake-uploads', v_storage_path,
      v_original_filename, v_mime_type, v_size_bytes, v_file_kind,
      'pending', v_sha256
    );

    insert into public.payment_intake_events (
      payment_intake_id, event_type, actor_type, from_status, to_status, metadata
    ) values (
      p_payment_intake_id, 'file_uploaded', 'public_provider', 'received',
      'received', jsonb_build_object(
        'file_id', v_file_id,
        'file_kind', v_file_kind,
        'mime_type', v_mime_type,
        'size_bytes', v_size_bytes
      )
    );
  end loop;

  select count(*)::integer
    into v_actual_file_count
  from public.payment_intake_files pif
  where pif.payment_intake_id = p_payment_intake_id;

  if v_actual_file_count <> p_expected_file_count then
    raise exception 'provider_intake_finalization_file_count_mismatch';
  end if;

  update public.payment_intake
     set expected_file_count = p_expected_file_count,
         submission_completed_at = now(),
         updated_at = now()
   where id = p_payment_intake_id;

  insert into public.payment_intake_events (
    payment_intake_id,
    event_type,
    actor_type,
    from_status,
    to_status,
    metadata
  ) values (
    p_payment_intake_id,
    'submission_completed',
    'system',
    'received',
    'received',
    jsonb_build_object(
      'contract_version', 1,
      'expected_file_count', p_expected_file_count
    )
  ) returning id into v_source_event_id;

  v_notification := public.enqueue_provider_intake_external_notification_v1(
    v_source_event_id
  );

  return jsonb_build_object(
    'completion', 'completed',
    'notification', v_notification ->> 'result'
  );
end
$$;

create function public.transition_provider_intake_external_v1(
  p_payment_intake_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_to_status text,
  p_internal_notes text,
  p_external_message text,
  p_external_field_codes text[],
  p_action_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb;
  v_actor_profile_id uuid;
  v_actor_type text;
  v_intake public.payment_intake%rowtype;
  v_internal_notes text;
  v_external_message text;
  v_field_codes text[];
  v_event_type text;
  v_event_id uuid;
  v_fingerprint text;
  v_existing record;
  v_notification jsonb;
begin
  if p_payment_intake_id is null
     or p_expected_status is null
     or p_expected_updated_at is null
     or p_to_status is null
     or p_action_id is null then
    raise exception 'provider_intake_transition_fields_required';
  end if;

  if not (
    (p_expected_status = 'in_review' and p_to_status in ('needs_correction', 'rejected'))
    or (p_expected_status = 'needs_correction' and p_to_status = 'rejected')
  ) then
    raise exception 'provider_intake_external_transition_invalid';
  end if;

  v_internal_notes := nullif(btrim(coalesce(p_internal_notes, '')), '');
  v_external_message := nullif(btrim(coalesce(p_external_message, '')), '');
  v_field_codes := coalesce(p_external_field_codes, array[]::text[]);

  if v_internal_notes is not null
     and (
       char_length(v_internal_notes) > 2000
       or v_internal_notes ~ '[[:cntrl:]]'
       or v_internal_notes ~ '<[^>]*>'
     ) then
    raise exception 'provider_intake_note_invalid';
  end if;

  if not public.notification_external_message_valid(v_external_message) then
    raise exception 'provider_intake_external_message_invalid';
  end if;
  if v_internal_notes is not null
     and lower(v_internal_notes) = lower(v_external_message) then
    raise exception 'provider_intake_external_message_matches_internal_notes';
  end if;

  if p_to_status = 'needs_correction'
     and not public.notification_external_field_codes_valid(v_field_codes) then
    raise exception 'provider_intake_external_field_codes_invalid';
  end if;
  if p_to_status = 'rejected' and cardinality(v_field_codes) <> 0 then
    raise exception 'provider_intake_rejected_field_codes_forbidden';
  end if;

  v_actor := public.provider_intake_actor_context();
  v_actor_profile_id := (v_actor ->> 'profile_id')::uuid;
  v_actor_type := v_actor ->> 'actor_type';
  v_event_type := case p_to_status
    when 'needs_correction' then 'correction_requested'
    else 'rejected'
  end;
  v_fingerprint := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'action_id', p_action_id,
        'action_kind', 'transition_external_v1',
        'contract_version', 1,
        'expected_status', p_expected_status,
        'expected_updated_at', p_expected_updated_at,
        'external_field_codes', v_field_codes,
        'external_message', v_external_message,
        'internal_notes', v_internal_notes,
        'payment_intake_id', p_payment_intake_id,
        'to_status', p_to_status
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id
  for update;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;
  perform public.provider_intake_assert_company_access(v_intake.company_id);

  select
    pie.id,
    pie.event_type,
    pie.created_at,
    pie.actor_profile_id,
    pie.metadata ->> 'action_fingerprint' as action_fingerprint,
    pie.metadata ->> 'action_kind' as action_kind,
    pie.metadata ->> 'contract_version' as contract_version,
    pie.metadata ->> 'producer_result' as producer_result
    into v_existing
  from public.payment_intake_events pie
  where pie.payment_intake_id = p_payment_intake_id
    and pie.metadata ->> 'action_id' = p_action_id::text
  limit 1;

  if found then
    if v_existing.actor_profile_id is distinct from v_actor_profile_id
       or v_existing.action_kind is distinct from 'transition_external_v1'
       or v_existing.contract_version is distinct from '1'
       or v_existing.action_fingerprint is distinct from v_fingerprint then
      raise exception 'provider_intake_action_id_material_conflict';
    end if;
    return jsonb_build_object(
      'status', v_intake.status,
      'idempotent', true,
      'notification', case
        when v_existing.event_type = 'correction_requested'
         and exists (
           select 1
           from public.payment_intake_events earlier
           where earlier.payment_intake_id = p_payment_intake_id
             and earlier.event_type = 'correction_requested'
             and earlier.id <> v_existing.id
             and (earlier.created_at, earlier.id) < (
               v_existing.created_at,
               v_existing.id
             )
         ) then 'manual_follow_up_required'
        else 'already_exists'
      end
    );
  end if;

  if v_intake.status is distinct from p_expected_status
     or v_intake.updated_at is distinct from p_expected_updated_at then
    raise exception 'provider_intake_conflict';
  end if;

  update public.payment_intake
     set status = p_to_status,
         triaged_by = coalesce(triaged_by, v_actor_profile_id),
         triaged_at = coalesce(triaged_at, now()),
         rejection_reason = case
           when p_to_status = 'rejected' then coalesce(
             v_internal_notes,
             'Rechazo comunicado al proveedor'
           )
           else null
         end,
         updated_at = now()
   where id = p_payment_intake_id
     and status = p_expected_status
     and updated_at = p_expected_updated_at
  returning * into v_intake;

  if not found then
    raise exception 'provider_intake_conflict';
  end if;

  insert into public.payment_intake_events (
    payment_intake_id,
    event_type,
    actor_profile_id,
    actor_type,
    from_status,
    to_status,
    notes,
    metadata,
    external_message,
    external_field_codes,
    external_contract_version
  ) values (
    p_payment_intake_id,
    v_event_type,
    v_actor_profile_id,
    v_actor_type,
    p_expected_status,
    p_to_status,
    v_internal_notes,
    jsonb_build_object(
      'action_id', p_action_id,
      'action_fingerprint', v_fingerprint,
      'action_kind', 'transition_external_v1',
      'contract_version', 1
    ),
    v_external_message,
    case when p_to_status = 'needs_correction' then v_field_codes else null end,
    1
  ) returning id into v_event_id;

  v_notification := public.enqueue_provider_intake_external_notification_v1(
    v_event_id
  );

  -- The append-only event cannot be edited to store the producer result. The
  -- result is deterministic from the ledger and returned only to this caller.
  return jsonb_build_object(
    'status', v_intake.status,
    'updated_at', v_intake.updated_at,
    'idempotent', false,
    'notification', v_notification ->> 'result'
  );
exception
  when unique_violation then
    select
      pie.actor_profile_id,
      pie.metadata ->> 'action_fingerprint' as action_fingerprint,
      pie.metadata ->> 'action_kind' as action_kind,
      pie.metadata ->> 'contract_version' as contract_version
      into v_existing
    from public.payment_intake_events pie
    where pie.payment_intake_id = p_payment_intake_id
      and pie.metadata ->> 'action_id' = p_action_id::text
    limit 1;
    if not found
       or v_existing.actor_profile_id is distinct from v_actor_profile_id
       or v_existing.action_kind is distinct from 'transition_external_v1'
       or v_existing.contract_version is distinct from '1'
       or v_existing.action_fingerprint is distinct from v_fingerprint then
      raise exception 'provider_intake_action_id_conflict';
    end if;
    select * into v_intake
    from public.payment_intake
    where id = p_payment_intake_id;
    return jsonb_build_object(
      'status', v_intake.status,
      'updated_at', v_intake.updated_at,
      'idempotent', true,
      'notification', 'already_exists'
    );
end
$$;

-- Keep the two internal-only transitions and close the legacy external-copy bypass.
create or replace function public.transition_provider_intake(
  p_payment_intake_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_to_status text,
  p_notes text,
  p_action_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb;
  v_actor_profile_id uuid;
  v_actor_type text;
  v_intake public.payment_intake%rowtype;
  v_notes text;
  v_action_fingerprint text;
  v_existing_event record;
begin
  if p_payment_intake_id is null
     or p_expected_status is null
     or p_expected_updated_at is null
     or p_to_status is null
     or p_action_id is null then
    raise exception 'provider_intake_transition_fields_required';
  end if;

  if p_to_status in ('needs_correction', 'rejected') then
    raise exception 'provider_intake_external_transition_requires_v1';
  end if;
  if not (
    (p_expected_status = 'received' and p_to_status = 'in_review')
    or (p_expected_status = 'needs_correction' and p_to_status = 'in_review')
  ) then
    raise exception 'provider_intake_invalid_transition';
  end if;

  v_actor := public.provider_intake_actor_context();
  v_actor_profile_id := (v_actor ->> 'profile_id')::uuid;
  v_actor_type := v_actor ->> 'actor_type';
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');
  if v_notes is not null and (
    char_length(v_notes) > 2000
    or v_notes ~ '[[:cntrl:]]'
    or v_notes ~ '<[^>]*>'
  ) then
    raise exception 'provider_intake_comment_invalid';
  end if;

  v_action_fingerprint := public.provider_intake_action_fingerprint(
    2, 'transition', p_payment_intake_id, v_actor_profile_id,
    p_expected_status, p_expected_updated_at, p_to_status, v_notes
  );

  select * into v_intake
  from public.payment_intake
  where id = p_payment_intake_id
  for update;
  if not found then raise exception 'provider_intake_not_found'; end if;
  perform public.provider_intake_assert_company_access(v_intake.company_id);

  select
    pie.actor_profile_id,
    pie.metadata ->> 'action_fingerprint' as action_fingerprint,
    pie.metadata ->> 'action_kind' as action_kind,
    pie.metadata ->> 'contract_version' as contract_version
    into v_existing_event
  from public.payment_intake_events pie
  where pie.payment_intake_id = p_payment_intake_id
    and pie.metadata ->> 'action_id' = p_action_id::text
  limit 1;

  if found then
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id
       or v_existing_event.action_kind is distinct from 'transition'
       or v_existing_event.contract_version is distinct from '2'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_action_id_material_conflict';
    end if;
    return jsonb_build_object(
      'payment_intake_id', v_intake.id,
      'public_folio', v_intake.public_folio,
      'status', v_intake.status,
      'updated_at', v_intake.updated_at,
      'idempotent', true
    );
  end if;

  if v_intake.status is distinct from p_expected_status
     or v_intake.updated_at is distinct from p_expected_updated_at then
    raise exception 'provider_intake_conflict';
  end if;

  update public.payment_intake
     set status = 'in_review',
         triaged_by = coalesce(triaged_by, v_actor_profile_id),
         triaged_at = coalesce(triaged_at, now()),
         rejection_reason = null,
         updated_at = now()
   where id = p_payment_intake_id
     and status = p_expected_status
     and updated_at = p_expected_updated_at
  returning * into v_intake;
  if not found then raise exception 'provider_intake_conflict'; end if;

  insert into public.payment_intake_events (
    payment_intake_id, event_type, actor_profile_id, actor_type,
    from_status, to_status, notes, metadata
  ) values (
    p_payment_intake_id, 'status_changed', v_actor_profile_id, v_actor_type,
    p_expected_status, 'in_review', v_notes, jsonb_build_object(
      'action_id', p_action_id,
      'action_fingerprint', v_action_fingerprint,
      'action_kind', 'transition',
      'contract_version', 2
    )
  );

  return jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'public_folio', v_intake.public_folio,
    'status', v_intake.status,
    'updated_at', v_intake.updated_at,
    'idempotent', false
  );
exception
  when unique_violation then
    raise exception 'provider_intake_action_id_conflict';
end
$$;

create table public.notification_external_dispatch_invocations (
  key_id text not null,
  invocation_id text not null,
  request_hash text not null,
  issued_at timestamptz not null,
  received_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint notification_external_dispatch_invocations_pkey
    primary key (key_id, invocation_id),
  constraint notification_external_dispatch_invocations_key_id_check check (
    key_id ~ '^[A-Za-z0-9_-]{3,64}$'
  ),
  constraint notification_external_dispatch_invocations_id_check check (
    invocation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint notification_external_dispatch_invocations_hash_check check (
    request_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint notification_external_dispatch_invocations_window_check check (
    expires_at > issued_at
    and expires_at <= issued_at + interval '10 minutes'
  )
);

alter table public.notification_external_dispatch_invocations enable row level security;
revoke all on table public.notification_external_dispatch_invocations
  from public, anon, authenticated, service_role;
grant select, insert, delete on table public.notification_external_dispatch_invocations
  to service_role;
grant all privileges on table public.notification_external_dispatch_invocations
  to postgres with grant option;

create function public.register_external_notification_dispatch_invocation(
  p_key_id text,
  p_invocation_id text,
  p_request_hash text,
  p_issued_at timestamptz
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_key_id is null or p_key_id !~ '^[A-Za-z0-9_-]{3,64}$'
     or p_invocation_id is null
     or p_invocation_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
     or p_issued_at is null
     or abs(extract(epoch from (now() - p_issued_at))) > 300 then
    raise exception 'external_invocation_contract_invalid';
  end if;

  delete from public.notification_external_dispatch_invocations
  where expires_at < now() - interval '1 hour';

  insert into public.notification_external_dispatch_invocations (
    key_id, invocation_id, request_hash, issued_at, expires_at
  ) values (
    p_key_id, p_invocation_id, p_request_hash, p_issued_at,
    p_issued_at + interval '10 minutes'
  )
  on conflict (key_id, invocation_id) do nothing;

  return case when found then 'registered' else 'replay_detected' end;
end
$$;

create function public.get_external_notification_rollout_mode()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select mode
    from public.notification_external_rollouts
    where id = 'provider-intake-v1'
  ), 'disabled')
$$;

create function public.reserve_external_notification_attempt(
  p_notification_event_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.notification_events%rowtype;
  v_attempt public.notification_delivery_attempts%rowtype;
  v_worker text := left(btrim(coalesce(p_worker_id, '')), 120);
begin
  if v_worker <> 'external-notification-dispatcher-v1' then
    raise exception 'external_worker_invalid';
  end if;

  select * into v_event
  from public.notification_events
  where id = p_notification_event_id
  for update;

  if not found
     or v_event.audience <> 'external'
     or v_event.status <> 'processing'
     or v_event.locked_by is distinct from v_worker
     or v_event.attempt_count >= 3 then
    raise exception 'external_attempt_not_reservable';
  end if;

  select * into v_attempt
  from public.notification_delivery_attempts a
  where a.notification_event_id = v_event.id
    and a.status = 'processing'
  order by a.attempt_number desc
  limit 1
  for update;

  if found then
    if v_attempt.provider_request_started_at is not null then
      raise exception 'external_attempt_manual_review_required';
    end if;
  else
    insert into public.notification_delivery_attempts (
      notification_event_id,
      attempt_number,
      status,
      worker_id,
      provider_idempotency_key
    ) values (
      v_event.id,
      v_event.attempt_count + 1,
      'processing',
      v_worker,
      v_event.idempotency_key
    ) returning * into v_attempt;

    update public.notification_events
       set attempt_count = v_attempt.attempt_number,
           updated_at = now()
     where id = v_event.id;
  end if;

  return jsonb_build_object(
    'attempt_number', v_attempt.attempt_number,
    'provider_idempotency_key', v_attempt.provider_idempotency_key
  );
end
$$;

create function public.mark_external_provider_request_started(
  p_notification_event_id uuid,
  p_attempt_number integer,
  p_worker_id text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update public.notification_delivery_attempts a
     set provider_request_started_at = coalesce(provider_request_started_at, now())
    from public.notification_events e
   where a.notification_event_id = p_notification_event_id
     and a.attempt_number = p_attempt_number
     and a.status = 'processing'
     and a.worker_id = p_worker_id
     and e.id = a.notification_event_id
     and e.audience = 'external'
     and e.status = 'processing'
     and e.locked_by = p_worker_id;
  if not found then raise exception 'external_attempt_state_conflict'; end if;
  return 'started';
end
$$;

create function public.mark_external_notification_sent(
  p_notification_event_id uuid,
  p_attempt_number integer,
  p_worker_id text,
  p_provider_message_id text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     or char_length(p_provider_message_id) > 255 then
    raise exception 'external_provider_message_id_invalid';
  end if;

  update public.notification_delivery_attempts a
     set status = 'sent',
         provider_message_id = p_provider_message_id,
         provider_request_completed_at = now(),
         error_message = null,
         safe_error_code = null
    from public.notification_events e
   where a.notification_event_id = p_notification_event_id
     and a.attempt_number = p_attempt_number
     and a.status = 'processing'
     and a.provider_request_started_at is not null
     and a.worker_id = p_worker_id
     and e.id = a.notification_event_id
     and e.audience = 'external'
     and e.status = 'processing'
     and e.locked_by = p_worker_id;
  if not found then raise exception 'external_attempt_state_conflict'; end if;

  update public.notification_events
     set status = 'sent', processed_at = now(), locked_at = null,
         locked_by = null, next_attempt_at = null, last_error = null,
         updated_at = now()
   where id = p_notification_event_id;
  return 'sent';
end
$$;

create function public.mark_external_notification_failed(
  p_notification_event_id uuid,
  p_attempt_number integer,
  p_worker_id text,
  p_safe_error_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.notification_events%rowtype;
  v_attempt_status text;
  v_event_status text;
  v_retryable boolean;
  v_manual_review boolean;
  v_circuit_breaker boolean;
begin
  if p_safe_error_code <> all (array[
    'provider_rate_limited',
    'provider_server_error',
    'provider_timeout_unknown',
    'provider_auth_failed',
    'provider_contract_rejected',
    'provider_network_unavailable',
    'provider_response_invalid',
    'renderer_contract_failed',
    'manual_review_required'
  ]::text[]) then
    raise exception 'external_safe_error_code_invalid';
  end if;

  select * into v_event
  from public.notification_events
  where id = p_notification_event_id
  for update;
  if not found or v_event.audience <> 'external'
     or v_event.status <> 'processing'
     or v_event.locked_by is distinct from p_worker_id
     or v_event.attempt_count is distinct from p_attempt_number then
    raise exception 'external_attempt_state_conflict';
  end if;

  v_manual_review := p_safe_error_code in (
    'provider_timeout_unknown', 'manual_review_required'
  );
  v_circuit_breaker := p_safe_error_code = 'provider_auth_failed';
  v_retryable := p_safe_error_code in (
    'provider_rate_limited',
    'provider_server_error',
    'provider_network_unavailable'
  ) and p_attempt_number < 3;
  v_attempt_status := case when v_retryable then 'failed' else 'dead_letter' end;
  v_event_status := case when v_retryable then 'pending' else 'dead_letter' end;

  update public.notification_delivery_attempts
     set status = v_attempt_status,
         safe_error_code = p_safe_error_code,
         error_message = p_safe_error_code,
         provider_request_completed_at = case
           when provider_request_started_at is not null then now()
           else null
         end
   where notification_event_id = p_notification_event_id
     and attempt_number = p_attempt_number
     and status = 'processing'
     and worker_id = p_worker_id;
  if not found then raise exception 'external_attempt_state_conflict'; end if;

  update public.notification_events
     set status = v_event_status,
         processed_at = case when v_retryable then null else now() end,
         locked_at = null,
         locked_by = null,
         next_attempt_at = case
           when v_retryable then now() + make_interval(mins => least(60, 5 * p_attempt_number))
           else null
         end,
         last_error = p_safe_error_code,
         updated_at = now()
   where id = p_notification_event_id;

  return jsonb_build_object(
    'result', v_event_status,
    'retryable', v_retryable,
    'manual_review_required', v_manual_review,
    'circuit_breaker_required', v_circuit_breaker
  );
end
$$;

revoke all on function public.enqueue_provider_intake_external_notification_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_provider_intake_submission_v1(uuid, smallint, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.transition_provider_intake_external_v1(
  uuid, text, timestamptz, text, text, text, text[], uuid
) from public, anon, authenticated, service_role;
revoke all on function public.register_external_notification_dispatch_invocation(
  text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.get_external_notification_rollout_mode()
  from public, anon, authenticated, service_role;
revoke all on function public.reserve_external_notification_attempt(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_external_provider_request_started(uuid, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_external_notification_sent(uuid, integer, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_external_notification_failed(uuid, integer, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.finalize_provider_intake_submission_v1(uuid, smallint, jsonb)
  to service_role;
grant execute on function public.transition_provider_intake_external_v1(
  uuid, text, timestamptz, text, text, text, text[], uuid
) to authenticated;
grant execute on function public.register_external_notification_dispatch_invocation(
  text, text, text, timestamptz
) to service_role;
grant execute on function public.get_external_notification_rollout_mode()
  to service_role;
grant execute on function public.reserve_external_notification_attempt(uuid, text)
  to service_role;
grant execute on function public.mark_external_provider_request_started(uuid, integer, text)
  to service_role;
grant execute on function public.mark_external_notification_sent(uuid, integer, text, text)
  to service_role;
grant execute on function public.mark_external_notification_failed(uuid, integer, text, text)
  to service_role;
grant execute on function public.enqueue_provider_intake_external_notification_v1(uuid)
  to postgres;

comment on table public.notification_external_dispatch_invocations is
  'HMAC replay ledger. It stores no signature, secret, request body, recipient or payload.';
comment on function public.enqueue_provider_intake_external_notification_v1(uuid) is
  'Explicit N1 producer with cutoff, event, mode and recipient allowlist gates for one supplied source event.';
comment on function public.finalize_provider_intake_submission_v1(uuid, smallint, jsonb) is
  'Service-only atomic file attachment, submission completion and conditional received producer.';
comment on function public.transition_provider_intake_external_v1(
  uuid, text, timestamptz, text, text, text, text[], uuid
) is
  'Company-scoped external-copy transition v1 with separate internal notes, provider message and canonical field codes.';

commit;
