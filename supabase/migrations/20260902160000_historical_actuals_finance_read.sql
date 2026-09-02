-- El histórico del dashboard era invisible para Finanzas/Dirección (SELECT
-- solo sysadmin) → el dashboard anual salía vacío para Cesar/Lis/Denise.
-- Lectura: sysadmin global, o rol Finanzas/Dirección CON membresía activa en
-- la empresa de la fila (scoping multi-tenant). Escrituras siguen sysadmin.
drop policy if exists historical_actuals_select_strict_sysadmin on public.historical_actuals;

create policy historical_actuals_select_finance on public.historical_actuals
  for select using (
    public.current_user_has_role(array['sysadmin','system_admin','superadmin'])
    or (
      public.current_user_has_role(array['finance','finanzas','treasury','tesoreria','administracion','direccion','director','approver_2','aprobador_2'])
      and public.has_active_company_membership(public.current_profile_id(), company_id)
    )
  );
