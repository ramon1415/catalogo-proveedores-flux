-- Flux Operadora / Quantta
-- Payroll N0 foundation contract.
--
-- DRAFT ONLY in N0. This migration is versioned for review but MUST NOT be
-- applied to DEV until N1 is explicitly authorized. It does not calculate
-- payroll, generate bank/TOKA layouts, or deliver employee receipts.

begin;

do $precheck$
begin
  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260813011425'
  ) then
    raise exception 'payroll_n0_requires_dev_migration_049';
  end if;

  if to_regclass('public.payment_requests') is null
     or to_regclass('public.payment_layout_lines') is null
     or to_regclass('public.company_bank_accounts') is null
     or to_regclass('public.activity_log') is null
     or to_regprocedure(
       'public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)'
     ) is null
     or to_regprocedure('public.current_profile_id()') is null
     or to_regprocedure('public.current_user_has_role(text[])') is null then
    raise exception 'payroll_n0_required_contract_missing';
  end if;
end
$precheck$;

alter type public.payment_request_type add value if not exists 'nomina';

alter table public.payment_requests
  add column if not exists payroll_subtype text,
  add column if not exists payroll_period_start date,
  add column if not exists payroll_period_end date;

comment on column public.payment_requests.payroll_subtype is
  'Payroll-only subtype: ordinaria or extraordinaria. Flux records externally calculated payroll.';
comment on column public.payment_requests.payroll_period_start is
  'Payroll-only inclusive source period start.';
comment on column public.payment_requests.payroll_period_end is
  'Payroll-only inclusive source period end.';

alter table public.payment_requests
  drop constraint if exists payment_requests_payroll_contract_check;

alter table public.payment_requests
  add constraint payment_requests_payroll_contract_check
  check (
    (
      request_type::text = 'nomina'
      and payroll_subtype in ('ordinaria', 'extraordinaria')
      and payroll_period_start is not null
      and payroll_period_end is not null
      and payroll_period_start <= payroll_period_end
      and company_id is not null
      and company_bank_account_id is not null
      and cost_center_id is not null
      and provider_id is null
      and proveedor_id is null
      and provider_bank_account_id is null
    )
    or
    (
      request_type::text <> 'nomina'
      and payroll_subtype is null
      and payroll_period_start is null
      and payroll_period_end is null
    )
  ) not valid;

-- Existing rows are non-payroll and must remain compatible. NOT VALID avoids a
-- table scan during deployment; N1 must validate before enabling capture.

create index if not exists payment_requests_payroll_period_idx
  on public.payment_requests (
    request_type,
    company_id,
    payroll_period_start,
    payroll_period_end
  );

create table public.payroll_channels (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null
    references public.payment_requests(id) on delete cascade,
  channel text not null,
  amount numeric(14,2) not null,
  currency text not null default 'MXN',
  layout_file_id uuid,
  dispersion_status text not null default 'pending',
  dispersed_at timestamptz,
  dispersed_by uuid references public.profiles(id),
  dispersion_note text,
  reconciliation_status text not null default 'pending',
  reconciled_at timestamptz,
  reconciled_by uuid references public.profiles(id),
  reconciliation_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_channels_request_channel_key
    unique (payment_request_id, channel),
  constraint payroll_channels_channel_check
    check (channel in ('banco', 'spei', 'vales')),
  constraint payroll_channels_amount_check
    check (amount > 0),
  constraint payroll_channels_currency_check
    check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  constraint payroll_channels_dispersion_status_check
    check (dispersion_status in ('pending', 'dispersed', 'failed')),
  constraint payroll_channels_dispersion_lifecycle_check
    check (
      (
        dispersion_status = 'pending'
        and dispersed_at is null
        and dispersed_by is null
        and dispersion_note is null
      )
      or
      (
        dispersion_status = 'dispersed'
        and dispersed_at is not null
        and dispersed_by is not null
        and dispersion_note is null
      )
      or
      (
        dispersion_status = 'failed'
        and dispersed_at is not null
        and dispersed_by is not null
        and nullif(btrim(dispersion_note), '') is not null
      )
    ),
  constraint payroll_channels_reconciliation_status_check
    check (reconciliation_status in ('pending', 'reconciled', 'exception')),
  constraint payroll_channels_reconciliation_lifecycle_check
    check (
      (
        reconciliation_status = 'pending'
        and reconciled_at is null
        and reconciled_by is null
        and reconciliation_note is null
      )
      or
      (
        reconciliation_status = 'reconciled'
        and dispersion_status = 'dispersed'
        and reconciled_at is not null
        and reconciled_by is not null
        and reconciliation_note is null
      )
      or
      (
        reconciliation_status = 'exception'
        and reconciled_at is not null
        and reconciled_by is not null
        and nullif(btrim(reconciliation_note), '') is not null
      )
    )
);

