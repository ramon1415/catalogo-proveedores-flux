-- Forward fix: SECURITY DEFINER exposes the function owner as the execution role.
-- Read the verified request role claim instead so pure service-role calls keep
-- their existing administrative compatibility. User-token calls still pass
-- through Finance + active-company membership checks.

begin;

create or replace function public.payroll_active_company_access(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
    or (
      p_company_id is not null
      and public.current_profile_id() is not null
      and public.payroll_has_finance_pii_access()
      and public.has_active_company_membership(public.current_profile_id(), p_company_id)
    );
$$;

revoke all on function public.payroll_active_company_access(uuid) from public, anon;
grant execute on function public.payroll_active_company_access(uuid) to authenticated, service_role;

create or replace function public.get_payroll_capture_sessions(p_session_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_unscoped jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' then
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

commit;
