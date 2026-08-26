-- CONTPAQ mapper graph hardening: N:N edges, one finance review per budget line,
-- derived connected-component buckets, and transitive-merge preview/confirmation.
-- DEV-first. No seed rows for new mappings are created here.

alter table public.budget_account_mappings
  drop constraint if exists budget_account_mappings_company_id_budget_category_id_key,
  drop constraint if exists budget_account_mappings_company_category_key;

alter table public.budget_account_mappings
  drop constraint if exists budget_account_mappings_company_category_account_key;

alter table public.budget_account_mappings
  add constraint budget_account_mappings_company_category_account_key
  unique (company_id, budget_category_id, contpaq_account_code);

-- Existing rows with versioned evidence came from the reproducible seed.
update public.budget_account_mappings
set mapping_source = 'seed_reproducible'
where mapping_source = 'manual'
  and nullif(btrim(mapping_evidence), '') is not null;

create table if not exists public.budget_mapping_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  budget_category_id uuid not null references public.budget_categories(id),
  status text not null default 'pending_finance'
    check (status in ('pending_finance','validated')),
  formal_reason text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_mapping_reviews_company_category_key
    unique (company_id, budget_category_id),
  constraint budget_mapping_reviews_validated_reason_check
    check (
      status <> 'validated'
      or coalesce(char_length(btrim(formal_reason)), 0) >= 8
    ),
  constraint budget_mapping_reviews_reason_length_check
    check (formal_reason is null or char_length(formal_reason) <= 1000)
);

comment on table public.budget_mapping_reviews is
  'Finance review belongs to the budget line (company + category), not to each CONTPAQ mapping edge.';
comment on column public.budget_mapping_reviews.formal_reason is
  'Human-authored Finance rationale. Never generated from mapping_evidence.';

insert into public.budget_mapping_reviews (
  company_id,
  budget_category_id,
  status,
  formal_reason,
  reviewed_by,
  reviewed_at
)
select
  m.company_id,
  m.budget_category_id,
  case
    when bool_or(
      m.formal_reason_status = 'validated'
      and coalesce(char_length(btrim(m.mapping_reason)), 0) >= 8
    ) then 'validated'
    else 'pending_finance'
  end,
  max(nullif(btrim(m.mapping_reason), '')),
  null::uuid,
  case
    when bool_or(m.formal_reason_status = 'validated') then max(m.updated_at)
    else null
  end
from public.budget_account_mappings m
where m.needs_review
group by m.company_id, m.budget_category_id
on conflict (company_id, budget_category_id) do nothing;

-- Per-edge review flags are retained only as compatibility columns.
-- Business review authority now lives in budget_mapping_reviews.
update public.budget_account_mappings
set needs_review = false,
    formal_reason_status = 'not_required'
where needs_review
   or formal_reason_status <> 'not_required';

alter table public.budget_account_mappings
  drop constraint if exists budget_account_mappings_review_status_check,
  drop constraint if exists budget_account_mappings_validated_reason_check;

comment on column public.budget_account_mappings.needs_review is
  'Deprecated compatibility flag. Finance review is stored once per company + budget_category in budget_mapping_reviews.';
comment on column public.budget_account_mappings.formal_reason_status is
  'Deprecated compatibility status. Finance review status is stored in budget_mapping_reviews.';

alter table public.budget_account_mappings
  validate constraint budget_account_mappings_evidence_semantics_check;

alter table public.budget_mapping_reviews enable row level security;
alter table public.budget_mapping_reviews force row level security;

revoke all on table public.budget_mapping_reviews from public, anon, authenticated;
grant select on table public.budget_mapping_reviews to authenticated;
grant select, insert, update, delete on table public.budget_mapping_reviews to service_role;

drop policy if exists budget_mapping_reviews_select_mapper
  on public.budget_mapping_reviews;
create policy budget_mapping_reviews_select_mapper
  on public.budget_mapping_reviews
  for select
  to authenticated
  using (public.contpaq_mapper_company_access(company_id));

