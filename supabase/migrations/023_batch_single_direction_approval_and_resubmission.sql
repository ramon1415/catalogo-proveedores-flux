-- Single human approval for regular payments: Direction decides, Finance prepares and releases.
-- Keeps every batch review immutable and adds guided completion for payment-layout data.

begin;

do $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
  v_column text;
begin
  foreach v_name in array array[
    'approval_batches', 'approval_batch_items', 'approval_batch_company_settings',
    'payment_requests', 'payment_request_extraordinary_authorizations',
    'payment_layouts', 'payment_layout_lines', 'payment_receipts', 'cash_funds',
    'companies', 'company_bank_accounts', 'profiles', 'proveedores',
    'cost_centers', 'budget_categories', 'notification_events'
  ] loop
    if to_regclass('public.' || v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  foreach v_column in array array[
    'approval_material_updated_at', 'company_id', 'requested_by', 'proveedor_id',
    'cost_center_id', 'budget_category_id', 'budget_month', 'amount_requested',
    'currency', 'exchange_rate', 'is_extraordinary_adjustment', 'request_type',
    'payment_method', 'company_bank_account_id', 'scheduled_payment_date',
    'payment_reference', 'payment_concept', 'budget_decision', 'concept',
    'description', 'due_date', 'scheduled_by', 'scheduled_at', 'created_at', 'status'
  ] loop
    if not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'payment_requests'
        and c.column_name = v_column
    ) then
      v_missing := array_append(v_missing, 'payment_requests.' || v_column);
    end if;
  end loop;

  foreach v_column in array array[
    'alias', 'nombre_completo', 'beneficiary_name', 'destination_type',
    'clabe', 'cuenta_bancaria', 'convenio_number', 'activo'
  ] loop
    if not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'proveedores'
        and c.column_name = v_column
    ) then
      v_missing := array_append(v_missing, 'proveedores.' || v_column);
    end if;
  end loop;

  foreach v_column in array array['company_id', 'account_number', 'active'] loop
    if not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'company_bank_accounts'
        and c.column_name = v_column
    ) then
      v_missing := array_append(v_missing, 'company_bank_accounts.' || v_column);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception '023_precheck: faltan dependencias: %', array_to_string(v_missing, ', ');
  end if;

  if to_regprocedure('public.verify_budget_availability(uuid,uuid,uuid,date,numeric,boolean)') is null
     or to_regprocedure('public.approval_batch_require_actor()') is null
     or to_regprocedure('public.approval_batch_require_finance()') is null
     or to_regprocedure('public.approval_batch_request_open_elsewhere(uuid,uuid)') is null
     or to_regprocedure('public.approval_batch_request_has_current_direction_approval(uuid)') is null
     or to_regprocedure('public.approval_batch_request_has_any_execution_record(uuid)') is null
     or to_regprocedure('public.approval_batch_request_has_active_extraordinary(uuid)') is null then
    raise exception '023_precheck: migrations 021/022 no estan instaladas completamente';
  end if;

  if exists (
    select 1
    from public.approval_batch_items abi
    where abi.removed_at is null
      and abi.director_status = 'pending'
    group by abi.payment_request_id
    having count(*) > 1
  ) then
    raise exception '023_precheck: existen solicitudes con mas de una revision pendiente';
  end if;
end
$$;

alter table public.approval_batch_items
  add column if not exists previous_item_id uuid,
  add column if not exists review_sequence integer,
  add column if not exists resubmitted_at timestamptz,
  add column if not exists resubmitted_by uuid,
  add column if not exists resubmission_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'approval_batch_items_previous_item_fkey'
      and conrelid = 'public.approval_batch_items'::regclass
  ) then
    alter table public.approval_batch_items
      add constraint approval_batch_items_previous_item_fkey
      foreign key (previous_item_id) references public.approval_batch_items(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'approval_batch_items_resubmitted_by_fkey'
      and conrelid = 'public.approval_batch_items'::regclass
  ) then
    alter table public.approval_batch_items
      add constraint approval_batch_items_resubmitted_by_fkey
      foreign key (resubmitted_by) references public.profiles(id);
  end if;
end
$$;

with ranked as (
  select
    abi.id,
    row_number() over (
      partition by abi.payment_request_id
      order by abi.created_at, abi.id
    )::integer as sequence_number
  from public.approval_batch_items abi
  where abi.removed_at is null
)
update public.approval_batch_items abi
set review_sequence = ranked.sequence_number
from ranked
where ranked.id = abi.id
  and abi.review_sequence is distinct from ranked.sequence_number;

with chained as (
  select
    abi.id,
    lag(abi.id) over (
      partition by abi.payment_request_id
      order by abi.created_at, abi.id
    ) as prior_item_id
  from public.approval_batch_items abi
  where abi.removed_at is null
)
update public.approval_batch_items abi
set previous_item_id = chained.prior_item_id
from chained
where chained.id = abi.id
  and chained.prior_item_id is not null
  and abi.previous_item_id is null;

update public.approval_batch_items
set review_sequence = 1
where removed_at is not null
  and review_sequence is null;

alter table public.approval_batch_items
  alter column review_sequence set default 1,
  alter column review_sequence set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'approval_batch_items_review_sequence_check'
      and conrelid = 'public.approval_batch_items'::regclass
  ) then
    alter table public.approval_batch_items
      add constraint approval_batch_items_review_sequence_check
      check (review_sequence >= 1 and previous_item_id is distinct from id);
  end if;
end
$$;

create unique index if not exists approval_batch_items_request_review_uidx
  on public.approval_batch_items(payment_request_id, review_sequence)
  where removed_at is null;

create unique index if not exists approval_batch_items_one_pending_review_uidx
  on public.approval_batch_items(payment_request_id)
  where removed_at is null and director_status = 'pending';

create index if not exists approval_batch_items_previous_item_idx
  on public.approval_batch_items(previous_item_id)
  where previous_item_id is not null;

comment on column public.approval_batch_items.finance_reviewed_by is
  'Compatibilidad historica: en el modelo 023 identifica a quien preparo/incorporo la solicitud al corte; no representa una aprobacion humana individual.';
comment on column public.approval_batch_items.finance_reviewed_at is
  'Compatibilidad historica: fecha de preparacion/incorporacion operativa al corte.';
comment on column public.approval_batch_items.previous_item_id is
  'Revision previa de la misma solicitud. Las decisiones historicas nunca se sobrescriben.';
comment on column public.approval_batch_items.review_sequence is
  'Numero secuencial de revision por Direccion para la solicitud.';