comment on table public.payroll_channels is
  'One externally dispersed aggregate per banco, spei, or vales channel for a payroll payment request.';
comment on column public.payroll_channels.layout_file_id is
  'External layout received from the payroll processor. Flux never generates it.';

create index payroll_channels_request_reconciliation_idx
  on public.payroll_channels (
    payment_request_id,
    reconciliation_status,
    channel
  );

create table public.payroll_run_files (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null
    references public.payment_requests(id) on delete cascade,
  payroll_channel_id uuid
    references public.payroll_channels(id) on delete cascade,
  kind text not null,
  storage_bucket text not null default 'payroll-private',
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  parsing_status text not null default 'not_started',
  parsing_version text,
  parsing_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_run_files_kind_check check (
    kind in (
      'caratula',
      'layout_mismo_banco',
      'layout_spei',
      'layout_toka',
      'cfdi_vales',
      'comprobante',
      'cfdi_nomina',
      'otros'
    )
  ),
  constraint payroll_run_files_bucket_check
    check (storage_bucket = 'payroll-private'),
  constraint payroll_run_files_path_check check (
    storage_path like payment_request_id::text || '/%'
    and storage_path ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'
  ),
  constraint payroll_run_files_filename_check check (
    nullif(btrim(original_filename), '') is not null
    and position('/' in original_filename) = 0
    and position(chr(92) in original_filename) = 0
    and original_filename !~ '[[:cntrl:]]'
  ),
  constraint payroll_run_files_mime_check check (
    mime_type in (
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'application/xml',
      'text/xml',
      'application/pdf'
    )
  ),
  constraint payroll_run_files_size_check
    check (size_bytes between 1 and 26214400),
  constraint payroll_run_files_hash_check
    check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint payroll_run_files_parsing_status_check check (
    parsing_status in ('not_started', 'pending', 'parsed', 'blocked', 'failed')
  ),
  constraint payroll_run_files_parsing_version_check check (
    (parsing_status in ('not_started', 'pending') and parsing_version is null)
    or
    (parsing_status in ('parsed', 'blocked', 'failed')
      and nullif(btrim(parsing_version), '') is not null)
  ),
  constraint payroll_run_files_metadata_check check (
    jsonb_typeof(parsing_metadata) = 'object'
    and parsing_metadata - array[
      'evidence_class',
      'headers',
      'issue_codes',
      'parser_version',
      'row_count',
      'sheet_names'
    ]::text[] = '{}'::jsonb
  ),
  constraint payroll_run_files_channel_kind_check check (
    (
      kind in ('caratula', 'cfdi_nomina', 'otros')
      and payroll_channel_id is null
    )
    or
    (
      kind in (
        'layout_mismo_banco',
        'layout_spei',
        'layout_toka',
        'cfdi_vales',
        'comprobante'
      )
      and payroll_channel_id is not null
    )
  )
);

comment on table public.payroll_run_files is
  'Finance-only metadata for private payroll source, external layout, CFDI, and channel receipt files.';
comment on column public.payroll_run_files.parsing_metadata is
  'Redacted allowlist only. Raw rows, employee identifiers, accounts, and salary values are forbidden.';

create index payroll_run_files_request_kind_idx
  on public.payroll_run_files (payment_request_id, kind, uploaded_at);
create index payroll_run_files_channel_idx
  on public.payroll_run_files (payroll_channel_id, kind)
  where payroll_channel_id is not null;

alter table public.payroll_channels
  add constraint payroll_channels_layout_file_fkey
  foreign key (layout_file_id)
  references public.payroll_run_files(id)
  on delete set null;

