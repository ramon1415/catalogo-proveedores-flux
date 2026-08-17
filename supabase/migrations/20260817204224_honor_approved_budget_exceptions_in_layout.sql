begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
declare
  v_identity text;
  v_expected_hash text;
  v_actual_hash text;
begin
  for v_identity, v_expected_hash in
    select expected.identity, expected.sha256
    from (values
      (
        'public.approval_batch_payment_layout_candidates_pre_037(date,date,uuid,uuid)',
        '241637d5bc5dd587d966bcbfffd85b8cec58978952f712c3f174b6144abc2472'
      ),
      (
        'public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)',
        '89b12fc886516e1cf16b66ba33e6a060f06eedbcc6d10ff69b9ac758d2c373c0'
      ),
      (
        'public.preview_payment_layout_eligibility_pre_037(date,date,uuid,uuid)',
        '2f38024c350de268f4519192b5d51cb381583d602264476ee2c6adf63246f00d'
      ),
      (
        'public.preview_payment_layout_eligibility(date,date,uuid,uuid)',
        '74f99a3db18afddb5cc4c1842dfbca1603b2f1666c0810d0b1ea18bfe5b16458'
      ),
      (
        'public.create_payment_layout(date,date,uuid,text,uuid,uuid)',
        '24a6a9d4fddb6c946c898a2b24f5aa14f246b67f1c02c9fc950282c1d7cd8342'
      ),
      (
        'public.payment_request_layout_missing_fields(public.payment_requests)',
        'c7abedf75ef40f0e7650e2ce4d31403f176784aff84d4aab141f048a4d242cd6'
      ),
      (
        'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)',
        '89cf39fd568f7c49c539b1be87733b7db3eb5d5420f9048b29828466d12a48e2'
      ),
      (
        'public.mark_payment_request_material_change()',
        'b4c5c8bbe6dbc6dae35a09a2dc7f7ae19d59e1e13469813f536573e0237851d3'
      ),
      (
        'public.decide_payment_request(uuid,uuid,text,text)',
        '677c5b642951b1308fd4626abedb75dc7c02ba3865d610b58c6c0f0f38db335f'
      ),
      (
        'public.extraordinary_authorization_is_ready(uuid)',
        'ab3f0bc9ced52e807f7bfcb4681e8772bfe200409cf0256ed3b149558d3d3db3'
      ),
      (
        'public.approval_batch_request_eligibility(uuid,uuid)',
        'aa39c36de335f2a13ef0f879f73a63b2dd8a5e2b30b06923046082a5bcbdb51f'
      ),
      (
        'public.approval_batch_item_release_block_reason(uuid)',
        '76db4af562a13306150bebd4b464c67de1eb5e03cdd8f6179b8449ffb19fb93c'
      ),
      (
        'public.release_and_rebatch_rejected_request(uuid,text,uuid)',
        'a8e383045c06183c2532bfc2dcd6a1700df93f3e90ab7442b4e78dbb692219e1'
      ),
      (
        'public.close_approval_batch(uuid)',
        '467b687e5a3777f9642eedcf2cf30743a584cc619d1a02a9f21082ccb96771db'
      ),
      (
        'public.preview_approval_batch_close(uuid)',
        '0a8390233d9a1368dc51595ced06421897fa0089ec609b3fa16c090bf3de0543'
      ),
      (
        'public.approval_batch_request_has_current_direction_approval(uuid)',
        '0c6355cc5e28b6fbf5bd5291a15d15cad20541edfa8800b55a70fc1021a81665'
      )
    ) as expected(identity, sha256)
  loop
    if to_regprocedure(v_identity) is null then
      raise exception 'layout_budget_exception_precheck: missing function %', v_identity;
    end if;

    select encode(
      extensions.digest(
        convert_to(pg_get_functiondef(to_regprocedure(v_identity)), 'UTF8'),
        'sha256'
      ),
      'hex'
    )
    into v_actual_hash;

    if v_actual_hash is distinct from v_expected_hash then
      raise exception
        'layout_budget_exception_precheck: function drift for % (expected %, got %)',
        v_identity,
        v_expected_hash,
        v_actual_hash;
    end if;
  end loop;

  if to_regprocedure(
    'public.payment_request_has_current_approved_budget_exception(public.payment_requests)'
  ) is not null then
    raise exception 'layout_budget_exception_precheck: helper already exists';
  end if;

  if to_regprocedure(
    'public.payment_layout_reference_issue(text,text)'
  ) is not null then
    raise exception 'layout_budget_exception_precheck: reference helper already exists';
  end if;

  if to_regclass(
    'public.payment_request_approvals_request_latest_idx'
  ) is not null then
    raise exception 'layout_budget_exception_precheck: supporting index already exists';
  end if;
end
$precheck$;

create index payment_request_approvals_request_latest_idx
  on public.payment_request_approvals (
    payment_request_id,
    created_at desc,
    id desc
  )
  include (
    action,
    to_status,
    actor_profile_id,
    role_id,
    budget_decision_snapshot,
    budget_block_reason_snapshot
  );

create function public.payment_layout_reference_issue(
  p_payment_reference text,
  p_destination_type text
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when nullif(btrim(p_payment_reference), '') is null
      then 'payment_reference'
    when lower(coalesce(p_destination_type, '')) = 'clabe'
      and btrim(p_payment_reference) !~ '^[0-9]{1,5}$'
      then 'payment_reference_invalid'
    when lower(coalesce(p_destination_type, '')) = 'convenio'
      and (
        char_length(btrim(p_payment_reference)) > 20
        or octet_length(convert_to(btrim(p_payment_reference), 'UTF8'))
          <> char_length(btrim(p_payment_reference))
        or btrim(p_payment_reference) ~ '[[:cntrl:]]'
        or position('|' in btrim(p_payment_reference)) > 0
      )
      then 'payment_reference_invalid'
    else null
  end;
$$;

alter function public.payment_layout_reference_issue(text,text) owner to postgres;

revoke all on function public.payment_layout_reference_issue(text,text)
  from public, anon, authenticated;

grant execute on function public.payment_layout_reference_issue(text,text)
  to service_role;

create function public.payment_request_has_current_approved_budget_exception(
  p_request public.payment_requests
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select count(*) = 1
    from public.payment_request_approvals approval
    join public.profiles actor
      on actor.id = approval.actor_profile_id
    join public.roles role_snapshot
      on role_snapshot.id = approval.role_id
    where p_request.id is not null
      and p_request.status::text = 'approved'
      and p_request.budget_decision = 'bloqueado'
      and p_request.budget_block_reason = 'sin_disponible'
      and p_request.exception_status = 'approved'
      and p_request.exception_action = 'exception_approved'
      and p_request.exception_approved_by is not null
      and p_request.exception_approved_at is not null
      and p_request.exception_approved_at >= p_request.approval_material_updated_at
      and nullif(btrim(p_request.exception_reason), '') is not null
      and approval.payment_request_id = p_request.id
      and approval.action = 'exception_approved'
      and approval.to_status = 'approved'
      and approval.actor_profile_id = p_request.exception_approved_by
      and approval.created_at = p_request.exception_approved_at
      and approval.budget_decision_snapshot = 'bloqueado'
      and approval.budget_block_reason_snapshot = 'sin_disponible'
      and approval.budget_result_snapshot ->> 'status' = 'bloqueado'
      and approval.budget_result_snapshot ->> 'motivo' = 'sin_disponible'
      and nullif(btrim(approval.comments), '') is not null
      and btrim(approval.comments) = btrim(p_request.exception_reason)
      and not exists (
        select 1
        from public.payment_request_approvals later
        where later.payment_request_id = p_request.id
          and (later.created_at, later.id) > (approval.created_at, approval.id)
      )
      and not exists (
        select 1
        from public.payment_request_approvals competing
        where competing.payment_request_id = p_request.id
          and competing.id <> approval.id
          and competing.created_at = approval.created_at
      )
  ), false);
