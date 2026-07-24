\set ON_ERROR_STOP on

begin;
set local session_replication_role = replica;

insert into auth.users(id, email) values
  ('01000000-0000-4000-8000-000000000001', 'finance@example.invalid'),
  ('01000000-0000-4000-8000-000000000002', 'director@example.invalid'),
  ('01000000-0000-4000-8000-000000000003', 'other-director@example.invalid');

insert into public.companies(id, name, legal_name) values
  (
    '02000000-0000-4000-8000-000000000001',
    'Shadow QA Company',
    'Shadow QA Company'
  ),
  (
    '02000000-0000-4000-8000-000000000002',
    'Flux Operadora Shadow',
    'Flux Operadora Shadow'
  );

insert into public.profiles(
  id,
  auth_user_id,
  full_name,
  email
) values
  (
    '03000000-0000-4000-8000-000000000001',
    '01000000-0000-4000-8000-000000000001',
    'Shadow Finance',
    'finance@example.invalid'
  ),
  (
    '03000000-0000-4000-8000-000000000002',
    '01000000-0000-4000-8000-000000000002',
    'Shadow Director',
    'director@example.invalid'
  ),
  (
    '03000000-0000-4000-8000-000000000003',
    '01000000-0000-4000-8000-000000000003',
    'Shadow Wrong Director',
    'other-director@example.invalid'
  );

insert into public.user_roles(profile_id, role_id)
select
  '03000000-0000-4000-8000-000000000001'::uuid,
  role.id
from public.roles role
where role.name = 'finance';

insert into public.user_roles(profile_id, role_id)
select
  profile_id,
  role.id
from (
  values
    ('03000000-0000-4000-8000-000000000002'::uuid),
    ('03000000-0000-4000-8000-000000000003'::uuid)
) director(profile_id)
cross join public.roles role
where role.name = 'director';

insert into public.profile_company_memberships(
  profile_id,
  company_id,
  active
) values
  (
    '03000000-0000-4000-8000-000000000001',
    '02000000-0000-4000-8000-000000000001',
    true
  ),
  (
    '03000000-0000-4000-8000-000000000002',
    '02000000-0000-4000-8000-000000000001',
    true
  ),
  (
    '03000000-0000-4000-8000-000000000003',
    '02000000-0000-4000-8000-000000000002',
    true
  );

insert into public.company_directors(
  company_id,
  director_profile_id,
  active,
  created_by
) values
  (
    '02000000-0000-4000-8000-000000000001',
    '03000000-0000-4000-8000-000000000002',
    true,
    '03000000-0000-4000-8000-000000000001'
  ),
  (
    '02000000-0000-4000-8000-000000000002',
    '03000000-0000-4000-8000-000000000003',
    true,
    '03000000-0000-4000-8000-000000000001'
  );

do $seed$
declare
  v_index integer;
  v_request_id uuid;
  v_authorization_id uuid;
  v_evidence_id uuid;
  v_snapshot_id uuid;
  v_link_id uuid;
  v_operation_id uuid;
  v_batch_id uuid;
  v_document_id uuid;
  v_amount numeric;