create or replace function public.approval_batch_budget_validation(
  p_payment_request_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_amount numeric;
  v_result jsonb;
  v_available numeric;
  v_adjusted_available numeric;
begin
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id;
  if not found then
    return jsonb_build_object('status', 'bloqueado', 'motivo', 'payment_request_not_found');
  end if;

  if v_request.company_id is null
     or v_request.cost_center_id is null
     or v_request.budget_category_id is null
     or v_request.budget_month is null then
    return jsonb_build_object(
      'status', 'bloqueado',
      'motivo', 'budget_validation_data_missing',
      'disponible_actual', 0,
      'disponible_despues', null,
      'faltante', coalesce(v_request.amount_requested, 0)
    );
  end if;

  v_amount := round(
    coalesce(v_request.amount_requested, 0) * coalesce(v_request.exchange_rate, 1),
    2
  );
  v_result := public.verify_budget_availability(
    v_request.company_id,
    v_request.cost_center_id,
    v_request.budget_category_id,
    v_request.budget_month,
    v_amount,
    coalesce(v_request.is_extraordinary_adjustment, false)
  );

  if coalesce(v_result ->> 'status', 'bloqueado') = 'aprobable' then
    return v_result || jsonb_build_object('validation_source', 'canonical_live');
  end if;

  -- The canonical view already counts this active request. Add only its own
  -- commitment back before revalidating; all other commitments stay counted.
  if v_result ->> 'motivo' = 'sin_disponible'
     and v_request.budget_decision = 'aprobable'
     and v_request.status::text in (
       'submitted', 'pending_approval', 'approved', 'finance_validation', 'scheduled', 'paid'
     ) then
    v_available := coalesce(nullif(v_result ->> 'disponible_actual', '')::numeric, 0);
    v_adjusted_available := v_available + v_amount;
    if v_adjusted_available >= v_amount then
      return jsonb_build_object(
        'status', 'aprobable',
        'motivo', null,
        'disponible_actual', v_adjusted_available,
        'disponible_despues', v_adjusted_available - v_amount,
        'faltante', 0,
        'validation_source', 'canonical_live_excluding_current_request'
      );
    end if;
  end if;

  return v_result || jsonb_build_object('validation_source', 'canonical_live');
end
$$;

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
      coalesce(budget.result ->> 'status', 'bloqueado') = 'aprobable' as budget_validation_current,
      budget.result ->> 'motivo' as budget_reason,
      public.approval_batch_request_has_current_direction_approval(pr.id) as direction_approval_current,
      latest_item.decided_at as direction_decided_at,
      coalesce(latest_item.decided_at >= pr.approval_material_updated_at, false) as direction_decision_fresh,
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
      extra.authorized_at >= pr.approval_material_updated_at as extraordinary_authorization_current,
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
        case when nullif(btrim(pr.payment_reference), '') is null then 'payment_reference' end,
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
    left join public.approval_batch_company_settings settings on settings.company_id = pr.company_id
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
    left join public.profiles rejected_profile on rejected_profile.id = latest_item.rejected_by
    left join lateral (
      select prea.id, prea.category, prea.reason, prea.authorized_by, prea.authorized_at
      from public.payment_request_extraordinary_authorizations prea
      where prea.payment_request_id = pr.id
        and prea.status = 'active'
      order by prea.authorized_at desc
      limit 1
    ) extra on true
    left join public.profiles extra_profile on extra_profile.id = extra.authorized_by
    where coalesce(
        nullif(pr.payment_method, ''),
        case when pr.request_type::text in ('cash', 'check') then pr.request_type::text else 'transfer' end
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
        when not b.budget_validation_current then 'invalid_data'
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
        when not b.budget_validation_current then coalesce(b.budget_reason, 'budget_validation_required')
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
      case when m.extraordinary_authorization_id is not null and not coalesce(m.extraordinary_authorization_current, false) then 'extraordinary_reauthorization_required' end,
      case when m.extraordinary_authorization_id is null and not m.budget_validation_current then 'budget_revalidation_required' end,
      case when m.classification = 'direction_reapproval_required' then 'direction_reapproval_required' end
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

create or replace function public.preview_payment_layout_eligibility(
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
  if p_period_start is null or p_period_end is null then raise exception 'period_dates_required'; end if;
  if p_period_start > p_period_end then raise exception 'invalid_period_range'; end if;
  if p_company_id is not null and not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'company_not_found';
  end if;
  if p_company_bank_account_id is not null and not exists (
    select 1 from public.company_bank_accounts
    where id = p_company_bank_account_id
      and coalesce(active, true)
      and (p_company_id is null or company_id = p_company_id)
  ) then
    raise exception 'company_bank_account_not_found_or_inactive';
  end if;

  with candidates as (
    select * from public.approval_batch_payment_layout_candidates(
      p_period_start, p_period_end, p_company_id, p_company_bank_account_id
    )
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
      'payment_method', coalesce(nullif(pr.payment_method, ''), case when pr.request_type::text in ('cash', 'check') then pr.request_type::text else 'transfer' end),
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
    ) as payload, rejected.decided_at, pr.request_number, rejected.review_sequence
    from public.approval_batch_items rejected
    join public.approval_batches source_batch on source_batch.id = rejected.batch_id
    join public.payment_requests pr on pr.id = rejected.payment_request_id
    join public.companies c on c.id = pr.company_id
    left join public.proveedores p on p.id = pr.proveedor_id
    left join public.cost_centers cc on cc.id = pr.cost_center_id
    left join public.budget_categories bc on bc.id = pr.budget_category_id
    left join public.profiles director on director.id = rejected.decided_by
    left join public.profiles releaser on releaser.id = rejected.rebatch_released_by
    left join public.approval_batch_items target on target.previous_item_id = rejected.id
    left join public.approval_batches target_batch on target_batch.id = target.batch_id
    where rejected.removed_at is null
      and rejected.director_status = 'rejected'
      and coalesce(pr.scheduled_payment_date, pr.created_at::date) between p_period_start and p_period_end
      and (p_company_id is null or pr.company_id = p_company_id)
      and (p_company_bank_account_id is null or pr.company_bank_account_id = p_company_bank_account_id or pr.company_bank_account_id is null)
  ), totals as (
    select classification, currency, count(*) as payment_count, sum(amount) as amount
    from candidates
    where classification in ('ready_regular', 'ready_extraordinary', 'legacy_eligible')
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
    if v_latest.director_status = 'rejected' and v_latest.rebatch_status = 'released' then
      v_origin := 'resubmission';
    elsif v_latest.director_status = 'approved'
          and coalesce(v_latest.decided_at < v_request.approval_material_updated_at, true) then
      v_origin := 'material_change_review';
    end if;
  end if;

  v_payment_method := coalesce(
    nullif(v_request.payment_method, ''),
    case when v_request.request_type::text in ('cash', 'check') then v_request.request_type::text else 'transfer' end
  );

  if v_request.company_id is null then v_missing := array_append(v_missing, 'company_id'); end if;
  if v_request.requested_by is null then v_missing := array_append(v_missing, 'requested_by'); end if;
  if v_request.proveedor_id is null and v_payment_method = 'transfer' then v_missing := array_append(v_missing, 'proveedor_id'); end if;
  if v_request.cost_center_id is null then v_missing := array_append(v_missing, 'cost_center_id'); end if;
  if v_request.budget_category_id is null then v_missing := array_append(v_missing, 'budget_category_id'); end if;
  if v_request.budget_month is null then v_missing := array_append(v_missing, 'budget_month'); end if;
  if coalesce(v_request.amount_requested, 0) <= 0 then v_missing := array_append(v_missing, 'amount_requested'); end if;
  if nullif(btrim(v_request.currency), '') is null then v_missing := array_append(v_missing, 'currency'); end if;

  if public.approval_batch_request_has_any_execution_record(v_request.id) then
    v_classification := 'already_executed';
    v_reason := 'payment_request_already_executed';
  elsif public.approval_batch_request_has_active_extraordinary(v_request.id) then
    v_classification := 'extraordinary';
    v_reason := 'extraordinary_authorization_active';
  elsif public.approval_batch_request_open_elsewhere(v_request.id, p_exclude_batch_id) then
    v_classification := 'already_in_open_batch';
    v_reason := 'payment_request_in_another_open_batch';
  elsif public.approval_batch_request_has_current_direction_approval(v_request.id) then
    v_classification := 'already_authorized';
    v_reason := 'direction_approval_already_current';
  elsif v_latest.director_status = 'rejected' and v_latest.rebatch_status = 'blocked' then
    v_classification := 'rejected_by_direction';
    v_reason := 'direction_rejection_requires_correction';
  elsif v_latest.director_status = 'approved'
        and v_latest.batch_status in ('approved', 'partially_approved')
        and coalesce(v_latest.decided_at >= v_request.approval_material_updated_at, false) then
    v_classification := 'pending_finance_close';
    v_reason := 'finance_close_required';
  elsif lower(v_request.request_type::text) in ('payroll', 'nomina') then
    v_classification := 'invalid_data';
    v_reason := 'payroll_uses_separate_flow';
  elsif cardinality(v_missing) > 0 then
    v_classification := 'invalid_data';
    v_reason := 'minimum_direction_data_missing';
  elsif v_request.status::text not in ('submitted', 'pending_approval', 'approved') then
    v_classification := 'invalid_data';
    v_reason := 'request_status_not_batch_eligible';
  else
    v_budget := public.approval_batch_budget_validation(v_request.id);
    if coalesce(v_budget ->> 'status', 'bloqueado') <> 'aprobable' then
      v_classification := case
        when v_budget ->> 'motivo' in ('sin_disponible', 'partida_no_presupuestada', 'sin_match_presupuesto')
          then 'budget_insufficient'
        else 'budget_validation_required'
      end;
      v_reason := coalesce(v_budget ->> 'motivo', 'budget_validation_required');
    else
      v_classification := 'ready_for_batch';
      v_reason := null;
      v_eligible := true;
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
    'budget_available', nullif(v_budget ->> 'disponible_actual', '')::numeric,
    'budget_after', nullif(v_budget ->> 'disponible_despues', '')::numeric,
    'budget_shortfall', nullif(v_budget ->> 'faltante', '')::numeric,
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

create or replace function public.approval_batch_request_base_eligible(
  p_payment_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (public.approval_batch_request_eligibility(p_payment_request_id, null) ->> 'eligible')::boolean,
    false
  );
$$;

create or replace function public.list_batch_eligible_requests(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.approval_batch_require_finance();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pr.id,
      'request_number', pr.request_number,
      'company_id', pr.company_id,
      'company_name', coalesce(nullif(btrim(c.legal_name), ''), c.name),
      'provider_name', coalesce(nullif(btrim(p.alias), ''), p.nombre_completo),
      'cost_center', coalesce(nullif(btrim(cc.code), '') || ' - ', '') || cc.name,
      'budget_category', coalesce(nullif(btrim(bc.code), '') || ' - ', '') || bc.name,
      'payment_method', coalesce(
        nullif(pr.payment_method, ''),
        case when pr.request_type::text in ('cash', 'check') then pr.request_type::text else 'transfer' end
      ),
      'currency', pr.currency,
      'amount', pr.amount_requested,
      'status', pr.status,
      'requested_by', pr.requested_by,
      'requester_name', requester.full_name,
      'created_at', pr.created_at,
      'eligible', coalesce((eligibility.result ->> 'eligible')::boolean, false),
      'classification', eligibility.result ->> 'classification',
      'classification_reason', eligibility.result ->> 'reason',
      'origin', eligibility.result ->> 'origin',
      'review_sequence', coalesce((eligibility.result ->> 'review_sequence')::integer, 1),
      'budget_status', eligibility.result ->> 'budget_status',
      'budget_reason', eligibility.result ->> 'budget_reason',
      'budget_available', nullif(eligibility.result ->> 'budget_available', '')::numeric,
      'budget_after', nullif(eligibility.result ->> 'budget_after', '')::numeric,
      'budget_shortfall', nullif(eligibility.result ->> 'budget_shortfall', '')::numeric,
      'missing_fields', coalesce(eligibility.result -> 'missing_fields', '[]'::jsonb),
      'previous_item_id', nullif(eligibility.result ->> 'previous_item_id', '')::uuid,
      'previous_batch_id', nullif(eligibility.result ->> 'previous_batch_id', '')::uuid,
      'previous_batch_label', eligibility.result ->> 'previous_batch_label',
      'previous_reject_reason', eligibility.result ->> 'previous_reject_reason',
      'previous_correction_note', eligibility.result ->> 'previous_correction_note',
      'previous_decided_at', nullif(eligibility.result ->> 'previous_decided_at', '')::timestamptz
    ) order by
      coalesce((eligibility.result ->> 'eligible')::boolean, false) desc,
      pr.created_at,
      pr.id)
    from public.payment_requests pr
    join public.companies c on c.id = pr.company_id
    left join public.proveedores p on p.id = pr.proveedor_id
    left join public.cost_centers cc on cc.id = pr.cost_center_id
    left join public.budget_categories bc on bc.id = pr.budget_category_id
    left join public.profiles requester on requester.id = pr.requested_by
    cross join lateral (
      select public.approval_batch_request_eligibility(pr.id, null) as result
    ) eligibility
    where pr.company_id = p_company_id
      and pr.status::text in ('submitted', 'pending_approval', 'approved', 'rejected', 'changes_requested')
  ), '[]'::jsonb);