create table public.payroll_run_lines (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null
    references public.payment_requests(id) on delete cascade,
  source_file_id uuid not null
    references public.payroll_run_files(id) on delete restrict,
  source_sheet text not null,
  source_row_number integer not null,
  extraction_version text not null,
  employee_name text not null,
  rfc text,
  curp text,
  nss text,
  bank_name text,
  bank_account text,
  clabe text,
  net_amount numeric(14,2) not null,
  bank_amount numeric(14,2) not null default 0,
  spei_amount numeric(14,2) not null default 0,
  vouchers_amount numeric(14,2) not null default 0,
  reconciliation_state text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_run_lines_source_row_key
    unique (payment_request_id, source_file_id, source_row_number),
  constraint payroll_run_lines_source_check check (
    source_row_number > 0
    and nullif(btrim(source_sheet), '') is not null
    and nullif(btrim(extraction_version), '') is not null
  ),
  constraint payroll_run_lines_identity_check check (
    nullif(btrim(employee_name), '') is not null
    and (
      nullif(btrim(rfc), '') is not null
      or nullif(btrim(curp), '') is not null
      or nullif(btrim(nss), '') is not null
    )
  ),
  constraint payroll_run_lines_amounts_check check (
    net_amount > 0
    and bank_amount >= 0
    and spei_amount >= 0
    and vouchers_amount >= 0
    and net_amount = bank_amount + spei_amount + vouchers_amount
    and bank_amount + spei_amount > 0
  ),
  constraint payroll_run_lines_reconciliation_state_check check (
    reconciliation_state in ('pending', 'matched', 'blocking_issue')
  )
);

comment on table public.payroll_run_lines is
  'Finance-only high-PII snapshot: one person in one payroll request. This is not an employee master.';

create index payroll_run_lines_request_source_idx
  on public.payroll_run_lines (
    payment_request_id,
    source_file_id,
    source_row_number
  );

-- No RFC, CURP, NSS, bank account, CLABE, or employee-name indexes are created.

create trigger payroll_channels_set_updated_at
before update on public.payroll_channels
for each row execute function public.set_updated_at();

create trigger payroll_run_files_set_updated_at
before update on public.payroll_run_files
for each row execute function public.set_updated_at();

create trigger payroll_run_lines_set_updated_at
before update on public.payroll_run_lines
for each row execute function public.set_updated_at();

create or replace function public.payroll_has_finance_pii_access()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_profile_id() is not null
    and public.current_user_has_role(array[
      'finance',
      'finanzas',
      'treasury',
      'tesoreria',
      'administracion'
    ]::text[]);
$$;

comment on function public.payroll_has_finance_pii_access() is
  'Interactive payroll PII gate. Intentionally excludes requester, director, and SysAdmin roles.';

revoke all on function public.payroll_has_finance_pii_access()
  from public, anon;
grant execute on function public.payroll_has_finance_pii_access()
  to authenticated, service_role;

