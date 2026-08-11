-- Flux Operadora - Migration 025
-- Secure data foundation for the future public provider intake.

begin;

do $$
declare
  v_missing text[] := array[]::text[];
  v_existing text[];
  v_expected_mimes text[] := array[
    'application/pdf',
    'application/xml',
    'text/xml',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[];
  v_bucket record;
begin
  if to_regclass('public.companies') is null then
    v_missing := array_append(v_missing, 'public.companies');
  end if;
  if to_regclass('public.profiles') is null then
    v_missing := array_append(v_missing, 'public.profiles');
  end if;
  if to_regclass('public.proveedores') is null then
    v_missing := array_append(v_missing, 'public.proveedores');
  end if;
  if to_regclass('public.payment_requests') is null then
    v_missing := array_append(v_missing, 'public.payment_requests');
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
  if to_regprocedure('public.set_updated_at()') is null then
    v_missing := array_append(v_missing, 'public.set_updated_at()');
  end if;

  if not exists (
    select 1
    from pg_proc p
    where p.proname = 'gen_random_uuid'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    v_missing := array_append(v_missing, 'gen_random_uuid()');
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']::text[]) required_role
    where not exists (select 1 from pg_roles r where r.rolname = required_role)
  ) then
    v_missing := array_append(v_missing, 'Supabase database roles');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception '025_precheck: missing required objects: %', array_to_string(v_missing, ', ');
  end if;

  select array_agg(object_name order by object_name)
    into v_existing
  from (
    select object_name
    from unnest(array[
      'intake_links',
      'payment_intake',
      'payment_intake_files',
      'payment_intake_events'
    ]::text[]) object_name
    where to_regclass('public.' || object_name) is not null
  ) existing_objects;

  if cardinality(coalesce(v_existing, array[]::text[])) > 0 then
    raise exception '025_precheck: intake tables already exist; stop and inspect compatibility: %',
      array_to_string(v_existing, ', ');
  end if;

  if to_regclass('public.payment_intake_public_folio_seq') is not null
     or to_regprocedure('public.next_payment_intake_public_folio()') is not null
     or to_regprocedure('public.normalize_payment_intake_foundation()') is not null
     or to_regprocedure('public.protect_payment_intake_events_immutable()') is not null then
    raise exception '025_precheck: one or more migration 025 helper objects already exist';
  end if;

  select *
    into v_bucket
  from storage.buckets b
  where b.id = 'intake-uploads';

  if found and (
    v_bucket.name is distinct from 'intake-uploads'
    or v_bucket.public is distinct from false
    or v_bucket.file_size_limit is distinct from 10485760
    or v_bucket.allowed_mime_types is null
    or not (v_bucket.allowed_mime_types @> v_expected_mimes)
    or not (v_expected_mimes @> v_bucket.allowed_mime_types)
    or cardinality(v_bucket.allowed_mime_types) <> 6
  ) then
    raise exception '025_precheck: existing intake-uploads bucket is public or incompatible';
  end if;

  if exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'intake-uploads'
  ) then
    raise exception '025_precheck: existing intake-uploads bucket contains objects';
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
    raise exception '025_precheck: storage.objects already has a policy for intake-uploads';
  end if;
end
$$;

create sequence public.payment_intake_public_folio_seq
  as bigint
  minvalue 1
  maxvalue 999999
  start with 1
  increment by 1
  no cycle;

create function public.next_payment_intake_public_folio()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_year text;
  v_number bigint;
begin
  v_year := extract(year from (now() at time zone 'America/Mexico_City'))::integer::text;
  v_number := nextval('public.payment_intake_public_folio_seq'::regclass);
  return 'INT-' || v_year || '-' || lpad(v_number::text, 6, '0');
end
$$;

revoke all on sequence public.payment_intake_public_folio_seq
  from public, anon, authenticated, service_role;
revoke all on function public.next_payment_intake_public_folio()
  from public, anon, authenticated, service_role;
grant execute on function public.next_payment_intake_public_folio()
  to service_role;