end
$$;

create or replace function public.add_request_to_approval_batch(
  p_batch_id uuid,
  p_payment_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
  v_eligibility jsonb;
  v_previous record;
  v_review_sequence integer;
  v_item_id uuid;
  v_resubmission_note text;
begin
  v_actor := public.approval_batch_require_finance();
  select * into v_batch
  from public.approval_batches
  where id = p_batch_id
  for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status <> 'draft' then raise exception 'batch_must_be_draft'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_payment_request_id::text, 21021));
  v_eligibility := public.approval_batch_request_eligibility(p_payment_request_id, null);
  if not coalesce((v_eligibility ->> 'eligible')::boolean, false) then
    raise exception 'payment_request_not_batch_eligible:%', coalesce(v_eligibility ->> 'classification', 'unknown');
  end if;
  if not exists (
    select 1 from public.payment_requests pr
    where pr.id = p_payment_request_id and pr.company_id = v_batch.company_id
  ) then
    raise exception 'batch_request_company_mismatch';
  end if;

  select abi.id, abi.review_sequence, abi.director_status,
         abi.rebatch_status, abi.rebatch_release_note
    into v_previous
  from public.approval_batch_items abi
  where abi.payment_request_id = p_payment_request_id
    and abi.removed_at is null
  order by abi.review_sequence desc, abi.created_at desc, abi.id desc
  limit 1;

  select coalesce(max(abi.review_sequence), 0) + 1
    into v_review_sequence
  from public.approval_batch_items abi
  where abi.payment_request_id = p_payment_request_id
    and abi.removed_at is null;

  v_resubmission_note := case
    when v_previous.id is null then null
    when nullif(btrim(v_previous.rebatch_release_note), '') is not null
      then v_previous.rebatch_release_note
    else 'Nueva revision requerida por cambio material posterior a la decision anterior.'
  end;

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
    p_batch_id,
    p_payment_request_id,
    v_actor,
    now(),
    v_previous.id,
    v_review_sequence,
    case when v_previous.id is null then null else now() end,
    case when v_previous.id is null then null else v_actor end,
    v_resubmission_note
  )
  returning id into v_item_id;

  return jsonb_build_object(
    'item_id', v_item_id,
    'status', 'pending',
    'review_sequence', v_review_sequence,
    'previous_item_id', v_previous.id,
    'origin', v_eligibility ->> 'origin'
  );
end
$$;

create or replace function public.submit_approval_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
  v_count integer;
  v_invalid record;
begin
  v_actor := public.approval_batch_require_finance();
  select * into v_batch
  from public.approval_batches
  where id = p_batch_id
  for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status <> 'draft' then raise exception 'batch_must_be_draft'; end if;

  select count(*) into v_count
  from public.approval_batch_items abi
  where abi.batch_id = p_batch_id and abi.removed_at is null;
  if v_count = 0 then raise exception 'batch_requires_items'; end if;

  for v_invalid in
    select
      abi.payment_request_id,
      pr.request_number,
      public.approval_batch_request_eligibility(abi.payment_request_id, p_batch_id) as result
    from public.approval_batch_items abi
    join public.payment_requests pr on pr.id = abi.payment_request_id
    where abi.batch_id = p_batch_id
      and abi.removed_at is null
      and not coalesce(
        (public.approval_batch_request_eligibility(abi.payment_request_id, p_batch_id) ->> 'eligible')::boolean,
        false
      )
    order by abi.payment_request_id
  loop
    raise exception 'batch_contains_ineligible_request:%', jsonb_build_object(
      'payment_request_id', v_invalid.payment_request_id,
      'request_number', v_invalid.request_number,
      'classification', v_invalid.result ->> 'classification',
      'reason', v_invalid.result ->> 'reason'
    )::text;
  end loop;

  update public.approval_batches
  set status = 'submitted', submitted_by = v_actor, submitted_at = now()
  where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'submitted',
    'item_count', v_count
  );
