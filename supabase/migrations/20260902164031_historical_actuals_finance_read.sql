-- Reproduce the migration version already applied in DEV.
-- A later forward migration replaces this transitional legacy-role policy.
drop policy if exists historical_actuals_select_strict_sysadmin
  on public.historical_actuals;

create policy historical_actuals_select_finance
  on public.historical_actuals
  for select
  using (
    public.current_user_has_role(
      array['sysadmin','system_admin','superadmin']::text[]
    )
    or (
      public.current_user_has_role(
        array[
          'finance','finanzas','treasury','tesoreria','administracion',
          'direccion','director','approver_2','aprobador_2'
        ]::text[]
      )
      and public.has_active_company_membership(
        public.current_profile_id(),
        company_id
      )
    )
  );
