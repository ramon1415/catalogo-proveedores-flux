\set ON_ERROR_STOP on

set session characteristics as transaction read only;
begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $backup_guard$
begin
  if current_setting('transaction_read_only') <> 'on' then
    raise exception '040_backup: transaction is not read only';
  end if;
end
$backup_guard$;

\pset format unaligned
\pset tuples_only on

select 'BACKUP_040_CLEAN_RUN_PASS';

with affected_functions as (
  select
    procedure_info.oid,
    procedure_info.oid::regprocedure::text as identity,
    role_info.rolname as owner,
    coalesce(procedure_info.proacl::text, '') as acl,
    pg_get_functiondef(procedure_info.oid) as definition,
    encode(
      sha256(convert_to(pg_get_functiondef(procedure_info.oid), 'UTF8')),
      'hex'
    ) as definition_sha256
  from pg_proc procedure_info
  join pg_namespace namespace_info
    on namespace_info.oid = procedure_info.pronamespace
  join pg_roles role_info
    on role_info.oid = procedure_info.proowner
  where namespace_info.nspname = 'public'
    and procedure_info.oid::regprocedure::text in (
      'extraordinary_authorization_can_consume_layout_line(uuid,uuid)',
      'extraordinary_consume_layout_line()',
      'extraordinary_invalidate_material_change()',
      'extraordinary_validate_layout_line()'
    )
),
affected_triggers as (
  select
    trigger_info.tgname as name,
    trigger_info.tgenabled as enabled,
    pg_get_triggerdef(trigger_info.oid) as definition,
    encode(
      sha256(convert_to(pg_get_triggerdef(trigger_info.oid), 'UTF8')),
      'hex'
    ) as definition_sha256
  from pg_trigger trigger_info
  where trigger_info.tgrelid in (
      'public.payment_layout_lines'::regclass,
      'public.payment_requests'::regclass
    )
    and trigger_info.tgname in (
      'consume_extraordinary_layout_line',
      'invalidate_extraordinary_on_material_change',
      'validate_extraordinary_layout_line'
    )
    and not trigger_info.tgisinternal
),
affected_constraints as (
  select
    namespace_info.nspname as schema_name,
    class_info.relname as table_name,
    constraint_info.conname as name,
    constraint_info.contype as type,
    pg_get_constraintdef(constraint_info.oid, true) as definition
  from pg_constraint constraint_info
  join pg_class class_info
    on class_info.oid = constraint_info.conrelid
  join pg_namespace namespace_info
    on namespace_info.oid = class_info.relnamespace
  where namespace_info.nspname = 'public'
    and class_info.relname in (
      'payment_layout_lines',
      'payment_request_extraordinary_authorizations',
      'payment_request_extraordinary_events',
      'payment_requests'
    )
),
affected_indexes as (
  select
    index_info.schemaname as schema_name,
    index_info.tablename as table_name,
    index_info.indexname as name,
    index_info.indexdef as definition,
    encode(
      sha256(convert_to(index_info.indexdef, 'UTF8')),
      'hex'
    ) as definition_sha256
  from pg_indexes index_info
  where index_info.schemaname = 'public'
    and index_info.tablename in (
      'payment_layout_lines',
      'payment_request_extraordinary_authorizations',
      'payment_request_extraordinary_events',
      'payment_requests'
    )
),
relevant_policies as (
  select
    policy_info.schemaname as schema_name,
    policy_info.tablename as table_name,
    policy_info.policyname as name,
    policy_info.permissive,
    policy_info.roles,
    policy_info.cmd,
    coalesce(policy_info.qual, '') as using_expression,
    coalesce(policy_info.with_check, '') as check_expression
  from pg_policies policy_info
  where (
      policy_info.schemaname = 'storage'
      and policy_info.tablename = 'objects'
      and lower(
        coalesce(policy_info.qual, '') ||
        coalesce(policy_info.with_check, '')
      ) like '%extraordinary-approval-evidence%'
    )
    or (
      policy_info.schemaname = 'public'
      and policy_info.tablename in (
        'extraordinary_payment_policies',
        'payment_request_extraordinary_authorizations',
        'payment_request_extraordinary_events'
      )
    )
),
authorization_statuses as (
  select
    extraordinary_auth.status::text as status,
    count(*) as count
  from public.payment_request_extraordinary_authorizations extraordinary_auth
  group by extraordinary_auth.status
),
business_counts as (
  select jsonb_build_object(
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
      select count(*)
      from public.payment_requests request
      where request.status::text = 'paid'
    ),
    'notification_events', (
      select count(*) from public.notification_events
    ),
    'financial_outbox_delivery_attempts', (
      select count(*) from public.financial_outbox_delivery_attempts
    )
  ) as value
),
allocation_integrity as (
  select jsonb_build_object(
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
      select string_agg(
        to_jsonb(operation)::text,
        ''
        order by operation.id
      )
      from public.bank_payment_operations operation
    ), ''))
  ) as value
)
select jsonb_build_object(
  'result', 'BACKUP_040_CLEAN_RUN_PASS',
  'backup_kind', 'EXTRAORDINARY_040_PRIVATE_LOGICAL_BACKUP_READONLY',
  'generated_at', clock_timestamp(),
  'commit', :'backup_commit',
  'project_ref', :'backup_project_ref',
  'migration_sha256', :'backup_migration_sha',
  'transaction_read_only', current_setting('transaction_read_only'),
  'functions', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'identity', function_info.identity,
        'owner', function_info.owner,
        'acl', function_info.acl,
        'definition', function_info.definition,
        'definition_sha256', function_info.definition_sha256
      )
      order by function_info.identity
    )
    from affected_functions function_info
  ), '[]'::jsonb),
  'triggers', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'name', trigger_info.name,
        'enabled', trigger_info.enabled,
        'definition', trigger_info.definition,
        'definition_sha256', trigger_info.definition_sha256
      )
      order by trigger_info.name
    )
    from affected_triggers trigger_info
  ), '[]'::jsonb),
  'constraints', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'schema', constraint_info.schema_name,
        'table', constraint_info.table_name,
        'name', constraint_info.name,
        'type', constraint_info.type,
        'definition', constraint_info.definition
      )
      order by
        constraint_info.schema_name,
        constraint_info.table_name,
        constraint_info.name
    )
    from affected_constraints constraint_info
  ), '[]'::jsonb),
  'indexes', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'schema', index_info.schema_name,
        'table', index_info.table_name,
        'name', index_info.name,
        'definition', index_info.definition,
        'definition_sha256', index_info.definition_sha256
      )
      order by
        index_info.schema_name,
        index_info.table_name,
        index_info.name
    )
    from affected_indexes index_info
  ), '[]'::jsonb),
  'authorization_statuses', coalesce((
    select jsonb_object_agg(
      status_info.status,
      status_info.count
      order by status_info.status
    )
    from authorization_statuses status_info
  ), '{}'::jsonb),
  'policies', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'schema', policy_info.schema_name,
        'table', policy_info.table_name,
        'name', policy_info.name,
        'permissive', policy_info.permissive,
        'roles', policy_info.roles,
        'command', policy_info.cmd,
        'using_expression', policy_info.using_expression,
        'check_expression', policy_info.check_expression
      )
      order by
        policy_info.schema_name,
        policy_info.table_name,
        policy_info.name
    )
    from relevant_policies policy_info
  ), '[]'::jsonb),
  'bucket', (
    select jsonb_build_object(
      'present', true,
      'public', bucket.public,
      'file_size_limit', bucket.file_size_limit,
      'allowed_mime_types', bucket.allowed_mime_types,
      'object_count', (
        select count(*)
        from storage.objects object_info
        where object_info.bucket_id = bucket.id
      )
    )
    from storage.buckets bucket
    where bucket.id = 'extraordinary-approval-evidence'
  ),
  'business_counts', (select value from business_counts),
  'allocation_integrity', (select value from allocation_integrity),
  'operadora_policy_enabled', exists (
    select 1
    from public.extraordinary_payment_policies policy
    join public.companies company on company.id = policy.company_id
    where policy.enabled
      and lower(coalesce(company.name, '')) like '%operadora%'
  )
);

rollback;
