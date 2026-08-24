-- Mapper CONTPAQ — postcheck PROD estrictamente de lectura.
-- Ejecutar después de DDL, sincronización y semilla.

select
  c.id as company_id,
  c.name as company_name,
  count(a.code) as account_rows,
  count(a.code) filter (where a.activo) as active_rows,
  count(a.code) filter (where a.sincronizado_el is not null) as synchronized_rows,
  count(a.code) filter (where a.elegible_mapper) as eligible_rows
from public.companies c
left join public.contpaq_account_mapper_candidates a on a.company_id = c.id
where c.active
group by c.id, c.name
order by c.name;

select
  c.id as company_id,
  c.name as company_name,
  count(m.id) as mapping_rows,
  count(distinct m.contpaq_account_code) as distinct_mapped_accounts,
  count(m.id) filter (where m.needs_review) as needs_review_rows,
  count(m.id) filter (where m.mapping_method = 'exact_name') as exact_name_rows,
  count(m.id) filter (where m.mapping_method = 'judgment') as judgment_rows,
  count(m.id) filter (
    where (m.mapping_method = 'judgment' or m.needs_review)
      and nullif(btrim(m.mapping_reason), '') is null
  ) as missing_required_reason_rows
from public.companies c
left join public.budget_account_mappings m on m.company_id = c.id
where c.active
group by c.id, c.name
order by c.name;

select
  m.company_id,
  c.name as company_name,
  count(*) as invalid_mapped_accounts,
  count(*) filter (where a.code is null) as missing_from_catalog,
  count(*) filter (where a.code is not null and not a.es_hoja) as with_children,
  count(*) filter (where a.code is not null and a.cta_mayor <> 2) as not_detail,
  count(*) filter (where a.code is not null and upper(a.tipo) <> 'G') as not_expense,
  count(*) filter (where a.code is not null and not a.activo) as inactive,
  count(*) filter (where a.code is not null and a.sincronizado_el is null) as not_synchronized
from public.budget_account_mappings m
join public.companies c on c.id = m.company_id
left join public.contpaq_account_mapper_candidates a
  on a.company_id = m.company_id
 and a.code = m.contpaq_account_code
where a.code is null or not a.elegible_mapper
group by m.company_id, c.name
order by c.name;

select
  c.name as company_name,
  bc.name as budget_category,
  m.contpaq_account_code,
  a.name as contpaq_account,
  m.mapping_method,
  m.mapping_reason,
  m.needs_review,
  a.es_hoja,
  a.cta_mayor,
  a.tipo,
  a.activo,
  a.sincronizado_el
from public.budget_account_mappings m
join public.companies c on c.id = m.company_id
join public.budget_categories bc on bc.id = m.budget_category_id
left join public.contpaq_account_mapper_candidates a
  on a.company_id = m.company_id
 and a.code = m.contpaq_account_code
where m.needs_review
order by c.name, bc.name;

select
  table_name,
  row_security_active,
  row_security_forced,
  policies
from (
  select
    cl.relname as table_name,
    cl.relrowsecurity as row_security_active,
    cl.relforcerowsecurity as row_security_forced,
    array_agg(p.policyname order by p.policyname) as policies
  from pg_class cl
  join pg_namespace n on n.oid = cl.relnamespace
  left join pg_policies p on p.schemaname = n.nspname and p.tablename = cl.relname
  where n.nspname = 'public'
    and cl.relname in ('historical_actuals','contpaq_accounts','budget_account_mappings')
  group by cl.relname, cl.relrowsecurity, cl.relforcerowsecurity
) audit
order by table_name;

select
  to_regclass('public.contpaq_account_mapper_candidates') is not null as candidate_view_exists,
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.budget_account_mappings'::regclass
      and tgname = 'budget_account_mappings_eligible_guard'
      and not tgisinternal
  ) as eligibility_trigger_exists,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'contpaq_mapper_company_access'
  ) as scoped_access_helper_exists;

-- Gate esperado para Operadora antes de liberar el PR 3:
-- account_rows = 1646
-- mapping_rows = 87
-- distinct_mapped_accounts = 63
-- needs_review_rows = 6
-- invalid_mapped_accounts = 0 filas
-- missing_required_reason_rows = 0
-- vista, trigger y helper = true
