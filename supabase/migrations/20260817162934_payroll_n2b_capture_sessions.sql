-- Flux Operadora / Quantta
-- Payroll N2B: finance-only staged capture and private upload sessions.
-- Remote DEV migration version: 20260817162934.
--
-- This is a temporary capture contract. It is not payroll_runs, does not
-- create payment_requests, and cannot enter approvals, layouts, dispersion,
-- reconciliation, notifications, or budget provisioning.

begin;

do $precheck$
begin
  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260814183429'
  ) then
    raise exception 'payroll_n2b_requires_n1_forward_fix';
  end if;

  if to_regclass('public.payment_requests') is null
     or to_regclass('public.payroll_channels') is null
     or to_regclass('public.payroll_run_files') is null
     or to_regclass('public.company_bank_accounts') is null
     or to_regprocedure('public.current_profile_id()') is null
     or to_regprocedure('public.payroll_has_finance_pii_access()') is null
     or to_regprocedure('public.payroll_redacted_audit()') is null
     or not exists (
       select 1 from storage.buckets where id = 'payroll-private' and not public
     ) then
    raise exception 'payroll_n2b_foundation_missing';
  end if;

  if to_regclass('public.payroll_capture_sessions') is not null
     or to_regclass('public.payroll_capture_files') is not null then
    raise exception 'payroll_n2b_capture_contract_already_exists';
  end if;
end
$precheck$;