$$;

alter function public.payment_request_has_current_approved_budget_exception(
  public.payment_requests
) owner to postgres;

revoke all on function public.payment_request_has_current_approved_budget_exception(
  public.payment_requests
) from public, anon, authenticated;

grant execute on function public.payment_request_has_current_approved_budget_exception(
  public.payment_requests
) to service_role;

create or replace function public.payment_request_layout_missing_fields(
  p_request public.payment_requests
)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company public.companies%rowtype;
  v_company_found boolean := false;
  v_company_account public.company_bank_accounts%rowtype;
  v_company_account_found boolean := false;
  v_provider public.proveedores%rowtype;
  v_provider_found boolean := false;
  v_source_normalized text;
  v_payment_concept text := coalesce(
    nullif(btrim(p_request.payment_concept), ''),
    nullif(btrim(p_request.concept), ''),
    nullif(btrim(p_request.description), '')
  );
  v_reference_issue text;
  v_missing text[];
begin
  if p_request.company_id is not null then
    select * into v_company
    from public.companies company
    where company.id = p_request.company_id;
    v_company_found := found;
  end if;

  if p_request.company_bank_account_id is not null then
    select * into v_company_account
    from public.company_bank_accounts company_account
    where company_account.id = p_request.company_bank_account_id;
    v_company_account_found := found;
  end if;

  if p_request.proveedor_id is not null then
    select * into v_provider
    from public.proveedores provider
    where provider.id = p_request.proveedor_id;
    v_provider_found := found;
  end if;

  v_source_normalized := regexp_replace(
    coalesce(v_company_account.account_number, ''),
    '[[:space:]-]',
    '',
    'g'
  );
  v_reference_issue := public.payment_layout_reference_issue(
    p_request.payment_reference,
    case when v_provider_found then v_provider.destination_type else null end
  );

  v_missing := array_remove(array[
    case when p_request.scheduled_payment_date is null then 'scheduled_payment_date' end,
    case when p_request.company_id is null then 'company_id' end,
    case when p_request.company_id is not null and not v_company_found then 'company_not_found' end,
    case when v_company_found and not coalesce(v_company.active, false) then 'company_inactive' end,
    case
      when v_company_found
        and coalesce(
          nullif(btrim(v_company.legal_name), ''),
          nullif(btrim(v_company.name), '')
        ) is null
        then 'company_name'
    end,
    case when p_request.company_bank_account_id is null then 'company_bank_account_id' end,
    case
      when p_request.company_bank_account_id is not null
        and not v_company_account_found
        then 'company_bank_account_id_not_found'
    end,
    case
      when v_company_account_found
        and v_company_account.company_id is distinct from p_request.company_id
        then 'company_bank_account_company_mismatch'
    end,
    case
      when v_company_account_found
        and not coalesce(v_company_account.active, false)
        then 'company_bank_account_inactive'
    end,
    case
      when v_company_account_found
        and nullif(btrim(v_company_account.account_number), '') is null
        then 'source_account_number'
    end,
    case
      when v_company_account_found
        and nullif(btrim(v_company_account.account_number), '') is not null
        and v_source_normalized !~ '^[0-9]{1,18}$'
        then 'source_account_number_invalid'
    end,
    case when p_request.proveedor_id is null then 'proveedor_id' end,
    case
      when p_request.proveedor_id is not null and not v_provider_found
        then 'proveedor_not_found'
    end,
    case
      when v_provider_found and not coalesce(v_provider.activo, false)
        then 'proveedor_inactive'
    end,
    case when v_reference_issue = 'payment_reference' then 'payment_reference' end,
    case
      when v_reference_issue = 'payment_reference_invalid'
        then 'payment_reference_invalid'
    end,
    case when v_payment_concept is null then 'payment_concept' end,
    case
      when v_payment_concept is not null
        and (
          char_length(v_payment_concept) > 120
          or v_payment_concept ~ '[[:cntrl:]]'
        )
        then 'payment_concept_invalid'
    end,
    case
      when coalesce(nullif(upper(btrim(p_request.currency)), ''), 'MXN') <> 'MXN'
        then 'unsupported_layout_currency'
    end,
    case when coalesce(p_request.amount_requested, 0) <= 0 then 'invalid_amount' end
  ]::text[], null);

  if v_provider_found then
    v_missing := v_missing
      || public.provider_payment_execution_missing_fields(v_provider);
  end if;

  select coalesce(
    array_agg(distinct missing_field.field_name order by missing_field.field_name),
    array[]::text[]
  )
  into v_missing
  from unnest(v_missing) as missing_field(field_name);

  return v_missing;
end
$$;

