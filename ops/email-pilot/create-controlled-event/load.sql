-- Flux Operadora - DEV email pilot controlled event load
-- Creates at most one idempotent pending event for EMAIL PILOT.

begin;

do $$
declare
  v_request_id uuid;
  v_idempotency_key text;
  v_unsafe_count bigint;
  v_other_pilot_pending_count bigint;
begin
  select pr.id
    into v_request_id
  from public.payment_requests pr
  where pr.id is not null
    and nullif(btrim(coalesce(pr.request_number, '')), '') is not null
    and pr.requested_by is not null
  order by pr.created_at desc, pr.id desc
  limit 1;

  if v_request_id is null then
    raise exception 'No usable payment_requests row was found for the DEV email pilot controlled event.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.profile_id = p.id
    join public.roles r on r.id = ur.role_id
    where lower(r.name) in ('admin', 'sysadmin')
      and coalesce(p.active, true) = true
      and nullif(btrim(coalesce(p.email, '')), '') is not null
  ) then
    raise exception 'No admin or sysadmin profile with email was found for the DEV email pilot controlled event.';
  end if;

  with allowed_events(event_type) as (
    values
      ('payment_request.created'),
      ('payment_request.approved'),
      ('payment_request.rejected'),
      ('payment_request.changes_requested'),
      ('payment_request.exception_approved'),
      ('payment_request.exception_rejected')
  )
  select count(*)
    into v_unsafe_count
  from public.notification_events ne
  where ne.status::text = 'pending'
    and (
      ne.event_type is null
      or not exists (select 1 from allowed_events ae where ae.event_type = ne.event_type::text)
      or nullif(btrim(coalesce(ne.recipient_email, '')), '') is null
      or coalesce(ne.channel::text, '') <> 'email'
      or coalesce(ne.idempotency_key, '') like 'dev-test:%'
    );

  if v_unsafe_count > 0 then
    raise exception 'Unsafe pending notification_events found. Review precheck before creating the DEV email pilot controlled event. Count: %', v_unsafe_count;
  end if;

  v_idempotency_key := 'phase3-dev:email-pilot:payment_request.created:' || v_request_id::text || ':manual-v1';

  select count(*)
    into v_other_pilot_pending_count
  from public.notification_events ne
  where ne.status::text = 'pending'
    and coalesce(ne.idempotency_key, '') like 'phase3-dev:email-pilot:%'
    and ne.idempotency_key <> v_idempotency_key;

  if v_other_pilot_pending_count > 0 then
    raise exception 'Another pending phase3 email pilot event already exists. Count: %', v_other_pilot_pending_count;
  end if;
end $$;

with candidate_request as (
  select
    pr.id,
    pr.request_number,
    pr.requested_by,
    pr.amount_requested,
    pr.currency,
    pr.company_id,
    pr.cost_center_id,
    pr.budget_category_id,
    pr.budget_month,
    pr.provider_id,
    pr.proveedor_id,
    requester.full_name as requester_name,
    company.name as company_name,
    cost_center.name as cost_center_name,
    budget_category.name as budget_category_name,
    provider.display_name as provider_display_name,
    proveedor.alias as proveedor_alias,
    proveedor.nombre_completo as proveedor_name
  from public.payment_requests pr
  left join public.profiles requester on requester.id = pr.requested_by
  left join public.companies company on company.id = pr.company_id
  left join public.cost_centers cost_center on cost_center.id = pr.cost_center_id
  left join public.budget_categories budget_category on budget_category.id = pr.budget_category_id
  left join public.providers provider on provider.id = pr.provider_id
  left join public.proveedores proveedor on proveedor.id = pr.proveedor_id
  where pr.id is not null
    and nullif(btrim(coalesce(pr.request_number, '')), '') is not null
    and pr.requested_by is not null
  order by pr.created_at desc, pr.id desc
  limit 1
), candidate_admin as (
  select
    p.id,
    p.email,
    r.name as role_name
  from public.profiles p
  join public.user_roles ur on ur.profile_id = p.id
  join public.roles r on r.id = ur.role_id
  where lower(r.name) in ('admin', 'sysadmin')
    and coalesce(p.active, true) = true
    and nullif(btrim(coalesce(p.email, '')), '') is not null
  order by case lower(r.name) when 'admin' then 0 else 1 end, p.created_at desc, p.id
  limit 1
)
insert into public.notification_events (
  event_type,
  source_table,
  source_id,
  source_folio,
  recipient_type,
  recipient_profile_id,
  recipient_email,
  recipient_role,
  channel,
  priority,
  subject,
  payload,
  idempotency_key,
  status,
  locked_at,
  locked_by,
  processed_at
)
select
  'payment_request.created',
  'payment_requests',
  cr.id,
  cr.request_number,
  'administrador_sistema',
  ca.id,
  ca.email,
  ca.role_name,
  'email',
  'normal',
  'Flux DEV EMAIL PILOT - Nueva solicitud ' || cr.request_number,
  jsonb_build_object(
    'request_id', cr.id::text,
    'folio', cr.request_number,
    'solicitante', coalesce(nullif(btrim(cr.requester_name), ''), 'N/D'),
    'proveedor', coalesce(nullif(btrim(cr.provider_display_name), ''), nullif(btrim(cr.proveedor_alias), ''), nullif(btrim(cr.proveedor_name), ''), 'N/D'),
    'monto', coalesce(cr.amount_requested::text, 'N/D'),
    'moneda', coalesce(nullif(btrim(cr.currency), ''), 'MXN'),
    'empresa', coalesce(nullif(btrim(cr.company_name), ''), 'N/D'),
    'centro_costo', coalesce(nullif(btrim(cr.cost_center_name), ''), 'N/D'),
    'partida', coalesce(nullif(btrim(cr.budget_category_name), ''), 'N/D'),
    'mes', case when cr.budget_month is null then null else to_char(cr.budget_month, 'YYYY-MM') end,
    'link_solicitud', 'https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app/solicitudes.html?request=' || cr.id::text,
    'fase', 'phase3-dev',
    'email_pilot', true
  ),
  'phase3-dev:email-pilot:payment_request.created:' || cr.id::text || ':manual-v1',
  'pending',
  null,
  null,
  null
from candidate_request cr
cross join candidate_admin ca
on conflict (idempotency_key) do nothing;

select
  'PHASE3_EMAIL_PILOT_EVENT_LOAD_COMPLETE'::text as result,
  count(*) as pending_controlled_events
from public.notification_events
where status::text = 'pending'
  and idempotency_key like 'phase3-dev:email-pilot:%';

commit;
