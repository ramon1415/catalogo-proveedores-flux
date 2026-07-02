-- Flux Operadora - PROD apply 004b + 004c postcheck
-- Safety: validates results after load.sql. Does not create layouts, receipts, or operational rows.
-- Do not run without explicit Carlos/Ramon authorization and a coordinated PROD release window.

select
  'PROD' as expected_environment,
  current_database() as database_name,
  now() as checked_at,
  '004b_payment_receipts_policies.sql -> 004c_fase2_payment_method_closure.sql' as applied_order;

do $$
declare
  payment_receipts_oid oid;
  payment_requests_oid oid;
  receipts_rls_enabled boolean := false;
  requests_rls_enabled boolean := false;
  receipts_select_policy_ok boolean := false;
  receipts_write_policy_ok boolean := false;
  dangerous_receipts_policy_count integer := 0;
  unsafe_receipts_write_policy_count integer := 0;
  dangerous_requests_policy_count integer := 0;
  receipts_grant_ok boolean := false;
  requests_grant_ok boolean := false;
  online_purchase_exists boolean := false;
  payment_method_column_exists boolean := false;
  constraint_ok boolean := false;
  index_ok boolean := false;
  invalid_payment_method_count integer := 0;
  layout_fn_oid oid;
  layout_fn_definition text;
  layout_fn_security_definer boolean;
  layout_fn_config text[];
