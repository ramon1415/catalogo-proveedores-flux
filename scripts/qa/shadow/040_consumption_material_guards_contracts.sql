\set ON_ERROR_STOP on

begin;

set local session_replication_role = replica;

insert into public.proveedores(
  id,
  alias,
  nombre_completo,
  metodo_pago,
  tipo_cuenta,
  cuenta_bancaria,
  banco,
  activo,
  destination_type,
  beneficiary_name
) values (
  '41000000-0000-4000-8000-000000000001',
  'SHADOW-040-NEW',
  'Shadow 040 Atomic',
  'Transferencia bancaria',
  'Cuenta',
  '414000000000000001',
  'Shadow Bank',
  true,
  'cuenta',
  'Shadow 040 Atomic'
);

insert into public.company_bank_accounts(
  id,
  name,
  bank_name,
  currency,
  account_type,
  active,
  company_id,
  account_number
) values (
  '41900000-0000-4000-8000-000000000001',
  'Shadow 040 source',
  'Shadow Bank',
  'MXN',
  'bank',
  true,
  '02000000-0000-4000-8000-000000000001',
  '414000000000000001'
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
  proveedor_id,
  cost_center_id,
  budget_category_id,
  company_bank_account_id,
  budget_month,
  budget_decision,
  request_number,
  description,
  payment_method,
  payment_reference,
  payment_concept,
  scheduled_payment_date,
  approval_material_updated_at
)
select
  (
    '41100000-0000-4000-8000-' ||
    lpad(sequence::text, 12, '0')
  )::uuid,
  '03000000-0000-4000-8000-000000000001',
  4100 + sequence,
  'MXN',
  1,
  'approved'::public.payment_request_status,
  'Shadow 040 atomic request ' || sequence,
  '02000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000002',
  '41900000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date,
  'aprobable',
  'SHADOW-040-' || lpad(sequence::text, 2, '0'),
  'Shadow 040 atomic request ' || sequence,
  'transfer',
  lpad((41000 + sequence)::text, 5, '0'),
  'Shadow 040 atomic request ' || sequence,
  current_date + 1,
  clock_timestamp() - interval '1 hour'
from generate_series(1, 6) fixture(sequence);

insert into public.payment_layouts(
  id,
  layout_number,
  name,
  period_start,
  period_end,
  status,
  generated_by
)
select
  (
    '41200000-0000-4000-8000-' ||
    lpad(sequence::text, 12, '0')
  )::uuid,
  'SHADOW-040-LAYOUT-' || lpad(sequence::text, 2, '0'),
  'Shadow 040 layout ' || sequence,
  current_date,
  current_date,
  'draft',
  '03000000-0000-4000-8000-000000000001'
from generate_series(1, 7) fixture(sequence);

set local session_replication_role = origin;

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
  '02000000-0000-4000-8000-000000000001',
  true,
  100000,
  array['operational_emergency']::text[],
  24,
  48,
  true,
  '03000000-0000-4000-8000-000000000001',
  '03000000-0000-4000-8000-000000000001'
);

insert into public.payment_request_extraordinary_authorizations(
  id,
  payment_request_id,
  category,
  reason,
  status,
  authorized_by,
  authorized_at,
  company_id,
  external_director_profile_id,
  evidence_type,
  evidence_storage_bucket,
  evidence_storage_path,
  evidence_sha256,
  evidence_mime_type,
  evidence_size_bytes,
  evidence_verified_at,
  evidence_match_attested_by,
  evidence_match_attested_at,
  external_authorized_at,
  valid_until,
  ratification_due_at,
  idempotency_key
)
select
  (
    '41400000-0000-4000-8000-' ||
    lpad(sequence::text, 12, '0')
  )::uuid,
  (
    '41100000-0000-4000-8000-' ||
    lpad(sequence::text, 12, '0')
  )::uuid,
  'operational_emergency',
  'Shadow 040 secure authorization reason ' || sequence,
  'active',
  '03000000-0000-4000-8000-000000000001',
  clock_timestamp(),
  '02000000-0000-4000-8000-000000000001',
  '03000000-0000-4000-8000-000000000002',
  'signed_document',
  'extraordinary-approval-evidence',
  (
    '41400000-0000-4000-8000-' ||
    lpad(sequence::text, 12, '0') ||
    '/evidence/fixture'
  ),
  repeat(sequence::text, 64),
  'application/pdf',
  1024,
  clock_timestamp(),
  '03000000-0000-4000-8000-000000000001',
  clock_timestamp(),
  clock_timestamp() - interval '10 minutes',
  clock_timestamp() + interval '12 hours',
  clock_timestamp() + interval '36 hours',
  'shadow-040-atomic-' || sequence
