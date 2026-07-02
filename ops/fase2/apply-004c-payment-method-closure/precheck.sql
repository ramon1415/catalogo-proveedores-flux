-- Flux Operadora - apply 004c Fase 2 payment method closure precheck
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: valida prerequisitos antes de aplicar load.sql. No modifica datos operativos.

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  current_database() as database_name,
  now() as checked_at;

do $$
declare
  missing_tables text[];
  missing_columns text[];
  invalid_payment_method_count integer := 0;
  has_payment_method boolean := false;
  payment_requests_oid oid;
  payment_requests_rls boolean;
  dangerous_policy_count integer := 0;
begin
  select array_agg(object_name order by object_name)
  into missing_tables
  from (
    values
      ('public.payment_requests'),
      ('public.payment_layouts'),
      ('public.payment_layout_lines'),
      ('public.profiles'),
      ('public.companies'),
      ('public.company_bank_accounts'),
      ('public.proveedores')
  ) as required(object_name)
  where to_regclass(object_name) is null;

  if missing_tables is not null then
    raise exception 'PRECHECK_FAILED: missing required tables: %.', array_to_string(missing_tables, ', ');
  end if;

  if to_regtype('public.payment_request_type') is null then
    raise exception 'PRECHECK_FAILED: enum public.payment_request_type does not exist.';
  end if;

  if to_regtype('public.payment_request_status') is null then
    raise exception 'PRECHECK_FAILED: enum public.payment_request_status does not exist.';
  end if;

  if to_regprocedure('public.create_payment_layout(date,date,uuid,text,uuid,uuid)') is null then
    raise exception 'PRECHECK_FAILED: expected public.create_payment_layout(date,date,uuid,text,uuid,uuid) does not exist.';
  end if;

  if to_regclass('public.payment_layout_number_seq') is null then
    raise exception 'PRECHECK_FAILED: public.payment_layout_number_seq does not exist.';
  end if;

  select array_agg(table_name || '.' || column_name order by table_name, column_name)
  into missing_columns
  from (
    values
      ('payment_requests', 'id'),
      ('payment_requests', 'request_number'),
      ('payment_requests', 'request_type'),
      ('payment_requests', 'status'),
      ('payment_requests', 'currency'),
      ('payment_requests', 'amount_requested'),
      ('payment_requests', 'scheduled_payment_date'),
      ('payment_requests', 'updated_at'),
      ('payment_requests', 'created_at'),
      ('payment_requests', 'company_id'),
      ('payment_requests', 'proveedor_id'),
      ('payment_requests', 'company_bank_account_id'),
      ('payment_requests', 'payment_reference'),
      ('payment_requests', 'payment_concept'),
      ('payment_layouts', 'id'),
      ('payment_layouts', 'layout_number'),
      ('payment_layouts', 'name'),
      ('payment_layouts', 'period_start'),
      ('payment_layouts', 'period_end'),
      ('payment_layouts', 'status'),
      ('payment_layouts', 'generated_by'),
      ('payment_layouts', 'generated_at'),
      ('payment_layouts', 'company_count'),
      ('payment_layouts', 'payment_count'),
      ('payment_layouts', 'total_amount'),
      ('payment_layouts', 'updated_at'),
      ('payment_layout_lines', 'layout_id'),
      ('payment_layout_lines', 'payment_request_id'),
      ('payment_layout_lines', 'company_id'),
      ('payment_layout_lines', 'proveedor_id'),
      ('payment_layout_lines', 'company_bank_account_id'),
      ('payment_layout_lines', 'source_account_number'),
      ('payment_layout_lines', 'company_name'),
      ('payment_layout_lines', 'destination_type'),
      ('payment_layout_lines', 'destination_value'),
      ('payment_layout_lines', 'beneficiary_name'),
      ('payment_layout_lines', 'amount'),
      ('payment_layout_lines', 'payment_reference'),
      ('payment_layout_lines', 'payment_concept'),
      ('payment_layout_lines', 'request_number'),
      ('payment_layout_lines', 'status'),
      ('profiles', 'id'),
      ('profiles', 'active'),
      ('companies', 'id'),
      ('companies', 'legal_name'),
      ('companies', 'name'),
      ('company_bank_accounts', 'id'),
      ('company_bank_accounts', 'account_number'),
      ('company_bank_accounts', 'active'),
      ('proveedores', 'id'),
      ('proveedores', 'activo'),
      ('proveedores', 'destination_type'),
      ('proveedores', 'clabe'),
      ('proveedores', 'cuenta_bancaria'),
      ('proveedores', 'convenio_number'),
      ('proveedores', 'beneficiary_name'),
      ('proveedores', 'nombre_completo'),
      ('proveedores', 'alias')
  ) as expected(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = expected.table_name
      and c.column_name = expected.column_name
  );

  if missing_columns is not null then
    raise exception 'PRECHECK_FAILED: missing required columns: %.', array_to_string(missing_columns, ', ');
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_requests'
      and column_name = 'payment_method'
  ) into has_payment_method;

  if has_payment_method then
    execute $q$
      select count(*)
      from public.payment_requests
      where payment_method is not null
        and payment_method not in ('transfer', 'cash', 'check', 'other')
    $q$ into invalid_payment_method_count;

    if invalid_payment_method_count > 0 then
      raise exception 'PRECHECK_FAILED: found % payment_requests rows with invalid payment_method values. Stop before applying 004c.', invalid_payment_method_count;
    end if;
  else
    raise notice 'PRECHECK: public.payment_requests.payment_method does not exist yet; load.sql will add it.';
  end if;

  payment_requests_oid := to_regclass('public.payment_requests');

  select c.relrowsecurity
  into payment_requests_rls
  from pg_class c
  where c.oid = payment_requests_oid;

  if not coalesce(payment_requests_rls, false) then
    raise exception 'PRECHECK_FAILED: RLS is not active on public.payment_requests.';
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
    raise exception 'PRECHECK_FAILED: public.payment_requests has policy access for public/anon roles.';
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
  e.enumlabel as payment_request_type_value
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname = 'payment_request_type'
order by e.enumsortorder;

select
  'FASE2_004C_PRECHECK_OK' as result,
  'Prerequisites validated. load.sql can apply 004c in DEV only.' as detail;
