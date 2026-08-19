-- N3B hardening: decisions remain writable only through trusted RPCs.
-- The frontend reads payment_request_approvals directly, but writes decisions
-- through decide_payment_request(). Prevent an authenticated approver from
-- fabricating an approval row and pairing it with a direct payment_requests
-- status update in the same transaction.

begin;

do $precheck$
begin
  if to_regclass('public.payment_request_approvals') is null then
    raise exception 'payroll_n3b_approval_table_missing';
  end if;
  if to_regprocedure('public.decide_payment_request(uuid,uuid,text,text)') is null then
    raise exception 'payroll_n3b_decision_rpc_missing';
  end if;
end;
$precheck$;

revoke insert, update, delete, truncate, references, trigger
  on table public.payment_request_approvals
  from anon, authenticated;

-- Preserve the existing read model used by Solicitudes/Aprobaciones.
grant select on table public.payment_request_approvals to authenticated;

-- Decisions continue to enter through the existing authorization/rule engine.
grant execute on function public.decide_payment_request(uuid,uuid,text,text)
  to authenticated, service_role;

do $postcheck$
begin
  if has_table_privilege('authenticated', 'public.payment_request_approvals', 'INSERT')
     or has_table_privilege('authenticated', 'public.payment_request_approvals', 'UPDATE')
     or has_table_privilege('authenticated', 'public.payment_request_approvals', 'DELETE')
     or has_table_privilege('anon', 'public.payment_request_approvals', 'INSERT')
     or has_table_privilege('anon', 'public.payment_request_approvals', 'UPDATE')
     or has_table_privilege('anon', 'public.payment_request_approvals', 'DELETE') then
    raise exception 'payroll_n3b_direct_approval_write_still_allowed';
  end if;
  if not has_table_privilege('authenticated', 'public.payment_request_approvals', 'SELECT') then
    raise exception 'payroll_n3b_approval_history_read_broken';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.decide_payment_request(uuid,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'payroll_n3b_decision_rpc_not_executable';
  end if;
end;
$postcheck$;

commit;
