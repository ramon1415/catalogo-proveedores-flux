begin;
alter table public.payroll_obligation_settings add column app_origin text check(app_origin ~ '^https://[a-zA-Z0-9.-]+$');
create or replace function public.get_payroll_obligation_notification_document(p_event_id uuid,p_worker_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.notification_events%rowtype; o public.payroll_obligations%rowtype; cfg public.payroll_notification_settings%rowtype;
 s public.payroll_obligation_settings%rowtype; test_email text; begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'OBLIGATION_SERVICE_REQUIRED'; end if;
 select * into e from public.notification_events where id=p_event_id and locked_by=p_worker_id and status='processing'
 and source_table='payroll_obligations' and event_type in('payroll.obligation.registered','payroll.obligation.paid');
 if not found then raise exception 'OBLIGATION_NOTIFICATION_CLAIM_REQUIRED'; end if;
 select * into o from public.payroll_obligations where id=e.source_id and status<>'cancelled';
 select * into s from public.payroll_obligation_settings where company_id=o.company_id and kind=o.kind and enabled and dispatch_enabled;
 if not found then raise exception 'OBLIGATION_NOTIFICATION_SCOPE_REQUIRED'; end if;
 select * into cfg from public.payroll_notification_settings where company_id=o.company_id;
 if not found then raise exception 'OBLIGATION_NOTIFICATION_CONFIGURATION_REQUIRED'; end if;
 cfg.app_origin:=coalesce(s.app_origin,cfg.app_origin);
 if cfg.app_origin is null or cfg.app_origin !~ '^https://[a-zA-Z0-9.-]+$' then raise exception 'OBLIGATION_NOTIFICATION_CONFIGURATION_REQUIRED'; end if;
 if e.event_type='payroll.obligation.paid' then
  if o.status<>'paid' or e.recipient_profile_id<>o.created_by or not private.payroll_obligation_permission(e.recipient_profile_id,o.company_id,'capture')
  or not exists(select 1 from public.payroll_obligation_files where obligation_id=o.id and kind='receipt' and active and status='verified') then raise exception 'OBLIGATION_NOTIFICATION_PAID_REQUIRED'; end if;
 elsif e.recipient_profile_id is distinct from cfg.finance_recipient_profile_id or not private.payroll_obligation_permission(e.recipient_profile_id,o.company_id,'pay')
 then raise exception 'OBLIGATION_NOTIFICATION_RECIPIENT_CHANGED'; end if;
 if not exists(select 1 from public.profiles where id=e.recipient_profile_id and active and lower(btrim(email))=e.recipient_email) then raise exception 'OBLIGATION_NOTIFICATION_RECIPIENT_CHANGED'; end if;
 if s.test_recipient_profile_id is not null then
  select lower(btrim(email)) into test_email from public.profiles where id=s.test_recipient_profile_id and active;
  if test_email is null then raise exception 'OBLIGATION_NOTIFICATION_TEST_RECIPIENT_REQUIRED'; end if;
 end if;
 return jsonb_build_object('event_id',e.id,'event_type',e.event_type,'id',o.id,'kind',o.kind,'folio',e.source_folio,
 'recipient_email',e.recipient_email,'test_recipient_email',test_email,'company',(select name from public.companies where id=o.company_id),
 'period_start',o.period_start,'period_end',o.period_end,'amount_minor',o.amount_minor,'url',cfg.app_origin||'/nomina?obligation='||o.id);
end; $$;
commit;
