begin;

-- La bandeja operativa es estrictamente personal. Finanzas y Dirección
-- conservan la vista de las empresas donde tienen membresía activa, mientras
-- que SysAdmin conserva el alcance global necesario para soporte.
drop policy if exists payment_requests_select on public.payment_requests;

create policy payment_requests_select
on public.payment_requests
for select
to authenticated
using (
  (select public.current_user_has_role(public.flux_sysadmin_roles()))
  or (
    public.has_active_company_membership(
      (select public.current_profile_id()),
      company_id
    )
    and (
      requested_by = (select public.current_profile_id())
      or (select public.current_user_has_role(public.flux_approver_roles()))
    )
  )
);

create index if not exists payment_requests_requested_by_company_id_idx
  on public.payment_requests (requested_by, company_id);

do $postcheck$
declare
  v_policy text;
begin
  select qual
  into v_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'payment_requests'
    and policyname = 'payment_requests_select';

  if v_policy is null
     or v_policy not ilike '%requested_by%current_profile_id%'
     or v_policy not ilike '%has_active_company_membership%'
     or v_policy ilike '%approver_id =%'
  then
    raise exception 'operator_own_payment_requests_policy_postcheck_failed';
  end if;
end
$postcheck$;

commit;