-- Mapping writes now go through controlled RPCs so the graph can be re-checked
-- under a company-scoped transaction lock.
revoke insert, update, delete on table public.budget_account_mappings from authenticated;
grant select on table public.budget_account_mappings to authenticated;

create table if not exists public.budget_mapping_merge_confirmations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  budget_category_id uuid not null references public.budget_categories(id),
  contpaq_account_code text not null,
  mapping_id uuid references public.budget_account_mappings(id) on delete set null,
  preview jsonb not null,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz not null default now()
);

comment on table public.budget_mapping_merge_confirmations is
  'Audit trail for explicit Finance confirmations that merge two previously separate derived budget-control components.';

alter table public.budget_mapping_merge_confirmations enable row level security;
alter table public.budget_mapping_merge_confirmations force row level security;

revoke all on table public.budget_mapping_merge_confirmations from public, anon, authenticated;
grant select on table public.budget_mapping_merge_confirmations to authenticated;
grant select, insert, update, delete on table public.budget_mapping_merge_confirmations to service_role;

drop policy if exists budget_mapping_merge_confirmations_select_mapper
  on public.budget_mapping_merge_confirmations;
create policy budget_mapping_merge_confirmations_select_mapper
  on public.budget_mapping_merge_confirmations
  for select
  to authenticated
  using (public.contpaq_mapper_company_access(company_id));

create or replace function public.contpaq_mapper_component_nodes(
  p_company_id uuid,
  p_start_node text
)
returns table(node text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive
  mapping_edges as (
    select
      'B:' || m.budget_category_id::text as budget_node,
      'A:' || m.contpaq_account_code as account_node
    from public.budget_account_mappings m
    where m.company_id = p_company_id
  ),
  directed_edges as (
    select budget_node as src, account_node as dst from mapping_edges
    union all
    select account_node as src, budget_node as dst from mapping_edges
  ),
  walk(node) as (
    select p_start_node
    union
    select e.dst
    from walk w
    join directed_edges e on e.src = w.node
  )
  select walk.node
  from walk;
$$;

revoke all on function public.contpaq_mapper_component_nodes(uuid, text)
  from public, anon, authenticated;

create or replace function public.contpaq_mapper_component_summary(
  p_company_id uuid,
  p_nodes text[]
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  category_ids as (
    select substring(n from 3)::uuid as id
    from unnest(coalesce(p_nodes, array[]::text[])) as u(n)
    where n like 'B:%'
  ),
  account_codes as (
    select substring(n from 3) as code
    from unnest(coalesce(p_nodes, array[]::text[])) as u(n)
    where n like 'A:%'
  ),
  category_rows as (
    select bc.id, bc.code, bc.name, coalesce(bc.category, 'Sin grupo') as budget_group
    from public.budget_categories bc
    join category_ids c on c.id = bc.id
  ),
  account_rows as (
    select a.code, a.name
    from public.contpaq_accounts a
    join account_codes c on c.code = a.code
    where a.company_id = p_company_id
  ),
  budget_by_year as (
    select
      bv.year,
      coalesce(sum(bl.amount), 0)::numeric as total
    from public.budget_lines bl
    join public.budget_versions bv on bv.id = bl.budget_version_id
    join category_ids c on c.id = bl.budget_category_id
    where bl.company_id = p_company_id
      and bv.active
    group by bv.year
  )
  select jsonb_build_object(
    'categories',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', cr.id,
            'code', cr.code,
            'name', cr.name,
            'group', cr.budget_group
          )
          order by cr.name, cr.id
        )
        from category_rows cr
      ), '[]'::jsonb),
    'accounts',
      coalesce((
        select jsonb_agg(
          jsonb_build_object('code', ar.code, 'name', ar.name)
          order by ar.code
        )
        from account_rows ar
      ), '[]'::jsonb),
    'category_count', (select count(*) from category_rows),
    'account_count', (select count(*) from account_rows),
    'active_budget_total', coalesce((select sum(total) from budget_by_year), 0),
    'active_budget_by_year',
      coalesce((
        select jsonb_object_agg(year::text, total order by year)
        from budget_by_year
      ), '{}'::jsonb)
  );
