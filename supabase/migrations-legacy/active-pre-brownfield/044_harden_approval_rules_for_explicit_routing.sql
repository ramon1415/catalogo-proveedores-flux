-- Flux Operadora - Migration 044
-- Disable unscoped financial approval rules in favor of explicit routing.
-- Forward-only, transactional and idempotent. No environment-specific identities.

begin;

do $migration$
declare
  v_missing_columns text[];
  v_active_catch_all bigint;
begin
  if to_regclass('public.roles') is null
     or to_regclass('public.approval_rules') is null then
    raise exception 'p3_permissions_required_tables_missing';
  end if;

  select array_agg(required.column_name order by required.column_name)
  into v_missing_columns
  from (
    values
      ('active'),
      ('amount_min'),
      ('amount_max'),
      ('company_id'),
      ('cost_center_id'),
      ('role_id')
  ) as required(column_name)
  where not exists (
    select 1
    from information_schema.columns columns_info
    where columns_info.table_schema = 'public'
      and columns_info.table_name = 'approval_rules'
      and columns_info.column_name = required.column_name
  );

  if coalesce(cardinality(v_missing_columns), 0) > 0 then
    raise exception
      'p3_permissions_approval_rules_columns_missing:%',
      array_to_string(v_missing_columns, ',');
  end if;

  update public.approval_rules rule
  set active = false
  from public.roles role
  where rule.role_id = role.id
    and lower(btrim(role.name)) = any (
      array[
        'administracion',
        'finance',
        'finanzas',
        'tesoreria',
        'treasury'
      ]::text[]
    )
    and rule.active
    and rule.company_id is null
    and rule.cost_center_id is null
    and coalesce(rule.amount_min, 0) = 0
    and rule.amount_max is null;

  select count(*)
  into v_active_catch_all
  from public.approval_rules rule
  join public.roles role on role.id = rule.role_id
  where lower(btrim(role.name)) = any (
      array[
        'administracion',
        'finance',
        'finanzas',
        'tesoreria',
        'treasury'
      ]::text[]
    )
    and rule.active
    and rule.company_id is null
    and rule.cost_center_id is null
    and coalesce(rule.amount_min, 0) = 0
    and rule.amount_max is null;

  if v_active_catch_all <> 0 then
    raise exception
      'p3_permissions_financial_catch_all_remains:%',
      v_active_catch_all;
  end if;
end
$migration$;

commit;
