\set ON_ERROR_STOP on

do $migration_postcheck$
declare
  v_distribution jsonb;
  v_status_definition text;
begin
  select jsonb_object_agg(status, row_count)
  into v_distribution
  from (
    select status, count(*) as row_count
    from public.payment_request_extraordinary_authorizations
    group by status
  ) status_rows;

  if v_distribution is distinct from
      '{"legacy_consumed_unverified": 7, "legacy_quarantined": 1, "revoked": 1}'::jsonb then
    raise exception 'shadow 037 legacy distribution mismatch: %', v_distribution;
  end if;

  select pg_get_constraintdef(constraint_info.oid, true)
  into v_status_definition
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.conname =
      'payment_request_extraordinary_status_check';

  if (
    select count(*)
    from pg_constraint constraint_info
    where constraint_info.conrelid =
        'public.payment_request_extraordinary_authorizations'::regclass
      and constraint_info.conname like '%status_check'
  ) <> 1
  or v_status_definition is distinct from
    'CHECK (status = ANY (ARRAY[''draft''::text, ''active''::text, ''consumed_pending_ratification''::text, ''ratified''::text, ''revoked''::text, ''expired''::text, ''disputed''::text, ''legacy_consumed_unverified''::text, ''legacy_quarantined''::text]))' then
    raise exception 'shadow 037 canonical status constraint mismatch: %',
      v_status_definition;
  end if;

  if exists (
    select 1
    from public.extraordinary_payment_policies
    where enabled
  ) then
    raise exception 'shadow 037 policy was enabled by default';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'extraordinary-approval-evidence'
      and not public
      and file_size_limit = 5242880
  ) then
    raise exception 'shadow 037 private evidence bucket mismatch';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.authorize_payment_request_extraordinary(uuid,text,text)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.begin_extraordinary_authorization(uuid,text,text,uuid,timestamp with time zone,text)',
       'execute'
     ) then
    raise exception 'shadow 037 RPC grants mismatch';
  end if;

  if (select count(*) from public.payment_receipts) <> 0
     or (select count(*) from public.notification_events) <> 0 then
    raise exception 'shadow 037 migration created receipts or notifications';
  end if;

  if (
    select status
    from public.payment_allocation_plans
    where id = 'e0000000-0000-4000-8000-000000000001'
  ) is distinct from 'reserved'
  or (
    select status
    from public.payment_allocation_reservations
    where id = '11000000-0000-4000-8000-000000000001'
  ) is distinct from 'active'
  or (
    select status
    from public.bank_payment_operations
    where id = 'c0000000-0000-4000-8000-000000000001'
  ) is distinct from 'reserved'
  or (select count(*) from public.payment_allocation_movements) <> 0 then
    raise exception 'shadow 037 ALLOC-001 changed';
  end if;
end
$migration_postcheck$;

begin;
set local session_replication_role = replica;

insert into public.user_roles(profile_id, role_id)
select
  '03000000-0000-4000-8000-000000000001'::uuid,
  role.id
from public.roles role
where role.name = 'sysadmin'
  and not exists (
    select 1
    from public.user_roles user_role
    where user_role.profile_id =
        '03000000-0000-4000-8000-000000000001'::uuid
      and user_role.role_id = role.id
  );

insert into public.payment_requests(
  id,
  requested_by,
  amount_requested,
  currency,
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
    '12000000-0000-4000-8000-' ||
    lpad(seed_index::text, 12, '0')
  )::uuid,
  '03000000-0000-4000-8000-000000000001',
  1500 + seed_index,
  'MXN',
  'approved',
  'Synthetic secure extraordinary request ' || seed_index,
  '02000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date,
  'aprobable',
  'SHADOW-SECURE-' || lpad(seed_index::text, 2, '0'),
  'Synthetic secure lifecycle fixture',
  'transfer',
  now() - interval '1 hour'
from generate_series(1, 10) seed(seed_index);

insert into public.payment_layouts(
  id,
  layout_number,
  name,
  period_start,
  period_end,
  status,
  generated_by
) values (
  '15000000-0000-4000-8000-000000000001',
  'SHADOW-LAYOUT-001',
  'Shadow secure lifecycle layout',
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
  evidence_storage_bucket,
  evidence_storage_path,
  external_authorized_at,
  valid_until,
  ratification_due_at,
  idempotency_key
) values (
  '17000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'operational_emergency',
  'Synthetic secure draft with sufficient reason',
  'draft',
  '03000000-0000-4000-8000-000000000001',
  now(),
  '02000000-0000-4000-8000-000000000001',
  '03000000-0000-4000-8000-000000000002',
  'extraordinary-approval-evidence',
  '17000000-0000-4000-8000-000000000001/evidence/fixture.pdf',
  now() - interval '10 minutes',
  now() + interval '12 hours',
  now() + interval '36 hours',
  'shadow-draft-0001'
);

select set_config('app.extraordinary_internal', 'on', true);