create table public.intake_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  label text not null,
  token_hash text not null,
  token_prefix text not null,
  status text not null default 'active',
  expires_at timestamptz,
  max_submissions_per_day integer not null default 20,
  allowed_file_types text[] not null default array[
    'application/pdf',
    'application/xml',
    'text/xml',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[],
  max_file_mb integer not null default 10,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  regenerated_from_id uuid references public.intake_links(id) on delete set null,
  constraint intake_links_label_check check (nullif(btrim(label), '') is not null),
  constraint intake_links_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint intake_links_token_prefix_check check (
    token_prefix ~ '^[A-Za-z0-9_-]{6,16}$'
  ),
  constraint intake_links_status_check check (
    status in ('active', 'paused', 'revoked', 'expired')
  ),
  constraint intake_links_submission_limit_check check (
    max_submissions_per_day between 1 and 10000
  ),
  constraint intake_links_file_limit_check check (max_file_mb between 1 and 10),
  constraint intake_links_allowed_file_types_check check (
    cardinality(allowed_file_types) > 0
    and array_position(allowed_file_types, null) is null
    and allowed_file_types <@ array[
      'application/pdf',
      'application/xml',
      'text/xml',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]::text[]
  ),
  constraint intake_links_revocation_check check (
    (
      status = 'revoked'
      and revoked_by is not null
      and revoked_at is not null
    )
    or (
      status <> 'revoked'
      and revoked_by is null
      and revoked_at is null
    )
  ),
  constraint intake_links_regeneration_check check (
    regenerated_from_id is null or regenerated_from_id <> id
  )
);

create unique index intake_links_token_hash_uidx
  on public.intake_links(token_hash);
create unique index intake_links_id_company_uidx
  on public.intake_links(id, company_id);
create index intake_links_company_status_idx
  on public.intake_links(company_id, status);
create unique index intake_links_one_active_per_company_uidx
  on public.intake_links(company_id)
  where status = 'active';
create index intake_links_expires_at_idx
  on public.intake_links(expires_at)
  where expires_at is not null;