$$;

revoke all on function public.contpaq_mapper_component_summary(uuid, text[])
  from public, anon, authenticated;

create or replace function public.assert_budget_mapping_transitive_merge()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_left_degree integer;
  v_right_degree integer;
  v_left_nodes text[];
  v_account_node text;
  v_signature text;
begin
  if tg_op = 'UPDATE'
     and (
       new.company_id is distinct from old.company_id
       or new.budget_category_id is distinct from old.budget_category_id
       or new.contpaq_account_code is distinct from old.contpaq_account_code
     ) then
    raise exception using
      errcode = '23514',
      message = 'contpaq_mapping_edge_identity_immutable';
  end if;

  if tg_op <> 'INSERT' then
    return new;
  end if;

  if exists (
    select 1
    from public.budget_account_mappings m
    where m.company_id = new.company_id
      and m.budget_category_id = new.budget_category_id
      and m.contpaq_account_code = new.contpaq_account_code
  ) then
    return new;
  end if;

  select count(*)
  into v_left_degree
  from public.budget_account_mappings m
  where m.company_id = new.company_id
    and m.budget_category_id = new.budget_category_id;

  select count(*)
  into v_right_degree
  from public.budget_account_mappings m
  where m.company_id = new.company_id
    and m.contpaq_account_code = new.contpaq_account_code;

  if v_left_degree = 0 or v_right_degree = 0 then
    return new;
  end if;

  select array_agg(c.node order by c.node)
  into v_left_nodes
  from public.contpaq_mapper_component_nodes(
    new.company_id,
    'B:' || new.budget_category_id::text
  ) c;

  v_account_node := 'A:' || new.contpaq_account_code;

  if v_account_node = any(coalesce(v_left_nodes, array[]::text[])) then
    return new;
  end if;

  v_signature :=
    new.company_id::text || ':' ||
    new.budget_category_id::text || ':' ||
    new.contpaq_account_code;

  if coalesce(current_setting('app.contpaq_bucket_merge_confirmed', true), '') <> v_signature then
    raise exception using
      errcode = '23514',
      message = 'contpaq_bucket_merge_confirmation_required';
  end if;

  return new;
end;
$$;

revoke all on function public.assert_budget_mapping_transitive_merge()
  from public, anon, authenticated;

drop trigger if exists budget_account_mappings_transitive_merge_guard
  on public.budget_account_mappings;
create trigger budget_account_mappings_transitive_merge_guard
before insert or update
on public.budget_account_mappings
for each row
execute function public.assert_budget_mapping_transitive_merge();

