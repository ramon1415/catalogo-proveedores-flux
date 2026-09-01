-- PROD gate · Company-scoped role cutover (SOLO LECTURA).
-- Expected today: NO-GO while legacy company-aware policies/RPCs still use a
-- global business role. Apply no role matrix until this gate passes.

begin;
set transaction read only;

do $preflight$
declare
  v_policy_blockers text;
  v_function_blockers text;
  v_power_blockers text;
begin
  if to_regclass('public.profile_company_memberships') is null then
    raise exception 'company_role_preflight_missing_memberships';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profile_company_memberships'
      and column_name = 'role_key'
  ) then
    raise exception 'company_role_preflight_foundation_not_applied';
  end if;

  if to_regprocedure('private.profile_has_company_role(uuid,uuid,text[])') is null then
    raise exception 'company_role_preflight_helper_missing';
  end if;

  select string_agg(coalesce(p.email, p.id::text), ', ' order by coalesce(p.email, p.id::text))
    into v_power_blockers
  from public.profiles p
  join public.user_roles ur on ur.profile_id = p.id
  join public.roles r on r.id = ur.role_id
  where lower(btrim(r.name)) in ('sysadmin', 'system_admin', 'admin', 'superadmin')
    and lower(btrim(coalesce(p.email, ''))) not in ('carlos@quantta.mx', 'ramon@quantta.mx');

  select string_agg(format('%I.%I:%I', schemaname, tablename, policyname), ', ' order by tablename, policyname)
    into v_policy_blockers
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ilike '%current_user_has_role%'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'flux_(finance|approver|member)_roles|finance|finanzas|director|approver_2|solicitante|operator'
    and exists (
      select 1
      from information_schema.columns c
      where c.table_schema = pg_policies.schemaname
        and c.table_name = pg_policies.tablename
        and c.column_name = 'company_id'
    );

  select string_agg(format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), ', ' order by p.proname)
    into v_function_blockers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and pg_get_functiondef(p.oid) ilike '%company_id%'
    and pg_get_functiondef(p.oid) ilike '%current_user_has_role%'
    and pg_get_functiondef(p.oid) ~* 'flux_(finance|approver|member)_roles|finance|finanzas|director|approver_2|solicitante|operator'
    and p.proname not in (
      'current_user_has_role',
      'notification_current_user_has_role'
    );

  if v_policy_blockers is not null then
    raise exception 'company_role_preflight_legacy_policy_blockers: %', v_policy_blockers;
  end if;
  if v_function_blockers is not null then
    raise exception 'company_role_preflight_legacy_function_blockers: %', v_function_blockers;
  end if;
  if v_power_blockers is not null then
    raise exception 'company_role_preflight_unauthorized_global_power: %', v_power_blockers;
  end if;

  raise notice 'COMPANY_ROLE_CUTOVER_PREFLIGHT_PASS';
end;
$preflight$;

rollback;