end
$$;

create or replace function public.approve_entire_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
  v_count integer;
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

  update public.approval_batch_items
  set director_status = 'approved',
      director_reject_reason = null,
      rebatch_status = 'not_applicable',
      rebatch_released_by = null,
      rebatch_released_at = null,
      rebatch_release_note = null,
      decided_by = v_actor,
      decided_at = now()
  where batch_id = p_batch_id
    and removed_at is null
    and director_status = 'pending';
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'batch_has_no_pending_items'; end if;

  select count(*) into v_rejected
  from public.approval_batch_items
  where batch_id = p_batch_id
    and removed_at is null
    and director_status = 'rejected';

  v_final_status := case when v_rejected > 0 then 'partially_approved' else 'approved' end;
  update public.approval_batches
  set status = v_final_status,
      decided_by = v_actor,
      decided_at = now()
  where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', v_final_status,
    'approved_items', v_count,
    'rejected_items', v_rejected,
    'approval_model', 'single_direction'
  );
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
    if v_approved = 0 then
      raise exception 'batch_requires_at_least_one_approved_item';
    end if;
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
  if not found then raise exception 'rejected_batch_item_not_found'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_payment_request_id::text, 21021));

  select * into v_item
  from public.approval_batch_items
  where id = p_rejected_item_id
    and payment_request_id = v_payment_request_id
  for update;
  if not found then raise exception 'rejected_batch_item_not_found'; end if;

  select * into v_source_batch
  from public.approval_batches
  where id = v_item.batch_id
  for update;
  if not found then raise exception 'source_batch_not_found'; end if;

  select * into v_request
  from public.payment_requests
  where id = v_item.payment_request_id
  for update;
  if not found then raise exception 'payment_request_not_found'; end if;

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
  if public.approval_batch_request_open_elsewhere(v_request.id, p_target_batch_id) then
    raise exception 'payment_request_in_another_open_batch';
  end if;
  if v_request.status::text not in ('submitted', 'pending_approval', 'approved') then
    raise exception 'request_status_not_batch_eligible';
  end if;

  v_payment_method := coalesce(
    nullif(v_request.payment_method, ''),
    case when v_request.request_type::text in ('cash', 'check') then v_request.request_type::text else 'transfer' end
  );
  if v_request.company_id is null
     or v_request.requested_by is null
     or (v_request.proveedor_id is null and v_payment_method = 'transfer')
     or v_request.cost_center_id is null
     or v_request.budget_category_id is null
     or v_request.budget_month is null
     or coalesce(v_request.amount_requested, 0) <= 0
     or nullif(btrim(v_request.currency), '') is null then
    raise exception 'minimum_direction_data_missing';
  end if;

  v_budget := public.approval_batch_budget_validation(v_request.id);
  if coalesce(v_budget ->> 'status', 'bloqueado') <> 'aprobable' then
    raise exception 'budget_revalidation_required:%', coalesce(v_budget ->> 'motivo', 'unknown');
  end if;

  select coalesce(max(abi.review_sequence), 0) + 1
    into v_review_sequence
  from public.approval_batch_items abi
  where abi.payment_request_id = v_request.id
    and abi.removed_at is null;

  if p_target_batch_id is not null then
    select * into v_target_batch
    from public.approval_batches
    where id = p_target_batch_id
    for update;
    if not found then raise exception 'target_batch_not_found'; end if;
    if v_target_batch.status <> 'draft' then raise exception 'target_batch_must_be_draft'; end if;
    if v_target_batch.company_id <> v_request.company_id then
      raise exception 'target_batch_company_mismatch';
    end if;
    if exists (
      select 1
      from public.approval_batch_items abi
      where abi.batch_id = p_target_batch_id
        and abi.payment_request_id = v_request.id
        and abi.removed_at is null
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
    'status', case when v_new_item_id is null then 'resubmission_available' else 'rebatched_pending' end
  );
end
$$;

create or replace function public.get_approval_batch_detail(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
begin
  v_actor := public.approval_batch_require_actor();
  select * into v_batch
  from public.approval_batches
  where id = p_batch_id;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.director_id <> v_actor
     and not public.current_user_has_role(public.flux_finance_roles()) then
    raise exception 'batch_access_denied';
  end if;

  return jsonb_build_object(
    'batch', (
      select jsonb_build_object(
        'id', ab.id,
        'company_id', ab.company_id,
        'company_name', coalesce(nullif(btrim(c.legal_name), ''), c.name),
        'label', ab.label,
        'period_start', ab.period_start,
        'period_end', ab.period_end,
        'status', ab.status,
        'director_id', ab.director_id,
        'director_name', dp.full_name,
        'director_email', dp.email,
        'created_by', ab.created_by,
        'submitted_at', ab.submitted_at,
        'decided_at', ab.decided_at,
        'closed_at', ab.closed_at,
        'notes', ab.notes,
        'approval_model', 'single_direction',
        'can_finance_manage', public.current_user_has_role(public.flux_finance_roles()),
        'can_director_decide', ab.director_id = v_actor
      )
      from public.approval_batches ab
      join public.companies c on c.id = ab.company_id
      join public.profiles dp on dp.id = ab.director_id
      where ab.id = p_batch_id
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', abi.id,
        'payment_request_id', pr.id,
        'request_number', pr.request_number,
        'provider_name', coalesce(nullif(btrim(p.alias), ''), p.nombre_completo),
        'company_name', coalesce(nullif(btrim(c.legal_name), ''), c.name),
        'cost_center', coalesce(nullif(btrim(cc.code), '') || ' - ', '') || cc.name,
        'budget_category', coalesce(nullif(btrim(bc.code), '') || ' - ', '') || bc.name,
        'payment_method', coalesce(
          nullif(pr.payment_method, ''),
          case when pr.request_type::text in ('cash', 'check') then pr.request_type::text else 'transfer' end
        ),
        'currency', pr.currency,
        'amount', pr.amount_requested,
        'request_status', pr.status,
        'director_status', abi.director_status,
        'reject_reason', abi.director_reject_reason,
        'rebatch_status', abi.rebatch_status,
        'rebatch_released_at', abi.rebatch_released_at,
        'rebatch_release_note', abi.rebatch_release_note,
        'requester_name', requester.full_name,
        'finance_reviewed_at', abi.finance_reviewed_at,
        'prepared_at', abi.finance_reviewed_at,
        'decided_at', abi.decided_at,
        'decided_by_name', decider.full_name,
        'previous_item_id', abi.previous_item_id,
        'review_sequence', abi.review_sequence,
        'resubmitted_at', abi.resubmitted_at,
        'resubmitted_by', abi.resubmitted_by,
        'resubmitted_by_name', resubmitter.full_name,
        'resubmission_note', abi.resubmission_note,
        'previous_batch_id', previous_batch.id,
        'previous_batch_label', previous_batch.label,
        'previous_reject_reason', previous_item.director_reject_reason,
        'previous_rejected_at', previous_item.decided_at,
        'previous_decided_by_name', previous_decider.full_name,
        'previous_correction_note', previous_item.rebatch_release_note,
        'budget_status', budget.result ->> 'status',
        'budget_reason', budget.result ->> 'motivo',
        'budget_available', nullif(budget.result ->> 'disponible_actual', '')::numeric,
        'review_history', coalesce((
          select jsonb_agg(jsonb_build_object(
            'item_id', history.id,
            'batch_id', history_batch.id,
            'batch_label', history_batch.label,
            'batch_status', history_batch.status,
            'review_sequence', history.review_sequence,
            'director_status', history.director_status,
            'reject_reason', history.director_reject_reason,
            'decided_at', history.decided_at,
            'decided_by', history.decided_by,
            'decided_by_name', history_decider.full_name,
            'rebatch_status', history.rebatch_status,
            'correction_note', history.rebatch_release_note,
            'resubmitted_at', history.resubmitted_at,
            'resubmission_note', history.resubmission_note
          ) order by history.review_sequence, history.created_at, history.id)
          from public.approval_batch_items history
          join public.approval_batches history_batch on history_batch.id = history.batch_id
          left join public.profiles history_decider on history_decider.id = history.decided_by
          where history.payment_request_id = abi.payment_request_id
            and history.removed_at is null
            and history.review_sequence <= abi.review_sequence
        ), '[]'::jsonb)
      ) order by pr.request_number, abi.created_at, abi.id)
      from public.approval_batch_items abi
      join public.payment_requests pr on pr.id = abi.payment_request_id
      join public.companies c on c.id = pr.company_id
      left join public.proveedores p on p.id = pr.proveedor_id
      left join public.cost_centers cc on cc.id = pr.cost_center_id
      left join public.budget_categories bc on bc.id = pr.budget_category_id
      left join public.profiles requester on requester.id = pr.requested_by
      left join public.profiles decider on decider.id = abi.decided_by
      left join public.profiles resubmitter on resubmitter.id = abi.resubmitted_by
      left join public.approval_batch_items previous_item on previous_item.id = abi.previous_item_id
      left join public.approval_batches previous_batch on previous_batch.id = previous_item.batch_id
      left join public.profiles previous_decider on previous_decider.id = previous_item.decided_by
      cross join lateral (
        select public.approval_batch_budget_validation(pr.id) as result
      ) budget
      where abi.batch_id = p_batch_id
        and abi.removed_at is null
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.authorize_payment_request_extraordinary(
  p_payment_request_id uuid,
  p_category text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_request public.payment_requests%rowtype;
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  v_actor := public.approval_batch_require_finance();
  if v_category not in (
    'operational_emergency',
    'urgent_reimbursement',
    'urgent_termination',
    'critical_service',
    'other'
  ) then
    raise exception 'invalid_extraordinary_category';
  end if;
  if v_reason is null or char_length(v_reason) < 20 then
    raise exception 'extraordinary_reason_too_short';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_payment_request_id::text, 21021));
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  if v_request.status::text not in ('submitted', 'pending_approval', 'approved') then
    raise exception 'payment_request_not_available_for_extraordinary';
  end if;
  if lower(v_request.request_type::text) in ('payroll', 'nomina') then
    raise exception 'payroll_extraordinary_not_supported';
  end if;
  if public.approval_batch_request_has_any_execution_record(v_request.id) then
    raise exception 'payment_request_already_executed';
  end if;
  if exists (
    select 1
    from public.payment_request_extraordinary_authorizations prea
    where prea.payment_request_id = v_request.id and prea.status = 'active'
  ) then
    raise exception 'extraordinary_authorization_already_active';
  end if;
  if exists (
    select 1
    from public.approval_batch_items abi
    where abi.payment_request_id = v_request.id
      and abi.removed_at is null
      and abi.director_status = 'rejected'
  ) then
    raise exception 'direction_rejected_request_cannot_be_extraordinary';
  end if;
  if public.approval_batch_request_has_current_direction_approval(v_request.id) then
    raise exception 'batch_approved_request_cannot_be_extraordinary';
  end if;
  if exists (
    select 1
    from public.approval_batch_items abi
    join public.approval_batches ab on ab.id = abi.batch_id
    where abi.payment_request_id = v_request.id
      and abi.removed_at is null
      and ab.status in ('draft', 'submitted')
  ) then
    raise exception 'remove_request_from_open_batch_first';
  end if;

  insert into public.payment_request_extraordinary_authorizations(
    payment_request_id,
    category,
    reason,
    authorized_by,
    authorized_at
  ) values (
    v_request.id,
    v_category,
    v_reason,
    v_actor,
    clock_timestamp()
  )
  returning id into v_id;

  return jsonb_build_object(
    'authorization_id', v_id,
    'payment_request_id', v_request.id,
    'status', 'active',
    'category', v_category,
    'reason', v_reason,
    'approval_model', 'finance_extraordinary_exception'
  );
