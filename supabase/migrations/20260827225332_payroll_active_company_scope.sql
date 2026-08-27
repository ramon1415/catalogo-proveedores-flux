-- QA gate · Nómina React — aislamiento por empresa activa.
--
-- El contrato original protegía la captura por rol Finanzas, pero no exigía
-- membresía de empresa en los RPC de staging ni en Storage. Este forward fix
-- conserva las firmas públicas y envuelve la implementación existente con un
-- guard de membresía activo. No habilita el módulo ni modifica datos.

begin;

create or replace function public.payroll_active_company_access(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.role() = 'service_role'
    or (
      p_company_id is not null
      and public.current_profile_id() is not null
      and public.payroll_has_finance_pii_access()
      and public.has_active_company_membership(public.current_profile_id(), p_company_id)
    );
$$;

revoke all on function public.payroll_active_company_access(uuid) from public, anon;
grant execute on function public.payroll_active_company_access(uuid) to authenticated, service_role;

-- Conservar la implementación probada detrás de wrappers con la misma firma.
alter function public.save_payroll_capture_session(
  uuid, integer, uuid, uuid, text, date, date, text, text, text[]
) rename to save_payroll_capture_session_unscoped_internal;

alter function public.reserve_payroll_capture_file(
  uuid, integer, text, text, text, bigint, text, text, text, integer, bigint
) rename to reserve_payroll_capture_file_unscoped_internal;

alter function public.confirm_payroll_capture_file(uuid, text)
  rename to confirm_payroll_capture_file_unscoped_internal;

alter function public.get_payroll_capture_sessions(uuid)
  rename to get_payroll_capture_sessions_unscoped_internal;

alter function public.payroll_capture_storage_insert_allowed(text)
  rename to payroll_capture_storage_insert_allowed_unscoped_internal;

alter function public.payroll_capture_storage_select_allowed(text)
  rename to payroll_capture_storage_select_allowed_unscoped_internal;

revoke all on function public.save_payroll_capture_session_unscoped_internal(
  uuid, integer, uuid, uuid, text, date, date, text, text, text[]
) from public, anon, authenticated;
revoke all on function public.reserve_payroll_capture_file_unscoped_internal(
  uuid, integer, text, text, text, bigint, text, text, text, integer, bigint
) from public, anon, authenticated;
revoke all on function public.confirm_payroll_capture_file_unscoped_internal(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_payroll_capture_sessions_unscoped_internal(uuid)
  from public, anon, authenticated;
revoke all on function public.payroll_capture_storage_insert_allowed_unscoped_internal(text)
  from public, anon, authenticated;
revoke all on function public.payroll_capture_storage_select_allowed_unscoped_internal(text)
  from public, anon, authenticated;

grant execute on function public.save_payroll_capture_session_unscoped_internal(
  uuid, integer, uuid, uuid, text, date, date, text, text, text[]
) to service_role;
grant execute on function public.reserve_payroll_capture_file_unscoped_internal(
  uuid, integer, text, text, text, bigint, text, text, text, integer, bigint
) to service_role;
grant execute on function public.confirm_payroll_capture_file_unscoped_internal(uuid, text)
  to service_role;
grant execute on function public.get_payroll_capture_sessions_unscoped_internal(uuid)
  to service_role;

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
  v_existing_company_id uuid;
begin
  if not public.payroll_active_company_access(p_company_id) then
    raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
  end if;

  if p_session_id is not null then
    select company_id into v_existing_company_id
    from public.payroll_capture_sessions
    where id = p_session_id;

    if v_existing_company_id is null then
      raise exception 'PAYROLL_CAPTURE_SESSION_NOT_FOUND';
    end if;
    if not public.payroll_active_company_access(v_existing_company_id) then
      raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
    end if;
  end if;

  return public.save_payroll_capture_session_unscoped_internal(
    p_session_id,
    p_expected_version,
    p_company_id,
    p_company_bank_account_id,
    p_payroll_subtype,
    p_period_start,
    p_period_end,
    p_concept,
    p_notes,
    p_expected_channels
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
  v_company_id uuid;
begin
  select company_id into v_company_id
  from public.payroll_capture_sessions
  where id = p_session_id;

  if v_company_id is null then
    raise exception 'PAYROLL_CAPTURE_SESSION_NOT_FOUND';
  end if;
  if not public.payroll_active_company_access(v_company_id) then
    raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
  end if;

  return public.reserve_payroll_capture_file_unscoped_internal(
    p_session_id,
    p_expected_version,
    p_kind,
    p_extension,
    p_mime_type,
    p_size_bytes,
    p_sha256,
    p_parser_version,
    p_parser_contract,
    p_record_count,
    p_total_amount_minor
  );
end;
$$;

revoke all on function public.reserve_payroll_capture_file(
  uuid, integer, text, text, text, bigint, text, text, text, integer, bigint
) from public, anon;
grant execute on function public.reserve_payroll_capture_file(
  uuid, integer, text, text, text, bigint, text, text, text, integer, bigint
) to authenticated, service_role;

create function public.confirm_payroll_capture_file(p_file_id uuid, p_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_company_id uuid;
begin
  select session.company_id into v_company_id
  from public.payroll_capture_files file
  join public.payroll_capture_sessions session on session.id = file.session_id
  where file.id = p_file_id;

  if v_company_id is null then
    raise exception 'PAYROLL_CAPTURE_FILE_RESERVATION_NOT_FOUND';
  end if;
  if not public.payroll_active_company_access(v_company_id) then
    raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
  end if;

  return public.confirm_payroll_capture_file_unscoped_internal(p_file_id, p_sha256);
end;
$$;

revoke all on function public.confirm_payroll_capture_file(uuid, text) from public, anon;
grant execute on function public.confirm_payroll_capture_file(uuid, text) to authenticated, service_role;

create function public.get_payroll_capture_sessions(p_session_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_unscoped jsonb;
begin
  if auth.role() = 'service_role' then
    return public.get_payroll_capture_sessions_unscoped_internal(p_session_id);
  end if;

  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'PAYROLL_CAPTURE_FINANCE_REQUIRED';
  end if;

  v_unscoped := public.get_payroll_capture_sessions_unscoped_internal(p_session_id);

  return coalesce((
    select jsonb_agg(item)
    from jsonb_array_elements(v_unscoped) item
    where public.has_active_company_membership(v_actor, (item ->> 'company_id')::uuid)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_payroll_capture_sessions(uuid) from public, anon;
grant execute on function public.get_payroll_capture_sessions(uuid) to authenticated, service_role;

create function public.payroll_storage_company_access(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
begin
  if p_name is null or p_name !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then
    return false;
  end if;

  v_company_id := split_part(p_name, '/', 1)::uuid;
  return public.payroll_active_company_access(v_company_id);
end;
$$;

revoke all on function public.payroll_storage_company_access(text) from public, anon;
grant execute on function public.payroll_storage_company_access(text) to authenticated, service_role;

create function public.payroll_capture_storage_insert_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.payroll_storage_company_access(p_name)
    and public.payroll_capture_storage_insert_allowed_unscoped_internal(p_name);
$$;

create function public.payroll_capture_storage_select_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.payroll_storage_company_access(p_name)
    and public.payroll_capture_storage_select_allowed_unscoped_internal(p_name);
$$;

revoke all on function public.payroll_capture_storage_insert_allowed(text) from public, anon;
revoke all on function public.payroll_capture_storage_select_allowed(text) from public, anon;
grant execute on function public.payroll_capture_storage_insert_allowed(text) to authenticated, service_role;
grant execute on function public.payroll_capture_storage_select_allowed(text) to authenticated, service_role;

-- Rebind policies after the helper functions were renamed. PostgreSQL policies
-- retain function OIDs across a rename, so recreating them is required.
drop policy if exists payroll_private_capture_finance_insert on storage.objects;
create policy payroll_private_capture_finance_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'payroll-private'
  and public.payroll_capture_storage_insert_allowed(name)
);

drop policy if exists payroll_private_capture_finance_select on storage.objects;
create policy payroll_private_capture_finance_select
on storage.objects for select to authenticated
using (
  bucket_id = 'payroll-private'
  and public.payroll_capture_storage_select_allowed(name)
);

drop policy if exists payroll_private_finance_select on storage.objects;
create policy payroll_private_finance_select
on storage.objects for select to authenticated
using (
  bucket_id = 'payroll-private'
  and name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'
  and public.payroll_storage_company_access(name)
);

-- La policy general de INSERT vigente pertenece a N4B y llama a
-- payroll_run_file_storage_insert_allowed(), que ya valida membresía contra
-- payment_requests.company_id. No se reemplaza aquí para no romper la carga
-- de comprobantes de dispersión.

drop policy if exists payroll_private_finance_update on storage.objects;
create policy payroll_private_finance_update
on storage.objects for update to authenticated
using (
  bucket_id = 'payroll-private'
  and public.payroll_storage_company_access(name)
)
with check (
  bucket_id = 'payroll-private'
  and name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'
  and public.payroll_storage_company_access(name)
);

commit;
