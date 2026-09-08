-- DEV: contexto autorizado para firmar la descarga de un archivo de captura.
-- La URL firmada se emite en Edge Function; esta RPC no expone el path al navegador.

begin;

create or replace function public.get_payroll_capture_file_url(p_file_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := public.current_profile_id();
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
  v_file record;
begin
  if p_file_id is null then
    raise exception 'PAYROLL_CAPTURE_FILE_ID_REQUIRED';
  end if;

  select
    f.id,
    f.kind,
    f.storage_bucket,
    f.storage_path,
    f.extension,
    f.upload_state,
    f.is_current,
    s.id as session_id,
    s.company_id,
    s.capture_state,
    s.expires_at
  into v_file
  from public.payroll_capture_files f
  join public.payroll_capture_sessions s on s.id = f.session_id
  where f.id = p_file_id
    and f.upload_state = 'uploaded'
    and f.is_current;

  if not found then
    raise exception 'PAYROLL_CAPTURE_FILE_NOT_FOUND';
  end if;

  if not v_is_service then
    if v_actor is null or not public.payroll_has_finance_pii_access() then
      raise exception 'PAYROLL_CAPTURE_FINANCE_REQUIRED';
    end if;

    if not public.has_active_company_membership(v_actor, v_file.company_id) then
      raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
    end if;

    if not (
      (v_file.expires_at > now() and v_file.capture_state <> 'materialized')
      or
      (
        v_file.capture_state = 'materialized'
        and exists (
          select 1
          from public.payroll_run_files rf
          where rf.capture_file_id = v_file.id
        )
      )
    ) then
      raise exception 'PAYROLL_CAPTURE_FILE_NOT_DOWNLOADABLE';
    end if;
  end if;

  if v_file.storage_bucket <> 'payroll-private' then
    raise exception 'PAYROLL_CAPTURE_FILE_SCOPE_MISMATCH';
  end if;

  if v_file.storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$' then
    raise exception 'PAYROLL_CAPTURE_FILE_SCOPE_MISMATCH';
  end if;

  return jsonb_build_object(
    'file_id', v_file.id,
    'storage_bucket', v_file.storage_bucket,
    'storage_path', v_file.storage_path,
    'download_name', v_file.kind || '.' || v_file.extension
  );
end;
$function$;

revoke all on function public.get_payroll_capture_file_url(uuid) from public, anon;
grant execute on function public.get_payroll_capture_file_url(uuid) to authenticated, service_role;

commit;
