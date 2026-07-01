-- Flux Operadora - apply 004b payment_receipts policies precheck
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: valida catalogo y helpers antes de aplicar load.sql.

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  current_database() as database_name,
  now() as checked_at;

do $$
declare
  table_oid oid;
  rls_enabled boolean;
  missing_roles text[];
  dangerous_policy_count integer;
begin
  table_oid := to_regclass('public.payment_receipts');

  if table_oid is null then
    raise exception 'PRECHECK_FAILED: public.payment_receipts does not exist.';
  end if;

  if to_regprocedure('public.current_user_has_role(text[])') is null then
    raise exception 'PRECHECK_FAILED: public.current_user_has_role(text[]) does not exist.';
  end if;

  if to_regprocedure('public.flux_member_roles()') is null then
    raise exception 'PRECHECK_FAILED: public.flux_member_roles() does not exist.';
  end if;

  if to_regprocedure('public.flux_approver_roles()') is null then
    raise exception 'PRECHECK_FAILED: public.flux_approver_roles() does not exist.';
  end if;

  select array_agg(role_name order by role_name)
  into missing_roles
  from (
    values
      ('sysadmin'),
      ('system_admin'),
      ('admin'),
      ('superadmin'),
      ('finance'),
      ('finanzas'),
      ('treasury'),
      ('tesoreria'),
      ('administracion'),
      ('direccion'),
      ('director')
  ) as expected(role_name)
  where not (role_name = any(public.flux_approver_roles()));

  if missing_roles is not null then
    raise exception 'PRECHECK_FAILED: flux_approver_roles() is missing expected roles: %.', array_to_string(missing_roles, ', ');
  end if;

  select c.relrowsecurity
  into rls_enabled
  from pg_class c
  where c.oid = table_oid;

  if rls_enabled then
    raise notice 'PRECHECK: RLS is already active on public.payment_receipts.';
  else
    raise notice 'PRECHECK: RLS is not active yet; load.sql will enable it as defined in 004b.';
  end if;

  select count(*)
  into dangerous_policy_count
  from pg_policy pol
  where pol.polrelid = table_oid
    and (
      array_position(pol.polroles, 0::oid) is not null
      or exists (
        select 1
        from unnest(pol.polroles) as pr(role_oid)
        join pg_roles r on r.oid = pr.role_oid
        where r.rolname = 'anon'
      )
    );

  if dangerous_policy_count > 0 then
    raise exception 'PRECHECK_FAILED: public.payment_receipts has policy access for public/anon roles.';
  end if;
end $$;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'payment_receipts';

select
  pol.polname as policy_name,
  case pol.polcmd
    when 'r' then 'select'
    when 'a' then 'insert'
    when 'w' then 'update'
    when 'd' then 'delete'
    when '*' then 'all'
    else pol.polcmd::text
  end as command,
  pol.polpermissive as permissive,
  array_agg(
    coalesce(r.rolname, case when pr.role_oid = 0::oid then 'public' else pr.role_oid::text end)
    order by coalesce(r.rolname, case when pr.role_oid = 0::oid then 'public' else pr.role_oid::text end)
  ) as roles,
  pg_get_expr(pol.polqual, pol.polrelid) as using_expression,
  pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expression
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
left join lateral unnest(pol.polroles) as pr(role_oid) on true
left join pg_roles r on r.oid = pr.role_oid
where n.nspname = 'public'
  and c.relname = 'payment_receipts'
group by pol.oid, pol.polname, pol.polcmd, pol.polpermissive, pol.polqual, pol.polwithcheck, pol.polrelid
order by pol.polname;

select
  'PAYMENT_RECEIPTS_004B_PRECHECK_OK' as result,
  'Prerequisites validated. load.sql can apply 004b in DEV only.' as detail;
