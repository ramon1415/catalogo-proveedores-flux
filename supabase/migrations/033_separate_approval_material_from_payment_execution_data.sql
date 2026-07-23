-- Separate Direction approval materiality from payment-execution data.
-- Forward-only hotfix. It deliberately performs no historical reconciliation.

begin;

do $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
  v_column text;
  v_stale_count bigint := 0;
begin
  foreach v_name in array array[
    'activity_log', 'approval_batches', 'approval_batch_company_settings',
    'approval_batch_items', 'companies', 'company_bank_accounts',
    'company_directors', 'payable_snapshots', 'payment_layout_lines',
    'payment_receipts', 'payment_requests', 'profile_company_memberships',
    'profiles', 'proveedores', 'proveedor_provider_links',
    'provider_bank_accounts', 'roles', 'user_roles'
  ] loop
    if to_regclass('public.' || v_name) is null then
      v_missing := array_append(v_missing, 'public.' || v_name);
    end if;
  end loop;

  foreach v_column in array array[
    'approval_material_updated_at', 'company_id', 'requested_by',
    'proveedor_id', 'provider_id', 'provider_bank_account_id',
    'cost_center_id', 'budget_category_id', 'budget_month',
    'amount_requested', 'currency', 'exchange_rate', 'request_type',
    'payment_method', 'is_extraordinary_adjustment', 'concept',
    'description', 'company_bank_account_id', 'due_date',
    'scheduled_payment_date', 'payment_reference', 'payment_concept',
    'scheduled_by', 'scheduled_at', 'created_at', 'updated_at', 'status'
  ] loop
    if not exists (
      select 1
      from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = 'payment_requests'
        and column_info.column_name = v_column
    ) then
      v_missing := array_append(v_missing, 'payment_requests.' || v_column);
    end if;
  end loop;

  foreach v_column in array array[
    'activo', 'alias', 'banco', 'beneficiary_name', 'clabe',
    'convenio_number', 'cuenta_bancaria', 'destination_type',
    'nombre_completo'
  ] loop
    if not exists (
      select 1
      from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = 'proveedores'
        and column_info.column_name = v_column
    ) then
      v_missing := array_append(v_missing, 'proveedores.' || v_column);
    end if;
  end loop;

  foreach v_column in array array[
    'company_id', 'account_number', 'active'
  ] loop
    if not exists (
      select 1
      from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = 'company_bank_accounts'
        and column_info.column_name = v_column
    ) then
      v_missing := array_append(v_missing, 'company_bank_accounts.' || v_column);
    end if;
  end loop;

  foreach v_column in array array[
    'profile_id', 'company_id', 'active'
  ] loop
    if not exists (
      select 1
      from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = 'profile_company_memberships'
        and column_info.column_name = v_column
    ) then
      v_missing := array_append(
        v_missing,
        'profile_company_memberships.' || v_column
      );
    end if;
  end loop;

  foreach v_column in array array[
    'entity_type', 'entity_id', 'action', 'old_values', 'new_values',
    'performed_by', 'performed_at', 'notes'
  ] loop
    if not exists (
      select 1
      from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = 'activity_log'
        and column_info.column_name = v_column
    ) then
      v_missing := array_append(v_missing, 'activity_log.' || v_column);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception '033_precheck: missing required objects: %',
      array_to_string(v_missing, ', ');
  end if;

  if to_regprocedure('public.approval_batch_require_finance()') is null
     or to_regprocedure('public.approval_batch_request_has_any_execution_record(uuid)') is null
     or to_regprocedure('public.approval_batch_request_has_current_direction_approval(uuid)') is null
     or to_regprocedure('public.approval_batch_direction_roles()') is null
     or to_regprocedure('public.get_payment_request_execution_readiness(uuid)') is null
     or to_regprocedure('public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)') is null
     or to_regprocedure('public.preview_payment_layout_eligibility(date,date,uuid,uuid)') is null
     or to_regprocedure('public.complete_payment_request_layout_data(uuid,uuid,text,text,date)') is null
     or to_regprocedure('public.list_company_directors(uuid)') is null
     or to_regprocedure('public.list_approval_batch_director_candidates(uuid)') is null then
    raise exception '033_precheck: migrations 021/022/023/028/032 are not installed completely';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_info
    join pg_class relation_info on relation_info.oid = trigger_info.tgrelid
    join pg_namespace namespace_info on namespace_info.oid = relation_info.relnamespace
    join pg_proc function_info on function_info.oid = trigger_info.tgfoid
    where namespace_info.nspname = 'public'
      and relation_info.relname = 'payment_requests'
      and trigger_info.tgname = 'mark_payment_request_material_change'
      and function_info.proname = 'mark_payment_request_material_change'
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled <> 'D'
      and trigger_info.tgtype = 23
      and cardinality(trigger_info.tgattr::smallint[]) = 0
  ) or not exists (
    select 1
    from pg_trigger trigger_info
    join pg_class relation_info on relation_info.oid = trigger_info.tgrelid
    join pg_namespace namespace_info on namespace_info.oid = relation_info.relnamespace
    join pg_proc function_info on function_info.oid = trigger_info.tgfoid
    where namespace_info.nspname = 'public'
      and relation_info.relname = 'proveedores'
      and trigger_info.tgname = 'mark_provider_payment_material_change'
      and function_info.proname = 'mark_provider_payment_material_change'
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled <> 'D'
      and trigger_info.tgtype = 17
      and (
        select array_agg(
          attribute_info.attname::text
          order by attribute_info.attname::text
        )
        from unnest(trigger_info.tgattr::smallint[]) trigger_column(attnum)
        join pg_attribute attribute_info
          on attribute_info.attrelid = relation_info.oid
         and attribute_info.attnum = trigger_column.attnum
      ) = array[
        'banco', 'beneficiary_name', 'clabe', 'convenio_number',
        'cuenta_bancaria', 'destination_type'
      ]::text[]
  ) then
    raise exception '033_precheck: material-change triggers are missing, disabled or drifted';
  end if;

  if not exists (
    select 1
    from pg_proc function_info
    where function_info.oid =
      'public.mark_payment_request_material_change()'::regprocedure
      and position(
        'old.provider_bank_account_id',
        lower(function_info.prosrc)
      ) > 0
      and position(
        'old.company_bank_account_id',
        lower(function_info.prosrc)
      ) > 0
      and position('old.due_date', lower(function_info.prosrc)) > 0
      and position(
        'old.scheduled_payment_date',
        lower(function_info.prosrc)
      ) > 0
      and position('old.payment_reference', lower(function_info.prosrc)) > 0
      and position('old.payment_concept', lower(function_info.prosrc)) > 0
  ) or not exists (
    select 1
    from pg_proc function_info
    where function_info.oid =
      'public.mark_provider_payment_material_change()'::regprocedure
      and position(
        'update public.payment_requests',
        lower(function_info.prosrc)
      ) > 0
      and position(
        'approval_material_updated_at',
        lower(function_info.prosrc)
      ) > 0
  ) or not exists (
    select 1
    from pg_proc function_info
    where function_info.oid =
      'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)'::regprocedure
      and position(
        'approval_batch_require_finance',
        lower(function_info.prosrc)
      ) > 0
      and position(
        'update public.payment_requests',
        lower(function_info.prosrc)
      ) > 0
      and position(
        'direction_reapproval_required',
        lower(function_info.prosrc)
      ) > 0
  ) or not exists (
    select 1
    from pg_proc function_info
    where function_info.oid =
      'public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)'::regprocedure
      and position(
        'direction_reapproval_required',
        lower(function_info.prosrc)
      ) > 0
      and position('ready_regular', lower(function_info.prosrc)) > 0
      and position('legacy_eligible', lower(function_info.prosrc)) > 0
  ) then
    raise exception '033_precheck: function definitions drift from the expected 022/023 baseline';
  end if;

  if exists (
    select 1
    from public.company_directors director_assignment
    where director_assignment.active
    group by director_assignment.company_id
    having count(*) > 1
  ) then
    raise exception '033_precheck: multiple active Directors exist for at least one company';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception '033_precheck: required Supabase roles are missing';
  end if;

  select count(*)
    into v_stale_count
  from public.payment_requests payment_request
  where exists (
    select 1
    from public.approval_batch_items batch_item
    join public.approval_batches approval_batch on approval_batch.id = batch_item.batch_id
    where batch_item.payment_request_id = payment_request.id
      and batch_item.removed_at is null
      and batch_item.director_status = 'approved'
      and batch_item.decided_at is not null
      and batch_item.decided_at < payment_request.approval_material_updated_at
      and approval_batch.status = 'closed'
  );

  raise notice
    '033_precheck: % requests have a stale closed Direction decision; no historical rows will be reconciled',
    v_stale_count;