create or replace function public.payroll_can_read_summary(
  p_payment_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.payroll_has_finance_pii_access()
    or exists (
      select 1
      from public.payment_requests request
      where request.id = p_payment_request_id
        and request.request_type::text = 'nomina'
        and (
          request.requested_by = public.current_profile_id()
          or request.approver_id = public.current_profile_id()
          or exists (
            select 1
            from public.company_directors director
            where director.company_id = request.company_id
              and director.director_profile_id = public.current_profile_id()
              and director.active
          )
        )
    );
$$;

comment on function public.payroll_can_read_summary(uuid) is
  'Allows payroll channel totals/status only to Finance, the requester/assigned approver, or the active company director.';

revoke all on function public.payroll_can_read_summary(uuid)
  from public, anon;
grant execute on function public.payroll_can_read_summary(uuid)
  to authenticated, service_role;

create or replace function public.payroll_validate_request_contract()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.request_type::text <> 'nomina' then
    return new;
  end if;

  if new.currency <> upper(new.currency)
     or not exists (
       select 1
       from public.company_bank_accounts account
       where account.id = new.company_bank_account_id
         and account.company_id = new.company_id
         and coalesce(account.active, true)
     ) then
    raise exception 'payroll_source_account_not_active_for_company';
  end if;

  return new;
end;
$$;

revoke all on function public.payroll_validate_request_contract()
  from public, anon, authenticated;

create trigger payment_requests_payroll_contract_guard
before insert or update of
  request_type,
  company_id,
  company_bank_account_id,
  currency,
  payroll_subtype,
  payroll_period_start,
  payroll_period_end
on public.payment_requests
for each row execute function public.payroll_validate_request_contract();

create or replace function public.payroll_validate_channel_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_layout_file public.payroll_run_files%rowtype;
begin
  select * into v_request
  from public.payment_requests
  where id = new.payment_request_id;

  if not found or v_request.request_type::text <> 'nomina' then
    raise exception 'payroll_channel_parent_must_be_nomina';
  end if;

  if new.currency <> upper(v_request.currency) then
    raise exception 'payroll_channel_currency_mismatch';
  end if;

  if new.layout_file_id is not null then
    select * into v_layout_file
    from public.payroll_run_files
    where id = new.layout_file_id;

    if not found
       or v_layout_file.payment_request_id <> new.payment_request_id
       or v_layout_file.payroll_channel_id <> new.id
       or (new.channel = 'banco' and v_layout_file.kind <> 'layout_mismo_banco')
       or (new.channel = 'spei' and v_layout_file.kind <> 'layout_spei')
       or (new.channel = 'vales' and v_layout_file.kind <> 'layout_toka') then
      raise exception 'payroll_channel_layout_file_mismatch';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.payroll_validate_channel_parent()
  from public, anon, authenticated;

create trigger payroll_channels_parent_guard
before insert or update on public.payroll_channels
for each row execute function public.payroll_validate_channel_parent();

create or replace function public.payroll_validate_file_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_type text;
  v_channel text;
  v_channel_request_id uuid;
begin
  select request.request_type::text into v_request_type
  from public.payment_requests request
  where request.id = new.payment_request_id;

  if v_request_type is distinct from 'nomina' then
    raise exception 'payroll_file_parent_must_be_nomina';
  end if;

  if new.payroll_channel_id is not null then
    select channel.channel, channel.payment_request_id
      into v_channel, v_channel_request_id
    from public.payroll_channels channel
    where channel.id = new.payroll_channel_id;

    if v_channel_request_id is distinct from new.payment_request_id
       or (new.kind = 'layout_mismo_banco' and v_channel <> 'banco')
       or (new.kind = 'layout_spei' and v_channel <> 'spei')
       or (new.kind in ('layout_toka', 'cfdi_vales') and v_channel <> 'vales') then
      raise exception 'payroll_file_channel_mismatch';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.payroll_validate_file_parent()
  from public, anon, authenticated;

create trigger payroll_run_files_parent_guard
before insert or update on public.payroll_run_files
for each row execute function public.payroll_validate_file_parent();

create or replace function public.payroll_validate_line_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_type text;
  v_file_request_id uuid;
  v_file_kind text;
begin
  select request.request_type::text into v_request_type
  from public.payment_requests request
  where request.id = new.payment_request_id;

  select file.payment_request_id, file.kind
    into v_file_request_id, v_file_kind
  from public.payroll_run_files file
  where file.id = new.source_file_id;

  if v_request_type is distinct from 'nomina'
     or v_file_request_id is distinct from new.payment_request_id
     or v_file_kind is distinct from 'caratula' then
    raise exception 'payroll_line_source_must_be_request_caratula';
  end if;

  return new;
end;
$$;

revoke all on function public.payroll_validate_line_parent()
  from public, anon, authenticated;

create trigger payroll_run_lines_parent_guard
before insert or update on public.payroll_run_lines
for each row execute function public.payroll_validate_line_parent();

create or replace function public.payroll_enforce_request_total()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_id uuid;
  v_request_type text;
  v_request_amount numeric;
  v_channel_count integer;
  v_channel_total numeric;
begin
  v_request_id := case
    when tg_table_name = 'payment_requests' then new.id
    else coalesce(new.payment_request_id, old.payment_request_id)
  end;

  select request.request_type::text, request.amount_requested
    into v_request_type, v_request_amount
  from public.payment_requests request
  where request.id = v_request_id;

  if not found then
    return null;
  end if;

  select count(*), coalesce(sum(channel.amount), 0)
    into v_channel_count, v_channel_total
  from public.payroll_channels channel
  where channel.payment_request_id = v_request_id;

  if v_request_type <> 'nomina' then
    if v_channel_count > 0 then
      raise exception 'payroll_channels_require_nomina_request';
    end if;
    return null;
  end if;

  if v_channel_count = 0 or v_channel_total <> v_request_amount then
    raise exception 'payroll_total_mismatch';
  end if;

  return null;
end;
$$;

revoke all on function public.payroll_enforce_request_total()
  from public, anon, authenticated;

create constraint trigger payroll_channels_total_guard
after insert or update or delete on public.payroll_channels
deferrable initially deferred
for each row execute function public.payroll_enforce_request_total();

create constraint trigger payment_requests_payroll_total_guard
after insert or update on public.payment_requests
deferrable initially deferred
for each row execute function public.payroll_enforce_request_total();

create or replace function public.payroll_redacted_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity_id uuid;
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_changed_fields text[];
begin
  v_entity_id := case when tg_op = 'DELETE' then old.id else new.id end;

  select coalesce(array_agg(field_name order by field_name), array[]::text[])
    into v_changed_fields
  from (
    select field_name
    from (
      select jsonb_object_keys(v_old) as field_name
      union
      select jsonb_object_keys(v_new) as field_name
    ) fields
    where v_old -> field_name is distinct from v_new -> field_name
  ) changed;

  insert into public.activity_log (
    entity_type,
    entity_id,
    action,
    old_values,
    new_values,
    performed_by,
    notes
  ) values (
    tg_table_name,
    v_entity_id,
    lower(tg_op),
    null,
    jsonb_build_object(
      'redacted', true,
      'changed_fields', to_jsonb(v_changed_fields)
    ),
    public.current_profile_id(),
    'Payroll audit stores field names only; PII and monetary values are redacted.'
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.payroll_redacted_audit()
  from public, anon, authenticated;

create trigger payroll_channels_redacted_audit
after insert or update or delete on public.payroll_channels
for each row execute function public.payroll_redacted_audit();

create trigger payroll_run_files_redacted_audit
after insert or update or delete on public.payroll_run_files
for each row execute function public.payroll_redacted_audit();

create trigger payroll_run_lines_redacted_audit
after insert or update or delete on public.payroll_run_lines
for each row execute function public.payroll_redacted_audit();

create or replace function public.payroll_reject_normal_layout_line()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.payment_requests request
    where request.id = new.payment_request_id
      and request.request_type::text = 'nomina'
  ) then
    raise exception 'payroll_external_layout_required';
  end if;

  return new;
end;
$$;

revoke all on function public.payroll_reject_normal_layout_line()
  from public, anon, authenticated;

create trigger payment_layout_lines_reject_payroll
before insert or update of payment_request_id
on public.payment_layout_lines
for each row execute function public.payroll_reject_normal_layout_line();

create or replace function public.approval_batch_payment_layout_candidates(
  p_period_start date,
  p_period_end date,
  p_company_id uuid default null,
  p_company_bank_account_id uuid default null
)
returns table (
  classification text,
  classification_reason text,
  payment_request_id uuid,
  request_number text,
  request_status text,
  company_id uuid,
  company_name text,
  proveedor_id uuid,
  provider_name text,
  company_bank_account_id uuid,
  source_account_number text,
  destination_type text,
  destination_value text,
  beneficiary_name text,
  amount numeric,
  currency text,
  payment_reference text,
  payment_concept text,
  scheduled_payment_date date,
  missing_fields text[],
  finance_approval_current boolean,
  direction_approval_current boolean,
  direction_decided_at timestamptz,
  enforcement_required boolean,
  source_item_id uuid,
  source_batch_id uuid,
  source_batch_label text,
  source_batch_status text,
  director_status text,
  reject_reason text,
  rejected_by uuid,
  rejected_by_name text,
  rejected_at timestamptz,
  rebatch_status text,
  latest_correction_note text,
  extraordinary_authorization_id uuid,
  extraordinary_category text,
  extraordinary_reason text,
  extraordinary_authorized_by uuid,
  extraordinary_authorized_by_name text,
  extraordinary_authorized_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    case
      when candidate.classification = 'ready_extraordinary'
        and not public.extraordinary_authorization_is_ready(
          candidate.extraordinary_authorization_id
        )
      then 'invalid_data'
      else candidate.classification
    end,
    case
      when candidate.classification = 'ready_extraordinary'
        and not public.extraordinary_authorization_is_ready(
          candidate.extraordinary_authorization_id
        )
      then 'extraordinary_not_ready_secure_contract'
      else candidate.classification_reason
    end,
    candidate.payment_request_id,
    candidate.request_number,
    candidate.request_status,
    candidate.company_id,
    candidate.company_name,
    candidate.proveedor_id,
    candidate.provider_name,
    candidate.company_bank_account_id,
    candidate.source_account_number,
    candidate.destination_type,
    candidate.destination_value,
    candidate.beneficiary_name,
    candidate.amount,
    candidate.currency,
    candidate.payment_reference,
    candidate.payment_concept,
    candidate.scheduled_payment_date,
    candidate.missing_fields,
    candidate.finance_approval_current,
    candidate.direction_approval_current,
    candidate.direction_decided_at,
    candidate.enforcement_required,
    candidate.source_item_id,
    candidate.source_batch_id,
    candidate.source_batch_label,
    candidate.source_batch_status,
    candidate.director_status,
    candidate.reject_reason,
    candidate.rejected_by,
    candidate.rejected_by_name,
    candidate.rejected_at,
    candidate.rebatch_status,
    candidate.latest_correction_note,
    candidate.extraordinary_authorization_id,
    candidate.extraordinary_category,
    candidate.extraordinary_reason,
    candidate.extraordinary_authorized_by,
    candidate.extraordinary_authorized_by_name,
    candidate.extraordinary_authorized_at
  from public.approval_batch_payment_layout_candidates_pre_037(
    p_period_start,
    p_period_end,
    p_company_id,
    p_company_bank_account_id
  ) candidate
  where not exists (
    select 1
    from public.payment_requests request
    where request.id = candidate.payment_request_id
      and request.request_type::text = 'nomina'
  );
$$;

comment on function public.approval_batch_payment_layout_candidates(
  date,
  date,
  uuid,
  uuid
) is
  'Fail-closed wrapper: payroll uses processor-provided layouts and is excluded from PAGOSBBV/PAGOSINT/CIE.';

alter table public.payroll_channels enable row level security;
alter table public.payroll_channels force row level security;
alter table public.payroll_run_files enable row level security;
alter table public.payroll_run_files force row level security;
alter table public.payroll_run_lines enable row level security;
alter table public.payroll_run_lines force row level security;

revoke all on table public.payroll_channels
  from public, anon, authenticated;
revoke all on table public.payroll_run_files
  from public, anon, authenticated;
revoke all on table public.payroll_run_lines
  from public, anon, authenticated;

grant select on table public.payroll_channels to authenticated;
grant select on table public.payroll_run_files to authenticated;
grant select on table public.payroll_run_lines to authenticated;
grant all on table public.payroll_channels to service_role;
grant all on table public.payroll_run_files to service_role;
grant all on table public.payroll_run_lines to service_role;

create policy payroll_channels_summary_select
on public.payroll_channels
for select
to authenticated
using (public.payroll_can_read_summary(payment_request_id));

create policy payroll_run_files_finance_select
on public.payroll_run_files
for select
to authenticated
using (public.payroll_has_finance_pii_access());

create policy payroll_run_lines_finance_select
on public.payroll_run_lines
for select
to authenticated
using (public.payroll_has_finance_pii_access());

insert into storage.buckets (
  id,
  name,
  public,
  avif_autodetection,
  file_size_limit,
  allowed_mime_types
) values (
  'payroll-private',
  'payroll-private',
  false,
  false,
  26214400,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/xml',
    'text/xml',
    'application/pdf'
  ]::text[]
)
on conflict (id) do nothing;

drop policy if exists payroll_private_finance_select on storage.objects;
create policy payroll_private_finance_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payroll-private'
  and name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'
  and public.payroll_has_finance_pii_access()
);