from generate_series(1, 6) fixture(sequence)
where sequence <> 2;

do $fixture_ready$
declare
  v_request public.payment_requests%rowtype;
begin
  select * into strict v_request
  from public.payment_requests
  where id = '41100000-0000-4000-8000-000000000001';

  if not public.extraordinary_authorization_is_ready(
    '41400000-0000-4000-8000-000000000001'
  ) then
    raise exception
      '040 fixture not ready: missing=%, budget=%',
      public.payment_request_layout_missing_fields(v_request),
      public.approval_batch_budget_validation(v_request.id);
  end if;
end
$fixture_ready$;

insert into public.payment_layout_lines(
  id,
  layout_id,
  payment_request_id,
  company_id,
  proveedor_id,
  company_bank_account_id,
  source_account_number,
  company_name,
  destination_type,
  destination_value,
  beneficiary_name,
  amount,
  payment_reference,
  payment_concept,
  request_number,
  status
) values (
  '41300000-0000-4000-8000-000000000001',
  '41200000-0000-4000-8000-000000000001',
  '41100000-0000-4000-8000-000000000001',
  '02000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  '41900000-0000-4000-8000-000000000001',
  '414000000000000001',
  'Shadow QA Company',
  'cuenta',
  '414000000000000001',
  'Shadow 040 Atomic',
  4101,
  '41001',
  'Shadow 040 atomic request 1',
  'SHADOW-040-01',
  'included'
);

do $successful_consumption$
begin
  if not exists (
    select 1
    from public.payment_request_extraordinary_authorizations authorization_row
    where authorization_row.id =
      '41400000-0000-4000-8000-000000000001'
      and authorization_row.status =
        'consumed_pending_ratification'
      and authorization_row.consumed_at is not null
      and authorization_row.consumed_layout_id =
        '41200000-0000-4000-8000-000000000001'
      and authorization_row.consumed_layout_line_id =
        '41300000-0000-4000-8000-000000000001'
  )
  or (
    select count(*)
    from public.payment_request_extraordinary_events
    where authorization_id =
      '41400000-0000-4000-8000-000000000001'
      and event_type = 'authorization_consumed'
  ) <> 1 then
    raise exception '040 successful consumption contract failed';
  end if;

  raise notice 'SHADOW_040_CONSUMPTION_PASS';
end
$successful_consumption$;

insert into public.payment_layout_lines(
  id,
  layout_id,
  payment_request_id,
  company_id,
  proveedor_id,
  company_bank_account_id,
  source_account_number,
  company_name,
  destination_type,
  destination_value,
  beneficiary_name,
  amount,
  payment_reference,
  payment_concept,
  request_number,
  status
) values (
  '41300000-0000-4000-8000-000000000002',
  '41200000-0000-4000-8000-000000000002',
  '41100000-0000-4000-8000-000000000002',
  '02000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  '41900000-0000-4000-8000-000000000001',
  '414000000000000001',
  'Shadow QA Company',
  'cuenta',
  '414000000000000001',
  'Shadow 040 Atomic',
  4102,
  '41002',
  'Shadow 040 atomic request 2',
  'SHADOW-040-02',
  'included'
);

do $regular_and_replay$
begin
  if not exists (
    select 1
    from public.payment_layout_lines
    where id = '41300000-0000-4000-8000-000000000002'
  ) then
    raise exception '040 regular line was blocked';
  end if;

  begin
    insert into public.payment_layout_lines(
      id,
      layout_id,
      payment_request_id,
      company_id,
      company_name,
      destination_type,
      destination_value,
      beneficiary_name,
      amount,
      request_number,
      status
    ) values (
      '41300000-0000-4000-8000-000000000007',
      '41200000-0000-4000-8000-000000000007',
      '41100000-0000-4000-8000-000000000001',
      '02000000-0000-4000-8000-000000000001',
      'Shadow QA Company',
      'cuenta',
      '414000000000000001',
      'Shadow 040 Atomic',
      4101,
      'SHADOW-040-01',
      'included'
    );
    raise exception '040 replay unexpectedly inserted a second line';
  exception
    when others then
      if sqlerrm = '040 replay unexpectedly inserted a second line' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.payment_layout_lines
    where id = '41300000-0000-4000-8000-000000000007'
  )
  or (
    select count(*)
    from public.payment_request_extraordinary_events
    where authorization_id =
      '41400000-0000-4000-8000-000000000001'
      and event_type = 'authorization_consumed'
  ) <> 1 then
    raise exception '040 replay changed lineage or ledger';
  end if;
