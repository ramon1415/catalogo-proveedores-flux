-- FLUX Operadora
-- 047: repair DEV-only approval batch layout candidate recursion.
--
-- Restores the last canonical pre-037 implementations from migrations 033 and
-- 023. The public 037 fail-closed wrappers and create_payment_layout remain
-- unchanged. This migration does not create requests, layouts, payments,
-- notifications, files, secrets, or provider data.

begin;

do $precheck$
declare
  v_candidate_wrapper_md5 text;
  v_candidate_pre_md5 text;
  v_preview_wrapper_md5 text;
  v_preview_pre_md5 text;
  v_create_layout_md5 text;
  v_candidate_pre_source text;
  v_preview_pre_source text;
begin
  if to_regprocedure(
       'public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.approval_batch_payment_layout_candidates_pre_037(date,date,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.preview_payment_layout_eligibility(date,date,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.preview_payment_layout_eligibility_pre_037(date,date,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.create_payment_layout(date,date,uuid,text,uuid,uuid)'
     ) is null then
    raise exception '047_precheck: required layout functions are missing';
  end if;

  if to_regprocedure(
       'public.payment_request_layout_missing_fields(public.payment_requests)'
     ) is null
     or to_regprocedure(
       'public.approval_batch_budget_validation(uuid)'
     ) is null
     or to_regprocedure(
       'public.approval_batch_request_has_current_direction_approval(uuid)'
     ) is null
     or to_regprocedure(
       'public.approval_batch_request_has_any_execution_record(uuid)'
     ) is null
     or to_regprocedure(
       'public.approval_batch_require_finance()'
     ) is null
     or to_regprocedure(
       'public.extraordinary_authorization_is_ready(uuid)'
     ) is null then
    raise exception '047_precheck: canonical helper dependency is missing';
  end if;

  select md5(pg_get_functiondef(
    'public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)'
      ::regprocedure
  )) into v_candidate_wrapper_md5;
  select md5(pg_get_functiondef(
    'public.approval_batch_payment_layout_candidates_pre_037(date,date,uuid,uuid)'
      ::regprocedure
  )), lower(function_info.prosrc)
    into v_candidate_pre_md5, v_candidate_pre_source
  from pg_proc function_info
  where function_info.oid =
    'public.approval_batch_payment_layout_candidates_pre_037(date,date,uuid,uuid)'
      ::regprocedure;

  select md5(pg_get_functiondef(
    'public.preview_payment_layout_eligibility(date,date,uuid,uuid)'
      ::regprocedure
  )) into v_preview_wrapper_md5;
  select md5(pg_get_functiondef(
    'public.preview_payment_layout_eligibility_pre_037(date,date,uuid,uuid)'
      ::regprocedure
  )), lower(function_info.prosrc)
    into v_preview_pre_md5, v_preview_pre_source
  from pg_proc function_info
  where function_info.oid =
    'public.preview_payment_layout_eligibility_pre_037(date,date,uuid,uuid)'
      ::regprocedure;

  select md5(pg_get_functiondef(
    'public.create_payment_layout(date,date,uuid,text,uuid,uuid)'
      ::regprocedure
  )) into v_create_layout_md5;

  if v_candidate_wrapper_md5 <> 'd68ceef75480c74f84525a66a3c1c580'
     or v_preview_wrapper_md5 <> '2e5efa2fb65d4752bb438732f81cefdb'
     or v_create_layout_md5 <> '5955ae35697c610ef01586120543c05f' then
    raise exception '047_precheck: public layout contract drifted';
  end if;

  if v_candidate_pre_md5 <> '857d5ead5ba5a9e0db91b5587ed60f2c'
     or position(
       'approval_batch_payment_layout_candidates_pre_037('
       in v_candidate_pre_source
     ) = 0 then
    raise exception '047_precheck: candidate recursion fingerprint changed';
  end if;

  if v_preview_pre_md5 <> '4398d33162422949e7c5797b7cd91f38'
     or position(
       'preview_payment_layout_eligibility_pre_037('
       in v_preview_pre_source
     ) = 0 then
    raise exception '047_precheck: preview recursion fingerprint changed';
  end if;
end
$precheck$;

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

alter function public.approval_batch_payment_layout_candidates_pre_037(
  date, date, uuid, uuid
) owner to postgres;
alter function public.approval_batch_payment_layout_candidates_pre_037(
  date, date, uuid, uuid
) security definer;
alter function public.approval_batch_payment_layout_candidates_pre_037(
  date, date, uuid, uuid
) set search_path = public, pg_temp;
revoke all on function
  public.approval_batch_payment_layout_candidates_pre_037(
    date, date, uuid, uuid
  )
  from public, anon, authenticated;
grant execute on function
  public.approval_batch_payment_layout_candidates_pre_037(
    date, date, uuid, uuid
  )
  to service_role;

alter function public.preview_payment_layout_eligibility_pre_037(
  date, date, uuid, uuid
) owner to postgres;
alter function public.preview_payment_layout_eligibility_pre_037(
  date, date, uuid, uuid
) security definer;
alter function public.preview_payment_layout_eligibility_pre_037(
  date, date, uuid, uuid
) set search_path = public, pg_temp;
revoke all on function
  public.preview_payment_layout_eligibility_pre_037(
    date, date, uuid, uuid
  )
  from public, anon, authenticated;
