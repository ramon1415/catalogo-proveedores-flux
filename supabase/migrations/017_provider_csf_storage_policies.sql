-- Permite a usuarios autenticados cargar y consultar CSF de proveedores.
-- El bucket permanece privado y el acceso se limita a payment-receipts/csf/.

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated can upload provider CSF'
  ) then
    execute $policy$
      create policy "Authenticated can upload provider CSF"
        on storage.objects
        as permissive
        for insert
        to authenticated
        with check (
          bucket_id = 'payment-receipts'
          and name like 'csf/%'
          and public.current_user_has_role(public.flux_approver_roles())
        )
    $policy$;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Authenticated can read provider CSF'
  ) then
    execute $policy$
      create policy "Authenticated can read provider CSF"
        on storage.objects
        as permissive
        for select
        to authenticated
        using (
          bucket_id = 'payment-receipts'
          and name like 'csf/%'
          and public.current_user_has_role(public.flux_approver_roles())
        )
    $policy$;
  end if;
end
$$;
