-- 034_support_multiple_active_company_directors.sql
-- Forward-only correction: multiple Directors may be available for future
-- batches, while every batch keeps one immutable Director snapshot.

begin;

do $$
begin
  if to_regclass('public.company_directors') is null
     or to_regclass('public.approval_batches') is null
     or to_regclass('public.approval_batch_items') is null
     or to_regclass('public.activity_log') is null then
    raise exception '034_precheck: required approval-batch tables are missing';
  end if;

  if to_regclass('public.company_directors_one_active_per_company_uidx') is null then
    raise exception '034_precheck: 033 one-active-per-company index is missing';
  end if;

  if to_regclass('public.company_directors_active_uidx') is null then
    raise exception '034_precheck: active company/director pair protection is missing';
  end if;

  if to_regprocedure('public.set_company_director_for_future_batches(uuid,uuid)') is null
     or to_regprocedure('public.create_approval_batch(uuid,text,date,date,uuid,text)') is null
     or to_regprocedure('public.list_company_directors(uuid)') is null
     or to_regprocedure('public.list_approval_batch_director_candidates(uuid)') is null
     or to_regprocedure('public.list_director_approval_batches(text)') is null
     or to_regprocedure('public.approve_entire_batch(uuid)') is null
     or to_regprocedure('public.decide_approval_batch_items(uuid,jsonb)') is null then
    raise exception '034_precheck: required 033 approval-batch functions are missing';
  end if;

  if to_regprocedure('public.add_company_director_for_future_batches(uuid,uuid)') is not null
     or to_regprocedure('public.remove_company_director_for_future_batches(uuid,uuid)') is not null then
    raise exception '034_precheck: multiple-Director RPCs already exist';
  end if;

  if exists (
    select 1
    from public.company_directors director_assignment
    where director_assignment.active
    group by
      director_assignment.company_id,
      director_assignment.director_profile_id
    having count(*) > 1
  ) then
    raise exception '034_precheck: duplicate active company/Director pairs exist';
  end if;
end
$$;

drop index public.company_directors_one_active_per_company_uidx;

create or replace function public.approval_batch_require_active_direction()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
begin
  v_actor := public.approval_batch_require_actor();

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = v_actor
      and profile.active
  ) then
    raise exception 'director_profile_not_found_or_inactive';
  end if;

  if not public.current_user_has_role(
    public.approval_batch_direction_roles()
  ) then
    raise exception 'director_role_required';
  end if;

  return v_actor;
end
$$;

comment on function public.approval_batch_require_active_direction() is
  'Requires an authenticated active Direction profile; intentionally does not depend on the future-batch Director pool.';

create or replace function public.list_company_directors(
  p_company_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.approval_batch_require_finance();

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', director_assignment.id,
        'company_id', director_assignment.company_id,
        'company_name', coalesce(
          nullif(btrim(company.legal_name), ''),
          company.name
        ),
        'director_profile_id', director_assignment.director_profile_id,
        'director_name', director_profile.full_name,
        'director_email', director_profile.email,
        'director_profile_active', coalesce(director_profile.active, false),
        'director_role_valid', exists (
          select 1
          from public.user_roles user_role
          join public.roles role on role.id = user_role.role_id
          where user_role.profile_id = director_assignment.director_profile_id
            and lower(btrim(role.name)) =
              any(public.approval_batch_direction_roles())
        ),
        'director_membership_active', exists (
          select 1
          from public.profile_company_memberships membership
          where membership.profile_id = director_assignment.director_profile_id
            and membership.company_id = director_assignment.company_id
            and membership.active
        ),
        'active', director_assignment.active
      )
      order by
        coalesce(nullif(btrim(company.legal_name), ''), company.name),
        director_assignment.active desc,
        director_profile.full_name,
        director_assignment.created_at,
        director_assignment.id
    )
    from public.company_directors director_assignment
    join public.companies company
      on company.id = director_assignment.company_id
    join public.profiles director_profile
      on director_profile.id = director_assignment.director_profile_id
    where p_company_id is null
       or director_assignment.company_id = p_company_id
  ), '[]'::jsonb);
end
$$;

comment on function public.list_company_directors(uuid) is
  'Lists the future-batch Director pool and reports profile, role and company-membership eligibility independently.';

