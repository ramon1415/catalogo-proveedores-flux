-- Targeted pre/post evidence. Catalog and row counts only; no RPC invocation.
begin read only;
select jsonb_build_object(
  'captured_at', clock_timestamp(),
  'read_only', current_setting('transaction_read_only'),
  'table_rows', jsonb_build_object(
    'recurring_income_templates', (select count(*) from public.recurring_income_templates),
    'tenant_income_entries', (select count(*) from public.tenant_income_entries),
    'cross_company_links', (
      select count(*) from public.tenant_income_entries e
      join public.recurring_income_templates t on t.id=e.template_id
      where e.company_id<>t.company_id
    )
  ),
  'tables', (
    select jsonb_agg(jsonb_build_object(
      'table', c.relname, 'rls_enabled', c.relrowsecurity,
      'anon_crud_or_truncate',
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
      'authenticated_truncate', has_table_privilege('authenticated', c.oid, 'TRUNCATE'),
      'service_role_truncate', has_table_privilege('service_role', c.oid, 'TRUNCATE')
    ) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('recurring_income_templates','tenant_income_entries')
  ),
  'foreign_keys', (
    select jsonb_agg(jsonb_build_object(
      'name', c.conname, 'validated', c.convalidated,
      'definition', pg_get_constraintdef(c.oid)
    ) order by c.conname)
    from pg_constraint c
    where c.conrelid='public.tenant_income_entries'::regclass and c.contype='f'
  ),
  'generator', (
    select jsonb_build_object(
      'config', p.proconfig,
      'definition_md5', md5(pg_get_functiondef(p.oid)),
      'explicit_session_guard', position('auth.uid() is null' in lower(p.prosrc)) > 0,
      'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'service_role_execute', has_function_privilege('service_role', p.oid, 'EXECUTE')
    ) from pg_proc p
    where p.oid='public.generate_recurring_income(uuid,text)'::regprocedure
  )
) as recurring_income_audit;
commit;
