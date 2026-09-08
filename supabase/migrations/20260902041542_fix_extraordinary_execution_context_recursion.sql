-- Restore the base execution-context function captured before migration 037.
-- DEV drift had overwritten this helper with the enriched wrapper itself,
-- causing unbounded recursion and hiding the extraordinary-authorization UI.
create or replace function public.get_payment_request_execution_context_pre_037(
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
  v_readiness jsonb;
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
  v_readiness := public.get_payment_request_execution_readiness(v_request.id);
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
    'can_execute', coalesce((v_readiness ->> 'can_execute')::boolean, false),
    'can_create_cash_fund', coalesce((v_readiness ->> 'can_create_cash_fund')::boolean, false),
    'cash_fund_block_reason', v_readiness ->> 'cash_fund_block_reason',
    'execution_authorization_source', v_readiness ->> 'authorization_source',
    'execution_readiness_block_reason', v_readiness ->> 'block_reason',
    'request_status', v_readiness ->> 'request_status',
    'payment_method', v_readiness ->> 'payment_method',
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


comment on function public.get_payment_request_execution_context_pre_037(uuid)
is 'Base payment execution context preserved before secure extraordinary enrichment; must never call itself.';

