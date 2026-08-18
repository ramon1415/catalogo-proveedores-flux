-- Provider Portal PROD forward chain T2/4: final Edge support, triage, idempotency, and matching.
-- Derived selectively from DEV c91faf703a79c02d6e9ef21a7b07ea9a0af76a91; notification producers are intentionally absent.

begin;

do $$
begin
  if public.provider_intake_runtime_mode() <> 'disabled' then
    raise exception 'provider_portal_prod_precheck: runtime must remain disabled during install';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(array[
      'attach_provider_intake_files_internal','mark_provider_intake_upload_issue_internal',
      'provider_intake_actor_context','list_provider_intakes','get_provider_intake_detail',
      'transition_provider_intake','add_provider_intake_note','find_provider_intake_candidates',
      'get_provider_intake_match_comparison','set_provider_intake_match'
    ]::text[])
  ) then
    raise exception 'provider_portal_prod_precheck: unexpected core workflow collision';
  end if;
end
$$;

alter table public.payment_intake_events drop constraint if exists payment_intake_events_event_type_check;
alter table public.payment_intake_events add constraint payment_intake_events_event_type_check check (
  event_type in ('received','status_changed','file_uploaded','file_reviewed','provider_matched',
    'correction_requested','rejected','converted','internal_note')
);

create index payment_intake_company_created_idx
  on public.payment_intake(company_id, created_at desc);
create unique index payment_intake_events_action_id_uidx
  on public.payment_intake_events(payment_intake_id, (metadata ->> 'action_id'))
  where metadata ? 'action_id';

