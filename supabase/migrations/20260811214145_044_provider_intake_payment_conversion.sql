-- Flux Operadora - Migration 044
-- Atomic, idempotent conversion from a ready provider intake into the normal
-- payment_request lifecycle. This migration creates no parallel payment flow.

begin;

do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.payment_intake') is null then
    v_missing := array_append(v_missing, 'public.payment_intake');
  end if;
  if to_regclass('public.payment_intake_conversion_drafts') is null then
    v_missing := array_append(v_missing, 'public.payment_intake_conversion_drafts');
  end if;
  if to_regclass('public.payment_intake_events') is null then
    v_missing := array_append(v_missing, 'public.payment_intake_events');
  end if;
  if to_regclass('public.payment_requests') is null then
    v_missing := array_append(v_missing, 'public.payment_requests');
  end if;
  if to_regprocedure('public.provider_intake_actor_context()') is null then
    v_missing := array_append(v_missing, 'public.provider_intake_actor_context');
  end if;
  if to_regprocedure('public.provider_intake_assert_company_access(uuid)') is null then
    v_missing := array_append(v_missing, 'public.provider_intake_assert_company_access');
  end if;
  if to_regprocedure('public.provider_intake_payment_draft_state(uuid)') is null then
    v_missing := array_append(v_missing, 'public.provider_intake_payment_draft_state');
  end if;
  if to_regprocedure(
    'public.create_payment_request(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid)'
  ) is null then
    v_missing := array_append(v_missing, 'public.create_payment_request');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception '044_precheck: missing required objects: %',
      array_to_string(v_missing, ', ');
  end if;

  if to_regprocedure(
    'public.convert_provider_intake_to_payment_request(uuid,timestamp with time zone,integer,uuid)'
  ) is not null then
    raise exception '044_precheck: conversion RPC already exists';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.payment_intake_events'::regclass
      and c.conname = 'payment_intake_events_event_type_check'
      and pg_get_constraintdef(c.oid) like '%converted%'
  ) then
    raise exception '044_precheck: converted intake event type is unavailable';
  end if;

  if not exists (
    select 1
    from pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = 'payment_intake'
      and i.indexname = 'payment_intake_created_request_uidx'
      and i.indexdef like 'CREATE UNIQUE INDEX%'
  ) then
    raise exception '044_precheck: unique intake-to-request link is unavailable';
  end if;
end
$$;