drop policy if exists payroll_private_finance_insert on storage.objects;
create policy payroll_private_finance_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payroll-private'
  and name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'
  and public.payroll_has_finance_pii_access()
);

drop policy if exists payroll_private_finance_update on storage.objects;
create policy payroll_private_finance_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'payroll-private'
  and public.payroll_has_finance_pii_access()
)
with check (
  bucket_id = 'payroll-private'
  and name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'
  and public.payroll_has_finance_pii_access()
);

-- No DELETE policy is created. Deletion/retention requires a separate,
-- explicitly authorized lifecycle contract.

do $postcheck$
begin
  if to_regclass('public.payroll_channels') is null
     or to_regclass('public.payroll_run_files') is null
     or to_regclass('public.payroll_run_lines') is null
     or to_regprocedure('public.payroll_has_finance_pii_access()') is null
     or to_regprocedure('public.payroll_can_read_summary(uuid)') is null then
    raise exception 'payroll_n0_foundation_incomplete';
  end if;

  if not exists (
    select 1
    from pg_proc function_info
    where function_info.oid =
      'public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)'
        ::regprocedure
      and position(
        'request.request_type::text = ''nomina'''
        in function_info.prosrc
      ) > 0
  ) then
    raise exception 'payroll_layout_candidate_exclusion_missing';
  end if;
end
$postcheck$;

commit;