end
$regular_and_replay$;

create function pg_temp.fail_040_consumption_event()
returns trigger
language plpgsql
as $$
begin
  if new.authorization_id =
       '41400000-0000-4000-8000-000000000003'
     and new.event_type = 'authorization_consumed' then
    raise exception 'shadow_040_forced_event_failure';
  end if;
  return new;
end
$$;

create trigger shadow_040_fail_consumption_event
before insert on public.payment_request_extraordinary_events
for each row execute function pg_temp.fail_040_consumption_event();

do $event_failure$
begin
  begin
    insert into public.payment_layout_lines(
      id,
      layout_id,
      payment_request_id,
      company_id,
      proveedor_id,
      company_bank_account_id,
      source_account_number,
      company_name,
      destination_type,
      destination_value,
      beneficiary_name,
      amount,
      payment_reference,
      payment_concept,
      request_number,
      status
    ) values (
      '41300000-0000-4000-8000-000000000003',
      '41200000-0000-4000-8000-000000000003',
      '41100000-0000-4000-8000-000000000003',
      '02000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000001',
      '41900000-0000-4000-8000-000000000001',
      '414000000000000001',
      'Shadow QA Company',
      'cuenta',
      '414000000000000001',
      'Shadow 040 Atomic',
      4103,
      '41003',
      'Shadow 040 atomic request 3',
      'SHADOW-040-03',
      'included'
    );
    raise exception '040 forced-event insert unexpectedly succeeded';
  exception
    when others then
      if sqlerrm = '040 forced-event insert unexpectedly succeeded' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.payment_layout_lines
    where id = '41300000-0000-4000-8000-000000000003'
  )
  or (
    select status
    from public.payment_request_extraordinary_authorizations
    where id = '41400000-0000-4000-8000-000000000003'
  ) is distinct from 'active' then
    raise exception '040 event failure did not roll back atomically';
  end if;
end
$event_failure$;

drop trigger shadow_040_fail_consumption_event
  on public.payment_request_extraordinary_events;

update public.payment_requests
set concept = concept || ' materially changed'
where id = '41100000-0000-4000-8000-000000000004';

do $material_change$
begin
  if (
    select status
    from public.payment_request_extraordinary_authorizations
    where id = '41400000-0000-4000-8000-000000000004'
  ) is distinct from 'expired'
  or (
    select count(*)
    from public.payment_request_extraordinary_events
    where authorization_id =
      '41400000-0000-4000-8000-000000000004'
      and event_type = 'material_change_invalidated'
  ) <> 1 then
    raise exception '040 indirect material invalidation failed';
  end if;

  raise notice 'SHADOW_040_MATERIAL_INVALIDATION_PASS';
end
$material_change$;

select set_config(
  'request.jwt.claim.sub',
  '01000000-0000-4000-8000-000000000001',
  true
);

select public.complete_payment_request_layout_data(
  '41100000-0000-4000-8000-000000000005',
  null,
  '41999',
  null,
  null
);

do $operational_change$
begin
  if (
    select status
    from public.payment_request_extraordinary_authorizations
    where id = '41400000-0000-4000-8000-000000000005'
  ) is distinct from 'active'
  or exists (
    select 1
    from public.payment_request_extraordinary_events
    where authorization_id =
      '41400000-0000-4000-8000-000000000005'
      and event_type = 'material_change_invalidated'
  ) then
    raise exception '040 operational change invalidated authorization';
  end if;
end
$operational_change$;

set local session_replication_role = replica;