create function public.payroll_capture_channels_valid(p_channels text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(cardinality(p_channels) between 1 and 3, false)
    and p_channels <@ array['banco', 'spei', 'vales']::text[]
    and cardinality(p_channels) = (
      select count(distinct channel_name)
      from unnest(p_channels) as channel_name
    );
$$;

revoke all on function public.payroll_capture_channels_valid(text[])
  from public, anon, authenticated;
grant execute on function public.payroll_capture_channels_valid(text[])
  to service_role;

create table public.payroll_capture_sessions (
  id uuid primary key default gen_random_uuid(),
  reserved_payment_request_id uuid not null default gen_random_uuid() unique,
  company_id uuid not null references public.companies(id) on delete restrict,
  company_bank_account_id uuid not null
    references public.company_bank_accounts(id) on delete restrict,
  payroll_subtype text not null,
  period_start date not null,
  period_end date not null,
  concept text not null,
  notes text,
  expected_channels text[] not null,
  capture_state text not null default 'draft',
  validation_status text not null default 'incomplete',
  version integer not null default 1,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_capture_sessions_subtype_check
    check (payroll_subtype in ('ordinaria', 'extraordinaria')),
  constraint payroll_capture_sessions_period_check
    check (period_start <= period_end),
  constraint payroll_capture_sessions_concept_check
    check (char_length(btrim(concept)) between 3 and 500),
  constraint payroll_capture_sessions_notes_check
    check (notes is null or char_length(notes) <= 2000),
  constraint payroll_capture_sessions_channels_check
    check (public.payroll_capture_channels_valid(expected_channels)),
  constraint payroll_capture_sessions_state_check
    check (capture_state in (
      'draft',
      'files_pending',
      'validation_pending',
      'ready_for_submission'
    )),
  constraint payroll_capture_sessions_validation_check
    check (validation_status in ('incomplete', 'blocked', 'valid')),
  constraint payroll_capture_sessions_version_check check (version > 0),
  constraint payroll_capture_sessions_expiry_check check (expires_at > created_at)
);

comment on table public.payroll_capture_sessions is
  'Temporary Finance-only payroll capture. It is not payroll_runs or a payment_request and cannot enter approval.';
comment on column public.payroll_capture_sessions.reserved_payment_request_id is
  'Opaque future materialization key only. N2B never creates the payment request.';
comment on column public.payroll_capture_sessions.expected_channels is
  'User-declared channel presence while the mandatory cover-sheet adapter remains uncertified; no zero-value channels are created.';

create index payroll_capture_sessions_company_state_idx
  on public.payroll_capture_sessions (company_id, capture_state, updated_at desc);
create index payroll_capture_sessions_actor_updated_idx
  on public.payroll_capture_sessions (created_by, updated_at desc);

create table public.payroll_capture_files (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.payroll_capture_sessions(id) on delete restrict,
  kind text not null,
  channel text,
  storage_bucket text not null default 'payroll-private',
  storage_path text not null unique,
  extension text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  upload_state text not null default 'reserved',
  capability_code text not null,
  parsing_status text not null,
  validation_authority text not null,
  parser_version text,
  parser_contract text,
  record_count integer,
  total_amount_minor bigint,
  issue_codes text[] not null default array[]::text[],
  is_current boolean not null default false,
  reserved_by uuid not null references public.profiles(id) on delete restrict,
  uploaded_by uuid references public.profiles(id) on delete restrict,
  reserved_at timestamptz not null default now(),
  uploaded_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint payroll_capture_files_kind_check check (
    kind in ('caratula', 'layout_mismo_banco', 'layout_spei', 'cfdi_vales')
  ),
  constraint payroll_capture_files_channel_check check (
    (kind = 'caratula' and channel is null)
    or (kind = 'layout_mismo_banco' and channel is not distinct from 'banco')
    or (kind = 'layout_spei' and channel is not distinct from 'spei')
    or (kind = 'cfdi_vales' and channel is not distinct from 'vales')
  ),
  constraint payroll_capture_files_bucket_check
    check (storage_bucket = 'payroll-private'),
  constraint payroll_capture_files_path_check check (
    storage_path ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'
  ),
  constraint payroll_capture_files_extension_check
    check (extension in ('xlsx', 'txt', 'xml')),
  constraint payroll_capture_files_mime_check check (
    mime_type in (
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'application/xml',
      'text/xml'
    )
  ),
  constraint payroll_capture_files_media_contract_check check (
    (kind = 'caratula'
      and extension is not distinct from 'xlsx'
      and mime_type is not distinct from
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    or
    (kind in ('layout_mismo_banco', 'layout_spei')
      and extension is not distinct from 'txt'
      and mime_type is not distinct from 'text/plain')
    or
    (kind = 'cfdi_vales'
      and extension is not distinct from 'xml'
      and mime_type in ('application/xml', 'text/xml'))
  ),
  constraint payroll_capture_files_size_check
    check (size_bytes between 1 and 26214400),
  constraint payroll_capture_files_hash_check
    check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint payroll_capture_files_upload_check check (
    (upload_state = 'reserved' and uploaded_by is null and uploaded_at is null and not is_current)
    or
    (upload_state = 'uploaded' and uploaded_by is not null and uploaded_at is not null)
  ),
  constraint payroll_capture_files_capability_check check (
    (kind = 'caratula'
      and capability_code = 'unsupported_pending_source_contract'
      and parsing_status = 'blocked'
      and validation_authority = 'not_applicable')
    or
    (kind = 'layout_mismo_banco'
      and capability_code = 'pending_format_certification'
      and parsing_status = 'blocked'
      and validation_authority = 'not_applicable')
    or
    (kind = 'layout_spei'
      and capability_code = 'supported_certified'
      and parsing_status = 'client_parsed_unverified'
      and validation_authority = 'browser_client_attested')
    or
    (kind = 'cfdi_vales'
      and capability_code = 'pending_employee_breakdown_validation'
      and parsing_status = 'blocked'
      and validation_authority = 'not_applicable')
  ),
  constraint payroll_capture_files_parser_check check (
    (
      kind = 'layout_spei'
      and parser_version is not distinct from 'payroll-normalized-v1'
      and parser_contract is not distinct from 'bbva-simulator-pagos-interbancarios-128-v1'
      and record_count is not null
      and record_count > 0
      and total_amount_minor is not null
      and total_amount_minor > 0
      and issue_codes = array[]::text[]
    )
    or
    (
      kind <> 'layout_spei'
      and parser_version is null
      and parser_contract is null
      and record_count is null
      and total_amount_minor is null
      and issue_codes = array['FORMAT_NOT_CERTIFIED']::text[]
    )
  )
);

comment on table public.payroll_capture_files is
  'Redacted metadata for staged payroll files. No filename, employee row, RFC, CURP, NSS, account, CLABE, reference, or raw parser output is stored.';
comment on column public.payroll_capture_files.total_amount_minor is
  'Aggregate minor-unit total only for the certified SPEI parser; never a manually entered request total.';
comment on column public.payroll_capture_files.validation_authority is
  'N2B browser attestation is non-authoritative. N3 must rehash and reparse stored bytes before materialization.';

create index payroll_capture_files_session_kind_idx
  on public.payroll_capture_files (session_id, kind, reserved_at desc);
create unique index payroll_capture_files_current_kind_uidx
  on public.payroll_capture_files (session_id, kind)
  where is_current;

create function public.payroll_capture_refresh_state(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.payroll_capture_sessions%rowtype;
  v_missing boolean;
begin
  select * into v_session
  from public.payroll_capture_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'payroll_capture_session_not_found';
  end if;

  v_missing := not exists (
    select 1
    from public.payroll_capture_files file
    where file.session_id = v_session.id
      and file.kind = 'caratula'
      and file.upload_state = 'uploaded'
      and file.is_current
  )
  or (
    'banco' = any(v_session.expected_channels)
    and not exists (
      select 1 from public.payroll_capture_files file
      where file.session_id = v_session.id
        and file.kind = 'layout_mismo_banco'
        and file.upload_state = 'uploaded'
        and file.is_current
    )
  )
  or (
    'spei' = any(v_session.expected_channels)
    and not exists (
      select 1 from public.payroll_capture_files file
      where file.session_id = v_session.id
        and file.kind = 'layout_spei'
        and file.upload_state = 'uploaded'
        and file.is_current
    )
  )
  or (
    'vales' = any(v_session.expected_channels)
    and not exists (
      select 1 from public.payroll_capture_files file
      where file.session_id = v_session.id
        and file.kind = 'cfdi_vales'
        and file.upload_state = 'uploaded'
        and file.is_current
    )
  );

  update public.payroll_capture_sessions
  set capture_state = case when v_missing then 'files_pending' else 'validation_pending' end,
      validation_status = case when v_missing then 'incomplete' else 'blocked' end,
      updated_at = now()
  where id = v_session.id;

  -- ready_for_submission is deliberately unreachable in N2B because the
  -- mandatory cover-sheet contract is still uncertified.
end;
$$;

revoke all on function public.payroll_capture_refresh_state(uuid)
  from public, anon, authenticated;

create function public.save_payroll_capture_session(
  p_session_id uuid,
  p_expected_version integer,
  p_company_id uuid,
  p_company_bank_account_id uuid,
  p_payroll_subtype text,
  p_period_start date,
  p_period_end date,
  p_concept text,
  p_notes text,
  p_expected_channels text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_session public.payroll_capture_sessions%rowtype;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'payroll_capture_finance_required';
  end if;

  if p_company_id is null
     or p_company_bank_account_id is null
     or p_payroll_subtype not in ('ordinaria', 'extraordinaria')
     or p_period_start is null
     or p_period_end is null
     or p_period_start > p_period_end
     or char_length(btrim(coalesce(p_concept, ''))) not between 3 and 500
     or char_length(coalesce(p_notes, '')) > 2000
     or not public.payroll_capture_channels_valid(p_expected_channels) then
    raise exception 'payroll_capture_metadata_invalid';
  end if;

  if not exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and coalesce(company.active, true)
  ) or not exists (
    select 1
    from public.company_bank_accounts account
    where account.id = p_company_bank_account_id
      and account.company_id = p_company_id
      and coalesce(account.active, true)
      and account.account_type::text = 'bank'
      and account.currency = 'MXN'
  ) then
    raise exception 'payroll_capture_source_account_invalid';
  end if;

  if p_session_id is null then
    if p_expected_version is not null then
      raise exception 'payroll_capture_version_must_be_null_for_create';
    end if;

    insert into public.payroll_capture_sessions (
      company_id,
      company_bank_account_id,
      payroll_subtype,
      period_start,
      period_end,
      concept,
      notes,
      expected_channels,
      created_by,
      updated_by
    ) values (
      p_company_id,
      p_company_bank_account_id,
      p_payroll_subtype,
      p_period_start,
      p_period_end,
      btrim(p_concept),
      nullif(btrim(coalesce(p_notes, '')), ''),
      p_expected_channels,
      v_actor,
      v_actor
    ) returning * into v_session;
  else
    select * into v_session
    from public.payroll_capture_sessions
    where id = p_session_id
    for update;

    if not found then
      raise exception 'payroll_capture_session_not_found';
    end if;
    if p_expected_version is null or v_session.version <> p_expected_version then
      raise exception 'payroll_capture_version_conflict';
    end if;
    if v_session.expires_at <= now() then
      raise exception 'payroll_capture_session_expired';
    end if;
    if p_company_id <> v_session.company_id
       and exists (
         select 1 from public.payroll_capture_files file
         where file.session_id = v_session.id
       ) then
      raise exception 'payroll_capture_company_locked_after_file_reservation';
    end if;
    if p_company_bank_account_id <> v_session.company_bank_account_id
       and exists (
         select 1 from public.payroll_capture_files file
         where file.session_id = v_session.id
           and file.kind = 'layout_spei'
       ) then
      raise exception 'payroll_capture_source_account_locked_after_spei';
    end if;
    if exists (
      select 1
      from public.payroll_capture_files file
      where file.session_id = v_session.id
        and file.channel is not null
        and not (file.channel = any(p_expected_channels))
    ) then
      raise exception 'payroll_capture_channel_locked_after_file_reservation';
    end if;

    update public.payroll_capture_sessions
    set company_id = p_company_id,
        company_bank_account_id = p_company_bank_account_id,
        payroll_subtype = p_payroll_subtype,
        period_start = p_period_start,
        period_end = p_period_end,
        concept = btrim(p_concept),
        notes = nullif(btrim(coalesce(p_notes, '')), ''),
        expected_channels = p_expected_channels,
        updated_by = v_actor,
        updated_at = now(),
        version = version + 1
    where id = p_session_id
    returning * into v_session;
  end if;

  perform public.payroll_capture_refresh_state(v_session.id);

  select * into v_session
  from public.payroll_capture_sessions
  where id = v_session.id;

  return jsonb_build_object(
    'id', v_session.id,
    'capture_state', v_session.capture_state,
    'validation_status', v_session.validation_status,
    'version', v_session.version
  );
end;
$$;

revoke all on function public.save_payroll_capture_session(
  uuid, integer, uuid, uuid, text, date, date, text, text, text[]
) from public, anon;
grant execute on function public.save_payroll_capture_session(
  uuid, integer, uuid, uuid, text, date, date, text, text, text[]
) to authenticated, service_role;

create function public.reserve_payroll_capture_file(
  p_session_id uuid,
  p_expected_version integer,
  p_kind text,
  p_extension text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_parser_version text,
  p_parser_contract text,
  p_record_count integer,
  p_total_amount_minor bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_session public.payroll_capture_sessions%rowtype;
  v_file_id uuid := gen_random_uuid();
  v_channel text;
  v_capability text;
  v_parsing_status text;
  v_issue_codes text[];
  v_path text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'payroll_capture_finance_required';
  end if;

  select * into v_session
  from public.payroll_capture_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'payroll_capture_session_not_found';
  end if;
  if v_session.expires_at <= now() then
    raise exception 'payroll_capture_session_expired';
  end if;
  if p_expected_version is null or v_session.version <> p_expected_version then
    raise exception 'payroll_capture_version_conflict';
  end if;
  if p_size_bytes not between 1 and 26214400
     or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'payroll_capture_file_metadata_invalid';
  end if;

  case p_kind
    when 'caratula' then
      if p_extension <> 'xlsx'
         or p_mime_type <> 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then
        raise exception 'payroll_capture_file_type_invalid';
      end if;
      v_channel := null;
      v_capability := 'unsupported_pending_source_contract';
      v_parsing_status := 'blocked';
      v_issue_codes := array['FORMAT_NOT_CERTIFIED']::text[];
    when 'layout_mismo_banco' then
      if not ('banco' = any(v_session.expected_channels))
         or p_extension <> 'txt'
         or p_mime_type <> 'text/plain' then
        raise exception 'payroll_capture_file_type_invalid';
      end if;
      v_channel := 'banco';
      v_capability := 'pending_format_certification';
      v_parsing_status := 'blocked';
      v_issue_codes := array['FORMAT_NOT_CERTIFIED']::text[];
    when 'layout_spei' then
      if not ('spei' = any(v_session.expected_channels))
         or p_extension <> 'txt'
         or p_mime_type <> 'text/plain'
         or p_parser_version is distinct from 'payroll-normalized-v1'
         or p_parser_contract is distinct from 'bbva-simulator-pagos-interbancarios-128-v1'
         or coalesce(p_record_count, 0) <= 0
         or coalesce(p_total_amount_minor, 0) <= 0 then
        raise exception 'payroll_capture_spei_validation_required';
      end if;
      v_channel := 'spei';
      v_capability := 'supported_certified';
      v_parsing_status := 'client_parsed_unverified';
      v_issue_codes := array[]::text[];
    when 'cfdi_vales' then
      if not ('vales' = any(v_session.expected_channels))
         or p_extension <> 'xml'
         or p_mime_type not in ('application/xml', 'text/xml') then
        raise exception 'payroll_capture_file_type_invalid';
      end if;
      v_channel := 'vales';
      v_capability := 'pending_employee_breakdown_validation';
      v_parsing_status := 'blocked';
      v_issue_codes := array['FORMAT_NOT_CERTIFIED']::text[];
    else
      raise exception 'payroll_capture_file_kind_unsupported';
  end case;

  if p_kind <> 'layout_spei'
     and (
       p_parser_version is not null
       or p_parser_contract is not null
       or p_record_count is not null
       or p_total_amount_minor is not null
     ) then
    raise exception 'payroll_capture_uncertified_parser_metadata_forbidden';
  end if;

  v_path := concat(
    v_session.company_id::text, '/',
    v_session.reserved_payment_request_id::text, '/',
    v_file_id::text, '.', p_extension
  );

  insert into public.payroll_capture_files (
    id,
    session_id,
    kind,
    channel,
    storage_path,
    extension,
    mime_type,
    size_bytes,
    sha256,
    capability_code,
    parsing_status,
    validation_authority,
    parser_version,
    parser_contract,
    record_count,
    total_amount_minor,
    issue_codes,
    reserved_by
  ) values (
    v_file_id,
    v_session.id,
    p_kind,
    v_channel,
    v_path,
    p_extension,
    p_mime_type,
    p_size_bytes,
    p_sha256,
    v_capability,
    v_parsing_status,
    case when p_kind = 'layout_spei'
      then 'browser_client_attested'
      else 'not_applicable'
    end,
    case when p_kind = 'layout_spei' then p_parser_version else null end,
    case when p_kind = 'layout_spei' then p_parser_contract else null end,
    case when p_kind = 'layout_spei' then p_record_count else null end,
    case when p_kind = 'layout_spei' then p_total_amount_minor else null end,
    v_issue_codes,
    v_actor
  );

  return jsonb_build_object(
    'file_id', v_file_id,
    'storage_bucket', 'payroll-private',
    'storage_path', v_path
  );
end;
$$;

revoke all on function public.reserve_payroll_capture_file(
  uuid, integer, text, text, text, bigint, text, text, text, integer, bigint
) from public, anon;
grant execute on function public.reserve_payroll_capture_file(
  uuid, integer, text, text, text, bigint, text, text, text, integer, bigint
) to authenticated, service_role;

create function public.confirm_payroll_capture_file(
  p_file_id uuid,
  p_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_file public.payroll_capture_files%rowtype;
  v_session public.payroll_capture_sessions%rowtype;
  v_object storage.objects%rowtype;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'payroll_capture_finance_required';
  end if;

  select * into v_file
  from public.payroll_capture_files
  where id = p_file_id
  for update;

  if not found or v_file.upload_state <> 'reserved' then
    raise exception 'payroll_capture_file_reservation_not_found';
  end if;
  if p_sha256 is distinct from v_file.sha256 then
    raise exception 'payroll_capture_file_hash_mismatch';
  end if;

  select * into v_session
  from public.payroll_capture_sessions
  where id = v_file.session_id
  for update;

  if not found or v_session.expires_at <= now() then
    raise exception 'payroll_capture_session_expired';
  end if;

  select * into v_object
  from storage.objects object
  where object.bucket_id = v_file.storage_bucket
    and object.name = v_file.storage_path;

  if not found
     or coalesce((v_object.metadata ->> 'size')::bigint, -1) <> v_file.size_bytes
     or coalesce(v_object.metadata ->> 'mimetype', '') <> v_file.mime_type then
    raise exception 'payroll_capture_storage_object_mismatch';
  end if;

  update public.payroll_capture_files
  set is_current = false,
      updated_at = now()
  where session_id = v_file.session_id
    and kind = v_file.kind
    and is_current;

  update public.payroll_capture_files
  set upload_state = 'uploaded',
      is_current = true,
      uploaded_by = v_actor,
      uploaded_at = now(),
      updated_at = now()
  where id = v_file.id;

  update public.payroll_capture_sessions
  set updated_by = v_actor,
      version = version + 1,
      updated_at = now()
  where id = v_session.id;

  perform public.payroll_capture_refresh_state(v_session.id);

  return (
    select jsonb_build_object(
      'session_id', session.id,
      'capture_state', session.capture_state,
      'validation_status', session.validation_status,
      'version', session.version
    )
    from public.payroll_capture_sessions session
    where session.id = v_session.id
  );
end;
$$;

revoke all on function public.confirm_payroll_capture_file(uuid, text)
  from public, anon;
grant execute on function public.confirm_payroll_capture_file(uuid, text)
  to authenticated, service_role;

create function public.get_payroll_capture_sessions(p_session_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_profile_id() is null
     or not public.payroll_has_finance_pii_access() then
    raise exception 'payroll_capture_finance_required';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', session.id,
        'company_id', session.company_id,
        'company_bank_account_id', session.company_bank_account_id,
        'payroll_subtype', session.payroll_subtype,
        'period_start', session.period_start,
        'period_end', session.period_end,
        'concept', session.concept,
        'notes', session.notes,
        'expected_channels', session.expected_channels,
        'capture_state', session.capture_state,
        'validation_status', session.validation_status,
        'version', session.version,
        'expires_at', session.expires_at,
        'updated_at', session.updated_at,
        'files', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', file.id,
              'kind', file.kind,
              'channel', file.channel,
              'capability_code', file.capability_code,
              'parsing_status', file.parsing_status,
              'validation_authority', file.validation_authority,
              'parser_version', file.parser_version,
              'parser_contract', file.parser_contract,
              'record_count', file.record_count,
              'total_amount_minor', file.total_amount_minor,
              'issue_codes', file.issue_codes,
              'uploaded_at', file.uploaded_at
            ) order by file.uploaded_at desc
          )
          from public.payroll_capture_files file
          where file.session_id = session.id
            and file.upload_state = 'uploaded'
            and file.is_current
        ), '[]'::jsonb)
      ) order by session.updated_at desc
    )
    from (
      select *
      from public.payroll_capture_sessions
      where (p_session_id is null or id = p_session_id)
        and expires_at > now()
      order by updated_at desc
      limit 50
    ) session
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_payroll_capture_sessions(uuid)
  from public, anon;
