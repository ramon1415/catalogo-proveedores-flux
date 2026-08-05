-- FLUX Operadora
-- 036: contain historical extraordinary authorizations without fabricating
-- evidence, ratification or an external Director.
--
-- IMPORTANT:
-- * Classification follows direct FK lineage only.
-- * Allocation objects are deliberately out of scope and are never mutated.
-- * This migration is intentionally fail-closed against the approved DEV
--   baseline of nine historical authorizations.

begin;

do $precheck$
declare
  v_total integer;
  v_active integer;
  v_revoked integer;
  v_consumed integer;
  v_quarantined integer;
  v_status_constraint text;
  v_revoke_constraint text;
  v_category_constraint text;
  v_reason_constraint text;
  v_status_constraint_count integer;
  v_active_index text;
  v_trigger_names text[];
  v_legacy_column_count integer;
begin
  if to_regclass('public.payment_request_extraordinary_authorizations') is null
     or to_regclass('public.payment_request_receipt_links') is null
     or to_regclass('public.payment_operation_evidence') is null
     or to_regclass('public.payable_snapshots') is null
     or to_regclass('public.payment_allocation_items') is null
     or to_regprocedure('public.approval_batch_request_has_active_extraordinary(uuid)') is null
     or to_regprocedure('public.authorize_payment_request_extraordinary(uuid,text,text)') is null then
    raise exception '036_precheck: required reconciliation or extraordinary objects are missing';
  end if;

  select pg_get_constraintdef(constraint_info.oid, true)
  into v_status_constraint
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.conname =
      'payment_request_extraordinary_status_check';

  if v_status_constraint is distinct from
      'CHECK (status = ANY (ARRAY[''active''::text, ''revoked''::text]))' then
    raise exception
      '036_precheck: canonical status constraint drift: %',
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
      'CHECK (status = ''active''::text AND revoked_by IS NULL AND revoked_at IS NULL AND revoke_reason IS NULL OR status = ''revoked''::text AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND NULLIF(btrim(revoke_reason), ''''::text) IS NOT NULL)' then
    raise exception
      '036_precheck: canonical revoke constraint drift: %',
      v_revoke_constraint;
  end if;

  select pg_get_constraintdef(constraint_info.oid, true)
  into v_category_constraint
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.conname =
      'payment_request_extraordinary_category_check';

  if v_category_constraint is distinct from
      'CHECK (category = ANY (ARRAY[''operational_emergency''::text, ''urgent_reimbursement''::text, ''urgent_termination''::text, ''critical_service''::text, ''other''::text]))' then
    raise exception
      '036_precheck: canonical category constraint drift: %',
      v_category_constraint;
  end if;

  select pg_get_constraintdef(constraint_info.oid, true)
  into v_reason_constraint
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.conname =
      'payment_request_extraordinary_reason_check';

  if v_reason_constraint is distinct from
      'CHECK (char_length(btrim(reason)) >= 20)' then
    raise exception
      '036_precheck: canonical reason constraint drift: %',
      v_reason_constraint;
  end if;

  select count(*)
  into v_status_constraint_count
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.contype = 'c'
    and pg_get_constraintdef(constraint_info.oid, true) ilike '%status%';

  if v_status_constraint_count <> 2 then
    raise exception
      '036_precheck: unexpected status constraints (% found)',
      v_status_constraint_count;
  end if;

  select pg_get_indexdef(index_info.indexrelid)
  into v_active_index
  from pg_index index_info
  join pg_class index_class on index_class.oid = index_info.indexrelid
  where index_info.indrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and index_class.relname =
      'payment_request_extraordinary_active_uidx';

  if v_active_index is distinct from
      'CREATE UNIQUE INDEX payment_request_extraordinary_active_uidx ON public.payment_request_extraordinary_authorizations USING btree (payment_request_id) WHERE (status = ''active''::text)' then
    raise exception
      '036_precheck: canonical active index drift: %',
      v_active_index;
  end if;

  select array_agg(trigger_info.tgname order by trigger_info.tgname)
  into v_trigger_names
  from pg_trigger trigger_info
  where trigger_info.tgrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and not trigger_info.tgisinternal;

  if v_trigger_names is distinct from array[
      'enqueue_extraordinary_payment_notification',
      'materialize_extraordinary_payable_snapshot',
      'set_payment_request_extraordinary_updated_at'
    ]::text[] then
    raise exception
      '036_precheck: extraordinary trigger catalog drift: %',
      v_trigger_names;
  end if;

  select count(*)
  into v_legacy_column_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'payment_request_extraordinary_authorizations'
    and column_name in (
      'legacy_previous_status',
      'legacy_classified_at',
      'legacy_classified_by',
      'legacy_classification_reason',
      'company_id',
      'external_director_profile_id',
      'evidence_storage_path',
      'idempotency_key',
      'consumed_at',
      'ratified_at',
      'disputed_at'
    );

  if v_legacy_column_count <> 0
     or to_regclass('public.payment_request_extraordinary_events') is not null
     or to_regclass('public.extraordinary_payment_policies') is not null
     or to_regprocedure(
       'public.begin_extraordinary_authorization(uuid,text,text,uuid,timestamp with time zone,text)'
     ) is not null
     or to_regprocedure(
       'public.finalize_extraordinary_authorization(uuid,text,text,text,bigint,boolean,text)'
     ) is not null then
    raise exception '036_precheck: partial 036/037 objects detected';
  end if;

  select
    count(*),
    count(*) filter (where extraordinary_auth.status = 'active'),
    count(*) filter (where extraordinary_auth.status = 'revoked')
  into v_total, v_active, v_revoked
  from public.payment_request_extraordinary_authorizations extraordinary_auth;

  if not (
    (v_total = 0 and v_active = 0 and v_revoked = 0)
    or (v_total = 9 and v_active = 8 and v_revoked = 1)
  ) then
    raise exception
      '036_precheck: unsupported legacy authorization baseline (total %, active %, revoked %)',
      v_total, v_active, v_revoked;
  end if;

  select count(*)
  into v_consumed
  from public.payment_request_extraordinary_authorizations extraordinary_auth
  join public.payment_requests request
    on request.id = extraordinary_auth.payment_request_id
  where extraordinary_auth.status = 'active'
    and request.status::text = 'paid'
    and (
      select count(*)
      from public.payment_request_receipt_links receipt_link
      where receipt_link.payment_request_id = request.id
    ) = 1
    and (
      select count(*)
      from public.payment_request_receipt_links receipt_link
      join public.payment_operation_evidence evidence
        on evidence.id = receipt_link.evidence_id
      join public.payable_snapshots snapshot
        on snapshot.id = receipt_link.snapshot_id
      where receipt_link.payment_request_id = request.id
        and evidence.status = 'shareable'
        and evidence.single_operation_attested
        and evidence.page_count = 1
        and snapshot.payment_request_id = request.id
        and snapshot.source_type = 'extraordinary_authorization'
        and snapshot.source_id = extraordinary_auth.id
        and snapshot.amount_minor = round(request.amount_requested * 100)::bigint
        and snapshot.currency = request.currency
        and receipt_link.amount_minor = snapshot.amount_minor
        and receipt_link.currency = snapshot.currency
    ) = 1
    -- Direct lineage only: an allocation belongs to this request only when its
    -- item points to a snapshot whose payment_request_id is this request.
    and not exists (
      select 1
      from public.payment_allocation_items allocation_item
      join public.payable_snapshots allocation_snapshot
        on allocation_snapshot.id = allocation_item.snapshot_id
      where allocation_snapshot.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_allocation_movements movement
      join public.payable_snapshots movement_snapshot
        on movement_snapshot.id = movement.snapshot_id
      where movement_snapshot.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_layout_lines layout_line
      where layout_line.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.cash_funds cash_fund
      where cash_fund.payment_request_id = request.id
    );

  select count(*)
  into v_quarantined
  from public.payment_request_extraordinary_authorizations extraordinary_auth
  join public.payment_requests request
    on request.id = extraordinary_auth.payment_request_id
  where extraordinary_auth.status = 'active'
    and request.status::text <> 'paid'
    and not exists (
      select 1
      from public.payment_request_receipt_links receipt_link
      where receipt_link.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_receipts receipt
      where receipt.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_allocation_items allocation_item
      join public.payable_snapshots allocation_snapshot
        on allocation_snapshot.id = allocation_item.snapshot_id
      where allocation_snapshot.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_allocation_movements movement
      join public.payable_snapshots movement_snapshot
        on movement_snapshot.id = movement.snapshot_id
      where movement_snapshot.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_layout_lines layout_line
      where layout_line.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.cash_funds cash_fund
      where cash_fund.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.approval_batch_items batch_item
      join public.approval_batches batch
        on batch.id = batch_item.batch_id
      where batch_item.payment_request_id = request.id
        and batch.status in ('draft', 'submitted')
    );

  if not (
    (v_total = 0 and v_consumed = 0 and v_quarantined = 0 and v_revoked = 0)
    or (v_total = 9 and v_consumed = 7 and v_quarantined = 1 and v_revoked = 1)
  ) then
    raise exception
      '036_precheck: direct lineage distribution mismatch (total %, consumed %, quarantined %, revoked %)',
      v_total, v_consumed, v_quarantined, v_revoked;
  end if;
end
$precheck$;

create temporary table legacy_036_immutable_baseline
on commit drop
as
select
  (select count(*) from public.payment_requests) as request_count,
  (select count(*) from public.payment_receipts) as payment_receipt_count,
  (select count(*) from public.payment_request_receipt_links) as receipt_link_count,
  (select count(*) from public.legacy_payment_receipt_links) as legacy_receipt_link_count,
  (select count(*) from public.payment_layouts) as layout_count,
  (select count(*) from public.payment_layout_lines) as layout_line_count,
  (select count(*) from public.payment_allocation_movements) as movement_count,
  (select count(*) from public.financial_outbox_events) as outbox_count,
  (select count(*) from public.financial_outbox_delivery_attempts) as delivery_attempt_count,
  md5(coalesce((
    select string_agg(to_jsonb(plan)::text, '' order by plan.id)
    from public.payment_allocation_plans plan
  ), '')) as allocation_plan_hash,
  md5(coalesce((
    select string_agg(to_jsonb(reservation)::text, '' order by reservation.id)
    from public.payment_allocation_reservations reservation
  ), '')) as allocation_reservation_hash,
  md5(coalesce((
    select string_agg(to_jsonb(operation)::text, '' order by operation.id)
    from public.bank_payment_operations operation
  ), '')) as bank_operation_hash;

alter table public.payment_request_extraordinary_authorizations
  add column legacy_previous_status text,
  add column legacy_classified_at timestamptz,
  add column legacy_classified_by uuid,
  add column legacy_classification_reason text;

alter table public.payment_request_extraordinary_authorizations
  add constraint payment_request_extraordinary_legacy_actor_fkey
  foreign key (legacy_classified_by)
  references public.profiles(id);

alter table public.payment_request_extraordinary_authorizations
  drop constraint payment_request_extraordinary_status_check;

alter table public.payment_request_extraordinary_authorizations
  drop constraint payment_request_extraordinary_revoke_check;

alter table public.payment_request_extraordinary_authorizations
  add constraint payment_request_extraordinary_status_check
  check (
    status in (
      'active',
      'revoked',
      'legacy_consumed_unverified',
      'legacy_quarantined'
    )
  );

alter table public.payment_request_extraordinary_authorizations
  add constraint payment_request_extraordinary_revoke_check
  check (
    (
      status = 'revoked'
      and revoked_by is not null
      and revoked_at is not null
      and nullif(btrim(revoke_reason), '') is not null
    )
    or (
      status <> 'revoked'
      and revoked_by is null
      and revoked_at is null
      and revoke_reason is null
    )
  );

alter table public.payment_request_extraordinary_authorizations
  add constraint payment_request_extraordinary_legacy_class_check
  check (
    (
      status in ('legacy_consumed_unverified', 'legacy_quarantined')
      and legacy_previous_status = 'active'
      and legacy_classified_at is not null
      and nullif(btrim(legacy_classification_reason), '') is not null
    )
    or (
      status not in ('legacy_consumed_unverified', 'legacy_quarantined')
      and legacy_previous_status is null
      and legacy_classified_at is null
      and legacy_classified_by is null
      and legacy_classification_reason is null
    )
  );

comment on column public.payment_request_extraordinary_authorizations.legacy_classified_by is
  'Nullable by design. Automated governance migration 036 is not represented as a business actor.';

create table public.payment_request_extraordinary_events (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid,
  payment_request_id uuid,
  company_id uuid,
  event_type text not null,
  actor_profile_id uuid,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint payment_request_extraordinary_events_authorization_fkey
    foreign key (authorization_id)
    references public.payment_request_extraordinary_authorizations(id),
  constraint payment_request_extraordinary_events_request_fkey
    foreign key (payment_request_id)
    references public.payment_requests(id),
  constraint payment_request_extraordinary_events_company_fkey
    foreign key (company_id)
    references public.companies(id),
  constraint payment_request_extraordinary_events_actor_fkey
    foreign key (actor_profile_id)
    references public.profiles(id),
  constraint payment_request_extraordinary_events_type_check check (
    event_type in (
      'legacy_consumed_classified',
      'legacy_quarantined',
      'legacy_revoked_preserved',
      'legacy_unsafe_rpc_disabled'
    )
  ),
  constraint payment_request_extraordinary_events_idempotency_check check (
    char_length(idempotency_key) between 8 and 200
  ),
  constraint payment_request_extraordinary_events_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  ),
  constraint payment_request_extraordinary_events_idempotency_key unique (
    event_type,
    idempotency_key
  )
);

create index payment_request_extraordinary_events_authorization_idx
  on public.payment_request_extraordinary_events(authorization_id, occurred_at);

create index payment_request_extraordinary_events_request_idx
  on public.payment_request_extraordinary_events(payment_request_id, occurred_at);

create function public.payment_request_extraordinary_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'extraordinary_event_history_is_append_only';
end
$$;

create trigger payment_request_extraordinary_events_immutable
before update or delete on public.payment_request_extraordinary_events
for each row execute function public.payment_request_extraordinary_events_append_only();

alter table public.payment_request_extraordinary_events enable row level security;
revoke all on table public.payment_request_extraordinary_events
  from public, anon, authenticated, service_role;

with eligible as (
  select extraordinary_auth.id
  from public.payment_request_extraordinary_authorizations extraordinary_auth
  join public.payment_requests request
    on request.id = extraordinary_auth.payment_request_id
  where extraordinary_auth.status = 'active'
    and request.status::text = 'paid'
    and (
      select count(*)
      from public.payment_request_receipt_links receipt_link
      join public.payment_operation_evidence evidence
        on evidence.id = receipt_link.evidence_id
      join public.payable_snapshots snapshot
        on snapshot.id = receipt_link.snapshot_id
      where receipt_link.payment_request_id = request.id
        and evidence.status = 'shareable'
        and evidence.single_operation_attested
        and evidence.page_count = 1
        and snapshot.payment_request_id = request.id
        and snapshot.source_type = 'extraordinary_authorization'
        and snapshot.source_id = extraordinary_auth.id
        and snapshot.amount_minor = round(request.amount_requested * 100)::bigint
        and snapshot.currency = request.currency
        and receipt_link.amount_minor = snapshot.amount_minor
        and receipt_link.currency = snapshot.currency
    ) = 1
    and not exists (
      select 1
      from public.payment_allocation_items allocation_item
      join public.payable_snapshots allocation_snapshot
        on allocation_snapshot.id = allocation_item.snapshot_id
      where allocation_snapshot.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_allocation_movements movement
      join public.payable_snapshots movement_snapshot
        on movement_snapshot.id = movement.snapshot_id
      where movement_snapshot.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_layout_lines layout_line
      where layout_line.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.cash_funds cash_fund
      where cash_fund.payment_request_id = request.id
    )
)
update public.payment_request_extraordinary_authorizations extraordinary_auth
set status = 'legacy_consumed_unverified',
    legacy_previous_status = 'active',
    legacy_classified_at = clock_timestamp(),
    legacy_classified_by = null,
    legacy_classification_reason =
      'legacy_paid_with_direct_receipt_link_without_new_receipt_ledger',
    updated_at = clock_timestamp()
from eligible
where extraordinary_auth.id = eligible.id
  and extraordinary_auth.status = 'active';

with eligible as (
  select extraordinary_auth.id
  from public.payment_request_extraordinary_authorizations extraordinary_auth
  join public.payment_requests request
    on request.id = extraordinary_auth.payment_request_id
  where extraordinary_auth.status = 'active'
    and request.status::text <> 'paid'
    and not exists (
      select 1
      from public.payment_request_receipt_links receipt_link
      where receipt_link.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_receipts receipt
      where receipt.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_allocation_items allocation_item
      join public.payable_snapshots allocation_snapshot
        on allocation_snapshot.id = allocation_item.snapshot_id
      where allocation_snapshot.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_allocation_movements movement
      join public.payable_snapshots movement_snapshot
        on movement_snapshot.id = movement.snapshot_id
      where movement_snapshot.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_layout_lines layout_line
      where layout_line.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.cash_funds cash_fund
      where cash_fund.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.approval_batch_items batch_item
      join public.approval_batches batch
        on batch.id = batch_item.batch_id
      where batch_item.payment_request_id = request.id
        and batch.status in ('draft', 'submitted')
    )
)
update public.payment_request_extraordinary_authorizations extraordinary_auth
set status = 'legacy_quarantined',
    legacy_previous_status = 'active',
    legacy_classified_at = clock_timestamp(),
    legacy_classified_by = null,
    legacy_classification_reason =
      'legacy_active_unpaid_without_secure_evidence_contract',
    updated_at = clock_timestamp()
from eligible
where extraordinary_auth.id = eligible.id
  and extraordinary_auth.status = 'active';

insert into public.payment_request_extraordinary_events(
  authorization_id,
  payment_request_id,
  company_id,
  event_type,
  actor_profile_id,
  idempotency_key,
  metadata
)
select
  extraordinary_auth.id,
  extraordinary_auth.payment_request_id,
  request.company_id,
  case extraordinary_auth.status
    when 'legacy_consumed_unverified' then 'legacy_consumed_classified'
    when 'legacy_quarantined' then 'legacy_quarantined'
  end,
  null,
  'migration-036:' || extraordinary_auth.id::text,
  jsonb_build_object(
    'classification_source', 'migration_036_governance',
    'previous_status', extraordinary_auth.legacy_previous_status,
    'status', extraordinary_auth.status,
    'amount_minor', round(request.amount_requested * 100)::bigint,
    'currency', request.currency,
    'direct_lineage_only', true
  )
from public.payment_request_extraordinary_authorizations extraordinary_auth
join public.payment_requests request
  on request.id = extraordinary_auth.payment_request_id
where extraordinary_auth.status in (
  'legacy_consumed_unverified',
  'legacy_quarantined'
);

insert into public.payment_request_extraordinary_events(
  authorization_id,
  payment_request_id,
  company_id,
  event_type,
  actor_profile_id,
  idempotency_key,
  metadata
)
select
  extraordinary_auth.id,
  extraordinary_auth.payment_request_id,
  request.company_id,
  'legacy_revoked_preserved',
  null,
  'migration-036:revoked:' || extraordinary_auth.id::text,
  jsonb_build_object(
    'classification_source', 'migration_036_governance',
    'status', 'revoked'
  )
from public.payment_request_extraordinary_authorizations extraordinary_auth
join public.payment_requests request
  on request.id = extraordinary_auth.payment_request_id
where extraordinary_auth.status = 'revoked';

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
begin
  raise exception 'legacy_extraordinary_flow_disabled';
end
$$;

revoke all on function public.authorize_payment_request_extraordinary(uuid,text,text)
  from public, anon, authenticated;

insert into public.payment_request_extraordinary_events(
  event_type,
  idempotency_key,
  metadata
) values (
  'legacy_unsafe_rpc_disabled',
  'migration-036:unsafe-rpc-disabled',
  jsonb_build_object(
    'function', 'authorize_payment_request_extraordinary(uuid,text,text)',
    'public_execute', false,
    'anon_execute', false,
    'authenticated_execute', false
  )
);

do $postcheck$
declare
  v_baseline legacy_036_immutable_baseline%rowtype;
  v_consumed integer;
  v_quarantined integer;
  v_revoked integer;
  v_active integer;
  v_events integer;
  v_status_constraint_count integer;
begin
  select * into v_baseline from legacy_036_immutable_baseline;

  select
    count(*) filter (where status = 'legacy_consumed_unverified'),
    count(*) filter (where status = 'legacy_quarantined'),
    count(*) filter (where status = 'revoked'),
    count(*) filter (where status = 'active')
  into v_consumed, v_quarantined, v_revoked, v_active
  from public.payment_request_extraordinary_authorizations;

  if not (
    (v_consumed = 0 and v_quarantined = 0 and v_revoked = 0 and v_active = 0)
    or (v_consumed = 7 and v_quarantined = 1 and v_revoked = 1 and v_active = 0)
  ) then
    raise exception
      '036_postcheck: expected PROD 0/0/0/0 or DEV 7/1/1/0, got %/%/%/%',
      v_consumed, v_quarantined, v_revoked, v_active;
  end if;

  select count(*) into v_events
  from public.payment_request_extraordinary_events;
  if v_events <> case when v_consumed = 0 then 1 else 10 end then
    raise exception
      '036_postcheck: expected % legacy events, got %',
      case when v_consumed = 0 then 1 else 10 end,
      v_events;
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
           'payment_request_extraordinary_status_check'
     )
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
     ) then
    raise exception '036_postcheck: canonical constraints are invalid';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.authorize_payment_request_extraordinary(uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.authorize_payment_request_extraordinary(uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'public',
       'public.authorize_payment_request_extraordinary(uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception '036_postcheck: legacy extraordinary RPC is still executable';
  end if;

  if v_baseline.request_count <> (select count(*) from public.payment_requests)
     or v_baseline.payment_receipt_count <> (select count(*) from public.payment_receipts)
     or v_baseline.receipt_link_count <> (select count(*) from public.payment_request_receipt_links)
     or v_baseline.legacy_receipt_link_count <> (select count(*) from public.legacy_payment_receipt_links)
     or v_baseline.layout_count <> (select count(*) from public.payment_layouts)
     or v_baseline.layout_line_count <> (select count(*) from public.payment_layout_lines)
     or v_baseline.movement_count <> (select count(*) from public.payment_allocation_movements)
     or v_baseline.outbox_count <> (select count(*) from public.financial_outbox_events)
     or v_baseline.delivery_attempt_count <> (select count(*) from public.financial_outbox_delivery_attempts)
     or v_baseline.allocation_plan_hash <> md5(coalesce((
       select string_agg(to_jsonb(plan)::text, '' order by plan.id)
       from public.payment_allocation_plans plan
     ), ''))
     or v_baseline.allocation_reservation_hash <> md5(coalesce((
       select string_agg(to_jsonb(reservation)::text, '' order by reservation.id)
       from public.payment_allocation_reservations reservation
     ), ''))
     or v_baseline.bank_operation_hash <> md5(coalesce((
       select string_agg(to_jsonb(operation)::text, '' order by operation.id)
       from public.bank_payment_operations operation
     ), '')) then
    raise exception '036_postcheck: an immutable financial baseline changed';
  end if;
end
$postcheck$;

comment on table public.payment_request_extraordinary_events is
  'Append-only non-dispatchable ledger for extraordinary authorization governance.';

commit;