create table public.payment_intake (
  id uuid primary key default gen_random_uuid(),
  public_folio text not null default public.next_payment_intake_public_folio(),
  intake_link_id uuid not null,
  company_id uuid not null references public.companies(id) on delete restrict,
  status text not null default 'received',
  provider_name text not null,
  provider_rfc text,
  provider_email text not null,
  provider_phone text,
  concept text not null,
  description text,
  amount_requested numeric(18, 2) not null,
  currency text not null default 'MXN',
  requested_payment_date date,
  invoice_folio text,
  invoice_uuid text,
  invoice_date date,
  bank_name text,
  bank_account text,
  bank_clabe text,
  beneficiary_name text,
  submission_fingerprint text not null,
  idempotency_key text,
  client_ip_hash text,
  user_agent_hash text,
  payload_version integer not null default 1,
  captcha_provider text,
  captcha_verified_at timestamptz,
  matched_proveedor_id uuid references public.proveedores(id) on delete set null,
  created_payment_request_id uuid references public.payment_requests(id) on delete restrict,
  triaged_by uuid references public.profiles(id) on delete restrict,
  triaged_at timestamptz,
  rejection_reason text,
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_intake_link_company_fkey
    foreign key (intake_link_id, company_id)
    references public.intake_links(id, company_id)
    on delete restrict,
  constraint payment_intake_public_folio_check check (
    public_folio ~ '^INT-[0-9]{4}-[0-9]{6}$'
  ),
  constraint payment_intake_status_check check (
    status in (
      'received',
      'in_review',
      'needs_correction',
      'rejected',
      'converted',
      'cancelled'
    )
  ),
  constraint payment_intake_provider_name_check check (
    nullif(btrim(provider_name), '') is not null
  ),
  constraint payment_intake_provider_rfc_check check (
    provider_rfc is null
    or provider_rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'
  ),
  constraint payment_intake_provider_email_check check (
    provider_email = lower(btrim(provider_email))
    and provider_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint payment_intake_concept_check check (
    nullif(btrim(concept), '') is not null
  ),
  constraint payment_intake_amount_check check (amount_requested > 0),
  constraint payment_intake_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint payment_intake_bank_clabe_check check (
    bank_clabe is null or bank_clabe ~ '^[0-9]{18}$'
  ),
  constraint payment_intake_submission_fingerprint_check check (
    submission_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint payment_intake_idempotency_key_check check (
    idempotency_key is null or nullif(btrim(idempotency_key), '') is not null
  ),
  constraint payment_intake_client_ip_hash_check check (
    client_ip_hash is null or client_ip_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint payment_intake_user_agent_hash_check check (
    user_agent_hash is null or user_agent_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint payment_intake_payload_version_check check (payload_version >= 1),
  constraint payment_intake_captcha_check check (
    (captcha_provider is null and captcha_verified_at is null)
    or (
      nullif(btrim(captcha_provider), '') is not null
      and captcha_verified_at is not null
    )
  ),
  constraint payment_intake_triage_check check (
    (triaged_by is null and triaged_at is null)
    or (triaged_by is not null and triaged_at is not null)
  ),
  constraint payment_intake_rejection_check check (
    (status = 'rejected' and nullif(btrim(rejection_reason), '') is not null)
    or (status <> 'rejected' and rejection_reason is null)
  ),
  constraint payment_intake_conversion_check check (
    (status = 'converted' and created_payment_request_id is not null)
    or (status <> 'converted' and created_payment_request_id is null)
  )
);

create unique index payment_intake_public_folio_uidx
  on public.payment_intake(public_folio);
create index payment_intake_link_id_idx
  on public.payment_intake(intake_link_id);
create index payment_intake_company_status_created_idx
  on public.payment_intake(company_id, status, created_at desc);
create index payment_intake_provider_rfc_idx
  on public.payment_intake(provider_rfc)
  where provider_rfc is not null;
create index payment_intake_submission_fingerprint_created_idx
  on public.payment_intake(submission_fingerprint, created_at desc);
create unique index payment_intake_idempotency_uidx
  on public.payment_intake(intake_link_id, idempotency_key)
  where idempotency_key is not null;
create unique index payment_intake_created_request_uidx
  on public.payment_intake(created_payment_request_id)
  where created_payment_request_id is not null;

create table public.payment_intake_files (
  id uuid primary key default gen_random_uuid(),
  payment_intake_id uuid not null references public.payment_intake(id) on delete restrict,
  bucket_id text not null default 'intake-uploads',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  file_kind text not null,
  quarantine_status text not null default 'pending',
  sha256 text,
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  rejection_reason text,
  constraint payment_intake_files_bucket_check check (bucket_id = 'intake-uploads'),
  constraint payment_intake_files_storage_path_check check (
    storage_path like (payment_intake_id::text || '/%')
    and storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,10})?$'
  ),
  constraint payment_intake_files_filename_check check (
    nullif(btrim(original_filename), '') is not null
    and position('/' in original_filename) = 0
    and position(chr(92) in original_filename) = 0
    and original_filename !~ '[[:cntrl:]]'
  ),
  constraint payment_intake_files_mime_check check (
    mime_type = any (array[
      'application/pdf',
      'application/xml',
      'text/xml',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]::text[])
  ),
  constraint payment_intake_files_size_check check (
    size_bytes between 1 and 10485760
  ),
  constraint payment_intake_files_kind_check check (
    file_kind in ('invoice_pdf', 'invoice_xml', 'bank_document', 'support', 'other')
  ),
  constraint payment_intake_files_quarantine_status_check check (
    quarantine_status in ('pending', 'accepted', 'rejected')
  ),
  constraint payment_intake_files_sha256_check check (
    sha256 is null or sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint payment_intake_files_review_check check (
    (
      quarantine_status = 'pending'
      and reviewed_by is null
      and reviewed_at is null
      and rejection_reason is null
    )
    or (
      quarantine_status = 'accepted'
      and reviewed_by is not null
      and reviewed_at is not null
      and rejection_reason is null
    )
    or (
      quarantine_status = 'rejected'
      and reviewed_by is not null
      and reviewed_at is not null
      and nullif(btrim(rejection_reason), '') is not null
    )
  )
);

create index payment_intake_files_intake_id_idx
  on public.payment_intake_files(payment_intake_id);
create unique index payment_intake_files_storage_path_uidx
  on public.payment_intake_files(storage_path);
create index payment_intake_files_quarantine_status_idx
  on public.payment_intake_files(quarantine_status);

create table public.payment_intake_events (
  id uuid primary key default gen_random_uuid(),
  payment_intake_id uuid not null references public.payment_intake(id) on delete restrict,
  event_type text not null,
  actor_profile_id uuid references public.profiles(id) on delete restrict,
  actor_type text not null,
  from_status text,
  to_status text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint payment_intake_events_actor_type_check check (
    actor_type in ('public_provider', 'finance', 'admin', 'sysadmin', 'system')
  ),
  constraint payment_intake_events_actor_check check (
    (actor_type in ('public_provider', 'system') and actor_profile_id is null)
    or (actor_type in ('finance', 'admin', 'sysadmin') and actor_profile_id is not null)
  ),
  constraint payment_intake_events_event_type_check check (
    event_type in (
      'received',
      'status_changed',
      'file_uploaded',
      'file_reviewed',
      'provider_matched',
      'correction_requested',
      'rejected',
      'converted'
    )
  ),
  constraint payment_intake_events_from_status_check check (
    from_status is null
    or from_status in (
      'received',
      'in_review',
      'needs_correction',
      'rejected',
      'converted',
      'cancelled'
    )
  ),
  constraint payment_intake_events_to_status_check check (
    to_status is null
    or to_status in (
      'received',
      'in_review',
      'needs_correction',
      'rejected',
      'converted',
      'cancelled'
    )
  ),
  constraint payment_intake_events_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  ),
  constraint payment_intake_events_metadata_sensitive_keys_check check (
    not (metadata ?| array[
      'bank_clabe',
      'clabe',
      'captcha',
      'captcha_token',
      'public_token',
      'token',
      'raw_payload',
      'client_ip',
      'user_agent',
      'cookies',
      'headers',
      'secrets'
    ]::text[])
  )
);

create index payment_intake_events_intake_created_idx
  on public.payment_intake_events(payment_intake_id, created_at);
create index payment_intake_events_type_created_idx
  on public.payment_intake_events(event_type, created_at);

create function public.normalize_payment_intake_foundation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.provider_name := regexp_replace(btrim(new.provider_name), '[[:space:]]+', ' ', 'g');
  new.provider_rfc := nullif(
    upper(regexp_replace(btrim(coalesce(new.provider_rfc, '')), '[[:space:]-]+', '', 'g')),
    ''
  );
  new.provider_email := lower(btrim(new.provider_email));
  new.provider_phone := nullif(regexp_replace(btrim(coalesce(new.provider_phone, '')), '[[:space:]]+', ' ', 'g'), '');
  new.concept := regexp_replace(btrim(new.concept), '[[:space:]]+', ' ', 'g');
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.currency := upper(btrim(new.currency));
  new.invoice_folio := nullif(btrim(coalesce(new.invoice_folio, '')), '');
  new.invoice_uuid := nullif(upper(btrim(coalesce(new.invoice_uuid, ''))), '');
  new.bank_name := nullif(regexp_replace(btrim(coalesce(new.bank_name, '')), '[[:space:]]+', ' ', 'g'), '');
  new.bank_account := nullif(regexp_replace(btrim(coalesce(new.bank_account, '')), '[[:space:]-]+', '', 'g'), '');
  new.bank_clabe := nullif(regexp_replace(btrim(coalesce(new.bank_clabe, '')), '[[:space:]-]+', '', 'g'), '');
  new.beneficiary_name := nullif(regexp_replace(btrim(coalesce(new.beneficiary_name, '')), '[[:space:]]+', ' ', 'g'), '');
  new.submission_fingerprint := lower(btrim(new.submission_fingerprint));
  new.idempotency_key := nullif(btrim(coalesce(new.idempotency_key, '')), '');
  new.client_ip_hash := nullif(lower(btrim(coalesce(new.client_ip_hash, ''))), '');
  new.user_agent_hash := nullif(lower(btrim(coalesce(new.user_agent_hash, ''))), '');
  new.captcha_provider := nullif(lower(btrim(coalesce(new.captcha_provider, ''))), '');
  new.rejection_reason := nullif(btrim(coalesce(new.rejection_reason, '')), '');
  return new;
end
$$;

create function public.protect_payment_intake_events_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'payment_intake_events_append_only';
  return null;
end
$$;

revoke all on function public.normalize_payment_intake_foundation()
  from public, anon, authenticated, service_role;
revoke all on function public.protect_payment_intake_events_immutable()
  from public, anon, authenticated, service_role;

create trigger intake_links_updated_at
  before update on public.intake_links
  for each row execute function public.set_updated_at();

create trigger payment_intake_normalize_before_write
  before insert or update on public.payment_intake
  for each row execute function public.normalize_payment_intake_foundation();

create trigger payment_intake_updated_at
  before update on public.payment_intake
  for each row execute function public.set_updated_at();

create trigger payment_intake_events_immutable
  before update or delete on public.payment_intake_events
  for each row execute function public.protect_payment_intake_events_immutable();

alter table public.intake_links enable row level security;
alter table public.payment_intake enable row level security;
alter table public.payment_intake_files enable row level security;
alter table public.payment_intake_events enable row level security;

create policy intake_links_select_admins
  on public.intake_links
  for select
  to authenticated
  using (public.current_user_has_role(public.flux_sysadmin_roles()));

create policy payment_intake_select_finance_company
  on public.payment_intake
  for select
  to authenticated
  using (
    public.current_user_has_role(public.flux_sysadmin_roles())
    or (
      public.current_user_has_role(public.flux_finance_roles())
      and public.has_active_company_membership(
        public.current_profile_id(),
        company_id
      )
    )
  );

create policy payment_intake_files_select_finance_company
  on public.payment_intake_files
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.payment_intake pi
      where pi.id = payment_intake_files.payment_intake_id
        and (
          public.current_user_has_role(public.flux_sysadmin_roles())
          or (
            public.current_user_has_role(public.flux_finance_roles())
            and public.has_active_company_membership(
              public.current_profile_id(),
              pi.company_id
            )
          )
        )
    )
  );