grant execute on function public.get_payroll_capture_sessions(uuid)
  to authenticated, service_role;

create function public.payroll_capture_storage_insert_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.payroll_has_finance_pii_access()
    and p_name ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'
    and exists (
      select 1
      from public.payroll_capture_files file
      join public.payroll_capture_sessions session on session.id = file.session_id
      where file.storage_path = p_name
        and file.storage_bucket = 'payroll-private'
        and file.upload_state = 'reserved'
        and session.company_id::text = split_part(p_name, '/', 1)
        and session.reserved_payment_request_id::text = split_part(p_name, '/', 2)
        and session.expires_at > now()
        and session.capture_state in ('draft', 'files_pending', 'validation_pending')
    );
$$;

create function public.payroll_capture_storage_select_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.payroll_has_finance_pii_access()
    and exists (
      select 1
      from public.payroll_capture_files file
      join public.payroll_capture_sessions session on session.id = file.session_id
      where file.storage_path = p_name
        and file.storage_bucket = 'payroll-private'
        and file.upload_state = 'uploaded'
        and file.is_current
        and session.expires_at > now()
    );
$$;

revoke all on function public.payroll_capture_storage_insert_allowed(text)
  from public, anon;
revoke all on function public.payroll_capture_storage_select_allowed(text)
  from public, anon;