end
$$;

create or replace function public.approval_batch_assert_execution_authorized()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_item_status text;
  v_batch_status text;
  v_has_batch_item boolean := false;
  v_direction_current boolean := false;
  v_enforced boolean := false;
  v_enforcement_started_at timestamptz;
  v_extraordinary_authorized_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.payment_request_id::text, 21021));
  select * into v_request
  from public.payment_requests
  where id = new.payment_request_id
  for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  if public.approval_batch_request_has_execution(v_request.id) then
    raise exception 'payment_request_already_executed';
  end if;

  select prea.authorized_at
    into v_extraordinary_authorized_at
  from public.payment_request_extraordinary_authorizations prea
  where prea.payment_request_id = v_request.id
    and prea.status = 'active'
  order by prea.authorized_at desc
  limit 1;

  if v_extraordinary_authorized_at is not null then
    if v_extraordinary_authorized_at < v_request.approval_material_updated_at then
      raise exception 'extraordinary_reauthorization_required';
    end if;
    if exists (
      select 1
      from public.approval_batch_items abi
      where abi.payment_request_id = v_request.id
        and abi.removed_at is null
        and abi.director_status = 'rejected'
    ) then
      raise exception 'direction_rejected_request_cannot_execute';
    end if;
    if exists (
      select 1
      from public.approval_batch_items abi
      join public.approval_batches ab on ab.id = abi.batch_id
      where abi.payment_request_id = v_request.id
        and abi.removed_at is null
        and ab.status in ('draft', 'submitted')
    ) then
      raise exception 'open_batch_blocks_extraordinary_execution';
    end if;
    return new;
  end if;

  select regular_payments_require_closed_batch, enforcement_started_at
    into v_enforced, v_enforcement_started_at
  from public.approval_batch_company_settings
  where company_id = v_request.company_id;
  v_enforced := coalesce(v_enforced, false)
    and v_enforcement_started_at is not null
    and v_request.created_at >= v_enforcement_started_at;

  select abi.director_status, ab.status
    into v_item_status, v_batch_status
  from public.approval_batch_items abi
  join public.approval_batches ab on ab.id = abi.batch_id
  where abi.payment_request_id = v_request.id
    and abi.removed_at is null
  order by abi.review_sequence desc, abi.created_at desc, abi.id desc
  limit 1;
  v_has_batch_item := found;
  v_direction_current := public.approval_batch_request_has_current_direction_approval(v_request.id);

  -- Gradual adoption remains intact for historical requests never enrolled in a batch.
  if not v_enforced and not v_has_batch_item then
    return new;
  end if;

  if not v_direction_current then
    if v_item_status = 'approved'
       and v_batch_status in ('approved', 'partially_approved', 'closed') then
      raise exception 'direction_reapproval_required';
    end if;
    if v_enforced then
      raise exception 'closed_batch_authorization_required';
    end if;
    raise exception 'batch_authorization_required';
  end if;
  return new;
end
$$;

create or replace function public.close_approval_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_status text;
  v_item record;
  v_request public.payment_requests%rowtype;
  v_budget jsonb;
  v_reason text;
  v_pending integer;
  v_approved integer;
  v_rejected integer;
  v_totals jsonb;
