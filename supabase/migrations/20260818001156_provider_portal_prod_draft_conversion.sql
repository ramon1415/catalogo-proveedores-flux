-- Provider Portal PROD forward chain T3/4: 2B.1 draft plus 2B.2 exactly-once conversion.
-- Runtime remains disabled; no draft, intake, payment_request, batch, layout, or payment row is created.

begin;

do $$
begin
  if public.provider_intake_runtime_mode() <> 'disabled' then
    raise exception 'provider_portal_prod_precheck: runtime must remain disabled during install';
  end if;
  if to_regclass('public.payment_intake_conversion_drafts') is not null then
    raise exception 'provider_portal_prod_precheck: draft table collision';
  end if;
  if to_regprocedure('public.convert_provider_intake_to_payment_request(uuid,timestamp with time zone,integer,uuid)') is not null then
    raise exception 'provider_portal_prod_precheck: conversion function collision';
  end if;
end
$$;

create table public.payment_intake_conversion_drafts (
  id uuid primary key default gen_random_uuid(),
  payment_intake_id uuid not null
    references public.payment_intake(id) on delete restrict,
  company_id uuid not null
    references public.companies(id) on delete restrict,
  cost_center_id uuid
    references public.cost_centers(id) on delete restrict,
  budget_category_id uuid
    references public.budget_categories(id) on delete restrict,
  budget_month date,
  company_bank_account_id uuid
    references public.company_bank_accounts(id) on delete restrict,
  payment_method text,
  requested_by_profile_id uuid
    references public.profiles(id) on delete restrict,
  approver_profile_id uuid
    references public.profiles(id) on delete restrict,
  approver_assignment_id uuid
    references public.approver_assignments(id) on delete restrict,
  final_amount numeric(18, 2),
  currency text,
  scheduled_payment_date date,
  internal_concept text,
  internal_notes text,
  amount_change_reason text,
  created_by_profile_id uuid not null
    references public.profiles(id) on delete restrict,
  updated_by_profile_id uuid not null
    references public.profiles(id) on delete restrict,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_intake_conversion_drafts_intake_key
    unique (payment_intake_id),
  constraint payment_intake_conversion_drafts_version_check
    check (version >= 1),
  constraint payment_intake_conversion_drafts_budget_month_check
    check (
      budget_month is null
      or date_trunc('month', budget_month::timestamptz)::date = budget_month
    ),
  constraint payment_intake_conversion_drafts_payment_method_check
    check (
      payment_method is null
      or payment_method in ('transfer', 'cash', 'check', 'other')
    ),
  constraint payment_intake_conversion_drafts_amount_check
    check (
      final_amount is null
      or (
        final_amount > 0
        and final_amount <= 9999999999999999.99
        and scale(final_amount) <= 2
      )
    ),
  constraint payment_intake_conversion_drafts_currency_check
    check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint payment_intake_conversion_drafts_profiles_check
    check (
      requested_by_profile_id is null
      or approver_profile_id is null
      or requested_by_profile_id <> approver_profile_id
    ),
  constraint payment_intake_conversion_drafts_concept_check
    check (
      internal_concept is null
      or (
        length(internal_concept) between 3 and 500
        and internal_concept !~ '[[:cntrl:]]'
        and internal_concept !~ '<[^>]*>'
      )
    ),
  constraint payment_intake_conversion_drafts_notes_check
    check (
      internal_notes is null
      or (
        length(internal_notes) <= 2000
        and internal_notes !~ '[[:cntrl:]]'
        and internal_notes !~ '<[^>]*>'
      )
    ),
  constraint payment_intake_conversion_drafts_amount_reason_check
    check (
      amount_change_reason is null
      or (
        length(amount_change_reason) between 10 and 1000
        and amount_change_reason !~ '[[:cntrl:]]'
        and amount_change_reason !~ '<[^>]*>'
      )
    )
);

create index payment_intake_conversion_drafts_company_idx
  on public.payment_intake_conversion_drafts(company_id, updated_at desc);

alter table public.payment_intake_conversion_drafts enable row level security;

revoke all on table public.payment_intake_conversion_drafts
  from public, anon, authenticated, service_role;

alter table public.payment_intake_events
  drop constraint if exists payment_intake_events_event_type_check;

alter table public.payment_intake_events
  add constraint payment_intake_events_event_type_check check (
    event_type in (
      'received',
      'status_changed',
      'file_uploaded',
      'file_reviewed',
      'provider_matched',
      'correction_requested',
      'rejected',
      'converted',
      'internal_note',
      'conversion_draft_created',
      'conversion_draft_updated'
    )
  );