create or replace function public.contpaq_mapper_preview_mapping(
  p_company_id uuid,
  p_budget_category_id uuid,
  p_contpaq_account_code text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_budget_node text := 'B:' || p_budget_category_id::text;
  v_account_node text := 'A:' || upper(regexp_replace(coalesce(p_contpaq_account_code, ''), '[^0-9A-Za-z]', '', 'g'));
  v_account_code text := substring(v_account_node from 3);
  v_left_nodes text[];
  v_right_nodes text[];
  v_merged_nodes text[];
  v_left_degree integer;
  v_right_degree integer;
  v_edge_exists boolean;
  v_overlap boolean;
  v_requires_confirmation boolean;
begin
  if not public.contpaq_mapper_company_access(p_company_id) then
    raise exception using errcode = '42501', message = 'contpaq_mapper_company_access_denied';
  end if;

  if not exists (
    select 1
    from public.budget_categories bc
    where bc.id = p_budget_category_id
      and bc.active
  ) then
    raise exception using errcode = '23503', message = 'contpaq_mapping_budget_category_not_found';
  end if;

  if not exists (
    select 1
    from public.contpaq_account_mapper_candidates a
    where a.company_id = p_company_id
      and a.code = v_account_code
      and a.elegible_mapper
  ) then
    raise exception using errcode = '23514', message = 'contpaq_mapping_account_not_eligible';
  end if;

  select count(*)
  into v_left_degree
  from public.budget_account_mappings m
  where m.company_id = p_company_id
    and m.budget_category_id = p_budget_category_id;

  select count(*)
  into v_right_degree
  from public.budget_account_mappings m
  where m.company_id = p_company_id
    and m.contpaq_account_code = v_account_code;

  select exists (
    select 1
    from public.budget_account_mappings m
    where m.company_id = p_company_id
      and m.budget_category_id = p_budget_category_id
      and m.contpaq_account_code = v_account_code
  )
  into v_edge_exists;

  select array_agg(c.node order by c.node)
  into v_left_nodes
  from public.contpaq_mapper_component_nodes(p_company_id, v_budget_node) c;

  select array_agg(c.node order by c.node)
  into v_right_nodes
  from public.contpaq_mapper_component_nodes(p_company_id, v_account_node) c;

  v_left_nodes := coalesce(v_left_nodes, array[v_budget_node]);
  v_right_nodes := coalesce(v_right_nodes, array[v_account_node]);
  v_overlap := v_left_nodes && v_right_nodes;

  v_requires_confirmation :=
    not v_edge_exists
    and v_left_degree > 0
    and v_right_degree > 0
    and not v_overlap;

  select array_agg(distinct x order by x)
  into v_merged_nodes
  from unnest(v_left_nodes || v_right_nodes) as u(x);

  return jsonb_build_object(
    'ok', true,
    'edge_exists', v_edge_exists,
    'requires_confirmation', v_requires_confirmation,
    'category_degree', v_left_degree,
    'account_degree', v_right_degree,
    'category_component',
      public.contpaq_mapper_component_summary(p_company_id, v_left_nodes),
    'account_component',
      public.contpaq_mapper_component_summary(p_company_id, v_right_nodes),
    'result_component',
      public.contpaq_mapper_component_summary(p_company_id, v_merged_nodes)
  );
end;
$$;

revoke all on function public.contpaq_mapper_preview_mapping(uuid, uuid, text)
  from public, anon;
grant execute on function public.contpaq_mapper_preview_mapping(uuid, uuid, text)
  to authenticated, service_role;

create or replace function public.contpaq_mapper_save_mapping(
  p_company_id uuid,
  p_budget_category_id uuid,
  p_contpaq_account_code text,
  p_mapping_method text default 'manual',
  p_mapping_reason text default null,
  p_confirm_bucket_merge boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preview jsonb;
  v_requires_confirmation boolean;
  v_account_code text := upper(regexp_replace(coalesce(p_contpaq_account_code, ''), '[^0-9A-Za-z]', '', 'g'));
  v_actor uuid := public.current_profile_id();
  v_mapping_id uuid;
begin
  if not public.contpaq_mapper_company_access(p_company_id) then
    raise exception using errcode = '42501', message = 'contpaq_mapper_company_access_denied';
  end if;

  if p_mapping_method not in ('exact_name','judgment','manual','imported') then
    raise exception using errcode = '23514', message = 'contpaq_mapping_method_invalid';
  end if;

  if p_mapping_method = 'judgment'
     and coalesce(char_length(btrim(p_mapping_reason)), 0) < 8 then
    raise exception using errcode = '23514', message = 'contpaq_mapping_reason_required';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_company_id::text));

  v_preview := public.contpaq_mapper_preview_mapping(
    p_company_id,
    p_budget_category_id,
    v_account_code
  );
  v_requires_confirmation :=
    coalesce((v_preview ->> 'requires_confirmation')::boolean, false);

  if v_requires_confirmation and not p_confirm_bucket_merge then
    return v_preview || jsonb_build_object('saved', false);
  end if;

  if v_requires_confirmation
     and not public.current_user_has_role(public.flux_finance_roles()) then
    raise exception using errcode = '42501', message = 'contpaq_bucket_merge_finance_confirmation_required';
  end if;

  if v_requires_confirmation and p_confirm_bucket_merge then
    perform set_config(
      'app.contpaq_bucket_merge_confirmed',
      p_company_id::text || ':' || p_budget_category_id::text || ':' || v_account_code,
      true
    );
  end if;

  insert into public.budget_account_mappings (
    company_id,
    budget_category_id,
    contpaq_account_code,
    needs_review,
    mapping_method,
    mapping_reason,
    mapping_source,
    formal_reason_status
  )
  values (
    p_company_id,
    p_budget_category_id,
    v_account_code,
    false,
    p_mapping_method,
    nullif(btrim(p_mapping_reason), ''),
    'manual',
    'not_required'
  )
  on conflict (company_id, budget_category_id, contpaq_account_code)
  do update set
    mapping_method = excluded.mapping_method,
    mapping_reason = excluded.mapping_reason
  returning id into v_mapping_id;

  if v_requires_confirmation then
    insert into public.budget_mapping_merge_confirmations (
      company_id,
      budget_category_id,
      contpaq_account_code,
      mapping_id,
      preview,
      confirmed_by
    )
    values (
      p_company_id,
      p_budget_category_id,
      v_account_code,
      v_mapping_id,
      v_preview,
      v_actor
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'saved', true,
    'mapping_id', v_mapping_id,
    'requires_confirmation', v_requires_confirmation,
    'preview', v_preview
  );
