begin;

-- Provider intake product improvements discovered during Ramón's manual DEV UAT.
-- Scope: authenticated link governance and material provider-bank review only.

do $$
begin
  if to_regclass('public.intake_links') is null
     or to_regclass('public.payment_intake') is null
     or to_regclass('public.payment_intake_events') is null
     or to_regclass('public.payment_intake_conversion_drafts') is null then
    raise exception '045_precheck: provider intake dependencies are unavailable';
  end if;

  if to_regprocedure('public.provider_intake_payment_draft_state(uuid)') is null
     or to_regprocedure('public.get_provider_intake_payment_draft_context(uuid)') is null
     or to_regprocedure('public.convert_provider_intake_to_payment_request(uuid,timestamp with time zone,integer,uuid)') is null then
    raise exception '045_precheck: provider intake draft/conversion contract is unavailable';
  end if;

  if to_regprocedure('public.get_provider_intake_link_management_context()') is not null
     or to_regprocedure('public.confirm_provider_intake_master_banking(uuid,timestamp with time zone,timestamp with time zone,uuid)') is not null then
    raise exception '045_precheck: product improvement RPCs already exist';
  end if;
end
$$;

alter table public.payment_intake_events
  drop constraint payment_intake_events_event_type_check;

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
      'conversion_draft_updated',
      'banking_resolution'
    )
  ) not valid;

alter table public.payment_intake_events
  validate constraint payment_intake_events_event_type_check;