create function public.provider_intake_conversion_draft_fingerprint(
  p_material jsonb
)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(coalesce(p_material, '{}'::jsonb)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

create function public.provider_intake_payment_draft_state(
  p_payment_intake_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_intake public.payment_intake%rowtype;
  v_draft public.payment_intake_conversion_drafts%rowtype;
  v_has_draft boolean := false;
  v_provider_active boolean := false;
  v_missing text[] := array[]::text[];
  v_blockers text[] := array[]::text[];
  v_derived_state text;
begin
  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  select *
    into v_draft
  from public.payment_intake_conversion_drafts
  where payment_intake_id = p_payment_intake_id;
  v_has_draft := found;

  if v_intake.matched_proveedor_id is not null then
    select coalesce(p.activo, true)
      into v_provider_active
    from public.proveedores p
    where p.id = v_intake.matched_proveedor_id;
    v_provider_active := coalesce(v_provider_active, false);
  end if;

  if v_has_draft then
    if v_draft.cost_center_id is null then
      v_missing := array_append(v_missing, 'cost_center_id');
    end if;
    if v_draft.budget_category_id is null then
      v_missing := array_append(v_missing, 'budget_category_id');
    end if;
    if v_draft.budget_month is null then
      v_missing := array_append(v_missing, 'budget_month');
    end if;
    if v_draft.payment_method is null then
      v_missing := array_append(v_missing, 'payment_method');
    end if;
    if v_draft.payment_method = 'transfer'
       and v_draft.company_bank_account_id is null then
      v_missing := array_append(v_missing, 'company_bank_account_id');
    end if;
    if v_draft.requested_by_profile_id is null then
      v_missing := array_append(v_missing, 'requested_by_profile_id');
    end if;
    if v_draft.approver_profile_id is null then
      v_missing := array_append(v_missing, 'approver_profile_id');
    end if;
    if v_draft.final_amount is null then
      v_missing := array_append(v_missing, 'final_amount');
    end if;
    if v_draft.currency is null then
      v_missing := array_append(v_missing, 'currency');
    end if;
    if v_draft.scheduled_payment_date is null then
      v_missing := array_append(v_missing, 'scheduled_payment_date');
    end if;
    if v_draft.internal_concept is null then
      v_missing := array_append(v_missing, 'internal_concept');
    end if;
    if v_draft.final_amount is not null
       and v_draft.final_amount is distinct from v_intake.amount_requested
       and v_draft.amount_change_reason is null then
      v_missing := array_append(v_missing, 'amount_change_reason');
    end if;
  end if;

  if v_intake.created_payment_request_id is not null
     or v_intake.status = 'converted' then
    v_derived_state := 'ALREADY_CONVERTED';
    v_blockers := array_append(v_blockers, 'PAYMENT_REQUEST_ALREADY_CREATED');
  elsif v_intake.status <> 'in_review' then
    v_derived_state := 'BLOCKED_INTAKE_STATUS';
    v_blockers := array_append(v_blockers, 'INTAKE_STATUS_NOT_IN_REVIEW');
  elsif not v_has_draft then
    v_derived_state := 'NOT_STARTED';
  elsif cardinality(v_missing) > 0 then
    v_derived_state := 'DRAFT_INCOMPLETE';
  elsif v_intake.matched_proveedor_id is null then
    v_derived_state := 'READY_PENDING_PROVIDER';
    v_blockers := array_append(v_blockers, 'PROVIDER_REQUIRED_FOR_CONVERSION');
  elsif not v_provider_active then
    v_derived_state := 'READY_PENDING_PROVIDER';
    v_blockers := array_append(v_blockers, 'PROVIDER_INACTIVE');
  else
    v_derived_state := 'READY_FOR_CONVERSION';
  end if;

  return jsonb_build_object(
    'derived_state', v_derived_state,
    'missing_fields', to_jsonb(v_missing),
    'blockers', to_jsonb(v_blockers),
    'missing_count', cardinality(v_missing),
    'blockers_count', cardinality(v_blockers),
    'has_draft', v_has_draft,
    'draft_version', case when v_has_draft then v_draft.version else null end,
    'provider_present', v_intake.matched_proveedor_id is not null,
    'provider_active', v_provider_active,
    'ready_for_conversion', v_derived_state = 'READY_FOR_CONVERSION'
  );
end
$$;

create function public.get_provider_intake_payment_draft_context(
  p_payment_intake_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb;
  v_actor_profile_id uuid;
  v_intake public.payment_intake%rowtype;
  v_draft public.payment_intake_conversion_drafts%rowtype;
  v_has_draft boolean := false;
  v_state jsonb;
  v_requester_options jsonb := '[]'::jsonb;
  v_approver_options jsonb := '[]'::jsonb;
  v_can_prepare boolean;
begin
  if p_payment_intake_id is null then
    raise exception 'provider_intake_id_required';
  end if;

  v_actor := public.provider_intake_actor_context();
  v_actor_profile_id := (v_actor ->> 'profile_id')::uuid;

  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  select *
    into v_draft
  from public.payment_intake_conversion_drafts
  where payment_intake_id = v_intake.id;
  v_has_draft := found;
  v_state := public.provider_intake_payment_draft_state(v_intake.id);
  v_can_prepare := v_intake.status = 'in_review'
    and v_intake.created_payment_request_id is null;

  if public.has_active_company_membership(v_actor_profile_id, v_intake.company_id) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'profile_id', p.id,
      'display_name', coalesce(nullif(btrim(p.full_name), ''), 'Perfil interno'),
      'email', p.email,
      'company_id', v_intake.company_id,
      'functional_roles', coalesce((
        select jsonb_agg(role_name order by role_name)
        from (
          select distinct lower(btrim(r.name)) as role_name
          from public.user_roles ur
          join public.roles r on r.id = ur.role_id
          where ur.profile_id = p.id
        ) roles
      ), '[]'::jsonb)
    )), '[]'::jsonb)
      into v_requester_options
    from public.profiles p
    where p.id = v_actor_profile_id
      and coalesce(p.active, true);
  end if;

  if v_has_draft
     and v_draft.requested_by_profile_id = v_actor_profile_id then
    select coalesce(jsonb_agg(jsonb_build_object(
      'profile_id', option_row.profile_id,
      'display_name', option_row.display_name,
      'email', option_row.email,
      'eligible_roles', to_jsonb(option_row.eligible_roles),
      'source', option_row.source,
      'assignment_id', option_row.assignment_id,
      'option_label', option_row.option_label
    ) order by option_row.option_label), '[]'::jsonb)
      into v_approver_options
    from public.list_payment_request_approver_options(
      v_intake.company_id,
      v_draft.cost_center_id,
      v_draft.final_amount
    ) option_row;
  end if;

  return jsonb_build_object(
    'intake', jsonb_build_object(
      'id', v_intake.id,
      'public_folio', v_intake.public_folio,
      'company_id', v_intake.company_id,
      'company_name', (
        select coalesce(nullif(btrim(c.legal_name), ''), c.name)
        from public.companies c
        where c.id = v_intake.company_id
      ),
      'status', v_intake.status,
      'updated_at', v_intake.updated_at,
      'provider_name', v_intake.provider_name,
      'concept', v_intake.concept,
      'description', v_intake.description,
      'amount_requested', v_intake.amount_requested,
      'currency', v_intake.currency,
      'requested_payment_date', v_intake.requested_payment_date,
      'invoice', jsonb_build_object(
        'folio', v_intake.invoice_folio,
        'uuid', v_intake.invoice_uuid,
        'date', v_intake.invoice_date
      ),
      'bank', jsonb_build_object(
        'name', v_intake.bank_name,
        'beneficiary', v_intake.beneficiary_name,
        'account_masked', public.provider_intake_mask_value(v_intake.bank_account),
        'clabe_masked', public.provider_intake_mask_value(v_intake.bank_clabe)
      ),
      'created_payment_request_id', v_intake.created_payment_request_id
    ),
    'provider', (
      select case when p.id is null then null else jsonb_build_object(
        'proveedor_id', p.id,
        'display_name', coalesce(nullif(btrim(p.alias), ''), p.nombre_completo),
        'active', coalesce(p.activo, true),
        'bank', p.banco,
        'account_masked', public.provider_intake_mask_value(p.cuenta_bancaria),
        'clabe_masked', public.provider_intake_mask_value(p.clabe)
      ) end
      from (select 1) seed
      left join public.proveedores p on p.id = v_intake.matched_proveedor_id
    ),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pif.id,
        'name', pif.original_filename,
        'mime_type', pif.mime_type,
        'size_bytes', pif.size_bytes,
        'file_kind', pif.file_kind,
        'quarantine_status', pif.quarantine_status
      ) order by pif.created_at, pif.id)
      from public.payment_intake_files pif
      where pif.payment_intake_id = v_intake.id
    ), '[]'::jsonb),
    'draft', case when not v_has_draft then null else jsonb_build_object(
      'id', v_draft.id,
      'payment_intake_id', v_draft.payment_intake_id,
      'company_id', v_draft.company_id,
      'cost_center_id', v_draft.cost_center_id,
      'budget_category_id', v_draft.budget_category_id,
      'budget_month', v_draft.budget_month,
      'company_bank_account_id', v_draft.company_bank_account_id,
      'payment_method', v_draft.payment_method,
      'requested_by_profile_id', v_draft.requested_by_profile_id,
      'approver_profile_id', v_draft.approver_profile_id,
      'approver_assignment_id', v_draft.approver_assignment_id,
      'final_amount', v_draft.final_amount,
      'currency', v_draft.currency,
      'scheduled_payment_date', v_draft.scheduled_payment_date,
      'internal_concept', v_draft.internal_concept,
      'internal_notes', v_draft.internal_notes,
      'amount_change_reason', v_draft.amount_change_reason,
      'version', v_draft.version,
      'created_at', v_draft.created_at,
      'updated_at', v_draft.updated_at
    ) end,
    'defaults', jsonb_build_object(
      'final_amount', v_intake.amount_requested,
      'currency', v_intake.currency,
      'scheduled_payment_date', v_intake.requested_payment_date,
      'internal_concept', v_intake.concept,
      'requested_by_profile_id', case
        when jsonb_array_length(v_requester_options) = 1
          then v_requester_options -> 0 ->> 'profile_id'
        else null
      end
    ),
    'state', v_state,
    'requester_options', v_requester_options,
    'approver_options', v_approver_options,
    'catalogs', jsonb_build_object(
      'cost_centers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', cc.id,
          'name', cc.name,
          'code', cc.code
        ) order by cc.name, cc.id)
        from public.company_cost_centers ccc
        join public.cost_centers cc on cc.id = ccc.cost_center_id
        where ccc.company_id = v_intake.company_id
          and ccc.active
          and coalesce(cc.active, true)
      ), '[]'::jsonb),
      'budget_categories', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', bc.id,
          'cost_center_id', link.cost_center_id,
          'name', bc.name,
          'code', bc.code
        ) order by bc.name, bc.id)
        from public.company_cost_center_budget_categories link
        join public.budget_categories bc on bc.id = link.budget_category_id
        where link.company_id = v_intake.company_id
          and link.active
          and coalesce(bc.active, true)
      ), '[]'::jsonb),
      'origin_accounts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', cba.id,
          'name', cba.name,
          'bank_name', cba.bank_name,
          'currency', cba.currency,
          'last4', cba.last4
        ) order by cba.name, cba.id)
        from public.company_bank_accounts cba
        where cba.company_id = v_intake.company_id
          and cba.active
      ), '[]'::jsonb),
      'payment_methods', jsonb_build_array('transfer', 'cash', 'check', 'other'),
      'currencies', (
        select jsonb_agg(currency_code order by currency_code)
        from (
          select 'MXN'::text as currency_code
          union
          select 'USD'::text
          union
          select v_intake.currency
        ) currencies
      )
    ),
    'can_view', true,
    'can_prepare', v_can_prepare,
    'can_save', v_can_prepare
      and jsonb_array_length(v_requester_options) > 0,
    'ready_for_conversion', coalesce((v_state ->> 'ready_for_conversion')::boolean, false)
  );