grant execute on function public.payroll_capture_storage_insert_allowed(text)
  to authenticated, service_role;
grant execute on function public.payroll_capture_storage_select_allowed(text)
  to authenticated, service_role;

alter table public.payroll_capture_sessions enable row level security;
alter table public.payroll_capture_sessions force row level security;
alter table public.payroll_capture_files enable row level security;
alter table public.payroll_capture_files force row level security;

revoke all on table public.payroll_capture_sessions
  from public, anon, authenticated;
revoke all on table public.payroll_capture_files
  from public, anon, authenticated;
grant all on table public.payroll_capture_sessions to service_role;
grant all on table public.payroll_capture_files to service_role;

create trigger payroll_capture_sessions_redacted_audit
after insert or update or delete on public.payroll_capture_sessions
for each row execute function public.payroll_redacted_audit();

create trigger payroll_capture_files_redacted_audit
after insert or update or delete on public.payroll_capture_files
for each row execute function public.payroll_redacted_audit();

create policy payroll_private_capture_finance_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payroll-private'
  and public.payroll_capture_storage_insert_allowed(name)
);

create policy payroll_private_capture_finance_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payroll-private'
  and public.payroll_capture_storage_select_allowed(name)
);

-- The N0 UPDATE policy intentionally supports only materialized two-segment
-- paths. This restrictive policy prevents a staged three-segment object from
-- being moved, renamed, overwritten, or transformed into that legacy shape.
-- It also prevents a materialized object from being moved into staged shape.
create policy payroll_private_capture_no_update
on storage.objects
as restrictive
for update
to authenticated
using (
  bucket_id <> 'payroll-private'
  or name !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'
)
with check (
  bucket_id <> 'payroll-private'
  or name !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'
);

