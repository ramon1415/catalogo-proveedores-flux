-- Flux Operadora - Migration 027
-- Private transactional support for the public provider-intake Edge Function.

begin;

do $$
declare
  v_missing text[] := array[]::text[];
  v_bucket record;
  v_function_name text;
  v_expected_mimes text[] := array[
    'application/pdf',
    'application/xml',
    'text/xml',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[];
begin
  foreach v_function_name in array array[
    'resolve_provider_intake_link_internal',
    'create_provider_intake_internal',
    'attach_provider_intake_files_internal',
    'mark_provider_intake_upload_issue_internal'
  ] loop
    if exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = v_function_name
    ) then
      raise exception '027_precheck: incompatible function already exists: %', v_function_name;
    end if;
  end loop;

  if to_regclass('public.intake_links') is null then
    v_missing := array_append(v_missing, 'public.intake_links');
  end if;
  if to_regclass('public.payment_intake') is null then
    v_missing := array_append(v_missing, 'public.payment_intake');
  end if;
  if to_regclass('public.payment_intake_files') is null then
    v_missing := array_append(v_missing, 'public.payment_intake_files');
  end if;
  if to_regclass('public.payment_intake_events') is null then
    v_missing := array_append(v_missing, 'public.payment_intake_events');
  end if;
  if to_regclass('public.notification_events') is null then
    v_missing := array_append(v_missing, 'public.notification_events');
  end if;
  if to_regclass('storage.buckets') is null then
    v_missing := array_append(v_missing, 'storage.buckets');
  end if;
  if to_regclass('storage.objects') is null then
    v_missing := array_append(v_missing, 'storage.objects');
  end if;
  if to_regprocedure('public.next_payment_intake_public_folio()') is null then
    v_missing := array_append(v_missing, 'public.next_payment_intake_public_folio()');
  end if;
  if to_regprocedure(
    'public.enqueue_notification_event_internal(text,text,uuid,text,text,uuid,text,text,jsonb,text,text)'
  ) is null then
    v_missing := array_append(v_missing, 'public.enqueue_notification_event_internal(...)');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception '027_precheck: missing migration 025 dependencies: %', array_to_string(v_missing, ', ');
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']::text[]) expected(role_name)
    where not exists (
      select 1 from pg_roles r where r.rolname = expected.role_name
    )
  ) then
    raise exception '027_precheck: required Supabase database role is missing';
  end if;

  if exists (
    select 1
    from (values
      ('intake_links', 'id'),
      ('intake_links', 'company_id'),
      ('intake_links', 'token_hash'),
      ('intake_links', 'status'),
      ('intake_links', 'expires_at'),
      ('intake_links', 'max_submissions_per_day'),
      ('intake_links', 'allowed_file_types'),
      ('intake_links', 'max_file_mb'),
      ('payment_intake', 'id'),
      ('payment_intake', 'public_folio'),
      ('payment_intake', 'intake_link_id'),
      ('payment_intake', 'company_id'),
      ('payment_intake', 'status'),
      ('payment_intake', 'submission_fingerprint'),
      ('payment_intake', 'idempotency_key'),
      ('payment_intake', 'client_ip_hash'),
      ('payment_intake', 'user_agent_hash'),
      ('payment_intake', 'captcha_provider'),
      ('payment_intake', 'captcha_verified_at'),
      ('payment_intake_files', 'payment_intake_id'),
      ('payment_intake_files', 'storage_path'),
      ('payment_intake_files', 'mime_type'),
      ('payment_intake_files', 'size_bytes'),
      ('payment_intake_files', 'file_kind'),
      ('payment_intake_files', 'quarantine_status'),
      ('payment_intake_files', 'sha256'),
      ('payment_intake_events', 'payment_intake_id'),
      ('payment_intake_events', 'event_type'),
      ('payment_intake_events', 'actor_type'),
      ('payment_intake_events', 'metadata')
    ) expected(table_name, column_name)
    where not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = expected.table_name
        and c.column_name = expected.column_name
    )
  ) then
    raise exception '027_precheck: migration 025 intake columns are incompatible';
  end if;

  if exists (
    select 1
    from (values
      ('intake_links', 'intake_links_status_check'),
      ('intake_links', 'intake_links_submission_limit_check'),
      ('intake_links', 'intake_links_file_limit_check'),
      ('intake_links', 'intake_links_allowed_file_types_check'),
      ('payment_intake', 'payment_intake_link_company_fkey'),
      ('payment_intake', 'payment_intake_status_check'),
      ('payment_intake', 'payment_intake_provider_email_check'),
      ('payment_intake', 'payment_intake_amount_check'),
      ('payment_intake', 'payment_intake_submission_fingerprint_check'),
      ('payment_intake', 'payment_intake_idempotency_key_check'),
      ('payment_intake', 'payment_intake_client_ip_hash_check'),
      ('payment_intake', 'payment_intake_user_agent_hash_check'),
      ('payment_intake', 'payment_intake_captcha_check'),
      ('payment_intake_files', 'payment_intake_files_storage_path_check'),
      ('payment_intake_files', 'payment_intake_files_mime_check'),
      ('payment_intake_files', 'payment_intake_files_size_check'),
      ('payment_intake_files', 'payment_intake_files_kind_check'),
      ('payment_intake_files', 'payment_intake_files_quarantine_status_check'),
      ('payment_intake_events', 'payment_intake_events_actor_type_check'),
      ('payment_intake_events', 'payment_intake_events_event_type_check'),
      ('payment_intake_events', 'payment_intake_events_metadata_sensitive_keys_check')
    ) expected(table_name, constraint_name)
    where not exists (
      select 1
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      where n.nspname = 'public'
        and rel.relname = expected.table_name
        and con.conname = expected.constraint_name
    )
  ) then
    raise exception '027_precheck: migration 025 intake constraints are incompatible';
  end if;

  if to_regclass('public.intake_links_token_hash_uidx') is null
     or to_regclass('public.payment_intake_idempotency_uidx') is null
     or to_regclass('public.payment_intake_submission_fingerprint_created_idx') is null
     or to_regclass('public.payment_intake_files_storage_path_uidx') is null then
    raise exception '027_precheck: migration 025 intake indexes are incompatible';
  end if;

  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in (
        'intake_links',
        'payment_intake',
        'payment_intake_files',
        'payment_intake_events'
      )
      and c.column_name in ('public_token', 'token', 'captcha_token', 'client_ip', 'user_agent')
  ) then
    raise exception '027_precheck: plaintext-sensitive intake column detected';
  end if;

  if exists (select 1 from public.intake_links)
     or exists (select 1 from public.payment_intake)
     or exists (select 1 from public.payment_intake_files)
     or exists (select 1 from public.payment_intake_events) then
    raise exception '027_precheck: intake foundation is not empty';
  end if;

  select *
    into v_bucket
  from storage.buckets b
  where b.id = 'intake-uploads';

  if not found
     or v_bucket.public is distinct from false
     or v_bucket.file_size_limit is distinct from 10485760
     or v_bucket.allowed_mime_types is null
     or not (v_bucket.allowed_mime_types @> v_expected_mimes)
     or not (v_expected_mimes @> v_bucket.allowed_mime_types)
     or cardinality(v_bucket.allowed_mime_types) <> 6 then
    raise exception '027_precheck: intake-uploads bucket is missing or incompatible';
  end if;

  if exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'intake-uploads'
  ) then
    raise exception '027_precheck: intake-uploads bucket is not empty';
  end if;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and position(
        'intake-uploads' in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
      ) > 0
  ) then
    raise exception '027_precheck: direct Storage policy exists for intake-uploads';
  end if;