create function public.provider_intake_mask_text(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when nullif(btrim(p_value), '') is null then null
    when char_length(btrim(p_value)) <= 2 then repeat('•', char_length(btrim(p_value)))
    when char_length(btrim(p_value)) <= 5 then
      left(btrim(p_value), 1) || repeat('•', char_length(btrim(p_value)) - 2) || right(btrim(p_value), 1)
    else
      left(btrim(p_value), 2) || repeat('•', least(10, char_length(btrim(p_value)) - 4)) || right(btrim(p_value), 2)
  end;
$$;

create function public.provider_intake_banking_difference_state(
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
  v_provider public.proveedores%rowtype;
  v_fields text[] := array[]::text[];
  v_resolution public.payment_intake_events%rowtype;
  v_resolution_valid boolean := false;
  v_provider_updated_at timestamptz;
begin
  select * into v_intake
  from public.payment_intake
  where id = p_payment_intake_id;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  if v_intake.matched_proveedor_id is null then
    return jsonb_build_object(
      'material_mismatch', false,
      'difference_fields', '[]'::jsonb,
      'resolution_valid', false,
      'resolution', null,
      'provider_updated_at', null,
      'comparison', '[]'::jsonb
    );
  end if;

  select * into v_provider
  from public.proveedores
  where id = v_intake.matched_proveedor_id;

  if not found then
    return jsonb_build_object(
      'material_mismatch', false,
      'difference_fields', '[]'::jsonb,
      'resolution_valid', false,
      'resolution', null,
      'provider_updated_at', null,
      'comparison', '[]'::jsonb
    );
  end if;

  v_provider_updated_at := coalesce(v_provider.updated_at, v_provider.created_at);

  if public.normalize_provider_match_text(v_intake.bank_name)
       is distinct from public.normalize_provider_match_text(v_provider.banco)
     and (nullif(btrim(v_intake.bank_name), '') is not null
          or nullif(btrim(v_provider.banco), '') is not null) then
    v_fields := array_append(v_fields, 'bank');
  end if;
  if public.normalize_provider_match_digits(v_intake.bank_account)
       is distinct from public.normalize_provider_match_digits(v_provider.cuenta_bancaria)
     and (nullif(btrim(v_intake.bank_account), '') is not null
          or nullif(btrim(v_provider.cuenta_bancaria), '') is not null) then
    v_fields := array_append(v_fields, 'account');
  end if;
  if public.normalize_provider_match_digits(v_intake.bank_clabe)
       is distinct from public.normalize_provider_match_digits(v_provider.clabe)
     and (nullif(btrim(v_intake.bank_clabe), '') is not null
          or nullif(btrim(v_provider.clabe), '') is not null) then
    v_fields := array_append(v_fields, 'clabe');
  end if;
  if public.normalize_provider_match_text(v_intake.beneficiary_name)
       is distinct from public.normalize_provider_match_text(v_provider.beneficiary_name)
     and (nullif(btrim(v_intake.beneficiary_name), '') is not null
          or nullif(btrim(v_provider.beneficiary_name), '') is not null) then
    v_fields := array_append(v_fields, 'beneficiary');
  end if;

  select event.* into v_resolution
  from public.payment_intake_events event
  where event.payment_intake_id = v_intake.id
    and event.event_type = 'banking_resolution'
    and event.metadata ->> 'decision' = 'use_current_master_data'
    and event.metadata ->> 'proveedor_id' = v_provider.id::text
  order by event.created_at desc, event.id desc
  limit 1;

  if found then
    begin
      v_resolution_valid :=
        (v_resolution.metadata ->> 'intake_updated_at')::timestamptz = v_intake.updated_at
        and (v_resolution.metadata ->> 'provider_updated_at')::timestamptz
              is not distinct from v_provider_updated_at;
    exception when others then
      v_resolution_valid := false;
    end;
  end if;

  return jsonb_build_object(
    'material_mismatch', cardinality(v_fields) > 0,
    'difference_fields', to_jsonb(v_fields),
    'resolution_valid', cardinality(v_fields) > 0 and v_resolution_valid,
    'resolution', case when not v_resolution_valid then null else jsonb_build_object(
      'decision', 'use_current_master_data',
      'actor_profile_id', v_resolution.actor_profile_id,
      'actor_type', v_resolution.actor_type,
      'created_at', v_resolution.created_at
    ) end,
    'provider_updated_at', v_provider_updated_at,
    'comparison', jsonb_build_array(
      jsonb_build_object(
        'field', 'Banco',
        'code', 'bank',
        'declared', public.provider_intake_mask_text(v_intake.bank_name),
        'master', public.provider_intake_mask_text(v_provider.banco),
        'different', 'bank' = any(v_fields)
      ),
      jsonb_build_object(
        'field', 'Cuenta',
        'code', 'account',
        'declared', public.provider_intake_mask_value(v_intake.bank_account),
        'master', public.provider_intake_mask_value(v_provider.cuenta_bancaria),
        'different', 'account' = any(v_fields)
      ),
      jsonb_build_object(
        'field', 'CLABE',
        'code', 'clabe',
        'declared', public.provider_intake_mask_value(v_intake.bank_clabe),
        'master', public.provider_intake_mask_value(v_provider.clabe),
        'different', 'clabe' = any(v_fields)
      ),
      jsonb_build_object(
        'field', 'Beneficiario',
        'code', 'beneficiary',
        'declared', public.provider_intake_mask_text(v_intake.beneficiary_name),
        'master', public.provider_intake_mask_text(v_provider.beneficiary_name),
        'different', 'beneficiary' = any(v_fields)
      )
    )
  );
end
$$;

create or replace function public.provider_intake_payment_draft_state(
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
  v_warnings text[] := array[]::text[];
  v_derived_state text;
  v_banking jsonb;
  v_material_mismatch boolean := false;
  v_resolution_valid boolean := false;
begin
  select * into v_intake
  from public.payment_intake
  where id = p_payment_intake_id;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  select * into v_draft
  from public.payment_intake_conversion_drafts
  where payment_intake_id = p_payment_intake_id;
  v_has_draft := found;

  if v_intake.matched_proveedor_id is not null then
    select coalesce(p.activo, true) into v_provider_active
    from public.proveedores p
    where p.id = v_intake.matched_proveedor_id;
    v_provider_active := coalesce(v_provider_active, false);
  end if;

  v_banking := public.provider_intake_banking_difference_state(v_intake.id);
  v_material_mismatch := coalesce((v_banking ->> 'material_mismatch')::boolean, false);
  v_resolution_valid := coalesce((v_banking ->> 'resolution_valid')::boolean, false);

  if v_has_draft then
    if v_draft.cost_center_id is null then v_missing := array_append(v_missing, 'cost_center_id'); end if;
    if v_draft.budget_category_id is null then v_missing := array_append(v_missing, 'budget_category_id'); end if;
    if v_draft.budget_month is null then v_missing := array_append(v_missing, 'budget_month'); end if;
    if v_draft.payment_method is null then v_missing := array_append(v_missing, 'payment_method'); end if;
    if v_draft.payment_method = 'transfer' and v_draft.company_bank_account_id is null then
      v_missing := array_append(v_missing, 'company_bank_account_id');
    end if;
    if v_draft.requested_by_profile_id is null then v_missing := array_append(v_missing, 'requested_by_profile_id'); end if;
    if v_draft.approver_profile_id is null then v_missing := array_append(v_missing, 'approver_profile_id'); end if;
    if v_draft.final_amount is null then v_missing := array_append(v_missing, 'final_amount'); end if;
    if v_draft.currency is null then v_missing := array_append(v_missing, 'currency'); end if;
    if v_draft.scheduled_payment_date is null then v_missing := array_append(v_missing, 'scheduled_payment_date'); end if;
    if v_draft.internal_concept is null then v_missing := array_append(v_missing, 'internal_concept'); end if;
    if v_draft.final_amount is not null
       and v_draft.final_amount is distinct from v_intake.amount_requested
       and v_draft.amount_change_reason is null then
      v_missing := array_append(v_missing, 'amount_change_reason');
    end if;
  end if;

  if v_has_draft and v_material_mismatch then
    if v_draft.payment_method = 'transfer' and not v_resolution_valid then
      v_blockers := array_append(v_blockers, 'BANKING_DATA_REVIEW_REQUIRED');
    elsif v_draft.payment_method in ('cash', 'check') then
      v_warnings := array_append(v_warnings, 'BANKING_DATA_DIFFERS_NOT_USED_BY_METHOD');
    end if;
  end if;

  if v_intake.created_payment_request_id is not null or v_intake.status = 'converted' then
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
  elsif v_draft.payment_method = 'transfer' and v_material_mismatch and not v_resolution_valid then
    v_derived_state := 'BLOCKED_BANK_REVIEW';
  else
    v_derived_state := 'READY_FOR_CONVERSION';
  end if;

  return jsonb_build_object(
    'derived_state', v_derived_state,
    'missing_fields', to_jsonb(v_missing),
    'blockers', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings),
    'missing_count', cardinality(v_missing),
    'blockers_count', cardinality(v_blockers),
    'warnings_count', cardinality(v_warnings),
    'has_draft', v_has_draft,
    'draft_version', case when v_has_draft then v_draft.version else null end,
    'provider_present', v_intake.matched_proveedor_id is not null,
    'provider_active', v_provider_active,
    'banking', v_banking,
    'ready_for_conversion', v_derived_state = 'READY_FOR_CONVERSION'
  );
end
$$;

create function public.confirm_provider_intake_master_banking(
  p_payment_intake_id uuid,
  p_expected_intake_updated_at timestamptz,
  p_expected_provider_updated_at timestamptz,
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
  v_provider public.proveedores%rowtype;
  v_draft public.payment_intake_conversion_drafts%rowtype;
  v_provider_updated_at timestamptz;
  v_banking jsonb;
  v_existing public.payment_intake_events%rowtype;
begin
  if p_payment_intake_id is null
     or p_expected_intake_updated_at is null
     or p_action_id is null then
    raise exception 'provider_intake_banking_resolution_fields_required';
  end if;

  v_actor := public.provider_intake_actor_context();
  v_actor_profile_id := (v_actor ->> 'profile_id')::uuid;
  v_actor_type := v_actor ->> 'actor_type';

  select * into v_intake
  from public.payment_intake
  where id = p_payment_intake_id
  for update;

  if not found then raise exception 'provider_intake_not_found'; end if;
  perform public.provider_intake_assert_company_access(v_intake.company_id);

  if v_intake.status <> 'in_review' or v_intake.created_payment_request_id is not null then
    raise exception 'provider_intake_banking_resolution_status_invalid';
  end if;
  if v_intake.updated_at is distinct from p_expected_intake_updated_at then
    raise exception 'provider_intake_banking_resolution_intake_conflict';
  end if;
  if v_intake.matched_proveedor_id is null then
    raise exception 'provider_intake_banking_resolution_provider_required';
  end if;

  select * into v_provider
  from public.proveedores
  where id = v_intake.matched_proveedor_id
  for update;
  if not found then raise exception 'provider_intake_provider_not_found'; end if;
  v_provider_updated_at := coalesce(v_provider.updated_at, v_provider.created_at);

  if v_provider_updated_at is distinct from p_expected_provider_updated_at then
    raise exception 'provider_intake_banking_resolution_provider_conflict';
  end if;

  select * into v_draft
  from public.payment_intake_conversion_drafts
  where payment_intake_id = v_intake.id
  for update;
  if not found or v_draft.payment_method <> 'transfer' then
    raise exception 'provider_intake_banking_resolution_transfer_required';
  end if;

  select * into v_existing
  from public.payment_intake_events event
  where event.payment_intake_id = v_intake.id
    and event.metadata ->> 'action_id' = p_action_id::text;

  if found then
    if v_existing.event_type <> 'banking_resolution'
       or v_existing.actor_profile_id is distinct from v_actor_profile_id
       or v_existing.metadata ->> 'proveedor_id' <> v_provider.id::text then
      raise exception 'provider_intake_banking_resolution_action_conflict';
    end if;
    return jsonb_build_object(
      'payment_intake_id', v_intake.id,
      'proveedor_id', v_provider.id,
      'confirmed', true,
      'idempotent', true,
      'state', public.provider_intake_payment_draft_state(v_intake.id)
    );
  end if;

  v_banking := public.provider_intake_banking_difference_state(v_intake.id);
  if not coalesce((v_banking ->> 'material_mismatch')::boolean, false) then
    raise exception 'provider_intake_banking_resolution_not_required';
  end if;

  insert into public.payment_intake_events(
    payment_intake_id,
    event_type,
    actor_profile_id,
    actor_type,
    metadata
  ) values (
    v_intake.id,
    'banking_resolution',
    v_actor_profile_id,
    v_actor_type,
    jsonb_build_object(
      'action_id', p_action_id,
      'action_kind', 'banking_resolution',
      'decision', 'use_current_master_data',
      'proveedor_id', v_provider.id,
      'intake_updated_at', v_intake.updated_at,
      'provider_updated_at', v_provider_updated_at,
      'contract_version', 1,
      'sensitive_data_included', false
    )
  );

  return jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'proveedor_id', v_provider.id,
    'confirmed', true,
    'idempotent', false,
    'state', public.provider_intake_payment_draft_state(v_intake.id)
  );
end
$$;

create function public.get_provider_intake_provider_proposal(
  p_payment_intake_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_intake public.payment_intake%rowtype;
begin
  if p_payment_intake_id is null then raise exception 'provider_intake_id_required'; end if;
  perform public.provider_intake_actor_context();

  select * into v_intake
  from public.payment_intake
  where id = p_payment_intake_id;
  if not found then raise exception 'provider_intake_not_found'; end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);
  if v_intake.status not in ('in_review', 'needs_correction')
     or v_intake.created_payment_request_id is not null then
    raise exception 'provider_intake_provider_proposal_status_invalid';
  end if;

  return jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'public_folio', v_intake.public_folio,
    'company_id', v_intake.company_id,
    'status', v_intake.status,
    'provider_name', v_intake.provider_name,
    'provider_rfc', v_intake.provider_rfc,
    'provider_email', v_intake.provider_email,
    'provider_phone', v_intake.provider_phone,
    'bank_name', v_intake.bank_name,
    'bank_account', v_intake.bank_account,
    'bank_clabe', v_intake.bank_clabe,
    'beneficiary_name', v_intake.beneficiary_name,
    'proposal_only', true,
    'requires_explicit_save', true
  );
end
$$;

create function public.provider_intake_link_actor_authorized(
  p_profile_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_profile_id is not null
    and p_company_id is not null
    and exists (
      select 1
      from public.companies company
      where company.id = p_company_id
        and coalesce(company.active, true)
    )
    and public.has_active_company_membership(p_profile_id, p_company_id)
    and (
      exists (
        select 1
        from public.user_roles user_role
        join public.roles role on role.id = user_role.role_id
        where user_role.profile_id = p_profile_id
          and lower(btrim(role.name)) = any(array[
            'finance', 'finanzas', 'treasury', 'tesoreria', 'administracion'
          ]::text[])
      )
      or public.extraordinary_profile_is_company_director(p_profile_id, p_company_id)
    );
$$;

create function public.provider_intake_link_require_company_access(
  p_company_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := public.current_profile_id();
begin
  if v_profile_id is null then
    raise exception 'provider_intake_link_auth_required';
  end if;
  if not public.provider_intake_link_actor_authorized(v_profile_id, p_company_id) then
    raise exception 'provider_intake_link_access_denied';
  end if;
  return v_profile_id;
end
$$;

create function public.get_provider_intake_link_management_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := public.current_profile_id();
begin
  if v_profile_id is null then
    raise exception 'provider_intake_link_auth_required';
  end if;

  return jsonb_build_object(
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', company.id,
        'name', coalesce(nullif(btrim(company.legal_name), ''), company.name),
        'active_link', case when link.id is null then null else jsonb_build_object(
          'id', link.id,
          'label', link.label,
          'status', case when link.expires_at <= now() then 'expired' else link.status end,
          'token_prefix', link.token_prefix,
          'created_at', link.created_at,
          'expires_at', link.expires_at,
          'max_submissions_per_day', link.max_submissions_per_day,
          'allowed_file_types', to_jsonb(link.allowed_file_types),
          'max_file_mb', link.max_file_mb,
          'current_intakes', (
            select count(*)
            from public.payment_intake intake
            where intake.intake_link_id = link.id
          )
        ) end
      ) order by coalesce(nullif(btrim(company.legal_name), ''), company.name), company.id)
      from public.companies company
      left join lateral (
        select intake_link.*
        from public.intake_links intake_link
        where intake_link.company_id = company.id
          and intake_link.status = 'active'
        order by intake_link.created_at desc, intake_link.id desc
        limit 1
      ) link on true
      where coalesce(company.active, true)
        and public.provider_intake_link_actor_authorized(v_profile_id, company.id)
    ), '[]'::jsonb),
    'defaults', jsonb_build_object(
      'duration_hours', 72,
      'minimum_duration_hours', 4,
      'maximum_duration_hours', 168,
      'max_submissions_per_day', 20,
      'max_file_mb', 10,
      'max_files', 3,
      'max_total_mb', 12,
      'allowed_file_types', jsonb_build_array(
        'application/pdf', 'application/xml', 'text/xml',
        'image/jpeg', 'image/png', 'image/webp'
      )
    ),
    'raw_token_retrievable', false,
    'one_active_link_per_company', true
  );