create function public.convert_provider_intake_to_payment_request(
  p_payment_intake_id uuid,
  p_expected_intake_updated_at timestamptz,
  p_expected_draft_version integer,
  p_action_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb;
  v_actor_profile_id uuid;
  v_actor_type text;
  v_intake public.payment_intake%rowtype;
  v_draft public.payment_intake_conversion_drafts%rowtype;
  v_state jsonb;
  v_create_result jsonb;
  v_payment_request public.payment_requests%rowtype;
  v_payment_request_id uuid;
begin
  if p_payment_intake_id is null then
    raise exception 'provider_intake_conversion_intake_id_required';
  end if;

  v_actor := public.provider_intake_actor_context();
  v_actor_profile_id := (v_actor ->> 'profile_id')::uuid;
  v_actor_type := v_actor ->> 'actor_type';

  -- Lock order is always intake first, draft second. A concurrent conversion
  -- waits here and then observes the winning request link.
  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id
  for update;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  if v_intake.created_payment_request_id is not null then
    select *
      into v_payment_request
    from public.payment_requests
    where id = v_intake.created_payment_request_id;

    if not found then
      raise exception 'provider_intake_conversion_link_invalid';
    end if;

    return jsonb_build_object(
      'payment_intake_id', v_intake.id,
      'payment_request_id', v_payment_request.id,
      'request_number', v_payment_request.request_number,
      'request_status', v_payment_request.status::text,
      'budget_decision', v_payment_request.budget_decision,
      'budget_block_reason', v_payment_request.budget_block_reason,
      'intake_status', v_intake.status,
      'created', false,
      'idempotent', true
    );
  end if;

  if p_expected_intake_updated_at is null
     or p_expected_draft_version is null
     or p_action_id is null then
    raise exception 'provider_intake_conversion_fields_required';
  end if;

  if v_intake.status <> 'in_review' then
    raise exception 'provider_intake_conversion_status_invalid';
  end if;

  if v_intake.updated_at is distinct from p_expected_intake_updated_at then
    raise exception 'provider_intake_conversion_intake_conflict';
  end if;

  select *
    into v_draft
  from public.payment_intake_conversion_drafts
  where payment_intake_id = v_intake.id
  for update;

  if not found then
    raise exception 'provider_intake_conversion_draft_required';
  end if;

  if v_draft.version is distinct from p_expected_draft_version then
    raise exception 'provider_intake_conversion_draft_conflict';
  end if;

  v_state := public.provider_intake_payment_draft_state(v_intake.id);
  if v_state ->> 'derived_state' <> 'READY_FOR_CONVERSION'
     or coalesce((v_state ->> 'missing_count')::integer, 0) <> 0
     or coalesce((v_state ->> 'blockers_count')::integer, 0) <> 0 then
    raise exception 'provider_intake_conversion_not_ready';
  end if;

  if v_intake.matched_proveedor_id is null then
    raise exception 'provider_intake_conversion_provider_required';
  end if;
  if not exists (
    select 1
    from public.proveedores p
    where p.id = v_intake.matched_proveedor_id
      and coalesce(p.activo, true)
  ) then
    raise exception 'provider_intake_conversion_provider_inactive';
  end if;

  if not exists (
    select 1
    from public.company_cost_centers ccc
    join public.cost_centers cc on cc.id = ccc.cost_center_id
    where ccc.company_id = v_intake.company_id
      and ccc.cost_center_id = v_draft.cost_center_id
      and ccc.active
      and coalesce(cc.active, true)
  ) then
    raise exception 'provider_intake_conversion_cost_center_invalid';
  end if;

  if not exists (
    select 1
    from public.company_cost_center_budget_categories link
    join public.budget_categories bc on bc.id = link.budget_category_id
    where link.company_id = v_intake.company_id
      and link.cost_center_id = v_draft.cost_center_id
      and link.budget_category_id = v_draft.budget_category_id
      and link.active
      and coalesce(bc.active, true)
  ) then
    raise exception 'provider_intake_conversion_budget_category_invalid';
  end if;

  if v_draft.budget_month is null
     or date_trunc('month', v_draft.budget_month::timestamptz)::date <> v_draft.budget_month then
    raise exception 'provider_intake_conversion_budget_month_invalid';
  end if;

  if v_draft.payment_method not in ('transfer', 'cash', 'check', 'other') then
    raise exception 'provider_intake_conversion_payment_method_invalid';
  end if;
  if v_draft.payment_method = 'transfer' then
    if v_draft.company_bank_account_id is null or not exists (
      select 1
      from public.company_bank_accounts cba
      where cba.id = v_draft.company_bank_account_id
        and cba.company_id = v_intake.company_id
        and cba.active
        and nullif(btrim(cba.account_number), '') is not null
    ) then
      raise exception 'provider_intake_conversion_origin_account_invalid';
    end if;
  elsif v_draft.company_bank_account_id is not null then
    raise exception 'provider_intake_conversion_origin_account_not_allowed';
  end if;

  if v_draft.requested_by_profile_id is distinct from v_actor_profile_id
     or not exists (
       select 1
       from public.profiles p
       where p.id = v_draft.requested_by_profile_id
         and coalesce(p.active, true)
     ) then
    raise exception 'provider_intake_conversion_requester_invalid';
  end if;
  if not public.has_active_company_membership(
    v_draft.requested_by_profile_id,
    v_intake.company_id
  ) then
    raise exception 'provider_intake_conversion_requester_company_invalid';
  end if;

  if v_draft.approver_profile_id is null
     or not exists (
       select 1
       from public.list_payment_request_approver_options(
         v_intake.company_id,
         v_draft.cost_center_id,
         v_draft.final_amount
       ) option_row
       where option_row.profile_id = v_draft.approver_profile_id
         and option_row.assignment_id is not distinct from v_draft.approver_assignment_id
     ) then
    raise exception 'provider_intake_conversion_approver_invalid';
  end if;

  if v_draft.final_amount is null
     or v_draft.final_amount <= 0
     or v_draft.final_amount > 9999999999999999.99
     or scale(v_draft.final_amount) > 2 then
    raise exception 'provider_intake_conversion_amount_invalid';
  end if;
  if v_draft.currency is null or v_draft.currency !~ '^[A-Z]{3}$' then
    raise exception 'provider_intake_conversion_currency_invalid';
  end if;
  if v_draft.scheduled_payment_date is null then
    raise exception 'provider_intake_conversion_scheduled_date_required';
  end if;
  if v_draft.internal_concept is null
     or length(v_draft.internal_concept) not between 3 and 500
     or v_draft.internal_concept ~ '[[:cntrl:]]'
     or v_draft.internal_concept ~ '<[^>]*>' then
    raise exception 'provider_intake_conversion_concept_invalid';
  end if;
  if v_draft.final_amount is distinct from v_intake.amount_requested
     and (
       v_draft.amount_change_reason is null
       or length(v_draft.amount_change_reason) not between 10 and 1000
     ) then
    raise exception 'provider_intake_conversion_amount_reason_required';
  end if;

  -- Reuse the canonical request creator so budget validation, request numbering,
  -- approver routing and the initial submitted state stay identical to Flux.
  v_create_result := public.create_payment_request(
    p_proveedor_id => v_intake.matched_proveedor_id,
    p_company_id => v_intake.company_id,
    p_cost_center_id => v_draft.cost_center_id,
    p_budget_category_id => v_draft.budget_category_id,
    p_budget_month => v_draft.budget_month,
    p_amount_requested => v_draft.final_amount,
    p_currency => v_draft.currency,
    p_exchange_rate => 1,
    p_description => v_draft.internal_concept,
    p_notes => v_draft.internal_notes,
    p_requested_by => v_draft.requested_by_profile_id,
    p_is_extraordinary_adjustment => false,
    p_approver_id => v_draft.approver_profile_id,
    p_approver_assignment_id => v_draft.approver_assignment_id
  );
  v_payment_request_id := (v_create_result ->> 'payment_request_id')::uuid;

  if v_payment_request_id is null then
    raise exception 'provider_intake_conversion_request_create_failed';
  end if;

  -- These fields are captured by the 2B.1 draft but are not parameters of the
  -- canonical creator. The guarded update remains in this same transaction.
  perform set_config('flux.payment_execution_rpc', v_payment_request_id::text, true);
  update public.payment_requests
     set company_bank_account_id = v_draft.company_bank_account_id,
         payment_method = v_draft.payment_method,
         scheduled_payment_date = v_draft.scheduled_payment_date,
         concept = v_draft.internal_concept,
         description = v_draft.internal_concept,
         notes = v_draft.internal_notes,
         updated_at = now()
   where id = v_payment_request_id
  returning * into v_payment_request;
  perform set_config('flux.payment_execution_rpc', '', true);

  if not found then
    raise exception 'provider_intake_conversion_request_create_failed';
  end if;

  update public.payment_intake
     set status = 'converted',
         created_payment_request_id = v_payment_request.id,
         triaged_by = coalesce(triaged_by, v_actor_profile_id),
         triaged_at = coalesce(triaged_at, now()),
         rejection_reason = null,
         updated_at = now()
   where id = v_intake.id
     and status = 'in_review'
     and created_payment_request_id is null
  returning * into v_intake;

  if not found then
    raise exception 'provider_intake_conversion_link_conflict';
  end if;

  insert into public.payment_intake_events (
    payment_intake_id,
    event_type,
    actor_profile_id,
    actor_type,
    from_status,
    to_status,
    notes,
    metadata
  ) values (
    v_intake.id,
    'converted',
    v_actor_profile_id,
    v_actor_type,
    'in_review',
    'converted',
    null,
    jsonb_build_object(
      'contract_version', 1,
      'action_id', p_action_id,
      'action_kind', 'convert_to_payment_request',
      'payment_request_id', v_payment_request.id,
      'request_number', v_payment_request.request_number,
      'draft_version', v_draft.version,
      'request_status', v_payment_request.status::text,
      'budget_decision', v_payment_request.budget_decision,
      'contains_sensitive_fields', false
    )
  );

  return jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'payment_request_id', v_payment_request.id,
    'request_number', v_payment_request.request_number,
    'request_status', v_payment_request.status::text,
    'budget_decision', v_payment_request.budget_decision,
    'budget_block_reason', v_payment_request.budget_block_reason,
    'intake_status', v_intake.status,
    'created', true,
    'idempotent', false
  );
