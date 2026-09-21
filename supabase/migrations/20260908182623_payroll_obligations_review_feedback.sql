-- Review the captured amount before submission; preserve Finance capabilities.
begin;
create function public.submit_reviewed_payroll_obligation(p_id uuid,p_version integer,p_reviewed_amount_minor bigint)
returns text language plpgsql security definer set search_path='' as $$
declare o public.payroll_obligations%rowtype; actor uuid; next_version integer; result text;
begin
 select * into o from public.payroll_obligations where id=p_id for update;
 if not found then raise exception 'OBLIGATION_NOT_FOUND'; end if;
 actor:=private.payroll_obligation_actor(o.company_id,'capture');
 if p_reviewed_amount_minor is null or p_reviewed_amount_minor is distinct from o.amount_minor then raise exception 'OBLIGATION_REVIEW_REQUIRED'; end if;
 if o.status in('submitted','approved','paid') then return o.status; end if;
 if o.status<>'draft' then raise exception 'OBLIGATION_DRAFT_REQUIRED'; end if;
 if o.version is distinct from p_version then raise exception 'OBLIGATION_STALE_VERSION'; end if;
 insert into public.payroll_obligation_audit(obligation_id,actor_id,action) values(o.id,actor,'reviewed_amounts_before_submission');
 result:=public.transition_payroll_obligation(o.id,o.version,'submit');
 -- One transaction: Finance capturers review before sending and do not see
 -- another confirmation afterwards. Capture-only profiles still need Finance.
 if private.payroll_obligation_permission(actor,o.company_id,'pay') then
  select version into next_version from public.payroll_obligations where id=o.id;
  result:=public.transition_payroll_obligation(o.id,next_version,'confirm');
 end if;
 return result;
end; $$;
revoke all on function public.submit_reviewed_payroll_obligation(uuid,integer,bigint) from public,anon,authenticated,service_role;
grant execute on function public.submit_reviewed_payroll_obligation(uuid,integer,bigint) to authenticated;

-- pg_net starts only after commit. Keep minute recovery for transient failures.
create function private.payroll_obligation_notification_wakeup()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.payroll_obligations o join public.payroll_obligation_settings s
 on s.company_id=o.company_id and s.kind=o.kind
 where o.id=new.source_id and s.enabled and s.dispatch_enabled) then
  perform private.wake_payroll_obligation_notifications();
 end if;
 return new;
end; $$;
revoke all on function private.payroll_obligation_notification_wakeup() from public,anon,authenticated,service_role;
create trigger payroll_obligation_dispatch_after_insert after insert on public.notification_events for each row
when(new.source_table='payroll_obligations' and new.event_type in('payroll.obligation.registered','payroll.obligation.paid') and new.status='pending')
execute function private.payroll_obligation_notification_wakeup();

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
 return jsonb_build_object('event_id',e.id,'event_type',e.event_type,'id',o.id,'kind',o.kind,'status',o.status,'folio',e.source_folio,
 'recipient_email',e.recipient_email,'test_recipient_email',test_email,'company',(select name from public.companies where id=o.company_id),
 'period_start',o.period_start,'period_end',o.period_end,'amount_minor',o.amount_minor,'url',cfg.app_origin||'/nomina?obligation='||o.id);
end; $$;
commit;