begin
  v_actor := public.approval_batch_require_finance();
  select status into v_status
  from public.approval_batches
  where id = p_batch_id
  for update;
  if v_status is null then raise exception 'batch_not_found'; end if;
  if v_status not in ('approved', 'partially_approved') then
    raise exception 'batch_not_ready_to_close';
  end if;

  select
    count(*) filter (where director_status = 'pending'),
    count(*) filter (where director_status = 'approved'),
    count(*) filter (where director_status = 'rejected')
  into v_pending, v_approved, v_rejected
  from public.approval_batch_items
  where batch_id = p_batch_id and removed_at is null;
  if v_pending > 0 then raise exception 'batch_has_pending_items'; end if;
  if v_approved = 0 then raise exception 'batch_requires_at_least_one_approved_item'; end if;

  for v_item in
    select abi.id as item_id, abi.payment_request_id, abi.decided_at, pr.request_number
    from public.approval_batch_items abi
    join public.payment_requests pr on pr.id = abi.payment_request_id
    where abi.batch_id = p_batch_id
      and abi.removed_at is null
      and abi.director_status = 'approved'
    order by abi.payment_request_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_item.payment_request_id::text, 21021));
    select * into v_request
    from public.payment_requests pr
    where pr.id = v_item.payment_request_id
    for update;
    v_budget := public.approval_batch_budget_validation(v_request.id);
    v_reason := null;

    if coalesce(v_budget ->> 'status', 'bloqueado') <> 'aprobable' then
      v_reason := coalesce(v_budget ->> 'motivo', 'budget_validation_required');
    elsif v_item.decided_at is null
       or v_item.decided_at < v_request.approval_material_updated_at then
      v_reason := 'request_data_changed_after_direction_decision';
    elsif exists (
      select 1
      from public.approval_batch_items later
      where later.payment_request_id = v_request.id
        and later.removed_at is null
        and later.id <> v_item.item_id
        and later.director_status in ('pending', 'rejected')
        and coalesce(later.decided_at, later.created_at) > v_item.decided_at
    ) then
      v_reason := 'direction_reapproval_required';
    elsif public.approval_batch_request_has_any_execution_record(v_request.id) then
      v_reason := 'payment_request_already_executed';
    elsif public.approval_batch_request_has_active_extraordinary(v_request.id) then
      v_reason := 'extraordinary_authorization_active';
    end if;

    if v_reason is not null then
      raise exception 'batch_close_validation_failed:%', jsonb_build_object(
        'payment_request_id', v_request.id,
        'request_number', coalesce(v_request.request_number, v_request.id::text),
        'reason', v_reason
      )::text;
    end if;
  end loop;

  update public.approval_batches
  set status = 'closed', closed_by = v_actor, closed_at = clock_timestamp()
  where id = p_batch_id;

  if exists (
    select 1
    from public.approval_batch_items abi
    where abi.batch_id = p_batch_id
      and abi.removed_at is null
      and abi.director_status = 'approved'
      and not public.approval_batch_request_has_current_direction_approval(abi.payment_request_id)
  ) then
    raise exception 'batch_close_validation_failed:direction_reapproval_required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'currency', totals.currency,
    'amount', totals.amount
  ) order by totals.currency), '[]'::jsonb)
    into v_totals
  from (
    select coalesce(nullif(upper(btrim(pr.currency)), ''), 'MXN') as currency,
           sum(pr.amount_requested) as amount
    from public.approval_batch_items abi
    join public.payment_requests pr on pr.id = abi.payment_request_id
    where abi.batch_id = p_batch_id
      and abi.removed_at is null
      and abi.director_status = 'approved'
    group by coalesce(nullif(upper(btrim(pr.currency)), ''), 'MXN')
  ) totals;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'closed',
    'release_label', 'Liberado para pago',
    'approved_released_count', v_approved,
    'rejected_blocked_count', v_rejected,
    'totals_by_currency', v_totals
  );
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
  v_request public.payment_requests%rowtype;
  v_reference text;
  v_concept text;
  v_account_id uuid;
  v_schedule date;
  v_direction_was_current boolean;
begin
  v_actor := public.approval_batch_require_finance();
  perform pg_advisory_xact_lock(hashtextextended(p_payment_request_id::text, 21021));
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  if v_request.status::text in ('paid', 'cancelled')
     or public.approval_batch_request_has_any_execution_record(v_request.id) then
    raise exception 'payment_request_layout_data_locked';
  end if;

  v_account_id := coalesce(p_company_bank_account_id, v_request.company_bank_account_id);
  if v_account_id is not null and not exists (
    select 1
    from public.company_bank_accounts cba
    where cba.id = v_account_id
      and cba.company_id = v_request.company_id
      and coalesce(cba.active, true)
      and nullif(btrim(cba.account_number), '') is not null
  ) then
    raise exception 'company_bank_account_not_found_or_inactive';
  end if;

  v_reference := coalesce(
    nullif(regexp_replace(coalesce(p_payment_reference, ''), '\D', '', 'g'), ''),
    nullif(btrim(v_request.payment_reference), '')
  );
  if p_payment_reference is not null
     and regexp_replace(p_payment_reference, '[0-9[:space:]]', '', 'g') <> '' then
    raise exception 'payment_reference_must_be_numeric';
  end if;
  if v_reference is not null and char_length(v_reference) > 5 then
    raise exception 'payment_reference_too_long';
  end if;

  v_concept := coalesce(
    nullif(btrim(coalesce(p_payment_concept, '')), ''),
    nullif(btrim(v_request.payment_concept), ''),
    nullif(btrim(v_request.concept), ''),
    nullif(btrim(v_request.description), '')
  );
  v_schedule := coalesce(p_scheduled_payment_date, v_request.scheduled_payment_date, v_request.due_date);
  v_direction_was_current := public.approval_batch_request_has_current_direction_approval(v_request.id);

  update public.payment_requests
  set company_bank_account_id = v_account_id,
      payment_reference = v_reference,
      payment_concept = v_concept,
      scheduled_payment_date = v_schedule,
      scheduled_by = case when v_schedule is distinct from scheduled_payment_date then v_actor else scheduled_by end,
      scheduled_at = case when v_schedule is distinct from scheduled_payment_date then now() else scheduled_at end,
      updated_at = now()
  where id = v_request.id;

  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id;

  return jsonb_build_object(
    'payment_request_id', v_request.id,
    'request_number', v_request.request_number,
    'company_bank_account_id', v_request.company_bank_account_id,
    'payment_reference', v_request.payment_reference,
    'payment_concept', v_request.payment_concept,
    'scheduled_payment_date', v_request.scheduled_payment_date,
    'direction_was_current', v_direction_was_current,
    'direction_approval_current', public.approval_batch_request_has_current_direction_approval(v_request.id),
    'direction_reapproval_required',
      v_direction_was_current and not public.approval_batch_request_has_current_direction_approval(v_request.id),
    'history_preserved', true
  );
end
$$;

