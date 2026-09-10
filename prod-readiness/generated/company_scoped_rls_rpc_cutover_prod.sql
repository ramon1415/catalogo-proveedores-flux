-- Company-scoped authorization cutover, PROD compatibility wave.
--
-- Generated from the DEV-certified wave. PROD intentionally lacks the optional
-- CFDI preview and operational Payroll tables; their modules remain out of
-- scope. The guards below fail if that inventory changes.
--
-- This migration intentionally depends on
-- 20260901055111_company_scoped_roles_foundation.sql. It removes global
-- business-role checks from the shared payment, Finance, payroll, and CONTPAQ
-- surfaces. Global SysAdmin remains an explicit override inside the private
-- helper and is reserved for the approved platform-power accounts.

begin;

-- Keep the privileged lookup out of the exposed schema. The foundation helper
-- is SECURITY DEFINER, pins search_path to '', validates the current profile
-- passed by this wrapper, and grants execution only to authenticated/service.
create or replace function private.current_profile_has_company_role(
  p_company_id uuid,
  p_roles text[]
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select p_company_id is not null
    and public.current_profile_id() is not null
    and private.profile_has_company_role(
      public.current_profile_id(),
      p_company_id,
      p_roles
    );
$function$;

revoke all on function private.current_profile_has_company_role(uuid, text[])
  from public, anon;
grant execute on function private.current_profile_has_company_role(uuid, text[])
  to authenticated, service_role;

-- Solicitudes: Operador sees and changes only their own rows. Finance and
-- Director see company rows. SysAdmin is handled by the private helper.
drop policy if exists payment_requests_insert on public.payment_requests;
create policy payment_requests_insert
on public.payment_requests for insert to authenticated
with check (
  requested_by = (select public.current_profile_id())
  and (select private.current_profile_has_company_role(
    company_id,
    array['operator','finance','director']::text[]
  ))
);

drop policy if exists payment_requests_select on public.payment_requests;
create policy payment_requests_select
on public.payment_requests for select to authenticated
using (
  (
    requested_by = (select public.current_profile_id())
    and (select private.current_profile_has_company_role(
      company_id,
      array['operator','finance','director']::text[]
    ))
  )
  or (select private.current_profile_has_company_role(
    company_id,
    array['finance','director']::text[]
  ))
);

drop policy if exists payment_requests_update on public.payment_requests;
create policy payment_requests_update
on public.payment_requests for update to authenticated
using (
  (
    requested_by = (select public.current_profile_id())
    and (select private.current_profile_has_company_role(
      company_id,
      array['operator','finance','director']::text[]
    ))
  )
  or (select private.current_profile_has_company_role(
    company_id,
    array['finance','director']::text[]
  ))
)
with check (
  (
    requested_by = (select public.current_profile_id())
    and (select private.current_profile_has_company_role(
      company_id,
      array['operator','finance','director']::text[]
    ))
  )
  or (select private.current_profile_has_company_role(
    company_id,
    array['finance','director']::text[]
  ))
);

-- Optional CFDI preview is not released in PROD.
do $prod_cfdi_inventory$
begin
  if to_regclass('public.payment_request_cfdi_facts') is not null then
    raise exception 'prod_company_cutover_cfdi_inventory_changed';
  end if;
end
$prod_cfdi_inventory$;

-- Finance ingestion data is visible only to Finance in the row's company.
drop policy if exists payment_intake_select_finance_company
  on public.payment_intake;
create policy payment_intake_select_finance_company
on public.payment_intake for select to authenticated
using ((select private.current_profile_has_company_role(
  company_id,
  array['finance']::text[]
)));

drop policy if exists payment_intake_events_select_finance_company
  on public.payment_intake_events;
create policy payment_intake_events_select_finance_company
on public.payment_intake_events for select to authenticated
using (
  exists (
    select 1
    from public.payment_intake pi
    where pi.id = payment_intake_events.payment_intake_id
      and (select private.current_profile_has_company_role(
        pi.company_id,
        array['finance']::text[]
      ))
  )
);

drop policy if exists payment_intake_files_select_finance_company
  on public.payment_intake_files;
create policy payment_intake_files_select_finance_company
on public.payment_intake_files for select to authenticated
using (
  exists (
    select 1
    from public.payment_intake pi
    where pi.id = payment_intake_files.payment_intake_id
      and (select private.current_profile_has_company_role(
        pi.company_id,
        array['finance']::text[]
      ))
  )
);

-- Company Finance configuration and approval surfaces.
drop policy if exists approval_batch_company_settings_read_finance
  on public.approval_batch_company_settings;
create policy approval_batch_company_settings_read_finance
on public.approval_batch_company_settings for select to authenticated
using ((select private.current_profile_has_company_role(
  company_id,
  array['finance']::text[]
)));

drop policy if exists approval_batch_company_setting_events_read_finance
  on public.approval_batch_company_setting_events;
create policy approval_batch_company_setting_events_read_finance
on public.approval_batch_company_setting_events for select to authenticated
using ((select private.current_profile_has_company_role(
  company_id,
  array['finance']::text[]
)));

drop policy if exists approval_batches_read_authorized
  on public.approval_batches;
create policy approval_batches_read_authorized
on public.approval_batches for select to authenticated
using (
  (select private.current_profile_has_company_role(
    company_id,
    array['finance']::text[]
  ))
  or (
    director_id = (select public.current_profile_id())
    and (select private.current_profile_has_company_role(
      company_id,
      array['director']::text[]
    ))
  )
);

drop policy if exists company_bank_accounts_read on public.company_bank_accounts;
drop policy if exists cba_select on public.company_bank_accounts;
create policy cba_select
on public.company_bank_accounts for select to authenticated
using ((select private.current_profile_has_company_role(
  company_id,
  array['operator','finance','director']::text[]
)));

drop policy if exists cba_write on public.company_bank_accounts;
create policy cba_write
on public.company_bank_accounts for all to authenticated
using ((select private.current_profile_has_company_role(
  company_id,
  array['finance']::text[]
)))
with check ((select private.current_profile_has_company_role(
  company_id,
  array['finance']::text[]
)));

-- Efectivo: the responsible profile may read its own fund only while it has an
-- active role in that company. Finance and Director manage the exact company.
drop policy if exists "cash funds manageable by finance roles"
  on public.cash_funds;
drop policy if exists "cash funds readable by owner or finance roles"
  on public.cash_funds;
drop policy if exists cash_funds_select_company
  on public.cash_funds;
drop policy if exists cash_funds_manage_company
  on public.cash_funds;
drop policy if exists cash_funds_insert_company
  on public.cash_funds;
drop policy if exists cash_funds_update_company
  on public.cash_funds;
drop policy if exists cash_funds_delete_company
  on public.cash_funds;
create policy cash_funds_select_company
on public.cash_funds for select to authenticated
using (
  (
    responsible_profile_id = (select public.current_profile_id())
    and (select private.current_profile_has_company_role(
      company_id,
      array['operator','finance','director']::text[]
    ))
  )
  or (select private.current_profile_has_company_role(
    company_id,
    array['finance','director']::text[]
  ))
);
create policy cash_funds_insert_company
on public.cash_funds for insert to authenticated
with check ((select private.current_profile_has_company_role(
  company_id,
  array['finance','director']::text[]
)));
create policy cash_funds_update_company
on public.cash_funds for update to authenticated
using ((select private.current_profile_has_company_role(
  company_id,
  array['finance','director']::text[]
)))
with check ((select private.current_profile_has_company_role(
  company_id,
  array['finance','director']::text[]
)));
create policy cash_funds_delete_company
on public.cash_funds for delete to authenticated
using ((select private.current_profile_has_company_role(
  company_id,
  array['finance','director']::text[]
)));

drop policy if exists company_directors_read_authorized
  on public.company_directors;
create policy company_directors_read_authorized
on public.company_directors for select to authenticated
using (
  (select private.current_profile_has_company_role(
    company_id,
    array['finance']::text[]
  ))
  or (
    director_profile_id = (select public.current_profile_id())
    and (select private.current_profile_has_company_role(
      company_id,
      array['director']::text[]
    ))
  )
);

drop policy if exists extraordinary_payment_policies_read
  on public.extraordinary_payment_policies;
create policy extraordinary_payment_policies_read
on public.extraordinary_payment_policies for select to authenticated
using ((select private.current_profile_has_company_role(
  company_id,
  array['finance']::text[]
)));

drop policy if exists incident_charges_authorized_all
  on public.incident_charges;
drop policy if exists incident_charges_authorized_select
  on public.incident_charges;
create policy incident_charges_authorized_select
on public.incident_charges for select to authenticated
using ((select private.current_profile_has_company_role(
  company_id,
  array['finance','director']::text[]
)));
create policy incident_charges_authorized_all
on public.incident_charges for all to authenticated
using ((select private.current_profile_has_company_role(
  company_id,
  array['finance','director']::text[]
)))
with check ((select private.current_profile_has_company_role(
  company_id,
  array['finance','director']::text[]
)));

drop policy if exists payment_request_extraordinary_read_authorized
  on public.payment_request_extraordinary_authorizations;
create policy payment_request_extraordinary_read_authorized
on public.payment_request_extraordinary_authorizations for select to authenticated
using (
  exists (
    select 1
    from public.payment_requests pr
    where pr.id = payment_request_extraordinary_authorizations.payment_request_id
      and (
        (
          pr.requested_by = (select public.current_profile_id())
          and (select private.current_profile_has_company_role(
            pr.company_id,
            array['operator','finance','director']::text[]
          ))
        )
        or (select private.current_profile_has_company_role(
          pr.company_id,
          array['finance','director']::text[]
        ))
      )
  )
);

-- CONTPAQ mapper access becomes Finance-by-company. The existing table
-- policies and mapper RPCs already call this function.
create or replace function public.contpaq_mapper_company_access(p_company_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select private.current_profile_has_company_role(
    p_company_id,
    array['finance']::text[]
  );
$function$;

revoke all on function public.contpaq_mapper_company_access(uuid)
  from public, anon;
grant execute on function public.contpaq_mapper_company_access(uuid)
  to authenticated, service_role;

drop policy if exists budget_categories_write on public.budget_categories;
-- budget_categories is a shared global catalogue and intentionally has no
-- company_id. Authenticated writes stay fail-closed; company-specific budget
-- configuration belongs to the mapping tables that carry company_id.

-- Payroll is high-PII: only Finance in the exact company, while service_role
-- remains available for the server-side materialization path.
create or replace function public.payroll_active_company_access(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
    or private.current_profile_has_company_role(
      p_company_id,
      array['finance']::text[]
    );
$function$;

revoke all on function public.payroll_active_company_access(uuid)
  from public, anon;
grant execute on function public.payroll_active_company_access(uuid)
  to authenticated, service_role;

do $prod_payroll_inventory$
declare
  v_present text;
begin
  select string_agg(name, ', ' order by name)
  into v_present
  from unnest(array[
    'payroll_provision_settings',
    'payroll_provision_entries',
    'payroll_contpaq_role_mappings',
    'payroll_contpaq_bank_mappings'
  ]) name
  where to_regclass('public.' || name) is not null;

  if v_present is not null then
    raise exception 'prod_company_cutover_payroll_inventory_changed: %', v_present;
  end if;
end
$prod_payroll_inventory$;

-- Fail the migration if the central policy wave accidentally leaves a global
-- business-role predicate in a direct company_id policy.
do $postcheck$
declare
  v_blockers text;
begin
  select string_agg(
    format('%I.%I:%I', schemaname, tablename, policyname),
    ', ' order by tablename, policyname
  )
  into v_blockers
  from pg_policies
  where schemaname = 'public'
    and tablename = any(array[
      'approval_batch_company_setting_events',
      'approval_batch_company_settings',
      'approval_batches',
      'budget_categories',
      'cash_funds',
      'company_bank_accounts',
      'company_directors',
      'extraordinary_payment_policies',
      'incident_charges',
      'payment_intake',
      'payment_request_cfdi_facts',
      'payment_requests',
      'payroll_provision_settings',
      'payroll_provision_entries',
      'payroll_contpaq_role_mappings',
      'payroll_contpaq_bank_mappings'
    ])
    and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      ~* 'current_user_has_role|flux_(finance|approver|member)_roles';

  if v_blockers is not null then
    raise exception 'company_role_wave1_policy_postcheck_failed: %', v_blockers;
  end if;
end
$postcheck$;

commit;