end
$$;

create function public.save_provider_intake_payment_draft(
  p_payment_intake_id uuid,
  p_expected_intake_status text,
  p_expected_intake_updated_at timestamptz,
  p_expected_draft_version integer,
  p_cost_center_id uuid,
  p_budget_category_id uuid,
  p_budget_month date,
  p_company_bank_account_id uuid,
  p_payment_method text,
  p_requested_by_profile_id uuid,
  p_approver_profile_id uuid,
  p_approver_assignment_id uuid,
  p_final_amount numeric,
  p_currency text,
  p_scheduled_payment_date date,
  p_internal_concept text,
  p_internal_notes text,
  p_amount_change_reason text,
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
  v_existing public.payment_intake_conversion_drafts%rowtype;
  v_saved public.payment_intake_conversion_drafts%rowtype;
  v_has_existing boolean := false;
  v_payment_method text := nullif(lower(btrim(coalesce(p_payment_method, ''))), '');
  v_currency text := nullif(upper(btrim(coalesce(p_currency, ''))), '');
  v_internal_concept text := nullif(btrim(coalesce(p_internal_concept, '')), '');
  v_internal_notes text := nullif(btrim(coalesce(p_internal_notes, '')), '');
  v_amount_change_reason text := nullif(btrim(coalesce(p_amount_change_reason, '')), '');
  v_action_fingerprint text;
  v_existing_event record;
  v_changed_fields text[] := array[]::text[];
  v_material_changed boolean := true;
  v_state jsonb;
  v_next_version integer;
  v_event_type text;
  v_has_approver_pool boolean := false;
begin
  if p_payment_intake_id is null
     or p_expected_intake_status is null
     or p_expected_intake_updated_at is null
     or p_action_id is null then
    raise exception 'provider_intake_conversion_draft_fields_required';
  end if;

  v_actor := public.provider_intake_actor_context();
  v_actor_profile_id := (v_actor ->> 'profile_id')::uuid;
  v_actor_type := v_actor ->> 'actor_type';

  v_action_fingerprint := public.provider_intake_conversion_draft_fingerprint(
    jsonb_build_object(
      'contract_version', 1,
      'operation', 'save_conversion_draft',
      'payment_intake_id', p_payment_intake_id,
      'actor_profile_id', v_actor_profile_id,
      'expected_intake_status', p_expected_intake_status,
      'expected_intake_updated_at', pg_catalog.to_char(
        p_expected_intake_updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'expected_draft_version', p_expected_draft_version,
      'cost_center_id', p_cost_center_id,
      'budget_category_id', p_budget_category_id,
      'budget_month', p_budget_month,
      'company_bank_account_id', p_company_bank_account_id,
      'payment_method', v_payment_method,
      'requested_by_profile_id', p_requested_by_profile_id,
      'approver_profile_id', p_approver_profile_id,
      'approver_assignment_id', p_approver_assignment_id,
      'final_amount', p_final_amount,
      'currency', v_currency,
      'scheduled_payment_date', p_scheduled_payment_date,
      'internal_concept', v_internal_concept,
      'internal_notes', v_internal_notes,
      'amount_change_reason', v_amount_change_reason
    )
  );

  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id
  for update;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  select
    pie.actor_profile_id,
    pie.metadata ->> 'action_fingerprint' as action_fingerprint,
    pie.metadata ->> 'action_kind' as action_kind,
    pie.metadata ->> 'contract_version' as contract_version
    into v_existing_event
  from public.payment_intake_events pie
  where pie.payment_intake_id = p_payment_intake_id
    and pie.metadata ->> 'action_id' = p_action_id::text
  limit 1;

  if found then
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_conversion_draft_action_actor_conflict';
    end if;
    if v_existing_event.action_kind is distinct from 'save_conversion_draft'
       or v_existing_event.contract_version is distinct from '1'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_conversion_draft_action_material_conflict';
    end if;

    v_state := public.provider_intake_payment_draft_state(p_payment_intake_id);
    return jsonb_build_object(
      'payment_intake_id', p_payment_intake_id,
      'draft_version', v_state -> 'draft_version',
      'state', v_state,
      'idempotent', true,
      'unchanged', false
    );
  end if;

  if v_intake.status <> 'in_review'
     or p_expected_intake_status <> 'in_review'
     or v_intake.status is distinct from p_expected_intake_status then
    raise exception 'provider_intake_conversion_draft_status_invalid';
  end if;
  if v_intake.created_payment_request_id is not null then
    raise exception 'provider_intake_conversion_draft_already_converted';
  end if;
  if v_intake.updated_at is distinct from p_expected_intake_updated_at then
    raise exception 'provider_intake_conversion_draft_intake_conflict';
  end if;

  select *
    into v_existing
  from public.payment_intake_conversion_drafts
  where payment_intake_id = p_payment_intake_id
  for update;
  v_has_existing := found;

  if v_has_existing then
    if p_expected_draft_version is null
       or v_existing.version is distinct from p_expected_draft_version then
      raise exception 'provider_intake_conversion_draft_conflict';
    end if;
  elsif p_expected_draft_version is not null then
    raise exception 'provider_intake_conversion_draft_conflict';
  end if;

  if p_cost_center_id is not null and not exists (
    select 1
    from public.company_cost_centers ccc
    join public.cost_centers cc on cc.id = ccc.cost_center_id
    where ccc.company_id = v_intake.company_id
      and ccc.cost_center_id = p_cost_center_id
      and ccc.active
      and coalesce(cc.active, true)
  ) then
    raise exception 'provider_intake_conversion_draft_cost_center_invalid';
  end if;

  if p_budget_category_id is not null and (
    p_cost_center_id is null
    or not exists (
      select 1
      from public.company_cost_center_budget_categories link
      join public.budget_categories bc on bc.id = link.budget_category_id
      where link.company_id = v_intake.company_id
        and link.cost_center_id = p_cost_center_id
        and link.budget_category_id = p_budget_category_id
        and link.active
        and coalesce(bc.active, true)
    )
  ) then
    raise exception 'provider_intake_conversion_draft_budget_category_invalid';
  end if;

  if p_budget_month is not null
     and date_trunc('month', p_budget_month::timestamptz)::date <> p_budget_month then
    raise exception 'provider_intake_conversion_draft_budget_month_invalid';
  end if;

  if p_company_bank_account_id is not null and not exists (
    select 1
    from public.company_bank_accounts cba
    where cba.id = p_company_bank_account_id
      and cba.company_id = v_intake.company_id
      and cba.active
  ) then
    raise exception 'provider_intake_conversion_draft_origin_account_invalid';
  end if;

  if v_payment_method is not null
     and v_payment_method not in ('transfer', 'cash', 'check', 'other') then
    raise exception 'provider_intake_conversion_draft_payment_method_invalid';
  end if;
  if v_payment_method <> 'transfer' and p_company_bank_account_id is not null then
    raise exception 'provider_intake_conversion_draft_origin_account_not_allowed';
  end if;

  if p_requested_by_profile_id is not null then
    if p_requested_by_profile_id <> v_actor_profile_id then
      raise exception 'provider_intake_conversion_draft_requester_invalid';
    end if;
    if not public.has_active_company_membership(
      p_requested_by_profile_id,
      v_intake.company_id
    ) then
      raise exception 'provider_intake_conversion_draft_requester_company_invalid';
    end if;
  end if;

  if p_final_amount is not null then
    if p_final_amount <= 0
       or p_final_amount > 9999999999999999.99
       or scale(p_final_amount) > 2 then
      raise exception 'provider_intake_conversion_draft_amount_invalid';
    end if;
  end if;
  if v_currency is not null and v_currency !~ '^[A-Z]{3}$' then
    raise exception 'provider_intake_conversion_draft_currency_invalid';
  end if;

  if v_internal_concept is not null and (
    length(v_internal_concept) not between 3 and 500
    or v_internal_concept ~ '[[:cntrl:]]'
    or v_internal_concept ~ '<[^>]*>'
  ) then
    raise exception 'provider_intake_conversion_draft_concept_invalid';
  end if;
  if v_internal_notes is not null and (
    length(v_internal_notes) > 2000
    or v_internal_notes ~ '[[:cntrl:]]'
    or v_internal_notes ~ '<[^>]*>'
  ) then
    raise exception 'provider_intake_conversion_draft_notes_invalid';
  end if;
  if v_amount_change_reason is not null and (
    length(v_amount_change_reason) not between 10 and 1000
    or v_amount_change_reason ~ '[[:cntrl:]]'
    or v_amount_change_reason ~ '<[^>]*>'
  ) then
    raise exception 'provider_intake_conversion_draft_amount_reason_invalid';
  end if;
  if p_final_amount is not null
     and p_final_amount is distinct from v_intake.amount_requested
     and v_amount_change_reason is null then
    raise exception 'provider_intake_conversion_draft_amount_reason_required';
  end if;
  if p_final_amount is null
     or p_final_amount is not distinct from v_intake.amount_requested then
    v_amount_change_reason := null;
  end if;

  if p_approver_profile_id is null and p_approver_assignment_id is not null then
    raise exception 'provider_intake_conversion_draft_approver_invalid';
  end if;
  if p_approver_profile_id is not null then
    if p_requested_by_profile_id is null
       or p_approver_profile_id = p_requested_by_profile_id
       or not public.is_payment_request_approver_for_company(
         p_approver_profile_id,
         v_intake.company_id
       ) then
      raise exception 'provider_intake_conversion_draft_approver_invalid';
    end if;

    v_has_approver_pool := public.payment_request_has_active_approver_pool(
      p_requested_by_profile_id,
      v_intake.company_id
    );
    if v_has_approver_pool then
      if p_approver_assignment_id is null or not exists (
        select 1
        from public.approver_assignments aa
        where aa.id = p_approver_assignment_id
          and aa.company_id = v_intake.company_id
          and aa.requester_id = p_requested_by_profile_id
          and aa.approver_id = p_approver_profile_id
          and aa.active
      ) then
        raise exception 'provider_intake_conversion_draft_approver_invalid';
      end if;
    else
      if p_approver_assignment_id is not null
         or p_cost_center_id is null
         or p_final_amount is null
         or not public.payment_request_rule_allows(
           p_approver_profile_id,
           v_intake.company_id,
           p_cost_center_id,
           p_final_amount,
           'approved'
         ) then
        raise exception 'provider_intake_conversion_draft_approver_invalid';
      end if;
    end if;
  end if;

  if v_has_existing then
    v_material_changed :=
      v_existing.cost_center_id is distinct from p_cost_center_id
      or v_existing.budget_category_id is distinct from p_budget_category_id
      or v_existing.budget_month is distinct from p_budget_month
      or v_existing.company_bank_account_id is distinct from p_company_bank_account_id
      or v_existing.payment_method is distinct from v_payment_method
      or v_existing.requested_by_profile_id is distinct from p_requested_by_profile_id
      or v_existing.approver_profile_id is distinct from p_approver_profile_id
      or v_existing.approver_assignment_id is distinct from p_approver_assignment_id
      or v_existing.final_amount is distinct from p_final_amount
      or v_existing.currency is distinct from v_currency
      or v_existing.scheduled_payment_date is distinct from p_scheduled_payment_date
      or v_existing.internal_concept is distinct from v_internal_concept
      or v_existing.internal_notes is distinct from v_internal_notes
      or v_existing.amount_change_reason is distinct from v_amount_change_reason;

    if not v_material_changed then
      v_state := public.provider_intake_payment_draft_state(p_payment_intake_id);
      return jsonb_build_object(
        'payment_intake_id', p_payment_intake_id,
        'draft_version', v_existing.version,
        'state', v_state,
        'idempotent', true,
        'unchanged', true
      );
    end if;
  end if;

  if not v_has_existing or v_existing.cost_center_id is distinct from p_cost_center_id then
    v_changed_fields := array_append(v_changed_fields, 'cost_center_id');
  end if;
  if not v_has_existing or v_existing.budget_category_id is distinct from p_budget_category_id then
    v_changed_fields := array_append(v_changed_fields, 'budget_category_id');
  end if;
  if not v_has_existing or v_existing.budget_month is distinct from p_budget_month then
    v_changed_fields := array_append(v_changed_fields, 'budget_month');
  end if;
  if not v_has_existing or v_existing.company_bank_account_id is distinct from p_company_bank_account_id then
    v_changed_fields := array_append(v_changed_fields, 'company_bank_account_id');
  end if;
  if not v_has_existing or v_existing.payment_method is distinct from v_payment_method then
    v_changed_fields := array_append(v_changed_fields, 'payment_method');
  end if;
  if not v_has_existing or v_existing.requested_by_profile_id is distinct from p_requested_by_profile_id then
    v_changed_fields := array_append(v_changed_fields, 'requested_by_profile_id');
  end if;
  if not v_has_existing or v_existing.approver_profile_id is distinct from p_approver_profile_id then
    v_changed_fields := array_append(v_changed_fields, 'approver_profile_id');
  end if;
  if not v_has_existing or v_existing.approver_assignment_id is distinct from p_approver_assignment_id then
    v_changed_fields := array_append(v_changed_fields, 'approver_assignment_id');
  end if;
  if not v_has_existing or v_existing.final_amount is distinct from p_final_amount then
    v_changed_fields := array_append(v_changed_fields, 'final_amount');
  end if;
  if not v_has_existing or v_existing.currency is distinct from v_currency then
    v_changed_fields := array_append(v_changed_fields, 'currency');
  end if;
  if not v_has_existing or v_existing.scheduled_payment_date is distinct from p_scheduled_payment_date then
    v_changed_fields := array_append(v_changed_fields, 'scheduled_payment_date');
  end if;
  if not v_has_existing or v_existing.internal_concept is distinct from v_internal_concept then
    v_changed_fields := array_append(v_changed_fields, 'internal_concept');
  end if;
  if not v_has_existing or v_existing.internal_notes is distinct from v_internal_notes then
    v_changed_fields := array_append(v_changed_fields, 'internal_notes');
  end if;
  if not v_has_existing or v_existing.amount_change_reason is distinct from v_amount_change_reason then
    v_changed_fields := array_append(v_changed_fields, 'amount_change_reason');
  end if;

  if v_has_existing then
    v_next_version := v_existing.version + 1;
    update public.payment_intake_conversion_drafts
       set cost_center_id = p_cost_center_id,
           budget_category_id = p_budget_category_id,
           budget_month = p_budget_month,
           company_bank_account_id = p_company_bank_account_id,
           payment_method = v_payment_method,
           requested_by_profile_id = p_requested_by_profile_id,
           approver_profile_id = p_approver_profile_id,
           approver_assignment_id = p_approver_assignment_id,
           final_amount = p_final_amount,
           currency = v_currency,
           scheduled_payment_date = p_scheduled_payment_date,
           internal_concept = v_internal_concept,
           internal_notes = v_internal_notes,
           amount_change_reason = v_amount_change_reason,
           updated_by_profile_id = v_actor_profile_id,
           version = v_next_version,
           updated_at = now()
     where id = v_existing.id
       and version = p_expected_draft_version
    returning * into v_saved;

    if not found then
      raise exception 'provider_intake_conversion_draft_conflict';
    end if;
    v_event_type := 'conversion_draft_updated';
  else
    v_next_version := 1;
    insert into public.payment_intake_conversion_drafts (
      payment_intake_id,
      company_id,
      cost_center_id,
      budget_category_id,
      budget_month,
      company_bank_account_id,
      payment_method,
      requested_by_profile_id,
      approver_profile_id,
      approver_assignment_id,
      final_amount,
      currency,
      scheduled_payment_date,
      internal_concept,
      internal_notes,
      amount_change_reason,
      created_by_profile_id,
      updated_by_profile_id,
      version
    ) values (
      v_intake.id,
      v_intake.company_id,
      p_cost_center_id,
      p_budget_category_id,
      p_budget_month,
      p_company_bank_account_id,
      v_payment_method,
      p_requested_by_profile_id,
      p_approver_profile_id,
      p_approver_assignment_id,
      p_final_amount,
      v_currency,
      p_scheduled_payment_date,
      v_internal_concept,
      v_internal_notes,
      v_amount_change_reason,
      v_actor_profile_id,
      v_actor_profile_id,
      v_next_version
    )
    returning * into v_saved;
    v_event_type := 'conversion_draft_created';
  end if;

  v_state := public.provider_intake_payment_draft_state(v_intake.id);

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
    v_event_type,
    v_actor_profile_id,
    v_actor_type,
    v_intake.status,
    v_intake.status,
    null,
    jsonb_build_object(
      'contract_version', 1,
      'action_id', p_action_id,
      'action_fingerprint', v_action_fingerprint,
      'action_kind', 'save_conversion_draft',
      'draft_version', v_saved.version,
      'derived_state', v_state ->> 'derived_state',
      'changed_fields', to_jsonb(v_changed_fields),
      'blockers_count', (v_state ->> 'blockers_count')::integer,
      'amount_changed', v_saved.final_amount is distinct from v_intake.amount_requested,
      'requester_selected', v_saved.requested_by_profile_id is not null,
      'approver_selected', v_saved.approver_profile_id is not null,
      'provider_present', v_intake.matched_proveedor_id is not null,
      'contains_sensitive_fields', false
    )
  );

  return jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'draft_version', v_saved.version,
    'state', v_state,
    'idempotent', false,
    'unchanged', false
  );
