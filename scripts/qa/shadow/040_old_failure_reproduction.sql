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
  '40000000-0000-4000-8000-000000000001',
  'SHADOW-040-OLD',
  'Shadow 040 Old Defect',
  'Transferencia bancaria',
  'Cuenta',
  '404000000000000001',
  'Shadow Bank',
  true,
  'cuenta',
  'Shadow 040 Old Defect'
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
  '40900000-0000-4000-8000-000000000001',
  'Shadow 040 old source',
  'Shadow Bank',
  'MXN',
  'bank',
  true,
  '02000000-0000-4000-8000-000000000001',
  '404000000000000001'
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
) values (
  '40100000-0000-4000-8000-000000000001',
  '03000000-0000-4000-8000-000000000001',
  4040,
  'MXN',
  1,
  'approved',
  'Shadow 040 vulnerable consumer',
  '02000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000002',
  '40900000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date,
  'aprobable',
  'SHADOW-040-OLD-01',
  'Shadow 040 vulnerable consumer',
  'transfer',
  '40401',
  'Shadow 040 vulnerable consumer',
  current_date + 1,
  clock_timestamp() - interval '1 hour'
);

insert into public.payment_layouts(
  id,
  layout_number,
  name,
  period_start,
  period_end,
  status,
  generated_by
) values (
  '40200000-0000-4000-8000-000000000001',
  'SHADOW-040-OLD-LAYOUT',
  'Shadow 040 old defect layout',
  current_date,
  current_date,
  'draft',
  '03000000-0000-4000-8000-000000000001'
);

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
) values (
  '40300000-0000-4000-8000-000000000001',
  '40100000-0000-4000-8000-000000000001',
  'operational_emergency',
  'Shadow 040 old defect authorization reason',
  'active',
  '03000000-0000-4000-8000-000000000001',
  clock_timestamp(),
  '02000000-0000-4000-8000-000000000001',
  '03000000-0000-4000-8000-000000000002',
  'signed_document',
  'extraordinary-approval-evidence',
  '40300000-0000-4000-8000-000000000001/evidence/fixture',
  repeat('4', 64),
  'application/pdf',
  1024,
  clock_timestamp(),
  '03000000-0000-4000-8000-000000000001',
  clock_timestamp(),
  clock_timestamp() - interval '10 minutes',
  clock_timestamp() + interval '12 hours',
  clock_timestamp() + interval '36 hours',
  'shadow-040-old-defect'
);

do $ready$
begin
  if not public.extraordinary_authorization_is_ready(
    '40300000-0000-4000-8000-000000000001'
  ) then
    raise exception '040 old-defect fixture is not ready';
  end if;
end
$ready$;

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
  '40400000-0000-4000-8000-000000000001',
  '40200000-0000-4000-8000-000000000001',
  '40100000-0000-4000-8000-000000000001',
  '02000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '40900000-0000-4000-8000-000000000001',
  '404000000000000001',
  'Shadow QA Company',
  'cuenta',
  '404000000000000001',
  'Shadow 040 Old Defect',
  4040,
  '40401',
  'Shadow 040 vulnerable consumer',
  'SHADOW-040-OLD-01',
  'included'
);

do $assert_old_failure$
begin
  if (
    select status
    from public.payment_request_extraordinary_authorizations
    where id = '40300000-0000-4000-8000-000000000001'
  ) is distinct from 'active'
  or not exists (
    select 1
    from public.payment_layout_lines
    where id = '40400000-0000-4000-8000-000000000001'
  )
  or exists (
    select 1
    from public.payment_request_extraordinary_events
    where authorization_id =
      '40300000-0000-4000-8000-000000000001'
      and event_type = 'authorization_consumed'
  ) then
    raise exception '040 old consumer defect was not reproduced';
  end if;

  raise notice 'SHADOW_040_OLD_CONSUMPTION_DEFECT_REPRODUCED';
end
$assert_old_failure$;

rollback;
