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
  '42000000-0000-4000-8000-000000000001',
  'SHADOW-040-CONCURRENT',
  'Shadow 040 Concurrent',
  'Transferencia bancaria',
  'Cuenta',
  '424000000000000001',
  'Shadow Bank',
  true,
  'cuenta',
  'Shadow 040 Concurrent'
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
  '42900000-0000-4000-8000-000000000001',
  'Shadow 040 concurrent source',
  'Shadow Bank',
  'MXN',
  'bank',
  true,
  '02000000-0000-4000-8000-000000000001',
  '424000000000000001'
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
  '42100000-0000-4000-8000-000000000001',
  '03000000-0000-4000-8000-000000000001',
  4201,
  'MXN',
  1,
  'approved',
  'Shadow 040 concurrent request',
  '02000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000002',
  '42900000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date,
  'aprobable',
  'SHADOW-040-CONCURRENT',
  'Shadow 040 concurrent request',
  'transfer',
  '42001',
  'Shadow 040 concurrent request',
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
) values
  (
    '42200000-0000-4000-8000-000000000001',
    'SHADOW-040-CONCURRENT-A',
    'Shadow 040 concurrent layout A',
    current_date,
    current_date,
    'draft',
    '03000000-0000-4000-8000-000000000001'
  ),
  (
    '42200000-0000-4000-8000-000000000002',
    'SHADOW-040-CONCURRENT-B',
    'Shadow 040 concurrent layout B',
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
  '42400000-0000-4000-8000-000000000001',
  '42100000-0000-4000-8000-000000000001',
  'operational_emergency',
  'Shadow 040 concurrent authorization reason',
  'active',
  '03000000-0000-4000-8000-000000000001',
  clock_timestamp(),
  '02000000-0000-4000-8000-000000000001',
  '03000000-0000-4000-8000-000000000002',
  'signed_document',
  'extraordinary-approval-evidence',
  '42400000-0000-4000-8000-000000000001/evidence/fixture',
  repeat('4', 64),
  'application/pdf',
  1024,
  clock_timestamp(),
  '03000000-0000-4000-8000-000000000001',
  clock_timestamp(),
  clock_timestamp() - interval '10 minutes',
  clock_timestamp() + interval '12 hours',
  clock_timestamp() + interval '36 hours',
  'shadow-040-concurrent'
);

commit;