create or replace function public.list_approval_batch_director_candidates(
  p_company_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.approval_batch_require_finance();

  if p_company_id is not null and not exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and coalesce(company.active, false)
  ) then
    raise exception 'company_not_found_or_inactive';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'profile_id', candidate.profile_id,
        'name', candidate.full_name,
        'email', candidate.email,
        'roles', candidate.roles,
        'profile_active', true,
        'membership_active', true,
        'assignment_id', candidate.assignment_id,
        'assigned_active', candidate.assigned_active
      )
      order by
        candidate.assigned_active desc,
        candidate.full_name,
        candidate.email
    )
    from (
      select
        profile.id as profile_id,
        profile.full_name,
        profile.email,
        array_agg(
          distinct lower(btrim(role.name))
          order by lower(btrim(role.name))
        ) as roles,
        (
          select director_assignment.id
          from public.company_directors director_assignment
          where director_assignment.company_id = p_company_id
            and director_assignment.director_profile_id = profile.id
          order by
            director_assignment.active desc,
            director_assignment.created_at desc,
            director_assignment.id desc
          limit 1
        ) as assignment_id,
        exists (
          select 1
          from public.company_directors director_assignment
          where director_assignment.company_id = p_company_id
            and director_assignment.director_profile_id = profile.id
            and director_assignment.active
        ) as assigned_active
      from public.profiles profile
      join public.user_roles user_role on user_role.profile_id = profile.id
      join public.roles role on role.id = user_role.role_id
      where profile.active
        and lower(btrim(role.name)) =
          any(public.approval_batch_direction_roles())
        and exists (
          select 1
          from public.profile_company_memberships membership
          join public.companies member_company
            on member_company.id = membership.company_id
          where membership.profile_id = profile.id
            and membership.active
            and coalesce(member_company.active, false)
            and (
              p_company_id is null
              or membership.company_id = p_company_id
            )
        )
      group by profile.id, profile.full_name, profile.email
    ) candidate
  ), '[]'::jsonb);
end
$$;

comment on function public.list_approval_batch_director_candidates(uuid) is
  'Returns active Direction profiles with active company membership and reports whether each one is already in the future-batch pool.';

create function public.add_company_director_for_future_batches(
  p_company_id uuid,
  p_director_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_assignment_id uuid;
  v_changed boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if p_company_id is null or p_director_profile_id is null then
    raise exception 'company_and_director_required';
  end if;

  v_actor := public.approval_batch_require_finance();
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 21034));

  perform 1
  from public.companies company
  where company.id = p_company_id
    and coalesce(company.active, false)
  for update;

  if not found then
    raise exception 'company_not_found_or_inactive';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_director_profile_id
      and profile.active
  ) then
    raise exception 'director_profile_not_found_or_inactive';
  end if;

  if not exists (
    select 1
    from public.user_roles user_role
    join public.roles role on role.id = user_role.role_id
    where user_role.profile_id = p_director_profile_id
      and lower(btrim(role.name)) =
        any(public.approval_batch_direction_roles())
  ) then
    raise exception 'director_role_required';
  end if;

  if not exists (
    select 1
    from public.profile_company_memberships membership
    where membership.profile_id = p_director_profile_id
      and membership.company_id = p_company_id
      and membership.active
  ) then
    raise exception 'director_company_membership_required';
  end if;

  perform 1
  from public.company_directors director_assignment
  where director_assignment.company_id = p_company_id
  order by director_assignment.id
  for update;

  select director_assignment.id
    into v_assignment_id
  from public.company_directors director_assignment
  where director_assignment.company_id = p_company_id
    and director_assignment.director_profile_id = p_director_profile_id
  order by
    director_assignment.active desc,
    director_assignment.created_at desc,
    director_assignment.id desc
  limit 1
  for update;

  if v_assignment_id is null then
    insert into public.company_directors(
      company_id,
      director_profile_id,
      active,
      created_by,
      created_at,
      updated_at
    ) values (
      p_company_id,
      p_director_profile_id,
      true,
      v_actor,
      v_now,
      v_now
    )
    returning id into v_assignment_id;
    v_changed := true;
  else
    update public.company_directors director_assignment
    set active = true,
        updated_at = v_now
    where director_assignment.id = v_assignment_id
      and not director_assignment.active;
    v_changed := found;
  end if;

  if v_changed then
    insert into public.activity_log(
      entity_type,
      entity_id,
      action,
      old_values,
      new_values,
      performed_by,
      performed_at,
      notes
    ) values (
      'company',
      p_company_id,
      'future_batch_director_added',
      jsonb_build_object('active', false),
      jsonb_build_object(
        'director_profile_id', p_director_profile_id,
        'active', true
      ),
      v_actor,
      v_now,
      'Future-batch pool changed; existing and historical batch Director snapshots are unchanged.'
    );
  end if;

  return jsonb_build_object(
    'company_id', p_company_id,
    'director_assignment_id', v_assignment_id,
    'director_profile_id', p_director_profile_id,
    'active', true,
    'changed', v_changed,
    'changed_at', case when v_changed then v_now else null end
  );
