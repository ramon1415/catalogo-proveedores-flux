-- Allow Direction to reject every request in a batch while preserving each item for correction and resubmission.

begin;

do $$
begin
  if to_regclass('public.approval_batches') is null
     or to_regclass('public.approval_batch_items') is null
     or to_regprocedure('public.approval_batch_require_actor()') is null
     or to_regprocedure('public.validate_approval_batch_final_status()') is null
     or to_regprocedure('public.decide_approval_batch_items(uuid,jsonb)') is null then
    raise exception '024_precheck: migration 023 is not installed completely';
  end if;
end
$$;

create or replace function public.validate_approval_batch_final_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pending integer;
  v_approved integer;
  v_rejected integer;
begin
  if new.status not in ('approved', 'partially_approved', 'closed') then
    return new;
  end if;

  select count(*) filter (where director_status = 'pending'),
         count(*) filter (where director_status = 'approved'),
         count(*) filter (where director_status = 'rejected')
    into v_pending, v_approved, v_rejected
  from public.approval_batch_items
  where batch_id = new.id
    and removed_at is null;

  if v_pending > 0 or (v_approved = 0 and v_rejected = 0) then
    raise exception 'invalid_batch_final_item_mix';
  end if;
  if new.status = 'approved' and (v_approved = 0 or v_rejected > 0) then
    raise exception 'approved_batch_requires_only_approved_items';
  end if;
  if new.status = 'partially_approved' and v_rejected = 0 then
    raise exception 'partial_batch_requires_rejected_items';
  end if;
  if new.status = 'closed' and v_approved = 0 then
    raise exception 'batch_requires_at_least_one_approved_item';
  end if;
  return new;
end
$$;

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
  v_actor := public.approval_batch_require_actor();
  select * into v_batch
  from public.approval_batches
  where id = p_batch_id
  for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.director_id <> v_actor then raise exception 'batch_director_required'; end if;
  if v_batch.status <> 'submitted' then raise exception 'batch_must_be_submitted'; end if;
  if jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then
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

  for v_decision in select value from jsonb_array_elements(p_decisions) loop
    v_item_id := nullif(v_decision ->> 'item_id', '')::uuid;
    v_status := lower(btrim(coalesce(v_decision ->> 'status', '')));
    v_reason := nullif(btrim(coalesce(v_decision ->> 'reject_reason', '')), '');
    if v_status not in ('approved', 'rejected') then
      raise exception 'invalid_item_decision';
    end if;
    if v_status = 'rejected' and v_reason is null then
      raise exception 'reject_reason_required';
    end if;

    update public.approval_batch_items
    set director_status = v_status,
        director_reject_reason = case when v_status = 'rejected' then v_reason else null end,
        rebatch_status = case when v_status = 'rejected' then 'blocked' else 'not_applicable' end,
        rebatch_released_by = null,
        rebatch_released_at = null,
        rebatch_release_note = null,
        decided_by = v_actor,
        decided_at = now()
    where id = v_item_id
      and batch_id = p_batch_id
      and removed_at is null
      and director_status = 'pending';
    if not found then raise exception 'pending_batch_item_not_found:%', v_item_id; end if;
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
    v_final_status := case when v_rejected > 0 then 'partially_approved' else 'approved' end;
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

do $$
declare
  v_decide_source text;
  v_validate_source text;
begin
  select p.prosrc into v_decide_source
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid = 'public.decide_approval_batch_items(uuid,jsonb)'::regprocedure;

  select p.prosrc into v_validate_source
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid = 'public.validate_approval_batch_final_status()'::regprocedure;

  if v_decide_source ~* 'if\s+v_approved\s*=\s*0\s+then'
     or v_validate_source ~* 'v_pending\s*>\s*0\s+or\s+v_approved\s*=\s*0' then
    raise exception '024_postcheck: fully rejected batches remain blocked';
  end if;
  if v_decide_source !~* 'v_final_status\s*:=\s*case\s+when\s+v_rejected\s*>\s*0\s+then\s+''partially_approved''\s+else\s+''approved''\s+end'
     or v_validate_source !~* 'new\.status\s*=\s*''partially_approved''\s+and\s+v_rejected\s*=\s*0' then
    raise exception '024_postcheck: expected final status guards are missing';
  end if;
  if not has_function_privilege('authenticated', 'public.decide_approval_batch_items(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.decide_approval_batch_items(uuid,jsonb)', 'EXECUTE') then
    raise exception '024_postcheck: unexpected RPC grants';
  end if;
end
$$;

commit;
