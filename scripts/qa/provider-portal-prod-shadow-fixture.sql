\set ON_ERROR_STOP on
create role anon noinherit;
create role authenticated noinherit;
create role service_role noinherit bypassrls;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;
set search_path = public, extensions;

create table public.companies(id uuid primary key default gen_random_uuid(), name text, legal_name text, active boolean default true);
create table public.profiles(id uuid primary key default gen_random_uuid(), auth_user_id uuid, email text, full_name text, active boolean default true);
create table public.proveedores(
  id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id),
  alias text, razon_social text, nombre_comercial text, rfc text, email text, telefono text,
  banco text, cuenta text, clabe text, beneficiario text, active boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.cost_centers(id uuid primary key default gen_random_uuid(), company_id uuid, name text, active boolean default true);
create table public.budget_categories(id uuid primary key default gen_random_uuid(), name text, active boolean default true);
create table public.company_bank_accounts(id uuid primary key default gen_random_uuid(), company_id uuid, active boolean default true);
create table public.approver_assignments(id uuid primary key default gen_random_uuid());
create table public.payment_requests(id uuid primary key default gen_random_uuid());

create function public.next_payment_intake_public_folio() returns text language sql as $$ select 'INT-2099-000001'::text $$;
create function public.current_profile_id() returns uuid language sql stable as $$ select nullif(current_setting('app.test_profile_id', true), '')::uuid $$;
create function public.flux_sysadmin_roles() returns text[] language sql immutable as $$ select array['sysadmin']::text[] $$;
create function public.flux_finance_roles() returns text[] language sql immutable as $$ select array['finance','director','admin','operativo']::text[] $$;
create function public.current_user_has_role(p_roles text[]) returns boolean language sql stable as $$
  select exists (select 1 from unnest(string_to_array(coalesce(current_setting('app.test_roles', true), ''), ',')) r where btrim(r) = any(p_roles))
$$;
create function public.has_active_company_membership(p_profile_id uuid, p_company_id uuid) returns boolean language sql stable as $$ select p_profile_id is not null and p_company_id is not null $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_auth_uid', true), '')::uuid $$;

create table public.intake_links(
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), label text not null,
  token_hash text not null, token_prefix text not null, status text not null default 'active', expires_at timestamptz,
  max_submissions_per_day integer not null default 20,
  allowed_file_types text[] not null default array['application/pdf','application/xml','text/xml','image/jpeg','image/png','image/webp'],
  max_file_mb integer not null default 10, created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id), revoked_at timestamptz,
  regenerated_from_id uuid references public.intake_links(id)
);
create unique index intake_links_id_company_uidx on public.intake_links(id, company_id);
create unique index intake_links_one_active_per_company_uidx on public.intake_links(company_id) where status='active';
create unique index intake_links_token_hash_uidx on public.intake_links(token_hash);
alter table public.intake_links enable row level security;

create table public.payment_intake(
  id uuid primary key default gen_random_uuid(), public_folio text not null default public.next_payment_intake_public_folio(),
  intake_link_id uuid not null, company_id uuid not null references public.companies(id), status text not null default 'received',
  provider_name text not null, provider_rfc text, provider_email text not null, provider_phone text,
  concept text not null, description text, amount_requested numeric not null, currency text not null default 'MXN',
  requested_payment_date date, invoice_folio text, invoice_uuid text, invoice_date date,
  bank_name text, bank_account text, bank_clabe text, beneficiary_name text,
  submission_fingerprint text not null, idempotency_key text, client_ip_hash text, user_agent_hash text,
  payload_version integer not null default 1, captcha_provider text, captcha_verified_at timestamptz,
  matched_proveedor_id uuid references public.proveedores(id), created_payment_request_id uuid references public.payment_requests(id),
  triaged_by uuid references public.profiles(id), triaged_at timestamptz, rejection_reason text, retention_until timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (intake_link_id, company_id) references public.intake_links(id, company_id)
);
create unique index payment_intake_created_request_uidx on public.payment_intake(created_payment_request_id) where created_payment_request_id is not null;
alter table public.payment_intake enable row level security;

create table public.payment_intake_files(
  id uuid primary key default gen_random_uuid(), payment_intake_id uuid not null references public.payment_intake(id),
  bucket_id text not null default 'intake-uploads', storage_path text not null, original_filename text not null,
  mime_type text not null, size_bytes bigint not null, file_kind text not null, quarantine_status text not null default 'pending',
  sha256 text, created_at timestamptz not null default now(), reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz, rejection_reason text
);
alter table public.payment_intake_files enable row level security;
create table public.payment_intake_events(
  id uuid primary key default gen_random_uuid(), payment_intake_id uuid not null references public.payment_intake(id),
  event_type text not null, actor_profile_id uuid references public.profiles(id), actor_type text not null,
  from_status text, to_status text, notes text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  constraint payment_intake_events_event_type_check check (event_type in ('received','status_changed','file_uploaded','file_reviewed','provider_matched','correction_requested','rejected','converted'))
);
alter table public.payment_intake_events enable row level security;

create policy intake_links_select_admins on public.intake_links for select to authenticated using (public.current_user_has_role(public.flux_sysadmin_roles()));
create policy payment_intake_select_finance_company on public.payment_intake for select to authenticated using (true);
create policy payment_intake_files_select_finance_company on public.payment_intake_files for select to authenticated using (true);
create policy payment_intake_events_select_finance_company on public.payment_intake_events for select to authenticated using (true);

create table storage.buckets(id text primary key, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
insert into storage.buckets values ('intake-uploads', false, 10485760, array['application/pdf','application/xml','text/xml','image/jpeg','image/png','image/webp']);
