begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $reconcile_materiality$
declare
  v_source text;
  v_security_definer boolean;
  v_settings text[];
  v_historical_baseline boolean;
  v_expanded_baseline boolean;
  v_operational_fields_present boolean;
begin
  if to_regprocedure(
    'public.mark_payment_request_material_change()'
  ) is null then
    raise exception
      'layout_operational_reconcile: material-change function is missing';
  end if;

  select
    lower(function_info.prosrc),
    function_info.prosecdef,
    function_info.proconfig
    into v_source, v_security_definer, v_settings
  from pg_proc function_info
  where function_info.oid =
    'public.mark_payment_request_material_change()'::regprocedure;

  if v_security_definer
     or not exists (
       select 1
       from unnest(coalesce(v_settings, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     ) then
    raise exception
      'layout_operational_reconcile: unexpected function security attributes';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_info
    where trigger_info.tgrelid = 'public.payment_requests'::regclass
      and trigger_info.tgname = 'mark_payment_request_material_change'
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled <> 'D'
  ) then
    raise exception
      'layout_operational_reconcile: material-change trigger is missing or disabled';
  end if;

  v_historical_baseline :=
    position('old.provider_id' in v_source) > 0
    and position('old.provider_bank_account_id' in v_source) > 0
    and position('old.proveedor_id' in v_source) > 0
    and position('old.company_id' in v_source) > 0
    and position('old.cost_center_id' in v_source) > 0
    and position('old.budget_category_id' in v_source) > 0
    and position('old.amount_requested' in v_source) > 0
    and position('old.currency' in v_source) > 0
    and position('old.exchange_rate' in v_source) > 0
    and position('old.request_type' in v_source) > 0
    and position('old.payment_method' in v_source) > 0
    and position('old.payment_concept' in v_source) > 0;

  v_expanded_baseline :=
    position('old.company_id' in v_source) > 0
    and position('old.requested_by' in v_source) > 0
    and position('old.proveedor_id' in v_source) > 0
    and position('old.cost_center_id' in v_source) > 0
    and position('old.budget_category_id' in v_source) > 0
    and position('old.budget_month' in v_source) > 0
    and position('old.amount_requested' in v_source) > 0
    and position('old.currency' in v_source) > 0
    and position('old.exchange_rate' in v_source) > 0
    and position('old.request_type' in v_source) > 0
    and position('old.payment_method' in v_source) > 0
    and position('old.is_extraordinary_adjustment' in v_source) > 0
    and position('old.concept' in v_source) > 0
    and position('old.description' in v_source) > 0;

  if not v_historical_baseline and not v_expanded_baseline then
    raise exception
      'layout_operational_reconcile: unexpected material-change baseline';
  end if;

  v_operational_fields_present :=
    position('company_bank_account_id' in v_source) > 0
    or position('old.due_date' in v_source) > 0
    or position('old.scheduled_payment_date' in v_source) > 0
    or position('old.payment_reference' in v_source) > 0;

  if v_operational_fields_present then
    if not v_historical_baseline or v_expanded_baseline then
      raise exception
        'layout_operational_reconcile: refusing to replace an unknown mixed baseline';
    end if;

    execute $function_ddl$
      create or replace function public.mark_payment_request_material_change()
      returns trigger
      language plpgsql
      set search_path = public, pg_temp
      as $function_body$
      begin
        if tg_op = 'INSERT' then
          new.approval_material_updated_at := clock_timestamp();
          return new;
        end if;

        if pg_trigger_depth() > 1
           and new.approval_material_updated_at is distinct from
               old.approval_material_updated_at then
          return new;
        end if;

        if row(
          old.provider_id,
          old.provider_bank_account_id,
          old.proveedor_id,
          old.company_id,
          old.cost_center_id,
          old.budget_category_id,
          old.amount_requested,
          old.currency,
          old.exchange_rate,
          old.request_type,
          old.payment_method,
          old.payment_concept
        ) is distinct from row(
          new.provider_id,
          new.provider_bank_account_id,
          new.proveedor_id,
          new.company_id,
          new.cost_center_id,
          new.budget_category_id,
          new.amount_requested,
          new.currency,
          new.exchange_rate,
          new.request_type,
          new.payment_method,
          new.payment_concept
        ) then
          new.approval_material_updated_at := clock_timestamp();
        else
          new.approval_material_updated_at :=
            old.approval_material_updated_at;
        end if;

        return new;
      end
      $function_body$
    $function_ddl$;
  end if;
end
$reconcile_materiality$;

comment on function public.mark_payment_request_material_change() is
  'Advances approval materiality for request/economic changes while preserving Direction approval for Layout execution data: source account, due/scheduled date, and payment reference.';

do $repair_sol_2026_0006$
declare
  v_request public.payment_requests%rowtype;
  v_item public.approval_batch_items%rowtype;
  v_snapshot public.payable_snapshots%rowtype;
  v_item_count integer;
  v_updated_count integer;
  v_classification text;
  v_classification_reason text;
  v_missing_fields text[];
  v_direction_current boolean;
  v_finance_current boolean;
  v_direction_decided_at constant timestamptz :=
    timestamptz '2026-08-09 21:05:50.723699+00';
begin
  if not exists (
    select 1
    from public.payment_requests request
    where request.request_number = 'SOL-2026-0006'
      and request.created_at =
        timestamptz '2026-08-09 20:48:05.077627+00'
  ) then
    return;
  end if;

  execute 'lock table public.payment_requests in access exclusive mode';

  if (
    select count(*)
    from pg_trigger trigger_info
    where trigger_info.tgrelid = 'public.payment_requests'::regclass
      and trigger_info.tgname in (
        'mark_payment_request_material_change',
        'set_payment_requests_updated_at',
        'invalidate_extraordinary_on_material_change'
      )
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled <> 'D'
  ) <> 3 then
    raise exception
      'layout_operational_reconcile: repair triggers are missing or disabled';
  end if;

  select *
    into strict v_request
  from public.payment_requests request
  where request.request_number = 'SOL-2026-0006'
    and request.created_at =
      timestamptz '2026-08-09 20:48:05.077627+00'
  for update;

  select item.*
    into strict v_item
  from public.approval_batch_items item
  join public.approval_batches batch
    on batch.id = item.batch_id
  where item.payment_request_id = v_request.id
    and item.removed_at is null
    and item.director_status = 'approved'
    and item.decided_at = v_direction_decided_at
    and item.finance_release_status = 'released'
    and item.finance_released_at =
      timestamptz '2026-08-09 21:06:43.833045+00'
    and batch.status = 'closed'
    and batch.label = 'CORTE DEMO CLIENTE 09/AGO/2026'
    and batch.period_start = date '2026-08-06'
    and batch.period_end = date '2026-08-12'
    and batch.decided_at = v_direction_decided_at
    and batch.closed_at =
      timestamptz '2026-08-09 21:06:43.833045+00'
  for update of item, batch;

  select snapshot.*
    into strict v_snapshot
  from public.payable_snapshots snapshot
  where snapshot.payment_request_id = v_request.id
    and snapshot.version = 1
  for update;

  select count(*)
    into v_item_count
  from public.approval_batch_items item
  where item.payment_request_id = v_request.id;

  if v_item_count <> 1 then
    raise exception
      'layout_operational_reconcile: SOL-2026-0006 approval fingerprint changed';
  end if;

  if v_snapshot.company_id is distinct from v_request.company_id
     or v_snapshot.amount_minor is distinct from 31840
     or v_snapshot.currency is distinct from 'MXN'
     or v_snapshot.source_type is distinct from 'approval_batch_item'
     or v_snapshot.source_id is distinct from v_item.id
     or v_snapshot.source_status is distinct from 'closed'
     or v_snapshot.source_approval_material_updated_at is distinct from
       timestamptz '2026-08-09 20:48:05.124232+00'
     or v_snapshot.authorized_at is distinct from v_direction_decided_at
     or v_snapshot.materialized_at is distinct from
       timestamptz '2026-08-09 21:06:43.911094+00' then
    raise exception
      'layout_operational_reconcile: SOL-2026-0006 payable snapshot changed';
  end if;

  if v_request.status::text is distinct from 'approved'
     or v_request.provider_id is not null
     or v_request.provider_bank_account_id is not null
     or v_request.amount_requested is distinct from 318.40
     or v_request.currency::text is distinct from 'MXN'
     or v_request.exchange_rate is distinct from 1
     or v_request.request_type::text is distinct from 'provider_payment'
     or v_request.payment_method is not null
     or v_request.budget_month is distinct from date '2026-08-01'
     or v_request.is_extraordinary_adjustment is distinct from false
     or v_request.payment_concept is distinct from v_request.concept
     or v_request.payment_concept is distinct from v_request.description
     or encode(
       sha256(convert_to(coalesce(v_request.concept, ''), 'UTF8')),
       'hex'
     ) is distinct from
       '6671be98c7696b01c711bfc81cafba02387fb4d8c3bb8bf5dbf90f589c0df3ec'
     or v_request.company_bank_account_id is null
     or v_request.due_date is not null
     or v_request.scheduled_payment_date is distinct from date '2026-08-09'
     or v_request.payment_reference is distinct from '31840'
     or v_request.scheduled_at is distinct from
       timestamptz '2026-08-09 21:18:20.67975+00'
     or v_request.extraordinary_state::text is distinct from 'normal'
     or not exists (
       select 1
       from public.companies company
       where company.id = v_request.company_id
         and company.name = 'Operadora Tlacatecpan'
         and company.legal_name = 'OPERADORA TLACATECPAN'
         and company.active
     )
     or not exists (
       select 1
       from public.proveedores provider
       where provider.id = v_request.proveedor_id
         and provider.alias = 'DEMO FLUX CLIENTE 070826'
         and provider.activo
     )
     or not exists (
       select 1
       from public.cost_centers cost_center
       where cost_center.id = v_request.cost_center_id
         and cost_center.code = 'RSJT'
         and cost_center.name = 'Rancho San Juan Tlacatecpan'
         and cost_center.active
     )
     or not exists (
       select 1
       from public.budget_categories budget_category
       where budget_category.id = v_request.budget_category_id
         and budget_category.code = 'RSJT-2026-R0035'
         and budget_category.name = 'Servicios Financieros y Contables'
         and budget_category.active
     )
     or not exists (
       select 1
       from public.company_bank_accounts source_account
       where source_account.id = v_request.company_bank_account_id
         and source_account.company_id = v_request.company_id
         and source_account.name = 'Cuenta MXN'
         and source_account.bank_name = 'BBVA'
         and source_account.last4 = '9621'
         and source_account.currency = 'MXN'
         and source_account.active
     )
     or public.approval_batch_request_has_any_execution_record(v_request.id)
     or exists (
       select 1
       from public.payment_request_receipt_links receipt_link
       where receipt_link.payment_request_id = v_request.id
     )
     or exists (
       select 1
       from public.payment_request_extraordinary_authorizations extraordinary_auth
       where extraordinary_auth.payment_request_id = v_request.id
     ) then
    raise exception
      'layout_operational_reconcile: SOL-2026-0006 request fingerprint changed';
  end if;

  if v_request.approval_material_updated_at =
       v_snapshot.source_approval_material_updated_at
     and public.approval_batch_request_has_current_direction_approval(
       v_request.id
     ) then
    return;
  end if;

  select
    candidate.classification,
    candidate.classification_reason,
    candidate.missing_fields,
    candidate.direction_approval_current,
    candidate.finance_approval_current
    into strict
      v_classification,
      v_classification_reason,
      v_missing_fields,
      v_direction_current,
      v_finance_current
  from public.approval_batch_payment_layout_candidates(
    date '2026-08-09',
    date '2026-08-15',
    v_request.company_id,
    v_request.company_bank_account_id
  ) candidate
  where candidate.payment_request_id = v_request.id;

  if v_request.approval_material_updated_at is distinct from
       timestamptz '2026-08-09 21:18:20.755638+00'
     or abs(extract(epoch from (
       v_request.approval_material_updated_at - v_request.scheduled_at
     ))) >= 1
     or v_classification is distinct from 'direction_reapproval_required'
     or v_classification_reason is distinct from 'stale_direction_approval'
     or v_missing_fields is distinct from
       array['direction_reapproval_required']::text[]
     or v_direction_current is distinct from false
     or v_finance_current is distinct from true then
    raise exception
      'layout_operational_reconcile: SOL-2026-0006 is not in the expected regression state';
  end if;

  execute
    'alter table public.payment_requests disable trigger mark_payment_request_material_change';
  execute
    'alter table public.payment_requests disable trigger set_payment_requests_updated_at';
  execute
    'alter table public.payment_requests disable trigger invalidate_extraordinary_on_material_change';

  update public.payment_requests request
  set approval_material_updated_at =
    v_snapshot.source_approval_material_updated_at
  where request.id = v_request.id
    and request.approval_material_updated_at =
      timestamptz '2026-08-09 21:18:20.755638+00';

  get diagnostics v_updated_count = row_count;

  execute
    'alter table public.payment_requests enable trigger invalidate_extraordinary_on_material_change';
  execute
    'alter table public.payment_requests enable trigger set_payment_requests_updated_at';
  execute
    'alter table public.payment_requests enable trigger mark_payment_request_material_change';

  if v_updated_count <> 1 then
    raise exception
      'layout_operational_reconcile: SOL-2026-0006 repair updated % rows',
      v_updated_count;
  end if;
end
$repair_sol_2026_0006$;

do $postcheck$
declare
  v_source text;
  v_request public.payment_requests%rowtype;
  v_item public.approval_batch_items%rowtype;
  v_snapshot public.payable_snapshots%rowtype;
  v_classification text;
  v_missing_fields text[];
  v_direction_current boolean;
  v_finance_current boolean;
begin
  select lower(function_info.prosrc)
    into v_source
  from pg_proc function_info
  where function_info.oid =
    'public.mark_payment_request_material_change()'::regprocedure;

  if position('company_bank_account_id' in v_source) > 0
     or position('old.due_date' in v_source) > 0
     or position('old.scheduled_payment_date' in v_source) > 0
     or position('old.payment_reference' in v_source) > 0
     or position('old.amount_requested' in v_source) = 0
     or position('old.company_id' in v_source) = 0
     or v_source !~
       'new\.approval_material_updated_at[[:space:]]*:=[[:space:]]*old\.approval_material_updated_at'
     then
    raise exception
      'layout_operational_reconcile: installed materiality contract is invalid';
  end if;

  if (
    select count(*)
    from pg_trigger trigger_info
    where trigger_info.tgrelid = 'public.payment_requests'::regclass
      and trigger_info.tgname in (
        'mark_payment_request_material_change',
        'set_payment_requests_updated_at',
        'invalidate_extraordinary_on_material_change'
      )
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled <> 'D'
  ) <> 3 then
    raise exception
      'layout_operational_reconcile: repair triggers are not enabled';
  end if;

  if not exists (
    select 1
    from public.payment_requests request
    where request.request_number = 'SOL-2026-0006'
      and request.created_at =
        timestamptz '2026-08-09 20:48:05.077627+00'
  ) then
    return;
  end if;

  select *
    into strict v_request
  from public.payment_requests request
  where request.request_number = 'SOL-2026-0006'
    and request.created_at =
      timestamptz '2026-08-09 20:48:05.077627+00';

  select item.*
    into strict v_item
  from public.approval_batch_items item
  where item.payment_request_id = v_request.id
    and item.removed_at is null
    and item.director_status = 'approved'
    and item.finance_release_status = 'released';

  select snapshot.*
    into strict v_snapshot
  from public.payable_snapshots snapshot
  where snapshot.payment_request_id = v_request.id
    and snapshot.version = 1
    and snapshot.source_id = v_item.id;

  select
    candidate.classification,
    candidate.missing_fields,
    candidate.direction_approval_current,
    candidate.finance_approval_current
    into strict
      v_classification,
      v_missing_fields,
      v_direction_current,
      v_finance_current
  from public.approval_batch_payment_layout_candidates(
    date '2026-08-09',
    date '2026-08-15',
    v_request.company_id,
    v_request.company_bank_account_id
  ) candidate
  where candidate.payment_request_id = v_request.id;

  if v_snapshot.source_approval_material_updated_at is distinct from
       timestamptz '2026-08-09 20:48:05.124232+00'
     or v_request.approval_material_updated_at is distinct from
       v_snapshot.source_approval_material_updated_at
     or v_request.updated_at is distinct from
       timestamptz '2026-08-09 21:18:22.762217+00'
     or not public.approval_batch_request_has_current_direction_approval(
       v_request.id
     )
     or v_classification is distinct from 'ready_regular'
     or v_missing_fields is distinct from array[]::text[]
     or v_direction_current is distinct from true
     or v_finance_current is distinct from true
     or public.approval_batch_item_release_block_reason(v_item.id) is not null
     or public.approval_batch_request_has_any_execution_record(v_request.id)
     or exists (
       select 1
       from public.payment_request_receipt_links receipt_link
       where receipt_link.payment_request_id = v_request.id
     )
     or exists (
       select 1
       from public.payment_request_extraordinary_authorizations extraordinary_auth
       where extraordinary_auth.payment_request_id = v_request.id
     ) then
    raise exception
      'layout_operational_reconcile: SOL-2026-0006 did not become Layout-ready';
  end if;
end
$postcheck$;

commit;