insert into public.payment_layout_lines(
  id,
  layout_id,
  payment_request_id,
  company_id,
  company_name,
  destination_type,
  destination_value,
  beneficiary_name,
  amount,
  request_number,
  status
) values (
  '41300000-0000-4000-8000-000000000006',
  '41200000-0000-4000-8000-000000000006',
  '41100000-0000-4000-8000-000000000006',
  '02000000-0000-4000-8000-000000000001',
  'Shadow QA Company',
  'cuenta',
  '414000000000000001',
  'Shadow 040 Atomic',
  4106,
  'SHADOW-040-06',
  'included'
);

set local session_replication_role = origin;

do $other_execution$
begin
  begin
    insert into public.payment_layout_lines(
      id,
      layout_id,
      payment_request_id,
      company_id,
      company_name,
      destination_type,
      destination_value,
      beneficiary_name,
      amount,
      request_number,
      status
    ) values (
      '41300000-0000-4000-8000-000000000008',
      '41200000-0000-4000-8000-000000000007',
      '41100000-0000-4000-8000-000000000006',
      '02000000-0000-4000-8000-000000000001',
      'Shadow QA Company',
      'cuenta',
      '414000000000000001',
      'Shadow 040 Atomic',
      4106,
      'SHADOW-040-06',
      'included'
    );
    raise exception '040 second execution unexpectedly succeeded';
  exception
    when others then
      if sqlerrm = '040 second execution unexpectedly succeeded' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.payment_layout_lines
    where id = '41300000-0000-4000-8000-000000000008'
  )
  or (
    select status
    from public.payment_request_extraordinary_authorizations
    where id = '41400000-0000-4000-8000-000000000006'
  ) is distinct from 'active' then
    raise exception '040 other-execution rollback failed';
  end if;
end
$other_execution$;

do $guards_before_ratification$
begin
  begin
    insert into public.payment_receipts(
      id,
      payment_request_id,
      layout_id,
      payment_date,
      amount
    ) values (
      '41500000-0000-4000-8000-000000000001',
      '41100000-0000-4000-8000-000000000001',
      '41200000-0000-4000-8000-000000000001',
      current_date,
      4101
    );
    raise exception '040 receipt guard unexpectedly allowed insert';
  exception
    when others then
      if sqlerrm = '040 receipt guard unexpectedly allowed insert' then
        raise;
      end if;
  end;

  begin
    update public.payment_layout_lines
    set status = 'paid'
    where id = '41300000-0000-4000-8000-000000000001';
    raise exception '040 line-paid guard unexpectedly allowed update';
  exception
    when others then
      if sqlerrm = '040 line-paid guard unexpectedly allowed update' then
        raise;
      end if;
  end;

  begin
    update public.payment_requests
    set status = 'paid'
    where id = '41100000-0000-4000-8000-000000000001';
    raise exception '040 request-paid guard unexpectedly allowed update';
  exception
    when others then
      if sqlerrm = '040 request-paid guard unexpectedly allowed update' then
        raise;
      end if;
  end;
end
$guards_before_ratification$;

select set_config('app.extraordinary_internal', 'on', true);

update public.payment_request_extraordinary_authorizations
set status = 'ratified',
    ratified_by = '03000000-0000-4000-8000-000000000002',
    ratified_at = clock_timestamp(),
    ratification_note = 'Shadow 040 guard ratification'
where id = '41400000-0000-4000-8000-000000000001';

update public.payment_layout_lines
set status = 'paid'
where id = '41300000-0000-4000-8000-000000000001';

update public.payment_requests
set status = 'paid'
where id = '41100000-0000-4000-8000-000000000001';

insert into public.payment_receipts(
  id,
  payment_request_id,
  layout_id,
  payment_date,
  amount
) values (
  '41500000-0000-4000-8000-000000000001',
  '41100000-0000-4000-8000-000000000001',
  '41200000-0000-4000-8000-000000000001',
  current_date,
  4101
);

do $guards_after_ratification$
begin
  if not exists (
    select 1
    from public.payment_receipts
    where id = '41500000-0000-4000-8000-000000000001'
  )
  or (
    select status
    from public.payment_requests
    where id = '41100000-0000-4000-8000-000000000001'
  )::text is distinct from 'paid'
  or (
    select status
    from public.payment_layout_lines
    where id = '41300000-0000-4000-8000-000000000001'
  ) is distinct from 'paid' then
    raise exception '040 ratified guard path did not open in shadow';
  end if;

  raise notice 'SHADOW_040_GUARDS_PASS';
end
$guards_after_ratification$;

rollback;