grant execute on function
  public.preview_payment_layout_eligibility_pre_037(
    date, date, uuid, uuid
  )
  to service_role;

do $postcheck$
declare
  v_candidate_wrapper_md5 text;
  v_preview_wrapper_md5 text;
  v_create_layout_md5 text;
  v_candidate_pre_source text;
  v_preview_pre_source text;
  v_candidate_count bigint;
begin
  select md5(pg_get_functiondef(
    'public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)'
      ::regprocedure
  )) into v_candidate_wrapper_md5;
  select md5(pg_get_functiondef(
    'public.preview_payment_layout_eligibility(date,date,uuid,uuid)'
      ::regprocedure
  )) into v_preview_wrapper_md5;
  select md5(pg_get_functiondef(
    'public.create_payment_layout(date,date,uuid,text,uuid,uuid)'
      ::regprocedure
  )) into v_create_layout_md5;

  if v_candidate_wrapper_md5 <> 'd68ceef75480c74f84525a66a3c1c580'
     or v_preview_wrapper_md5 <> '2e5efa2fb65d4752bb438732f81cefdb'
     or v_create_layout_md5 <> '5955ae35697c610ef01586120543c05f' then
    raise exception '047_postcheck: public layout contract changed';
  end if;

  select lower(function_info.prosrc)
    into v_candidate_pre_source
  from pg_proc function_info
  where function_info.oid =
    'public.approval_batch_payment_layout_candidates_pre_037(date,date,uuid,uuid)'
      ::regprocedure;

  select lower(function_info.prosrc)
    into v_preview_pre_source
  from pg_proc function_info
  where function_info.oid =
    'public.preview_payment_layout_eligibility_pre_037(date,date,uuid,uuid)'
      ::regprocedure;

  if position(
       'approval_batch_payment_layout_candidates_pre_037('
       in v_candidate_pre_source
     ) > 0
     or position(
       'payment_request_layout_missing_fields'
       in v_candidate_pre_source
     ) = 0
     or position('destination_type' in v_candidate_pre_source) = 0
     or position('convenio_number' in v_candidate_pre_source) = 0
     or position('payment_reference' in v_candidate_pre_source) = 0
     or position('payment_concept' in v_candidate_pre_source) = 0
     or position('scheduled_payment_date' in v_candidate_pre_source) = 0
     or position('payment_method' in v_candidate_pre_source) = 0
     or position('direction_reapproval_required' in v_candidate_pre_source) = 0
     or position('ready_regular' in v_candidate_pre_source) = 0 then
    raise exception '047_postcheck: canonical candidate body is incomplete';
  end if;

  if position(
       'preview_payment_layout_eligibility_pre_037('
       in v_preview_pre_source
     ) > 0
     or position(
       'approval_batch_payment_layout_candidates('
       in v_preview_pre_source
     ) = 0
     or position('rejected_history' in v_preview_pre_source) = 0 then
    raise exception '047_postcheck: canonical preview body is incomplete';
  end if;

  if not exists (
       select 1
       from pg_proc function_info
       where function_info.oid =
         'public.approval_batch_payment_layout_candidates_pre_037(date,date,uuid,uuid)'
           ::regprocedure
         and function_info.prosecdef
         and pg_get_userbyid(function_info.proowner) = 'postgres'
         and exists (
           select 1
           from unnest(coalesce(function_info.proconfig, array[]::text[])) setting
           where replace(setting, ' ', '') = 'search_path=public,pg_temp'
         )
     )
     or not exists (
       select 1
       from pg_proc function_info
       where function_info.oid =
         'public.preview_payment_layout_eligibility_pre_037(date,date,uuid,uuid)'
           ::regprocedure
         and function_info.prosecdef
         and pg_get_userbyid(function_info.proowner) = 'postgres'
         and exists (
           select 1
           from unnest(coalesce(function_info.proconfig, array[]::text[])) setting
           where replace(setting, ' ', '') = 'search_path=public,pg_temp'
         )
     ) then
    raise exception '047_postcheck: owner or security contract changed';
  end if;

  if has_function_privilege(
       'public',
       'public.approval_batch_payment_layout_candidates_pre_037(date,date,uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.approval_batch_payment_layout_candidates_pre_037(date,date,uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.approval_batch_payment_layout_candidates_pre_037(date,date,uuid,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.approval_batch_payment_layout_candidates_pre_037(date,date,uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'public',
       'public.preview_payment_layout_eligibility_pre_037(date,date,uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.preview_payment_layout_eligibility_pre_037(date,date,uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.preview_payment_layout_eligibility_pre_037(date,date,uuid,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.preview_payment_layout_eligibility_pre_037(date,date,uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception '047_postcheck: internal function grants changed';
  end if;

  select count(*)
    into v_candidate_count
  from public.approval_batch_payment_layout_candidates(
    date '2026-01-01',
    date '2026-12-31',
    null::uuid,
    null::uuid
  );

  if v_candidate_count < 0 then
    raise exception '047_postcheck: impossible candidate count';
  end if;
end
$postcheck$;

commit;