end
$$;

comment on function public.add_company_director_for_future_batches(uuid,uuid) is
  'Adds or reactivates one eligible Director in the future-batch pool without replacing any other Director or modifying batches.';

create function public.remove_company_director_for_future_batches(
  p_company_id uuid,
  p_director_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_assignment_id uuid;
  v_active_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_company_id is null or p_director_profile_id is null then
    raise exception 'company_and_director_required';
  end if;

  v_actor := public.approval_batch_require_finance();
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 21034));

  perform 1
  from public.companies company
  where company.id = p_company_id
  for update;

  if not found then
    raise exception 'company_not_found';
  end if;

  perform 1
  from public.company_directors director_assignment
  where director_assignment.company_id = p_company_id
  order by director_assignment.id
  for update;

  select director_assignment.id
    into v_assignment_id
  from public.company_directors director_assignment
  where director_assignment.company_id = p_company_id
    and director_assignment.director_profile_id = p_director_profile_id
    and director_assignment.active
  order by director_assignment.created_at desc, director_assignment.id desc
  limit 1;

  if v_assignment_id is null then
    select director_assignment.id
      into v_assignment_id
    from public.company_directors director_assignment
    where director_assignment.company_id = p_company_id
      and director_assignment.director_profile_id = p_director_profile_id
    order by director_assignment.created_at desc, director_assignment.id desc
    limit 1;

    return jsonb_build_object(
      'company_id', p_company_id,
      'director_assignment_id', v_assignment_id,
      'director_profile_id', p_director_profile_id,
      'active', false,
      'changed', false,
      'reason', 'already_inactive_or_not_assigned',
      'changed_at', null
    );
  end if;

  select count(*)
    into v_active_count
  from public.company_directors director_assignment
  where director_assignment.company_id = p_company_id
    and director_assignment.active;

  if v_active_count <= 1 then
    raise exception 'last_active_company_director_required';
  end if;

  update public.company_directors director_assignment
  set active = false,
      updated_at = v_now
  where director_assignment.id = v_assignment_id
    and director_assignment.active;

  insert into public.activity_log(
    entity_type,
    entity_id,
    action,
    old_values,
    new_values,
    performed_by,
    performed_at,
    notes
  ) values (
    'company',
    p_company_id,
    'future_batch_director_removed',
    jsonb_build_object(
      'director_profile_id', p_director_profile_id,
      'active', true
    ),
    jsonb_build_object(
      'director_profile_id', p_director_profile_id,
      'active', false
    ),
    v_actor,
    v_now,
    'Future-batch pool changed; existing and historical batch Director snapshots are unchanged.'
  );

  return jsonb_build_object(
    'company_id', p_company_id,
    'director_assignment_id', v_assignment_id,
    'director_profile_id', p_director_profile_id,
    'active', false,
    'changed', true,
    'changed_at', v_now
  );
end
$$;

comment on function public.remove_company_director_for_future_batches(uuid,uuid) is
  'Removes one Director from the future-batch pool while preserving at least one active Director and every existing batch snapshot.';

