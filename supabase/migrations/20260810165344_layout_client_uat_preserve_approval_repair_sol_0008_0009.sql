begin;

set local lock_timeout = '5s';
set local statement_timeout = '45s';

do $install_layout_completion_rpc$
declare
  v_source text;
  v_source_hash text;
  v_acl text;
  v_acl_after text;
  v_security_definer boolean;
  v_settings text[];
  v_buggy_baseline boolean;
  v_fixed_baseline boolean;
begin
  if to_regprocedure(
    'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)'
  ) is null then
    raise exception 'layout_client_uat: completion RPC is missing';
  end if;

  select
    function_info.prosrc,
    encode(sha256(convert_to(function_info.prosrc, 'UTF8')), 'hex'),
    coalesce(function_info.proacl::text, ''),
    function_info.prosecdef,
    function_info.proconfig
    into
      v_source,
      v_source_hash,
      v_acl,
      v_security_definer,
      v_settings
  from pg_proc function_info
  where function_info.oid =
    'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)'::regprocedure;

  if not v_security_definer
     or not exists (
       select 1
       from unnest(coalesce(v_settings, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     ) then
    raise exception 'layout_client_uat: unexpected completion RPC security attributes';
  end if;

  v_buggy_baseline := v_source_hash in (
    '67b101a5402645c37acae97320440317da5747dfc88f05c5cc82056cfda420c7',
    '459f25acfc06131bc67f461e6706a0ee04bfee29692b99df9b7218a403d81e50'
  );

  v_fixed_baseline :=
    position('if p_payment_concept is null then' in lower(v_source)) > 0
    and position(
      'v_concept := v_request_before.payment_concept'
      in lower(v_source)
    ) > 0
    and position(
      'v_concept := nullif(btrim(p_payment_concept), '''')'
      in lower(v_source)
    ) > 0;

  if not v_buggy_baseline and not v_fixed_baseline then
    raise exception 'layout_client_uat: unknown completion RPC baseline (%)', v_source_hash;
  end if;

  if v_buggy_baseline then
    execute $rpc_ddl$
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
      as $rpc_body$
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
           or public.approval_batch_request_has_any_execution_record(
             v_request_before.id
           ) then
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
          raise exception
            'company_bank_account_not_found_inactive_or_company_mismatch';
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
      $rpc_body$
    $rpc_ddl$;
  end if;

  select coalesce(function_info.proacl::text, '')
    into v_acl_after
  from pg_proc function_info
  where function_info.oid =
    'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)'::regprocedure;

  if v_acl_after is distinct from v_acl then
    raise exception 'layout_client_uat: completion RPC ACL changed';
  end if;
end
$install_layout_completion_rpc$;

comment on function public.complete_payment_request_layout_data(
  uuid,uuid,text,text,date
) is
  'Finance-only atomic completion of payment-execution data. A null concept preserves the stored material value exactly.';

do $assert_materiality_contract$
declare
  v_source text;
  v_security_definer boolean;
  v_settings text[];
begin
  if to_regprocedure('public.mark_payment_request_material_change()') is null then
    raise exception 'layout_client_uat: material-change function is missing';
  end if;

  select lower(function_info.prosrc), function_info.prosecdef, function_info.proconfig
    into v_source, v_security_definer, v_settings
  from pg_proc function_info
  where function_info.oid =
    'public.mark_payment_request_material_change()'::regprocedure;

  if v_security_definer
     or not exists (
       select 1
       from unnest(coalesce(v_settings, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     )
     or position('old.amount_requested' in v_source) = 0
     or position('old.company_id' in v_source) = 0
     or v_source !~
       'new\.approval_material_updated_at[[:space:]]*:=[[:space:]]*old\.approval_material_updated_at'
     or position('company_bank_account_id' in v_source) > 0
     or position('old.due_date' in v_source) > 0
     or position('old.scheduled_payment_date' in v_source) > 0
     or position('old.payment_reference' in v_source) > 0 then
    raise exception 'layout_client_uat: operational materiality contract regressed';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_info
    where trigger_info.tgrelid = 'public.payment_requests'::regclass
      and trigger_info.tgname = 'mark_payment_request_material_change'
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled <> 'D'
  ) then
    raise exception 'layout_client_uat: material-change trigger missing or disabled';
  end if;
end
$assert_materiality_contract$;

do $repair_layout_client_targets$
declare
  v_expected record;
  v_request public.payment_requests%rowtype;
  v_item public.approval_batch_items%rowtype;
  v_batch public.approval_batches%rowtype;
  v_snapshot public.payable_snapshots%rowtype;
  v_classification text;
  v_classification_reason text;
  v_missing_fields text[];
  v_direction_current boolean;
  v_finance_current boolean;
  v_target_count integer;
  v_stale_count integer := 0;
  v_repaired_count integer := 0;
  v_updated_count integer;
begin
  select count(*)
    into v_target_count
  from public.payment_requests request
  where request.id in (
    '3d83fd86-ebd8-4017-b22e-93a0782d66d2'::uuid,
    'b5993d98-60dc-4e6a-9437-e6530e6c431f'::uuid
  );

  if v_target_count = 0 then
    return;
  end if;

  if v_target_count <> 2 then
    raise exception 'TARGET_REQUEST_FINGERPRINT_DRIFT: target count %', v_target_count;
  end if;

  execute 'lock table public.payment_requests in access exclusive mode';

  perform 1
  from public.companies company
  where company.id = '144042c1-e493-4256-a86c-cd088a8898ce'::uuid
  for share;
  perform 1
  from public.proveedores provider
  where provider.id = '921362d8-d3c7-4a9f-90f6-c9db091d0a5f'::uuid
  for share;
  perform 1
  from public.cost_centers cost_center
  where cost_center.id = '371db283-17e2-4fba-820b-b528fc422754'::uuid
  for share;
  perform 1
  from public.budget_categories category
  where category.id = '4bedd10c-bad6-410c-a3db-6433b11df45e'::uuid
  for share;
  perform 1
  from public.company_bank_accounts account
  where account.id = '050dcdf2-0798-48ed-81cf-075e56790524'::uuid
  for share;

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
    raise exception 'TARGET_REQUEST_FINGERPRINT_DRIFT: repair triggers unavailable';
  end if;

  for v_expected in
    select *
    from (values
      (
        '3d83fd86-ebd8-4017-b22e-93a0782d66d2'::uuid,
        'SOL-2026-0008'::text,
        timestamptz '2026-08-10 16:00:01.831732+00',
        684.20::numeric,
        '26031'::text,
        'PRUEBA CLIENTE SOLICITUD BATCH A'::text,
        'b5ef41188022673fba0836e3fabe0af1111aa3f7cbd1e07865c7c7cb7b5ee0e7'::text,
        timestamptz '2026-08-10 16:16:27.106844+00',
        timestamptz '2026-08-10 16:16:27.043566+00',
        timestamptz '2026-08-10 16:16:27.043566+00',
        '67b4807a-2e2d-49e2-856c-c34141ece658'::uuid,
        'e20588a9-06d9-4b63-b9e0-9407cff233db'::uuid,
        68420::bigint,
        timestamptz '2026-08-10 16:00:01.853798+00',
        timestamptz '2026-08-10 16:08:14.346627+00'
      ),
      (
        'b5993d98-60dc-4e6a-9437-e6530e6c431f'::uuid,
        'SOL-2026-0009'::text,
        timestamptz '2026-08-10 16:01:56.51856+00',
        1315.80::numeric,
        '26032'::text,
        'PRUEBA CLIENTE SOLICITUD BATCH B'::text,
        'd8845cc6fdb8fc3c7d98b64f9a6ae2de0c727cb45805146626b48fdc444b2540'::text,
        timestamptz '2026-08-10 16:13:40.525315+00',
        timestamptz '2026-08-10 16:13:42.287747+00',
        timestamptz '2026-08-10 16:13:40.459795+00',
        '919c1c31-86d2-487c-a25f-9a84287eb248'::uuid,
        '0283b184-86b1-459c-b849-12889d24a8d9'::uuid,
        131580::bigint,
        timestamptz '2026-08-10 16:01:56.572084+00',
        timestamptz '2026-08-10 16:08:14.373346+00'
      )
    ) expected(
      request_id, request_number, created_at, amount, reference,
      concept_value, concept_sha256, stale_material_at, updated_at,
      scheduled_at, item_id, snapshot_id, amount_minor,
      snapshot_material_at, snapshot_materialized_at
    )
    order by request_id
  loop
    select *
      into strict v_request
    from public.payment_requests request
    where request.id = v_expected.request_id
    for update;

    select *
      into strict v_item
    from public.approval_batch_items item
    where item.id = v_expected.item_id
      and item.payment_request_id = v_request.id
    for update;

    select *
      into strict v_batch
    from public.approval_batches batch
    where batch.id = v_item.batch_id
    for update;

    select *
      into strict v_snapshot
    from public.payable_snapshots snapshot
    where snapshot.id = v_expected.snapshot_id
      and snapshot.payment_request_id = v_request.id
    for update;

    if v_request.request_number is distinct from v_expected.request_number
       or v_request.created_at is distinct from v_expected.created_at
       or v_request.status::text is distinct from 'approved'
       or v_request.company_id is distinct from
         '144042c1-e493-4256-a86c-cd088a8898ce'::uuid
       or v_request.proveedor_id is distinct from
         '921362d8-d3c7-4a9f-90f6-c9db091d0a5f'::uuid
       or v_request.provider_id is not null
       or v_request.provider_bank_account_id is not null
       or v_request.cost_center_id is distinct from
         '371db283-17e2-4fba-820b-b528fc422754'::uuid
       or v_request.budget_category_id is distinct from
         '4bedd10c-bad6-410c-a3db-6433b11df45e'::uuid
       or v_request.amount_requested is distinct from v_expected.amount
       or v_request.currency::text is distinct from 'MXN'
       or v_request.exchange_rate is distinct from 1
       or v_request.request_type::text is distinct from 'provider_payment'
       or v_request.payment_method is not null
       or v_request.budget_month is distinct from date '2026-08-01'
       or v_request.is_extraordinary_adjustment is distinct from false
       or v_request.extraordinary_state::text is distinct from 'normal'
       or v_request.concept is distinct from v_expected.concept_value
       or v_request.description is distinct from v_expected.concept_value
       or v_request.payment_concept is distinct from v_expected.concept_value
       or encode(
         sha256(convert_to(coalesce(v_request.concept, ''), 'UTF8')),
         'hex'
       ) is distinct from v_expected.concept_sha256
       or v_request.company_bank_account_id is distinct from
         '050dcdf2-0798-48ed-81cf-075e56790524'::uuid
       or v_request.due_date is not null
       or v_request.scheduled_payment_date is distinct from date '2026-08-10'
       or v_request.payment_reference is distinct from v_expected.reference
       or v_request.scheduled_at is distinct from v_expected.scheduled_at
       or v_request.scheduled_by is distinct from
         'e514902e-aa2c-4430-aa88-515934c3d13b'::uuid
       or v_request.updated_at is distinct from v_expected.updated_at
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
           and provider.nombre_completo =
             'SERVICIOS DEMOSTRACIÓN FLUX SA DE CV'
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
         from public.budget_categories category
         where category.id = v_request.budget_category_id
           and category.code = 'RSJT-2026-R0035'
           and category.name = 'Servicios Financieros y Contables'
           and category.active
       )
       or not exists (
         select 1
         from public.company_bank_accounts account
         where account.id = v_request.company_bank_account_id
           and account.company_id = v_request.company_id
           and account.name = 'Cuenta MXN'
           and account.bank_name = 'BBVA'
           and account.account_number = '0113509621'
           and account.last4 = '9621'
           and account.clabe = '012180001135096210'
           and account.currency = 'MXN'
           and account.active
       ) then
      raise exception 'TARGET_REQUEST_FINGERPRINT_DRIFT: % request',
        v_expected.request_number;
    end if;

    if (
      select count(*)
      from public.approval_batch_items item
      where item.payment_request_id = v_request.id
    ) <> 1
       or v_item.removed_at is not null
       or v_item.director_status is distinct from 'approved'
       or v_item.decided_at is distinct from
         timestamptz '2026-08-10 16:07:07.050191+00'
       or v_item.decided_by is distinct from
         'c069a2c6-3750-48d3-994a-7d0f9fc8ddb7'::uuid
       or v_item.finance_release_status is distinct from 'released'
       or v_item.finance_released_at is distinct from
         timestamptz '2026-08-10 16:08:14.255686+00'
       or v_item.finance_released_by is distinct from
         'e514902e-aa2c-4430-aa88-515934c3d13b'::uuid
       or v_item.rebatch_status is distinct from 'not_applicable'
       or v_item.review_sequence is distinct from 1
       or v_item.previous_item_id is not null
       or v_batch.id is distinct from
         '34f98a4e-7da3-4155-8eba-c6da55786b6f'::uuid
       or v_batch.company_id is distinct from v_request.company_id
       or v_batch.label is distinct from 'CORTE DEMO CLIENTE  10/AGO/2026'
       or v_batch.status is distinct from 'closed'
       or v_batch.period_start is distinct from date '2026-08-06'
       or v_batch.period_end is distinct from date '2026-08-12'
       or v_batch.decided_at is distinct from
         timestamptz '2026-08-10 16:07:07.050191+00'
       or v_batch.closed_at is distinct from
         timestamptz '2026-08-10 16:08:14.255686+00'
       or (
         select count(*)
         from public.payable_snapshots snapshot
         where snapshot.payment_request_id = v_request.id
       ) <> 1
       or v_snapshot.version is distinct from 1
       or v_snapshot.company_id is distinct from v_request.company_id
       or v_snapshot.amount_minor is distinct from v_expected.amount_minor
       or v_snapshot.currency is distinct from 'MXN'
       or v_snapshot.source_type is distinct from 'approval_batch_item'
       or v_snapshot.source_id is distinct from v_item.id
       or v_snapshot.source_status is distinct from 'closed'
       or v_snapshot.source_approval_material_updated_at is distinct from
         v_expected.snapshot_material_at
       or v_snapshot.authorized_by is distinct from v_item.decided_by
       or v_snapshot.authorized_at is distinct from v_item.decided_at
       or v_snapshot.materialized_by is distinct from
         v_item.finance_released_by
       or v_snapshot.materialized_at is distinct from
         v_expected.snapshot_materialized_at
       or v_snapshot.source_approval_material_updated_at >=
         v_request.scheduled_at
       or public.approval_batch_request_has_any_execution_record(v_request.id)
       or exists (
         select 1 from public.payment_layout_lines line
         where line.payment_request_id = v_request.id
       )
       or exists (
         select 1 from public.payment_receipts receipt
         where receipt.payment_request_id = v_request.id
       )
       or exists (
         select 1 from public.payment_request_receipt_links receipt_link
         where receipt_link.payment_request_id = v_request.id
       )
       or exists (
         select 1
         from public.payment_request_extraordinary_authorizations authz
         where authz.payment_request_id = v_request.id
       )
       or exists (
         select 1 from public.payment_request_extraordinary_events event
         where event.payment_request_id = v_request.id
       ) then
      raise exception 'TARGET_REQUEST_FINGERPRINT_DRIFT: % approval history',
        v_expected.request_number;
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
      date '2026-08-10',
      date '2026-08-16',
      v_request.company_id,
      v_request.company_bank_account_id
    ) candidate
    where candidate.payment_request_id = v_request.id;

    if v_request.approval_material_updated_at = v_expected.stale_material_at then
      v_stale_count := v_stale_count + 1;
      if abs(extract(epoch from (
           v_request.approval_material_updated_at - v_request.scheduled_at
         ))) >= 1
         or v_classification is distinct from 'direction_reapproval_required'
         or v_classification_reason is distinct from 'stale_direction_approval'
         or v_missing_fields is distinct from
           array['direction_reapproval_required']::text[]
         or v_direction_current is distinct from false
         or v_finance_current is distinct from true then
        raise exception 'TARGET_REQUEST_FINGERPRINT_DRIFT: % regression state',
          v_expected.request_number;
      end if;
    elsif v_request.approval_material_updated_at =
          v_expected.snapshot_material_at then
      v_repaired_count := v_repaired_count + 1;
      if v_classification is distinct from 'ready_regular'
         or v_missing_fields is distinct from array[]::text[]
         or v_direction_current is distinct from true
         or v_finance_current is distinct from true then
        raise exception 'TARGET_REQUEST_FINGERPRINT_DRIFT: % repaired state',
          v_expected.request_number;
      end if;
    else
      raise exception 'TARGET_REQUEST_FINGERPRINT_DRIFT: % material timestamp',
        v_expected.request_number;
    end if;
  end loop;

  if v_repaired_count = 2 and v_stale_count = 0 then
    return;
  end if;

  if v_stale_count <> 2 or v_repaired_count <> 0 then
    raise exception
      'TARGET_REQUEST_FINGERPRINT_DRIFT: partial repair state stale %, repaired %',
      v_stale_count, v_repaired_count;
  end if;

  execute
    'alter table public.payment_requests disable trigger mark_payment_request_material_change';
  execute
    'alter table public.payment_requests disable trigger set_payment_requests_updated_at';
  execute
    'alter table public.payment_requests disable trigger invalidate_extraordinary_on_material_change';

  update public.payment_requests request
  set approval_material_updated_at = expected.snapshot_material_at
  from (values
    (
      '3d83fd86-ebd8-4017-b22e-93a0782d66d2'::uuid,
      timestamptz '2026-08-10 16:16:27.106844+00',
      timestamptz '2026-08-10 16:00:01.853798+00'
    ),
    (
      'b5993d98-60dc-4e6a-9437-e6530e6c431f'::uuid,
      timestamptz '2026-08-10 16:13:40.525315+00',
      timestamptz '2026-08-10 16:01:56.572084+00'
    )
  ) expected(request_id, stale_material_at, snapshot_material_at)
  where request.id = expected.request_id
    and request.approval_material_updated_at = expected.stale_material_at;

  get diagnostics v_updated_count = row_count;

  execute
    'alter table public.payment_requests enable trigger invalidate_extraordinary_on_material_change';
  execute
    'alter table public.payment_requests enable trigger set_payment_requests_updated_at';
  execute
    'alter table public.payment_requests enable trigger mark_payment_request_material_change';

  if v_updated_count <> 2 then
    raise exception 'TARGET_REQUEST_FINGERPRINT_DRIFT: repaired % rows',
      v_updated_count;
  end if;
end
$repair_layout_client_targets$;

do $postcheck_layout_client_uat$
declare
  v_source text;
  v_target_count integer;
  v_ready_count integer;
  v_ready_numbers text[];
  v_expected record;
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
    'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)'::regprocedure;

  if position('if p_payment_concept is null then' in v_source) = 0
     or position(
       'v_concept := v_request_before.payment_concept'
       in v_source
     ) = 0
     or position(
       'v_concept := nullif(btrim(p_payment_concept), '''')'
       in v_source
     ) = 0
     or v_source ~
       'v_request_before\.payment_concept[\s\S]*v_request_before\.concept[\s\S]*v_request_before\.description' then
    raise exception 'layout_client_uat: completion RPC postcheck failed';
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
    raise exception 'layout_client_uat: repair triggers not enabled';
  end if;

  select count(*)
    into v_target_count
  from public.payment_requests request
  where request.id in (
    '3d83fd86-ebd8-4017-b22e-93a0782d66d2'::uuid,
    'b5993d98-60dc-4e6a-9437-e6530e6c431f'::uuid
  );

  if v_target_count = 0 then
    return;
  end if;

  if v_target_count <> 2 then
    raise exception 'layout_client_uat: postcheck target count %', v_target_count;
  end if;

  for v_expected in
    select *
    from (values
      (
        '3d83fd86-ebd8-4017-b22e-93a0782d66d2'::uuid,
        'SOL-2026-0008'::text,
        '67b4807a-2e2d-49e2-856c-c34141ece658'::uuid,
        'e20588a9-06d9-4b63-b9e0-9407cff233db'::uuid,
        timestamptz '2026-08-10 16:00:01.853798+00',
        timestamptz '2026-08-10 16:16:27.043566+00',
        '26031'::text
      ),
      (
        'b5993d98-60dc-4e6a-9437-e6530e6c431f'::uuid,
        'SOL-2026-0009'::text,
        '919c1c31-86d2-487c-a25f-9a84287eb248'::uuid,
        '0283b184-86b1-459c-b849-12889d24a8d9'::uuid,
        timestamptz '2026-08-10 16:01:56.572084+00',
        timestamptz '2026-08-10 16:13:42.287747+00',
        '26032'::text
      )
    ) expected(
      request_id, request_number, item_id, snapshot_id,
      snapshot_material_at, updated_at, reference
    )
  loop
    select * into strict v_request
    from public.payment_requests request
    where request.id = v_expected.request_id;

    select * into strict v_item
    from public.approval_batch_items item
    where item.id = v_expected.item_id
      and item.payment_request_id = v_request.id;

    select * into strict v_snapshot
    from public.payable_snapshots snapshot
    where snapshot.id = v_expected.snapshot_id
      and snapshot.payment_request_id = v_request.id;

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
      date '2026-08-10',
      date '2026-08-16',
      v_request.company_id,
      v_request.company_bank_account_id
    ) candidate
    where candidate.payment_request_id = v_request.id;

    if v_request.request_number is distinct from v_expected.request_number
       or v_request.status::text is distinct from 'approved'
       or v_request.approval_material_updated_at is distinct from
         v_expected.snapshot_material_at
       or v_snapshot.source_approval_material_updated_at is distinct from
         v_expected.snapshot_material_at
       or v_request.updated_at is distinct from v_expected.updated_at
       or v_request.scheduled_payment_date is distinct from date '2026-08-10'
       or v_request.payment_reference is distinct from v_expected.reference
       or v_request.company_bank_account_id is distinct from
         '050dcdf2-0798-48ed-81cf-075e56790524'::uuid
       or not public.approval_batch_request_has_current_direction_approval(
         v_request.id
       )
       or public.approval_batch_item_release_block_reason(v_item.id) is not null
       or v_classification is distinct from 'ready_regular'
       or v_missing_fields is distinct from array[]::text[]
       or v_direction_current is distinct from true
       or v_finance_current is distinct from true
       or public.approval_batch_request_has_any_execution_record(v_request.id)
       or exists (
         select 1 from public.payment_layout_lines line
         where line.payment_request_id = v_request.id
       )
       or exists (
         select 1 from public.payment_receipts receipt
         where receipt.payment_request_id = v_request.id
       )
       or exists (
         select 1 from public.payment_request_receipt_links receipt_link
         where receipt_link.payment_request_id = v_request.id
       )
       or exists (
         select 1
         from public.payment_request_extraordinary_authorizations authz
         where authz.payment_request_id = v_request.id
       ) then
      raise exception 'layout_client_uat: % did not become Layout-ready',
        v_expected.request_number;
    end if;
  end loop;

  select
    count(*),
    array_agg(candidate.request_number order by candidate.request_number)
    into v_ready_count, v_ready_numbers
  from public.approval_batch_payment_layout_candidates(
    date '2026-08-10',
    date '2026-08-16',
    '144042c1-e493-4256-a86c-cd088a8898ce'::uuid,
    '050dcdf2-0798-48ed-81cf-075e56790524'::uuid
  ) candidate
  where candidate.classification in (
    'ready_regular', 'ready_extraordinary', 'legacy_eligible'
  );

  if v_ready_count <> 2
     or v_ready_numbers is distinct from
       array['SOL-2026-0008','SOL-2026-0009']::text[] then
    raise exception 'layout_client_uat: expected exactly two ready targets';
  end if;
end
$postcheck_layout_client_uat$;

commit;