begin
  for v_index in 1..9 loop
    v_request_id := (
      '10000000-0000-4000-8000-' ||
      lpad(v_index::text, 12, '0')
    )::uuid;
    v_authorization_id := (
      '20000000-0000-4000-8000-' ||
      lpad(v_index::text, 12, '0')
    )::uuid;
    v_evidence_id := (
      '30000000-0000-4000-8000-' ||
      lpad(v_index::text, 12, '0')
    )::uuid;
    v_snapshot_id := (
      '40000000-0000-4000-8000-' ||
      lpad(v_index::text, 12, '0')
    )::uuid;
    v_link_id := (
      '50000000-0000-4000-8000-' ||
      lpad(v_index::text, 12, '0')
    )::uuid;
    v_operation_id := (
      '60000000-0000-4000-8000-' ||
      lpad(v_index::text, 12, '0')
    )::uuid;
    v_batch_id := (
      '70000000-0000-4000-8000-' ||
      lpad(v_index::text, 12, '0')
    )::uuid;
    v_document_id := (
      '80000000-0000-4000-8000-' ||
      lpad(v_index::text, 12, '0')
    )::uuid;
    v_amount := 1000 + v_index;

    insert into public.payment_requests(
      id,
      requested_by,
      paid_by,
      amount_requested,
      currency,
      status,
      paid_at,
      concept,
      company_id,
      request_number,
      description,
      approval_material_updated_at
    ) values (
      v_request_id,
      '03000000-0000-4000-8000-000000000001',
      case when v_index <= 7
        then '03000000-0000-4000-8000-000000000001'::uuid
        else null
      end,
      v_amount,
      'MXN',
      (
        case when v_index <= 7 then 'paid' else 'approved' end
      )::public.payment_request_status,
      case when v_index <= 7 then now() else null end,
      'Synthetic extraordinary shadow request ' || v_index,
      '02000000-0000-4000-8000-000000000001',
      'SHADOW-LEGACY-' || lpad(v_index::text, 2, '0'),
      'Synthetic legacy authorization contract fixture',
      now() - interval '2 days'
    );

    insert into public.payment_request_extraordinary_authorizations(
      id,
      payment_request_id,
      category,
      reason,
      status,
      authorized_by,
      authorized_at,
      revoked_by,
      revoked_at,
      revoke_reason
    ) values (
      v_authorization_id,
      v_request_id,
      'operational_emergency',
      'Synthetic legacy reason with sufficient length',
      case when v_index = 9 then 'revoked' else 'active' end,
      '03000000-0000-4000-8000-000000000001',
      now() - interval '2 days',
      case when v_index = 9
        then '03000000-0000-4000-8000-000000000001'::uuid
        else null
      end,
      case when v_index = 9 then now() - interval '1 day' else null end,
      case when v_index = 9 then 'Synthetic revocation reason' else null end
    );

    if v_index <= 7 then
      insert into public.payment_operation_evidence(
        id,
        company_id,
        batch_id,
        operation_id,
        source_document_id,
        source_page_number,
        version,
        status,
        storage_bucket,
        storage_path,
        source_document_sha256,
        individual_sha256,
        mime_type,
        file_size_bytes,
        page_count,
        single_operation_attested,
        created_by,
        uploaded_by,
        uploaded_at,
        reviewed_by,
        reviewed_at,
        review_reason
      ) values (
        v_evidence_id,
        '02000000-0000-4000-8000-000000000001',
        v_batch_id,
        v_operation_id,
        v_document_id,
        1,
        1,
        'shareable',
        'payment-batch-documents',
        v_batch_id::text || '/' || v_operation_id::text ||
          '/evidence/' || v_evidence_id::text || '.pdf',
        lpad(to_hex(v_index), 64, 'a'),
        lpad(to_hex(v_index), 64, 'b'),
        'application/pdf',
        1024,
        1,
        true,
        '03000000-0000-4000-8000-000000000001',
        '03000000-0000-4000-8000-000000000001',
        now() - interval '1 day',
        '03000000-0000-4000-8000-000000000001',
        now() - interval '1 day',
        'Synthetic direct lineage evidence'
      );

      insert into public.payable_snapshots(
        id,
        payment_request_id,
        company_id,
        version,
        amount_minor,
        currency,
        source_type,
        source_id,
        source_status,
        source_approval_material_updated_at,
        authorized_by,
        authorized_at,
        materialized_by
      ) values (
        v_snapshot_id,
        v_request_id,
        '02000000-0000-4000-8000-000000000001',
        1,
        round(v_amount * 100)::bigint,
        'MXN',
        'extraordinary_authorization',
        v_authorization_id,
        'active',
        now() - interval '2 days',
        '03000000-0000-4000-8000-000000000001',
        now() - interval '2 days',
        '03000000-0000-4000-8000-000000000001'
      );

      insert into public.payment_request_receipt_links(
        id,
        company_id,
        operation_id,
        payment_request_id,
        snapshot_id,
        evidence_id,
        amount_minor,
        currency,
        payment_date,
        reference_hint,
        linked_by
      ) values (
        v_link_id,
        '02000000-0000-4000-8000-000000000001',
        v_operation_id,
        v_request_id,
        v_snapshot_id,
        v_evidence_id,
        round(v_amount * 100)::bigint,
        'MXN',
        current_date - 1,
        'LEGACY-' || v_index,
        '03000000-0000-4000-8000-000000000001'
      );
    end if;
  end loop;