create or replace function public.create_approval_batch(
  p_company_id uuid,
  p_label text default null,
  p_period_start date default null,
  p_period_end date default null,
  p_director_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_period_end date;
  v_period_start date;
  v_company_name text;
  v_label text;
  v_id uuid;
begin
  v_actor := public.approval_batch_require_finance();

  if p_director_id is null then
    raise exception 'company_director_selection_required';
  end if;

  select coalesce(nullif(btrim(company.legal_name), ''), company.name)
    into v_company_name
  from public.companies company
  where company.id = p_company_id
    and coalesce(company.active, false);

  if v_company_name is null then
    raise exception 'company_not_found_or_inactive';
  end if;

  if not exists (
    select 1
    from public.company_directors director_assignment
    join public.profiles director_profile
      on director_profile.id = director_assignment.director_profile_id
    where director_assignment.company_id = p_company_id
      and director_assignment.director_profile_id = p_director_id
      and director_assignment.active
      and director_profile.active
      and exists (
        select 1
        from public.user_roles user_role
        join public.roles role on role.id = user_role.role_id
        where user_role.profile_id = director_assignment.director_profile_id
          and lower(btrim(role.name)) =
            any(public.approval_batch_direction_roles())
      )
      and exists (
        select 1
        from public.profile_company_memberships membership
        where membership.profile_id = director_assignment.director_profile_id
          and membership.company_id = director_assignment.company_id
          and membership.active
      )
  ) then
    raise exception 'company_director_not_active_or_ineligible';
  end if;

  v_period_end := coalesce(
    p_period_end,
    current_date + mod(3 - extract(isodow from current_date)::integer + 7, 7)
  );
  v_period_start := coalesce(p_period_start, v_period_end - 6);

  if v_period_start > v_period_end then
    raise exception 'invalid_batch_period';
  end if;

  v_label := coalesce(
    nullif(btrim(p_label), ''),
    'Corte ' || v_company_name || ' ' ||
      to_char(v_period_end, 'IYYY-"W"IW')
  );

  insert into public.approval_batches(
    company_id,
    label,
    period_start,
    period_end,
    director_id,
    created_by,
    notes
  ) values (
    p_company_id,
    v_label,
    v_period_start,
    v_period_end,
    p_director_id,
    v_actor,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object(
    'batch_id', v_id,
    'status', 'draft',
    'label', v_label,
    'director_id', p_director_id
  );
end
$$;

comment on function public.create_approval_batch(uuid,text,date,date,uuid,text) is
  'Creates one batch with exactly one explicitly selected active and eligible company Director.';

create or replace function public.list_director_approval_batches(
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
begin
  v_actor := public.approval_batch_require_active_direction();

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', batch.id,
        'label', batch.label,
        'company_id', batch.company_id,
        'company_name', coalesce(
          nullif(btrim(company.legal_name), ''),
          company.name
        ),
        'status', batch.status,
        'period_start', batch.period_start,
        'period_end', batch.period_end,
        'item_count', (
          select count(*)
          from public.approval_batch_items batch_item
          where batch_item.batch_id = batch.id
            and batch_item.removed_at is null
        ),
        'totals_by_currency',
          public.approval_batch_totals_by_currency(batch.id),
        'submitted_at', batch.submitted_at
      )
      order by batch.created_at desc
    )
    from public.approval_batches batch
    join public.companies company on company.id = batch.company_id
    where batch.director_id = v_actor
      and (p_status is null or batch.status = p_status)
  ), '[]'::jsonb);
end
$$;

comment on function public.list_director_approval_batches(text) is
  'Lists batches assigned to the active Direction actor, independent of future-pool membership.';

create or replace function public.approve_entire_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
  v_count integer;
  v_rejected integer;
  v_final_status text;
begin
  v_actor := public.approval_batch_require_active_direction();

  select *
    into v_batch
  from public.approval_batches
  where id = p_batch_id
  for update;

  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.director_id <> v_actor then
    raise exception 'batch_director_required';
  end if;
  if v_batch.status <> 'submitted' then
    raise exception 'batch_must_be_submitted';
  end if;

  update public.approval_batch_items
  set director_status = 'approved',
      director_reject_reason = null,
      rebatch_status = 'not_applicable',
      rebatch_released_by = null,
      rebatch_released_at = null,
      rebatch_release_note = null,
      decided_by = v_actor,
      decided_at = now()
  where batch_id = p_batch_id
    and removed_at is null
    and director_status = 'pending';
  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception 'batch_has_no_pending_items';
  end if;

  select count(*)
    into v_rejected
  from public.approval_batch_items
  where batch_id = p_batch_id
    and removed_at is null
    and director_status = 'rejected';

  v_final_status := case
    when v_rejected > 0 then 'partially_approved'
    else 'approved'
  end;

  update public.approval_batches
  set status = v_final_status,
      decided_by = v_actor,
      decided_at = now()
  where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', v_final_status,
    'approved_items', v_count,
    'rejected_items', v_rejected,
    'approval_model', 'single_direction'
  );
end
$$;

comment on function public.approve_entire_batch(uuid) is
  'Allows only the active Direction profile stored on the batch to approve it; future-pool membership is intentionally ignored.';

