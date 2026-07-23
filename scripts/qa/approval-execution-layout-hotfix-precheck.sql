-- Read-only gate for migration 033.
-- The operator must first verify that the connected project ref is exactly:
-- scsirgbuqjcwoaxfacth
--
-- This file performs no repair and must be run before the versioned migration.

begin;
set transaction read only;

do $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
  v_column text;
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

  foreach v_column in array array['company_id', 'account_number', 'active'] loop
    if not exists (
      select 1
      from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = 'company_bank_accounts'
        and column_info.column_name = v_column
    ) then
      v_missing := array_append(
        v_missing,
        'company_bank_accounts.' || v_column
      );
    end if;
  end loop;

  foreach v_column in array array['profile_id', 'company_id', 'active'] loop
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
    raise exception '033_read_only_precheck: missing required objects: %',
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
    raise exception '033_read_only_precheck: migrations 021/022/023/028/032 are incomplete';
  end if;

  if to_regprocedure(
       'public.complete_provider_payment_execution_data(uuid,text,text,text,text,text,text)'
     ) is not null
     or to_regprocedure(
       'public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)'
     ) is not null
     or to_regprocedure(
       'public.guard_provider_payment_execution_data_insert()'
     ) is not null
     or to_regclass(
       'public.company_directors_one_active_per_company_uidx'
     ) is not null then
    raise exception '033_read_only_precheck: migration 033 appears already applied or partially drifted';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception '033_read_only_precheck: required Supabase roles are missing';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger trigger_info
    join pg_class relation_info on relation_info.oid = trigger_info.tgrelid
    join pg_namespace namespace_info
      on namespace_info.oid = relation_info.relnamespace
    join pg_proc function_info on function_info.oid = trigger_info.tgfoid
    where namespace_info.nspname = 'public'
      and relation_info.relname = 'payment_requests'
      and trigger_info.tgname = 'mark_payment_request_material_change'
      and function_info.proname = 'mark_payment_request_material_change'
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled <> 'D'
      and trigger_info.tgtype = 23
      and cardinality(trigger_info.tgattr::smallint[]) = 0
  ) then
    raise exception '033_read_only_precheck: payment-request trigger timing or events drifted';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_info
    join pg_class relation_info on relation_info.oid = trigger_info.tgrelid
    join pg_namespace namespace_info
      on namespace_info.oid = relation_info.relnamespace
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
    raise exception '033_read_only_precheck: provider trigger timing, events or columns drifted';
  end if;

  if not exists (
    select 1
    from pg_proc function_info
    where function_info.oid =
      'public.mark_payment_request_material_change()'::regprocedure
      and strpos(
        lower(function_info.prosrc),
        'old.provider_bank_account_id'
      ) > 0
      and strpos(
        lower(function_info.prosrc),
        'old.company_bank_account_id'
      ) > 0
      and strpos(lower(function_info.prosrc), 'old.due_date') > 0
      and strpos(
        lower(function_info.prosrc),
        'old.scheduled_payment_date'
      ) > 0
      and strpos(lower(function_info.prosrc), 'old.payment_reference') > 0
      and strpos(lower(function_info.prosrc), 'old.payment_concept') > 0
  ) or not exists (
    select 1
    from pg_proc function_info
    where function_info.oid =
      'public.mark_provider_payment_material_change()'::regprocedure
      and strpos(
        lower(function_info.prosrc),
        'update public.payment_requests'
      ) > 0
      and strpos(
        lower(function_info.prosrc),
        'approval_material_updated_at'
      ) > 0
  ) or not exists (
    select 1
    from pg_proc function_info
    where function_info.oid =
      'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)'::regprocedure
      and strpos(
        lower(function_info.prosrc),
        'approval_batch_require_finance'
      ) > 0
      and strpos(
        lower(function_info.prosrc),
        'update public.payment_requests'
      ) > 0
      and strpos(
        lower(function_info.prosrc),
        'direction_reapproval_required'
      ) > 0
  ) or not exists (
    select 1
    from pg_proc function_info
    where function_info.oid =
      'public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)'::regprocedure
      and strpos(
        lower(function_info.prosrc),
        'direction_reapproval_required'
      ) > 0
      and strpos(lower(function_info.prosrc), 'ready_regular') > 0
      and strpos(lower(function_info.prosrc), 'legacy_eligible') > 0
  ) then
    raise exception '033_read_only_precheck: function definitions drift from the expected 022/023 baseline';
  end if;

  if exists (
    select 1
    from public.company_directors director_assignment
    where director_assignment.active
    group by director_assignment.company_id
    having count(*) > 1
  ) then
    raise exception '033_read_only_precheck: multiple active Directors exist for a company';
  end if;
end
$$;

select jsonb_build_object(
  'status', 'PASS',
  'mode', 'READ_ONLY',
  'active_director_duplicates', (
    select count(*)
    from (
      select director_assignment.company_id
      from public.company_directors director_assignment
      where director_assignment.active
      group by director_assignment.company_id
      having count(*) > 1
    ) duplicates
  ),
  'stale_closed_direction_requests', (
    select count(*)
    from public.payment_requests payment_request
    where exists (
      select 1
      from public.approval_batch_items batch_item
      join public.approval_batches approval_batch
        on approval_batch.id = batch_item.batch_id
      where batch_item.payment_request_id = payment_request.id
        and batch_item.removed_at is null
        and batch_item.director_status = 'approved'
        and batch_item.decided_at is not null
        and batch_item.decided_at <
          payment_request.approval_material_updated_at
        and approval_batch.status = 'closed'
    )
  ),
  'historical_reconciliation', 'NOT_AUTHORIZED',
  'stale_classification', 'AMBIGUOUS_UNTIL_AUDITED'
) as approval_execution_hotfix_precheck;

rollback;
