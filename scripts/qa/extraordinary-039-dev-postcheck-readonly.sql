\set ON_ERROR_STOP on

set session characteristics as transaction read only;
begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $postcheck$
declare
  v_function_oid oid :=
    'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure;
  v_function_definition text := pg_get_functiondef(v_function_oid);
begin
  if current_setting('transaction_read_only') <> 'on' then
    raise exception '039_remote_postcheck: transaction is not read only';
  end if;

  if not has_function_privilege(
       'authenticated',
       v_function_oid,
       'EXECUTE'
     )
     or has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or has_function_privilege('public', v_function_oid, 'EXECUTE') then
    raise exception '039_remote_postcheck: helper ACL is invalid';
  end if;

  if md5(v_function_definition) <>
       '4cf587cd26796af6bb9f75c36002757a'
     or encode(
       sha256(convert_to(v_function_definition, 'UTF8')),
       'hex'
     ) <> '978d2cdac722a202389e151250c5b972a0e1bec43a74e0f5ae59fd1996174cdb' then
    raise exception '039_remote_postcheck: helper definition changed';
  end if;

  if (
    select count(*)
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and (
        (
          policy.policyname = 'extraordinary_evidence_insert'
          and policy.cmd = 'INSERT'
          and position(
            'extraordinary_evidence_storage_allowed(name, true)'
            in coalesce(policy.with_check, '')
          ) > 0
        )
        or (
          policy.policyname = 'extraordinary_evidence_select'
          and policy.cmd = 'SELECT'
          and position(
            'extraordinary_evidence_storage_allowed(name, false)'
            in coalesce(policy.qual, '')
          ) > 0
        )
      )
  ) <> 2 then
    raise exception '039_remote_postcheck: evidence policies changed';
  end if;

  if not exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'extraordinary-approval-evidence'
      and not bucket.public
      and bucket.file_size_limit = 5242880
      and cardinality(bucket.allowed_mime_types) = 4
  )
  or exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'extraordinary-approval-evidence'
  ) then
    raise exception '039_remote_postcheck: evidence bucket changed';
  end if;

  if exists (
    select 1
    from public.extraordinary_payment_policies policy
    join public.companies company on company.id = policy.company_id
    where policy.enabled
      and lower(coalesce(company.name, '')) like '%operadora%'
  ) then
    raise exception '039_remote_postcheck: Operadora policy is enabled';
  end if;
end
$postcheck$;

\pset format unaligned
\pset tuples_only on

select jsonb_build_object(
  'result', 'MIGRATION_039_POSTCHECK_PASS',
  'transaction_read_only',
    current_setting('transaction_read_only'),
  'authenticated_execute', true,
  'anon_execute', false,
  'public_execute', false,
  'helper_definition_md5', md5(pg_get_functiondef(
    'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
  )),
  'helper_definition_sha256', encode(sha256(convert_to(pg_get_functiondef(
    'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
  ), 'UTF8')), 'hex'),
  'policy_count', 2,
  'bucket_private', true,
  'bucket_object_count', (
    select count(*)
    from storage.objects
    where bucket_id = 'extraordinary-approval-evidence'
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
  )
);

rollback;
