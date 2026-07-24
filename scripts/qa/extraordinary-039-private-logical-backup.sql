\set ON_ERROR_STOP on

set session characteristics as transaction read only;
begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

\pset format unaligned
\pset tuples_only on

select jsonb_build_object(
  'backup_kind', 'EXTRAORDINARY_039_PRIVATE_LOGICAL_BACKUP',
  'helper', jsonb_build_object(
    'definition',
      pg_get_functiondef(
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
      ),
    'definition_md5',
      md5(pg_get_functiondef(
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
      )),
    'definition_sha256',
      encode(sha256(convert_to(pg_get_functiondef(
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
      ), 'UTF8')), 'hex'),
    'acl', (
      select coalesce(function_info.proacl::text, '<default>')
      from pg_proc function_info
      where function_info.oid =
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
    ),
    'owner', (
      select pg_get_userbyid(function_info.proowner)
      from pg_proc function_info
      where function_info.oid =
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
    )
  ),
  'policies', (
    select jsonb_agg(
      jsonb_build_object(
        'name', policy.policyname,
        'command', policy.cmd,
        'roles', policy.roles,
        'qual', policy.qual,
        'with_check', policy.with_check
      )
      order by policy.policyname
    )
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname in (
        'extraordinary_evidence_insert',
        'extraordinary_evidence_select'
      )
  ),
  'bucket', (
    select jsonb_build_object(
      'id', bucket.id,
      'name', bucket.name,
      'public', bucket.public,
      'file_size_limit', bucket.file_size_limit,
      'allowed_mime_types', bucket.allowed_mime_types,
      'object_count', (
        select count(*)
        from storage.objects object
        where object.bucket_id = bucket.id
      )
    )
    from storage.buckets bucket
    where bucket.id = 'extraordinary-approval-evidence'
  ),
  'authorization_status_counts', (
    select jsonb_object_agg(status_rows.status, status_rows.row_count)
    from (
      select authorization.status, count(*) as row_count
      from public.payment_request_extraordinary_authorizations authorization
      group by authorization.status
      order by authorization.status
    ) status_rows
  ),
  'business_counts', jsonb_build_object(
    'payment_requests', (
      select count(*) from public.payment_requests
    ),
    'payment_layouts', (
      select count(*) from public.payment_layouts
    ),
    'payment_layout_lines', (
      select count(*) from public.payment_layout_lines
    ),
    'payment_receipts', (
      select count(*) from public.payment_receipts
    ),
    'paid_requests', (
      select count(*) from public.payment_requests
      where status::text = 'paid'
    ),
    'notification_events', (
      select count(*) from public.notification_events
    ),
    'financial_outbox_events', (
      select count(*) from public.financial_outbox_events
    ),
    'financial_outbox_delivery_attempts', (
      select count(*)
      from public.financial_outbox_delivery_attempts
    )
  ),
  'allocation_integrity', jsonb_build_object(
    'plans_hash', md5(coalesce((
      select string_agg(to_jsonb(plan)::text, '' order by plan.id)
      from public.payment_allocation_plans plan
    ), '')),
    'reservations_hash', md5(coalesce((
      select string_agg(
        to_jsonb(reservation)::text,
        ''
        order by reservation.id
      )
      from public.payment_allocation_reservations reservation
    ), '')),
    'operations_hash', md5(coalesce((
      select string_agg(to_jsonb(operation)::text, '' order by operation.id)
      from public.bank_payment_operations operation
    ), ''))
  ),
  'extraordinary_policy_counts', jsonb_build_object(
    'enabled', (
      select count(*)
      from public.extraordinary_payment_policies
      where enabled
    ),
    'operadora_enabled', (
      select count(*)
      from public.extraordinary_payment_policies policy
      join public.companies company on company.id = policy.company_id
      where policy.enabled
        and lower(coalesce(company.name, '')) like '%operadora%'
    )
  ),
  'transaction_read_only',
    current_setting('transaction_read_only')
);

rollback;
