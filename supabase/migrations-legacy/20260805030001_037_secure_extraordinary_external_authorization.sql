-- FLUX Operadora
-- 037: secure external Direction authorization with private evidence,
-- bounded validity, single consumption and post-consumption ratification.
--
-- This migration does not enable the policy for any company and does not
-- create receipts, payments, notifications or outbox events.

begin;

do $precheck$
declare
  v_status_constraint text;
  v_revoke_constraint text;
  v_status_constraint_count integer;
  v_secure_column_count integer;
  v_release_column_count integer;
begin
  if to_regclass('public.payment_request_extraordinary_events') is null
     or to_regclass('public.company_directors') is null
     or to_regprocedure('public.current_profile_id()') is null
     or to_regprocedure('public.current_user_has_role(text[])') is null
     or to_regprocedure('public.approval_batch_budget_validation(uuid)') is null
     or to_regprocedure('public.payment_request_layout_missing_fields(public.payment_requests)') is null
     or to_regprocedure('public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)') is null then
    raise exception '037_precheck: required approval and layout objects are missing';
  end if;

  select pg_get_constraintdef(constraint_info.oid, true)
  into v_status_constraint
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.conname =
      'payment_request_extraordinary_status_check';

  if v_status_constraint is distinct from
      'CHECK (status = ANY (ARRAY[''active''::text, ''revoked''::text, ''legacy_consumed_unverified''::text, ''legacy_quarantined''::text]))' then
    raise exception
      '037_precheck: canonical 036 status constraint drift: %',
      v_status_constraint;
  end if;

  select pg_get_constraintdef(constraint_info.oid, true)
  into v_revoke_constraint
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.conname =
      'payment_request_extraordinary_revoke_check';

  if v_revoke_constraint is distinct from
      'CHECK (status = ''revoked''::text AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND NULLIF(btrim(revoke_reason), ''''::text) IS NOT NULL OR status <> ''revoked''::text AND revoked_by IS NULL AND revoked_at IS NULL AND revoke_reason IS NULL)' then
    raise exception
      '037_precheck: canonical 036 revoke constraint drift: %',
      v_revoke_constraint;
  end if;

  select count(*)
  into v_status_constraint_count
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.conname like '%status_check';

  if v_status_constraint_count <> 1
     or not exists (
       select 1
       from pg_constraint constraint_info
       where constraint_info.conrelid =
           'public.payment_request_extraordinary_authorizations'::regclass
         and constraint_info.conname =
           'payment_request_extraordinary_legacy_class_check'
     ) then
    raise exception '037_precheck: 036 constraint catalog is invalid';
  end if;

  select count(*)
  into v_secure_column_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'payment_request_extraordinary_authorizations'
    and column_name in (
      'company_id',
      'external_director_profile_id',
      'evidence_type',
      'evidence_storage_bucket',
      'evidence_storage_path',
      'evidence_sha256',
      'evidence_mime_type',
      'evidence_size_bytes',
      'evidence_verified_at',
      'evidence_match_attested_by',
      'evidence_match_attested_at',
      'external_authorized_at',
      'valid_until',
      'ratification_due_at',
      'idempotency_key',
      'consumed_at',
      'consumed_layout_id',
      'consumed_layout_line_id',
      'ratified_by',
      'ratified_at',
      'ratification_note',
      'disputed_by',
      'disputed_at',
      'dispute_reason'
    );

  select count(*)
  into v_release_column_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'approval_batch_items'
    and column_name in (
      'finance_release_status',
      'finance_release_reason',
      'finance_released_by',
      'finance_released_at'
    );

  if v_secure_column_count <> 0
     or v_release_column_count <> 0
     or to_regclass('public.extraordinary_payment_policies') is not null
     or to_regprocedure(
       'public.begin_extraordinary_authorization(uuid,text,text,uuid,timestamp with time zone,text)'
     ) is not null
     or to_regprocedure(
       'public.finalize_extraordinary_authorization(uuid,text,text,text,bigint,boolean,text)'
     ) is not null then
    raise exception '037_precheck: partial 037 objects detected';
  end if;

  if not (
    (
      (select count(*) from public.payment_request_extraordinary_authorizations) = 0
    )
    or (
      (select count(*) from public.payment_request_extraordinary_authorizations
       where status = 'legacy_consumed_unverified') = 7
      and
      (select count(*) from public.payment_request_extraordinary_authorizations
       where status = 'legacy_quarantined') = 1
      and
      (select count(*) from public.payment_request_extraordinary_authorizations
       where status = 'revoked') = 1
      and not exists (
        select 1 from public.payment_request_extraordinary_authorizations
        where status = 'active'
      )
    )
  ) then
    raise exception '037_precheck: migration 036 distribution is neither PROD zero-row nor DEV 7/1/1/0';
  end if;
end
$precheck$;

create table public.extraordinary_payment_policies (
  company_id uuid not null,
  enabled boolean not null default false,
  max_amount_mxn numeric(18,2),
  allowed_categories text[] not null,
  authorization_valid_hours integer not null,
  ratification_due_hours integer not null,
  evidence_required boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint extraordinary_payment_policies_pkey primary key (company_id),
  constraint extraordinary_payment_policies_company_fkey
    foreign key (company_id) references public.companies(id),
  constraint extraordinary_payment_policies_created_by_fkey
    foreign key (created_by) references public.profiles(id),
  constraint extraordinary_payment_policies_updated_by_fkey
    foreign key (updated_by) references public.profiles(id),
  constraint extraordinary_payment_policies_amount_check check (
    max_amount_mxn is null or max_amount_mxn > 0
  ),
  constraint extraordinary_payment_policies_categories_check check (
    cardinality(allowed_categories) > 0
    and allowed_categories <@ array[
      'operational_emergency',
      'urgent_reimbursement',
      'urgent_termination',
      'critical_service',
      'other'
    ]::text[]
  ),
  constraint extraordinary_payment_policies_authorization_hours_check check (
    authorization_valid_hours between 1 and 48
  ),
  constraint extraordinary_payment_policies_ratification_hours_check check (
    ratification_due_hours between 1 and 72
  ),
  constraint extraordinary_payment_policies_evidence_check check (
    evidence_required = false
  )
);

alter table public.extraordinary_payment_policies enable row level security;
revoke all on table public.extraordinary_payment_policies
  from public, anon, authenticated, service_role;
grant select on table public.extraordinary_payment_policies to authenticated;

create policy extraordinary_payment_policies_read
on public.extraordinary_payment_policies
for select
to authenticated
using (
  public.current_user_has_role(public.flux_finance_roles())
  and (
    public.current_user_has_role(public.flux_sysadmin_roles())
    or exists (
      select 1
      from public.profile_company_memberships membership
      where membership.profile_id = public.current_profile_id()
        and membership.company_id = extraordinary_payment_policies.company_id
        and membership.active
    )
  )
);

alter table public.payment_request_extraordinary_authorizations
  add column company_id uuid,
  add column external_director_profile_id uuid,
  add column evidence_type text,
  add column evidence_storage_bucket text,
  add column evidence_storage_path text,
  add column evidence_sha256 text,
  add column evidence_mime_type text,
  add column evidence_size_bytes bigint,
  add column evidence_verified_at timestamptz,
  add column evidence_match_attested_by uuid,
  add column evidence_match_attested_at timestamptz,
  add column external_authorized_at timestamptz,
  add column valid_until timestamptz,
  add column ratification_due_at timestamptz,
  add column idempotency_key text,
  add column consumed_at timestamptz,
  add column consumed_layout_id uuid,
  add column consumed_layout_line_id uuid,
  add column ratified_by uuid,
  add column ratified_at timestamptz,
  add column ratification_note text,
  add column disputed_by uuid,
  add column disputed_at timestamptz,
  add column dispute_reason text;

alter table public.payment_request_extraordinary_authorizations
  add constraint payment_request_extraordinary_company_fkey
    foreign key (company_id) references public.companies(id),
  add constraint payment_request_extraordinary_director_fkey
    foreign key (external_director_profile_id) references public.profiles(id),
  add constraint payment_request_extraordinary_evidence_actor_fkey
    foreign key (evidence_match_attested_by) references public.profiles(id),
  add constraint payment_request_extraordinary_layout_fkey
    foreign key (consumed_layout_id) references public.payment_layouts(id),
  add constraint payment_request_extraordinary_layout_line_fkey
    foreign key (consumed_layout_line_id) references public.payment_layout_lines(id),
  add constraint payment_request_extraordinary_ratified_by_fkey
    foreign key (ratified_by) references public.profiles(id),
  add constraint payment_request_extraordinary_disputed_by_fkey
    foreign key (disputed_by) references public.profiles(id);

update public.payment_request_extraordinary_authorizations extraordinary_auth
set company_id = request.company_id
from public.payment_requests request
where request.id = extraordinary_auth.payment_request_id
  and extraordinary_auth.company_id is null;

alter table public.payment_request_extraordinary_authorizations
  alter column company_id set not null;

alter table public.payment_request_extraordinary_authorizations
  drop constraint payment_request_extraordinary_status_check;

alter table public.payment_request_extraordinary_authorizations
  add constraint payment_request_extraordinary_status_check
  check (
    status in (
      'draft',
      'active',
      'consumed_pending_ratification',
      'ratified',
      'revoked',
      'expired',
      'disputed',
      'legacy_consumed_unverified',
      'legacy_quarantined'
    )
  );

alter table public.payment_request_extraordinary_authorizations
  add constraint payment_request_extraordinary_evidence_type_check
  check (
    evidence_type is null
    or evidence_type in (
      'whatsapp_export',
      'email',
      'signed_document',
      'other'
    )
  );

alter table public.payment_request_extraordinary_authorizations
  add constraint payment_request_extraordinary_authorizations_hash_check
  check (
    evidence_sha256 is null
    or evidence_sha256 ~ '^[0-9a-f]{64}$'
  );

alter table public.payment_request_extraordinary_authorizations
  add constraint payment_request_extraordinary_authorizations_file_check
  check (
    (
      evidence_mime_type is null
      and evidence_size_bytes is null
    )
    or (
      evidence_mime_type in (
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp'
      )
      and evidence_size_bytes between 1 and 5242880
    )
  );

alter table public.payment_request_extraordinary_authorizations
  add constraint payment_request_extraordinary_lifecycle_check
  check (
    status in (
      'legacy_consumed_unverified',
      'legacy_quarantined',
      'revoked'
    )
    or (
      external_director_profile_id is not null
      and external_authorized_at is not null
      and valid_until > external_authorized_at
      and ratification_due_at > valid_until
      and idempotency_key is not null
      and char_length(idempotency_key) between 8 and 200
      and evidence_storage_bucket = 'extraordinary-authorizations'
      and evidence_storage_path is not null
      and (
        status = 'draft'
        or (
          evidence_type is not null
          and evidence_sha256 is not null
          and evidence_mime_type is not null
          and evidence_size_bytes is not null
          and evidence_verified_at is not null
          and evidence_match_attested_by is not null
          and evidence_match_attested_at is not null
        )
      )
      and (
        status not in (
          'consumed_pending_ratification',
          'ratified',
          'disputed'
        )
        or (
          consumed_at is not null
          and consumed_layout_id is not null
          and consumed_layout_line_id is not null
        )
      )
      and (
        status <> 'ratified'
        or (ratified_by is not null and ratified_at is not null)
      )
      and (
        status <> 'disputed'
        or (
          disputed_by is not null
          and disputed_at is not null
          and nullif(btrim(dispute_reason), '') is not null
        )
      )
    )
  );

create unique index payment_request_extraordinary_authorizations_idempotency_uidx
  on public.payment_request_extraordinary_authorizations(company_id, idempotency_key)
  where idempotency_key is not null;

create unique index payment_request_extraordinary_authorizations_operational_uidx
  on public.payment_request_extraordinary_authorizations(payment_request_id)
  where status in ('draft', 'active', 'consumed_pending_ratification');

alter table public.payment_request_extraordinary_events
  drop constraint payment_request_extraordinary_events_type_check;

alter table public.payment_request_extraordinary_events
  add constraint payment_request_extraordinary_events_type_check
  check (
    event_type in (
      'legacy_consumed_classified',
      'legacy_quarantined',
      'legacy_revoked_preserved',
      'legacy_unsafe_rpc_disabled',
      'draft_created',
      'evidence_finalized',
      'authorization_activated',
      'authorization_consumed',
      'authorization_ratified',
      'authorization_disputed',
      'authorization_revoked',
      'authorization_expired',
      'material_change_invalidated'
    )
  );

-- post-validation mixed-close correction. Direction's decision remains immutable;
-- Finance records a separate per-item release result so one stale approval
-- cannot prevent other current approvals from being released.
alter table public.approval_batch_items
  add column finance_release_status text,
  add column finance_release_reason text,
  add column finance_released_by uuid,
  add column finance_released_at timestamptz,
  add constraint approval_batch_items_finance_released_by_fkey
    foreign key (finance_released_by) references public.profiles(id);

update public.approval_batch_items item
set finance_release_status = case
      when batch.status = 'closed' and item.director_status = 'approved'
        then 'released'
      when batch.status = 'closed'
        then 'blocked'
      else 'pending'
    end,
    finance_release_reason = case
      when batch.status = 'closed' and item.director_status <> 'approved'
        then 'direction_rejected'
      else null
    end,
    finance_released_by = case
      when batch.status = 'closed' then batch.closed_by
      else null
    end,
    finance_released_at = case
      when batch.status = 'closed' then batch.closed_at
      else null
    end
from public.approval_batches batch
where batch.id = item.batch_id
  and item.finance_release_status is null;

alter table public.approval_batch_items
  alter column finance_release_status set default 'pending',
  alter column finance_release_status set not null;

alter table public.approval_batch_items
  add constraint approval_batch_items_finance_release_status_check
  check (
    finance_release_status in ('pending', 'released', 'blocked')
  );

alter table public.approval_batch_items
  add constraint approval_batch_items_finance_release_lifecycle_check
  check (
    (
      finance_release_status = 'pending'
      and finance_release_reason is null
      and finance_released_by is null
      and finance_released_at is null
    )
    or (
      finance_release_status = 'released'
      and director_status = 'approved'
      and finance_release_reason is null
      and finance_released_by is not null
      and finance_released_at is not null
    )
    or (
      finance_release_status = 'blocked'
      and nullif(btrim(finance_release_reason), '') is not null
      and finance_released_by is not null
      and finance_released_at is not null
    )
  );

create index approval_batch_items_finance_release_idx
  on public.approval_batch_items(
    batch_id,
    finance_release_status,
    director_status
  )
  where removed_at is null;

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
  if not found or v_item.removed_at is not null then return 'item_not_active'; end if;
  if v_item.director_status = 'pending' then return 'direction_pending'; end if;
  if v_item.director_status = 'rejected' then return 'direction_rejected'; end if;

  select * into v_request
  from public.payment_requests
  where id = v_item.payment_request_id;
  if not found then return 'payment_request_not_found'; end if;

  v_budget := public.approval_batch_budget_validation(v_request.id);
  if coalesce(v_budget->>'status', 'bloqueado') <> 'aprobable' then
    return coalesce(v_budget->>'motivo', 'budget_validation_required');
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

create or replace function public.preview_approval_batch_close(
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
  v_ready jsonb;
  v_blocked jsonb;
  v_ready_count integer;
  v_blocked_count integer;
  v_pending_count integer;
begin
  v_actor := public.approval_batch_require_finance();
  select * into v_batch
  from public.approval_batches
  where id = p_batch_id;
  if not found then raise exception 'batch_not_found'; end if;

  with evaluated as (
    select
      item.id as item_id,
      item.payment_request_id,
      request.request_number,
      request.amount_requested as amount,
      request.currency,
      item.director_status,
      public.approval_batch_item_release_block_reason(item.id) as reason
    from public.approval_batch_items item
    join public.payment_requests request
      on request.id = item.payment_request_id
    where item.batch_id = p_batch_id
      and item.removed_at is null
  )
  select
    coalesce(jsonb_agg(to_jsonb(evaluated) - 'reason'
      order by request_number, item_id)
      filter (
        where director_status = 'approved' and reason is null
      ), '[]'::jsonb),
    coalesce(jsonb_agg(to_jsonb(evaluated)
      order by request_number, item_id)
      filter (
        where director_status <> 'approved' or reason is not null
      ), '[]'::jsonb),
    count(*) filter (
      where director_status = 'approved' and reason is null
    )::integer,
    count(*) filter (
      where director_status <> 'approved' or reason is not null
    )::integer,
    count(*) filter (where director_status = 'pending')::integer
  into
    v_ready,
    v_blocked,
    v_ready_count,
    v_blocked_count,
    v_pending_count
  from evaluated;

  return jsonb_build_object(
    'batch_id', v_batch.id,
    'batch_status', v_batch.status,
    'can_close',
      v_batch.status in ('approved', 'partially_approved')
      and v_pending_count = 0
      and v_ready_count > 0,
    'ready_count', v_ready_count,
    'blocked_count', v_blocked_count,
    'pending_count', v_pending_count,
    'ready_items', v_ready,
    'blocked_items', v_blocked
  );
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
  v_batch public.approval_batches%rowtype;
  v_item record;
  v_reason text;
  v_now timestamptz := clock_timestamp();
  v_pending integer;
  v_released integer;
  v_blocked integer;
  v_rejected integer;
  v_totals jsonb;
  v_blocked_items jsonb;
begin
  v_actor := public.approval_batch_require_finance();
  select * into v_batch
  from public.approval_batches
  where id = p_batch_id
  for update;
  if not found then raise exception 'batch_not_found'; end if;

  if v_batch.status = 'closed' then
    select
      count(*) filter (where finance_release_status = 'released')::integer,
      count(*) filter (where finance_release_status = 'blocked')::integer,
      count(*) filter (where director_status = 'rejected')::integer
    into v_released, v_blocked, v_rejected
    from public.approval_batch_items
    where batch_id = p_batch_id and removed_at is null;
    return jsonb_build_object(
      'batch_id', p_batch_id,
      'status', 'closed',
      'approved_released_count', v_released,
      'blocked_count', v_blocked,
      'rejected_blocked_count', v_rejected,
      'idempotent_replay', true
    );
  end if;
  if v_batch.status not in ('approved', 'partially_approved') then
    raise exception 'batch_not_ready_to_close';
  end if;

  perform 1
  from public.approval_batch_items item
  where item.batch_id = p_batch_id
    and item.removed_at is null
  order by item.payment_request_id, item.id
  for update;

  select count(*)::integer into v_pending
  from public.approval_batch_items
  where batch_id = p_batch_id
    and removed_at is null
    and director_status = 'pending';
  if v_pending > 0 then raise exception 'batch_has_pending_items'; end if;

  for v_item in
    select item.id, item.director_status
    from public.approval_batch_items item
    where item.batch_id = p_batch_id
      and item.removed_at is null
    order by item.payment_request_id, item.id
  loop
    v_reason := public.approval_batch_item_release_block_reason(v_item.id);
    if v_item.director_status = 'approved' and v_reason is null then
      update public.approval_batch_items
      set finance_release_status = 'released',
          finance_release_reason = null,
          finance_released_by = v_actor,
          finance_released_at = v_now
      where id = v_item.id;
    else
      update public.approval_batch_items
      set finance_release_status = 'blocked',
          finance_release_reason = coalesce(v_reason, 'release_validation_failed'),
          finance_released_by = v_actor,
          finance_released_at = v_now
      where id = v_item.id;
    end if;
  end loop;

  select
    count(*) filter (where finance_release_status = 'released')::integer,
    count(*) filter (where finance_release_status = 'blocked')::integer,
    count(*) filter (where director_status = 'rejected')::integer
  into v_released, v_blocked, v_rejected
  from public.approval_batch_items
  where batch_id = p_batch_id and removed_at is null;
  if v_released = 0 then raise exception 'batch_no_releasable_items'; end if;

  update public.approval_batches
  set status = 'closed',
      closed_by = v_actor,
      closed_at = v_now
  where id = p_batch_id
    and status in ('approved', 'partially_approved');
  if not found then raise exception 'batch_concurrent_change'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'currency', totals.currency,
    'amount', totals.amount
  ) order by totals.currency), '[]'::jsonb)
  into v_totals
  from (
    select
      coalesce(nullif(upper(btrim(request.currency)), ''), 'MXN') as currency,
      sum(request.amount_requested) as amount
    from public.approval_batch_items item
    join public.payment_requests request
      on request.id = item.payment_request_id
    where item.batch_id = p_batch_id
      and item.removed_at is null
      and item.finance_release_status = 'released'
    group by coalesce(nullif(upper(btrim(request.currency)), ''), 'MXN')
  ) totals;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', item.id,
    'payment_request_id', item.payment_request_id,
    'request_number', request.request_number,
    'director_status', item.director_status,
    'reason', item.finance_release_reason
  ) order by request.request_number, item.id), '[]'::jsonb)
  into v_blocked_items
  from public.approval_batch_items item
  join public.payment_requests request
    on request.id = item.payment_request_id
  where item.batch_id = p_batch_id
    and item.removed_at is null
    and item.finance_release_status = 'blocked';

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'closed',
    'release_label', 'Liberado para pago',
    'approved_released_count', v_released,
    'blocked_count', v_blocked,
    'rejected_blocked_count', v_rejected,
    'blocked_items', v_blocked_items,
    'totals_by_currency', v_totals,
    'idempotent_replay', false
  );
end
$$;

create or replace function public.approval_batch_request_has_current_direction_approval(
  p_payment_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.payment_requests request
    join public.approval_batch_items item
      on item.payment_request_id = request.id
     and item.removed_at is null
     and item.director_status = 'approved'
     and item.finance_release_status = 'released'
    join public.approval_batches batch
      on batch.id = item.batch_id
     and batch.status = 'closed'
    where request.id = p_payment_request_id
      and item.decided_at is not null
      and item.decided_at >= request.approval_material_updated_at
      and batch.closed_at is not null
      and batch.closed_at >= item.decided_at
      and not exists (
        select 1
        from public.approval_batch_items later
        where later.payment_request_id = request.id
          and later.removed_at is null
          and later.director_status in ('pending', 'rejected')
          and coalesce(later.decided_at, later.created_at) > item.decided_at
      )
  );
$$;

create or replace function public.extraordinary_profile_is_active_member(
  p_profile_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles profile
    join public.profile_company_memberships membership
      on membership.profile_id = profile.id
    where profile.id = p_profile_id
      and profile.active
      and membership.company_id = p_company_id
      and membership.active
  );
$$;

create or replace function public.extraordinary_profile_is_company_director(
  p_profile_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.extraordinary_profile_is_active_member(p_profile_id, p_company_id)
    and exists (
      select 1
      from public.user_roles user_role
      join public.roles role on role.id = user_role.role_id
      where user_role.profile_id = p_profile_id
        and lower(btrim(role.name)) =
          any(public.approval_batch_direction_roles())
    )
    and exists (
      select 1
      from public.company_directors director
      where director.company_id = p_company_id
        and director.director_profile_id = p_profile_id
        and director.active
    );
$$;

create or replace function public.extraordinary_require_finance_for_company(
  p_company_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
begin
  v_actor := public.approval_batch_require_finance();
  if not public.extraordinary_profile_is_active_member(v_actor, p_company_id)
     and not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'active_company_membership_required';
  end if;
  return v_actor;
end
$$;

create or replace function public.extraordinary_append_event(
  p_authorization_id uuid,
  p_event_type text,
  p_actor_profile_id uuid,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
  v_event_id uuid;
begin
  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where id = p_authorization_id;
  if not found then raise exception 'extraordinary_authorization_not_found'; end if;

  insert into public.payment_request_extraordinary_events(
    authorization_id,
    payment_request_id,
    company_id,
    event_type,
    actor_profile_id,
    idempotency_key,
    metadata
  ) values (
    v_authorization.id,
    v_authorization.payment_request_id,
    v_authorization.company_id,
    p_event_type,
    p_actor_profile_id,
    p_idempotency_key,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_event_id;
  return v_event_id;
end
$$;

create or replace function public.set_extraordinary_payment_policy(
  p_company_id uuid,
  p_enabled boolean,
  p_max_amount_mxn numeric,
  p_allowed_categories text[],
  p_authorization_valid_hours integer,
  p_ratification_due_hours integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_policy public.extraordinary_payment_policies%rowtype;
begin
  if v_actor is null
     or not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'sysadmin_role_required';
  end if;
  if not exists (
    select 1 from public.profiles where id = v_actor and active
  ) then
    raise exception 'active_profile_required';
  end if;

  insert into public.extraordinary_payment_policies(
    company_id,
    enabled,
    max_amount_mxn,
    allowed_categories,
    authorization_valid_hours,
    ratification_due_hours,
    evidence_required,
    created_by,
    updated_by
  ) values (
    p_company_id,
    coalesce(p_enabled, false),
    p_max_amount_mxn,
    array(
      select distinct lower(btrim(category))
      from unnest(p_allowed_categories) category
      order by 1
    ),
    p_authorization_valid_hours,
    p_ratification_due_hours,
    false,
    v_actor,
    v_actor
  )
  on conflict (company_id) do update
  set enabled = excluded.enabled,
      max_amount_mxn = excluded.max_amount_mxn,
      allowed_categories = excluded.allowed_categories,
      authorization_valid_hours = excluded.authorization_valid_hours,
      ratification_due_hours = excluded.ratification_due_hours,
      evidence_required = false,
      updated_by = v_actor,
      updated_at = clock_timestamp()
  returning * into v_policy;

  return jsonb_build_object(
    'company_id', v_policy.company_id,
    'enabled', v_policy.enabled,
    'max_amount_mxn', v_policy.max_amount_mxn,
    'allowed_categories', v_policy.allowed_categories,
    'authorization_valid_hours', v_policy.authorization_valid_hours,
    'ratification_due_hours', v_policy.ratification_due_hours,
    'evidence_required', false
  );
end
$$;

create or replace function public.begin_extraordinary_authorization(
  p_payment_request_id uuid,
  p_category text,
  p_reason text,
  p_external_director_profile_id uuid,
  p_external_authorized_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_actor uuid;
  v_request public.payment_requests%rowtype;
  v_policy public.extraordinary_payment_policies%rowtype;
  v_existing public.payment_request_extraordinary_authorizations%rowtype;
  v_authorization_id uuid := gen_random_uuid();
  v_object_id uuid := gen_random_uuid();
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := clock_timestamp();
  v_path text;
begin
  if p_payment_request_id is null then raise exception 'payment_request_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_payment_request_id::text, 37037));

  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;
  if not found then raise exception 'payment_request_not_found'; end if;

  v_actor := public.extraordinary_require_finance_for_company(v_request.company_id);
  if v_actor = p_external_director_profile_id then
    raise exception 'finance_actor_must_differ_from_external_director';
  end if;

  if v_key is null or char_length(v_key) not between 8 and 200 then
    raise exception 'invalid_idempotency_key';
  end if;

  select * into v_existing
  from public.payment_request_extraordinary_authorizations
  where company_id = v_request.company_id
    and idempotency_key = v_key;
  if found then
    if v_existing.payment_request_id <> v_request.id
       or v_existing.authorized_by <> v_actor
       or v_existing.external_director_profile_id <>
         p_external_director_profile_id then
      raise exception 'idempotency_key_payload_mismatch';
    end if;
    return jsonb_build_object(
      'authorization_id', v_existing.id,
      'status', v_existing.status,
      'storage_bucket', v_existing.evidence_storage_bucket,
      'storage_path', v_existing.evidence_storage_path,
      'idempotent_replay', true
    );
  end if;

  select * into v_policy
  from public.extraordinary_payment_policies
  where company_id = v_request.company_id
  for share;
  if not found or not v_policy.enabled then
    raise exception 'extraordinary_policy_disabled';
  end if;
  if v_request.currency <> 'MXN'
     or (
       v_policy.max_amount_mxn is not null
       and v_request.amount_requested > v_policy.max_amount_mxn
     ) then
    raise exception 'extraordinary_amount_exceeds_policy';
  end if;
  if v_category <> all(v_policy.allowed_categories) then
    raise exception 'extraordinary_category_not_allowed';
  end if;
  if v_reason is null or char_length(v_reason) < 20 then
    raise exception 'extraordinary_reason_too_short';
  end if;
  if p_external_authorized_at is null
     or p_external_authorized_at > v_now + interval '5 minutes'
     or p_external_authorized_at < v_request.approval_material_updated_at
     or p_external_authorized_at +
       make_interval(hours => v_policy.authorization_valid_hours) <= v_now then
    raise exception 'external_authorization_time_invalid';
  end if;
  if not public.extraordinary_profile_is_company_director(
    p_external_director_profile_id,
    v_request.company_id
  ) then
    raise exception 'external_director_not_active_for_company';
  end if;
  if v_request.status::text not in (
    'submitted', 'pending_approval', 'approved'
  ) then
    raise exception 'payment_request_not_available_for_extraordinary';
  end if;
  if lower(v_request.request_type::text) in ('payroll', 'nomina') then
    raise exception 'payroll_extraordinary_not_supported';
  end if;
  if public.approval_batch_request_has_any_execution_record(v_request.id)
     or exists (
       select 1
       from public.payment_request_receipt_links receipt_link
       where receipt_link.payment_request_id = v_request.id
     ) then
    raise exception 'payment_request_already_executed';
  end if;
  if exists (
    select 1
    from public.approval_batch_items batch_item
    join public.approval_batches batch on batch.id = batch_item.batch_id
    where batch_item.payment_request_id = v_request.id
      and (
        (batch_item.removed_at is null and batch_item.director_status = 'rejected')
        or batch.status in ('draft', 'submitted')
      )
  ) then
    raise exception 'request_has_rejection_or_open_batch';
  end if;
  if exists (
    select 1
    from public.payment_request_extraordinary_authorizations extraordinary_auth
    where extraordinary_auth.payment_request_id = v_request.id
      and extraordinary_auth.status in (
        'draft', 'active', 'consumed_pending_ratification'
      )
  ) then
    raise exception 'extraordinary_authorization_already_open';
  end if;
  if coalesce(
    public.approval_batch_budget_validation(v_request.id)->>'status',
    'bloqueado'
  ) <> 'aprobable' then
    raise exception 'budget_revalidation_required';
  end if;

  v_path := v_request.company_id::text || '/' ||
    v_authorization_id::text || '/evidence/' || v_object_id::text;
  perform set_config('app.extraordinary_internal', 'on', true);

  insert into public.payment_request_extraordinary_authorizations(
    id,
    payment_request_id,
    company_id,
    category,
    reason,
    status,
    authorized_by,
    authorized_at,
    external_director_profile_id,
    evidence_storage_bucket,
    evidence_storage_path,
    external_authorized_at,
    valid_until,
    ratification_due_at,
    idempotency_key
  ) values (
    v_authorization_id,
    v_request.id,
    v_request.company_id,
    v_category,
    v_reason,
    'draft',
    v_actor,
    v_now,
    p_external_director_profile_id,
    'extraordinary-authorizations',
    v_path,
    p_external_authorized_at,
    p_external_authorized_at +
      make_interval(hours => v_policy.authorization_valid_hours),
    p_external_authorized_at +
      make_interval(hours =>
        v_policy.authorization_valid_hours + v_policy.ratification_due_hours),
    v_key
  );

  perform public.extraordinary_append_event(
    v_authorization_id,
    'draft_created',
    v_actor,
    'draft-created:' || v_authorization_id::text,
    jsonb_build_object(
      'category', v_category,
      'amount_minor', round(v_request.amount_requested * 100)::bigint,
      'currency', v_request.currency,
      'external_director_profile_id', p_external_director_profile_id,
      'valid_until',
        p_external_authorized_at +
          make_interval(hours => v_policy.authorization_valid_hours)
    )
  );

  return jsonb_build_object(
    'authorization_id', v_authorization_id,
    'status', 'draft',
    'storage_bucket', 'extraordinary-authorizations',
    'storage_path', v_path,
    'allowed_mime_types', array[
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
    ],
    'max_size_bytes', 5242880,
    'valid_until',
      p_external_authorized_at +
        make_interval(hours => v_policy.authorization_valid_hours),
    'idempotent_replay', false
  );
end
$$;

create or replace function public.finalize_extraordinary_authorization(
  p_authorization_id uuid,
  p_evidence_type text,
  p_evidence_sha256 text,
  p_evidence_mime_type text,
  p_evidence_size_bytes bigint,
  p_finance_attests_evidence_matches_request boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_actor uuid;
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
  v_request public.payment_requests%rowtype;
  v_policy public.extraordinary_payment_policies%rowtype;
  v_object storage.objects%rowtype;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_mime text := lower(btrim(coalesce(p_evidence_mime_type, '')));
  v_hash text := lower(btrim(coalesce(p_evidence_sha256, '')));
  v_type text := lower(btrim(coalesce(p_evidence_type, '')));
  v_now timestamptz := clock_timestamp();
begin
  if p_authorization_id is null then raise exception 'authorization_id_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_authorization_id::text, 37037));

  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where id = p_authorization_id
  for update;
  if not found then raise exception 'extraordinary_authorization_not_found'; end if;

  v_actor := public.extraordinary_require_finance_for_company(
    v_authorization.company_id
  );
  if v_actor <> v_authorization.authorized_by
     and not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'draft_owner_or_sysadmin_required';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 200 then
    raise exception 'invalid_idempotency_key';
  end if;
  if v_authorization.status = 'active' then
    return jsonb_build_object(
      'authorization_id', v_authorization.id,
      'status', 'active',
      'valid_until', v_authorization.valid_until,
      'ratification_due_at', v_authorization.ratification_due_at,
      'idempotent_replay', true
    );
  end if;
  if v_authorization.status <> 'draft' then
    raise exception 'extraordinary_authorization_not_draft';
  end if;

  select * into v_request
  from public.payment_requests
  where id = v_authorization.payment_request_id
  for update;
  select * into v_policy
  from public.extraordinary_payment_policies
  where company_id = v_authorization.company_id
  for share;

  if not found or not v_policy.enabled then
    raise exception 'extraordinary_policy_disabled';
  end if;
  if v_now >= v_authorization.valid_until
     or v_authorization.external_authorized_at <
       v_request.approval_material_updated_at then
    raise exception 'extraordinary_authorization_expired_or_stale';
  end if;
  if not public.extraordinary_profile_is_company_director(
    v_authorization.external_director_profile_id,
    v_authorization.company_id
  ) then
    raise exception 'external_director_not_active_for_company';
  end if;
  if v_request.currency <> 'MXN'
     or v_request.amount_requested > v_policy.max_amount_mxn
     or v_authorization.category <> all(v_policy.allowed_categories) then
    raise exception 'extraordinary_policy_no_longer_matches';
  end if;
  if public.approval_batch_request_has_any_execution_record(v_request.id)
     or exists (
       select 1
       from public.payment_request_receipt_links receipt_link
       where receipt_link.payment_request_id = v_request.id
     ) then
    raise exception 'payment_request_already_executed';
  end if;
  if coalesce(
    public.approval_batch_budget_validation(v_request.id)->>'status',
    'bloqueado'
  ) <> 'aprobable' then
    raise exception 'budget_revalidation_required';
  end if;
  if not coalesce(p_finance_attests_evidence_matches_request, false) then
    raise exception 'evidence_request_match_attestation_required';
  end if;
  if v_type not in (
    'whatsapp_export', 'email', 'signed_document', 'other'
  ) then
    raise exception 'invalid_evidence_type';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_evidence_sha256';
  end if;
  if v_mime not in (
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
  ) or p_evidence_size_bytes not between 1 and 5242880 then
    raise exception 'invalid_evidence_file';
  end if;

  select * into v_object
  from storage.objects object
  where object.bucket_id = v_authorization.evidence_storage_bucket
    and object.name = v_authorization.evidence_storage_path;
  if not found then raise exception 'extraordinary_evidence_object_not_found'; end if;
  if lower(coalesce(v_object.metadata->>'mimetype', '')) <> v_mime
     or nullif(v_object.metadata->>'size', '') is null
     or (v_object.metadata->>'size')::bigint <> p_evidence_size_bytes
     or coalesce(
       to_jsonb(v_object)->'user_metadata'->>'sha256',
       v_object.metadata->'metadata'->>'sha256',
       v_object.metadata->>'sha256',
       ''
     ) <> v_hash then
    raise exception 'extraordinary_evidence_object_metadata_mismatch';
  end if;

  perform set_config('app.extraordinary_internal', 'on', true);
  update public.payment_request_extraordinary_authorizations
  set status = 'active',
      evidence_type = v_type,
      evidence_sha256 = v_hash,
      evidence_mime_type = v_mime,
      evidence_size_bytes = p_evidence_size_bytes,
      evidence_verified_at = v_now,
      evidence_match_attested_by = v_actor,
      evidence_match_attested_at = v_now,
      updated_at = v_now
  where id = v_authorization.id
    and status = 'draft';
  if not found then raise exception 'extraordinary_authorization_changed'; end if;

  perform public.extraordinary_append_event(
    v_authorization.id,
    'evidence_finalized',
    v_actor,
    'evidence-finalized:' || v_authorization.id::text || ':' || v_key,
    jsonb_build_object(
      'evidence_type', v_type,
      'evidence_sha256', v_hash,
      'mime_type', v_mime,
      'size_bytes', p_evidence_size_bytes,
      'request_match_attested', true
    )
  );
  perform public.extraordinary_append_event(
    v_authorization.id,
    'authorization_activated',
    v_actor,
    'authorization-activated:' || v_authorization.id::text || ':' || v_key,
    jsonb_build_object(
      'valid_until', v_authorization.valid_until,
      'ratification_due_at', v_authorization.ratification_due_at
    )
  );

  return jsonb_build_object(
    'authorization_id', v_authorization.id,
    'status', 'active',
    'valid_until', v_authorization.valid_until,
    'ratification_due_at', v_authorization.ratification_due_at,
    'idempotent_replay', false
  );
end
$$;

create or replace function public.extraordinary_authorization_is_ready(
  p_authorization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.payment_request_extraordinary_authorizations extraordinary_auth
    join public.payment_requests request
      on request.id = extraordinary_auth.payment_request_id
    join public.extraordinary_payment_policies policy
      on policy.company_id = extraordinary_auth.company_id
    where extraordinary_auth.id = p_authorization_id
      and extraordinary_auth.status = 'active'
      and policy.enabled
      and policy.evidence_required
      and extraordinary_auth.evidence_verified_at is not null
      and extraordinary_auth.evidence_match_attested_at is not null
      and extraordinary_auth.valid_until > clock_timestamp()
      and extraordinary_auth.external_authorized_at >=
        request.approval_material_updated_at
      and request.currency = 'MXN'
      and request.amount_requested <= policy.max_amount_mxn
      and extraordinary_auth.category = any(policy.allowed_categories)
      and request.status::text in (
        'submitted', 'pending_approval', 'approved'
      )
      and coalesce(
        public.approval_batch_budget_validation(request.id)->>'status',
        'bloqueado'
      ) = 'aprobable'
      and cardinality(
        public.payment_request_layout_missing_fields(request)
      ) = 0
      and not public.approval_batch_request_has_any_execution_record(request.id)
      and not exists (
        select 1
        from public.payment_request_receipt_links receipt_link
        where receipt_link.payment_request_id = request.id
      )
      and not exists (
        select 1
        from public.approval_batch_items batch_item
        join public.approval_batches batch on batch.id = batch_item.batch_id
        where batch_item.payment_request_id = request.id
          and (
            (
              batch_item.removed_at is null
              and batch_item.director_status = 'rejected'
            )
            or batch.status in ('draft', 'submitted')
          )
      )
  );
$$;

create or replace function public.extraordinary_validate_layout_line()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
begin
  if exists (
    select 1
    from public.payment_request_extraordinary_authorizations extraordinary_auth
    where extraordinary_auth.payment_request_id = new.payment_request_id
      and extraordinary_auth.idempotency_key is not null
      and extraordinary_auth.status in (
        'consumed_pending_ratification',
        'ratified',
        'disputed',
        'expired'
      )
  ) then
    raise exception 'extraordinary_authorization_already_consumed_or_closed';
  end if;

  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where payment_request_id = new.payment_request_id
    and status = 'active'
  order by authorized_at desc
  limit 1
  for update;

  if found and not public.extraordinary_authorization_is_ready(
    v_authorization.id
  ) then
    raise exception 'secure_extraordinary_authorization_not_ready';
  end if;
  return new;
end
$$;

create trigger aa_validate_secure_extraordinary_layout_line
before insert on public.payment_layout_lines
for each row execute function public.extraordinary_validate_layout_line();

create or replace function public.extraordinary_consume_layout_line()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_authorization_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  perform set_config('app.extraordinary_internal', 'on', true);
  update public.payment_request_extraordinary_authorizations extraordinary_auth
  set status = 'consumed_pending_ratification',
      consumed_at = v_now,
      consumed_layout_id = new.layout_id,
      consumed_layout_line_id = new.id,
      updated_at = v_now
  where extraordinary_auth.payment_request_id = new.payment_request_id
    and extraordinary_auth.status = 'active'
    and public.extraordinary_authorization_is_ready(extraordinary_auth.id)
  returning extraordinary_auth.id into v_authorization_id;

  if v_authorization_id is not null then
    perform public.extraordinary_append_event(
      v_authorization_id,
      'authorization_consumed',
      v_actor,
      'authorization-consumed:' || v_authorization_id::text,
      jsonb_build_object(
        'layout_id', new.layout_id,
        'layout_line_id', new.id,
        'status', 'consumed_pending_ratification'
      )
    );
  end if;
  return new;
end
$$;

create trigger zz_consume_secure_extraordinary_layout_line
after insert on public.payment_layout_lines
for each row execute function public.extraordinary_consume_layout_line();

create or replace function public.ratify_extraordinary_authorization(
  p_authorization_id uuid,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
  v_request public.payment_requests%rowtype;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then raise exception 'not_authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_authorization_id::text, 37037));
  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where id = p_authorization_id
  for update;
  if not found then raise exception 'extraordinary_authorization_not_found'; end if;
  if v_authorization.status = 'ratified'
     and v_authorization.ratified_by = v_actor then
    return jsonb_build_object(
      'authorization_id', v_authorization.id,
      'status', 'ratified',
      'ratified_at', v_authorization.ratified_at,
      'idempotent_replay', true
    );
  end if;
  if v_actor <> v_authorization.external_director_profile_id
     or not public.extraordinary_profile_is_company_director(
       v_actor,
       v_authorization.company_id
     ) then
    raise exception 'registered_external_director_required';
  end if;
  if v_authorization.status <> 'consumed_pending_ratification' then
    raise exception 'extraordinary_authorization_not_pending_ratification';
  end if;
  if v_now > v_authorization.ratification_due_at then
    raise exception 'ratification_window_elapsed';
  end if;
  select * into v_request
  from public.payment_requests
  where id = v_authorization.payment_request_id;
  if v_authorization.external_authorized_at <
     v_request.approval_material_updated_at then
    raise exception 'extraordinary_authorization_materially_stale';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 200 then
    raise exception 'invalid_idempotency_key';
  end if;

  perform set_config('app.extraordinary_internal', 'on', true);
  update public.payment_request_extraordinary_authorizations
  set status = 'ratified',
      ratified_by = v_actor,
      ratified_at = v_now,
      ratification_note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = v_now
  where id = v_authorization.id
    and status = 'consumed_pending_ratification';

  perform public.extraordinary_append_event(
    v_authorization.id,
    'authorization_ratified',
    v_actor,
    'authorization-ratified:' || v_authorization.id::text || ':' || v_key,
    jsonb_build_object(
      'layout_id', v_authorization.consumed_layout_id,
      'layout_line_id', v_authorization.consumed_layout_line_id
    )
  );
  return jsonb_build_object(
    'authorization_id', v_authorization.id,
    'status', 'ratified',
    'ratified_at', v_now,
    'idempotent_replay', false
  );
end
$$;

create or replace function public.dispute_extraordinary_authorization(
  p_authorization_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then raise exception 'not_authenticated'; end if;
  if v_reason is null or char_length(v_reason) < 20 then
    raise exception 'dispute_reason_too_short';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 200 then
    raise exception 'invalid_idempotency_key';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_authorization_id::text, 37037));
  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where id = p_authorization_id
  for update;
  if not found then raise exception 'extraordinary_authorization_not_found'; end if;
  if v_actor <> v_authorization.external_director_profile_id
     or not public.extraordinary_profile_is_company_director(
       v_actor,
       v_authorization.company_id
     ) then
    raise exception 'registered_external_director_required';
  end if;
  if v_authorization.status <> 'consumed_pending_ratification' then
    raise exception 'extraordinary_authorization_not_pending_ratification';
  end if;

  perform set_config('app.extraordinary_internal', 'on', true);
  update public.payment_request_extraordinary_authorizations
  set status = 'disputed',
      disputed_by = v_actor,
      disputed_at = v_now,
      dispute_reason = v_reason,
      updated_at = v_now
  where id = v_authorization.id
    and status = 'consumed_pending_ratification';

  perform public.extraordinary_append_event(
    v_authorization.id,
    'authorization_disputed',
    v_actor,
    'authorization-disputed:' || v_authorization.id::text || ':' || v_key,
    jsonb_build_object(
      'layout_id', v_authorization.consumed_layout_id,
      'layout_line_id', v_authorization.consumed_layout_line_id,
      'reason', v_reason
    )
  );
  return jsonb_build_object(
    'authorization_id', v_authorization.id,
    'status', 'disputed',
    'disputed_at', v_now
  );
end
$$;

create or replace function public.revoke_payment_request_extraordinary(
  p_payment_request_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := clock_timestamp();
begin
  if v_reason is null or char_length(v_reason) < 20 then
    raise exception 'revocation_reason_too_short';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_payment_request_id::text, 37037)
  );
  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where payment_request_id = p_payment_request_id
    and status in ('draft', 'active')
  order by authorized_at desc, id desc
  limit 1
  for update;
  if not found then
    raise exception 'active_extraordinary_authorization_not_found';
  end if;
  perform public.extraordinary_require_finance_for_company(
    v_authorization.company_id
  );
  if v_authorization.status not in ('draft', 'active') then
    raise exception 'extraordinary_authorization_not_revocable';
  end if;
  perform set_config('app.extraordinary_internal', 'on', true);
  update public.payment_request_extraordinary_authorizations
  set status = 'revoked',
      revoked_by = v_actor,
      revoked_at = v_now,
      revoke_reason = v_reason,
      updated_at = v_now
  where id = v_authorization.id;
  perform public.extraordinary_append_event(
    v_authorization.id,
    'authorization_revoked',
    v_actor,
    'authorization-revoked:' || v_authorization.id::text,
    jsonb_build_object('reason', v_reason)
  );
  return jsonb_build_object(
    'authorization_id', v_authorization.id,
    'status', 'revoked',
    'revoked_at', v_now
  );
end
$$;

create or replace function public.assert_extraordinary_payment_confirmation_allowed(
  p_payment_request_id uuid,
  p_layout_id uuid default null,
  p_layout_line_id uuid default null
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
  v_request public.payment_requests%rowtype;
begin
  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where payment_request_id = p_payment_request_id
    and idempotency_key is not null
  order by authorized_at desc
  limit 1;
  if not found then return; end if;

  if v_authorization.status <> 'ratified'
     or v_authorization.revoked_at is not null
     or v_authorization.disputed_at is not null then
    raise exception 'extraordinary_payment_confirmation_requires_ratification';
  end if;
  if p_layout_id is not null
     and v_authorization.consumed_layout_id <> p_layout_id then
    raise exception 'extraordinary_confirmation_layout_mismatch';
  end if;
  if p_layout_line_id is not null
     and v_authorization.consumed_layout_line_id <> p_layout_line_id then
    raise exception 'extraordinary_confirmation_layout_line_mismatch';
  end if;
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id;
  if not found
     or v_authorization.payment_request_id <> v_request.id
     or v_authorization.company_id <> v_request.company_id
     or v_authorization.external_authorized_at <
       v_request.approval_material_updated_at then
    raise exception 'extraordinary_confirmation_material_mismatch';
  end if;
end
$$;

create or replace function public.extraordinary_guard_receipt_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_line_id uuid;
begin
  if new.layout_id is not null then
    select line.id into v_line_id
    from public.payment_layout_lines line
    where line.layout_id = new.layout_id
      and line.payment_request_id = new.payment_request_id
    order by line.created_at desc
    limit 1;
  end if;
  perform public.assert_extraordinary_payment_confirmation_allowed(
    new.payment_request_id,
    new.layout_id,
    v_line_id
  );
  return new;
end
$$;

create trigger guard_extraordinary_payment_receipt_insert
before insert on public.payment_receipts
for each row execute function public.extraordinary_guard_receipt_insert();

create or replace function public.extraordinary_guard_layout_line_paid()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'paid'
     and old.status is distinct from new.status then
    perform public.assert_extraordinary_payment_confirmation_allowed(
      new.payment_request_id,
      new.layout_id,
      new.id
    );
  end if;
  return new;
end
$$;

create trigger guard_extraordinary_layout_line_paid
before update of status on public.payment_layout_lines
for each row execute function public.extraordinary_guard_layout_line_paid();

create or replace function public.extraordinary_guard_request_paid()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
begin
  if new.status::text = 'paid'
     and old.status::text is distinct from new.status::text then
    select * into v_authorization
    from public.payment_request_extraordinary_authorizations
    where payment_request_id = new.id
      and idempotency_key is not null
    order by authorized_at desc
    limit 1;
    perform public.assert_extraordinary_payment_confirmation_allowed(
      new.id,
      v_authorization.consumed_layout_id,
      v_authorization.consumed_layout_line_id
    );
  end if;
  return new;
end
$$;

create trigger guard_extraordinary_request_paid
before update of status on public.payment_requests
for each row execute function public.extraordinary_guard_request_paid();

create or replace function public.extraordinary_invalidate_material_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_authorization record;
begin
  if new.approval_material_updated_at is not distinct from
     old.approval_material_updated_at then
    return new;
  end if;
  perform set_config('app.extraordinary_internal', 'on', true);
  for v_authorization in
    update public.payment_request_extraordinary_authorizations extraordinary_auth
    set status = 'expired',
        updated_at = clock_timestamp()
    where extraordinary_auth.payment_request_id = new.id
      and extraordinary_auth.idempotency_key is not null
      and extraordinary_auth.status in (
        'active', 'consumed_pending_ratification', 'ratified'
      )
    returning extraordinary_auth.id
  loop
    perform public.extraordinary_append_event(
      v_authorization.id,
      'material_change_invalidated',
      public.current_profile_id(),
      'material-invalidated:' || v_authorization.id::text || ':' ||
        extract(epoch from new.approval_material_updated_at)::bigint::text,
      jsonb_build_object(
        'approval_material_updated_at',
        new.approval_material_updated_at
      )
    );
  end loop;
  return new;
end
$$;

create trigger invalidate_extraordinary_on_material_change
after update of approval_material_updated_at on public.payment_requests
for each row execute function public.extraordinary_invalidate_material_change();

create or replace function public.extraordinary_authorization_state_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.extraordinary_internal', true) <> 'on' then
    raise exception 'extraordinary_authorization_state_is_rpc_only';
  end if;
  return new;
end
$$;

create trigger protect_extraordinary_authorization_state
before update on public.payment_request_extraordinary_authorizations
for each row execute function public.extraordinary_authorization_state_guard();

create or replace function public.get_extraordinary_authorization_evidence_access(
  p_authorization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
begin
  if v_actor is null then raise exception 'not_authenticated'; end if;
  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where id = p_authorization_id;
  if not found then raise exception 'extraordinary_authorization_not_found'; end if;

  if not (
    (
      public.current_user_has_role(public.flux_finance_roles())
      and (
        public.current_user_has_role(public.flux_sysadmin_roles())
        or public.extraordinary_profile_is_active_member(
          v_actor,
          v_authorization.company_id
        )
      )
    )
    or v_actor = v_authorization.external_director_profile_id
  ) then
    raise exception 'extraordinary_evidence_access_denied';
  end if;
  if v_authorization.evidence_verified_at is null then
    raise exception 'extraordinary_evidence_not_finalized';
  end if;

  return jsonb_build_object(
    'authorization_id', v_authorization.id,
    'storage_bucket', v_authorization.evidence_storage_bucket,
    'storage_path', v_authorization.evidence_storage_path,
    'url_ttl_seconds', 120,
    'mime_type', v_authorization.evidence_mime_type,
    'size_bytes', v_authorization.evidence_size_bytes
  );
end
$$;

create or replace function public.list_extraordinary_regularizations(
  p_company_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if v_actor is null then raise exception 'not_authenticated'; end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'authorization_id', extraordinary_auth.id,
        'payment_request_id', extraordinary_auth.payment_request_id,
        'request_number', request.request_number,
        'company_id', extraordinary_auth.company_id,
        'amount', request.amount_requested,
        'currency', request.currency,
        'category', extraordinary_auth.category,
        'status', extraordinary_auth.status,
        'consumed_at', extraordinary_auth.consumed_at,
        'ratification_due_at', extraordinary_auth.ratification_due_at,
        'layout_id', extraordinary_auth.consumed_layout_id,
        'layout_line_id', extraordinary_auth.consumed_layout_line_id,
        'can_decide',
          v_actor = extraordinary_auth.external_director_profile_id
      )
      order by extraordinary_auth.ratification_due_at, extraordinary_auth.id
    )
    from public.payment_request_extraordinary_authorizations extraordinary_auth
    join public.payment_requests request
      on request.id = extraordinary_auth.payment_request_id
    where extraordinary_auth.status in (
      'consumed_pending_ratification', 'ratified', 'disputed'
    )
      and (p_company_id is null or extraordinary_auth.company_id = p_company_id)
      and (
        (
          v_actor = extraordinary_auth.external_director_profile_id
          and public.extraordinary_profile_is_company_director(
            v_actor,
            extraordinary_auth.company_id
          )
        )
        or (
          public.current_user_has_role(public.flux_finance_roles())
          and (
            public.current_user_has_role(public.flux_sysadmin_roles())
            or public.extraordinary_profile_is_active_member(
              v_actor,
              extraordinary_auth.company_id
            )
          )
        )
      )
  ), '[]'::jsonb);
end
$$;

create or replace function public.extraordinary_evidence_storage_allowed(
  p_name text,
  p_write boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_authorization_id uuid;
  v_company_id uuid;
  v_authorization public.payment_request_extraordinary_authorizations%rowtype;
begin
  if v_actor is null
     or p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/evidence/[0-9a-f-]{36}$' then
    return false;
  end if;
  v_company_id := split_part(p_name, '/', 1)::uuid;
  v_authorization_id := split_part(p_name, '/', 2)::uuid;
  select * into v_authorization
  from public.payment_request_extraordinary_authorizations
  where id = v_authorization_id
    and company_id = v_company_id
    and evidence_storage_path = p_name;
  if not found then return false; end if;

  if p_write then
    return v_authorization.status = 'draft'
      and v_authorization.authorized_by = v_actor
      and public.extraordinary_profile_is_active_member(
        v_actor,
        v_company_id
      );
  end if;
  return (
    v_actor = v_authorization.external_director_profile_id
    or (
      public.current_user_has_role(public.flux_finance_roles())
      and (
        public.current_user_has_role(public.flux_sysadmin_roles())
        or public.extraordinary_profile_is_active_member(
          v_actor,
          v_company_id
        )
      )
    )
  );
end
$$;

insert into storage.buckets(
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'extraordinary-authorizations',
  'extraordinary-authorizations',
  false,
  5242880,
  array['application/pdf','image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types =
      array['application/pdf','image/jpeg','image/png','image/webp'];

drop policy if exists extraordinary_evidence_insert on storage.objects;
create policy extraordinary_evidence_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'extraordinary-authorizations'
  and public.extraordinary_evidence_storage_allowed(name, true)
);

drop policy if exists extraordinary_evidence_select on storage.objects;
create policy extraordinary_evidence_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'extraordinary-authorizations'
  and public.extraordinary_evidence_storage_allowed(name, false)
);

-- Preserve the execution context used by solicitudes.html, then enrich it
-- with the secure two-step contract.  The wrapper intentionally returns only
-- display-safe evidence metadata; signed URLs remain a separate RPC.
alter function public.get_payment_request_execution_context(uuid)
  rename to get_payment_request_execution_context_pre_037;

create function public.get_payment_request_execution_context(
  p_payment_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base jsonb;
  v_actor uuid := public.current_profile_id();
  v_policy public.extraordinary_payment_policies%rowtype;
  v_policy_found boolean := false;
  v_directors jsonb := '[]'::jsonb;
  v_authorization record;
  v_has_authorization boolean := false;
  v_has_open_authorization boolean := false;
  v_is_finance boolean := false;
  v_can_begin boolean := false;
  v_block_reason text;
begin
  v_base := public.get_payment_request_execution_context_pre_037(
    p_payment_request_id
  );
  v_is_finance := coalesce((v_base->>'is_finance')::boolean, false);

  select policy.*
  into v_policy
  from public.extraordinary_payment_policies policy
  join public.payment_requests request
    on request.company_id = policy.company_id
  where request.id = p_payment_request_id;
  v_policy_found := found;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'profile_id', director.director_profile_id,
      'name', profile.full_name
    )
    order by profile.full_name, director.director_profile_id
  ), '[]'::jsonb)
  into v_directors
  from public.payment_requests request
  join public.company_directors director
    on director.company_id = request.company_id
   and director.active
  join public.profiles profile
    on profile.id = director.director_profile_id
   and profile.active
  where request.id = p_payment_request_id
    and public.extraordinary_profile_is_company_director(
      director.director_profile_id,
      request.company_id
    );

  select
    extraordinary_auth.*,
    author.full_name as authorized_by_name,
    external_director.full_name as external_director_name
  into v_authorization
  from public.payment_request_extraordinary_authorizations extraordinary_auth
  left join public.profiles author
    on author.id = extraordinary_auth.authorized_by
  left join public.profiles external_director
    on external_director.id = extraordinary_auth.external_director_profile_id
  where extraordinary_auth.payment_request_id = p_payment_request_id
  order by extraordinary_auth.authorized_at desc, extraordinary_auth.id desc
  limit 1;
  v_has_authorization := found;

  select exists (
    select 1
    from public.payment_request_extraordinary_authorizations extraordinary_auth
    where extraordinary_auth.payment_request_id = p_payment_request_id
      and extraordinary_auth.status in (
        'draft', 'active', 'consumed_pending_ratification'
      )
  )
  into v_has_open_authorization;

  v_can_begin :=
    v_is_finance
    and coalesce((v_base->>'can_authorize_extraordinary')::boolean, false)
    and v_policy_found
    and v_policy.enabled
    and jsonb_array_length(v_directors) > 0
    and not v_has_open_authorization;

  v_block_reason := case
    when not v_is_finance then 'finance_role_required'
    when v_has_open_authorization then 'extraordinary_authorization_already_open'
    when not coalesce((v_base->>'can_authorize_extraordinary')::boolean, false)
      then v_base->>'authorization_block_reason'
    when not v_policy_found or not v_policy.enabled
      then 'extraordinary_policy_disabled'
    when jsonb_array_length(v_directors) = 0
      then 'external_director_not_active_for_company'
    else null
  end;

  return v_base || jsonb_build_object(
    'can_authorize_extraordinary', v_can_begin,
    'authorization_block_reason', v_block_reason,
    'extraordinary_policy', case
      when not v_policy_found then null
      else jsonb_build_object(
        'enabled', v_policy.enabled,
        'max_amount_mxn', v_policy.max_amount_mxn,
        'allowed_categories', v_policy.allowed_categories,
        'authorization_valid_hours', v_policy.authorization_valid_hours,
        'ratification_due_hours', v_policy.ratification_due_hours,
        'evidence_required', v_policy.evidence_required
      )
    end,
    'eligible_external_directors', v_directors,
    'extraordinary', case
      when not v_has_authorization then null
      else jsonb_build_object(
        'id', v_authorization.id,
        'secure_contract',
          v_authorization.external_director_profile_id is not null,
        'status', v_authorization.status,
        'category', v_authorization.category,
        'reason', v_authorization.reason,
        'authorized_by', v_authorization.authorized_by,
        'authorized_by_name', v_authorization.authorized_by_name,
        'authorized_at', v_authorization.authorized_at,
        'external_director_profile_id',
          v_authorization.external_director_profile_id,
        'external_director_name', v_authorization.external_director_name,
        'external_authorized_at', v_authorization.external_authorized_at,
        'valid_until', v_authorization.valid_until,
        'ratification_due_at', v_authorization.ratification_due_at,
        'evidence_type', v_authorization.evidence_type,
        'evidence_sha256', v_authorization.evidence_sha256,
        'evidence_mime_type', v_authorization.evidence_mime_type,
        'evidence_size_bytes', v_authorization.evidence_size_bytes,
        'evidence_finalized',
          v_authorization.evidence_verified_at is not null,
        'storage_bucket', case
          when v_authorization.status = 'draft'
            and (
              v_authorization.authorized_by = v_actor
              or public.current_user_has_role(public.flux_sysadmin_roles())
            )
          then v_authorization.evidence_storage_bucket
          else null
        end,
        'storage_path', case
          when v_authorization.status = 'draft'
            and (
              v_authorization.authorized_by = v_actor
              or public.current_user_has_role(public.flux_sysadmin_roles())
            )
          then v_authorization.evidence_storage_path
          else null
        end,
        'can_resume', v_authorization.status = 'draft'
          and (
            v_authorization.authorized_by = v_actor
            or public.current_user_has_role(public.flux_sysadmin_roles())
          ),
        'authorization_current',
          v_authorization.status = 'active'
          and public.extraordinary_authorization_is_ready(v_authorization.id),
        'ready_for_layout',
          public.extraordinary_authorization_is_ready(v_authorization.id),
        'can_revoke',
          v_is_finance
          and v_authorization.status in ('draft', 'active')
          and not coalesce((v_base->>'executed')::boolean, false),
        'consumed_at', v_authorization.consumed_at,
        'consumed_layout_id', v_authorization.consumed_layout_id,
        'ratified_at', v_authorization.ratified_at,
        'disputed_at', v_authorization.disputed_at,
        'dispute_reason', v_authorization.dispute_reason,
        'legacy_classification_reason',
          v_authorization.legacy_classification_reason
      )
    end
  );
end
$$;

-- Preserve the previous classifier under an internal name and expose a
-- fail-closed wrapper that downgrades stale/expired extraordinary rows.
alter function public.approval_batch_payment_layout_candidates(
  date, date, uuid, uuid
) rename to approval_batch_payment_layout_candidates_pre_037;

create function public.approval_batch_payment_layout_candidates(
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
  select
    case
      when candidate.classification = 'ready_extraordinary'
        and not public.extraordinary_authorization_is_ready(
          candidate.extraordinary_authorization_id
        )
      then 'invalid_data'
      else candidate.classification
    end,
    case
      when candidate.classification = 'ready_extraordinary'
        and not public.extraordinary_authorization_is_ready(
          candidate.extraordinary_authorization_id
        )
      then 'extraordinary_not_ready_secure_contract'
      else candidate.classification_reason
    end,
    candidate.payment_request_id,
    candidate.request_number,
    candidate.request_status,
    candidate.company_id,
    candidate.company_name,
    candidate.proveedor_id,
    candidate.provider_name,
    candidate.company_bank_account_id,
    candidate.source_account_number,
    candidate.destination_type,
    candidate.destination_value,
    candidate.beneficiary_name,
    candidate.amount,
    candidate.currency,
    candidate.payment_reference,
    candidate.payment_concept,
    candidate.scheduled_payment_date,
    candidate.missing_fields,
    candidate.finance_approval_current,
    candidate.direction_approval_current,
    candidate.direction_decided_at,
    candidate.enforcement_required,
    candidate.source_item_id,
    candidate.source_batch_id,
    candidate.source_batch_label,
    candidate.source_batch_status,
    candidate.director_status,
    candidate.reject_reason,
    candidate.rejected_by,
    candidate.rejected_by_name,
    candidate.rejected_at,
    candidate.rebatch_status,
    candidate.latest_correction_note,
    candidate.extraordinary_authorization_id,
    candidate.extraordinary_category,
    candidate.extraordinary_reason,
    candidate.extraordinary_authorized_by,
    candidate.extraordinary_authorized_by_name,
    candidate.extraordinary_authorized_at
  from public.approval_batch_payment_layout_candidates_pre_037(
    p_period_start,
    p_period_end,
    p_company_id,
    p_company_bank_account_id
  ) candidate;
$$;

alter function public.preview_payment_layout_eligibility(
  date, date, uuid, uuid
) rename to preview_payment_layout_eligibility_pre_037;

create function public.preview_payment_layout_eligibility(
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
  v_ready jsonb;
  v_blocked jsonb;
  v_invalid jsonb;
  v_totals jsonb;
begin
  v_result := public.preview_payment_layout_eligibility_pre_037(
    p_period_start,
    p_period_end,
    p_company_id,
    p_company_bank_account_id
  );

  select coalesce(jsonb_agg(item), '[]'::jsonb)
  into v_ready
  from jsonb_array_elements(
    coalesce(v_result->'ready_extraordinary', '[]'::jsonb)
  ) item
  where public.extraordinary_authorization_is_ready(
    (item->>'extraordinary_authorization_id')::uuid
  );

  select coalesce(jsonb_agg(
    jsonb_set(
      jsonb_set(item, '{classification}', '"invalid_data"'::jsonb),
      '{classification_reason}',
      '"extraordinary_not_ready_secure_contract"'::jsonb
    )
  ), '[]'::jsonb)
  into v_blocked
  from jsonb_array_elements(
    coalesce(v_result->'ready_extraordinary', '[]'::jsonb)
  ) item
  where not public.extraordinary_authorization_is_ready(
    (item->>'extraordinary_authorization_id')::uuid
  );

  v_invalid := coalesce(v_result->'invalid_data', '[]'::jsonb) || v_blocked;

  with retained as (
    select total
    from jsonb_array_elements(
      coalesce(v_result->'totals_by_currency', '[]'::jsonb)
    ) total
    where total->>'classification' <> 'ready_extraordinary'
  ), secure_totals as (
    select jsonb_build_object(
      'classification', 'ready_extraordinary',
      'currency', item->>'currency',
      'payment_count', count(*),
      'amount', sum((item->>'amount')::numeric)
    ) total
    from jsonb_array_elements(v_ready) item
    group by item->>'currency'
  )
  select coalesce(jsonb_agg(total), '[]'::jsonb)
  into v_totals
  from (
    select total from retained
    union all
    select total from secure_totals
  ) totals;

  return jsonb_set(
    jsonb_set(
      jsonb_set(v_result, '{ready_extraordinary}', v_ready),
      '{invalid_data}',
      v_invalid
    ),
    '{totals_by_currency}',
    v_totals
  );
end
$$;

revoke all on function public.approval_batch_payment_layout_candidates_pre_037(
  date,date,uuid,uuid
) from public, anon, authenticated;
revoke all on function public.preview_payment_layout_eligibility_pre_037(
  date,date,uuid,uuid
) from public, anon, authenticated;

revoke all on function public.extraordinary_profile_is_active_member(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.extraordinary_profile_is_company_director(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.extraordinary_require_finance_for_company(uuid)
  from public, anon, authenticated;
revoke all on function public.extraordinary_append_event(uuid,text,uuid,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.extraordinary_authorization_is_ready(uuid)
  from public, anon, authenticated;
revoke all on function public.extraordinary_validate_layout_line()
  from public, anon, authenticated;
revoke all on function public.extraordinary_consume_layout_line()
  from public, anon, authenticated;
revoke all on function public.extraordinary_guard_receipt_insert()
  from public, anon, authenticated;
revoke all on function public.extraordinary_guard_layout_line_paid()
  from public, anon, authenticated;
revoke all on function public.extraordinary_guard_request_paid()
  from public, anon, authenticated;
revoke all on function public.extraordinary_invalidate_material_change()
  from public, anon, authenticated;
revoke all on function public.extraordinary_authorization_state_guard()
  from public, anon, authenticated;
revoke all on function public.extraordinary_evidence_storage_allowed(text,boolean)
  from public, anon, authenticated;
revoke all on function public.approval_batch_item_release_block_reason(uuid)
  from public, anon, authenticated;
revoke all on function public.preview_approval_batch_close(uuid)
  from public, anon;

revoke all on function public.set_extraordinary_payment_policy(
  uuid,boolean,numeric,text[],integer,integer
) from public, anon;
revoke all on function public.begin_extraordinary_authorization(
  uuid,text,text,uuid,timestamptz,text
) from public, anon;
revoke all on function public.finalize_extraordinary_authorization(
  uuid,text,text,text,bigint,boolean,text
) from public, anon;
revoke all on function public.ratify_extraordinary_authorization(uuid,text,text)
  from public, anon;
revoke all on function public.dispute_extraordinary_authorization(uuid,text,text)
  from public, anon;
revoke all on function public.revoke_payment_request_extraordinary(uuid,text)
  from public, anon;
revoke all on function public.get_extraordinary_authorization_evidence_access(uuid)
  from public, anon;
revoke all on function public.list_extraordinary_regularizations(uuid)
  from public, anon;
revoke all on function public.approval_batch_payment_layout_candidates(
  date,date,uuid,uuid
) from public, anon;
revoke all on function public.preview_payment_layout_eligibility(
  date,date,uuid,uuid
) from public, anon;
revoke all on function public.get_payment_request_execution_context_pre_037(uuid)
  from public, anon, authenticated;
revoke all on function public.get_payment_request_execution_context(uuid)
  from public, anon;
revoke all on function public.assert_extraordinary_payment_confirmation_allowed(
  uuid,uuid,uuid
) from public, anon, authenticated;

grant execute on function public.set_extraordinary_payment_policy(
  uuid,boolean,numeric,text[],integer,integer
) to authenticated;
grant execute on function public.begin_extraordinary_authorization(
  uuid,text,text,uuid,timestamptz,text
) to authenticated;
grant execute on function public.finalize_extraordinary_authorization(
  uuid,text,text,text,bigint,boolean,text
) to authenticated;
grant execute on function public.ratify_extraordinary_authorization(uuid,text,text)
  to authenticated;
grant execute on function public.dispute_extraordinary_authorization(uuid,text,text)
  to authenticated;
grant execute on function public.revoke_payment_request_extraordinary(uuid,text)
  to authenticated;
grant execute on function public.get_extraordinary_authorization_evidence_access(uuid)
  to authenticated;
grant execute on function public.list_extraordinary_regularizations(uuid)
  to authenticated;
grant execute on function public.approval_batch_payment_layout_candidates(
  date,date,uuid,uuid
) to authenticated;
grant execute on function public.preview_payment_layout_eligibility(
  date,date,uuid,uuid
) to authenticated;
grant execute on function public.get_payment_request_execution_context(uuid)
  to authenticated;
grant execute on function public.preview_approval_batch_close(uuid)
  to authenticated;

-- Table writes remain RPC-only. Existing read policies continue to apply.
revoke insert, update, delete
on public.payment_request_extraordinary_authorizations
from authenticated;

do $postcheck$
declare
  v_status_constraint text;
  v_status_constraint_count integer;
begin
  select count(*)
  into v_status_constraint_count
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.conname like '%status_check';

  select pg_get_constraintdef(constraint_info.oid, true)
  into v_status_constraint
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.conname =
      'payment_request_extraordinary_status_check';

  if v_status_constraint_count <> 1
     or v_status_constraint is distinct from
       'CHECK (status = ANY (ARRAY[''draft''::text, ''active''::text, ''consumed_pending_ratification''::text, ''ratified''::text, ''revoked''::text, ''expired''::text, ''disputed''::text, ''legacy_consumed_unverified''::text, ''legacy_quarantined''::text]))'
     or not exists (
       select 1
       from pg_constraint constraint_info
       where constraint_info.conrelid =
           'public.payment_request_extraordinary_authorizations'::regclass
         and constraint_info.conname =
           'payment_request_extraordinary_revoke_check'
     )
     or not exists (
       select 1
       from pg_constraint constraint_info
       where constraint_info.conrelid =
           'public.payment_request_extraordinary_authorizations'::regclass
         and constraint_info.conname =
           'payment_request_extraordinary_legacy_class_check'
     )
     or not exists (
       select 1
       from pg_constraint constraint_info
       where constraint_info.conrelid =
           'public.payment_request_extraordinary_authorizations'::regclass
         and constraint_info.conname =
           'payment_request_extraordinary_lifecycle_check'
     ) then
    raise exception '037_postcheck: canonical extraordinary constraints are invalid';
  end if;

  if exists (
    select 1
    from public.extraordinary_payment_policies
    where enabled
  ) then
    raise exception '037_postcheck: every extraordinary policy must default disabled';
  end if;

  if exists (
    select 1
    from public.extraordinary_payment_policies policy
    join public.companies company on company.id = policy.company_id
    where policy.enabled
      and lower(coalesce(company.name, '')) like '%operadora%'
  ) then
    raise exception '037_postcheck: Operadora policy must remain disabled';
  end if;
  if not exists (
    select 1
    from storage.buckets
    where id = 'extraordinary-authorizations'
      and not public
      and file_size_limit = 5242880
  ) then
    raise exception '037_postcheck: private evidence bucket is invalid';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.authorize_payment_request_extraordinary(uuid,text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.begin_extraordinary_authorization(uuid,text,text,uuid,timestamptz,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.begin_extraordinary_authorization(uuid,text,text,uuid,timestamptz,text)',
    'EXECUTE'
  ) then
    raise exception '037_postcheck: unexpected extraordinary RPC grants';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.get_payment_request_execution_context_pre_037(uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.get_payment_request_execution_context(uuid)',
    'EXECUTE'
  ) then
    raise exception '037_postcheck: execution context wrapper grants are invalid';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'guard_extraordinary_payment_receipt_insert'
      and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'guard_extraordinary_request_paid'
      and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'guard_extraordinary_layout_line_paid'
      and not tgisinternal
  ) then
    raise exception '037_postcheck: confirmation guards are missing';
  end if;
  if to_regprocedure('public.preview_approval_batch_close(uuid)') is null
     or has_function_privilege(
       'anon',
       'public.preview_approval_batch_close(uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.preview_approval_batch_close(uuid)',
       'EXECUTE'
     ) then
    raise exception '037_postcheck: mixed-close preview contract is invalid';
  end if;
  if not (
    (
      (select count(*)
       from public.payment_request_extraordinary_authorizations) = 0
    )
    or (
      (select count(*)
       from public.payment_request_extraordinary_authorizations
       where status = 'legacy_consumed_unverified') = 7
      and
      (select count(*)
       from public.payment_request_extraordinary_authorizations
       where status = 'legacy_quarantined') = 1
      and
      (select count(*)
       from public.payment_request_extraordinary_authorizations
       where status = 'revoked') = 1
      and
      (select count(*)
       from public.payment_request_extraordinary_authorizations) = 9
    )
  ) then
    raise exception
      '037_postcheck: legacy distribution is neither PROD zero-state nor DEV 7/1/1';
  end if;
end
$postcheck$;

comment on table public.extraordinary_payment_policies is
  'Fail-closed per-company policy for external Direction authorization.';
comment on function public.begin_extraordinary_authorization(
  uuid,text,text,uuid,timestamptz,text
) is 'Creates an idempotent evidence-upload draft; never activates without a private object.';
comment on function public.finalize_extraordinary_authorization(
  uuid,text,text,text,bigint,boolean,text
) is 'Validates policy, actor, Director, object metadata and financial attestation before activation.';
comment on function public.assert_extraordinary_payment_confirmation_allowed(
  uuid,uuid,uuid
) is 'Central server-side ratification guard for extraordinary payment confirmation.';

commit;
