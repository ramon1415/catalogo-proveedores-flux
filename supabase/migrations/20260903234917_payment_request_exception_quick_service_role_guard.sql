-- Forward fix for PR #529: service-role calls made through PostgREST enter
-- SECURITY DEFINER functions with current_user set to the function owner, while
-- current_setting('role') preserves the effective API role. The original guard
-- checked only the legacy JWT claim/session_user paths and rejected legitimate
-- service_role traffic from the Edge Function.
--
-- Keep the helper itself private. Only the public preview/approve RPCs remain
-- executable by service_role; anon and authenticated keep no direct access.

create or replace function public.payment_request_exception_quick_require_service_role()
returns void
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if coalesce(current_setting('role', true), '') <> 'service_role'
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and session_user <> 'service_role'
     and current_user <> 'service_role' then
    raise exception 'quick_approval_service_role_required' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.payment_request_exception_quick_require_service_role()
  from public, anon, authenticated, service_role;