create or replace function public.complete_payment_request_layout_data(
  p_payment_request_id uuid,
  p_company_bank_account_id uuid default null,
  p_payment_reference text default null,
  p_payment_concept text default null,
  p_scheduled_payment_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_request_before public.payment_requests%rowtype;
  v_request_after public.payment_requests%rowtype;
  v_reference text;
  v_reference_issue text;
  v_destination_type text;
  v_concept text;
  v_account_id uuid;
  v_schedule date;
  v_material_before timestamptz;
  v_direction_was_current boolean;
  v_direction_is_current boolean;
  v_direction_reapproval_required boolean := false;
  v_changed_fields text[];
  v_completed_fields text[];
  v_missing_before text[];
  v_missing_after text[];
begin
  if p_payment_request_id is null then
    raise exception 'payment_request_required';
  end if;

  v_actor := public.approval_batch_require_finance();
  perform pg_advisory_xact_lock(
    hashtextextended(p_payment_request_id::text, 21021)
  );

  select *
    into v_request_before
  from public.payment_requests payment_request
  where payment_request.id = p_payment_request_id
  for update;

  if not found then
    raise exception 'payment_request_not_found';
  end if;

  if v_request_before.status::text in ('paid', 'cancelled')
     or public.approval_batch_request_has_any_execution_record(
       v_request_before.id
     ) then
    raise exception 'payment_request_layout_data_locked';
  end if;

  select provider.destination_type
    into v_destination_type
  from public.proveedores provider
  where provider.id = v_request_before.proveedor_id
    and coalesce(provider.activo, false);

  if not found then
    raise exception 'proveedor_not_found_or_inactive';
  end if;

  v_account_id := coalesce(
    p_company_bank_account_id,
    v_request_before.company_bank_account_id
  );

  if v_account_id is not null and not exists (
    select 1
    from public.company_bank_accounts company_account
    where company_account.id = v_account_id
      and company_account.company_id = v_request_before.company_id
      and coalesce(company_account.active, false)
      and nullif(btrim(company_account.account_number), '') is not null
  ) then
    raise exception
      'company_bank_account_not_found_inactive_or_company_mismatch';
  end if;

  if p_payment_reference is null then
    v_reference := nullif(btrim(v_request_before.payment_reference), '');
  elsif v_destination_type = 'clabe' then
    v_reference := nullif(
      regexp_replace(
        coalesce(p_payment_reference, ''),
        '[[:space:]]',
        '',
        'g'
      ),
      ''
    );
  else
    v_reference := nullif(btrim(p_payment_reference), '');
  end if;

  v_reference_issue := public.payment_layout_reference_issue(
    v_reference,
    v_destination_type
  );

  if v_reference_issue = 'payment_reference_invalid' then
    if v_destination_type = 'clabe'
       and v_reference !~ '^[0-9]+$' then
      raise exception 'payment_reference_must_be_numeric';
    elsif v_destination_type = 'clabe' then
      raise exception 'payment_reference_too_long';
    elsif v_destination_type = 'convenio' then
      raise exception 'payment_reference_cie_invalid';
    else
      raise exception 'payment_reference_invalid';
    end if;
  end if;

  if p_payment_concept is null then
    v_concept := v_request_before.payment_concept;
  else
    v_concept := nullif(btrim(p_payment_concept), '');
  end if;

  if v_concept is not null and char_length(v_concept) > 120 then
    raise exception 'payment_concept_too_long';
  end if;

  if v_concept is not null and v_concept ~ '[[:cntrl:]]' then
    raise exception 'payment_concept_invalid_characters';
  end if;

  v_schedule := coalesce(
    p_scheduled_payment_date,
    v_request_before.scheduled_payment_date,
    v_request_before.due_date
  );
  v_material_before := v_request_before.approval_material_updated_at;
  v_direction_was_current :=
    public.approval_batch_request_has_current_direction_approval(
      v_request_before.id
    );
  v_missing_before :=
    public.payment_request_layout_missing_fields(v_request_before);

  v_changed_fields := array_remove(array[
    case
      when v_request_before.company_bank_account_id is distinct from
           v_account_id then 'company_bank_account_id'
    end,
    case
      when v_request_before.payment_reference is distinct from
           v_reference then 'payment_reference'
    end,
    case
      when v_request_before.payment_concept is distinct from
           v_concept then 'payment_concept'
    end,
    case
      when v_request_before.scheduled_payment_date is distinct from
           v_schedule then 'scheduled_payment_date'
    end
  ]::text[], null);

  perform set_config(
    'flux.payment_execution_rpc',
    v_request_before.id::text,
    true
  );

  update public.payment_requests payment_request
  set company_bank_account_id = v_account_id,
      payment_reference = v_reference,
      payment_concept = v_concept,
      scheduled_payment_date = v_schedule,
      scheduled_by = case
        when v_schedule is distinct from
             payment_request.scheduled_payment_date then v_actor
        else payment_request.scheduled_by
      end,
      scheduled_at = case
        when v_schedule is distinct from
             payment_request.scheduled_payment_date then clock_timestamp()
        else payment_request.scheduled_at
      end,
      updated_at = clock_timestamp()
  where payment_request.id = v_request_before.id;

  select *
    into v_request_after
  from public.payment_requests payment_request
  where payment_request.id = v_request_before.id;

  if v_request_after.approval_material_updated_at is distinct from
     v_material_before then
    raise exception
      'operational_update_changed_approval_material_timestamp';
  end if;

  v_direction_is_current :=
    public.approval_batch_request_has_current_direction_approval(
      v_request_after.id
    );

  if v_direction_was_current and not v_direction_is_current then
    raise exception 'operational_update_invalidated_direction_approval';
  end if;

  v_missing_after :=
    public.payment_request_layout_missing_fields(v_request_after);

  select coalesce(
    array_agg(completed_field.field_name order by completed_field.field_name),
    array[]::text[]
  )
    into v_completed_fields
  from unnest(v_missing_before) as completed_field(field_name)
  where not (completed_field.field_name = any(v_missing_after));

  v_direction_reapproval_required := not v_direction_is_current and exists (
    select 1
    from public.approval_batch_items batch_item
    where batch_item.payment_request_id = v_request_after.id
      and batch_item.removed_at is null
      and batch_item.director_status = 'approved'
      and batch_item.decided_at is not null
      and batch_item.decided_at <
          v_request_after.approval_material_updated_at
  );

  return jsonb_build_object(
    'payment_request_id', v_request_after.id,
    'direction_was_current', v_direction_was_current,
    'direction_approval_current', v_direction_is_current,
    'direction_reapproval_required', v_direction_reapproval_required,
    'approval_preserved',
      v_direction_was_current and v_direction_is_current,
    'execution_data_updated', cardinality(v_changed_fields) > 0,
    'changed_fields', to_jsonb(v_changed_fields),
    'completed_fields', to_jsonb(v_completed_fields),
    'missing_fields', to_jsonb(v_missing_after),
    'history_preserved', true
  );
end
$$;

create or replace function public.approval_batch_payment_layout_candidates_pre_037(
  p_period_start date,
  p_period_end date,
  p_company_id uuid default null,
  p_company_bank_account_id uuid default null
)
returns table (
  classification text,
  classification_reason text,
  payment_request_id uuid,
  request_number text,
  request_status text,
  company_id uuid,
  company_name text,
  proveedor_id uuid,
  provider_name text,
  company_bank_account_id uuid,
  source_account_number text,
  destination_type text,
  destination_value text,
  beneficiary_name text,
  amount numeric,
  currency text,
  payment_reference text,
  payment_concept text,
  scheduled_payment_date date,
  missing_fields text[],
  finance_approval_current boolean,
  direction_approval_current boolean,
  direction_decided_at timestamptz,
  enforcement_required boolean,
  source_item_id uuid,
  source_batch_id uuid,
  source_batch_label text,
  source_batch_status text,
  director_status text,
  reject_reason text,
  rejected_by uuid,
  rejected_by_name text,
  rejected_at timestamptz,
  rebatch_status text,
  latest_correction_note text,
  extraordinary_authorization_id uuid,
  extraordinary_category text,
  extraordinary_reason text,
  extraordinary_authorized_by uuid,
  extraordinary_authorized_by_name text,
  extraordinary_authorized_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select
      pr.id as payment_request_id,
      pr.request_number,
      pr.status::text as request_status,
      pr.company_id,
      coalesce(nullif(btrim(c.legal_name), ''), c.name) as company_name,
      pr.proveedor_id,
      coalesce(nullif(btrim(p.alias), ''), p.nombre_completo) as provider_name,
      pr.company_bank_account_id,
      cba.account_number as source_account_number,
      p.destination_type,
      case
        when p.destination_type = 'clabe' then nullif(p.clabe, '')
        when p.destination_type = 'cuenta' then nullif(p.cuenta_bancaria, '')
        when p.destination_type = 'convenio' and nullif(p.convenio_number, '') is not null
          then 'CONVENIO ' || btrim(p.convenio_number)
        else null
      end as destination_value,
      coalesce(
        nullif(btrim(p.beneficiary_name), ''),
        nullif(btrim(p.nombre_completo), ''),
        nullif(btrim(p.alias), '')
      ) as beneficiary_name,
      pr.amount_requested as amount,
      coalesce(nullif(upper(btrim(pr.currency)), ''), 'MXN') as currency,
      nullif(btrim(pr.payment_reference), '') as payment_reference,
      coalesce(
        nullif(btrim(pr.payment_concept), ''),
        nullif(btrim(pr.concept), ''),
        nullif(btrim(pr.description), '')
      ) as payment_concept,
      pr.scheduled_payment_date,
      coalesce(budget.result ->> 'status', 'bloqueado') = 'aprobable'
        as budget_validation_current,
      public.payment_request_has_current_approved_budget_exception(pr)
        as budget_exception_current,
      budget.result ->> 'motivo' as budget_reason,
      public.approval_batch_request_has_current_direction_approval(pr.id)
        as direction_approval_current,
      latest_item.decided_at as direction_decided_at,
      coalesce(
        latest_item.decided_at >= pr.approval_material_updated_at,
        false
      ) as direction_decision_fresh,
      coalesce(settings.regular_payments_require_closed_batch, false)
        and settings.enforcement_started_at is not null
        and pr.created_at >= settings.enforcement_started_at as enforcement_required,
      latest_item.item_id as source_item_id,
      latest_item.batch_id as source_batch_id,
      latest_item.batch_label as source_batch_label,
      latest_item.batch_status as source_batch_status,
      latest_item.director_status,
      latest_item.reject_reason,
      latest_item.rejected_by,
      rejected_profile.full_name as rejected_by_name,
      latest_item.rejected_at,
      latest_item.rebatch_status,
      latest_item.latest_correction_note,
      extra.id as extraordinary_authorization_id,
      extra.category as extraordinary_category,
      extra.reason as extraordinary_reason,
      extra.authorized_by as extraordinary_authorized_by,
      extra_profile.full_name as extraordinary_authorized_by_name,
      extra.authorized_at as extraordinary_authorized_at,
      extra.authorized_at >= pr.approval_material_updated_at
        as extraordinary_authorization_current,
      public.approval_batch_request_has_any_execution_record(pr.id) as has_execution,
      array_remove(array[
        case when pr.scheduled_payment_date is null then 'scheduled_payment_date' end,
        case when pr.company_bank_account_id is null then 'company_bank_account_id' end,
        case when pr.company_bank_account_id is not null and cba.id is null then 'company_bank_account_id_not_found' end,
        case when cba.id is not null and not coalesce(cba.active, false) then 'company_bank_account_inactive' end,
        case when nullif(btrim(cba.account_number), '') is null then 'source_account_number' end,
        case when coalesce(nullif(btrim(c.legal_name), ''), nullif(btrim(c.name), '')) is null then 'company_name' end,
        case when pr.proveedor_id is null then 'proveedor_id' end,
        case when pr.proveedor_id is not null and p.id is null then 'proveedor_not_found' end,
        case when p.id is not null and not coalesce(p.activo, false) then 'proveedor_inactive' end,
        case when coalesce(nullif(btrim(p.beneficiary_name), ''), nullif(btrim(p.nombre_completo), ''), nullif(btrim(p.alias), '')) is null then 'beneficiary_name' end,
        case when p.destination_type is null then 'destination_type' end,
        case when p.destination_type = 'clabe' and nullif(btrim(p.clabe), '') is null then 'clabe' end,
        case when p.destination_type = 'cuenta' and nullif(btrim(p.cuenta_bancaria), '') is null then 'cuenta_bancaria' end,
        case when p.destination_type = 'convenio' and nullif(btrim(p.convenio_number), '') is null then 'convenio_number' end,
        case
          when public.payment_layout_reference_issue(
            pr.payment_reference,
            p.destination_type
          ) = 'payment_reference'
            then 'payment_reference'
        end,
        case
          when public.payment_layout_reference_issue(
            pr.payment_reference,
            p.destination_type
          ) = 'payment_reference_invalid'
            then 'payment_reference_invalid'
        end,
        case when coalesce(
          nullif(btrim(pr.payment_concept), ''),
          nullif(btrim(pr.concept), ''),
          nullif(btrim(pr.description), '')
        ) is null then 'payment_concept' end,
        case when coalesce(nullif(upper(btrim(pr.currency)), ''), 'MXN') <> 'MXN' then 'unsupported_layout_currency' end,
        case when coalesce(pr.amount_requested, 0) <= 0 then 'invalid_amount' end
      ]::text[], null) as missing_fields
    from public.payment_requests pr
    left join public.companies c on c.id = pr.company_id
    left join public.company_bank_accounts cba on cba.id = pr.company_bank_account_id
    left join public.proveedores p on p.id = pr.proveedor_id
    left join public.approval_batch_company_settings settings
      on settings.company_id = pr.company_id
    cross join lateral (
      select public.approval_batch_budget_validation(pr.id) as result
    ) budget
    left join lateral (
      select
        abi.id as item_id,
        abi.batch_id,
        ab.label as batch_label,
        ab.status as batch_status,
        abi.director_status,
        abi.director_reject_reason as reject_reason,
        abi.decided_by as rejected_by,
        abi.decided_at as rejected_at,
        abi.decided_at,
        abi.rebatch_status,
        abi.rebatch_release_note as latest_correction_note
      from public.approval_batch_items abi
      join public.approval_batches ab on ab.id = abi.batch_id
      where abi.payment_request_id = pr.id
        and abi.removed_at is null
      order by abi.review_sequence desc, abi.created_at desc, abi.id desc
      limit 1
    ) latest_item on true
    left join public.profiles rejected_profile
      on rejected_profile.id = latest_item.rejected_by
    left join lateral (
      select
        prea.id,
        prea.category,
        prea.reason,
        prea.authorized_by,
        prea.authorized_at
      from public.payment_request_extraordinary_authorizations prea
      where prea.payment_request_id = pr.id
        and prea.status = 'active'
      order by prea.authorized_at desc
      limit 1
    ) extra on true
    left join public.profiles extra_profile
      on extra_profile.id = extra.authorized_by
    where coalesce(
        nullif(pr.payment_method, ''),
        case
          when pr.request_type::text in ('cash', 'check')
            then pr.request_type::text
          else 'transfer'
        end
      ) = 'transfer'
      and coalesce(pr.scheduled_payment_date, pr.created_at::date)
        between p_period_start and p_period_end
      and (p_company_id is null or pr.company_id = p_company_id)
      and (
        p_company_bank_account_id is null
        or pr.company_bank_account_id = p_company_bank_account_id
        or pr.company_bank_account_id is null
      )
      and pr.status::text in (
        'submitted', 'pending_approval', 'approved', 'rejected', 'changes_requested',
        'finance_validation', 'scheduled', 'paid'
      )
  ), marked as (
    select
      case
        when b.has_execution then 'already_executed'
        when b.director_status = 'rejected' and b.rebatch_status = 'blocked' then 'rejected_by_direction'
        when b.extraordinary_authorization_id is not null and not coalesce(b.extraordinary_authorization_current, false) then 'invalid_data'
        when b.extraordinary_authorization_id is not null and cardinality(b.missing_fields) > 0 then 'invalid_data'
        when b.extraordinary_authorization_id is not null then 'ready_extraordinary'
        when b.source_batch_status in ('draft', 'submitted') then 'pending_director'
        when not (b.budget_validation_current or b.budget_exception_current) then 'invalid_data'
        when cardinality(b.missing_fields) > 0 then 'invalid_data'
        when b.director_status = 'approved' and not b.direction_decision_fresh then 'direction_reapproval_required'
        when b.director_status = 'approved' and b.source_batch_status in ('approved', 'partially_approved') then 'pending_finance_close'
        when b.director_status = 'approved' and b.source_batch_status = 'closed' and b.direction_approval_current then 'ready_regular'
        when b.director_status = 'approved' and b.source_batch_status = 'closed' then 'direction_reapproval_required'
        when b.director_status = 'rejected' and b.rebatch_status = 'released' then 'pending_director'
        when b.source_item_id is null and b.request_status = 'approved' and not b.enforcement_required then 'legacy_eligible'
        else 'pending_director'
      end as classification,
      case
        when b.has_execution then 'already_executed'
        when b.director_status = 'rejected' and b.rebatch_status = 'blocked' then 'direction_rejected'
        when b.extraordinary_authorization_id is not null and not coalesce(b.extraordinary_authorization_current, false) then 'extraordinary_reauthorization_required'
        when b.extraordinary_authorization_id is not null and cardinality(b.missing_fields) > 0 then 'incomplete_layout_data'
        when b.extraordinary_authorization_id is not null then 'extraordinary_authorized'
        when b.source_batch_status = 'draft' then 'batch_draft'
        when b.source_batch_status = 'submitted' then 'direction_pending'
        when not (b.budget_validation_current or b.budget_exception_current) then coalesce(b.budget_reason, 'budget_validation_required')
        when cardinality(b.missing_fields) > 0 then 'incomplete_layout_data'
        when b.director_status = 'approved' and not b.direction_decision_fresh then 'stale_direction_approval'
        when b.director_status = 'approved' and b.source_batch_status in ('approved', 'partially_approved') then 'finance_close_required'
        when b.director_status = 'rejected' and b.rebatch_status = 'released' then 'resubmission_available'
        when b.enforcement_required and b.source_item_id is null then 'closed_batch_required'
        when b.enforcement_required then 'direction_approval_required'
        when b.source_item_id is null and b.request_status = 'approved' then 'legacy_without_batch'
        else 'direction_approval_required'
      end as classification_reason,
      b.*
    from base b
  )
  select
    m.classification,
    m.classification_reason,
    m.payment_request_id,
    m.request_number,
    m.request_status,
    m.company_id,
    m.company_name,
    m.proveedor_id,
    m.provider_name,
    m.company_bank_account_id,
    m.source_account_number,
    m.destination_type,
    m.destination_value,
    m.beneficiary_name,
    m.amount,
    m.currency,
    m.payment_reference,
    m.payment_concept,
    m.scheduled_payment_date,
    array_remove(m.missing_fields || array[
      case
        when m.extraordinary_authorization_id is not null
          and not coalesce(m.extraordinary_authorization_current, false)
          then 'extraordinary_reauthorization_required'
      end,
      case
        when m.extraordinary_authorization_id is null
          and not (
            m.budget_validation_current
            or m.budget_exception_current
          )
          then 'budget_revalidation_required'
      end,
      case
        when m.classification = 'direction_reapproval_required'
          then 'direction_reapproval_required'
      end
    ]::text[], null),
    (
      m.budget_validation_current
      or m.budget_exception_current
      or (
        m.extraordinary_authorization_id is not null
        and coalesce(m.extraordinary_authorization_current, false)
      )
    ),
    m.direction_approval_current,
    m.direction_decided_at,
    m.enforcement_required,
    m.source_item_id,
    m.source_batch_id,
    m.source_batch_label,
    m.source_batch_status,
    m.director_status,
    m.reject_reason,
    m.rejected_by,
    m.rejected_by_name,
    m.rejected_at,
    m.rebatch_status,
    m.latest_correction_note,
    m.extraordinary_authorization_id,
    m.extraordinary_category,
    m.extraordinary_reason,
    m.extraordinary_authorized_by,
    m.extraordinary_authorized_by_name,
    m.extraordinary_authorized_at
  from marked m;
$$;

create or replace function public.approval_batch_request_eligibility(
  p_payment_request_id uuid,
  p_exclude_batch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_latest record;
  v_budget jsonb;
  v_missing text[] := array[]::text[];
  v_classification text;
  v_reason text;
  v_origin text := 'new';
  v_review_sequence integer := 1;
  v_eligible boolean := false;
  v_payment_method text;
  v_budget_exception_current boolean := false;
  v_budget_authorization_source text;
begin
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id;
  if not found then
    return jsonb_build_object(
      'eligible', false,
      'classification', 'invalid_data',
      'reason', 'payment_request_not_found'
    );
  end if;

  select
    abi.id,
    abi.batch_id,
    ab.label as batch_label,
    ab.status as batch_status,
    abi.director_status,
    abi.director_reject_reason,
    abi.rebatch_status,
    abi.rebatch_release_note,
    abi.decided_at,
    abi.decided_by,
    abi.review_sequence
  into v_latest
  from public.approval_batch_items abi
  join public.approval_batches ab on ab.id = abi.batch_id
  where abi.payment_request_id = v_request.id
    and abi.removed_at is null
    and (p_exclude_batch_id is null or abi.batch_id <> p_exclude_batch_id)
  order by abi.review_sequence desc, abi.created_at desc, abi.id desc
  limit 1;

  if v_latest.id is not null then
    v_review_sequence := coalesce(v_latest.review_sequence, 1) + 1;
    if v_latest.director_status = 'rejected'
       and v_latest.rebatch_status = 'released' then
      v_origin := 'resubmission';
    elsif v_latest.director_status = 'approved'
          and coalesce(
            v_latest.decided_at < v_request.approval_material_updated_at,
            true
          ) then
      v_origin := 'material_change_review';
    end if;
  end if;

  v_payment_method := coalesce(
    nullif(v_request.payment_method, ''),
    case
      when v_request.request_type::text in ('cash', 'check')
        then v_request.request_type::text
      else 'transfer'
    end
  );

  if v_request.company_id is null then
    v_missing := array_append(v_missing, 'company_id');
  end if;
  if v_request.requested_by is null then
    v_missing := array_append(v_missing, 'requested_by');
  end if;
  if v_request.proveedor_id is null and v_payment_method = 'transfer' then
    v_missing := array_append(v_missing, 'proveedor_id');
  end if;
  if v_request.cost_center_id is null then
    v_missing := array_append(v_missing, 'cost_center_id');
  end if;
  if v_request.budget_category_id is null then
    v_missing := array_append(v_missing, 'budget_category_id');
  end if;
  if v_request.budget_month is null then
    v_missing := array_append(v_missing, 'budget_month');
  end if;
  if coalesce(v_request.amount_requested, 0) <= 0 then
    v_missing := array_append(v_missing, 'amount_requested');
  end if;
  if nullif(btrim(v_request.currency), '') is null then
    v_missing := array_append(v_missing, 'currency');
  end if;

  if public.approval_batch_request_has_any_execution_record(v_request.id) then
    v_classification := 'already_executed';
    v_reason := 'payment_request_already_executed';
  elsif public.approval_batch_request_has_active_extraordinary(v_request.id) then
    v_classification := 'extraordinary';
    v_reason := 'extraordinary_authorization_active';
    v_budget_authorization_source := 'extraordinary';
  elsif public.approval_batch_request_open_elsewhere(
    v_request.id,
    p_exclude_batch_id
  ) then
    v_classification := 'already_in_open_batch';
    v_reason := 'payment_request_in_another_open_batch';
  elsif public.approval_batch_request_has_current_direction_approval(
    v_request.id
  ) then
    v_classification := 'already_authorized';
    v_reason := 'direction_approval_already_current';
  elsif v_latest.director_status = 'rejected'
        and v_latest.rebatch_status = 'blocked' then
    v_classification := 'rejected_by_direction';
    v_reason := 'direction_rejection_requires_correction';
  elsif v_latest.director_status = 'approved'
        and v_latest.batch_status in ('approved', 'partially_approved')
        and coalesce(
          v_latest.decided_at >= v_request.approval_material_updated_at,
          false
        ) then
    v_classification := 'pending_finance_close';
    v_reason := 'finance_close_required';
  elsif lower(v_request.request_type::text) in ('payroll', 'nomina') then
    v_classification := 'invalid_data';
    v_reason := 'payroll_uses_separate_flow';
  elsif cardinality(v_missing) > 0 then
    v_classification := 'invalid_data';
    v_reason := 'minimum_direction_data_missing';
  elsif v_request.status::text not in (
    'submitted',
    'pending_approval',
    'approved'
  ) then
    v_classification := 'invalid_data';
    v_reason := 'request_status_not_batch_eligible';
  else
    v_budget := public.approval_batch_budget_validation(v_request.id);
    v_budget_exception_current :=
      public.payment_request_has_current_approved_budget_exception(v_request);
    if coalesce(v_budget ->> 'status', 'bloqueado') <> 'aprobable'
       and not v_budget_exception_current then
      v_classification := case
        when v_budget ->> 'motivo' in (
          'sin_disponible',
          'partida_no_presupuestada',
          'sin_match_presupuesto'
        ) then 'budget_insufficient'
        else 'budget_validation_required'
      end;
      v_reason := coalesce(
        v_budget ->> 'motivo',
        'budget_validation_required'
      );
    else
      v_classification := 'ready_for_batch';
      v_reason := null;
      v_eligible := true;
      v_budget_authorization_source := case
        when v_budget_exception_current then 'approved_exception'
        else 'live_budget'
      end;
    end if;
  end if;

  if v_budget is null then
    v_budget := public.approval_batch_budget_validation(v_request.id);
  end if;

  return jsonb_build_object(
    'eligible', v_eligible,
    'classification', v_classification,
    'reason', v_reason,
    'origin', v_origin,
    'review_sequence', v_review_sequence,
    'missing_fields', to_jsonb(v_missing),
    'budget_status', v_budget ->> 'status',
    'budget_reason', v_budget ->> 'motivo',
    'budget_available',
      nullif(v_budget ->> 'disponible_actual', '')::numeric,
    'budget_after',
      nullif(v_budget ->> 'disponible_despues', '')::numeric,
    'budget_shortfall',
      nullif(v_budget ->> 'faltante', '')::numeric,
    'budget_authorization_source', v_budget_authorization_source,
    'previous_item_id', v_latest.id,
    'previous_batch_id', v_latest.batch_id,
    'previous_batch_label', v_latest.batch_label,
    'previous_director_status', v_latest.director_status,
    'previous_reject_reason', v_latest.director_reject_reason,
    'previous_correction_note', v_latest.rebatch_release_note,
    'previous_decided_at', v_latest.decided_at
  );
end
$$;

create or replace function public.approval_batch_item_release_block_reason(
  p_item_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.approval_batch_items%rowtype;
  v_request public.payment_requests%rowtype;
  v_budget jsonb;
begin
  select * into v_item
  from public.approval_batch_items
  where id = p_item_id;
  if not found or v_item.removed_at is not null then
    return 'item_not_active';
  end if;
  if v_item.director_status = 'pending' then
    return 'direction_pending';
  end if;
  if v_item.director_status = 'rejected' then
    return 'direction_rejected';
  end if;

  select * into v_request
  from public.payment_requests
  where id = v_item.payment_request_id;
  if not found then
    return 'payment_request_not_found';
  end if;

  v_budget := public.approval_batch_budget_validation(v_request.id);
  if coalesce(v_budget ->> 'status', 'bloqueado') <> 'aprobable'
     and not public.payment_request_has_current_approved_budget_exception(
       v_request
     ) then
    return coalesce(
      v_budget ->> 'motivo',
      'budget_validation_required'
    );
  end if;
  if v_item.decided_at is null
     or v_item.decided_at < v_request.approval_material_updated_at then
    return 'request_data_changed_after_direction_decision';
  end if;
  if exists (
    select 1
    from public.approval_batch_items later
    where later.payment_request_id = v_request.id
      and later.removed_at is null
      and later.id <> v_item.id
      and later.director_status in ('pending', 'rejected')
      and coalesce(later.decided_at, later.created_at) > v_item.decided_at
  ) then
    return 'direction_reapproval_required';
  end if;
  if public.approval_batch_request_has_any_execution_record(v_request.id) then
    return 'payment_request_already_executed';
  end if;
  if public.approval_batch_request_has_active_extraordinary(v_request.id) then
    return 'extraordinary_authorization_active';
  end if;
  return null;
end
$$;

alter function public.approval_batch_item_release_block_reason(uuid)
  owner to postgres;

revoke all on function public.approval_batch_item_release_block_reason(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.approval_batch_item_release_block_reason(uuid)
  to service_role;

create or replace function public.release_and_rebatch_rejected_request(
  p_rejected_item_id uuid,
  p_correction_note text,
  p_target_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_note text := nullif(btrim(coalesce(p_correction_note, '')), '');
  v_item public.approval_batch_items%rowtype;
  v_source_batch public.approval_batches%rowtype;
  v_target_batch public.approval_batches%rowtype;
  v_request public.payment_requests%rowtype;
  v_payment_request_id uuid;
  v_new_item_id uuid;
  v_review_sequence integer;
  v_budget jsonb;
  v_payment_method text;
begin
  v_actor := public.approval_batch_require_finance();
  if v_note is null or char_length(v_note) < 10 then
    raise exception 'rebatch_correction_note_too_short';
  end if;

  select payment_request_id into v_payment_request_id
  from public.approval_batch_items
  where id = p_rejected_item_id;
  if not found then
    raise exception 'rejected_batch_item_not_found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_payment_request_id::text, 21021)
  );

  select * into v_item
  from public.approval_batch_items
  where id = p_rejected_item_id
    and payment_request_id = v_payment_request_id
  for update;
  if not found then
    raise exception 'rejected_batch_item_not_found';
  end if;

  select * into v_source_batch
  from public.approval_batches
  where id = v_item.batch_id
  for update;
  if not found then
    raise exception 'source_batch_not_found';
  end if;

  select * into v_request
  from public.payment_requests
  where id = v_item.payment_request_id
  for update;
  if not found then
    raise exception 'payment_request_not_found';
  end if;

  if v_item.removed_at is not null
     or v_item.director_status <> 'rejected'
     or v_item.rebatch_status <> 'blocked' then
    raise exception 'rejected_batch_item_not_blocked';
  end if;
  if v_source_batch.status not in ('partially_approved', 'closed') then
    raise exception 'source_batch_not_decided';
  end if;
  if public.approval_batch_request_has_any_execution_record(v_request.id) then
    raise exception 'payment_request_already_executed';
  end if;
  if public.approval_batch_request_has_active_extraordinary(v_request.id) then
    raise exception 'extraordinary_request_cannot_be_rebatched';
  end if;
  if public.approval_batch_request_open_elsewhere(
    v_request.id,
    p_target_batch_id
  ) then
    raise exception 'payment_request_in_another_open_batch';
  end if;
  if v_request.status::text not in (
    'submitted',
    'pending_approval',
    'approved'
  ) then
    raise exception 'request_status_not_batch_eligible';
  end if;

  v_payment_method := coalesce(
    nullif(v_request.payment_method, ''),
    case
      when v_request.request_type::text in ('cash', 'check')
        then v_request.request_type::text
      else 'transfer'
    end
  );
  if v_request.company_id is null
     or v_request.requested_by is null
     or (
       v_request.proveedor_id is null
       and v_payment_method = 'transfer'
     )
     or v_request.cost_center_id is null
     or v_request.budget_category_id is null
     or v_request.budget_month is null
     or coalesce(v_request.amount_requested, 0) <= 0
     or nullif(btrim(v_request.currency), '') is null then
    raise exception 'minimum_direction_data_missing';
  end if;

  v_budget := public.approval_batch_budget_validation(v_request.id);
  if coalesce(v_budget ->> 'status', 'bloqueado') <> 'aprobable'
     and not public.payment_request_has_current_approved_budget_exception(
       v_request
     ) then
    raise exception 'budget_revalidation_required:%',
      coalesce(v_budget ->> 'motivo', 'unknown');
  end if;

  select coalesce(max(item.review_sequence), 0) + 1
    into v_review_sequence
  from public.approval_batch_items item
  where item.payment_request_id = v_request.id
    and item.removed_at is null;

  if p_target_batch_id is not null then
    select * into v_target_batch
    from public.approval_batches
    where id = p_target_batch_id
    for update;
    if not found then
      raise exception 'target_batch_not_found';
    end if;
    if v_target_batch.status <> 'draft' then
      raise exception 'target_batch_must_be_draft';
    end if;
    if v_target_batch.company_id <> v_request.company_id then
      raise exception 'target_batch_company_mismatch';
    end if;
    if exists (
      select 1
      from public.approval_batch_items item
      where item.batch_id = p_target_batch_id
        and item.payment_request_id = v_request.id
        and item.removed_at is null
    ) then
      raise exception 'payment_request_already_in_target_batch';
    end if;

    insert into public.approval_batch_items(
      batch_id,
      payment_request_id,
      finance_reviewed_by,
      finance_reviewed_at,
      previous_item_id,
      review_sequence,
      resubmitted_at,
      resubmitted_by,
      resubmission_note
    ) values (
      p_target_batch_id,
      v_request.id,
      v_actor,
      now(),
      v_item.id,
      v_review_sequence,
      now(),
      v_actor,
      v_note
    )
    returning id into v_new_item_id;
  end if;

  update public.approval_batch_items
  set rebatch_status = 'released',
      rebatch_released_by = v_actor,
      rebatch_released_at = now(),
      rebatch_release_note = v_note
  where id = v_item.id;

  return jsonb_build_object(
    'rejected_item_id', v_item.id,
    'payment_request_id', v_request.id,
    'rebatch_status', 'released',
    'target_batch_id', p_target_batch_id,
    'new_item_id', v_new_item_id,
    'review_sequence', v_review_sequence,
    'correction_note', v_note,
    'status',
      case
        when v_new_item_id is null then 'resubmission_available'
        else 'rebatched_pending'
      end
  );
end
$$;

alter function public.release_and_rebatch_rejected_request(uuid,text,uuid)
  owner to postgres;

revoke all on function public.release_and_rebatch_rejected_request(
  uuid,text,uuid
) from public, anon, authenticated, service_role;

grant execute on function public.release_and_rebatch_rejected_request(
  uuid,text,uuid
) to authenticated, service_role;

create or replace function public.preview_payment_layout_eligibility_pre_037(
  p_period_start date,
  p_period_end date,
  p_company_id uuid default null,
  p_company_bank_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.approval_batch_require_finance();
  if p_period_start is null or p_period_end is null then
    raise exception 'period_dates_required';
  end if;
  if p_period_start > p_period_end then
    raise exception 'invalid_period_range';
  end if;
  if p_company_id is not null and not exists (
    select 1 from public.companies where id = p_company_id
  ) then
    raise exception 'company_not_found';
  end if;
  if p_company_bank_account_id is not null and not exists (
    select 1
    from public.company_bank_accounts
    where id = p_company_bank_account_id
      and coalesce(active, true)
      and (p_company_id is null or company_id = p_company_id)
  ) then
    raise exception 'company_bank_account_not_found_or_inactive';
  end if;

  with candidates as (
    select
      candidate.*,
      case
        when candidate.classification = 'ready_extraordinary'
          and candidate.extraordinary_authorization_id is not null
          and coalesce(
            candidate.extraordinary_authorized_at
              >= request.approval_material_updated_at,
            false
          )
          then 'extraordinary'
        when candidate.extraordinary_authorization_id is not null
          then null
        when public.payment_request_has_current_approved_budget_exception(request)
          then 'approved_exception'
        when coalesce(
          public.approval_batch_budget_validation(request.id) ->> 'status',
          'bloqueado'
        ) = 'aprobable'
          then 'live_budget'
        else null
      end as budget_authorization_source
    from public.approval_batch_payment_layout_candidates(
      p_period_start,
      p_period_end,
      p_company_id,
      p_company_bank_account_id
    ) candidate
    join public.payment_requests request
      on request.id = candidate.payment_request_id
  ), rejected_history as (
    select jsonb_build_object(
      'source_item_id', rejected.id,
      'payment_request_id', pr.id,
      'request_number', pr.request_number,
      'company_id', pr.company_id,
      'company_name', coalesce(nullif(btrim(c.legal_name), ''), c.name),
      'proveedor_id', pr.proveedor_id,
      'provider_name', coalesce(nullif(btrim(p.alias), ''), p.nombre_completo),
      'cost_center', coalesce(nullif(btrim(cc.code), '') || ' - ', '') || cc.name,
      'budget_category', coalesce(nullif(btrim(bc.code), '') || ' - ', '') || bc.name,
      'payment_method', coalesce(
        nullif(pr.payment_method, ''),
        case
          when pr.request_type::text in ('cash', 'check')
            then pr.request_type::text
          else 'transfer'
        end
      ),
      'amount', pr.amount_requested,
      'currency', pr.currency,
      'source_batch_id', source_batch.id,
      'source_batch_label', source_batch.label,
      'source_batch_status', source_batch.status,
      'director_status', rejected.director_status,
      'reject_reason', rejected.director_reject_reason,
      'rejected_by', rejected.decided_by,
      'rejected_by_name', director.full_name,
      'rejected_at', rejected.decided_at,
      'rebatch_status', rejected.rebatch_status,
      'latest_correction_note', rejected.rebatch_release_note,
      'rebatch_released_at', rejected.rebatch_released_at,
      'rebatch_released_by_name', releaser.full_name,
      'review_sequence', rejected.review_sequence,
      'target_item_id', target.id,
      'target_batch_id', target_batch.id,
      'target_batch_label', target_batch.label,
      'target_batch_status', target_batch.status,
      'target_review_sequence', target.review_sequence
    ) as payload,
    rejected.decided_at,
    pr.request_number,
    rejected.review_sequence
    from public.approval_batch_items rejected
    join public.approval_batches source_batch
      on source_batch.id = rejected.batch_id
    join public.payment_requests pr
      on pr.id = rejected.payment_request_id
    join public.companies c on c.id = pr.company_id
    left join public.proveedores p on p.id = pr.proveedor_id
    left join public.cost_centers cc on cc.id = pr.cost_center_id
    left join public.budget_categories bc on bc.id = pr.budget_category_id
    left join public.profiles director on director.id = rejected.decided_by
    left join public.profiles releaser
      on releaser.id = rejected.rebatch_released_by
    left join public.approval_batch_items target
      on target.previous_item_id = rejected.id
    left join public.approval_batches target_batch
      on target_batch.id = target.batch_id
    where rejected.removed_at is null
      and rejected.director_status = 'rejected'
      and coalesce(pr.scheduled_payment_date, pr.created_at::date)
        between p_period_start and p_period_end
      and (p_company_id is null or pr.company_id = p_company_id)
      and (
        p_company_bank_account_id is null
        or pr.company_bank_account_id = p_company_bank_account_id
        or pr.company_bank_account_id is null
      )
  ), totals as (
    select classification, currency, count(*) as payment_count, sum(amount) as amount
    from candidates
    where classification in (
      'ready_regular',
      'ready_extraordinary',
      'legacy_eligible'
    )
    group by classification, currency
  )
  select jsonb_build_object(
    'ready_regular', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'ready_regular'), '[]'::jsonb),
    'ready_extraordinary', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'ready_extraordinary'), '[]'::jsonb),
    'rejected_by_direction', coalesce((select jsonb_agg(r.payload order by r.decided_at desc nulls last, r.request_number, r.review_sequence desc) from rejected_history r), '[]'::jsonb),
    'pending_director', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'pending_director'), '[]'::jsonb),
    'direction_reapproval_required', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'direction_reapproval_required'), '[]'::jsonb),
    'pending_finance_close', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'pending_finance_close'), '[]'::jsonb),
    'legacy_eligible', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'legacy_eligible'), '[]'::jsonb),
    'invalid_data', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'invalid_data'), '[]'::jsonb),
    'already_executed', coalesce((select jsonb_agg(to_jsonb(c) - 'source_account_number' - 'destination_value' order by c.request_number) from candidates c where c.classification = 'already_executed'), '[]'::jsonb),
    'totals_by_currency', coalesce((select jsonb_agg(jsonb_build_object('classification', t.classification, 'currency', t.currency, 'payment_count', t.payment_count, 'amount', t.amount) order by t.currency, t.classification) from totals t), '[]'::jsonb)
  ) into v_result;

  return v_result;