update public.payment_request_extraordinary_authorizations
set status = 'active',
    evidence_type = 'signed_document',
    evidence_sha256 = repeat('a', 64),
    evidence_mime_type = 'application/pdf',
    evidence_size_bytes = 1024,
    evidence_verified_at = now(),
    evidence_match_attested_by =
      '03000000-0000-4000-8000-000000000001',
    evidence_match_attested_at = now()
where id = '17000000-0000-4000-8000-000000000001';

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
) values
  (
    '16000000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    '02000000-0000-4000-8000-000000000001',
    'Shadow QA Company',
    'cuenta',
    'SHADOW-DESTINATION',
    'Shadow Beneficiary',
    1501,
    'SHADOW-SECURE-01',
    'included'
  ),
  (
    '16000000-0000-4000-8000-000000000002',
    '15000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000002',
    '02000000-0000-4000-8000-000000000001',
    'Shadow QA Company',
    'cuenta',
    'SHADOW-DESTINATION',
    'Shadow Beneficiary',
    1502,
    'SHADOW-SECURE-02',
    'included'
  );

set local session_replication_role = origin;

update public.payment_request_extraordinary_authorizations
set status = 'consumed_pending_ratification',
    consumed_at = now(),
    consumed_layout_id = '15000000-0000-4000-8000-000000000001',
    consumed_layout_line_id = '16000000-0000-4000-8000-000000000001'
where id = '17000000-0000-4000-8000-000000000001';

update public.payment_request_extraordinary_authorizations
set status = 'ratified',
    ratified_by = '03000000-0000-4000-8000-000000000002',
    ratified_at = now(),
    ratification_note = 'Synthetic shadow ratification'
where id = '17000000-0000-4000-8000-000000000001';

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
  idempotency_key,
  consumed_at,
  consumed_layout_id,
  consumed_layout_line_id,
  disputed_by,
  disputed_at,
  dispute_reason
) values (
  '17000000-0000-4000-8000-000000000002',
  '12000000-0000-4000-8000-000000000002',
  'operational_emergency',
  'Synthetic disputed authorization reason',
  'disputed',
  '03000000-0000-4000-8000-000000000001',
  now(),
  '02000000-0000-4000-8000-000000000001',
  '03000000-0000-4000-8000-000000000002',
  'signed_document',
  'extraordinary-approval-evidence',
  '17000000-0000-4000-8000-000000000002/evidence/fixture.pdf',
  repeat('b', 64),
  'application/pdf',
  1024,
  now(),
  '03000000-0000-4000-8000-000000000001',
  now(),
  now() - interval '10 minutes',
  now() + interval '12 hours',
  now() + interval '36 hours',
  'shadow-disputed-0002',
  now(),
  '15000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000002',
  '03000000-0000-4000-8000-000000000002',
  now(),
  'Synthetic dispute reason'
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
  revoke_reason,
  company_id
) values (
  '17000000-0000-4000-8000-000000000003',
  '12000000-0000-4000-8000-000000000003',
  'operational_emergency',
  'Synthetic revoked authorization reason',
  'revoked',
  '03000000-0000-4000-8000-000000000001',
  now(),
  '03000000-0000-4000-8000-000000000001',
  now(),
  'Synthetic revocation reason',
  '02000000-0000-4000-8000-000000000001'
);