end
$$;

create or replace function public.provider_payment_execution_missing_fields(
  p_provider public.proveedores
)
returns text[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_destination_type text := lower(nullif(btrim(p_provider.destination_type), ''));
  v_clabe_normalized text := regexp_replace(
    coalesce(p_provider.clabe, ''),
    '[[:space:]-]',
    '',
    'g'
  );
  v_account_normalized text := regexp_replace(
    coalesce(p_provider.cuenta_bancaria, ''),
    '[[:space:]-]',
    '',
    'g'
  );
  v_beneficiary text := coalesce(
    nullif(btrim(p_provider.beneficiary_name), ''),
    nullif(btrim(p_provider.nombre_completo), ''),
    nullif(btrim(p_provider.alias), '')
  );
begin
  return array_remove(array[
    case
      when v_beneficiary is null then 'beneficiary_name'
    end,
    case
      when v_beneficiary is not null
        and (
          char_length(v_beneficiary) > 180
          or v_beneficiary ~ '[[:cntrl:]]'
        )
        then 'beneficiary_name_invalid'
    end,
    case when nullif(btrim(p_provider.banco), '') is null then 'banco' end,
    case
      when nullif(btrim(p_provider.banco), '') is not null
        and (
          char_length(btrim(p_provider.banco)) > 100
          or p_provider.banco ~ '[[:cntrl:]]'
        )
        then 'banco_invalid'
    end,
    case when v_destination_type is null then 'destination_type' end,
    case
      when v_destination_type is not null
        and v_destination_type not in ('clabe', 'cuenta', 'convenio')
        then 'destination_type_invalid'
    end,
    case
      when v_destination_type = 'clabe'
        and nullif(btrim(p_provider.clabe), '') is null
        then 'clabe'
    end,
    case
      when v_destination_type = 'clabe'
        and nullif(btrim(p_provider.clabe), '') is not null
        and v_clabe_normalized !~ '^[0-9]{18}$'
        then 'clabe_invalid'
    end,
    case
      when v_destination_type = 'cuenta'
        and nullif(btrim(p_provider.cuenta_bancaria), '') is null
        then 'cuenta_bancaria'
    end,
    case
      when v_destination_type = 'cuenta'
        and nullif(btrim(p_provider.cuenta_bancaria), '') is not null
        and v_account_normalized !~ '^[0-9]{1,18}$'
        then 'cuenta_bancaria_invalid'
    end,
    case
      when v_destination_type = 'convenio'
        and nullif(btrim(p_provider.convenio_number), '') is null
        then 'convenio_number'
    end,
    case
      when v_destination_type = 'convenio'
        and nullif(btrim(p_provider.convenio_number), '') is not null
        and (
          char_length(btrim(p_provider.convenio_number)) > 30
          or p_provider.convenio_number ~ '[[:cntrl:]]'
        )
        then 'convenio_number_invalid'
    end
  ]::text[], null);
end
$$;

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
  v_missing text[];
begin
  if p_request.company_id is not null then
    select *
      into v_company
    from public.companies company
    where company.id = p_request.company_id;
    v_company_found := found;
  end if;

  if p_request.company_bank_account_id is not null then
    select *
      into v_company_account
    from public.company_bank_accounts company_account
    where company_account.id = p_request.company_bank_account_id;
    v_company_account_found := found;
  end if;

  if p_request.proveedor_id is not null then
    select *
      into v_provider
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

  v_missing := array_remove(array[
    case when p_request.scheduled_payment_date is null then 'scheduled_payment_date' end,
    case when p_request.company_id is null then 'company_id' end,
    case when p_request.company_id is not null and not v_company_found then 'company_not_found' end,
    case
      when v_company_found and not coalesce(v_company.active, false)
        then 'company_inactive'
    end,
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
    case
      when nullif(btrim(p_request.payment_reference), '') is null
        then 'payment_reference'
    end,
    case
      when nullif(btrim(p_request.payment_reference), '') is not null
        and btrim(p_request.payment_reference) !~ '^[0-9]{1,5}$'
        then 'payment_reference_invalid'
    end,
    case
      when v_payment_concept is null
        then 'payment_concept'
    end,
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

create or replace function public.mark_payment_request_material_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.approval_material_updated_at := clock_timestamp();
    return new;
  end if;

  if row(
    old.company_id,
    old.requested_by,
    old.proveedor_id,
    old.provider_id,
    old.cost_center_id,
    old.budget_category_id,
    old.budget_month,
    old.amount_requested,
    old.currency,
    old.exchange_rate,
    old.request_type,
    old.payment_method,
    old.is_extraordinary_adjustment,
    old.concept,
    old.description
  ) is distinct from row(
    new.company_id,
    new.requested_by,
    new.proveedor_id,
    new.provider_id,
    new.cost_center_id,
    new.budget_category_id,
    new.budget_month,
    new.amount_requested,
    new.currency,
    new.exchange_rate,
    new.request_type,
    new.payment_method,
    new.is_extraordinary_adjustment,
    new.concept,
    new.description
  ) then
    new.approval_material_updated_at := clock_timestamp();
  else
    new.approval_material_updated_at := old.approval_material_updated_at;
  end if;

  return new;
end
$$;

comment on function public.mark_payment_request_material_change() is
  'Advances approval materiality only for the economic/request identity approved by Direction; payment-execution fields preserve the prior timestamp.';

create function public.guard_payment_request_execution_data_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if row(
    old.provider_bank_account_id,
    old.company_bank_account_id,
    old.due_date,
    old.scheduled_payment_date,
    old.payment_reference,
    old.payment_concept
  ) is not distinct from row(
    new.provider_bank_account_id,
    new.company_bank_account_id,
    new.due_date,
    new.scheduled_payment_date,
    new.payment_reference,
    new.payment_concept
  ) then
    return new;
  end if;

  perform public.approval_batch_require_finance();

  if current_setting('flux.payment_execution_rpc', true)
       is distinct from new.id::text then
    raise exception 'payment_execution_rpc_required';
  end if;

  if new.company_bank_account_id is not null and not exists (
    select 1
    from public.company_bank_accounts company_account
    where company_account.id = new.company_bank_account_id
      and company_account.company_id = new.company_id
      and coalesce(company_account.active, false)
      and nullif(btrim(company_account.account_number), '') is not null
  ) then
    raise exception 'company_bank_account_not_found_inactive_or_company_mismatch';
  end if;

  if new.provider_bank_account_id is not null and not exists (
    select 1
    from public.provider_bank_accounts provider_account
    where provider_account.id = new.provider_bank_account_id
      and (
        (
          new.provider_id is not null
          and provider_account.provider_id = new.provider_id
        )
        or (
          new.proveedor_id is not null
          and exists (
            select 1
            from public.proveedor_provider_links provider_link
            where provider_link.provider_id = provider_account.provider_id
              and provider_link.proveedor_id = new.proveedor_id
          )
        )
      )
  ) then
    raise exception 'provider_bank_account_provider_mismatch';
  end if;

  if new.payment_reference is not null
     and nullif(btrim(new.payment_reference), '') is not null
     and btrim(new.payment_reference) !~ '^[0-9]+$' then
    raise exception 'payment_reference_must_be_numeric';
  end if;

  if new.payment_reference is not null
     and char_length(btrim(new.payment_reference)) > 5 then
    raise exception 'payment_reference_too_long';
  end if;

  if new.payment_concept is not null
     and char_length(btrim(new.payment_concept)) > 120 then
    raise exception 'payment_concept_too_long';
  end if;

  if new.payment_concept is not null
     and new.payment_concept ~ '[[:cntrl:]]' then
    raise exception 'payment_concept_invalid_characters';
  end if;

  return new;
end
$$;

create trigger guard_payment_request_execution_data_update
  before update of provider_bank_account_id, company_bank_account_id, due_date,
    scheduled_payment_date, payment_reference, payment_concept
  on public.payment_requests
  for each row execute function public.guard_payment_request_execution_data_update();

create function public.audit_payment_request_execution_data_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_changed_fields text[];
  v_completed_fields text[];
  v_missing_before text[];
  v_missing_after text[];
  v_now timestamptz := clock_timestamp();
begin
  v_changed_fields := array_remove(array[
    case
      when old.provider_bank_account_id is distinct from new.provider_bank_account_id
        then 'provider_bank_account_id'
    end,
    case
      when old.company_bank_account_id is distinct from new.company_bank_account_id
        then 'company_bank_account_id'
    end,
    case when old.due_date is distinct from new.due_date then 'due_date' end,
    case
      when old.scheduled_payment_date is distinct from new.scheduled_payment_date
        then 'scheduled_payment_date'
    end,
    case
      when old.payment_reference is distinct from new.payment_reference
        then 'payment_reference'
    end,
    case
      when old.payment_concept is distinct from new.payment_concept
        then 'payment_concept'
    end
  ]::text[], null);

  if cardinality(v_changed_fields) = 0 then
    return new;
  end if;

  v_actor := public.approval_batch_require_finance();
  v_missing_before := public.payment_request_layout_missing_fields(old);
  v_missing_after := public.payment_request_layout_missing_fields(new);

  select coalesce(
    array_agg(completed_field.field_name order by completed_field.field_name),
    array[]::text[]
  )
    into v_completed_fields
  from unnest(v_missing_before) as completed_field(field_name)
  where not (completed_field.field_name = any(v_missing_after));

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
    'payment_request',
    new.id,
    'payment_execution_data_updated',
    jsonb_build_object(
      'layout_data_complete', cardinality(v_missing_before) = 0,
      'missing_fields', to_jsonb(v_missing_before)
    ),
    jsonb_build_object(
      'changed_fields', to_jsonb(v_changed_fields),
      'completed_fields', to_jsonb(v_completed_fields),
      'layout_data_complete', cardinality(v_missing_after) = 0,
      'missing_fields', to_jsonb(v_missing_after)
    ),
    v_actor,
    v_now,
    'Operational execution-data audit; field values intentionally omitted.'
  );

  return new;
end
$$;

create trigger audit_payment_request_execution_data_update
  after update of provider_bank_account_id, company_bank_account_id, due_date,
    scheduled_payment_date, payment_reference, payment_concept
  on public.payment_requests
  for each row execute function public.audit_payment_request_execution_data_update();

create or replace function public.mark_provider_payment_material_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_changed_fields text[];
  v_completed_fields text[];
  v_missing_before text[];
  v_missing_after text[];
  v_now timestamptz := clock_timestamp();
begin
  v_changed_fields := array_remove(array[
    case when old.destination_type is distinct from new.destination_type then 'destination_type' end,
    case when old.clabe is distinct from new.clabe then 'clabe' end,
    case when old.cuenta_bancaria is distinct from new.cuenta_bancaria then 'cuenta_bancaria' end,
    case when old.convenio_number is distinct from new.convenio_number then 'convenio_number' end,
    case when old.beneficiary_name is distinct from new.beneficiary_name then 'beneficiary_name' end,
    case when old.banco is distinct from new.banco then 'banco' end
  ]::text[], null);

  if cardinality(v_changed_fields) = 0 then
    return new;
  end if;

  v_actor := public.approval_batch_require_finance();

  if current_setting('flux.provider_payment_execution_rpc', true)
       is distinct from new.id::text then
    raise exception 'provider_payment_execution_rpc_required';
  end if;

  v_missing_before := public.provider_payment_execution_missing_fields(old);
  v_missing_after := public.provider_payment_execution_missing_fields(new);

  if 'destination_type_invalid' = any(v_missing_after)
     or 'clabe_invalid' = any(v_missing_after)
     or 'cuenta_bancaria_invalid' = any(v_missing_after)
     or 'convenio_number_invalid' = any(v_missing_after)
     or 'beneficiary_name_invalid' = any(v_missing_after)
     or 'banco_invalid' = any(v_missing_after) then
    raise exception 'provider_payment_execution_data_invalid';
  end if;

  select coalesce(
    array_agg(completed_field.field_name order by completed_field.field_name),
    array[]::text[]
  )
    into v_completed_fields
  from unnest(v_missing_before) as completed_field(field_name)
  where not (completed_field.field_name = any(v_missing_after));

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
    'proveedor',
    new.id,
    'payment_execution_data_updated',
    jsonb_build_object(
      'layout_data_complete', cardinality(v_missing_before) = 0,
      'missing_fields', to_jsonb(v_missing_before)
    ),
    jsonb_build_object(
      'changed_fields', to_jsonb(v_changed_fields),
      'completed_fields', to_jsonb(v_completed_fields),
      'layout_data_complete', cardinality(v_missing_after) = 0,
      'missing_fields', to_jsonb(v_missing_after)
    ),
    v_actor,
    v_now,
    'Provider payment-execution audit; banking values intentionally omitted.'
  );

  return new;
end
$$;

comment on function public.mark_provider_payment_material_change() is
  'Validates and audits provider execution data without advancing payment-request approval materiality.';

create function public.complete_provider_payment_execution_data(
  p_proveedor_id uuid,
  p_destination_type text default null,
  p_clabe text default null,
  p_cuenta_bancaria text default null,
  p_convenio_number text default null,
  p_beneficiary_name text default null,
  p_banco text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_provider_before public.proveedores%rowtype;
  v_provider_after public.proveedores%rowtype;
  v_destination_type text;
  v_clabe text;
  v_cuenta_bancaria text;
  v_convenio_number text;
  v_beneficiary_name text;
  v_banco text;
  v_changed_fields text[];
  v_completed_fields text[];
  v_missing_before text[];
  v_missing_after text[];
begin
  if p_proveedor_id is null then
    raise exception 'proveedor_required';
  end if;

  v_actor := public.approval_batch_require_finance();
  perform pg_advisory_xact_lock(
    hashtextextended(p_proveedor_id::text, 21034)
  );

  select *
    into v_provider_before
  from public.proveedores provider
  where provider.id = p_proveedor_id
  for update;

  if not found or not coalesce(v_provider_before.activo, false) then
    raise exception 'proveedor_not_found_or_inactive';
  end if;

  v_destination_type := coalesce(
    lower(nullif(btrim(p_destination_type), '')),
    lower(nullif(btrim(v_provider_before.destination_type), ''))
  );
  v_clabe := coalesce(
    nullif(
      regexp_replace(coalesce(p_clabe, ''), '[[:space:]-]', '', 'g'),
      ''
    ),
    v_provider_before.clabe
  );
  v_cuenta_bancaria := coalesce(
    nullif(
      regexp_replace(
        coalesce(p_cuenta_bancaria, ''),
        '[[:space:]-]',
        '',
        'g'
      ),
      ''
    ),
    v_provider_before.cuenta_bancaria
  );
  v_convenio_number := coalesce(
    nullif(btrim(p_convenio_number), ''),
    v_provider_before.convenio_number
  );
  v_beneficiary_name := coalesce(
    nullif(btrim(p_beneficiary_name), ''),
    v_provider_before.beneficiary_name
  );
  v_banco := coalesce(
    nullif(btrim(p_banco), ''),
    v_provider_before.banco
  );

  v_missing_before :=
    public.provider_payment_execution_missing_fields(v_provider_before);
  v_changed_fields := array_remove(array[
    case
      when v_provider_before.destination_type is distinct from v_destination_type
        then 'destination_type'
    end,
    case when v_provider_before.clabe is distinct from v_clabe then 'clabe' end,
    case
      when v_provider_before.cuenta_bancaria is distinct from v_cuenta_bancaria
        then 'cuenta_bancaria'
    end,
    case
      when v_provider_before.convenio_number is distinct from v_convenio_number
        then 'convenio_number'
    end,
    case
      when v_provider_before.beneficiary_name is distinct from v_beneficiary_name
        then 'beneficiary_name'
    end,
    case when v_provider_before.banco is distinct from v_banco then 'banco' end
  ]::text[], null);

  perform set_config(
    'flux.provider_payment_execution_rpc',
    v_provider_before.id::text,
    true
  );

  update public.proveedores provider
  set destination_type = v_destination_type,
      clabe = v_clabe,
      cuenta_bancaria = v_cuenta_bancaria,
      convenio_number = v_convenio_number,
      beneficiary_name = v_beneficiary_name,
      banco = v_banco
  where provider.id = v_provider_before.id;

  select *
    into v_provider_after
  from public.proveedores provider
  where provider.id = v_provider_before.id;

  v_missing_after :=
    public.provider_payment_execution_missing_fields(v_provider_after);

  select coalesce(
    array_agg(completed_field.field_name order by completed_field.field_name),
    array[]::text[]
  )
    into v_completed_fields
  from unnest(v_missing_before) as completed_field(field_name)
  where not (completed_field.field_name = any(v_missing_after));

  return jsonb_build_object(
    'proveedor_id', v_provider_after.id,
    'execution_data_updated', cardinality(v_changed_fields) > 0,
    'changed_fields', to_jsonb(v_changed_fields),
    'completed_fields', to_jsonb(v_completed_fields),
    'missing_fields', to_jsonb(v_missing_after),
    'history_preserved', true
  );
end
$$;

comment on function public.complete_provider_payment_execution_data(uuid,text,text,text,text,text,text) is
  'Finance-only completion of banking data for the same legacy provider; returns field names but never banking values.';

create function public.guard_provider_payment_execution_data_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_missing text[];
begin
  if nullif(btrim(coalesce(new.destination_type, '')), '') is null
     and nullif(btrim(coalesce(new.clabe, '')), '') is null
     and nullif(btrim(coalesce(new.cuenta_bancaria, '')), '') is null
     and nullif(btrim(coalesce(new.convenio_number, '')), '') is null
     and nullif(btrim(coalesce(new.beneficiary_name, '')), '') is null
     and nullif(btrim(coalesce(new.banco, '')), '') is null then
    return new;
  end if;

  perform public.approval_batch_require_finance();

  if current_setting('flux.provider_payment_execution_rpc', true)
       is distinct from new.id::text then
    raise exception 'provider_payment_execution_rpc_required';
  end if;

  v_missing := public.provider_payment_execution_missing_fields(new);
  if v_missing && array[
    'beneficiary_name_invalid',
    'banco_invalid',
    'destination_type_invalid',
    'clabe_invalid',
    'cuenta_bancaria_invalid',
    'convenio_number_invalid'
  ]::text[] then
    raise exception 'provider_payment_execution_data_invalid';
  end if;

  return new;
end
$$;

create trigger provider_payment_execution_data_insert_guard
  before insert
  on public.proveedores
  for each row execute function public.guard_provider_payment_execution_data_insert();

create function public.save_provider_catalog_with_payment_execution_data(
  p_proveedor_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_before public.proveedores%rowtype;
  v_after public.proveedores%rowtype;
  v_provider_id uuid;
  v_is_create boolean := p_proveedor_id is null;
  v_execution_changed boolean := false;
  v_execution_supplied boolean := false;
  v_execution_fields text[];
  v_missing_after text[];
  v_unsupported_keys text[];
  v_now timestamptz := clock_timestamp();
begin
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'provider_payload_object_required';
  end if;

  select coalesce(
    array_agg(payload_key.key_name order by payload_key.key_name),
    array[]::text[]
  )
    into v_unsupported_keys
  from jsonb_object_keys(p_payload) as payload_key(key_name)
  where not (
    payload_key.key_name = any(array[
      'alias',
      'nombre_completo',
      'metodo_pago',
      'tipo_cuenta',
      'destination_type',
      'beneficiary_name',
      'banco',
      'clabe',
      'cuenta_bancaria',
      'convenio_number',
      'rfc',
      'persona_tipo',
      'email',
      'telefono',
      'tipo_proveedor',
      'notas',
      'es_personal_eventual',
      'activo',
      'updated_at'
    ]::text[])
  );

  if cardinality(v_unsupported_keys) > 0 then
    raise exception 'provider_payload_contains_unsupported_fields'
      using detail = array_to_string(v_unsupported_keys, ', ');
  end if;

  v_actor := public.approval_batch_require_actor();
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = v_actor
      and coalesce(profile.active, false)
  ) then
    raise exception 'profile_inactive';
  end if;

  if v_is_create then
    if not public.current_user_has_role(public.flux_member_roles()) then
      raise exception 'provider_create_role_required';
    end if;

    v_provider_id := gen_random_uuid();
    perform pg_advisory_xact_lock(
      hashtextextended(v_provider_id::text, 21036)
    );
    v_after := jsonb_populate_record(
      null::public.proveedores,
      p_payload - 'updated_at'
    );
    v_after.id := v_provider_id;
    v_after.activo := coalesce(v_after.activo, true);
    v_after.es_personal_eventual :=
      coalesce(v_after.es_personal_eventual, false);
  else
    if not public.current_user_has_role(public.flux_approver_roles()) then
      raise exception 'provider_update_role_required';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(p_proveedor_id::text, 21036)
    );

    select *
      into v_before
    from public.proveedores provider
    where provider.id = p_proveedor_id
    for update;

    if not found then
      raise exception 'proveedor_not_found';
    end if;

    v_provider_id := v_before.id;
    v_after := jsonb_populate_record(
      v_before,
      p_payload - 'updated_at'
    );
  end if;

  v_after.destination_type :=
    lower(nullif(btrim(coalesce(v_after.destination_type, '')), ''));
  v_after.clabe := nullif(
    regexp_replace(
      coalesce(v_after.clabe, ''),
      '[[:space:]-]',
      '',
      'g'
    ),
    ''
  );
  v_after.cuenta_bancaria := nullif(
    regexp_replace(
      coalesce(v_after.cuenta_bancaria, ''),
      '[[:space:]-]',
      '',
      'g'
    ),
    ''
  );
  v_after.convenio_number :=
    nullif(btrim(coalesce(v_after.convenio_number, '')), '');
  v_after.beneficiary_name :=
    nullif(btrim(coalesce(v_after.beneficiary_name, '')), '');
  v_after.banco := nullif(
    regexp_replace(
      btrim(coalesce(v_after.banco, '')),
      '[[:space:]]+',
      ' ',
      'g'
    ),
    ''
  );

  if nullif(btrim(coalesce(v_after.alias, '')), '') is null
     or nullif(btrim(coalesce(v_after.nombre_completo, '')), '') is null
     or nullif(btrim(coalesce(v_after.metodo_pago, '')), '') is null then
    raise exception 'provider_core_fields_required';
  end if;

  v_execution_supplied :=
    v_after.destination_type is not null
    or v_after.clabe is not null
    or v_after.cuenta_bancaria is not null
    or v_after.convenio_number is not null
    or v_after.beneficiary_name is not null
    or v_after.banco is not null;

  v_execution_changed := v_is_create and v_execution_supplied;
  if not v_is_create then
    v_execution_changed := row(
      v_before.destination_type,
      v_before.clabe,
      v_before.cuenta_bancaria,
      v_before.convenio_number,
      v_before.beneficiary_name,
      v_before.banco
    ) is distinct from row(
      v_after.destination_type,
      v_after.clabe,
      v_after.cuenta_bancaria,
      v_after.convenio_number,
      v_after.beneficiary_name,
      v_after.banco
    );
  end if;

  if v_execution_changed then
    if not coalesce(v_after.activo, false) then
      raise exception 'proveedor_not_found_or_inactive';
    end if;
    perform public.approval_batch_require_finance();
    perform set_config(
      'flux.provider_payment_execution_rpc',
      v_provider_id::text,
      true
    );
  end if;

  v_missing_after :=
    public.provider_payment_execution_missing_fields(v_after);
  if v_missing_after && array[
    'beneficiary_name_invalid',
    'banco_invalid',
    'destination_type_invalid',
    'clabe_invalid',
    'cuenta_bancaria_invalid',
    'convenio_number_invalid'
  ]::text[] then
    raise exception 'provider_payment_execution_data_invalid';
  end if;

  if v_is_create then
    insert into public.proveedores(
      id,
      alias,
      nombre_completo,
      metodo_pago,
      tipo_cuenta,
      destination_type,
      beneficiary_name,
      banco,
      clabe,
      cuenta_bancaria,
      convenio_number,
      rfc,
      persona_tipo,
      email,
      telefono,
      tipo_proveedor,
      notas,
      es_personal_eventual,
      activo,
      updated_at
    ) values (
      v_after.id,
      v_after.alias,
      v_after.nombre_completo,
      v_after.metodo_pago,
      v_after.tipo_cuenta,
      v_after.destination_type,
      v_after.beneficiary_name,
      v_after.banco,
      v_after.clabe,
      v_after.cuenta_bancaria,
      v_after.convenio_number,
      v_after.rfc,
      v_after.persona_tipo,
      v_after.email,
      v_after.telefono,
      v_after.tipo_proveedor,
      v_after.notas,
      v_after.es_personal_eventual,
      v_after.activo,
      v_now
    )
    returning * into v_after;

    if v_execution_changed then
      v_execution_fields := array_remove(array[
        case
          when v_after.destination_type is not null
            then 'destination_type'
        end,
        case when v_after.clabe is not null then 'clabe' end,
        case
          when v_after.cuenta_bancaria is not null
            then 'cuenta_bancaria'
        end,
        case
          when v_after.convenio_number is not null
            then 'convenio_number'
        end,
        case
          when v_after.beneficiary_name is not null
            then 'beneficiary_name'
        end,
        case when v_after.banco is not null then 'banco' end
      ]::text[], null);

      v_missing_after :=
        public.provider_payment_execution_missing_fields(v_after);

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
        'proveedor',
        v_after.id,
        'payment_execution_data_created',
        jsonb_build_object(
          'layout_data_complete', false,
          'missing_fields', '[]'::jsonb
        ),
        jsonb_build_object(
          'changed_fields', to_jsonb(v_execution_fields),
          'completed_fields', to_jsonb(v_execution_fields),
          'layout_data_complete', cardinality(v_missing_after) = 0,
          'missing_fields', to_jsonb(v_missing_after)
        ),
        v_actor,
        v_now,
        'Provider created through the authorized catalog RPC; banking values intentionally omitted.'
      );
    end if;
  else
    update public.proveedores provider
    set alias = v_after.alias,
        nombre_completo = v_after.nombre_completo,
        metodo_pago = v_after.metodo_pago,
        tipo_cuenta = v_after.tipo_cuenta,
        destination_type = v_after.destination_type,
        beneficiary_name = v_after.beneficiary_name,
        banco = v_after.banco,
        clabe = v_after.clabe,
        cuenta_bancaria = v_after.cuenta_bancaria,
        convenio_number = v_after.convenio_number,
        rfc = v_after.rfc,
        persona_tipo = v_after.persona_tipo,
        email = v_after.email,
        telefono = v_after.telefono,
        tipo_proveedor = v_after.tipo_proveedor,
        notas = v_after.notas,
        es_personal_eventual = v_after.es_personal_eventual,
        activo = v_after.activo,
        updated_at = v_now
    where provider.id = v_provider_id
    returning * into v_after;
  end if;

  return jsonb_build_object('id', v_after.id);
