-- Flux Operadora - apply 004c Fase 2 payment method closure postcheck
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: valida resultado despues de load.sql. No ejecuta flujos de negocio ni modifica datos operativos.

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  current_database() as database_name,
  now() as checked_at;

do $$
declare
  payment_requests_oid oid;
  layout_fn_oid oid;
  layout_fn_definition text;
  layout_fn_security_definer boolean;
  layout_fn_config text[];
  online_purchase_exists boolean := false;
  payment_method_column_exists boolean := false;
  constraint_ok boolean := false;
  index_ok boolean := false;
  invalid_payment_method_count integer := 0;
  payment_requests_rls boolean := false;
  dangerous_policy_count integer := 0;
  grants_ok boolean := false;
begin
  payment_requests_oid := to_regclass('public.payment_requests');

  if payment_requests_oid is null then
    raise exception 'POSTCHECK_FAILED: public.payment_requests does not exist.';
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

  if position('payment_method' in layout_fn_definition) = 0
     or position('request_type::text' in layout_fn_definition) = 0
     or position('cash' in layout_fn_definition) = 0
     or position('check' in layout_fn_definition) = 0
     or position('layout_created_transfer_only' in layout_fn_definition) = 0
     or position('no_valid_transfer_payment_requests' in layout_fn_definition) = 0 then
    raise exception 'POSTCHECK_FAILED: create_payment_layout does not appear to contain the 004c transfer-only filter.';
  end if;

  select c.relrowsecurity
  into payment_requests_rls
  from pg_class c
  where c.oid = payment_requests_oid;

  if not coalesce(payment_requests_rls, false) then
    raise exception 'POSTCHECK_FAILED: RLS is not active on public.payment_requests.';
  end if;

  select count(*)
  into dangerous_policy_count
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

  if dangerous_policy_count > 0 then
    raise exception 'POSTCHECK_FAILED: public.payment_requests has policy access for public/anon roles.';
  end if;

  grants_ok :=
    has_table_privilege('authenticated', 'public.payment_requests', 'SELECT')
    and has_table_privilege('authenticated', 'public.payment_requests', 'INSERT')
    and has_table_privilege('authenticated', 'public.payment_requests', 'UPDATE');

  if not grants_ok then
    raise exception 'POSTCHECK_FAILED: authenticated role does not have expected SELECT/INSERT/UPDATE grants on public.payment_requests.';
  end if;
end $$;

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
  position('layout_created_transfer_only' in pg_get_functiondef(p.oid)) > 0 as returns_transfer_only_message
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
  and c.relname = 'payment_requests'
group by pol.oid, pol.polname, pol.polcmd, pol.polpermissive, pol.polqual, pol.polwithcheck, pol.polrelid
order by pol.polname;

select
  has_table_privilege('authenticated', 'public.payment_requests', 'SELECT') as authenticated_can_select,
  has_table_privilege('authenticated', 'public.payment_requests', 'INSERT') as authenticated_can_insert,
  has_table_privilege('authenticated', 'public.payment_requests', 'UPDATE') as authenticated_can_update,
  has_table_privilege('anon', 'public.payment_requests', 'INSERT') as anon_can_insert,
  has_table_privilege('anon', 'public.payment_requests', 'UPDATE') as anon_can_update;

select
  'FASE2_004C_POSTCHECK_OK' as result,
  'payment_method is versioned, create_payment_layout contains transfer-only filtering, RLS remains active, and no public/anon payment_requests policy was found.' as detail;