do $negative_tests$
begin
  begin
    insert into public.payment_request_extraordinary_authorizations(
      payment_request_id,
      category,
      reason,
      status,
      authorized_by,
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
      '12000000-0000-4000-8000-000000000010',
      'operational_emergency',
      'Unknown status must be rejected',
      'unknown_status',
      '03000000-0000-4000-8000-000000000001',
      '02000000-0000-4000-8000-000000000001',
      '03000000-0000-4000-8000-000000000002',
      'signed_document',
      'extraordinary-approval-evidence',
      'negative/unknown.pdf',
      repeat('c', 64),
      'application/pdf',
      1024,
      now(),
      '03000000-0000-4000-8000-000000000001',
      now(),
      now() - interval '10 minutes',
      now() + interval '12 hours',
      now() + interval '36 hours',
      'negative-unknown'
    );
    raise exception 'unknown status was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.payment_request_extraordinary_authorizations(
      payment_request_id,
      category,
      reason,
      status,
      authorized_by,
      company_id
    ) values (
      '12000000-0000-4000-8000-000000000010',
      'operational_emergency',
      'Legacy classification must be complete',
      'legacy_consumed_unverified',
      '03000000-0000-4000-8000-000000000001',
      '02000000-0000-4000-8000-000000000001'
    );
    raise exception 'incomplete legacy classification was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.payment_request_extraordinary_authorizations(
      payment_request_id,
      category,
      reason,
      status,
      authorized_by,
      company_id
    ) values (
      '12000000-0000-4000-8000-000000000010',
      'operational_emergency',
      'Revoked fields must be complete',
      'revoked',
      '03000000-0000-4000-8000-000000000001',
      '02000000-0000-4000-8000-000000000001'
    );
    raise exception 'incomplete revoked row was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.payment_request_extraordinary_authorizations(
      payment_request_id,
      category,
      reason,
      status,
      authorized_by,
      revoked_by,
      revoked_at,
      revoke_reason,
      company_id,
      external_director_profile_id,
      evidence_storage_bucket,
      evidence_storage_path,
      external_authorized_at,
      valid_until,
      ratification_due_at,
      idempotency_key
    ) values (
      '12000000-0000-4000-8000-000000000010',
      'operational_emergency',
      'Non revoked rows cannot carry revoke fields',
      'draft',
      '03000000-0000-4000-8000-000000000001',
      '03000000-0000-4000-8000-000000000001',
      now(),
      'Invalid populated revoke fields',
      '02000000-0000-4000-8000-000000000001',
      '03000000-0000-4000-8000-000000000002',
      'extraordinary-approval-evidence',
      'negative/non-revoked.pdf',
      now() - interval '10 minutes',
      now() + interval '12 hours',
      now() + interval '36 hours',
      'negative-revoke-fields'
    );
    raise exception 'non-revoked row with revoke fields was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.payment_request_extraordinary_authorizations(
      payment_request_id,
      category,
      reason,
      status,
      authorized_by,
      company_id,
      external_director_profile_id,
      evidence_storage_bucket,
      evidence_storage_path,
      external_authorized_at,
      valid_until,
      ratification_due_at,
      idempotency_key
    ) values (
      '12000000-0000-4000-8000-000000000010',
      'operational_emergency',
      'Active rows require complete evidence',
      'active',
      '03000000-0000-4000-8000-000000000001',
      '02000000-0000-4000-8000-000000000001',
      '03000000-0000-4000-8000-000000000002',
      'extraordinary-approval-evidence',
      'negative/active-no-evidence.pdf',
      now() - interval '10 minutes',
      now() + interval '12 hours',
      now() + interval '36 hours',
      'negative-no-evidence'
    );
    raise exception 'active row without evidence was accepted';
  exception when check_violation then
    null;
  end;

  begin
    alter table public.payment_request_extraordinary_authorizations
      add constraint shadow_duplicate_status_check
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

    if (
      select count(*)
      from pg_constraint constraint_info
      where constraint_info.conrelid =
          'public.payment_request_extraordinary_authorizations'::regclass
        and constraint_info.conname like '%status_check'
    ) <> 1 then
      raise sqlstate 'P7001'
        using message = 'duplicate_status_contract_detected';
    end if;
    raise exception 'duplicate status check was not detected';
  exception when sqlstate 'P7001' then
    null;
  end;

  if exists (
    select 1
    from pg_constraint constraint_info
    where constraint_info.conrelid =
        'public.payment_request_extraordinary_authorizations'::regclass
      and constraint_info.conname = 'shadow_duplicate_status_check'
  ) then
    raise exception 'duplicate status test did not roll back';
  end if;
end
$negative_tests$;

commit;

do $final_assertions$
begin
  if (
    select count(*)
    from pg_constraint constraint_info
    where constraint_info.conrelid =
        'public.payment_request_extraordinary_authorizations'::regclass
      and constraint_info.conname like '%status_check'
  ) <> 1 then
    raise exception 'shadow 037 final status check count mismatch';
  end if;

  if not exists (
    select 1
    from public.payment_request_extraordinary_authorizations
    where id = '17000000-0000-4000-8000-000000000001'
      and status = 'ratified'
  )
  or not exists (
    select 1
    from public.payment_request_extraordinary_authorizations
    where id = '17000000-0000-4000-8000-000000000002'
      and status = 'disputed'
  )
  or not exists (
    select 1
    from public.payment_request_extraordinary_authorizations
    where id = '17000000-0000-4000-8000-000000000003'
      and status = 'revoked'
  ) then
    raise exception 'shadow 037 positive lifecycle states mismatch';
  end if;

  if (
    select count(*)
    from public.payment_request_extraordinary_authorizations
    where status = 'legacy_consumed_unverified'
      and evidence_storage_path is null
  ) <> 7 then
    raise exception 'shadow 037 legacy rows were forced into new evidence';
  end if;

  if (select count(*) from public.payment_receipts) <> 0
     or (select count(*) from public.notification_events) <> 0
     or (select count(*) from public.payment_allocation_movements) <> 0 then
    raise exception 'shadow 037 tests created forbidden financial side effects';
  end if;

  if exists (
    select 1
    from public.extraordinary_payment_policies policy
    join public.companies company on company.id = policy.company_id
    where policy.enabled
      and lower(company.name) like '%operadora%'
  ) then
    raise exception 'shadow Operadora policy was enabled';
  end if;
end
$final_assertions$;

select 'SHADOW_037_PASS' as result;