end
$$;

create function public.create_provider_intake_link(
  p_company_id uuid,
  p_label text,
  p_duration_hours integer default 72,
  p_max_submissions_per_day integer default 20,
  p_max_file_mb integer default 10
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_company public.companies%rowtype;
  v_label text := nullif(regexp_replace(btrim(coalesce(p_label, '')), '[[:space:]]+', ' ', 'g'), '');
  v_token text;
  v_link public.intake_links%rowtype;
begin
  if p_company_id is null then raise exception 'provider_intake_link_company_required'; end if;
  if v_label is null or char_length(v_label) not between 3 and 120
     or v_label ~ '[[:cntrl:]]' or v_label ~ '<[^>]*>' then
    raise exception 'provider_intake_link_label_invalid';
  end if;
  if p_duration_hours not between 4 and 168 then raise exception 'provider_intake_link_duration_invalid'; end if;
  if p_max_submissions_per_day not between 1 and 100 then raise exception 'provider_intake_link_submission_limit_invalid'; end if;
  if p_max_file_mb not between 1 and 10 then raise exception 'provider_intake_link_file_limit_invalid'; end if;

  v_actor := public.provider_intake_link_require_company_access(p_company_id);

  select * into v_company
  from public.companies
  where id = p_company_id
    and coalesce(active, true)
  for update;
  if not found then raise exception 'provider_intake_link_company_not_found'; end if;

  update public.intake_links
  set status = 'expired'
  where company_id = p_company_id
    and status = 'active'
    and expires_at <= now();

  if exists (
    select 1 from public.intake_links
    where company_id = p_company_id and status = 'active'
  ) then
    raise exception 'provider_intake_link_active_exists';
  end if;

  v_token := translate(
    trim(trailing '=' from encode(extensions.gen_random_bytes(32), 'base64')),
    '+/',
    '-_'
  );

  insert into public.intake_links(
    company_id, label, token_hash, token_prefix, status, expires_at,
    max_submissions_per_day, allowed_file_types, max_file_mb, created_by
  ) values (
    p_company_id,
    v_label,
    encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
    left(v_token, 10),
    'active',
    now() + make_interval(hours => p_duration_hours),
    p_max_submissions_per_day,
    array['application/pdf','application/xml','text/xml','image/jpeg','image/png','image/webp']::text[],
    p_max_file_mb,
    v_actor
  ) returning * into v_link;

  return jsonb_build_object(
    'id', v_link.id,
    'company_id', v_link.company_id,
    'company_name', coalesce(nullif(btrim(v_company.legal_name), ''), v_company.name),
    'label', v_link.label,
    'status', v_link.status,
    'raw_token', v_token,
    'token_prefix', v_link.token_prefix,
    'created_at', v_link.created_at,
    'expires_at', v_link.expires_at,
    'max_submissions_per_day', v_link.max_submissions_per_day,
    'allowed_file_types', to_jsonb(v_link.allowed_file_types),
    'max_file_mb', v_link.max_file_mb,
    'current_intakes', 0,
    'raw_token_once', true
  );
end
$$;

create function public.revoke_provider_intake_link(
  p_intake_link_id uuid,
  p_confirmed boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_link public.intake_links%rowtype;
begin
  if p_intake_link_id is null then raise exception 'provider_intake_link_id_required'; end if;
  if p_confirmed is not true then raise exception 'provider_intake_link_confirmation_required'; end if;

  select * into v_link
  from public.intake_links
  where id = p_intake_link_id
  for update;
  if not found then raise exception 'provider_intake_link_not_found'; end if;

  v_actor := public.provider_intake_link_require_company_access(v_link.company_id);
  if v_link.status <> 'active' then raise exception 'provider_intake_link_not_active'; end if;

  update public.intake_links
  set status = 'revoked', revoked_by = v_actor, revoked_at = now()
  where id = v_link.id
  returning * into v_link;

  return jsonb_build_object(
    'id', v_link.id,
    'company_id', v_link.company_id,
    'status', v_link.status,
    'revoked_at', v_link.revoked_at,
    'current_intakes', (
      select count(*) from public.payment_intake intake where intake.intake_link_id = v_link.id
    )
  );
end
$$;

create function public.regenerate_provider_intake_link(
  p_intake_link_id uuid,
  p_confirmed boolean,
  p_duration_hours integer default 72
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_old public.intake_links%rowtype;
  v_new public.intake_links%rowtype;
  v_company public.companies%rowtype;
  v_token text;
begin
  if p_intake_link_id is null then raise exception 'provider_intake_link_id_required'; end if;
  if p_confirmed is not true then raise exception 'provider_intake_link_confirmation_required'; end if;
  if p_duration_hours not between 4 and 168 then raise exception 'provider_intake_link_duration_invalid'; end if;

  select * into v_old
  from public.intake_links
  where id = p_intake_link_id
  for update;
  if not found then raise exception 'provider_intake_link_not_found'; end if;

  v_actor := public.provider_intake_link_require_company_access(v_old.company_id);
  if v_old.status <> 'active' then raise exception 'provider_intake_link_not_active'; end if;

  select * into v_company
  from public.companies
  where id = v_old.company_id
  for update;

  update public.intake_links
  set status = 'revoked', revoked_by = v_actor, revoked_at = now()
  where id = v_old.id;

  v_token := translate(
    trim(trailing '=' from encode(extensions.gen_random_bytes(32), 'base64')),
    '+/',
    '-_'
  );

  insert into public.intake_links(
    company_id, label, token_hash, token_prefix, status, expires_at,
    max_submissions_per_day, allowed_file_types, max_file_mb, created_by,
    regenerated_from_id
  ) values (
    v_old.company_id,
    v_old.label,
    encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
    left(v_token, 10),
    'active',
    now() + make_interval(hours => p_duration_hours),
    v_old.max_submissions_per_day,
    v_old.allowed_file_types,
    v_old.max_file_mb,
    v_actor,
    v_old.id
  ) returning * into v_new;

  return jsonb_build_object(
    'id', v_new.id,
    'company_id', v_new.company_id,
    'company_name', coalesce(nullif(btrim(v_company.legal_name), ''), v_company.name),
    'label', v_new.label,
    'status', v_new.status,
    'raw_token', v_token,
    'token_prefix', v_new.token_prefix,
    'created_at', v_new.created_at,
    'expires_at', v_new.expires_at,
    'max_submissions_per_day', v_new.max_submissions_per_day,
    'allowed_file_types', to_jsonb(v_new.allowed_file_types),
    'max_file_mb', v_new.max_file_mb,
    'current_intakes', 0,
    'regenerated_from_id', v_old.id,
    'raw_token_once', true
  );
end
$$;

revoke all on function public.provider_intake_mask_text(text) from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_banking_difference_state(uuid) from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_link_actor_authorized(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_link_require_company_access(uuid) from public, anon, authenticated, service_role;

revoke all on function public.confirm_provider_intake_master_banking(uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_provider_intake_master_banking(uuid, timestamptz, timestamptz, uuid)
  to authenticated;

revoke all on function public.get_provider_intake_provider_proposal(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_provider_intake_provider_proposal(uuid)
  to authenticated;

revoke all on function public.get_provider_intake_link_management_context()
  from public, anon, authenticated, service_role;
grant execute on function public.get_provider_intake_link_management_context()
  to authenticated;

revoke all on function public.create_provider_intake_link(uuid, text, integer, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.create_provider_intake_link(uuid, text, integer, integer, integer)
  to authenticated;

revoke all on function public.revoke_provider_intake_link(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.revoke_provider_intake_link(uuid, boolean)
  to authenticated;

revoke all on function public.regenerate_provider_intake_link(uuid, boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.regenerate_provider_intake_link(uuid, boolean, integer)
  to authenticated;

comment on function public.confirm_provider_intake_master_banking(uuid, timestamptz, timestamptz, uuid) is
  'Audits an explicit Finance decision to use current provider master banking data. Stores identifiers and timestamps only; never declared banking values.';
comment on function public.get_provider_intake_link_management_context() is
  'Authenticated company-scoped link administration context. Admin/sysadmin alone is intentionally insufficient.';
comment on function public.create_provider_intake_link(uuid, text, integer, integer, integer) is
  'Creates one active company-scoped provider intake link and returns the raw token exactly once. Only the SHA-256 hash is persisted.';
comment on function public.regenerate_provider_intake_link(uuid, boolean, integer) is
  'Atomically revokes and replaces an active provider intake link. The new raw token is returned exactly once.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.payment_intake_events'::regclass
      and constraint_row.conname = 'payment_intake_events_event_type_check'
      and pg_get_constraintdef(constraint_row.oid) like '%banking_resolution%'
      and constraint_row.convalidated
  ) then
    raise exception '045_postcheck: banking audit event type is unavailable';
  end if;

  if (
    select count(*)
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname in (
        'confirm_provider_intake_master_banking',
        'get_provider_intake_provider_proposal',
        'get_provider_intake_link_management_context',
        'create_provider_intake_link',
        'revoke_provider_intake_link',
        'regenerate_provider_intake_link'
      )
      and proc.prosecdef
      and exists (
        select 1
        from unnest(coalesce(proc.proconfig, array[]::text[])) setting
        where setting = 'search_path=public, pg_temp'
      )
  ) <> 6 then
    raise exception '045_postcheck: RPC security attributes are incomplete';
  end if;

  if exists (
    select 1
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname in (
        'confirm_provider_intake_master_banking',
        'get_provider_intake_provider_proposal',
        'get_provider_intake_link_management_context',
        'create_provider_intake_link',
        'revoke_provider_intake_link',
        'regenerate_provider_intake_link'
      )
      and (
        has_function_privilege('anon', proc.oid, 'EXECUTE')
        or not has_function_privilege('authenticated', proc.oid, 'EXECUTE')
        or has_function_privilege('service_role', proc.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception '045_postcheck: RPC grants are unsafe';
  end if;

  if not exists (
    select 1 from pg_indexes index_row
    where index_row.schemaname = 'public'
      and index_row.tablename = 'intake_links'
      and index_row.indexname = 'intake_links_one_active_per_company_uidx'
      and index_row.indexdef like 'CREATE UNIQUE INDEX%'
  ) then
    raise exception '045_postcheck: one-active-link invariant is unavailable';
  end if;
end
$$;

commit;
