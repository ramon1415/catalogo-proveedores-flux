\set ON_ERROR_STOP on

do $concurrency$
declare
  v_line public.payment_layout_lines%rowtype;
begin
  if (
    select count(*)
    from public.payment_layout_lines
    where payment_request_id =
      '42100000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception '040 concurrency produced a non-single line';
  end if;

  select * into strict v_line
  from public.payment_layout_lines
  where payment_request_id =
    '42100000-0000-4000-8000-000000000001';

  if not exists (
    select 1
    from public.payment_request_extraordinary_authorizations authorization_row
    where authorization_row.id =
      '42400000-0000-4000-8000-000000000001'
      and authorization_row.status =
        'consumed_pending_ratification'
      and authorization_row.consumed_layout_id = v_line.layout_id
      and authorization_row.consumed_layout_line_id = v_line.id
  )
  or (
    select count(*)
    from public.payment_request_extraordinary_events
    where authorization_id =
      '42400000-0000-4000-8000-000000000001'
      and event_type = 'authorization_consumed'
  ) <> 1 then
    raise exception '040 concurrency lineage or event is not single';
  end if;

  raise notice 'SHADOW_040_CONCURRENCY_PASS';
end
$concurrency$;

begin;
set local session_replication_role = replica;
delete from public.notification_events
where source_table =
    'payment_request_extraordinary_authorizations'
  and source_id = '42400000-0000-4000-8000-000000000001';
delete from public.payment_request_extraordinary_events
where authorization_id =
  '42400000-0000-4000-8000-000000000001';
delete from public.payment_request_extraordinary_authorizations
where id = '42400000-0000-4000-8000-000000000001';
delete from public.payment_layout_lines
where payment_request_id =
  '42100000-0000-4000-8000-000000000001';
delete from public.payment_layouts
where id in (
  '42200000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000002'
);
delete from public.payment_requests
where id = '42100000-0000-4000-8000-000000000001';
delete from public.extraordinary_payment_policies
where company_id = '02000000-0000-4000-8000-000000000001';
delete from public.company_bank_accounts
where id = '42900000-0000-4000-8000-000000000001';
delete from public.proveedores
where id = '42000000-0000-4000-8000-000000000001';
commit;
