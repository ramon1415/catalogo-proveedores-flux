-- DEV-only hotfix (ledger 20260826214616): PostgREST exposes JWT claims through request.jwt.claims.
-- Keep the legacy scalar GUC only as a compatibility fallback.
create or replace function public.approval_batch_quick_require_service_role()
returns void
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request_role text := coalesce(
    auth.jwt() ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    ''
  );
begin
  if v_request_role <> 'service_role'
     and session_user <> 'service_role' then
    raise exception 'quick_approval_service_role_required' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.approval_batch_quick_require_service_role()
  from public, anon, authenticated, service_role;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.approval_batch_quick_require_service_role()'::regprocedure)
    into v_definition;

  if position('auth.jwt()' in v_definition) = 0
     or position('request.jwt.claim.role' in v_definition) = 0 then
    raise exception 'approval_batch_quick_service_role_claims_hotfix_postcheck_failed';
  end if;

  if has_function_privilege('anon', 'public.approval_batch_quick_require_service_role()', 'execute')
     or has_function_privilege('authenticated', 'public.approval_batch_quick_require_service_role()', 'execute') then
    raise exception 'approval_batch_quick_service_role_guard_public_execute';
  end if;
end;
$$;

comment on function public.approval_batch_quick_require_service_role() is
  'Requires the PostgREST service_role JWT claim from request.jwt.claims; legacy scalar claim and direct service_role sessions are compatibility fallbacks.';
