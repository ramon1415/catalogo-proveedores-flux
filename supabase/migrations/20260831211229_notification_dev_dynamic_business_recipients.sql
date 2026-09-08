-- Keep DEV in test_only globally while allowing three payment workflow events
-- to reach their real business recipient. The Edge Function must prove every
-- recipient against current request ownership, company membership and (for a
-- new request) the selected active Director before calling the mail provider.

create or replace function public.notification_dev_business_recipient_authorized(
  p_event_id uuid,
  p_recipient_email text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.notification_events event
    join public.profiles recipient
      on recipient.id = event.recipient_profile_id
     and recipient.active is true
     and lower(btrim(recipient.email)) = lower(btrim(event.recipient_email))
    where event.id = p_event_id
      and event.status = 'processing'
      and event.audience = 'internal'
      and lower(btrim(event.recipient_email)) = lower(btrim(p_recipient_email))
      and (
        (
          event.event_type = 'payment_request.created'
          and event.source_table = 'payment_requests'
          and exists (
            select 1
            from public.payment_requests request
            join public.profile_company_memberships membership
              on membership.profile_id = request.approver_id
             and membership.company_id = request.company_id
             and membership.active is true
            join public.company_directors company_director
              on company_director.director_profile_id = request.approver_id
             and company_director.company_id = request.company_id
             and company_director.active is true
            join public.user_roles user_role
              on user_role.profile_id = request.approver_id
            join public.roles role
              on role.id = user_role.role_id
             and lower(btrim(role.name)) in ('director', 'direccion')
            where request.id = event.source_id
              and event.recipient_profile_id = request.approver_id
          )
        )
        or
        (
          event.event_type = 'payment_request.approved'
          and event.source_table = 'payment_requests'
          and exists (
            select 1
            from public.payment_requests request
            join public.profile_company_memberships membership
              on membership.profile_id = request.requested_by
             and membership.company_id = request.company_id
             and membership.active is true
            where request.id = event.source_id
              and event.recipient_profile_id = request.requested_by
          )
        )
        or
        (
          event.event_type = 'payment_receipt.linked'
          and event.source_table = 'payment_request_receipt_links'
          and exists (
            select 1
            from public.payment_request_receipt_links receipt_link
            join public.payment_requests request
              on request.id = receipt_link.payment_request_id
             and request.company_id = receipt_link.company_id
            join public.profile_company_memberships membership
              on membership.profile_id = request.requested_by
             and membership.company_id = request.company_id
             and membership.active is true
            where receipt_link.id = event.source_id
              and event.recipient_profile_id = request.requested_by
          )
        )
      )
  );
$$;

revoke all on function public.notification_dev_business_recipient_authorized(uuid, text)
  from public, anon, authenticated;
grant execute on function public.notification_dev_business_recipient_authorized(uuid, text)
  to service_role;

comment on function public.notification_dev_business_recipient_authorized(uuid, text) is
  'DEV-only, service-role recipient authorization for selected Directors and request owners while the dispatcher remains globally test_only.';

do $$
declare
  v_public_execute boolean;
  v_anon_execute boolean;
  v_authenticated_execute boolean;
  v_service_execute boolean;
begin
  select has_function_privilege(
      'public',
      'public.notification_dev_business_recipient_authorized(uuid,text)',
      'execute'
    ),
    has_function_privilege(
      'anon',
      'public.notification_dev_business_recipient_authorized(uuid,text)',
      'execute'
    ),
    has_function_privilege(
      'authenticated',
      'public.notification_dev_business_recipient_authorized(uuid,text)',
      'execute'
    ),
    has_function_privilege(
      'service_role',
      'public.notification_dev_business_recipient_authorized(uuid,text)',
      'execute'
    )
  into
    v_public_execute,
    v_anon_execute,
    v_authenticated_execute,
    v_service_execute;

  if v_public_execute or v_anon_execute or v_authenticated_execute
     or not v_service_execute then
    raise exception 'notification_dev_business_recipient_acl_invalid';
  end if;
end;
$$;