end
$seed$;

insert into public.company_bank_accounts(
  id,
  name,
  bank_name,
  currency,
  company_id,
  account_number
) values (
  '90000000-0000-4000-8000-000000000001',
  'Shadow source account',
  'BBVA',
  'MXN',
  '02000000-0000-4000-8000-000000000001',
  'SHADOW-ACCOUNT'
);

insert into public.payment_requests(
  id,
  requested_by,
  amount_requested,
  currency,
  status,
  concept,
  company_id,
  request_number,
  description,
  approval_material_updated_at
) values (
  'a0000000-0000-4000-8000-000000000001',
  '03000000-0000-4000-8000-000000000001',
  2500,
  'MXN',
  'approved',
  'Synthetic unrelated ALLOC-001 request',
  '02000000-0000-4000-8000-000000000001',
  'ALLOC-001',
  'Unrelated direct lineage fixture',
  now() - interval '2 days'
);

insert into public.payable_snapshots(
  id,
  payment_request_id,
  company_id,
  version,
  amount_minor,
  currency,
  source_type,
  source_id,
  source_status,
  source_approval_material_updated_at,
  authorized_by,
  authorized_at,
  materialized_by
) values (
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  '02000000-0000-4000-8000-000000000001',
  1,
  250000,
  'MXN',
  'legacy_backfill',
  'a0000000-0000-4000-8000-000000000001',
  'approved',
  now() - interval '2 days',
  '03000000-0000-4000-8000-000000000001',
  now() - interval '2 days',
  '03000000-0000-4000-8000-000000000001'
);

insert into public.bank_payment_operations(
  id,
  company_id,
  source_company_bank_account_id,
  extraction_id,
  bank_name,
  fingerprint_version,
  operation_fingerprint,
  bank_unique_folio,
  application_date,
  amount_minor,
  currency,
  source_account_hash,
  source_account_last4,
  status,
  reviewed_by
) values (
  'c0000000-0000-4000-8000-000000000001',
  '02000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  'BBVA',
  1,
  repeat('c', 64),
  'ALLOC-0001',
  current_date,
  250000,
  'MXN',
  repeat('d', 64),
  '0001',
  'reserved',
  '03000000-0000-4000-8000-000000000001'
);

insert into public.payment_allocation_plans(
  id,
  company_id,
  operation_id,
  status,
  total_amount_minor,
  currency,
  proposed_by
) values (
  'e0000000-0000-4000-8000-000000000001',
  '02000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  'reserved',
  250000,
  'MXN',
  '03000000-0000-4000-8000-000000000001'
);

insert into public.payment_allocation_items(
  id,
  plan_id,
  operation_id,
  snapshot_id,
  amount_minor,
  currency,
  position,
  note
) values (
  'f0000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  250000,
  'MXN',
  1,
  'ALLOC-001 synthetic unrelated lineage'
);

insert into public.payment_allocation_reservations(
  id,
  company_id,
  plan_id,
  operation_id,
  amount_minor,
  currency,
  status,
  expires_at,
  created_by
) values (
  '11000000-0000-4000-8000-000000000001',
  '02000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  250000,
  'MXN',
  'active',
  now() + interval '1 day',
  '03000000-0000-4000-8000-000000000001'
);

set local session_replication_role = origin;
commit;

select
  count(*) filter (where status = 'active') as active,
  count(*) filter (where status = 'revoked') as revoked
from public.payment_request_extraordinary_authorizations;

select
  (select count(*) from public.payment_request_receipt_links) as receipt_links,
  (select count(*) from public.payment_allocation_movements) as movements,
  (select status from public.payment_allocation_plans
   where id = 'e0000000-0000-4000-8000-000000000001') as plan_status,
  (select status from public.payment_allocation_reservations
   where id = '11000000-0000-4000-8000-000000000001') as reservation_status,
  (select status from public.bank_payment_operations
   where id = 'c0000000-0000-4000-8000-000000000001') as operation_status;