create or replace function public.get_payment_request_execution_context(
  p_payment_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_request public.payment_requests%rowtype;
  v_extra record;
  v_batch record;
  v_is_finance boolean;
  v_executed boolean;
  v_budget jsonb;
  v_budget_current boolean;
  v_direction_current boolean;
  v_direction_stale boolean;
  v_can_authorize boolean;
  v_block_reason text;
  v_history jsonb;
begin
  v_actor := public.approval_batch_require_actor();
  v_is_finance := public.current_user_has_role(public.flux_finance_roles());
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id;
  if not found then raise exception 'payment_request_not_found'; end if;

  if not v_is_finance
     and v_request.requested_by <> v_actor
     and not exists (
       select 1
       from public.company_directors cd
       where cd.company_id = v_request.company_id
         and cd.director_profile_id = v_actor
         and cd.active
     ) then
    raise exception 'payment_request_execution_context_denied';
  end if;

  select prea.*, p.full_name as authorized_by_name
    into v_extra
  from public.payment_request_extraordinary_authorizations prea
  join public.profiles p on p.id = prea.authorized_by
  where prea.payment_request_id = v_request.id
    and prea.status = 'active'
  order by prea.authorized_at desc
  limit 1;

  select
    abi.id as item_id,
    abi.director_status,
    abi.director_reject_reason,
    abi.rebatch_status,
    abi.rebatch_release_note,
    abi.decided_at,
    abi.review_sequence,
    abi.previous_item_id,
    abi.resubmitted_at,
    abi.resubmission_note,
    ab.id as batch_id,
    ab.label as batch_label,
    ab.status as batch_status,
    ab.closed_at
  into v_batch
  from public.approval_batch_items abi
  join public.approval_batches ab on ab.id = abi.batch_id
  where abi.payment_request_id = v_request.id
    and abi.removed_at is null
  order by abi.review_sequence desc, abi.created_at desc, abi.id desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', abi.id,
    'batch_id', ab.id,
    'batch_label', ab.label,
    'batch_status', ab.status,
    'review_sequence', abi.review_sequence,
    'director_status', abi.director_status,
    'reject_reason', abi.director_reject_reason,
    'decided_at', abi.decided_at,
    'decided_by_name', decider.full_name,
    'rebatch_status', abi.rebatch_status,
    'correction_note', abi.rebatch_release_note,
    'resubmitted_at', abi.resubmitted_at,
    'resubmitted_by_name', resubmitter.full_name,
    'resubmission_note', abi.resubmission_note,
    'closed_at', ab.closed_at
  ) order by abi.review_sequence, abi.created_at), '[]'::jsonb)
    into v_history
  from public.approval_batch_items abi
  join public.approval_batches ab on ab.id = abi.batch_id
  left join public.profiles decider on decider.id = abi.decided_by
  left join public.profiles resubmitter on resubmitter.id = abi.resubmitted_by
  where abi.payment_request_id = v_request.id
    and abi.removed_at is null;

  v_executed := public.approval_batch_request_has_any_execution_record(v_request.id);
  v_budget := public.approval_batch_budget_validation(v_request.id);
  v_budget_current := coalesce(v_budget ->> 'status', 'bloqueado') = 'aprobable';
  v_direction_current := public.approval_batch_request_has_current_direction_approval(v_request.id);
  v_direction_stale := coalesce(
    v_batch.director_status = 'approved'
    and (
      v_batch.decided_at is null
      or v_batch.decided_at < v_request.approval_material_updated_at
    ),
    false
  );

  v_block_reason := case
    when not v_is_finance then 'finance_role_required'
    when v_request.status::text not in ('submitted', 'pending_approval', 'approved')
      then 'payment_request_not_available_for_extraordinary'
    when v_executed then 'payment_request_already_executed'
    when v_extra.id is not null then 'extraordinary_authorization_already_active'
    when exists (
      select 1
      from public.approval_batch_items abi
      where abi.payment_request_id = v_request.id
        and abi.removed_at is null
        and abi.director_status = 'rejected'
    ) then 'direction_rejected_request_cannot_be_extraordinary'
    when exists (
      select 1
      from public.approval_batch_items abi
      join public.approval_batches ab on ab.id = abi.batch_id
      where abi.payment_request_id = v_request.id
        and abi.removed_at is null
        and ab.status in ('draft', 'submitted')
    ) then 'remove_request_from_open_batch_first'
    when v_direction_current then 'batch_approved_request_cannot_be_extraordinary'
    else null
  end;
  v_can_authorize := v_block_reason is null;

  return jsonb_build_object(
    'payment_request_id', v_request.id,
    'is_finance', v_is_finance,
    'approval_model', 'single_direction',
    'budget_validation_current', v_budget_current,
    'budget_status', v_budget ->> 'status',
    'budget_reason', v_budget ->> 'motivo',
    'budget_available', nullif(v_budget ->> 'disponible_actual', '')::numeric,
    'finance_approval_current', v_budget_current,
    'compatibility_field_semantics', 'finance_approval_current_maps_to_budget_validation_in_023',
    'direction_approval_current', v_direction_current,
    'direction_approval_stale', v_direction_stale,
    'execution_block_reason', case
      when v_extra.id is not null
        and v_extra.authorized_at < v_request.approval_material_updated_at
        then 'extraordinary_reauthorization_required'
      when v_direction_stale then 'direction_reapproval_required'
      when v_executed then 'payment_request_already_executed'
      when v_batch.item_id is not null and not v_direction_current then 'closed_batch_authorization_required'
      else null
    end,
    'executed', v_executed,
    'can_authorize_extraordinary', v_can_authorize,
    'authorization_block_reason', v_block_reason,
    'extraordinary', case when v_extra.id is null then null else jsonb_build_object(
      'id', v_extra.id,
      'category', v_extra.category,
      'reason', v_extra.reason,
      'authorized_by', v_extra.authorized_by,
      'authorized_by_name', v_extra.authorized_by_name,
      'authorized_at', v_extra.authorized_at,
      'authorization_current', v_extra.authorized_at >= v_request.approval_material_updated_at,
      'can_revoke', v_is_finance and not v_executed,
      'revoke_block_reason', case when v_executed then 'extraordinary_already_materialized' else null end
    ) end,
    'latest_batch', case when v_batch.item_id is null then null else jsonb_build_object(
      'item_id', v_batch.item_id,
      'batch_id', v_batch.batch_id,
      'batch_label', v_batch.batch_label,
      'batch_status', v_batch.batch_status,
      'director_status', v_batch.director_status,
      'direction_approval_current', v_direction_current,
      'direction_decided_at', v_batch.decided_at,
      'closed_at', v_batch.closed_at,
      'reject_reason', v_batch.director_reject_reason,
      'rebatch_status', v_batch.rebatch_status,
      'correction_note', v_batch.rebatch_release_note,
      'review_sequence', v_batch.review_sequence,
      'previous_item_id', v_batch.previous_item_id,
      'resubmitted_at', v_batch.resubmitted_at,
      'resubmission_note', v_batch.resubmission_note
    ) end,
    'approval_history', v_history
  );
end
$$;

create or replace function public.enqueue_rebatched_item_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_source_batch public.approval_batches%rowtype;
  v_target record;
  v_company_name text;
  v_recipient record;
  v_has_recipient boolean := false;
begin
  if old.rebatch_status <> 'blocked' or new.rebatch_status <> 'released' then
    return new;
  end if;

  select * into v_request
  from public.payment_requests
  where id = new.payment_request_id;
  select * into v_source_batch
  from public.approval_batches
  where id = new.batch_id;
  select coalesce(nullif(btrim(c.legal_name), ''), c.name)
    into v_company_name
  from public.companies c
  where c.id = v_request.company_id;

  select
    abi.id as item_id,
    ab.id as batch_id,
    ab.label as batch_label,
    abi.review_sequence,
    abi.resubmitted_by,
    abi.resubmitted_at,
    abi.resubmission_note
  into v_target
  from public.approval_batch_items abi
  join public.approval_batches ab on ab.id = abi.batch_id
  where abi.previous_item_id = new.id
    and abi.payment_request_id = new.payment_request_id
    and abi.removed_at is null
    and abi.director_status = 'pending'
    and ab.status = 'draft'
  order by abi.review_sequence desc, abi.created_at desc, abi.id desc
  limit 1;

  for v_recipient in
    with candidates as (
      select p.id, p.email, 'usuario_solicitante'::text as recipient_type,
             'solicitante'::text as recipient_role, 1 as priority_order
      from public.profiles p
      where p.id = v_request.requested_by
      union all
      select p.id, p.email, 'administrador_sistema', 'finanzas', 2
      from public.profiles p
      join public.user_roles ur on ur.profile_id = p.id
      join public.roles r on r.id = ur.role_id
      where coalesce(p.active, true)
        and lower(btrim(r.name)) = any (public.flux_finance_roles())
    )
    select distinct on (lower(btrim(email))) id, email, recipient_type, recipient_role
    from candidates
    where nullif(btrim(email), '') is not null
    order by lower(btrim(email)), priority_order, id
  loop
    v_has_recipient := true;
    perform public.insert_approval_batch_notification(
      'approval_batch.item_rebatched',
      'approval_batch_items',
      new.id,
      v_request.request_number,
      v_recipient.recipient_type,
      v_recipient.id,
      v_recipient.email,
      v_recipient.recipient_role,
      'Solicitud habilitada para nueva revision: ' || coalesce(v_request.request_number, new.id::text),
      jsonb_build_object(
        'company', v_company_name,
        'folio', v_request.request_number,
        'status', case when v_target.item_id is null then 'available_for_rebatch' else 'rebatched_pending' end,
        'previous_batch_id', v_source_batch.id,
        'previous_batch_label', v_source_batch.label,
        'previous_item_id', new.id,
        'previous_reject_reason', new.director_reject_reason,
        'correction_note', new.rebatch_release_note,
        'new_batch_id', v_target.batch_id,
        'new_batch_label', v_target.batch_label,
        'new_item_id', v_target.item_id,
        'review_sequence', coalesce(v_target.review_sequence, new.review_sequence + 1),
        'resubmitted_by', coalesce(v_target.resubmitted_by, new.rebatch_released_by),
        'resubmitted_at', coalesce(v_target.resubmitted_at, new.rebatch_released_at),
        'decision_comment', new.rebatch_release_note,
        'decision_label', 'Correccion documentada',
        'path', '/approval_batches.html'
      ),
      'approval_batch.item_rebatched:' || new.id::text || ':' || coalesce(v_target.item_id::text, 'available') || ':' || v_recipient.id::text,
      'normal'
    );
  end loop;

  if not v_has_recipient then
    perform public.insert_approval_batch_notification(
      'approval_batch.item_rebatched',
      'approval_batch_items',
      new.id,
      v_request.request_number,
      'administrador_sistema',
      null,
      null,
      'finanzas',
      'Reingreso sin destinatario: ' || coalesce(v_request.request_number, new.id::text),
      jsonb_build_object(
        'company', v_company_name,
        'folio', v_request.request_number,
        'status', case when v_target.item_id is null then 'available_for_rebatch' else 'rebatched_pending' end,
        'previous_batch_id', v_source_batch.id,
        'previous_batch_label', v_source_batch.label,
        'previous_item_id', new.id,
        'previous_reject_reason', new.director_reject_reason,
        'correction_note', new.rebatch_release_note,
        'new_batch_id', v_target.batch_id,
        'new_batch_label', v_target.batch_label,
        'new_item_id', v_target.item_id,
        'review_sequence', coalesce(v_target.review_sequence, new.review_sequence + 1),
        'resubmitted_by', coalesce(v_target.resubmitted_by, new.rebatch_released_by),
        'resubmitted_at', coalesce(v_target.resubmitted_at, new.rebatch_released_at),
        'decision_comment', new.rebatch_release_note,
        'decision_label', 'Correccion documentada',
        'path', '/approval_batches.html'
      ),
      'approval_batch.item_rebatched:' || new.id::text || ':' || coalesce(v_target.item_id::text, 'available') || ':missing_recipient',
      'normal'
    );
  end if;
  return new;