end
$$;

create function public.resolve_provider_intake_link_internal(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_token_hash is null or lower(btrim(p_token_hash)) !~ '^[0-9a-f]{64}$' then
    raise exception 'provider_intake_link_not_available';
  end if;

  select jsonb_build_object(
    'intake_link_id', il.id,
    'company_id', il.company_id,
    'company_display_name', coalesce(nullif(btrim(c.legal_name), ''), c.name),
    'max_file_mb', il.max_file_mb,
    'max_submissions_per_day', il.max_submissions_per_day,
    'allowed_file_types', to_jsonb(il.allowed_file_types)
  )
    into v_result
  from public.intake_links il
  join public.companies c on c.id = il.company_id
  where il.token_hash = lower(btrim(p_token_hash))
    and il.status = 'active'
    and (il.expires_at is null or il.expires_at > now())
    and coalesce(c.active, true)
  limit 1;

  if v_result is null then
    raise exception 'provider_intake_link_not_available';
  end if;

  return v_result;
end
$$;

create function public.create_provider_intake_internal(
  p_token_hash text,
  p_submission jsonb,
  p_submission_fingerprint text,
  p_idempotency_key_hash text,
  p_client_ip_hash text default null,
  p_user_agent_hash text default null,
  p_captcha_provider text default 'turnstile',
  p_fingerprint_window_seconds integer default 86400
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_link record;
  v_existing record;
  v_intake_id uuid;
  v_public_folio text;
  v_window_seconds integer;
  v_fingerprint_window_start timestamptz;
  v_day_start timestamptz;
  v_link_submission_count integer;
  v_ip_submission_count integer;
  v_raw_amount numeric;
  v_amount numeric(18, 2);
begin
  if p_token_hash is null or lower(btrim(p_token_hash)) !~ '^[0-9a-f]{64}$' then
    raise exception 'provider_intake_link_not_available';
  end if;
  if p_submission is null or jsonb_typeof(p_submission) <> 'object' then
    raise exception 'provider_intake_invalid_submission';
  end if;
  if p_submission_fingerprint is null
     or lower(btrim(p_submission_fingerprint)) !~ '^[0-9a-f]{64}$' then
    raise exception 'provider_intake_invalid_fingerprint';
  end if;
  if p_idempotency_key_hash is null
     or lower(btrim(p_idempotency_key_hash)) !~ '^[0-9a-f]{64}$' then
    raise exception 'provider_intake_invalid_idempotency_key';
  end if;
  if p_client_ip_hash is not null
     and lower(btrim(p_client_ip_hash)) !~ '^[0-9a-f]{64}$' then
    raise exception 'provider_intake_invalid_client_hash';
  end if;
  if p_user_agent_hash is not null
     and lower(btrim(p_user_agent_hash)) !~ '^[0-9a-f]{64}$' then
    raise exception 'provider_intake_invalid_agent_hash';
  end if;
  if nullif(btrim(coalesce(p_captcha_provider, '')), '') is null then
    raise exception 'provider_intake_captcha_required';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_submission) as supplied(key)
    where supplied.key <> all (array[
      'provider_name',
      'provider_rfc',
      'provider_email',
      'provider_phone',
      'concept',
      'description',
      'amount_requested',
      'currency',
      'requested_payment_date',
      'invoice_folio',
      'invoice_uuid',
      'invoice_date',
      'bank_name',
      'bank_account',
      'bank_clabe',
      'beneficiary_name'
    ]::text[])
  ) then
    raise exception 'provider_intake_unknown_field';
  end if;

  begin
    if coalesce(p_submission ->> 'amount_requested', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'provider_intake_invalid_amount';
    end if;
    v_raw_amount := (p_submission ->> 'amount_requested')::numeric;
    v_amount := v_raw_amount::numeric(18, 2);
  exception when others then
    raise exception 'provider_intake_invalid_amount';
  end;

  if nullif(btrim(p_submission ->> 'provider_name'), '') is null
     or nullif(btrim(p_submission ->> 'provider_email'), '') is null
     or nullif(btrim(p_submission ->> 'concept'), '') is null
     or v_amount is null
     or v_amount <= 0
     or length(btrim(p_submission ->> 'provider_name')) > 200
     or btrim(p_submission ->> 'provider_name') ~ '[[:cntrl:]]'
     or length(btrim(p_submission ->> 'provider_email')) > 254
     or lower(btrim(p_submission ->> 'provider_email')) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(btrim(p_submission ->> 'concept')) > 300
     or btrim(p_submission ->> 'concept') ~ '[[:cntrl:]]'
     or length(coalesce(p_submission ->> 'description', '')) > 4000
     or coalesce(p_submission ->> 'description', '') ~ '[[:cntrl:]]'
     or upper(coalesce(nullif(btrim(p_submission ->> 'currency'), ''), 'MXN')) !~ '^[A-Z]{3}$'
     or (
       nullif(btrim(p_submission ->> 'provider_rfc'), '') is not null
       and upper(replace(replace(btrim(p_submission ->> 'provider_rfc'), ' ', ''), '-', ''))
         !~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'
     )
     or (
       nullif(btrim(p_submission ->> 'bank_clabe'), '') is not null
       and replace(replace(btrim(p_submission ->> 'bank_clabe'), ' ', ''), '-', '') !~ '^[0-9]{18}$'
     )
     or (
       nullif(btrim(p_submission ->> 'bank_account'), '') is not null
       and replace(replace(btrim(p_submission ->> 'bank_account'), ' ', ''), '-', '') !~ '^[A-Za-z0-9]{4,34}$'
     )
     or (
       nullif(btrim(p_submission ->> 'invoice_uuid'), '') is not null
       and upper(btrim(p_submission ->> 'invoice_uuid'))
         !~ '^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$'
     ) then
    raise exception 'provider_intake_invalid_submission';
  end if;

  begin
    if nullif(btrim(p_submission ->> 'requested_payment_date'), '') is not null then
      perform (p_submission ->> 'requested_payment_date')::date;
    end if;
    if nullif(btrim(p_submission ->> 'invoice_date'), '') is not null then
      perform (p_submission ->> 'invoice_date')::date;
    end if;
  exception when others then
    raise exception 'provider_intake_invalid_submission';
  end;

  select
    il.id,
    il.company_id,
    il.max_submissions_per_day
    into v_link
  from public.intake_links il
  join public.companies c on c.id = il.company_id
  where il.token_hash = lower(btrim(p_token_hash))
    and il.status = 'active'
    and (il.expires_at is null or il.expires_at > now())
    and coalesce(c.active, true)
  for update of il;

  if not found then
    raise exception 'provider_intake_link_not_available';
  end if;

  select pi.id, pi.public_folio
    into v_existing
  from public.payment_intake pi
  where pi.intake_link_id = v_link.id
    and pi.idempotency_key = lower(btrim(p_idempotency_key_hash))
  limit 1;

  if found then
    return jsonb_build_object(
      'payment_intake_id', v_existing.id,
      'public_folio', v_existing.public_folio,
      'status', 'received',
      'duplicate', true
    );
  end if;

  v_window_seconds := greatest(60, least(coalesce(p_fingerprint_window_seconds, 86400), 86400));
  v_day_start := date_trunc('day', now() at time zone 'America/Mexico_City')
    at time zone 'America/Mexico_City';
  v_fingerprint_window_start := now() - make_interval(secs => v_window_seconds);

  select pi.id, pi.public_folio
    into v_existing
  from public.payment_intake pi
  where pi.intake_link_id = v_link.id
    and pi.submission_fingerprint = lower(btrim(p_submission_fingerprint))
    and pi.created_at >= v_fingerprint_window_start
  order by pi.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'payment_intake_id', v_existing.id,
      'public_folio', v_existing.public_folio,
      'status', 'received',
      'duplicate', true
    );
  end if;

  select count(*)::integer
    into v_link_submission_count
  from public.payment_intake pi
  where pi.intake_link_id = v_link.id
    and pi.created_at >= v_day_start;

  if v_link_submission_count >= v_link.max_submissions_per_day then
    raise exception 'provider_intake_rate_limited';
  end if;

  if p_client_ip_hash is not null then
    select count(*)::integer
      into v_ip_submission_count
    from public.payment_intake pi
    where pi.intake_link_id = v_link.id
      and pi.client_ip_hash = lower(btrim(p_client_ip_hash))
      and pi.created_at >= v_fingerprint_window_start;

    if v_ip_submission_count >= v_link.max_submissions_per_day then
      raise exception 'provider_intake_rate_limited';
    end if;
  end if;

  v_intake_id := gen_random_uuid();
  v_public_folio := public.next_payment_intake_public_folio();

  insert into public.payment_intake (
    id,
    public_folio,
    intake_link_id,
    company_id,
    status,
    provider_name,
    provider_rfc,
    provider_email,
    provider_phone,
    concept,
    description,
    amount_requested,
    currency,
    requested_payment_date,
    invoice_folio,
    invoice_uuid,
    invoice_date,
    bank_name,
    bank_account,
    bank_clabe,
    beneficiary_name,
    submission_fingerprint,
    idempotency_key,
    client_ip_hash,
    user_agent_hash,
    payload_version,
    captcha_provider,
    captcha_verified_at
  ) values (
    v_intake_id,
    v_public_folio,
    v_link.id,
    v_link.company_id,
    'received',
    btrim(p_submission ->> 'provider_name'),
    nullif(upper(replace(replace(btrim(p_submission ->> 'provider_rfc'), ' ', ''), '-', '')), ''),
    lower(btrim(p_submission ->> 'provider_email')),
    nullif(btrim(p_submission ->> 'provider_phone'), ''),
    btrim(p_submission ->> 'concept'),
    nullif(btrim(p_submission ->> 'description'), ''),
    v_amount,
    upper(coalesce(nullif(btrim(p_submission ->> 'currency'), ''), 'MXN')),
    nullif(p_submission ->> 'requested_payment_date', '')::date,
    nullif(btrim(p_submission ->> 'invoice_folio'), ''),
    nullif(upper(btrim(p_submission ->> 'invoice_uuid')), ''),
    nullif(p_submission ->> 'invoice_date', '')::date,
    nullif(btrim(p_submission ->> 'bank_name'), ''),
    nullif(replace(replace(btrim(p_submission ->> 'bank_account'), ' ', ''), '-', ''), ''),
    nullif(replace(replace(btrim(p_submission ->> 'bank_clabe'), ' ', ''), '-', ''), ''),
    nullif(btrim(p_submission ->> 'beneficiary_name'), ''),
    lower(btrim(p_submission_fingerprint)),
    lower(btrim(p_idempotency_key_hash)),
    nullif(lower(btrim(coalesce(p_client_ip_hash, ''))), ''),
    nullif(lower(btrim(coalesce(p_user_agent_hash, ''))), ''),
    1,
    lower(btrim(p_captcha_provider)),
    now()
  );

  insert into public.payment_intake_events (
    payment_intake_id,
    event_type,
    actor_type,
    from_status,
    to_status,
    metadata
  ) values (
    v_intake_id,
    'received',
    'public_provider',
    null,
    'received',
    jsonb_build_object('contract_version', 1)
  );

  return jsonb_build_object(
    'payment_intake_id', v_intake_id,
    'public_folio', v_public_folio,
    'status', 'received',
    'duplicate', false
  );