end
$$;

comment on function public.save_provider_catalog_with_payment_execution_data(uuid,jsonb) is
  'Atomic provider catalog save with a strict payload allowlist; banking changes require Finance and the RPC-only marker.';

create or replace function public.approval_batch_payment_layout_candidates(
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
      lower(nullif(btrim(p.destination_type), '')) as destination_type,
      case
        when lower(btrim(p.destination_type)) = 'clabe' then nullif(p.clabe, '')
        when lower(btrim(p.destination_type)) = 'cuenta' then nullif(p.cuenta_bancaria, '')
        when lower(btrim(p.destination_type)) = 'convenio'
          and nullif(p.convenio_number, '') is not null
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
        and pr.created_at >= settings.enforcement_started_at
        as enforcement_required,
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
      public.payment_request_layout_missing_fields(pr) as missing_fields
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
        extraordinary.id,
        extraordinary.category,
        extraordinary.reason,
        extraordinary.authorized_by,
        extraordinary.authorized_at
      from public.payment_request_extraordinary_authorizations extraordinary
      where extraordinary.payment_request_id = pr.id
        and extraordinary.status = 'active'
      order by extraordinary.authorized_at desc
      limit 1
    ) extra on true
    left join public.profiles extra_profile on extra_profile.id = extra.authorized_by
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
        'submitted', 'pending_approval', 'approved', 'rejected',
        'changes_requested', 'finance_validation', 'scheduled', 'paid'
      )
  ), marked as (
    select
      case
        when b.has_execution then 'already_executed'
        when b.director_status = 'rejected' and b.rebatch_status = 'blocked'
          then 'rejected_by_direction'
        when b.extraordinary_authorization_id is not null
          and not coalesce(b.extraordinary_authorization_current, false)
          then 'invalid_data'
        when b.extraordinary_authorization_id is not null
          and cardinality(b.missing_fields) > 0
          then 'invalid_data'
        when b.extraordinary_authorization_id is not null
          then 'ready_extraordinary'
        when b.source_batch_status in ('draft', 'submitted')
          then 'pending_director'
        when b.director_status = 'approved'
          and not b.direction_decision_fresh
          then 'direction_reapproval_required'
        when not b.budget_validation_current
          then 'invalid_data'
        when cardinality(b.missing_fields) > 0
          then 'invalid_data'
        when b.director_status = 'approved'
          and b.source_batch_status in ('approved', 'partially_approved')
          then 'pending_finance_close'
        when b.director_status = 'approved'
          and b.source_batch_status = 'closed'
          and b.direction_approval_current
          then 'ready_regular'
        when b.director_status = 'approved'
          and b.source_batch_status = 'closed'
          then 'direction_reapproval_required'
        when b.director_status = 'rejected' and b.rebatch_status = 'released'
          then 'pending_director'
        when b.source_item_id is null
          and b.request_status = 'approved'
          and not b.enforcement_required
          then 'legacy_eligible'
        else 'pending_director'
      end as classification,
      case
        when b.has_execution then 'already_executed'
        when b.director_status = 'rejected' and b.rebatch_status = 'blocked'
          then 'direction_rejected'
        when b.extraordinary_authorization_id is not null
          and not coalesce(b.extraordinary_authorization_current, false)
          then 'extraordinary_reauthorization_required'
        when b.extraordinary_authorization_id is not null
          and cardinality(b.missing_fields) > 0
          then 'incomplete_layout_data'
        when b.extraordinary_authorization_id is not null
          then 'extraordinary_authorized'
        when b.source_batch_status = 'draft' then 'batch_draft'
        when b.source_batch_status = 'submitted' then 'direction_pending'
        when b.director_status = 'approved'
          and not b.direction_decision_fresh
          then 'stale_direction_approval'
        when not b.budget_validation_current
          then coalesce(b.budget_reason, 'budget_validation_required')
        when cardinality(b.missing_fields) > 0
          then 'incomplete_layout_data'
        when b.director_status = 'approved'
          and b.source_batch_status in ('approved', 'partially_approved')
          then 'finance_close_required'
        when b.director_status = 'rejected' and b.rebatch_status = 'released'
          then 'resubmission_available'
        when b.enforcement_required and b.source_item_id is null
          then 'closed_batch_required'
        when b.enforcement_required then 'direction_approval_required'
        when b.source_item_id is null and b.request_status = 'approved'
          then 'legacy_without_batch'
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
          and not m.budget_validation_current
          then 'budget_revalidation_required'
      end,
      case
        when m.classification = 'direction_reapproval_required'
          then 'direction_reapproval_required'
      end
    ]::text[], null),
    m.budget_validation_current,
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