exception
  when others then
    perform set_config('flux.payment_execution_rpc', '', true);
    raise;
end
$$;

revoke all on function public.convert_provider_intake_to_payment_request(
  uuid, timestamptz, integer, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.convert_provider_intake_to_payment_request(
  uuid, timestamptz, integer, uuid
) to authenticated;

comment on function public.convert_provider_intake_to_payment_request(
  uuid, timestamptz, integer, uuid
) is
  'Atomically converts one ready provider intake into exactly one normal Flux payment request.';

do $$
declare
  v_function regprocedure :=
    'public.convert_provider_intake_to_payment_request(uuid,timestamp with time zone,integer,uuid)'::regprocedure;
begin
  if not (
    select p.prosecdef
    from pg_proc p
    where p.oid = v_function
  ) then
    raise exception '044_postcheck: conversion RPC is not security definer';
  end if;

  if not exists (
    select 1
    from pg_proc p
    where p.oid = v_function
      and p.provolatile = 'v'
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting = 'search_path=public, pg_temp'
      )
  ) then
    raise exception '044_postcheck: conversion RPC path or volatility is invalid';
  end if;

  if has_function_privilege('anon', v_function, 'EXECUTE')
     or has_function_privilege('service_role', v_function, 'EXECUTE')
     or not has_function_privilege('authenticated', v_function, 'EXECUTE')
     or exists (
       select 1
       from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
       where p.oid = v_function
         and privilege.grantee = 0
         and privilege.privilege_type = 'EXECUTE'
     ) then
    raise exception '044_postcheck: conversion RPC grants are invalid';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
      and t.tgenabled <> 'D'
  ) then
    raise exception '044_postcheck: append-only intake event trigger is inactive';
  end if;

  if not exists (
    select 1
    from pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = 'payment_intake'
      and i.indexname = 'payment_intake_created_request_uidx'
      and i.indexdef like 'CREATE UNIQUE INDEX%'
  ) then
    raise exception '044_postcheck: unique intake-to-request link is unavailable';
  end if;
end
$$;

commit;