end
$$;

do $postcheck$
declare
  v_reference_oid oid := to_regprocedure(
    'public.payment_layout_reference_issue(text,text)'
  );
  v_helper_oid oid := to_regprocedure(
    'public.payment_request_has_current_approved_budget_exception(public.payment_requests)'
  );
  v_missing_oid oid := to_regprocedure(
    'public.payment_request_layout_missing_fields(public.payment_requests)'
  );
  v_completion_oid oid := to_regprocedure(
    'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)'
  );
  v_candidate_oid oid := to_regprocedure(
    'public.approval_batch_payment_layout_candidates_pre_037(date,date,uuid,uuid)'
  );
  v_batch_eligibility_oid oid := to_regprocedure(
    'public.approval_batch_request_eligibility(uuid,uuid)'
  );
  v_release_block_oid oid := to_regprocedure(
    'public.approval_batch_item_release_block_reason(uuid)'
  );
  v_rebatch_oid oid := to_regprocedure(
    'public.release_and_rebatch_rejected_request(uuid,text,uuid)'
  );
  v_preview_oid oid := to_regprocedure(
    'public.preview_payment_layout_eligibility_pre_037(date,date,uuid,uuid)'
  );
  v_index_oid oid := to_regclass(
    'public.payment_request_approvals_request_latest_idx'
  );