create or replace function public.decide_approval_batch_items(
  p_batch_id uuid,
  p_decisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
  v_decision jsonb;
  v_item_id uuid;
  v_status text;
  v_reason text;
  v_updated integer := 0;
  v_pending integer;
  v_approved integer;
  v_rejected integer;
  v_final_status text;
begin
  v_actor := public.approval_batch_require_active_direction();

  select *
    into v_batch
  from public.approval_batches
  where id = p_batch_id
  for update;

  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.director_id <> v_actor then
    raise exception 'batch_director_required';
  end if;
  if v_batch.status <> 'submitted' then
    raise exception 'batch_must_be_submitted';
  end if;
  if jsonb_typeof(p_decisions) <> 'array'
     or jsonb_array_length(p_decisions) = 0 then
    raise exception 'decisions_array_required';
  end if;

  if exists (
    select 1
    from (
      select nullif(value ->> 'item_id', '') as item_id
      from jsonb_array_elements(p_decisions)
    ) decisions
    group by decisions.item_id
    having decisions.item_id is null or count(*) > 1
  ) then
    raise exception 'duplicate_or_missing_item_decision';
  end if;

  for v_decision in
    select value from jsonb_array_elements(p_decisions)
  loop
    v_item_id := nullif(v_decision ->> 'item_id', '')::uuid;
    v_status := lower(btrim(coalesce(v_decision ->> 'status', '')));
    v_reason :=
      nullif(btrim(coalesce(v_decision ->> 'reject_reason', '')), '');

    if v_status not in ('approved', 'rejected') then
      raise exception 'invalid_item_decision';
    end if;
    if v_status = 'rejected' and v_reason is null then
      raise exception 'reject_reason_required';
    end if;

    update public.approval_batch_items
    set director_status = v_status,
        director_reject_reason = case
          when v_status = 'rejected' then v_reason
          else null
        end,
        rebatch_status = case
          when v_status = 'rejected' then 'blocked'
          else 'not_applicable'
        end,
        rebatch_released_by = null,
        rebatch_released_at = null,
        rebatch_release_note = null,
        decided_by = v_actor,
        decided_at = now()
    where id = v_item_id
      and batch_id = p_batch_id
      and removed_at is null
      and director_status = 'pending';

    if not found then
      raise exception 'pending_batch_item_not_found:%', v_item_id;
    end if;
    v_updated := v_updated + 1;
  end loop;

  select
    count(*) filter (where director_status = 'pending'),
    count(*) filter (where director_status = 'approved'),
    count(*) filter (where director_status = 'rejected')
    into v_pending, v_approved, v_rejected
  from public.approval_batch_items
  where batch_id = p_batch_id
    and removed_at is null;

  if v_pending = 0 then
    v_final_status := case
      when v_rejected > 0 then 'partially_approved'
      else 'approved'
    end;

    update public.approval_batches
    set status = v_final_status,
        decided_by = v_actor,
        decided_at = now()
    where id = p_batch_id;
  else
    v_final_status := 'submitted';
  end if;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', v_final_status,
    'updated_items', v_updated,
    'pending_items', v_pending,
    'approved_items', v_approved,
    'rejected_items', v_rejected,
    'approval_model', 'single_direction'
  );
end
$$;

comment on function public.decide_approval_batch_items(uuid,jsonb) is
  'Allows only the active Direction profile stored on the batch to decide items; future-pool membership is intentionally ignored.';

revoke all on function public.approval_batch_require_active_direction()
  from public, anon, authenticated, service_role;