end;
$$;

revoke all on function public.contpaq_mapper_save_mapping(uuid, uuid, text, text, text, boolean)
  from public, anon;
grant execute on function public.contpaq_mapper_save_mapping(uuid, uuid, text, text, text, boolean)
  to authenticated, service_role;

create or replace function public.contpaq_mapper_delete_mapping(
  p_mapping_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_deleted_count integer := 0;
begin
  select m.company_id
  into v_company_id
  from public.budget_account_mappings m
  where m.id = p_mapping_id;

  if v_company_id is null then
    return jsonb_build_object('ok', true, 'deleted', false);
  end if;

  if not public.contpaq_mapper_company_access(v_company_id) then
    raise exception using errcode = '42501', message = 'contpaq_mapper_company_access_denied';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_company_id::text));

  delete from public.budget_account_mappings
  where id = p_mapping_id;

  get diagnostics v_deleted_count = row_count;

  return jsonb_build_object('ok', true, 'deleted', v_deleted_count > 0);
end;
$$;

revoke all on function public.contpaq_mapper_delete_mapping(uuid)
  from public, anon;
grant execute on function public.contpaq_mapper_delete_mapping(uuid)
  to authenticated, service_role;

create or replace function public.contpaq_mapper_set_review(
  p_company_id uuid,
  p_budget_category_id uuid,
  p_status text,
  p_formal_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_review_id uuid;
begin
  if not public.contpaq_mapper_company_access(p_company_id)
     or not public.current_user_has_role(public.flux_finance_roles()) then
    raise exception using errcode = '42501', message = 'contpaq_mapping_review_finance_access_required';
  end if;

  if p_status not in ('pending_finance','validated') then
    raise exception using errcode = '23514', message = 'contpaq_mapping_review_status_invalid';
  end if;

  if p_status = 'validated'
     and coalesce(char_length(btrim(p_formal_reason)), 0) < 8 then
    raise exception using errcode = '23514', message = 'contpaq_mapping_review_reason_required';
  end if;

  if not exists (
    select 1
    from public.budget_categories bc
    where bc.id = p_budget_category_id
      and bc.active
  ) then
    raise exception using errcode = '23503', message = 'contpaq_mapping_budget_category_not_found';
  end if;

  insert into public.budget_mapping_reviews (
    company_id,
    budget_category_id,
    status,
    formal_reason,
    reviewed_by,
    reviewed_at,
    updated_at
  )
  values (
    p_company_id,
    p_budget_category_id,
    p_status,
    nullif(btrim(p_formal_reason), ''),
    case when p_status = 'validated' then v_actor else null end,
    case when p_status = 'validated' then now() else null end,
    now()
  )
  on conflict (company_id, budget_category_id)
  do update set
    status = excluded.status,
    formal_reason = excluded.formal_reason,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    updated_at = now()
  returning id into v_review_id;

  return jsonb_build_object(
    'ok', true,
    'review_id', v_review_id,
    'status', p_status
  );
end;
$$;

revoke all on function public.contpaq_mapper_set_review(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.contpaq_mapper_set_review(uuid, uuid, text, text)
  to authenticated, service_role;

create or replace function public.contpaq_budget_bucket_members(
  p_company_id uuid
)
returns table (
  bucket_key text,
  category_ids uuid[],
  category_names text[],
  category_codes text[],
  budget_groups text[],
  account_codes text[],
  account_names text[],
  category_count integer,
  account_count integer,
  bucket_label text,
  bucket_group text,
  active_budget_total numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.contpaq_mapper_company_access(p_company_id) then
    raise exception using errcode = '42501', message = 'contpaq_mapper_company_access_denied';
  end if;

  return query
  with recursive
  mapping_rows as (
    select
      m.budget_category_id,
      m.contpaq_account_code
    from public.budget_account_mappings m
    where m.company_id = p_company_id
  ),
  nodes(node) as (
    select 'B:' || budget_category_id::text from mapping_rows
    union
    select 'A:' || contpaq_account_code from mapping_rows
  ),
  directed_edges(src, dst) as (
    select
      'B:' || budget_category_id::text,
      'A:' || contpaq_account_code
    from mapping_rows
    union all
    select
      'A:' || contpaq_account_code,
      'B:' || budget_category_id::text
    from mapping_rows
  ),
  reach(start_node, node) as (
    select n.node, n.node from nodes n
    union
    select r.start_node, e.dst
    from reach r
    join directed_edges e on e.src = r.node
  ),
  components as (
    select r.node, min(r.start_node) as bucket_key
    from reach r
    group by r.node
  ),
  category_stats as (
    select
      c.bucket_key,
      array_agg(bc.id order by bc.name, bc.id) as category_ids,
      array_agg(bc.name order by bc.name, bc.id) as category_names,
      array_agg(coalesce(bc.code, '') order by bc.name, bc.id) as category_codes,
      array_agg(
        distinct coalesce(bc.category, 'Sin grupo')
        order by coalesce(bc.category, 'Sin grupo')
      ) as budget_groups
    from components c
    join public.budget_categories bc
      on c.node = 'B:' || bc.id::text
    group by c.bucket_key
  ),
  account_stats as (
    select
      c.bucket_key,
      array_agg(a.code order by a.code) as account_codes,
      array_agg(a.name order by a.code) as account_names
    from components c
    join public.contpaq_accounts a
      on c.node = 'A:' || a.code
     and a.company_id = p_company_id
    group by c.bucket_key
  ),
  budget_stats as (
    select
      cs.bucket_key,
      coalesce(sum(bl.amount), 0)::numeric as active_budget_total
    from category_stats cs
    left join public.budget_lines bl
      on bl.company_id = p_company_id
     and bl.budget_category_id = any(cs.category_ids)
    left join public.budget_versions bv
      on bv.id = bl.budget_version_id
     and bv.active
    where bl.id is null or bv.id is not null
    group by cs.bucket_key
  )
  select
    cs.bucket_key,
    cs.category_ids,
    cs.category_names,
    cs.category_codes,
    cs.budget_groups,
    ac.account_codes,
    ac.account_names,
    cardinality(cs.category_ids)::integer as category_count,
    cardinality(ac.account_codes)::integer as account_count,
    case
      when cardinality(cs.category_names) = 1 then cs.category_names[1]
      else cs.category_names[1] || ' +' || (cardinality(cs.category_names) - 1)::text || ' más'
    end as bucket_label,
    case
      when cardinality(cs.budget_groups) = 1 then cs.budget_groups[1]
      else 'Control combinado'
    end as bucket_group,
    coalesce(bs.active_budget_total, 0)
  from category_stats cs
  join account_stats ac using (bucket_key)
  left join budget_stats bs using (bucket_key)
  order by cs.bucket_key;
end;
$$;

revoke all on function public.contpaq_budget_bucket_members(uuid)
  from public, anon;
grant execute on function public.contpaq_budget_bucket_members(uuid)
  to authenticated, service_role;
