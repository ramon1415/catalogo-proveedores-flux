\set ON_ERROR_STOP on

set session characteristics as transaction read only;
begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $postcheck$
declare
  v_consumer_source text;
  v_validator_source text;
  v_helper_source text;
  v_material_trigger text;
begin
  if current_setting('transaction_read_only') <> 'on' then
    raise exception '040_remote_postcheck: transaction is not read only';
  end if;

  select prosrc into strict v_consumer_source
  from pg_proc
  where oid =
    'public.extraordinary_consume_layout_line()'::regprocedure;
  select prosrc into strict v_validator_source
  from pg_proc
  where oid =
    'public.extraordinary_validate_layout_line()'::regprocedure;
  select prosrc into strict v_helper_source
  from pg_proc
  where oid =
    'public.extraordinary_authorization_can_consume_layout_line(uuid,uuid)'::regprocedure;

  if position(
       'extraordinary_authorization_is_ready'
       in lower(v_consumer_source)
     ) > 0
     or position(
       'extraordinary_authorization_can_consume_layout_line'
       in lower(v_consumer_source)
     ) = 0
     or position('v_updated <> 1' in lower(v_consumer_source)) = 0
     or position('authorization_consumed'
       in lower(v_consumer_source)) = 0 then
    raise exception '040_remote_postcheck: consumer contract drifted';
  end if;

  if position('for update' in lower(v_validator_source)) = 0
     or position(
       'secure_extraordinary_authorization_changed'
       in lower(v_validator_source)
     ) = 0
     or position('''revoked''' in lower(v_validator_source)) = 0 then
    raise exception
      '040_remote_postcheck: validator lock or closed-state guard drifted';
  end if;

  if lower(v_helper_source) ~
       '\m(insert|update|delete|truncate|merge|execute|format)\M'
     or position('other_line.id <> line.id'
       in lower(v_helper_source)) = 0
     or position('payment_receipts' in lower(v_helper_source)) = 0
     or position('payment_allocation_movements'
       in lower(v_helper_source)) = 0
     or position('payment_allocation_reservations'
       in lower(v_helper_source)) = 0 then
    raise exception '040_remote_postcheck: internal predicate drifted';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.extraordinary_authorization_can_consume_layout_line(uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.extraordinary_authorization_can_consume_layout_line(uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception '040_remote_postcheck: internal predicate ACL widened';
  end if;

  select pg_get_triggerdef(trigger_info.oid)
  into strict v_material_trigger
  from pg_trigger trigger_info
  where trigger_info.tgrelid = 'public.payment_requests'::regclass
    and trigger_info.tgname =
      'invalidate_extraordinary_on_material_change'
    and not trigger_info.tgisinternal
    and trigger_info.tgenabled = 'O';

  if v_material_trigger like '%UPDATE OF%'
     or v_material_trigger not like '%AFTER UPDATE ON%'
     or v_material_trigger not like
       '%old.approval_material_updated_at IS DISTINCT FROM new.approval_material_updated_at%' then
    raise exception
      '040_remote_postcheck: material trigger contract drifted';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.extraordinary_evidence_storage_allowed(text,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.extraordinary_evidence_storage_allowed(text,boolean)',
       'EXECUTE'
     )
     or (
       select count(*)
       from pg_policies policy
       where policy.schemaname = 'storage'
         and policy.tablename = 'objects'
         and lower(
           coalesce(policy.qual, '') ||
           coalesce(policy.with_check, '')
         ) like '%extraordinary-approval-evidence%'
     ) <> 2 then
    raise exception '040_remote_postcheck: Storage 039 contract changed';
  end if;
end
$postcheck$;

\pset format unaligned
\pset tuples_only on

select jsonb_build_object(
  'result', 'MIGRATION_040_POSTCHECK_PASS',
  'transaction_read_only', current_setting('transaction_read_only'),
  'consumer_body_sha256', (
    select encode(sha256(convert_to(prosrc, 'UTF8')), 'hex')
    from pg_proc
    where oid =
      'public.extraordinary_consume_layout_line()'::regprocedure
  ),
  'validator_body_sha256', (
    select encode(sha256(convert_to(prosrc, 'UTF8')), 'hex')
    from pg_proc
    where oid =
      'public.extraordinary_validate_layout_line()'::regprocedure
  ),
  'predicate_body_sha256', (
    select encode(sha256(convert_to(prosrc, 'UTF8')), 'hex')
    from pg_proc
    where oid =
      'public.extraordinary_authorization_can_consume_layout_line(uuid,uuid)'::regprocedure
  ),
  'material_trigger', (
    select pg_get_triggerdef(trigger_info.oid)
    from pg_trigger trigger_info
    where trigger_info.tgrelid = 'public.payment_requests'::regclass
      and trigger_info.tgname =
        'invalidate_extraordinary_on_material_change'
      and not trigger_info.tgisinternal
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
    'notification_events', (
      select count(*) from public.notification_events
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
  'dml', 0,
  'ddl', 0,
  'mutable_calls', 0
);

rollback;