alter table public.payment_requests
  validate constraint payment_requests_payroll_contract_check;

do $postcheck$
begin
  if to_regclass('public.payroll_capture_sessions') is null
     or to_regclass('public.payroll_capture_files') is null
     or to_regprocedure(
       'public.save_payroll_capture_session(uuid,integer,uuid,uuid,text,date,date,text,text,text[])'
     ) is null
     or to_regprocedure(
       'public.reserve_payroll_capture_file(uuid,integer,text,text,text,bigint,text,text,text,integer,bigint)'
     ) is null
     or to_regprocedure('public.confirm_payroll_capture_file(uuid,text)') is null
     or to_regprocedure('public.get_payroll_capture_sessions(uuid)') is null
     or not exists (
       select 1
       from pg_constraint constraint_info
       where constraint_info.conrelid = 'public.payment_requests'::regclass
         and constraint_info.conname = 'payment_requests_payroll_contract_check'
         and constraint_info.convalidated
     ) then
    raise exception 'payroll_n2b_capture_contract_incomplete';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants grant_info
    where grant_info.table_schema = 'public'
      and grant_info.table_name in ('payroll_capture_sessions', 'payroll_capture_files')
      and grant_info.grantee in ('anon', 'authenticated')
  ) then
    raise exception 'payroll_n2b_direct_table_grant_forbidden';
  end if;
end
$postcheck$;

commit;
