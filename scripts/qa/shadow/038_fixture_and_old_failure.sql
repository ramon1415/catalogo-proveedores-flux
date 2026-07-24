\set ON_ERROR_STOP on

begin;
set local session_replication_role = replica;

insert into public.cost_centers(id, name, code)
values (
  '38000000-0000-4000-8000-000000000001',
  'Shadow 038 cost center',
  'SHADOW-038-CC'
);

insert into public.budget_categories(id, code, name, category, budget_type)
values (
  '38000000-0000-4000-8000-000000000002',
  'SHADOW-038-CAT',
  'Shadow 038 category',
  'Shadow',
  'variable'
);

insert into public.company_cost_centers(
  id,
  company_id,
  cost_center_id,
  active
) values (
  '38000000-0000-4000-8000-000000000003',
  '02000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000001',
  true
);

insert into public.company_cost_center_budget_categories(
  id,
  company_id,
  cost_center_id,
  budget_category_id,
  active
) values (
  '38000000-0000-4000-8000-000000000004',
  '02000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000002',
  true
);

insert into public.budget_versions(
  id,
  name,
  version_type,
  year,
  active,
  loaded_by,
  activated_at
) values (
  '38000000-0000-4000-8000-000000000005',
  'Shadow 038 budget',
  'forecast',
  extract(year from current_date)::integer,
  true,
  '03000000-0000-4000-8000-000000000001',
  now()
);

insert into public.budget_lines(
  id,
  budget_version_id,
  company_id,
  cost_center_id,
  budget_category_id,
  budget_month,
  amount
) values (
  '38000000-0000-4000-8000-000000000006',
  '38000000-0000-4000-8000-000000000005',
  '02000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000002',
  date_trunc('month', current_date)::date,
  1000000
);

insert into public.payment_requests(
  id,
  requested_by,
  amount_requested,
  currency,
  exchange_rate,
  status,
  concept,
  company_id,
  cost_center_id,
  budget_category_id,
  budget_month,
  budget_decision,
  request_number,
  description,
  payment_method,
  approval_material_updated_at
)
select
  (
    '38100000-0000-4000-8000-' ||
    lpad(fixture.sequence::text, 12, '0')
  )::uuid,
  '03000000-0000-4000-8000-000000000001'::uuid,
  100 + fixture.sequence,
  'MXN',
  1,
  'approved'::public.payment_request_status,
  'Synthetic 038 close contract ' || fixture.sequence,
  '02000000-0000-4000-8000-000000000001'::uuid,
  '38000000-0000-4000-8000-000000000001'::uuid,
  '38000000-0000-4000-8000-000000000002'::uuid,
  date_trunc('month', current_date)::date,
  'aprobable',
  'SHADOW-038-' || lpad(fixture.sequence::text, 2, '0'),
  'Synthetic mixed-close contract fixture',
  'transfer',
  case
    when fixture.sequence in (3, 7, 9)
      then now() - interval '30 minutes'
    else now() - interval '3 hours'
  end
from generate_series(1, 13) fixture(sequence);

insert into public.approval_batches(
  id,
  company_id,
  label,
  period_start,
  period_end,
  status,
  director_id,
  created_by,
  submitted_by,
  submitted_at,
  decided_by,
  decided_at,
  notes
)
select
  (
    '38200000-0000-4000-8000-' ||
    lpad(fixture.sequence::text, 12, '0')
  )::uuid,
  '02000000-0000-4000-8000-000000000001'::uuid,
  'Shadow 038 batch ' || fixture.sequence,
  current_date - 7,
  current_date + 7,
  case
    when fixture.sequence = 3 then 'partially_approved'
    else 'approved'
  end,
  '03000000-0000-4000-8000-000000000002'::uuid,
  '03000000-0000-4000-8000-000000000001'::uuid,
  '03000000-0000-4000-8000-000000000001'::uuid,
  now() - interval '2 hours 30 minutes',
  '03000000-0000-4000-8000-000000000002'::uuid,
  now() - interval '2 hours',
  'Synthetic 038 contract batch'
from generate_series(1, 5) fixture(sequence);

insert into public.approval_batch_items(
  id,
  batch_id,
  payment_request_id,
  finance_reviewed_by,
  finance_reviewed_at,
  director_status,
  director_reject_reason,
  rebatch_status,
  decided_by,
  decided_at,
  removed_by,
  removed_at,
  finance_release_status,
  finance_release_reason,
  finance_released_by,
  finance_released_at
)
select
  (
    '38300000-0000-4000-8000-' ||
    lpad(fixture.sequence::text, 12, '0')
  )::uuid,
  (
    '38200000-0000-4000-8000-' ||
    lpad((
      case
        when fixture.sequence between 1 and 3 then 1
        when fixture.sequence between 4 and 6 then 2
        when fixture.sequence between 7 and 8 then 3
        when fixture.sequence = 9 then 4
        else 5
      end
    )::text, 12, '0')
  )::uuid,
  (
    '38100000-0000-4000-8000-' ||
    lpad(fixture.sequence::text, 12, '0')
  )::uuid,
  '03000000-0000-4000-8000-000000000001'::uuid,
  now() - interval '2 hours 15 minutes',
  case
    when fixture.sequence = 8 then 'rejected'
    when fixture.sequence = 11 then 'pending'
    else 'approved'
  end,
  case
    when fixture.sequence = 8 then 'Synthetic Direction rejection'
    else null
  end,
  case
    when fixture.sequence = 8 then 'blocked'
    else 'not_applicable'
  end,
  case
    when fixture.sequence = 11 then null
    else '03000000-0000-4000-8000-000000000002'::uuid
  end,
  case
    when fixture.sequence = 11 then null
    else now() - interval '2 hours'
  end,
  case
    when fixture.sequence = 11
      then '03000000-0000-4000-8000-000000000001'::uuid
    else null
  end,
  case
    when fixture.sequence = 11 then now() - interval '1 hour'
    else null
  end,
  case
    when fixture.sequence in (9, 10) then 'released'
    else 'pending'
  end,
  null,
  case
    when fixture.sequence in (9, 10)
      then '03000000-0000-4000-8000-000000000001'::uuid
    else null
  end,
  case
    when fixture.sequence in (9, 10) then now() - interval '1 hour'
    else null
  end
from generate_series(1, 11) fixture(sequence);

set local session_replication_role = origin;
commit;

select set_config(
  'request.jwt.claim.sub',
  '01000000-0000-4000-8000-000000000001',
  false
);

do $reproduce$
begin
  begin
    perform public.close_approval_batch(
      '38200000-0000-4000-8000-000000000001'::uuid
    );
    raise exception '038_shadow: old materializer unexpectedly accepted mixed close';
  exception
    when others then
      if sqlerrm <> 'snapshot_source_not_currently_payable' then
        raise;
      end if;
  end;

  if (
    select status <> 'approved'
    from public.approval_batches
    where id = '38200000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception '038_shadow: old mixed close did not roll back batch';
  end if;

  if (
    select count(*) <> 3
    from public.approval_batch_items
    where batch_id = '38200000-0000-4000-8000-000000000001'::uuid
      and finance_release_status = 'pending'
  ) then
    raise exception '038_shadow: old mixed close did not roll back items';
  end if;

  if exists (
    select 1
    from public.payable_snapshots snapshot
    join public.approval_batch_items item
      on item.id = snapshot.source_id
     and snapshot.source_type = 'approval_batch_item'
    where item.batch_id =
      '38200000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception '038_shadow: old mixed close left a partial snapshot';
  end if;
end
$reproduce$;

select 'SHADOW_038_OLD_FAILURE_REPRODUCED' as result;
