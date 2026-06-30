-- Flux Operadora - DEV email pilot controlled event precheck
-- Read-only checks for the controlled pending event package.

select
  'DEV'::text as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co'::text as expected_supabase_host,
  current_database() as database_name,
  now() as checked_at;

with required_tables(table_name) as (
  values
    ('notification_events'),
    ('notification_delivery_attempts'),
    ('payment_requests'),
    ('profiles'),
    ('roles'),
    ('user_roles')
)
select
  rt.table_name,
  exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public'
      and t.table_name = rt.table_name
  ) as exists_in_public
from required_tables rt
order by rt.table_name;

with required_columns(column_name) as (
  values
    ('event_type'),
    ('source_table'),
    ('source_id'),
    ('source_folio'),
    ('recipient_type'),
    ('recipient_profile_id'),
    ('recipient_email'),
    ('recipient_role'),
    ('channel'),
    ('priority'),
    ('subject'),
    ('payload'),
    ('idempotency_key'),
    ('status'),
    ('locked_at'),
    ('locked_by'),
    ('processed_at')
)
select
  rc.column_name,
  exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'notification_events'
      and c.column_name = rc.column_name
  ) as exists_in_notification_events
from required_columns rc
order by rc.column_name;

select
  count(*) as current_pending_events
from public.notification_events
where status::text = 'pending';

with allowed_events(event_type) as (
  values
    ('payment_request.created'),
    ('payment_request.approved'),
    ('payment_request.rejected'),
    ('payment_request.changes_requested'),
    ('payment_request.exception_approved'),
    ('payment_request.exception_rejected')
), unsafe_pending as (
  select
    ne.id,
    ne.event_type::text as event_type,
    ne.source_folio,
    ne.recipient_email,
    ne.channel::text as channel,
    ne.idempotency_key,
    array_remove(array[
      case when ne.event_type is null or not exists (
        select 1 from allowed_events ae where ae.event_type = ne.event_type::text
      ) then 'event_type_not_allowed' end,
      case when nullif(btrim(coalesce(ne.recipient_email, '')), '') is null then 'recipient_email_missing' end,
      case when coalesce(ne.channel::text, '') <> 'email' then 'channel_not_email' end,
      case when coalesce(ne.idempotency_key, '') like 'dev-test:%' then 'dev_test_idempotency_key' end
    ], null) as reasons
  from public.notification_events ne
  where ne.status::text = 'pending'
    and (
      ne.event_type is null
      or not exists (select 1 from allowed_events ae where ae.event_type = ne.event_type::text)
      or nullif(btrim(coalesce(ne.recipient_email, '')), '') is null
      or coalesce(ne.channel::text, '') <> 'email'
      or coalesce(ne.idempotency_key, '') like 'dev-test:%'
    )
)
select
  count(*) as unsafe_pending_events
from unsafe_pending;

with allowed_events(event_type) as (
  values
    ('payment_request.created'),
    ('payment_request.approved'),
    ('payment_request.rejected'),
    ('payment_request.changes_requested'),
    ('payment_request.exception_approved'),
    ('payment_request.exception_rejected')
), unsafe_pending as (
  select
    ne.id,
    ne.event_type::text as event_type,
    ne.source_folio,
    ne.recipient_email,
    ne.channel::text as channel,
    ne.idempotency_key,
    array_remove(array[
      case when ne.event_type is null or not exists (
        select 1 from allowed_events ae where ae.event_type = ne.event_type::text
      ) then 'event_type_not_allowed' end,
      case when nullif(btrim(coalesce(ne.recipient_email, '')), '') is null then 'recipient_email_missing' end,
      case when coalesce(ne.channel::text, '') <> 'email' then 'channel_not_email' end,
      case when coalesce(ne.idempotency_key, '') like 'dev-test:%' then 'dev_test_idempotency_key' end
    ], null) as reasons
  from public.notification_events ne
  where ne.status::text = 'pending'
    and (
      ne.event_type is null
      or not exists (select 1 from allowed_events ae where ae.event_type = ne.event_type::text)
      or nullif(btrim(coalesce(ne.recipient_email, '')), '') is null
      or coalesce(ne.channel::text, '') <> 'email'
      or coalesce(ne.idempotency_key, '') like 'dev-test:%'
    )
)
select *
from unsafe_pending
order by source_folio nulls last, id
limit 25;

select
  count(*) as usable_payment_requests
from public.payment_requests pr
where pr.id is not null
  and nullif(btrim(coalesce(pr.request_number, '')), '') is not null
  and pr.requested_by is not null;

select
  pr.id,
  pr.request_number,
  pr.requested_by,
  pr.amount_requested,
  pr.currency,
  pr.created_at
from public.payment_requests pr
where pr.id is not null
  and nullif(btrim(coalesce(pr.request_number, '')), '') is not null
  and pr.requested_by is not null
order by pr.created_at desc, pr.id desc
limit 1;

select
  count(*) as admin_profiles_with_email
from public.profiles p
join public.user_roles ur on ur.profile_id = p.id
join public.roles r on r.id = ur.role_id
where lower(r.name) in ('admin', 'sysadmin')
  and coalesce(p.active, true) = true
  and nullif(btrim(coalesce(p.email, '')), '') is not null;

select
  p.id as profile_id,
  p.email,
  r.name as role_name
from public.profiles p
join public.user_roles ur on ur.profile_id = p.id
join public.roles r on r.id = ur.role_id
where lower(r.name) in ('admin', 'sysadmin')
  and coalesce(p.active, true) = true
  and nullif(btrim(coalesce(p.email, '')), '') is not null
order by case lower(r.name) when 'admin' then 0 else 1 end, p.created_at desc, p.id
limit 1;