begin
  payment_receipts_oid := to_regclass('public.payment_receipts');
  payment_requests_oid := to_regclass('public.payment_requests');

  if payment_receipts_oid is null then
    raise exception 'POSTCHECK_FAILED: public.payment_receipts does not exist.';
  end if;

  if payment_requests_oid is null then
    raise exception 'POSTCHECK_FAILED: public.payment_requests does not exist.';
  end if;

  select c.relrowsecurity
  into receipts_rls_enabled
  from pg_class c
  where c.oid = payment_receipts_oid;

  if not coalesce(receipts_rls_enabled, false) then
    raise exception 'POSTCHECK_FAILED: RLS is not active on public.payment_receipts.';
  end if;

  select exists (
    select 1
    from pg_policy pol
    where pol.polrelid = payment_receipts_oid
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
  ) into receipts_select_policy_ok;

  if not receipts_select_policy_ok then
    raise exception 'POSTCHECK_FAILED: expected select policy payment_receipts_select was not found or does not use flux_member_roles().';
  end if;

  select exists (
    select 1
    from pg_policy pol
    where pol.polrelid = payment_receipts_oid
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
  ) into receipts_write_policy_ok;

  if not receipts_write_policy_ok then
    raise exception 'POSTCHECK_FAILED: expected write policy payment_receipts_write_authorized was not found or does not use flux_approver_roles().';
  end if;

  select count(*)
  into dangerous_receipts_policy_count
  from pg_policy pol
  where pol.polrelid = payment_receipts_oid
    and (
      array_position(pol.polroles, 0::oid) is not null
      or exists (
        select 1
        from unnest(pol.polroles) as pr(role_oid)
        join pg_roles r on r.oid = pr.role_oid
        where r.rolname = 'anon'
      )
    );

  if dangerous_receipts_policy_count > 0 then
    raise exception 'POSTCHECK_FAILED: public.payment_receipts has policy access for public/anon roles.';
  end if;

  select count(*)
  into unsafe_receipts_write_policy_count
  from pg_policy pol
  where pol.polrelid = payment_receipts_oid
    and pol.polcmd in ('*', 'a', 'w', 'd')
    and not (
      pol.polname = 'payment_receipts_write_authorized'
      and pg_get_expr(pol.polqual, pol.polrelid) like '%flux_approver_roles%'
      and pg_get_expr(pol.polwithcheck, pol.polrelid) like '%flux_approver_roles%'
    );

  if unsafe_receipts_write_policy_count > 0 then
    raise exception 'POSTCHECK_FAILED: found write policy on payment_receipts that is not limited by flux_approver_roles().';
  end if;

  receipts_grant_ok :=
    has_table_privilege('authenticated', 'public.payment_receipts', 'SELECT')
    and has_table_privilege('authenticated', 'public.payment_receipts', 'INSERT')
    and has_table_privilege('authenticated', 'public.payment_receipts', 'UPDATE')
    and has_table_privilege('authenticated', 'public.payment_receipts', 'DELETE');

  if not receipts_grant_ok then
    raise exception 'POSTCHECK_FAILED: authenticated role does not have expected grants on public.payment_receipts.';
  end if;

  select exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'payment_request_type'
      and e.enumlabel = 'online_purchase'
  ) into online_purchase_exists;

  if not online_purchase_exists then
    raise exception 'POSTCHECK_FAILED: payment_request_type is missing online_purchase.';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_requests'
      and column_name = 'payment_method'
      and data_type = 'text'
  ) into payment_method_column_exists;

  if not payment_method_column_exists then
    raise exception 'POSTCHECK_FAILED: public.payment_requests.payment_method text column does not exist.';
  end if;

  select exists (
    select 1
    from pg_constraint con
    where con.conrelid = payment_requests_oid
      and con.conname = 'payment_requests_payment_method_check'
      and con.convalidated
      and pg_get_constraintdef(con.oid) like '%transfer%'
      and pg_get_constraintdef(con.oid) like '%cash%'
      and pg_get_constraintdef(con.oid) like '%check%'
      and pg_get_constraintdef(con.oid) like '%other%'
  ) into constraint_ok;

  if not constraint_ok then
    raise exception 'POSTCHECK_FAILED: payment_requests_payment_method_check is missing, not validated, or does not contain expected values.';
  end if;

  execute $q$
    select count(*)
    from public.payment_requests
    where payment_method is not null
      and payment_method not in ('transfer', 'cash', 'check', 'other')
  $q$ into invalid_payment_method_count;

  if invalid_payment_method_count > 0 then
    raise exception 'POSTCHECK_FAILED: found % payment_requests rows with invalid payment_method values.', invalid_payment_method_count;
  end if;

  select exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'idx_payment_requests_payment_method'
      and c.relkind = 'i'
  ) into index_ok;

  if not index_ok then
    raise exception 'POSTCHECK_FAILED: idx_payment_requests_payment_method index does not exist.';
  end if;

  select p.oid, p.prosecdef, p.proconfig
  into layout_fn_oid, layout_fn_security_definer, layout_fn_config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_payment_layout'
    and pg_get_function_identity_arguments(p.oid) = 'p_period_start date, p_period_end date, p_generated_by uuid, p_name text, p_company_id uuid, p_company_bank_account_id uuid';

  if layout_fn_oid is null then
    raise exception 'POSTCHECK_FAILED: expected create_payment_layout signature was not found.';
  end if;

  if not coalesce(layout_fn_security_definer, false) then
    raise exception 'POSTCHECK_FAILED: create_payment_layout is not SECURITY DEFINER.';
  end if;

  if layout_fn_config is null or not ('search_path=public' = any(layout_fn_config)) then
    raise exception 'POSTCHECK_FAILED: create_payment_layout does not pin search_path to public.';
  end if;

  layout_fn_definition := pg_get_functiondef(layout_fn_oid);

  if position('coalesce(nullif(pr.payment_method' in layout_fn_definition) = 0
     or position('request_type::text' in layout_fn_definition) = 0
     or position('cash' in layout_fn_definition) = 0
     or position('check' in layout_fn_definition) = 0
     or position('= ''transfer''' in layout_fn_definition) = 0
     or position('layout_created_transfer_only' in layout_fn_definition) = 0
     or position('no_valid_transfer_payment_requests' in layout_fn_definition) = 0 then
    raise exception 'POSTCHECK_FAILED: create_payment_layout does not appear to contain the 004c transfer-only filter.';
  end if;

  select c.relrowsecurity
  into requests_rls_enabled
  from pg_class c
  where c.oid = payment_requests_oid;

  if not coalesce(requests_rls_enabled, false) then
    raise exception 'POSTCHECK_FAILED: RLS is not active on public.payment_requests.';
  end if;

  select count(*)
  into dangerous_requests_policy_count
  from pg_policy pol
  where pol.polrelid = payment_requests_oid
    and (
      array_position(pol.polroles, 0::oid) is not null
      or exists (
        select 1
        from unnest(pol.polroles) as pr(role_oid)
        join pg_roles r on r.oid = pr.role_oid
        where r.rolname = 'anon'
      )
    );

  if dangerous_requests_policy_count > 0 then
    raise exception 'POSTCHECK_FAILED: public.payment_requests has policy access for public/anon roles.';
  end if;

  requests_grant_ok :=
    has_table_privilege('authenticated', 'public.payment_requests', 'SELECT')
    and has_table_privilege('authenticated', 'public.payment_requests', 'INSERT')
    and has_table_privilege('authenticated', 'public.payment_requests', 'UPDATE');

  if not requests_grant_ok then
    raise exception 'POSTCHECK_FAILED: authenticated role does not have expected SELECT/INSERT/UPDATE grants on public.payment_requests.';
  end if;