begin
  if v_reference_oid is null
     or v_helper_oid is null
     or v_missing_oid is null
     or v_completion_oid is null
     or v_candidate_oid is null
     or v_batch_eligibility_oid is null
     or v_release_block_oid is null
     or v_rebatch_oid is null
     or v_preview_oid is null
     or v_index_oid is null then
    raise exception 'layout_budget_exception_postcheck: required function missing';
  end if;

  if exists (
    select 1
    from (values
      (
        v_reference_oid,
        false,
        'i',
        '{postgres=X/postgres,service_role=X/postgres}'
      ),
      (
        v_helper_oid,
        true,
        's',
        '{postgres=X/postgres,service_role=X/postgres}'
      ),
      (
        v_missing_oid,
        true,
        's',
        '{postgres=X/postgres,service_role=X/postgres}'
      ),
      (
        v_completion_oid,
        true,
        'v',
        '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
      ),
      (
        v_candidate_oid,
        true,
        's',
        '{postgres=X/postgres,service_role=X/postgres}'
      ),
      (
        v_batch_eligibility_oid,
        true,
        's',
        '{postgres=X/postgres,service_role=X/postgres}'
      ),
      (
        v_release_block_oid,
        true,
        's',
        '{postgres=X/postgres,service_role=X/postgres}'
      ),
      (
        v_rebatch_oid,
        true,
        'v',
        '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
      ),
      (
        v_preview_oid,
        true,
        'v',
        '{postgres=X/postgres,service_role=X/postgres}'
      )
    ) expected(
      function_oid,
      security_definer,
      volatility,
      acl
    )
    join pg_proc function_row
      on function_row.oid = expected.function_oid
    join pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    join pg_roles owner_row
      on owner_row.oid = function_row.proowner
    where namespace_row.nspname <> 'public'
       or owner_row.rolname <> 'postgres'
       or function_row.prosecdef is distinct from expected.security_definer
       or function_row.provolatile::text <> expected.volatility
       or function_row.proconfig
          is distinct from array['search_path=public, pg_temp']::text[]
       or coalesce(function_row.proacl::text, '') <> expected.acl
  ) then
    raise exception
      'layout_budget_exception_postcheck: function properties or ACL mismatch';
  end if;

  if position(
       'budget_exception_current'
       in pg_get_functiondef(v_candidate_oid)
     ) = 0
     or position(
       'payment_reference_invalid'
       in pg_get_functiondef(v_candidate_oid)
     ) = 0
     or position(
       'payment_layout_reference_issue'
       in pg_get_functiondef(v_missing_oid)
     ) = 0
     or position(
       'payment_reference_cie_invalid'
       in pg_get_functiondef(v_completion_oid)
     ) = 0
     or position(
       'budget_authorization_source'
       in pg_get_functiondef(v_batch_eligibility_oid)
     ) = 0
     or position(
       'payment_request_has_current_approved_budget_exception'
       in pg_get_functiondef(v_release_block_oid)
     ) = 0
     or position(
       'payment_request_has_current_approved_budget_exception'
       in pg_get_functiondef(v_rebatch_oid)
     ) = 0
     or position(
       'budget_authorization_source'
       in pg_get_functiondef(v_preview_oid)
     ) = 0 then
    raise exception 'layout_budget_exception_postcheck: expected contract marker missing';
  end if;

  if not exists (
    select 1
    from pg_index index_row
    where index_row.indexrelid = v_index_oid
      and index_row.indisvalid
      and index_row.indisready
      and position(
        '(payment_request_id, created_at DESC, id DESC)'
        in pg_get_indexdef(index_row.indexrelid)
      ) > 0
      and position(
        'INCLUDE (action, to_status, actor_profile_id, role_id, budget_decision_snapshot, budget_block_reason_snapshot)'
        in pg_get_indexdef(index_row.indexrelid)
      ) > 0
  ) then
    raise exception
      'layout_budget_exception_postcheck: supporting index mismatch';
  end if;
end
$postcheck$;

commit;