exception
  when unique_violation then
    select
      pie.actor_profile_id,
      pie.metadata ->> 'action_fingerprint' as action_fingerprint,
      pie.metadata ->> 'action_kind' as action_kind,
      pie.metadata ->> 'contract_version' as contract_version
      into v_existing_event
    from public.payment_intake_events pie
    where pie.payment_intake_id = p_payment_intake_id
      and pie.metadata ->> 'action_id' = p_action_id::text
    limit 1;

    if not found then
      raise;
    end if;
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_conversion_draft_action_actor_conflict';
    end if;
    if v_existing_event.action_kind is distinct from 'save_conversion_draft'
       or v_existing_event.contract_version is distinct from '1'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_conversion_draft_action_material_conflict';
    end if;

    v_state := public.provider_intake_payment_draft_state(p_payment_intake_id);
    return jsonb_build_object(
      'payment_intake_id', p_payment_intake_id,
      'draft_version', v_state -> 'draft_version',
      'state', v_state,
      'idempotent', true,
      'unchanged', false
    );
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

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(array[
      'provider_intake_conversion_draft_fingerprint','provider_intake_payment_draft_state',
      'get_provider_intake_payment_draft_context','save_provider_intake_payment_draft',
      'convert_provider_intake_to_payment_request'
    ]::text[])
  loop execute format('revoke all on function %s from public, anon, authenticated, service_role', r.signature); end loop;
end
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(array[
      'get_provider_intake_payment_draft_context','save_provider_intake_payment_draft','convert_provider_intake_to_payment_request'
    ]::text[])
  loop execute format('grant execute on function %s to authenticated', r.signature); end loop;
end
$$;

commit;