revoke all on function public.add_company_director_for_future_batches(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.remove_company_director_for_future_batches(uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute
  on function public.add_company_director_for_future_batches(uuid,uuid)
  to authenticated;
grant execute
  on function public.remove_company_director_for_future_batches(uuid,uuid)
  to authenticated;

revoke all on function public.set_company_director_for_future_batches(uuid,uuid)
  from public, anon, authenticated, service_role;
drop function public.set_company_director_for_future_batches(uuid,uuid);

revoke all on function public.list_company_directors(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_approval_batch_director_candidates(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_approval_batch(uuid,text,date,date,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_director_approval_batches(text)
  from public, anon, authenticated, service_role;
revoke all on function public.approve_entire_batch(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.decide_approval_batch_items(uuid,jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.list_company_directors(uuid)
  to authenticated;
grant execute on function public.list_approval_batch_director_candidates(uuid)
  to authenticated;
grant execute on function public.create_approval_batch(uuid,text,date,date,uuid,text)
  to authenticated;
grant execute on function public.list_director_approval_batches(text)
  to authenticated;
grant execute on function public.approve_entire_batch(uuid)
  to authenticated;
grant execute on function public.decide_approval_batch_items(uuid,jsonb)
  to authenticated;

do $$
declare
  v_pair_index_definition text;
  v_function_oid regprocedure;
  v_function_config text[];
  v_security_definer boolean;
  v_public_execute boolean;
begin
  if to_regclass('public.company_directors_one_active_per_company_uidx')
       is not null then
    raise exception '034_postcheck: one-active-per-company index still exists';
  end if;

  if to_regclass('public.company_directors_active_uidx') is null then
    raise exception '034_postcheck: active company/Director pair index is missing';
  end if;

  select pg_get_indexdef(
    'public.company_directors_active_uidx'::regclass
  )
    into v_pair_index_definition;

  if v_pair_index_definition not ilike '%unique index%'
     or v_pair_index_definition not ilike '%(company_id, director_profile_id)%'
     or v_pair_index_definition not ilike '%where active%' then
    raise exception '034_postcheck: active pair index definition changed: %',
      v_pair_index_definition;
  end if;

  if to_regprocedure('public.add_company_director_for_future_batches(uuid,uuid)') is null
     or to_regprocedure('public.remove_company_director_for_future_batches(uuid,uuid)') is null
     or to_regprocedure('public.approval_batch_require_active_direction()') is null then
    raise exception '034_postcheck: required multiple-Director functions are missing';
  end if;

  if to_regprocedure('public.set_company_director_for_future_batches(uuid,uuid)')
       is not null then
    raise exception '034_postcheck: replacement RPC still exists';
  end if;

  foreach v_function_oid in array array[
    'public.add_company_director_for_future_batches(uuid,uuid)'::regprocedure,
    'public.remove_company_director_for_future_batches(uuid,uuid)'::regprocedure,
    'public.approval_batch_require_active_direction()'::regprocedure,
    'public.list_company_directors(uuid)'::regprocedure,
    'public.list_approval_batch_director_candidates(uuid)'::regprocedure,
    'public.create_approval_batch(uuid,text,date,date,uuid,text)'::regprocedure,
    'public.list_director_approval_batches(text)'::regprocedure,
    'public.approve_entire_batch(uuid)'::regprocedure,
    'public.decide_approval_batch_items(uuid,jsonb)'::regprocedure
  ]
  loop
    select procedure.prosecdef, procedure.proconfig
      into strict v_security_definer, v_function_config
    from pg_proc procedure
    where procedure.oid = v_function_oid::oid;

    if not v_security_definer then
      raise exception '034_postcheck: function is not SECURITY DEFINER: %',
        v_function_oid;
    end if;

    if not coalesce(v_function_config, array[]::text[])
      @> array['search_path=public, pg_temp']::text[] then
      raise exception '034_postcheck: fixed search_path is missing: %',
        v_function_oid;
    end if;
  end loop;

  foreach v_function_oid in array array[
    'public.add_company_director_for_future_batches(uuid,uuid)'::regprocedure,
    'public.remove_company_director_for_future_batches(uuid,uuid)'::regprocedure,
    'public.list_company_directors(uuid)'::regprocedure,
    'public.list_approval_batch_director_candidates(uuid)'::regprocedure,
    'public.create_approval_batch(uuid,text,date,date,uuid,text)'::regprocedure,
    'public.list_director_approval_batches(text)'::regprocedure,
    'public.approve_entire_batch(uuid)'::regprocedure,
    'public.decide_approval_batch_items(uuid,jsonb)'::regprocedure
  ]
  loop
    select exists (
      select 1
      from pg_proc procedure,
        aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) function_acl
      where procedure.oid = v_function_oid::oid
        and function_acl.grantee = 0
        and function_acl.privilege_type = 'EXECUTE'
    )
      into v_public_execute;

    if not has_function_privilege(
      'authenticated',
      v_function_oid::text,
      'EXECUTE'
    ) then
      raise exception '034_postcheck: authenticated EXECUTE is missing: %',
        v_function_oid;
    end if;

    if has_function_privilege('anon', v_function_oid::text, 'EXECUTE')
       or v_public_execute then
      raise exception '034_postcheck: broad EXECUTE remains: %',
        v_function_oid;
    end if;
  end loop;
end
$$;

commit;