create function public.attach_provider_intake_files_internal(
  p_payment_intake_id uuid,
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
  v_expected_prefix text;
  v_inserted integer := 0;
  v_existing_count integer;
begin
  if not public.provider_intake_public_access_allowed() then raise exception 'provider_intake_disabled'; end if;

  if p_payment_intake_id is null
     or p_files is null
     or jsonb_typeof(p_files) <> 'array'
     or jsonb_array_length(p_files) > 3 then
    raise exception 'provider_intake_invalid_files';
  end if;

  select
    pi.id,
    pi.status,
    il.max_file_mb,
    il.allowed_file_types
    into v_intake
  from public.payment_intake pi
  join public.intake_links il on il.id = pi.intake_link_id
  where pi.id = p_payment_intake_id
  for update of pi;

  if not found or v_intake.status <> 'received' then
    raise exception 'provider_intake_not_attachable';
  end if;

  select count(*)::integer
    into v_existing_count
  from public.payment_intake_files pif
  where pif.payment_intake_id = p_payment_intake_id;

  if v_existing_count + jsonb_array_length(p_files) > 3 then
    raise exception 'provider_intake_too_many_files';
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

    v_expected_prefix := p_payment_intake_id::text || '/' || v_file_id::text;

    if v_storage_path !~ ('^' || v_expected_prefix || '(\.[a-z0-9]{1,10})?$')
       or nullif(v_original_filename, '') is null
       or position('/' in v_original_filename) > 0
       or position(chr(92) in v_original_filename) > 0
       or v_original_filename ~ '[[:cntrl:]]'
       or not (v_mime_type = any (v_intake.allowed_file_types))
       or v_size_bytes < 1
       or v_size_bytes > (v_intake.max_file_mb::bigint * 1048576)
       or v_file_kind not in ('invoice_pdf', 'invoice_xml', 'bank_document', 'support', 'other')
       or v_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'provider_intake_invalid_file_metadata';
    end if;

    if exists (
      select 1
      from public.payment_intake_files pif
      where pif.storage_path = v_storage_path
        and (
          pif.payment_intake_id is distinct from p_payment_intake_id
          or pif.original_filename is distinct from v_original_filename
          or pif.mime_type is distinct from v_mime_type
          or pif.size_bytes is distinct from v_size_bytes
          or pif.file_kind is distinct from v_file_kind
          or pif.sha256 is distinct from v_sha256
        )
    ) then
      raise exception 'provider_intake_file_metadata_conflict';
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
      id,
      payment_intake_id,
      bucket_id,
      storage_path,
      original_filename,
      mime_type,
      size_bytes,
      file_kind,
      quarantine_status,
      sha256
    ) values (
      v_file_id,
      p_payment_intake_id,
      'intake-uploads',
      v_storage_path,
      v_original_filename,
      v_mime_type,
      v_size_bytes,
      v_file_kind,
      'pending',
      v_sha256
    )
    on conflict (storage_path) do nothing;

    if found then
      v_inserted := v_inserted + 1;
      insert into public.payment_intake_events (
        payment_intake_id,
        event_type,
        actor_type,
        from_status,
        to_status,
        metadata
      ) values (
        p_payment_intake_id,
        'file_uploaded',
        'public_provider',
        'received',
        'received',
        jsonb_build_object(
          'file_id', v_file_id,
          'file_kind', v_file_kind,
          'mime_type', v_mime_type,
          'size_bytes', v_size_bytes
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'payment_intake_id', p_payment_intake_id,
    'inserted_files', v_inserted,
    'total_files', v_existing_count + v_inserted
  );
end
$$;

create function public.mark_provider_intake_upload_issue_internal(
  p_payment_intake_id uuid,
  p_issue_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous_status text;
  v_issue_code text;
begin
  if not public.provider_intake_public_access_allowed() then raise exception 'provider_intake_disabled'; end if;

  v_issue_code := lower(btrim(coalesce(p_issue_code, '')));
  if v_issue_code not in (
    'storage_upload_failed',
    'storage_cleanup_failed',
    'file_metadata_failed',
    'storage_unavailable'
  ) then
    raise exception 'provider_intake_invalid_issue_code';
  end if;

  select pi.status
    into v_previous_status
  from public.payment_intake pi
  where pi.id = p_payment_intake_id
  for update;

  if not found or v_previous_status not in ('received', 'needs_correction') then
    raise exception 'provider_intake_invalid_issue_state';
  end if;

  if v_previous_status <> 'needs_correction' then
    update public.payment_intake
       set status = 'needs_correction',
           updated_at = now()
     where id = p_payment_intake_id;
  end if;

  if not exists (
    select 1
    from public.payment_intake_events pie
    where pie.payment_intake_id = p_payment_intake_id
      and pie.event_type = 'status_changed'
      and pie.metadata ->> 'issue_code' = v_issue_code
  ) then
    insert into public.payment_intake_events (
      payment_intake_id,
      event_type,
      actor_type,
      from_status,
      to_status,
      metadata
    ) values (
      p_payment_intake_id,
      'status_changed',
      'system',
      v_previous_status,
      'needs_correction',
      jsonb_build_object('issue_code', v_issue_code)
    );
  end if;

  return jsonb_build_object(
    'payment_intake_id', p_payment_intake_id,
    'status', 'needs_correction'
  );
end
$$;

create function public.provider_intake_actor_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
  v_actor_type text;
  v_global_access boolean;
begin
  perform public.provider_intake_require_internal_access();

  v_profile_id := public.current_profile_id();

  if v_profile_id is null then
    raise exception 'provider_intake_auth_required';
  end if;

  if not public.current_user_has_role(public.flux_finance_roles()) then
    raise exception 'provider_intake_access_denied';
  end if;

  v_global_access := public.current_user_has_role(public.flux_sysadmin_roles());

  if public.current_user_has_role(array['sysadmin', 'system_admin', 'superadmin']::text[]) then
    v_actor_type := 'sysadmin';
  elsif public.current_user_has_role(array['admin']::text[]) then
    v_actor_type := 'admin';
  else
    v_actor_type := 'finance';
  end if;

  return jsonb_build_object(
    'profile_id', v_profile_id,
    'actor_type', v_actor_type,
    'global_access', v_global_access
  );
end
$$;

create function public.provider_intake_assert_company_access(p_company_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb;
begin
  if p_company_id is null then
    raise exception 'provider_intake_company_required';
  end if;

  v_actor := public.provider_intake_actor_context();

  if coalesce((v_actor ->> 'global_access')::boolean, false) then
    return;
  end if;

  if not public.has_active_company_membership(
    (v_actor ->> 'profile_id')::uuid,
    p_company_id
  ) then
    raise exception 'provider_intake_company_access_denied';
  end if;
end
$$;

create function public.provider_intake_mask_value(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when nullif(btrim(p_value), '') is null then null
    when length(regexp_replace(p_value, '[^A-Za-z0-9]', '', 'g')) <= 4
      then repeat('•', greatest(length(regexp_replace(p_value, '[^A-Za-z0-9]', '', 'g')) - 1, 0))
        || right(regexp_replace(p_value, '[^A-Za-z0-9]', '', 'g'), 1)
    else repeat('•', greatest(length(regexp_replace(p_value, '[^A-Za-z0-9]', '', 'g')) - 4, 4))
      || right(regexp_replace(p_value, '[^A-Za-z0-9]', '', 'g'), 4)
  end;
$$;

create function public.list_provider_intakes(
  p_company_id uuid default null,
  p_statuses text[] default array['received', 'in_review']::text[],
  p_date_from date default null,
  p_date_to date default null,
  p_has_files boolean default null,
  p_folio text default null,
  p_provider text default null,
  p_sort_direction text default 'desc',
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb;
  v_profile_id uuid;
  v_global_access boolean;
  v_statuses text[];
  v_page integer;
  v_page_size integer;
  v_offset integer;
  v_sort_direction text;
  v_result jsonb;
begin
  v_actor := public.provider_intake_actor_context();
  v_profile_id := (v_actor ->> 'profile_id')::uuid;
  v_global_access := coalesce((v_actor ->> 'global_access')::boolean, false);
  v_page := greatest(coalesce(p_page, 1), 1);
  v_page_size := greatest(1, least(coalesce(p_page_size, 25), 100));
  v_offset := (v_page - 1) * v_page_size;
  v_sort_direction := lower(btrim(coalesce(p_sort_direction, 'desc')));

  if v_sort_direction not in ('asc', 'desc') then
    raise exception 'provider_intake_invalid_sort';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'provider_intake_invalid_date_range';
  end if;

  v_statuses := coalesce(p_statuses, array[]::text[]);
  if exists (
    select 1
    from unnest(v_statuses) status_value
    where status_value not in (
      'received', 'in_review', 'needs_correction',
      'rejected', 'converted', 'cancelled'
    )
  ) then
    raise exception 'provider_intake_invalid_status';
  end if;

  if p_company_id is not null then
    perform public.provider_intake_assert_company_access(p_company_id);
  end if;

  with accessible_companies as (
    select c.id, c.name
    from public.companies c
    where coalesce(c.active, true)
      and (
        v_global_access
        or public.has_active_company_membership(v_profile_id, c.id)
      )
  ),
  visible as (
    select
      pi.id,
      pi.public_folio,
      pi.company_id,
      c.name as company_name,
      pi.status,
      pi.provider_name,
      pi.concept,
      pi.amount_requested,
      pi.currency,
      pi.created_at,
      pi.updated_at,
      (
        select count(*)::integer
        from public.payment_intake_files pif
        where pif.payment_intake_id = pi.id
      ) as file_count
    from public.payment_intake pi
    join accessible_companies c on c.id = pi.company_id
    where (p_company_id is null or pi.company_id = p_company_id)
      and (p_date_from is null or pi.created_at >= p_date_from::timestamptz)
      and (p_date_to is null or pi.created_at < (p_date_to + 1)::timestamptz)
      and (
        nullif(btrim(coalesce(p_folio, '')), '') is null
        or pi.public_folio ilike ('%' || btrim(p_folio) || '%')
      )
      and (
        nullif(btrim(coalesce(p_provider, '')), '') is null
        or pi.provider_name ilike ('%' || btrim(p_provider) || '%')
      )
      and (
        p_has_files is null
        or p_has_files = exists (
          select 1
          from public.payment_intake_files pif
          where pif.payment_intake_id = pi.id
        )
      )
  ),
  filtered as (
    select *
    from visible
    where cardinality(v_statuses) = 0 or status = any (v_statuses)
  ),
  page_rows as (
    select
      id,
      public_folio,
      company_id,
      company_name,
      status,
      provider_name,
      concept,
      amount_requested,
      currency,
      created_at,
      updated_at,
      file_count
    from filtered
    order by
      case when v_sort_direction = 'asc' then created_at end asc,
      case when v_sort_direction = 'desc' then created_at end desc,
      id
    limit v_page_size
    offset v_offset
  )
  select jsonb_build_object(
    'items',
      coalesce((select jsonb_agg(to_jsonb(page_rows)) from page_rows), '[]'::jsonb),
    'page', v_page,
    'page_size', v_page_size,
    'total', (select count(*) from filtered),
    'summary', jsonb_build_object(
      'total', (select count(*) from visible),
      'received', (select count(*) from visible where status = 'received'),
      'in_review', (select count(*) from visible where status = 'in_review'),
      'needs_correction', (select count(*) from visible where status = 'needs_correction'),
      'rejected', (select count(*) from visible where status = 'rejected'),
      'converted', (select count(*) from visible where status = 'converted'),
      'cancelled', (select count(*) from visible where status = 'cancelled')
    ),
    'companies',
      coalesce((
        select jsonb_agg(company_row order by company_row ->> 'name')
        from (
          select jsonb_build_object(
            'id', id,
            'name', name
          ) as company_row
          from accessible_companies
        ) available_companies
      ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end
$$;

create function public.get_provider_intake_detail(p_payment_intake_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_intake public.payment_intake%rowtype;
  v_company_name text;
  v_result jsonb;
begin
  if p_payment_intake_id is null then
    raise exception 'provider_intake_id_required';
  end if;

  perform public.provider_intake_actor_context();

  select pi.*
    into v_intake
  from public.payment_intake pi
  join public.companies c on c.id = pi.company_id
  where pi.id = p_payment_intake_id;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  v_company_name := (
    select c.name
    from public.companies c
    where c.id = v_intake.company_id
  );

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  select jsonb_build_object(
    'intake', jsonb_build_object(
      'id', v_intake.id,
      'public_folio', v_intake.public_folio,
      'company_id', v_intake.company_id,
      'company_name', v_company_name,
      'status', v_intake.status,
      'provider_name', v_intake.provider_name,
      'provider_rfc', v_intake.provider_rfc,
      'provider_email', v_intake.provider_email,
      'provider_phone', v_intake.provider_phone,
      'concept', v_intake.concept,
      'description', v_intake.description,
      'amount_requested', v_intake.amount_requested,
      'currency', v_intake.currency,
      'requested_payment_date', v_intake.requested_payment_date,
      'invoice_folio', v_intake.invoice_folio,
      'invoice_uuid', v_intake.invoice_uuid,
      'invoice_date', v_intake.invoice_date,
      'bank_name', v_intake.bank_name,
      'bank_account_masked', public.provider_intake_mask_value(v_intake.bank_account),
      'bank_clabe_masked', public.provider_intake_mask_value(v_intake.bank_clabe),
      'beneficiary_name', v_intake.beneficiary_name,
      'created_at', v_intake.created_at,
      'updated_at', v_intake.updated_at
    ),
    'files', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pif.id,
          'payment_intake_id', pif.payment_intake_id,
          'original_filename', pif.original_filename,
          'mime_type', pif.mime_type,
          'size_bytes', pif.size_bytes,
          'file_kind', pif.file_kind,
          'quarantine_status', pif.quarantine_status,
          'created_at', pif.created_at
        )
        order by pif.created_at, pif.id
      )
      from public.payment_intake_files pif
      where pif.payment_intake_id = v_intake.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pie.id,
          'event_type', pie.event_type,
          'actor_type', pie.actor_type,
          'actor_name', coalesce(p.full_name, 'Sistema'),
          'from_status', pie.from_status,
          'to_status', pie.to_status,
          'notes', pie.notes,
          'created_at', pie.created_at
        )
        order by pie.created_at desc, pie.id desc
      )
      from public.payment_intake_events pie
      left join public.profiles p on p.id = pie.actor_profile_id
      where pie.payment_intake_id = v_intake.id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end
$$;

create function public.provider_intake_action_fingerprint(
  p_contract_version integer,
  p_action_kind text,
  p_payment_intake_id uuid,
  p_actor_profile_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_to_status text,
  p_notes text
)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        jsonb_build_object(
          'actor_profile_id', p_actor_profile_id::text,
          'contract_version', p_contract_version,
          'expected_status', p_expected_status,
          'expected_updated_at', case
            when p_expected_updated_at is null then null
            else pg_catalog.to_char(
              p_expected_updated_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            )
          end,
          'notes', p_notes,
          'operation', p_action_kind,
          'payment_intake_id', p_payment_intake_id::text,
          'to_status', p_to_status
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

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
  v_event_type text;
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

  v_actor := public.provider_intake_actor_context();
  v_actor_profile_id := (v_actor ->> 'profile_id')::uuid;
  v_actor_type := v_actor ->> 'actor_type';
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');
  v_action_fingerprint := public.provider_intake_action_fingerprint(
    2,
    'transition',
    p_payment_intake_id,
    v_actor_profile_id,
    p_expected_status,
    p_expected_updated_at,
    p_to_status,
    v_notes
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
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
    end if;
    if v_existing_event.action_fingerprint is null
       or v_existing_event.action_kind is null
       or v_existing_event.contract_version is null then
      raise exception 'provider_intake_action_id_legacy_conflict';
    end if;
    if v_existing_event.action_kind is distinct from 'transition'
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

  if not (
    (v_intake.status = 'received' and p_to_status = 'in_review')
    or (v_intake.status = 'in_review' and p_to_status in ('needs_correction', 'rejected'))
    or (v_intake.status = 'needs_correction' and p_to_status in ('in_review', 'rejected'))
  ) then
    raise exception 'provider_intake_invalid_transition';
  end if;

  if p_to_status in ('needs_correction', 'rejected') then
    if v_notes is null or length(v_notes) < 10 or length(v_notes) > 2000 then
      raise exception 'provider_intake_comment_length';
    end if;
    if v_notes ~ '[[:cntrl:]]' or v_notes ~ '<[^>]*>' then
      raise exception 'provider_intake_comment_invalid';
    end if;
  elsif v_notes is not null then
    if length(v_notes) > 2000 or v_notes ~ '[[:cntrl:]]' or v_notes ~ '<[^>]*>' then
      raise exception 'provider_intake_comment_invalid';
    end if;
  end if;

  v_event_type := case p_to_status
    when 'needs_correction' then 'correction_requested'
    when 'rejected' then 'rejected'
    else 'status_changed'
  end;

  update public.payment_intake
     set status = p_to_status,
         triaged_by = coalesce(triaged_by, v_actor_profile_id),
         triaged_at = coalesce(triaged_at, now()),
         rejection_reason = case when p_to_status = 'rejected' then v_notes else null end,
         updated_at = now()
   where id = v_intake.id
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
    metadata
  ) values (
    v_intake.id,
    v_event_type,
    v_actor_profile_id,
    v_actor_type,
    p_expected_status,
    p_to_status,
    v_notes,
    jsonb_build_object(
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
    select
      pie.id,
      pie.actor_profile_id,
      pie.metadata ->> 'action_fingerprint' as action_fingerprint,
      pie.metadata ->> 'action_kind' as action_kind,
      pie.metadata ->> 'contract_version' as contract_version
      into v_existing_event
    from public.payment_intake_events pie
    where pie.payment_intake_id = p_payment_intake_id
      and pie.metadata ->> 'action_id' = p_action_id::text
    limit 1;

    if not found then
      raise;
    end if;
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
    end if;
    if v_existing_event.action_fingerprint is null
       or v_existing_event.action_kind is null
       or v_existing_event.contract_version is null then
      raise exception 'provider_intake_action_id_legacy_conflict';
    end if;
    if v_existing_event.action_kind is distinct from 'transition'
       or v_existing_event.contract_version is distinct from '2'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_action_id_material_conflict';
    end if;

    select *
      into v_intake
    from public.payment_intake
    where id = p_payment_intake_id;

    return jsonb_build_object(
      'payment_intake_id', v_intake.id,
      'public_folio', v_intake.public_folio,
      'status', v_intake.status,
      'updated_at', v_intake.updated_at,
      'idempotent', true
    );
end
$$;

create or replace function public.add_provider_intake_note(
  p_payment_intake_id uuid,
  p_expected_updated_at timestamptz,
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
  v_event_id uuid;
  v_existing_event record;
begin
  if p_payment_intake_id is null
     or p_expected_updated_at is null
     or p_action_id is null then
    raise exception 'provider_intake_note_fields_required';
  end if;

  v_actor := public.provider_intake_actor_context();
  v_actor_profile_id := (v_actor ->> 'profile_id')::uuid;
  v_actor_type := v_actor ->> 'actor_type';
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');

  if v_notes is null or length(v_notes) < 3 or length(v_notes) > 2000 then
    raise exception 'provider_intake_note_length';
  end if;
  if v_notes ~ '[[:cntrl:]]' or v_notes ~ '<[^>]*>' then
    raise exception 'provider_intake_note_invalid';
  end if;

  v_action_fingerprint := public.provider_intake_action_fingerprint(
    2,
    'internal_note',
    p_payment_intake_id,
    v_actor_profile_id,
    null,
    p_expected_updated_at,
    null,
    v_notes
  );

  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id
  for share;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  select
    pie.id,
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
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
    end if;
    if v_existing_event.action_fingerprint is null
       or v_existing_event.action_kind is null
       or v_existing_event.contract_version is null then
      raise exception 'provider_intake_action_id_legacy_conflict';
    end if;
    if v_existing_event.action_kind is distinct from 'internal_note'
       or v_existing_event.contract_version is distinct from '2'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_action_id_material_conflict';
    end if;
    return jsonb_build_object(
      'payment_intake_id', v_intake.id,
      'event_id', v_existing_event.id,
      'idempotent', true
    );
  end if;

  if v_intake.updated_at is distinct from p_expected_updated_at then
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
    metadata
  ) values (
    v_intake.id,
    'internal_note',
    v_actor_profile_id,
    v_actor_type,
    v_intake.status,
    v_intake.status,
    v_notes,
    jsonb_build_object(
      'action_id', p_action_id,
      'action_fingerprint', v_action_fingerprint,
      'action_kind', 'internal_note',
      'contract_version', 2
    )
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'event_id', v_event_id,
    'idempotent', false
  );
exception
  when unique_violation then
    select
      pie.id,
      pie.actor_profile_id,
      pie.metadata ->> 'action_fingerprint' as action_fingerprint,
      pie.metadata ->> 'action_kind' as action_kind,
      pie.metadata ->> 'contract_version' as contract_version
      into v_existing_event
    from public.payment_intake_events pie
    where pie.payment_intake_id = p_payment_intake_id
      and pie.metadata ->> 'action_id' = p_action_id::text
    limit 1;

    if not found then
      raise;
    end if;
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
    end if;
    if v_existing_event.action_fingerprint is null
       or v_existing_event.action_kind is null
       or v_existing_event.contract_version is null then
      raise exception 'provider_intake_action_id_legacy_conflict';
    end if;
    if v_existing_event.action_kind is distinct from 'internal_note'
       or v_existing_event.contract_version is distinct from '2'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_action_id_material_conflict';
    end if;

    return jsonb_build_object(
      'payment_intake_id', p_payment_intake_id,
      'event_id', v_existing_event.id,
      'idempotent', true
    );
end
$$;

create function public.normalize_provider_match_text(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select nullif(
    regexp_replace(
      regexp_replace(upper(btrim(coalesce(p_value, ''))), '[^[:alnum:]&Ñ]+', ' ', 'g'),
      '[[:space:]]+',
      ' ',
      'g'
    ),
    ''
  );
$$;

create function public.normalize_provider_match_digits(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select nullif(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g'), '');
$$;

create function public.provider_intake_match_fingerprint(
  p_contract_version integer,
  p_action_kind text,
  p_payment_intake_id uuid,
  p_actor_profile_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_expected_current_match uuid,
  p_new_match uuid,
  p_reason_code text,
  p_reason text
)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        jsonb_build_object(
          'actor_profile_id', p_actor_profile_id::text,
          'contract_version', p_contract_version,
          'expected_current_match', p_expected_current_match::text,
          'expected_status', p_expected_status,
          'expected_updated_at', case
            when p_expected_updated_at is null then null
            else pg_catalog.to_char(
              p_expected_updated_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            )
          end,
          'new_match', p_new_match::text,
          'operation', p_action_kind,
          'payment_intake_id', p_payment_intake_id::text,
          'reason', p_reason,
          'reason_code', p_reason_code
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create function public.find_provider_intake_candidates(
  p_payment_intake_id uuid,
  p_search text default null,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_intake public.payment_intake%rowtype;
  v_search text;
  v_limit integer;
  v_result jsonb;
begin
  if p_payment_intake_id is null then
    raise exception 'provider_intake_id_required';
  end if;

  perform public.provider_intake_actor_context();

  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  v_search := public.normalize_provider_match_text(p_search);
  if v_search is not null and length(v_search) < 2 then
    raise exception 'provider_intake_search_too_short';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 12), 1), 25);

  with
  intake_values as (
    select
      public.normalize_provider_match_text(v_intake.provider_name) as provider_name,
      nullif(upper(regexp_replace(coalesce(v_intake.provider_rfc, ''), '[[:space:]-]+', '', 'g')), '') as rfc,
      public.normalize_provider_match_text(v_intake.bank_name) as bank_name,
      public.normalize_provider_match_digits(v_intake.bank_account) as bank_account,
      public.normalize_provider_match_digits(v_intake.bank_clabe) as bank_clabe,
      lower(nullif(btrim(coalesce(v_intake.provider_email, '')), '')) as email,
      public.normalize_provider_match_digits(v_intake.provider_phone) as phone
  ),
  provider_values as (
    select
      p.*,
      public.normalize_provider_match_text(p.nombre_completo) as legal_name,
      public.normalize_provider_match_text(p.alias) as alias_name,
      nullif(upper(regexp_replace(coalesce(p.rfc, ''), '[[:space:]-]+', '', 'g')), '') as normalized_rfc,
      public.normalize_provider_match_text(p.banco) as normalized_bank,
      public.normalize_provider_match_digits(p.cuenta_bancaria) as normalized_account,
      public.normalize_provider_match_digits(p.clabe) as normalized_clabe,
      lower(nullif(btrim(coalesce(p.email, '')), '')) as normalized_email,
      public.normalize_provider_match_digits(p.telefono) as normalized_phone
    from public.proveedores p
  ),
  signals as (
    select
      pv.*,
      iv.provider_name as intake_provider_name,
      iv.rfc as intake_rfc,
      iv.bank_name as intake_bank_name,
      iv.bank_account as intake_bank_account,
      iv.bank_clabe as intake_bank_clabe,
      iv.email as intake_email,
      iv.phone as intake_phone,
      (iv.rfc is not null and pv.normalized_rfc = iv.rfc) as rfc_exact,
      (iv.bank_clabe is not null and pv.normalized_clabe = iv.bank_clabe) as clabe_exact,
      (
        iv.bank_account is not null
        and pv.normalized_account = iv.bank_account
        and (
          iv.bank_name is null
          or pv.normalized_bank is null
          or pv.normalized_bank = iv.bank_name
        )
      ) as account_exact,
      (
        iv.provider_name is not null
        and pv.legal_name = iv.provider_name
      ) as legal_exact,
      (
        iv.provider_name is not null
        and length(iv.provider_name) >= 4
        and pv.legal_name is not null
        and (
          pv.legal_name like iv.provider_name || '%'
          or iv.provider_name like pv.legal_name || '%'
        )
      ) as legal_prefix,
      (
        iv.provider_name is not null
        and pv.alias_name = iv.provider_name
      ) as alias_exact,
      (
        iv.provider_name is not null
        and length(iv.provider_name) >= 4
        and pv.alias_name is not null
        and (
          pv.alias_name like iv.provider_name || '%'
          or iv.provider_name like pv.alias_name || '%'
        )
      ) as alias_prefix,
      (
        iv.email is not null
        and pv.normalized_email = iv.email
      ) as email_exact,
      (
        iv.phone is not null
        and length(iv.phone) >= 7
        and pv.normalized_phone = iv.phone
      ) as phone_exact,
      (
        v_search is not null
        and (
          pv.legal_name like v_search || '%'
          or pv.alias_name like v_search || '%'
          or pv.normalized_rfc like replace(v_search, ' ', '') || '%'
        )
      ) as manual_search_match
    from provider_values pv
    cross join intake_values iv
  ),
  scored as (
    select
      s.*,
      least(
        100,
        (case when rfc_exact then 70 else 0 end)
        + (case when clabe_exact then 45 else 0 end)
        + (case when account_exact then 30 else 0 end)
        + (case when legal_exact then 25 when legal_prefix then 12 else 0 end)
        + (case when alias_exact then 15 when alias_prefix then 8 else 0 end)
        + (case when email_exact then 5 else 0 end)
        + (case when phone_exact then 5 else 0 end)
      )::integer as score
    from signals s
    where
      rfc_exact or clabe_exact or account_exact or legal_exact or legal_prefix
      or alias_exact or alias_prefix or email_exact or phone_exact or manual_search_match
  ),
  eligible_candidates as (
    select *
    from scored
    where coalesce(activo, true)
       or rfc_exact
       or clabe_exact
       or account_exact
    order by coalesce(activo, true) desc, score desc, alias, id
    limit v_limit
  )
  select jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'status', v_intake.status,
    'updated_at', v_intake.updated_at,
    'eligible', (
      v_intake.status = 'in_review'
      and v_intake.created_payment_request_id is null
    ),
    'current_match', (
      select case when p.id is null then null else jsonb_build_object(
        'proveedor_id', p.id,
        'alias', p.alias,
        'legal_name', coalesce(p.nombre_completo, p.beneficiary_name),
        'rfc', p.rfc,
        'payment_method', p.metodo_pago::text,
        'bank', p.banco,
        'account_masked', public.provider_intake_mask_value(p.cuenta_bancaria),
        'clabe_masked', public.provider_intake_mask_value(p.clabe),
        'active', coalesce(p.activo, true)
      ) end
      from (select 1) seed
      left join public.proveedores p on p.id = v_intake.matched_proveedor_id
    ),
    'duplicate_rfc_count', (
      select count(*)
      from public.proveedores p
      cross join intake_values iv
      where iv.rfc is not null
        and nullif(upper(regexp_replace(coalesce(p.rfc, ''), '[[:space:]-]+', '', 'g')), '') = iv.rfc
    ),
    'candidates', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'proveedor_id', c.id,
          'alias', c.alias,
          'legal_name', coalesce(c.nombre_completo, c.beneficiary_name),
          'rfc', c.rfc,
          'payment_method', c.metodo_pago::text,
          'bank', c.banco,
          'account_masked', public.provider_intake_mask_value(c.cuenta_bancaria),
          'clabe_masked', public.provider_intake_mask_value(c.clabe),
          'active', coalesce(c.activo, true),
          'selectable', coalesce(c.activo, true),
          'score', c.score,
          'confidence', case
            when c.score >= 70 then 'high'
            when c.score >= 40 then 'medium'
            else 'low'
          end,
          'reasons', to_jsonb(array_remove(array[
            case when c.rfc_exact then 'RFC exacto' end,
            case when c.clabe_exact then 'CLABE exacta' end,
            case when c.account_exact then 'Cuenta bancaria exacta' end,
            case when c.legal_exact then 'Razón social exacta'
                 when c.legal_prefix then 'Prefijo de razón social' end,
            case when c.alias_exact then 'Alias exacto'
                 when c.alias_prefix then 'Prefijo de alias' end,
            case when c.email_exact then 'Correo coincide' end,
            case when c.phone_exact then 'Teléfono coincide' end,
            case when c.manual_search_match
                      and not (
                        c.rfc_exact or c.clabe_exact or c.account_exact or c.legal_exact
                        or c.legal_prefix or c.alias_exact or c.alias_prefix
                        or c.email_exact or c.phone_exact
                      )
                 then 'Coincide con la búsqueda manual' end
          ]::text[], null)),
          'differences', to_jsonb(array_remove(array[
            case when c.intake_provider_name is not null and c.legal_name is not null
                       and c.intake_provider_name <> c.legal_name
                 then 'Razón social distinta' end,
            case when c.intake_rfc is not null and c.normalized_rfc is not null
                       and c.intake_rfc <> c.normalized_rfc
                 then 'RFC distinto' end,
            case when c.intake_bank_name is not null and c.normalized_bank is not null
                       and c.intake_bank_name <> c.normalized_bank
                 then 'Banco distinto' end,
            case when c.intake_email is not null and c.normalized_email is not null
                       and c.intake_email <> c.normalized_email
                 then 'Correo distinto' end,
            case when c.intake_phone is not null and c.normalized_phone is not null
                       and c.intake_phone <> c.normalized_phone
                 then 'Teléfono distinto' end
          ]::text[], null))
        )
        order by coalesce(c.activo, true) desc, c.score desc, c.alias, c.id
      )
      from eligible_candidates c
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'event_id', pie.id,
          'action_kind', pie.metadata ->> 'action_kind',
          'previous_provider', previous_provider.alias,
          'new_provider', new_provider.alias,
          'match_confidence', pie.metadata ->> 'match_confidence',
          'reason_code', pie.metadata ->> 'reason_code',
          'reason', pie.notes,
          'actor_type', pie.actor_type,
          'created_at', pie.created_at
        )
        order by pie.created_at desc, pie.id desc
      )
      from public.payment_intake_events pie
      left join public.proveedores previous_provider
        on previous_provider.id = nullif(pie.metadata ->> 'previous_proveedor_id', '')::uuid
      left join public.proveedores new_provider
        on new_provider.id = nullif(pie.metadata ->> 'new_proveedor_id', '')::uuid
      where pie.payment_intake_id = v_intake.id
        and pie.event_type = 'provider_matched'
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end
$$;

create function public.get_provider_intake_match_comparison(
  p_payment_intake_id uuid,
  p_proveedor_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_intake public.payment_intake%rowtype;
  v_provider public.proveedores%rowtype;
begin
  if p_payment_intake_id is null or p_proveedor_id is null then
    raise exception 'provider_intake_comparison_fields_required';
  end if;

  perform public.provider_intake_actor_context();

  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  select *
    into v_provider
  from public.proveedores
  where id = p_proveedor_id;

  if not found then
    raise exception 'provider_intake_provider_not_found';
  end if;

  return jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'status', v_intake.status,
    'updated_at', v_intake.updated_at,
    'eligible', (
      v_intake.status = 'in_review'
      and v_intake.created_payment_request_id is null
      and coalesce(v_provider.activo, true)
    ),
    'proveedor_id', v_provider.id,
    'provider_alias', v_provider.alias,
    'provider_active', coalesce(v_provider.activo, true),
    'rows', jsonb_build_array(
      jsonb_build_object(
        'field', 'Razón social',
        'declared', v_intake.provider_name,
        'master', coalesce(v_provider.nombre_completo, v_provider.beneficiary_name, v_provider.alias),
        'result', case
          when nullif(btrim(v_intake.provider_name), '') is null
            or nullif(btrim(coalesce(v_provider.nombre_completo, v_provider.beneficiary_name, v_provider.alias)), '') is null
            then 'not_reported'
          when public.normalize_provider_match_text(v_intake.provider_name)
            = public.normalize_provider_match_text(coalesce(v_provider.nombre_completo, v_provider.beneficiary_name, v_provider.alias))
            then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'RFC',
        'declared', v_intake.provider_rfc,
        'master', v_provider.rfc,
        'result', case
          when v_intake.provider_rfc is null or v_provider.rfc is null then 'not_reported'
          when upper(regexp_replace(v_intake.provider_rfc, '[[:space:]-]+', '', 'g'))
            = upper(regexp_replace(v_provider.rfc, '[[:space:]-]+', '', 'g')) then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'Banco',
        'declared', v_intake.bank_name,
        'master', v_provider.banco,
        'result', case
          when v_intake.bank_name is null or v_provider.banco is null then 'not_reported'
          when public.normalize_provider_match_text(v_intake.bank_name)
            = public.normalize_provider_match_text(v_provider.banco) then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'Cuenta',
        'declared', public.provider_intake_mask_value(v_intake.bank_account),
        'master', public.provider_intake_mask_value(v_provider.cuenta_bancaria),
        'result', case
          when v_intake.bank_account is null or v_provider.cuenta_bancaria is null then 'not_reported'
          when public.normalize_provider_match_digits(v_intake.bank_account)
            = public.normalize_provider_match_digits(v_provider.cuenta_bancaria) then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'CLABE',
        'declared', public.provider_intake_mask_value(v_intake.bank_clabe),
        'master', public.provider_intake_mask_value(v_provider.clabe),
        'result', case
          when v_intake.bank_clabe is null or v_provider.clabe is null then 'not_reported'
          when public.normalize_provider_match_digits(v_intake.bank_clabe)
            = public.normalize_provider_match_digits(v_provider.clabe) then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'Beneficiario',
        'declared', v_intake.beneficiary_name,
        'master', v_provider.beneficiary_name,
        'result', case
          when v_intake.beneficiary_name is null or v_provider.beneficiary_name is null then 'not_reported'
          when public.normalize_provider_match_text(v_intake.beneficiary_name)
            = public.normalize_provider_match_text(v_provider.beneficiary_name) then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'Correo',
        'declared', v_intake.provider_email,
        'master', v_provider.email,
        'result', case
          when v_intake.provider_email is null or v_provider.email is null then 'not_reported'
          when lower(btrim(v_intake.provider_email)) = lower(btrim(v_provider.email)) then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'Teléfono',
        'declared', v_intake.provider_phone,
        'master', v_provider.telefono,
        'result', case
          when v_intake.provider_phone is null or v_provider.telefono is null then 'not_reported'
          when public.normalize_provider_match_digits(v_intake.provider_phone)
            = public.normalize_provider_match_digits(v_provider.telefono) then 'match'
          else 'different'
        end
      )
    )
  );
end
$$;

create function public.set_provider_intake_match(
  p_payment_intake_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_expected_current_match uuid,
  p_proveedor_id uuid,
  p_reason text,
  p_reason_code text,
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
  v_provider public.proveedores%rowtype;
  v_reason text;
  v_reason_code text;
  v_action_kind text;
  v_action_fingerprint text;
  v_score integer := 0;
  v_confidence text := 'none';
  v_existing_event record;
begin
  if p_payment_intake_id is null
     or p_expected_status is null
     or p_expected_updated_at is null
     or p_reason_code is null
     or p_action_id is null then
    raise exception 'provider_intake_match_fields_required';
  end if;

  v_actor := public.provider_intake_actor_context();
  v_actor_profile_id := (v_actor ->> 'profile_id')::uuid;
  v_actor_type := v_actor ->> 'actor_type';
  v_reason := nullif(regexp_replace(btrim(coalesce(p_reason, '')), '[[:space:]]+', ' ', 'g'), '');
  v_reason_code := lower(btrim(p_reason_code));

  if p_expected_current_match is null and p_proveedor_id is not null then
    v_action_kind := 'match_set';
  elsif p_expected_current_match is not null and p_proveedor_id is null then
    v_action_kind := 'match_clear';
  elsif p_expected_current_match is not null
        and p_proveedor_id is not null
        and p_expected_current_match is distinct from p_proveedor_id then
    v_action_kind := 'match_replace';
  else
    raise exception 'provider_intake_match_unchanged';
  end if;

  if v_reason_code not in (
    'candidate_selected',
    'manual_search',
    'duplicate_resolution',
    'match_corrected',
    'no_longer_matches',
    'other'
  ) then
    raise exception 'provider_intake_match_reason_code_invalid';
  end if;

  if v_action_kind in ('match_replace', 'match_clear')
     and (v_reason is null or length(v_reason) < 10 or length(v_reason) > 500) then
    raise exception 'provider_intake_match_reason_required';
  end if;
  if v_reason is not null and (
    length(v_reason) > 500
    or v_reason ~ '[[:cntrl:]]'
    or v_reason ~ '<[^>]*>'
    or v_reason ~ '@'
    or v_reason ~ '[0-9]{8,}'
    or upper(v_reason) ~ '[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}'
  ) then
    raise exception 'provider_intake_match_reason_sensitive';
  end if;

  v_action_fingerprint := public.provider_intake_match_fingerprint(
    3,
    v_action_kind,
    p_payment_intake_id,
    v_actor_profile_id,
    p_expected_status,
    p_expected_updated_at,
    p_expected_current_match,
    p_proveedor_id,
    v_reason_code,
    v_reason
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
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
    end if;
    if v_existing_event.action_fingerprint is null
       or v_existing_event.action_kind is null
       or v_existing_event.contract_version is null then
      raise exception 'provider_intake_action_id_legacy_conflict';
    end if;
    if v_existing_event.action_kind is distinct from v_action_kind
       or v_existing_event.contract_version is distinct from '3'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_action_id_material_conflict';
    end if;
    return jsonb_build_object(
      'payment_intake_id', v_intake.id,
      'status', v_intake.status,
      'matched_proveedor_id', v_intake.matched_proveedor_id,
      'updated_at', v_intake.updated_at,
      'action_kind', v_action_kind,
      'idempotent', true
    );
  end if;

  if v_intake.status is distinct from p_expected_status
     or v_intake.updated_at is distinct from p_expected_updated_at
     or v_intake.matched_proveedor_id is distinct from p_expected_current_match then
    raise exception 'provider_intake_conflict';
  end if;

  if v_intake.status <> 'in_review' then
    raise exception 'provider_intake_match_status_invalid';
  end if;
  if v_intake.created_payment_request_id is not null then
    raise exception 'provider_intake_match_converted';
  end if;

  if p_proveedor_id is not null then
    select *
      into v_provider
    from public.proveedores
    where id = p_proveedor_id;

    if not found then
      raise exception 'provider_intake_provider_not_found';
    end if;
    if not coalesce(v_provider.activo, true) then
      raise exception 'provider_intake_provider_inactive';
    end if;

    v_score := least(
      100,
      (case when nullif(v_intake.provider_rfc, '') is not null
                   and upper(regexp_replace(v_intake.provider_rfc, '[[:space:]-]+', '', 'g'))
                     = upper(regexp_replace(coalesce(v_provider.rfc, ''), '[[:space:]-]+', '', 'g'))
             then 70 else 0 end)
      + (case when public.normalize_provider_match_digits(v_intake.bank_clabe) is not null
                   and public.normalize_provider_match_digits(v_intake.bank_clabe)
                     = public.normalize_provider_match_digits(v_provider.clabe)
              then 45 else 0 end)
      + (case when public.normalize_provider_match_digits(v_intake.bank_account) is not null
                   and public.normalize_provider_match_digits(v_intake.bank_account)
                     = public.normalize_provider_match_digits(v_provider.cuenta_bancaria)
              then 30 else 0 end)
      + (case
          when public.normalize_provider_match_text(v_intake.provider_name)
            = public.normalize_provider_match_text(v_provider.nombre_completo) then 25
          when length(public.normalize_provider_match_text(v_intake.provider_name)) >= 4
               and (
                 public.normalize_provider_match_text(v_provider.nombre_completo)
                   like public.normalize_provider_match_text(v_intake.provider_name) || '%'
                 or public.normalize_provider_match_text(v_intake.provider_name)
                   like public.normalize_provider_match_text(v_provider.nombre_completo) || '%'
               ) then 12
          else 0
        end)
      + (case
          when public.normalize_provider_match_text(v_intake.provider_name)
            = public.normalize_provider_match_text(v_provider.alias) then 15
          when length(public.normalize_provider_match_text(v_intake.provider_name)) >= 4
               and (
                 public.normalize_provider_match_text(v_provider.alias)
                   like public.normalize_provider_match_text(v_intake.provider_name) || '%'
                 or public.normalize_provider_match_text(v_intake.provider_name)
                   like public.normalize_provider_match_text(v_provider.alias) || '%'
               ) then 8
          else 0
        end)
      + (case when lower(btrim(v_intake.provider_email)) = lower(btrim(coalesce(v_provider.email, '')))
              then 5 else 0 end)
      + (case when length(public.normalize_provider_match_digits(v_intake.provider_phone)) >= 7
                   and public.normalize_provider_match_digits(v_intake.provider_phone)
                     = public.normalize_provider_match_digits(v_provider.telefono)
              then 5 else 0 end)
    );
    v_confidence := case
      when v_score >= 70 then 'high'
      when v_score >= 40 then 'medium'
      else 'low'
    end;
  end if;

  update public.payment_intake
     set matched_proveedor_id = p_proveedor_id,
         updated_at = now()
   where id = v_intake.id
     and status = p_expected_status
     and updated_at = p_expected_updated_at
     and matched_proveedor_id is not distinct from p_expected_current_match
     and created_payment_request_id is null
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
    metadata
  ) values (
    v_intake.id,
    'provider_matched',
    v_actor_profile_id,
    v_actor_type,
    v_intake.status,
    v_intake.status,
    v_reason,
    jsonb_build_object(
      'action_id', p_action_id,
      'action_fingerprint', v_action_fingerprint,
      'action_kind', v_action_kind,
      'contract_version', 3,
      'previous_match_present', p_expected_current_match is not null,
      'new_match_present', p_proveedor_id is not null,
      'previous_proveedor_id', p_expected_current_match,
      'new_proveedor_id', p_proveedor_id,
      'match_confidence', v_confidence,
      'match_score', v_score,
      'reason_code', v_reason_code
    )
  );

  return jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'status', v_intake.status,
    'matched_proveedor_id', v_intake.matched_proveedor_id,
    'updated_at', v_intake.updated_at,
    'action_kind', v_action_kind,
    'match_confidence', v_confidence,
    'match_score', v_score,
    'idempotent', false
  );
exception
  when unique_violation then
    select
      pie.id,
      pie.actor_profile_id,
      pie.metadata ->> 'action_fingerprint' as action_fingerprint,
      pie.metadata ->> 'action_kind' as action_kind,
      pie.metadata ->> 'contract_version' as contract_version
      into v_existing_event
    from public.payment_intake_events pie
    where pie.payment_intake_id = p_payment_intake_id
      and pie.metadata ->> 'action_id' = p_action_id::text
    limit 1;

    if not found then
      raise;
    end if;
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
    end if;
    if v_existing_event.action_fingerprint is null
       or v_existing_event.action_kind is null
       or v_existing_event.contract_version is null then
      raise exception 'provider_intake_action_id_legacy_conflict';
    end if;
    if v_existing_event.action_kind is distinct from v_action_kind
       or v_existing_event.contract_version is distinct from '3'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_action_id_material_conflict';
    end if;

    select *
      into v_intake
    from public.payment_intake
    where id = p_payment_intake_id;

    return jsonb_build_object(
      'payment_intake_id', v_intake.id,
      'status', v_intake.status,
      'matched_proveedor_id', v_intake.matched_proveedor_id,
      'updated_at', v_intake.updated_at,
      'action_kind', v_action_kind,
      'idempotent', true
    );
end
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(array[
      'attach_provider_intake_files_internal','mark_provider_intake_upload_issue_internal',
      'provider_intake_actor_context','provider_intake_assert_company_access','provider_intake_mask_value',
      'list_provider_intakes','get_provider_intake_detail','provider_intake_action_fingerprint',
      'transition_provider_intake','add_provider_intake_note','normalize_provider_match_text',
      'normalize_provider_match_digits','provider_intake_match_fingerprint','find_provider_intake_candidates',
      'get_provider_intake_match_comparison','set_provider_intake_match'
    ]::text[])
  loop execute format('revoke all on function %s from public, anon, authenticated, service_role', r.signature); end loop;
end
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(array[
      'list_provider_intakes','get_provider_intake_detail','transition_provider_intake','add_provider_intake_note',
      'find_provider_intake_candidates','get_provider_intake_match_comparison','set_provider_intake_match'
    ]::text[])
  loop execute format('grant execute on function %s to authenticated', r.signature); end loop;
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(array['attach_provider_intake_files_internal','mark_provider_intake_upload_issue_internal']::text[])
  loop execute format('grant execute on function %s to service_role', r.signature); end loop;
end
$$;

commit;
