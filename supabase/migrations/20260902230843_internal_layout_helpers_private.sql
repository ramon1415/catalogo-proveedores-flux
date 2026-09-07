begin;

revoke execute on function public.payment_request_layout_missing_fields(public.payment_requests)
  from public, anon, authenticated;
grant execute on function public.payment_request_layout_missing_fields(public.payment_requests)
  to service_role;

revoke execute on function public.approval_batch_payment_layout_candidates(date, date, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.approval_batch_payment_layout_candidates(date, date, uuid, uuid)
  to service_role;

comment on function public.payment_request_layout_missing_fields(public.payment_requests) is
  'Internal layout validation helper; callable only by trusted server-side functions and service_role.';
comment on function public.approval_batch_payment_layout_candidates(date, date, uuid, uuid) is
  'Internal layout candidate wrapper; public clients must use guarded preview/create RPCs.';

commit;
