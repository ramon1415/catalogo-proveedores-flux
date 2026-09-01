-- ============================================================================
-- PROD paso 1/4 · Postcheck Fersana (SOLO LECTURA)
-- Ejecutar después de migraciones + seed + responsables y antes del PR #467.
-- ============================================================================

begin;
set transaction read only;

do $postcheck$
declare
  v_count integer;
  v_total numeric;
  v_missing text;
begin
  select string_agg(required.object_name, ', ' order by required.object_name)
    into v_missing
  from (
    values
      ('public.modules'),
      ('public.module_releases'),
      ('public.company_modules'),
      ('public.company_access_links'),
      ('public.company_access_requests'),
      ('public.recurring_income_templates'),
      ('public.tenant_income_entries')
  ) required(object_name)
  where to_regclass(required.object_name) is null;
  if v_missing is not null then
    raise exception 'fersana_postcheck_missing_tables: %', v_missing;
  end if;

  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'modules', 'module_releases', 'company_modules',
      'company_access_links', 'company_access_requests',
      'recurring_income_templates', 'tenant_income_entries'
    )
    and c.relrowsecurity;
  if v_count <> 7 then
    raise exception 'fersana_postcheck_rls_expected_7_found_%', v_count;
  end if;

  select count(*) into v_count
  from public.companies
  where rfc = 'SFE100825TM9'
    and active;
  if v_count <> 1 then
    raise exception 'fersana_postcheck_company_expected_one_found_%', v_count;
  end if;

  select count(*) into v_count
  from public.company_access_links l
  join public.companies c on c.id = l.company_id
  where l.code = 'fersana'
    and l.active
    and c.rfc = 'SFE100825TM9';
  if v_count <> 1 then
    raise exception 'fersana_postcheck_access_link_expected_one_found_%', v_count;
  end if;

  select count(*) into v_count
  from public.company_modules cm
  join public.companies c on c.id = cm.company_id
  where c.rfc = 'SFE100825TM9'
    and cm.module_key in ('incidencias', 'ingresos', 'nomina')
    and not cm.enabled;
  if v_count <> 3 then
    raise exception 'fersana_postcheck_disabled_modules_expected_3_found_%', v_count;
  end if;

  select count(*) into v_count
  from public.company_modules cm
  join public.companies c on c.id = cm.company_id
  where c.rfc is distinct from 'SFE100825TM9'
    and cm.module_key = 'incidencias'
    and cm.enabled;
  if v_count <> 1 then
    raise exception 'fersana_postcheck_incumbent_incidencias_expected_one_found_%', v_count;
  end if;

  select count(*), coalesce(sum(bl.amount), 0)
    into v_count, v_total
  from public.budget_lines bl
  join public.companies c on c.id = bl.company_id
  join public.budget_versions bv on bv.id = bl.budget_version_id
  where c.rfc = 'SFE100825TM9'
    and bv.active
    and bv.year = 2026;
  if v_count <> 322 or v_total <> 6289204.00 then
    raise exception 'fersana_postcheck_budget_failed_count_%_total_%', v_count, v_total;
  end if;

  select count(*) into v_count
  from public.company_cost_center_budget_categories rel
  join public.companies c on c.id = rel.company_id
  join public.cost_centers cc on cc.id = rel.cost_center_id
  where c.rfc = 'SFE100825TM9'
    and cc.code = 'SF'
    and rel.active
    and nullif(btrim(rel.responsible_email), '') is not null;
  if v_count <> 60 then
    raise exception 'fersana_postcheck_responsibles_expected_60_found_%', v_count;
  end if;

  select count(*) into v_count
  from public.tenant_income_entries e
  join public.recurring_income_templates t on t.id = e.template_id
  where e.template_id is not null
    and e.company_id <> t.company_id;
  if v_count <> 0 then
    raise exception 'fersana_postcheck_cross_tenant_income_links_found_%', v_count;
  end if;

  select count(*) into v_count
  from pg_constraint
  where conrelid = 'public.tenant_income_entries'::regclass
    and conname = 'tenant_income_entries_company_template_fk'
    and contype = 'f';
  if v_count <> 1 then
    raise exception 'fersana_postcheck_missing_company_template_fk';
  end if;

  if has_function_privilege('anon', 'public.ensure_current_profile()', 'EXECUTE')
     or has_function_privilege('anon', 'public.request_company_access(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_company_access_requests()', 'EXECUTE')
     or has_function_privilege('anon', 'public.approve_company_access_request(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.reject_company_access_request(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.generate_recurring_income(uuid,text)', 'EXECUTE') then
    raise exception 'fersana_postcheck_anon_function_execute_detected';
  end if;

  raise notice 'FERSANA_POSTCHECK_PASS';
end;
$postcheck$;

rollback;
