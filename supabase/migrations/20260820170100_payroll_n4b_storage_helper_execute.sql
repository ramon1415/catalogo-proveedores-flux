-- N4B storage-policy helper execution grant.
-- The helper is read-only and is invoked from the authenticated storage INSERT policy.
begin;

revoke all on function public.payroll_run_file_storage_insert_allowed(text) from public,anon;
grant execute on function public.payroll_run_file_storage_insert_allowed(text) to authenticated;

commit;