create policy payment_intake_events_select_finance_company
  on public.payment_intake_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.payment_intake pi
      where pi.id = payment_intake_events.payment_intake_id
        and (
          public.current_user_has_role(public.flux_sysadmin_roles())
          or (
            public.current_user_has_role(public.flux_finance_roles())
            and public.has_active_company_membership(
              public.current_profile_id(),
              pi.company_id
            )
          )
        )
    )
  );

revoke all on table public.intake_links
  from public, anon, authenticated, service_role;
revoke all on table public.payment_intake
  from public, anon, authenticated, service_role;
revoke all on table public.payment_intake_files
  from public, anon, authenticated, service_role;
revoke all on table public.payment_intake_events
  from public, anon, authenticated, service_role;

grant select on table public.intake_links
  to authenticated;
grant select on table public.payment_intake
  to authenticated;
grant select on table public.payment_intake_files
  to authenticated;
grant select on table public.payment_intake_events
  to authenticated;

grant select, insert, update on table public.intake_links
  to service_role;
grant select, insert, update on table public.payment_intake
  to service_role;
grant select, insert, update on table public.payment_intake_files
  to service_role;
grant select, insert on table public.payment_intake_events
  to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'intake-uploads',
  'intake-uploads',
  false,
  10485760,
  array[
    'application/pdf',
    'application/xml',
    'text/xml',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do nothing;

comment on table public.intake_links is
  'Internal configuration for future public provider intake links. Only token hashes are stored.';
comment on column public.intake_links.token_prefix is
  'Non-secret prefix for internal identification; it is not sufficient to authenticate a public request.';
comment on table public.payment_intake is
  'Provider-declared intake pending internal triage; it is not a payment_request and never enters approval batches directly.';
comment on column public.payment_intake.bank_clabe is
  'Provider-declared sensitive value. It is not an operational payment destination until internally validated.';
comment on table public.payment_intake_files is
  'Metadata for private, quarantined intake files stored under opaque paths.';
comment on table public.payment_intake_events is
  'Append-only audit ledger. Metadata must exclude full CLABE, CAPTCHA tokens, public tokens, secrets, and raw sensitive payloads.';
comment on function public.next_payment_intake_public_folio() is
  'Internal service-only generator for public intake folios in INT-YYYY-NNNNNN format.';

do $$
declare
  v_expected_tables text[] := array[
    'intake_links',
    'payment_intake',
    'payment_intake_files',
    'payment_intake_events'
  ]::text[];
  v_expected_policies text[] := array[
    'intake_links_select_admins',
    'payment_intake_select_finance_company',
    'payment_intake_files_select_finance_company',
    'payment_intake_events_select_finance_company'
  ]::text[];
  v_expected_mimes text[] := array[
    'application/pdf',
    'application/xml',
    'text/xml',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[];
begin
  if exists (
    select 1
    from unnest(v_expected_tables) table_name
    where to_regclass('public.' || table_name) is null
  ) then
    raise exception '025_postcheck: one or more intake tables are missing';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any (v_expected_tables)
      and not c.relrowsecurity
  ) then
    raise exception '025_postcheck: RLS is not enabled on every intake table';
  end if;

  if (
    select count(*)
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any (v_expected_tables)
      and p.policyname = any (v_expected_policies)
      and p.cmd = 'SELECT'
  ) <> 4 then
    raise exception '025_postcheck: expected SELECT policies are missing';
  end if;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any (v_expected_tables)
      and p.policyname <> all (v_expected_policies)
  ) then
    raise exception '025_postcheck: unexpected intake policy found';
  end if;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any (v_expected_tables)
      and p.roles && array['anon', 'public']::name[]
  ) then
    raise exception '025_postcheck: anon or PUBLIC can reach an intake policy';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name = any (v_expected_tables)
      and g.grantee in ('anon', 'PUBLIC')
  ) then
    raise exception '025_postcheck: anon or PUBLIC has an intake table grant';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name = any (v_expected_tables)
      and g.grantee = 'authenticated'
      and g.privilege_type <> 'SELECT'
  ) then
    raise exception '025_postcheck: authenticated has a direct mutation grant';
  end if;

  if to_regclass('public.payment_intake_public_folio_seq') is null
     or to_regprocedure('public.next_payment_intake_public_folio()') is null then
    raise exception '025_postcheck: public folio generator is missing';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    left join pg_roles r on r.oid = acl.grantee
    where n.nspname = 'public'
      and p.proname = any (array[
        'next_payment_intake_public_folio',
        'normalize_payment_intake_foundation',
        'protect_payment_intake_events_immutable'
      ]::text[])
      and acl.privilege_type = 'EXECUTE'
      and (acl.grantee = 0 or r.rolname in ('anon', 'authenticated'))
  ) then
    raise exception '025_postcheck: an internal function is executable by PUBLIC, anon, or authenticated';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'next_payment_intake_public_folio'
      and p.prosecdef
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where replace(setting, ' ', '') = 'search_path=public,pg_temp'
      )
  ) then
    raise exception '025_postcheck: folio helper is not SECURITY DEFINER with fixed search_path';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.next_payment_intake_public_folio()',
    'EXECUTE'
  ) then
    raise exception '025_postcheck: service_role cannot execute the folio helper';
  end if;

  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'intake_links'
      and c.column_name in ('token', 'raw_token', 'plaintext_token', 'token_plaintext')
  ) then
    raise exception '025_postcheck: a plaintext token column exists';
  end if;

  if not exists (
    select 1
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_class tbl on tbl.oid = i.indrelid
    join pg_namespace n on n.oid = tbl.relnamespace
    where n.nspname = 'public'
      and tbl.relname = 'intake_links'
      and idx.relname = 'intake_links_one_active_per_company_uidx'
      and i.indisunique
      and i.indpred is not null
  ) then
    raise exception '025_postcheck: active-link unique partial index is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception '025_postcheck: append-only event trigger is missing';
  end if;

  if not exists (
    select 1
    from storage.buckets b
    where b.id = 'intake-uploads'
      and b.name = 'intake-uploads'
      and b.public = false
      and b.file_size_limit = 10485760
      and b.allowed_mime_types @> v_expected_mimes
      and v_expected_mimes @> b.allowed_mime_types
      and cardinality(b.allowed_mime_types) = 6
  ) then
    raise exception '025_postcheck: private intake-uploads bucket configuration is missing';
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
    raise exception '025_postcheck: intake-uploads has a direct storage policy';
  end if;

  if exists (select 1 from storage.objects o where o.bucket_id = 'intake-uploads') then
    raise exception '025_postcheck: intake-uploads unexpectedly contains objects';
  end if;

  if exists (select 1 from public.intake_links)
     or exists (select 1 from public.payment_intake)
     or exists (select 1 from public.payment_intake_files)
     or exists (select 1 from public.payment_intake_events) then
    raise exception '025_postcheck: migration created domain rows';
  end if;
end
$$;

commit;