end
$$;

revoke all on function public.approval_batch_budget_validation(uuid) from public, anon, authenticated;
revoke all on function public.approval_batch_request_eligibility(uuid,uuid) from public, anon, authenticated;
revoke all on function public.approval_batch_request_base_eligible(uuid) from public, anon, authenticated;
revoke all on function public.approval_batch_payment_layout_candidates(date,date,uuid,uuid) from public, anon, authenticated;
revoke all on function public.approval_batch_assert_execution_authorized() from public, anon, authenticated;
revoke all on function public.enqueue_rebatched_item_notification() from public, anon, authenticated;

revoke all on function public.list_batch_eligible_requests(uuid) from public, anon;
revoke all on function public.add_request_to_approval_batch(uuid,uuid) from public, anon;
revoke all on function public.submit_approval_batch(uuid) from public, anon;
revoke all on function public.approve_entire_batch(uuid) from public, anon;
revoke all on function public.decide_approval_batch_items(uuid,jsonb) from public, anon;
revoke all on function public.release_and_rebatch_rejected_request(uuid,text,uuid) from public, anon;
revoke all on function public.get_approval_batch_detail(uuid) from public, anon;
revoke all on function public.close_approval_batch(uuid) from public, anon;
revoke all on function public.authorize_payment_request_extraordinary(uuid,text,text) from public, anon;
revoke all on function public.get_payment_request_execution_context(uuid) from public, anon;
revoke all on function public.preview_payment_layout_eligibility(date,date,uuid,uuid) from public, anon;
revoke all on function public.complete_payment_request_layout_data(uuid,uuid,text,text,date) from public, anon;

grant execute on function public.list_batch_eligible_requests(uuid) to authenticated;
grant execute on function public.add_request_to_approval_batch(uuid,uuid) to authenticated;
grant execute on function public.submit_approval_batch(uuid) to authenticated;
grant execute on function public.approve_entire_batch(uuid) to authenticated;
grant execute on function public.decide_approval_batch_items(uuid,jsonb) to authenticated;
grant execute on function public.release_and_rebatch_rejected_request(uuid,text,uuid) to authenticated;
grant execute on function public.get_approval_batch_detail(uuid) to authenticated;
grant execute on function public.close_approval_batch(uuid) to authenticated;
grant execute on function public.authorize_payment_request_extraordinary(uuid,text,text) to authenticated;
grant execute on function public.get_payment_request_execution_context(uuid) to authenticated;
grant execute on function public.preview_payment_layout_eligibility(date,date,uuid,uuid) to authenticated;
grant execute on function public.complete_payment_request_layout_data(uuid,uuid,text,text,date) to authenticated;

do $$
begin
  if to_regprocedure('public.approval_batch_budget_validation(uuid)') is null
     or to_regprocedure('public.approval_batch_request_eligibility(uuid,uuid)') is null
     or to_regprocedure('public.list_batch_eligible_requests(uuid)') is null
     or to_regprocedure('public.add_request_to_approval_batch(uuid,uuid)') is null
     or to_regprocedure('public.submit_approval_batch(uuid)') is null
     or to_regprocedure('public.approve_entire_batch(uuid)') is null
     or to_regprocedure('public.decide_approval_batch_items(uuid,jsonb)') is null
     or to_regprocedure('public.release_and_rebatch_rejected_request(uuid,text,uuid)') is null
     or to_regprocedure('public.get_approval_batch_detail(uuid)') is null
     or to_regprocedure('public.close_approval_batch(uuid)') is null
     or to_regprocedure('public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)') is null
     or to_regprocedure('public.preview_payment_layout_eligibility(date,date,uuid,uuid)') is null
     or to_regprocedure('public.complete_payment_request_layout_data(uuid,uuid,text,text,date)') is null
     or to_regprocedure('public.get_payment_request_execution_context(uuid)') is null then
    raise exception '023_postcheck: faltan funciones nuevas';
  end if;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'approval_batch_items'
      and c.column_name = 'previous_item_id'
  ) or not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'approval_batch_items'
      and c.column_name = 'review_sequence'
      and c.is_nullable = 'NO'
  ) then
    raise exception '023_postcheck: faltan columnas de historial';
  end if;

  if to_regclass('public.approval_batch_items_request_review_uidx') is null
     or to_regclass('public.approval_batch_items_one_pending_review_uidx') is null
     or to_regclass('public.approval_batch_items_previous_item_idx') is null then
    raise exception '023_postcheck: faltan indices de historial o concurrencia';
  end if;

  if exists (
    select 1
    from public.approval_batch_items abi
    where abi.removed_at is null
      and abi.director_status = 'pending'
    group by abi.payment_request_id
    having count(*) > 1
  ) then
    raise exception '023_postcheck: existe mas de una revision pendiente por solicitud';
  end if;

  if exists (
    select 1
    from public.approval_batch_items abi
    where abi.removed_at is null
    group by abi.payment_request_id, abi.review_sequence
    having count(*) > 1
  ) then
    raise exception '023_postcheck: secuencias de revision duplicadas';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'approval_batch_request_eligibility',
        'add_request_to_approval_batch',
        'submit_approval_batch',
        'approval_batch_assert_execution_authorized',
        'close_approval_batch'
      ])
      and position('approval_batch_request_has_current_finance_approval' in p.prosrc) > 0
  ) then
    raise exception '023_postcheck: el flujo regular aun exige aprobacion individual de Finanzas';
  end if;

  if not has_function_privilege('authenticated', 'public.list_batch_eligible_requests(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_batch_eligible_requests(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_payment_request_layout_data(uuid,uuid,text,text,date)', 'EXECUTE') then
    raise exception '023_postcheck: grants de RPC inesperados';
  end if;
end
$$;

commit;