comment on function public.approval_batch_payment_layout_candidates(date,date,uuid,uuid) is
  'Classifies transfer requests after server-side execution-data validation; operational completion does not stale Direction approval.';

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
        director_profile.full_name
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
  'Lists Director assignments and reports profile, role and company-membership eligibility independently.';

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
        'membership_active', true
      )
      order by candidate.full_name, candidate.email
    )
    from (
      select
        profile.id as profile_id,
        profile.full_name,
        profile.email,
        array_agg(
          distinct lower(btrim(role.name))
          order by lower(btrim(role.name))
        ) as roles
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
  'Returns only active Direction profiles with an active membership in the selected active company.';

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
     or public.approval_batch_request_has_any_execution_record(v_request_before.id) then
    raise exception 'payment_request_layout_data_locked';
  end if;

  if v_request_before.proveedor_id is null or not exists (
    select 1
    from public.proveedores provider
    where provider.id = v_request_before.proveedor_id
      and coalesce(provider.activo, false)
  ) then
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
    raise exception 'company_bank_account_not_found_inactive_or_company_mismatch';
  end if;

  v_reference := coalesce(
    nullif(
      regexp_replace(
        coalesce(p_payment_reference, ''),
        '[[:space:]]',
        '',
        'g'
      ),
      ''
    ),
    nullif(btrim(v_request_before.payment_reference), '')
  );

  if v_reference is not null and v_reference !~ '^[0-9]+$' then
    raise exception 'payment_reference_must_be_numeric';
  end if;

  if v_reference is not null and char_length(v_reference) > 5 then
    raise exception 'payment_reference_too_long';
  end if;

  v_concept := coalesce(
    nullif(btrim(coalesce(p_payment_concept, '')), ''),
    nullif(btrim(v_request_before.payment_concept), ''),
    nullif(btrim(v_request_before.concept), ''),
    nullif(btrim(v_request_before.description), '')
  );

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
      when v_request_before.company_bank_account_id is distinct from v_account_id
        then 'company_bank_account_id'
    end,
    case
      when v_request_before.payment_reference is distinct from v_reference
        then 'payment_reference'
    end,
    case
      when v_request_before.payment_concept is distinct from v_concept
        then 'payment_concept'
    end,
    case
      when v_request_before.scheduled_payment_date is distinct from v_schedule
        then 'scheduled_payment_date'
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
        when v_schedule is distinct from payment_request.scheduled_payment_date
          then v_actor
        else payment_request.scheduled_by
      end,
      scheduled_at = case
        when v_schedule is distinct from payment_request.scheduled_payment_date
          then clock_timestamp()
        else payment_request.scheduled_at
      end,
      updated_at = clock_timestamp()
  where payment_request.id = v_request_before.id;

  select *
    into v_request_after
  from public.payment_requests payment_request
  where payment_request.id = v_request_before.id;

  if v_request_after.approval_material_updated_at is distinct from v_material_before then
    raise exception 'operational_update_changed_approval_material_timestamp';
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
      and batch_item.decided_at < v_request_after.approval_material_updated_at
  );

  return jsonb_build_object(
    'payment_request_id', v_request_after.id,
    'direction_was_current', v_direction_was_current,
    'direction_approval_current', v_direction_is_current,
    'direction_reapproval_required', v_direction_reapproval_required,
    'approval_preserved', v_direction_was_current and v_direction_is_current,
    'execution_data_updated', cardinality(v_changed_fields) > 0,
    'changed_fields', to_jsonb(v_changed_fields),
    'completed_fields', to_jsonb(v_completed_fields),
    'missing_fields', to_jsonb(v_missing_after),
    'history_preserved', true
  );