exception
  when unique_violation then
    select pi.id, pi.public_folio
      into v_existing
    from public.payment_intake pi
    where pi.intake_link_id = v_link.id
      and pi.idempotency_key = lower(btrim(p_idempotency_key_hash))
    limit 1;

    if found then
      return jsonb_build_object(
        'payment_intake_id', v_existing.id,
        'public_folio', v_existing.public_folio,
        'status', 'received',
        'duplicate', true
      );
    end if;
    raise;
end
$$;

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

revoke all on function public.resolve_provider_intake_link_internal(text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_provider_intake_internal(
  text, jsonb, text, text, text, text, text, integer
)
  from public, anon, authenticated, service_role;
revoke all on function public.attach_provider_intake_files_internal(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_provider_intake_upload_issue_internal(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.resolve_provider_intake_link_internal(text)
  to service_role;
grant execute on function public.create_provider_intake_internal(
  text, jsonb, text, text, text, text, text, integer
)
  to service_role;
grant execute on function public.attach_provider_intake_files_internal(uuid, jsonb)
  to service_role;
grant execute on function public.mark_provider_intake_upload_issue_internal(uuid, text)
  to service_role;

comment on function public.resolve_provider_intake_link_internal(text) is
  'Service-only resolution of an active provider-intake token hash. Never expose its internal IDs directly.';
comment on function public.create_provider_intake_internal(text, jsonb, text, text, text, text, text, integer) is
  'Service-only transactional provider intake creation with link lock, rate limit, idempotency, folio, and received ledger event.';
comment on function public.attach_provider_intake_files_internal(uuid, jsonb) is
  'Service-only idempotent attachment of validated private file metadata and file_uploaded ledger events.';
comment on function public.mark_provider_intake_upload_issue_internal(uuid, text) is
  'Service-only transition to needs_correction after a sanitized upload or metadata issue.';

do $$
declare
  v_expected_names text[] := array[
    'resolve_provider_intake_link_internal',
    'create_provider_intake_internal',
    'attach_provider_intake_files_internal',
    'mark_provider_intake_upload_issue_internal'
  ]::text[];
begin
  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (v_expected_names)
  ) <> 4 then
    raise exception '027_postcheck: expected edge support functions are missing';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (v_expected_names)
      and (
        not p.prosecdef
        or not exists (
          select 1
          from unnest(coalesce(p.proconfig, array[]::text[])) setting
          where setting = 'search_path=public, pg_temp'
        )
      )
  ) then
    raise exception '027_postcheck: SECURITY DEFINER or fixed search_path is missing';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
    where n.nspname = 'public'
      and p.proname = any (v_expected_names)
      and privilege.privilege_type = 'EXECUTE'
      and privilege.grantee in (
        0,
        (select r.oid from pg_roles r where r.rolname = 'anon'),
        (select r.oid from pg_roles r where r.rolname = 'authenticated')
      )
  ) then
    raise exception '027_postcheck: public client can execute an internal function';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (v_expected_names)
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) then
    raise exception '027_postcheck: service_role execute grant is missing';
  end if;

  if not exists (
    select 1
    from storage.buckets b
    where b.id = 'intake-uploads'
      and b.public is false
      and b.file_size_limit = 10485760
      and b.allowed_mime_types @> array[
        'application/pdf', 'application/xml', 'text/xml',
        'image/jpeg', 'image/png', 'image/webp'
      ]::text[]
      and array[
        'application/pdf', 'application/xml', 'text/xml',
        'image/jpeg', 'image/png', 'image/webp'
      ]::text[] @> b.allowed_mime_types
      and cardinality(b.allowed_mime_types) = 6
  ) then
    raise exception '027_postcheck: intake-uploads bucket changed unexpectedly';
  end if;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and position('intake-uploads' in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) > 0
  ) then
    raise exception '027_postcheck: direct Storage policy exists for intake-uploads';
  end if;

  if exists (
    select 1 from storage.objects o where o.bucket_id = 'intake-uploads'
  ) then
    raise exception '027_postcheck: migration inserted a Storage object';
  end if;

  if exists (select 1 from public.intake_links)
     or exists (select 1 from public.payment_intake)
     or exists (select 1 from public.payment_intake_files)
     or exists (select 1 from public.payment_intake_events) then
    raise exception '027_postcheck: migration inserted intake domain data';
  end if;
end
$$;

commit;