end $$;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('payment_receipts', 'payment_requests')
order by c.relname;

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
  and c.relname in ('payment_receipts', 'payment_requests')
group by c.relname, pol.oid, pol.polname, pol.polcmd, pol.polpermissive, pol.polqual, pol.polwithcheck, pol.polrelid
order by c.relname, pol.polname;

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payment_requests'
  and column_name in ('request_type', 'payment_method', 'status')
order by ordinal_position;

select
  con.conname as constraint_name,
  con.convalidated as validated,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
where con.conrelid = 'public.payment_requests'::regclass
  and con.conname = 'payment_requests_payment_method_check';

select
  p.proname as function_name,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  position('payment_method' in pg_get_functiondef(p.oid)) > 0 as references_payment_method,
  position('layout_created_transfer_only' in pg_get_functiondef(p.oid)) > 0 as returns_transfer_only_message,
  position('= ''transfer''' in pg_get_functiondef(p.oid)) > 0 as contains_transfer_filter
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_payment_layout'
  and pg_get_function_identity_arguments(p.oid) = 'p_period_start date, p_period_end date, p_generated_by uuid, p_name text, p_company_id uuid, p_company_bank_account_id uuid';

select
  coalesce(nullif(payment_method, ''), case when request_type::text in ('cash', 'check') then request_type::text else 'transfer' end) as normalized_layout_method,
  count(*) as approved_request_count
from public.payment_requests
where status = 'approved'::public.payment_request_status
group by 1
order by 1;

select
  has_table_privilege('authenticated', 'public.payment_receipts', 'SELECT') as authenticated_can_select_receipts,
  has_table_privilege('authenticated', 'public.payment_receipts', 'INSERT') as authenticated_can_insert_receipts,
  has_table_privilege('authenticated', 'public.payment_receipts', 'UPDATE') as authenticated_can_update_receipts,
  has_table_privilege('authenticated', 'public.payment_requests', 'SELECT') as authenticated_can_select_requests,
  has_table_privilege('authenticated', 'public.payment_requests', 'INSERT') as authenticated_can_insert_requests,
  has_table_privilege('authenticated', 'public.payment_requests', 'UPDATE') as authenticated_can_update_requests,
  has_table_privilege('anon', 'public.payment_receipts', 'INSERT') as anon_can_insert_receipts,
  has_table_privilege('anon', 'public.payment_requests', 'INSERT') as anon_can_insert_requests;

select
  'PROD_004B_004C_POSTCHECK_OK' as result,
  'RLS and policies validated, payment_method closure validated, and create_payment_layout contains transfer-only backend filtering. No operational smoke rows were created.' as detail;