end
$$;

comment on function public.complete_payment_request_layout_data(uuid,uuid,text,text,date) is
  'Finance-only atomic completion of payment-execution data. Returns field names and approval state without banking values.';

create unique index company_directors_one_active_per_company_uidx
  on public.company_directors(company_id)
  where active;

create function public.set_company_director_for_future_batches(
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
  v_previous_directors uuid[];
  v_changed boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if p_company_id is null or p_director_profile_id is null then
    raise exception 'company_and_director_required';
  end if;

  v_actor := public.approval_batch_require_finance();

  if p_director_profile_id = v_actor then
    raise exception 'director_self_assignment_not_allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 21033));

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

  select coalesce(
    array_agg(
      director_assignment.director_profile_id
      order by director_assignment.director_profile_id
    ),
    array[]::uuid[]
  )
    into v_previous_directors
  from public.company_directors director_assignment
  where director_assignment.company_id = p_company_id
    and director_assignment.active;

  select director_assignment.id
    into v_assignment_id
  from public.company_directors director_assignment
  where director_assignment.company_id = p_company_id
    and director_assignment.director_profile_id = p_director_profile_id
  order by director_assignment.created_at desc, director_assignment.id desc
  limit 1
  for update;

  update public.company_directors director_assignment
  set active = false,
      updated_at = v_now
  where director_assignment.company_id = p_company_id
    and director_assignment.active
    and director_assignment.director_profile_id <> p_director_profile_id;

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
  else
    update public.company_directors director_assignment
    set active = true,
        updated_at = case
          when not director_assignment.active then v_now
          else director_assignment.updated_at
        end
    where director_assignment.id = v_assignment_id;
  end if;

  v_changed := cardinality(v_previous_directors) <> 1
    or v_previous_directors[1] is distinct from p_director_profile_id;

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
      'director_for_future_batches_updated',
      jsonb_build_object(
        'director_profile_ids', to_jsonb(v_previous_directors)
      ),
      jsonb_build_object(
        'director_profile_id', p_director_profile_id,
        'active', true
      ),
      v_actor,
      v_now,
      'Applies to future approval batches only; historical batch Director snapshots are unchanged.'
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

comment on function public.set_company_director_for_future_batches(uuid,uuid) is
  'Atomically replaces the one active Director used by future batches without changing enforcement or historical batches.';

revoke insert, update, delete, truncate
  on table public.activity_log
  from public, anon, authenticated;

revoke all on function public.provider_payment_execution_missing_fields(public.proveedores)
  from public, anon, authenticated, service_role;
revoke all on function public.payment_request_layout_missing_fields(public.payment_requests)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_payment_request_material_change()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_payment_request_execution_data_update()
  from public, anon, authenticated, service_role;
revoke all on function public.audit_payment_request_execution_data_update()
  from public, anon, authenticated, service_role;
revoke all on function public.mark_provider_payment_material_change()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_provider_payment_execution_data_insert()
  from public, anon, authenticated, service_role;
revoke all on function public.complete_provider_payment_execution_data(uuid,text,text,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_company_directors(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_approval_batch_director_candidates(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.complete_payment_request_layout_data(uuid,uuid,text,text,date)
  from public, anon, authenticated, service_role;
revoke all on function public.set_company_director_for_future_batches(uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute
  on function public.complete_payment_request_layout_data(uuid,uuid,text,text,date)
  to authenticated;
grant execute
  on function public.complete_provider_payment_execution_data(uuid,text,text,text,text,text,text)
  to authenticated;
grant execute
  on function public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)
  to authenticated;
grant execute
  on function public.set_company_director_for_future_batches(uuid,uuid)
  to authenticated;
grant execute
  on function public.list_company_directors(uuid)
  to authenticated;
grant execute
  on function public.list_approval_batch_director_candidates(uuid)
  to authenticated;

do $$
declare
  v_material record;
  v_provider record;
  v_provider_complete record;
  v_provider_insert_guard record;
  v_provider_save record;
  v_complete record;
  v_director record;
  v_director_candidates record;
  v_director_list record;
  v_candidate record;
begin
  select
    function_info.prosecdef,
    function_info.proconfig,
    lower(function_info.prosrc) as source
    into v_material
  from pg_proc function_info
  where function_info.oid =
    'public.mark_payment_request_material_change()'::regprocedure;

  if v_material.prosecdef
     or position('old.company_id' in v_material.source) = 0
     or position('old.requested_by' in v_material.source) = 0
     or position('old.proveedor_id' in v_material.source) = 0
     or position('old.provider_id' in v_material.source) = 0
     or position('old.cost_center_id' in v_material.source) = 0
     or position('old.budget_category_id' in v_material.source) = 0
     or position('old.budget_month' in v_material.source) = 0
     or position('old.amount_requested' in v_material.source) = 0
     or position('old.currency' in v_material.source) = 0
     or position('old.exchange_rate' in v_material.source) = 0
     or position('old.request_type' in v_material.source) = 0
     or position('old.payment_method' in v_material.source) = 0
     or position('old.is_extraordinary_adjustment' in v_material.source) = 0
     or position('old.concept' in v_material.source) = 0
     or position('old.description' in v_material.source) = 0
     or position('old.provider_bank_account_id' in v_material.source) > 0
     or position('old.company_bank_account_id' in v_material.source) > 0
     or position('old.due_date' in v_material.source) > 0
     or position('old.scheduled_payment_date' in v_material.source) > 0
     or position('old.payment_reference' in v_material.source) > 0
     or position('old.payment_concept' in v_material.source) > 0 then
    raise exception '033_postcheck: material-field contract is incomplete or contaminated';
  end if;

  select
    function_info.prosecdef,
    function_info.proconfig,
    lower(function_info.prosrc) as source
    into v_provider
  from pg_proc function_info
  where function_info.oid =
    'public.mark_provider_payment_material_change()'::regprocedure;

  if not v_provider.prosecdef
     or not exists (
       select 1
       from unnest(coalesce(v_provider.proconfig, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     )
     or position('approval_batch_require_finance' in v_provider.source) = 0
     or position('provider_payment_execution_rpc_required' in v_provider.source) = 0
     or position('activity_log' in v_provider.source) = 0
     or position('update public.payment_requests' in v_provider.source) > 0
     or position('notification_events' in v_provider.source) > 0 then
    raise exception '033_postcheck: provider execution-data trigger is unsafe';
  end if;

  select
    function_info.prosecdef,
    function_info.proconfig,
    lower(function_info.prosrc) as source
    into v_provider_complete
  from pg_proc function_info
  where function_info.oid =
    'public.complete_provider_payment_execution_data(uuid,text,text,text,text,text,text)'::regprocedure;

  if not v_provider_complete.prosecdef
     or not exists (
       select 1
       from unnest(coalesce(v_provider_complete.proconfig, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     )
     or position('approval_batch_require_finance' in v_provider_complete.source) = 0
     or position('flux.provider_payment_execution_rpc' in v_provider_complete.source) = 0
     or position('update public.proveedores' in v_provider_complete.source) = 0
     or position('changed_fields' in v_provider_complete.source) = 0
     or position('missing_fields' in v_provider_complete.source) = 0
     or position('notification_events' in v_provider_complete.source) > 0 then
    raise exception '033_postcheck: provider completion RPC is incomplete or unsafe';
  end if;

  select
    function_info.prosecdef,
    function_info.proconfig,
    lower(function_info.prosrc) as source
    into v_provider_insert_guard
  from pg_proc function_info
  where function_info.oid =
    'public.guard_provider_payment_execution_data_insert()'::regprocedure;

  if not v_provider_insert_guard.prosecdef
     or not exists (
       select 1
       from unnest(
         coalesce(v_provider_insert_guard.proconfig, array[]::text[])
       ) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     )
     or position(
       'approval_batch_require_finance',
       v_provider_insert_guard.source
     ) = 0
     or position(
       'flux.provider_payment_execution_rpc',
       v_provider_insert_guard.source
     ) = 0
     or position(
       'provider_payment_execution_data_invalid',
       v_provider_insert_guard.source
     ) = 0 then
    raise exception '033_postcheck: provider INSERT guard is incomplete or unsafe';
  end if;

  select
    function_info.prosecdef,
    function_info.proconfig,
    lower(function_info.prosrc) as source
    into v_provider_save
  from pg_proc function_info
  where function_info.oid =
    'public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)'::regprocedure;

  if not v_provider_save.prosecdef
     or not exists (
       select 1
       from unnest(coalesce(v_provider_save.proconfig, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     )
     or position('provider_payload_contains_unsupported_fields' in v_provider_save.source) = 0
     or position('approval_batch_require_actor' in v_provider_save.source) = 0
     or position('approval_batch_require_finance' in v_provider_save.source) = 0
     or position('not coalesce(v_after.activo, false)' in v_provider_save.source) = 0
     or position('flux.provider_payment_execution_rpc' in v_provider_save.source) = 0
     or position('pg_advisory_xact_lock' in v_provider_save.source) = 0
     or position('for update' in v_provider_save.source) = 0
     or position('insert into public.proveedores' in v_provider_save.source) = 0
     or position('update public.proveedores' in v_provider_save.source) = 0
     or position('execute ' in v_provider_save.source) > 0
     or position('notification_events' in v_provider_save.source) > 0 then
    raise exception '033_postcheck: provider catalog RPC is incomplete or unsafe';
  end if;

  select
    function_info.prosecdef,
    function_info.proconfig,
    lower(function_info.prosrc) as source
    into v_complete
  from pg_proc function_info
  where function_info.oid =
    'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)'::regprocedure;

  if not v_complete.prosecdef
     or not exists (
       select 1
       from unnest(coalesce(v_complete.proconfig, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     )
     or position('approval_batch_require_finance' in v_complete.source) = 0
     or position('flux.payment_execution_rpc' in v_complete.source) = 0
     or position('operational_update_changed_approval_material_timestamp' in v_complete.source) = 0
     or position('approval_preserved' in v_complete.source) = 0
     or position('execution_data_updated' in v_complete.source) = 0
     or position('missing_fields' in v_complete.source) = 0
     or position('notification_events' in v_complete.source) > 0 then
    raise exception '033_postcheck: layout-data completion RPC is incomplete or unsafe';
  end if;

  select
    function_info.prosecdef,
    function_info.proconfig,
    lower(function_info.prosrc) as source
    into v_director
  from pg_proc function_info
  where function_info.oid =
    'public.set_company_director_for_future_batches(uuid,uuid)'::regprocedure;

  if not v_director.prosecdef
     or not exists (
       select 1
       from unnest(coalesce(v_director.proconfig, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
      )
      or position('approval_batch_require_finance' in v_director.source) = 0
      or position('director_self_assignment_not_allowed' in v_director.source) = 0
      or position('profile_company_memberships' in v_director.source) = 0
      or position('activity_log' in v_director.source) = 0
     or position('approval_batch_company_settings' in v_director.source) > 0
     or position('approval_batches' in v_director.source) > 0 then
    raise exception '033_postcheck: future-Director RPC changes enforcement or historical batches';
  end if;

  select
    function_info.prosecdef,
    function_info.proconfig,
    lower(function_info.prosrc) as source
    into v_director_candidates
  from pg_proc function_info
  where function_info.oid =
    'public.list_approval_batch_director_candidates(uuid)'::regprocedure;

  if not v_director_candidates.prosecdef
     or not exists (
       select 1
       from unnest(
         coalesce(v_director_candidates.proconfig, array[]::text[])
       ) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     )
     or position(
       'approval_batch_require_finance',
       v_director_candidates.source
     ) = 0
     or position('profile.active' in v_director_candidates.source) = 0
     or position(
       'profile_company_memberships',
       v_director_candidates.source
     ) = 0
     or position('membership.active' in v_director_candidates.source) = 0 then
    raise exception '033_postcheck: Director candidates do not enforce active profile and membership';
  end if;

  select
    function_info.prosecdef,
    function_info.proconfig,
    lower(function_info.prosrc) as source
    into v_director_list
  from pg_proc function_info
  where function_info.oid =
    'public.list_company_directors(uuid)'::regprocedure;

  if not v_director_list.prosecdef
     or not exists (
       select 1
       from unnest(coalesce(v_director_list.proconfig, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     )
     or position('director_profile_active' in v_director_list.source) = 0
     or position('director_role_valid' in v_director_list.source) = 0
     or position('director_membership_active' in v_director_list.source) = 0 then
    raise exception '033_postcheck: Director list does not expose independent eligibility state';
  end if;

  select
    function_info.prosecdef,
    function_info.proconfig,
    lower(function_info.prosrc) as source
    into v_candidate
  from pg_proc function_info
  where function_info.oid =
    'public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)'::regprocedure;

  if not v_candidate.prosecdef
     or not exists (
       select 1
       from unnest(coalesce(v_candidate.proconfig, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     )
     or position('payment_request_layout_missing_fields' in v_candidate.source) = 0
     or position('direction_reapproval_required' in v_candidate.source) = 0
     or position('ready_regular' in v_candidate.source) = 0 then
    raise exception '033_postcheck: payment-layout classifier is incomplete';
  end if;

  if to_regclass('public.company_directors_one_active_per_company_uidx') is null
     or not exists (
       select 1
       from pg_index index_info
       where index_info.indexrelid =
         'public.company_directors_one_active_per_company_uidx'::regclass
         and index_info.indisunique
         and index_info.indpred is not null
     ) then
    raise exception '033_postcheck: one-active-Director index is missing or not partial unique';
  end if;

  if exists (
    select 1
    from public.company_directors director_assignment
    where director_assignment.active
    group by director_assignment.company_id
    having count(*) > 1
  ) then
    raise exception '033_postcheck: more than one active Director exists for a company';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_info
    join pg_class relation_info on relation_info.oid = trigger_info.tgrelid
    where relation_info.oid = 'public.payment_requests'::regclass
      and trigger_info.tgname = 'guard_payment_request_execution_data_update'
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled <> 'D'
  ) or not exists (
    select 1
    from pg_trigger trigger_info
    join pg_class relation_info on relation_info.oid = trigger_info.tgrelid
    where relation_info.oid = 'public.payment_requests'::regclass
      and trigger_info.tgname = 'audit_payment_request_execution_data_update'
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled <> 'D'
  ) then
    raise exception '033_postcheck: execution-data guard or audit trigger is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_info
    join pg_class relation_info on relation_info.oid = trigger_info.tgrelid
    join pg_proc function_info on function_info.oid = trigger_info.tgfoid
    where relation_info.oid = 'public.proveedores'::regclass
      and trigger_info.tgname =
        'provider_payment_execution_data_insert_guard'
      and function_info.proname =
        'guard_provider_payment_execution_data_insert'
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled <> 'D'
      and trigger_info.tgtype = 7
  ) then
    raise exception '033_postcheck: provider execution-data INSERT guard is missing';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.complete_provider_payment_execution_data(uuid,text,text,text,text,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.set_company_director_for_future_batches(uuid,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.list_company_directors(uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.list_approval_batch_director_candidates(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.complete_provider_payment_execution_data(uuid,text,text,text,text,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.set_company_director_for_future_batches(uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.list_company_directors(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.list_approval_batch_director_candidates(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.complete_provider_payment_execution_data(uuid,text,text,text,text,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.set_company_director_for_future_batches(uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.list_company_directors(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.list_approval_batch_director_candidates(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.payment_request_layout_missing_fields(public.payment_requests)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception '033_postcheck: function grants do not match least privilege';
  end if;
end
$$;

commit;
