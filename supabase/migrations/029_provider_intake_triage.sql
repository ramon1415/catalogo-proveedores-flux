-- Flux Operadora - Migration 029
-- Internal, company-scoped provider-intake triage contract.
-- This migration does not convert intakes, create providers, or create payment requests.

begin;

do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.payment_intake') is null then
    v_missing := array_append(v_missing, 'public.payment_intake');
  end if;
  if to_regclass('public.payment_intake_files') is null then
    v_missing := array_append(v_missing, 'public.payment_intake_files');
  end if;
  if to_regclass('public.payment_intake_events') is null then
    v_missing := array_append(v_missing, 'public.payment_intake_events');
  end if;
  if to_regclass('public.companies') is null then
    v_missing := array_append(v_missing, 'public.companies');
  end if;
  if to_regclass('public.profiles') is null then
    v_missing := array_append(v_missing, 'public.profiles');
  end if;
  if to_regprocedure('public.current_profile_id()') is null then
    v_missing := array_append(v_missing, 'public.current_profile_id()');
  end if;
  if to_regprocedure('public.current_user_has_role(text[])') is null then
    v_missing := array_append(v_missing, 'public.current_user_has_role(text[])');
  end if;
  if to_regprocedure('public.flux_sysadmin_roles()') is null then
    v_missing := array_append(v_missing, 'public.flux_sysadmin_roles()');
  end if;
  if to_regprocedure('public.flux_finance_roles()') is null then
    v_missing := array_append(v_missing, 'public.flux_finance_roles()');
  end if;
  if to_regprocedure('public.has_active_company_membership(uuid,uuid)') is null then
    v_missing := array_append(v_missing, 'public.has_active_company_membership(uuid,uuid)');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception '029_precheck: missing required objects: %', array_to_string(v_missing, ', ');
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'provider_intake_actor_context',
        'provider_intake_assert_company_access',
        'provider_intake_mask_value',
        'list_provider_intakes',
        'get_provider_intake_detail',
        'transition_provider_intake',
        'add_provider_intake_note'
      ]::text[])
  ) then
    raise exception '029_precheck: one or more triage functions already exist';
  end if;

  if exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = any (array[
        'payment_intake_company_created_idx',
        'payment_intake_events_action_id_uidx'
      ]::text[])
  ) then
    raise exception '029_precheck: one or more triage indexes already exist';
  end if;
end
$$;

alter table public.payment_intake_events
  drop constraint payment_intake_events_event_type_check;

alter table public.payment_intake_events
  add constraint payment_intake_events_event_type_check check (
    event_type in (
      'received',
      'status_changed',
      'file_uploaded',
      'file_reviewed',
      'provider_matched',
      'correction_requested',
      'rejected',
      'converted',
      'internal_note'
    )
  );

create index payment_intake_company_created_idx
  on public.payment_intake(company_id, created_at desc);

create unique index payment_intake_events_action_id_uidx
  on public.payment_intake_events(
    payment_intake_id,
    (metadata ->> 'action_id')
  )
  where metadata ? 'action_id';

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

