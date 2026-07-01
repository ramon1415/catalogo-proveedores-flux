-- Flux Operadora - apply 004b payment_receipts policies postcheck
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: valida RLS, policies y grants despues de load.sql.

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  current_database() as database_name,
  now() as checked_at;

do $$
declare
  table_oid oid;
  rls_enabled boolean;
  select_policy_ok boolean;
  write_policy_ok boolean;
  dangerous_policy_count integer;
  unsafe_write_policy_count integer;
  grant_ok boolean;
begin
  table_oid := to_regclass('public.payment_receipts');

  if table_oid is null then
    raise exception 'POSTCHECK_FAILED: public.payment_receipts does not exist.';
  end if;

  select c.relrowsecurity
  into rls_enabled
  from pg_class c
  where c.oid = table_oid;

  if not coalesce(rls_enabled, false) then
    raise exception 'POSTCHECK_FAILED: RLS is not active on public.payment_receipts.';
  end if;

  select exists (
    select 1
    from pg_policy pol
    where pol.polrelid = table_oid
      and pol.polname = 'payment_receipts_select'
      and pol.polcmd = 'r'
      and pol.polpermissive
      and exists (
        select 1
        from unnest(pol.polroles) as pr(role_oid)
        join pg_roles r on r.oid = pr.role_oid
        where r.rolname = 'authenticated'
      )
      and pg_get_expr(pol.polqual, pol.polrelid) like '%current_user_has_role%'
      and pg_get_expr(pol.polqual, pol.polrelid) like '%flux_member_roles%'
  ) into select_policy_ok;

  if not select_policy_ok then
    raise exception 'POSTCHECK_FAILED: expected select policy payment_receipts_select was not found or does not use flux_member_roles().';
  end if;

  select exists (
    select 1
    from pg_policy pol
    where pol.polrelid = table_oid
      and pol.polname = 'payment_receipts_write_authorized'
      and pol.polcmd = '*'
      and pol.polpermissive
      and exists (
        select 1
        from unnest(pol.polroles) as pr(role_oid)
        join pg_roles r on r.oid = pr.role_oid
        where r.rolname = 'authenticated'
      )
      and pg_get_expr(pol.polqual, pol.polrelid) like '%current_user_has_role%'
      and pg_get_expr(pol.polqual, pol.polrelid) like '%flux_approver_roles%'
      and pg_get_expr(pol.polwithcheck, pol.polrelid) like '%current_user_has_role%'
      and pg_get_expr(pol.polwithcheck, pol.polrelid) like '%flux_approver_roles%'
  ) into write_policy_ok;

  if not write_policy_ok then
    raise exception 'POSTCHECK_FAILED: expected write policy payment_receipts_write_authorized was not found or does not use flux_approver_roles().';
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
    raise exception 'POSTCHECK_FAILED: public.payment_receipts has policy access for public/anon roles.';
  end if;

  select count(*)
  into unsafe_write_policy_count
  from pg_policy pol
  where pol.polrelid = table_oid
    and pol.polcmd in ('*', 'a', 'w', 'd')
    and not (
      pol.polname = 'payment_receipts_write_authorized'
      and pg_get_expr(pol.polqual, pol.polrelid) like '%flux_approver_roles%'
      and pg_get_expr(pol.polwithcheck, pol.polrelid) like '%flux_approver_roles%'
    );

  if unsafe_write_policy_count > 0 then
    raise exception 'POSTCHECK_FAILED: found write policy on payment_receipts that is not limited by flux_approver_roles().';
  end if;

  grant_ok :=
    has_table_privilege('authenticated', 'public.payment_receipts', 'SELECT')
    and has_table_privilege('authenticated', 'public.payment_receipts', 'INSERT')
    and has_table_privilege('authenticated', 'public.payment_receipts', 'UPDATE')
    and has_table_privilege('authenticated', 'public.payment_receipts', 'DELETE');

  if not grant_ok then
    raise exception 'POSTCHECK_FAILED: authenticated role does not have expected table grants on public.payment_receipts.';
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
  has_table_privilege('authenticated', 'public.payment_receipts', 'SELECT') as authenticated_can_select,
  has_table_privilege('authenticated', 'public.payment_receipts', 'INSERT') as authenticated_can_insert,
  has_table_privilege('authenticated', 'public.payment_receipts', 'UPDATE') as authenticated_can_update,
  has_table_privilege('authenticated', 'public.payment_receipts', 'DELETE') as authenticated_can_delete;

select
  'PAYMENT_RECEIPTS_004B_POSTCHECK_OK' as result,
  'RLS active. Expected policies exist. No public/anon policy found. Writes are limited by flux_approver_roles().' as detail;
