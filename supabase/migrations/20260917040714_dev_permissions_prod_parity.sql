-- DEV user permissions: exact function definitions from PROD on 2026-09-17.
-- Reference: main 4c8966916d4ac903294f4fa3bdcb5b463185d936.
-- Preserve Sin partida validation and every existing request.
begin;

CREATE OR REPLACE FUNCTION private.profile_company_approver_roles(p_profile_id uuid, p_company_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(array_agg(candidate.role_name order by candidate.role_name), array[]::text[])
  from (
    select distinct lower(trim(
      case
        when nullif(btrim(pcm.role_key), '') is not null then pcm.role_key
        else role_row.name
      end
    )) as role_name
    from public.profile_company_memberships pcm
    left join public.user_roles legacy
      on legacy.profile_id = pcm.profile_id
     and nullif(btrim(pcm.role_key), '') is null
    left join public.roles role_row on role_row.id = legacy.role_id
    where pcm.profile_id = p_profile_id
      and pcm.company_id = p_company_id
      and pcm.active
  ) candidate
  where candidate.role_name = any (public.payment_request_approver_role_names());
$function$;
revoke all on function private.profile_company_approver_roles(uuid, uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.add_approver_assignment(p_company_id uuid, p_requester_id uuid, p_approver_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;
  if p_requester_id = p_approver_id then
    raise exception 'requester_cannot_be_own_pool_approver';
  end if;
  if not public.has_active_company_membership(p_requester_id, p_company_id) then
    raise exception 'requester_company_membership_required';
  end if;
  if not public.has_active_company_membership(p_approver_id, p_company_id) then
    raise exception 'approver_company_membership_required';
  end if;
  if cardinality(private.profile_company_approver_roles(p_approver_id, p_company_id)) = 0 then
    raise exception 'approver_role_required';
  end if;

  insert into public.approver_assignments (
    company_id, requester_id, approver_id, active, created_by, updated_at
  ) values (
    p_company_id, p_requester_id, p_approver_id, true,
    public.current_profile_id(), now()
  )
  on conflict (company_id, requester_id, approver_id)
  do update set active = true, updated_at = now()
  where not approver_assignments.active
  returning id into v_id;

  if v_id is null then
    raise exception 'approver_already_configured';
  end if;
  return v_id;
end;
$function$;
revoke all on function public.add_approver_assignment(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.add_approver_assignment(uuid, uuid, uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_payment_request_approver_details(p_payment_request_id uuid)
 RETURNS TABLE(profile_id uuid, display_name text, email text, is_fixed boolean, source text, eligible_roles text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor_id uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
begin
  if v_actor_id is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id;
  if not found then
    raise exception 'payment_request_not_found';
  end if;
  if not (
    v_request.requested_by = v_actor_id
    or v_request.approver_id = v_actor_id
    or public.current_user_has_role(public.flux_sysadmin_roles())
    or (
      private.current_profile_has_company_role(
        v_request.company_id, array['finance','director']::text[]
      )
      and public.has_active_company_membership(v_actor_id, v_request.company_id)
    )
  ) then
    raise exception 'payment_request_not_visible';
  end if;

  return query
  select
    profile_row.id,
    coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email),
    profile_row.email,
    v_request.approver_assignment_id is not null,
    coalesce(v_request.approver_selection_source, 'historical'),
    coalesce(
      private.profile_company_approver_roles(profile_row.id, v_request.company_id),
      array[]::text[]
    )
  from (select 1) seed
  left join public.profiles profile_row on profile_row.id = v_request.approver_id;
end;
$function$;
revoke all on function public.get_payment_request_approver_details(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_payment_request_approver_details(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_payment_request_approver_for_company(p_profile_id uuid, p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select cardinality(
    private.profile_company_approver_roles(p_profile_id, p_company_id)
  ) > 0;
$function$;
revoke all on function public.is_payment_request_approver_for_company(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_payment_request_approver_for_company(uuid, uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_company_approver_candidates(p_company_id uuid, p_requester_id uuid)
 RETURNS TABLE(profile_id uuid, display_name text, email text, eligible_roles text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;

  return query
  select
    profile_row.id,
    coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email),
    profile_row.email,
    private.profile_company_approver_roles(profile_row.id, p_company_id)
  from public.profile_company_memberships membership
  join public.profiles profile_row on profile_row.id = membership.profile_id
  where membership.company_id = p_company_id
    and membership.active
    and coalesce(profile_row.active, true)
    and profile_row.id <> p_requester_id
    and cardinality(private.profile_company_approver_roles(profile_row.id, p_company_id)) > 0
    and not exists (
      select 1
      from public.approver_assignments assignment
      where assignment.company_id = p_company_id
        and assignment.requester_id = p_requester_id
        and assignment.approver_id = profile_row.id
        and assignment.active
    )
  order by coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email);
end;
$function$;
revoke all on function public.list_company_approver_candidates(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_company_approver_candidates(uuid, uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_payment_request_approver_options(p_company_id uuid, p_cost_center_id uuid, p_amount numeric)
 RETURNS TABLE(profile_id uuid, display_name text, email text, eligible_roles text[], source text, assignment_id uuid, option_label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_requester_id uuid := public.current_profile_id();
  v_has_pool boolean;
begin
  if v_requester_id is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_active_company_membership(v_requester_id, p_company_id)
     and not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'company_scope_required';
  end if;

  v_has_pool := public.payment_request_has_active_approver_pool(v_requester_id, p_company_id);
  if v_has_pool then
    return query
    select
      profile_row.id,
      coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email),
      profile_row.email,
      private.profile_company_approver_roles(profile_row.id, p_company_id),
      'assigned'::text,
      assignment.id,
      coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email)
        || ' - ' || array_to_string(
          private.profile_company_approver_roles(profile_row.id, p_company_id), ', '
        )
    from public.approver_assignments assignment
    join public.profiles profile_row on profile_row.id = assignment.approver_id
    join public.profile_company_memberships membership
      on membership.profile_id = profile_row.id
     and membership.company_id = assignment.company_id
     and membership.active
    where assignment.requester_id = v_requester_id
      and assignment.company_id = p_company_id
      and assignment.active
      and coalesce(profile_row.active, true)
      and cardinality(private.profile_company_approver_roles(profile_row.id, p_company_id)) > 0
    order by coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email);
    return;
  end if;

  if p_cost_center_id is null or p_amount is null or p_amount <= 0 then
    return;
  end if;

  return query
  select
    profile_row.id,
    coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email),
    profile_row.email,
    private.profile_company_approver_roles(profile_row.id, p_company_id),
    'approval_rules'::text,
    null::uuid,
    coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email)
      || ' - ' || array_to_string(
        private.profile_company_approver_roles(profile_row.id, p_company_id), ', '
      )
  from public.profile_company_memberships membership
  join public.profiles profile_row on profile_row.id = membership.profile_id
  where membership.company_id = p_company_id
    and membership.active
    and coalesce(profile_row.active, true)
    and profile_row.id <> v_requester_id
    and cardinality(private.profile_company_approver_roles(profile_row.id, p_company_id)) > 0
    and public.payment_request_rule_allows(
      profile_row.id, p_company_id, p_cost_center_id, p_amount, 'approved'
    )
  order by coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email);
end;
$function$;
revoke all on function public.list_payment_request_approver_options(uuid, uuid, numeric) from public, anon, authenticated, service_role;
grant execute on function public.list_payment_request_approver_options(uuid, uuid, numeric) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.payment_request_approver_role_names()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select array['finance','finanzas','director','direccion','approver_2','aprobador_2']::text[];
$function$;
revoke all on function public.payment_request_approver_role_names() from public, anon, authenticated, service_role;
grant execute on function public.payment_request_approver_role_names() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.payment_request_rule_allows(p_profile_id uuid, p_company_id uuid, p_cost_center_id uuid, p_amount numeric, p_action text DEFAULT 'approved'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_payment_request_approver_for_company(p_profile_id, p_company_id)
    and exists (
      select 1
      from public.approval_rules ar
      join public.roles rule_role on rule_role.id = ar.role_id
      where ar.active
        and lower(trim(rule_role.name)) = any (
          private.profile_company_approver_roles(p_profile_id, p_company_id)
        )
        and (ar.company_id is null or ar.company_id = p_company_id)
        and (ar.cost_center_id is null or ar.cost_center_id = p_cost_center_id)
        and coalesce(p_amount, 0) >= ar.amount_min
        and (ar.amount_max is null or coalesce(p_amount, 0) <= ar.amount_max)
        and case p_action
          when 'approved' then ar.can_approve
          when 'exception_approved' then ar.can_approve and ar.can_approve_exception
          when 'rejected' then ar.can_reject
          when 'exception_rejected' then ar.can_reject
          when 'changes_requested' then ar.can_request_changes
          when 'amount_change_requested' then ar.can_request_changes
          when 'category_change_requested' then ar.can_request_changes
          when 'budget_adjustment_requested' then ar.can_request_budget_adjustment
          else false
        end
    );
$function$;
revoke all on function public.payment_request_rule_allows(uuid, uuid, uuid, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.payment_request_rule_allows(uuid, uuid, uuid, numeric, text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_company_access_request(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid;
  v_request public.company_access_requests%rowtype;
begin
  v_actor := public.current_profile_id();
  if auth.uid() is null
     or v_actor is null
     or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;

  select ar.* into v_request
  from public.company_access_requests ar
  where ar.id = p_request_id
  for update;
  if not found then
    raise exception 'company_access_request_not_found';
  end if;
  if v_request.status = 'approved' then
    raise exception 'company_access_request_already_approved';
  end if;

  update public.company_access_requests ar
  set status = 'rejected',
      reviewed_at = now(),
      reviewed_by = v_actor,
      approved_role = null,
      updated_at = now()
  where ar.id = v_request.id;

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', 'rejected'
  );
end;
$function$;
revoke all on function public.reject_company_access_request(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reject_company_access_request(uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_approver_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.requester_id = new.approver_id then
    raise exception 'requester_cannot_be_own_pool_approver';
  end if;
  if new.active then
    if not public.has_active_company_membership(new.requester_id, new.company_id) then
      raise exception 'requester_company_membership_required';
    end if;
    if not public.has_active_company_membership(new.approver_id, new.company_id) then
      raise exception 'approver_company_membership_required';
    end if;
    if cardinality(private.profile_company_approver_roles(new.approver_id, new.company_id)) = 0 then
      raise exception 'approver_role_required';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;
revoke all on function public.validate_approver_assignment() from public, anon, authenticated, service_role;
grant execute on function public.validate_approver_assignment() to service_role;

commit;