create function public.transition_provider_intake(
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

  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id
  for update;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  select pie.id, pie.actor_profile_id
    into v_existing_event
  from public.payment_intake_events pie
  where pie.payment_intake_id = p_payment_intake_id
    and pie.metadata ->> 'action_id' = p_action_id::text
  limit 1;

  if found then
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
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
      'contract_version', 1
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
    if exists (
      select 1
      from public.payment_intake_events pie
      where pie.payment_intake_id = p_payment_intake_id
        and pie.actor_profile_id = v_actor_profile_id
        and pie.metadata ->> 'action_id' = p_action_id::text
    ) then
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
    end if;
    raise;
end
$$;

create function public.add_provider_intake_note(
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

  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id
  for share;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  select pie.id, pie.actor_profile_id
    into v_existing_event
  from public.payment_intake_events pie
  where pie.payment_intake_id = p_payment_intake_id
    and pie.metadata ->> 'action_id' = p_action_id::text
  limit 1;

  if found then
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
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
      'contract_version', 1
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
    select pie.id
      into v_event_id
    from public.payment_intake_events pie
    where pie.payment_intake_id = p_payment_intake_id
      and pie.actor_profile_id = v_actor_profile_id
      and pie.metadata ->> 'action_id' = p_action_id::text;
    if found then
      return jsonb_build_object(
        'payment_intake_id', p_payment_intake_id,
        'event_id', v_event_id,
        'idempotent', true
      );
    end if;
    raise;
end
$$;

revoke all on function public.provider_intake_actor_context()
  from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_assert_company_access(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_mask_value(text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_provider_intakes(
  uuid, text[], date, date, boolean, text, text, text, integer, integer
)
  from public, anon, authenticated, service_role;
revoke all on function public.get_provider_intake_detail(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.transition_provider_intake(
  uuid, text, timestamptz, text, text, uuid
)
  from public, anon, authenticated, service_role;
revoke all on function public.add_provider_intake_note(
  uuid, timestamptz, text, uuid
)
  from public, anon, authenticated, service_role;

grant execute on function public.list_provider_intakes(
  uuid, text[], date, date, boolean, text, text, text, integer, integer
)
  to authenticated;
grant execute on function public.get_provider_intake_detail(uuid)
  to authenticated;
grant execute on function public.transition_provider_intake(
  uuid, text, timestamptz, text, text, uuid
)
  to authenticated;
grant execute on function public.add_provider_intake_note(
  uuid, timestamptz, text, uuid
)
  to authenticated;

comment on function public.list_provider_intakes(
  uuid, text[], date, date, boolean, text, text, text, integer, integer
) is
  'Company-scoped, server-paginated provider-intake list for finance/admin/sysadmin. Excludes RFC, email, bank values, link IDs, tokens, and storage paths.';
comment on function public.get_provider_intake_detail(uuid) is
  'Authorized provider-intake detail with masked bank values, private file metadata without storage paths, and sanitized audit history.';
comment on function public.transition_provider_intake(
  uuid, text, timestamptz, text, text, uuid
) is
  'Allowlisted, optimistic-concurrency provider-intake transition with one append-only event and idempotent action ID. Conversion is intentionally unsupported.';
comment on function public.add_provider_intake_note(
  uuid, timestamptz, text, uuid
) is
  'Append-only internal note for an authorized provider-intake actor; it never edits the submitted payload or status.';

do $$
declare
  v_public_functions text[] := array[
    'list_provider_intakes',
    'get_provider_intake_detail',
    'transition_provider_intake',
    'add_provider_intake_note'
  ]::text[];
  v_privileged_internal_functions text[] := array[
    'provider_intake_actor_context',
    'provider_intake_assert_company_access'
  ]::text[];
  v_pure_internal_functions text[] := array[
    'provider_intake_mask_value'
  ]::text[];
  v_all_functions text[];
begin
  v_all_functions :=
    v_public_functions
    || v_privileged_internal_functions
    || v_pure_internal_functions;

  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (v_all_functions)
  ) <> 7 then
    raise exception '029_postcheck: expected triage functions are missing';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (v_all_functions)
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting = 'search_path=public, pg_temp'
      )
  ) then
    raise exception '029_postcheck: fixed search_path is missing';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (
        v_public_functions || v_privileged_internal_functions
      )
      and not p.prosecdef
  ) then
    raise exception '029_postcheck: a privileged function is not SECURITY DEFINER';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.proname = any (v_pure_internal_functions)
      and (
        p.prosecdef
        or p.provolatile <> 'i'
        or l.lanname <> 'sql'
      )
  ) then
    raise exception '029_postcheck: pure mask helper privilege or language is unsafe';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (v_public_functions)
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(
            coalesce(p.proacl, acldefault('f', p.proowner))
          ) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception '029_postcheck: public RPC grants are unsafe';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (
        v_privileged_internal_functions || v_pure_internal_functions
      )
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(
            coalesce(p.proacl, acldefault('f', p.proowner))
          ) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception '029_postcheck: an internal helper is directly executable';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.payment_intake_events'::regclass
      and c.conname = 'payment_intake_events_event_type_check'
      and pg_get_constraintdef(c.oid) like '%internal_note%'
  ) then
    raise exception '029_postcheck: internal_note event type is missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'payment_intake_events_action_id_uidx'
  ) then
    raise exception '029_postcheck: action idempotency index is missing';
  end if;
end
$$;

commit;
