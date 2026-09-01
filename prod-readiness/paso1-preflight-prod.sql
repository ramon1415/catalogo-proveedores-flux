-- ============================================================================
-- PROD paso 1 · Preflight Fersana (SOLO LECTURA)
-- Proyecto esperado: ucantptjhwttexzmslvm
--
-- Ejecutar antes de cualquier migración. Todos los guards deben terminar sin
-- excepción. La transacción read only impide cambios accidentales.
-- ============================================================================

begin;
set transaction read only;

do $preflight$
declare
  v_count integer;
  v_missing text;
begin
  select string_agg(required.object_name, ', ' order by required.object_name)
    into v_missing
  from (
    values
      ('public.companies'),
      ('public.profiles'),
      ('public.roles'),
      ('public.user_roles'),
      ('public.profile_company_memberships'),
      ('public.company_directors'),
      ('public.approver_assignments'),
      ('public.company_bank_accounts'),
      ('public.cost_centers'),
      ('public.budget_categories'),
      ('public.budget_versions'),
      ('public.budget_lines'),
      ('public.company_cost_center_budget_categories')
  ) required(object_name)
  where to_regclass(required.object_name) is null;

  if v_missing is not null then
    raise exception 'fersana_preflight_missing_tables: %', v_missing;
  end if;

  if to_regprocedure('public.current_profile_id()') is null
     or to_regprocedure('public.current_user_has_role(text[])') is null
     or to_regprocedure('public.flux_sysadmin_roles()') is null
     or to_regprocedure('public.has_active_company_membership(uuid,uuid)') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'fersana_preflight_missing_required_functions';
  end if;

  select count(*) into v_count from public.companies;
  if v_count <> 1 then
    raise exception 'fersana_preflight_expected_one_incumbent_company_found_%', v_count;
  end if;

  select count(*) into v_count
  from public.companies
  where rfc = 'SFE100825TM9';
  if v_count <> 0 then
    raise exception 'fersana_preflight_company_already_exists';
  end if;

  select count(*) into v_count
  from public.budget_versions
  where active and year = 2026;
  if v_count <> 1 then
    raise exception 'fersana_preflight_expected_one_active_budget_2026_found_%', v_count;
  end if;

  select count(*) into v_count
  from public.cost_centers
  where code = 'SF';
  if v_count <> 0 then
    raise exception 'fersana_preflight_cost_center_sf_collision';
  end if;

  select count(*) into v_count
  from public.budget_categories
  where code like 'SF-2026-%';
  if v_count <> 0 then
    raise exception 'fersana_preflight_budget_category_collision_count_%', v_count;
  end if;

  select count(*) into v_count
  from public.roles
  where lower(btrim(name)) in ('solicitante', 'finance', 'director');
  if v_count <> 3 then
    raise exception 'fersana_preflight_required_roles_expected_3_found_%', v_count;
  end if;

  select count(*) into v_count
  from (
    values
      ('public.modules'),
      ('public.module_releases'),
      ('public.company_modules'),
      ('public.company_access_links'),
      ('public.company_access_requests'),
      ('public.recurring_income_templates'),
      ('public.tenant_income_entries')
  ) target(object_name)
  where to_regclass(target.object_name) is not null;
  if v_count <> 0 then
    raise exception 'fersana_preflight_target_schema_not_clean_count_%', v_count;
  end if;

  raise notice 'FERSANA_PREFLIGHT_PASS';
end;
$preflight$;

rollback;

