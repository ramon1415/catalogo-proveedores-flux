-- A service-configured, expiring test run can redirect payroll QA without
-- changing the shared project's test recipient. Expiration stops all claims
-- for the scoped company; it never falls back to normal delivery.
begin;
set local lock_timeout='5s';
alter table public.payroll_notification_settings
  add column test_capture_session_id uuid references public.payroll_capture_sessions(id),
  add column test_recipient_profile_id uuid references public.profiles(id),
  add column test_expires_at timestamptz,
  add constraint payroll_notification_test_scope_complete check (
    (test_capture_session_id is null and test_recipient_profile_id is null and test_expires_at is null)
    or (test_capture_session_id is not null and test_recipient_profile_id is not null and test_expires_at is not null));

create or replace function public.claim_payroll_notifications(p_worker_id text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PAYROLL_NOTIFICATION_SERVICE_REQUIRED'; end if;
  if nullif(btrim(p_worker_id),'') is null or length(p_worker_id)>120 then raise exception 'PAYROLL_NOTIFICATION_WORKER_REQUIRED'; end if;
  -- A lost response can be retried with the same provider idempotency key within
  -- its retention window. Older ambiguous attempts need review, never a blind resend.
  update public.notification_events set status='dead_letter',last_error='PAYROLL_DELIVERY_RESULT_UNKNOWN',locked_by=null,locked_at=null
    where event_type in ('payroll.registered','payroll.paid') and status in ('processing','failed')
      and coalesce((payload->>'dispatch_first_attempt_at')::timestamptz,last_attempt_at)<now()-interval '23 hours';
  with candidate as (
    select e.id from public.notification_events e
    join public.payment_requests r on r.id=e.source_id
    join public.payroll_notification_settings cfg on cfg.company_id=r.company_id and cfg.dispatch_enabled
    where e.event_type in ('payroll.registered','payroll.paid')
      and (e.status in ('pending','failed') or (e.status='processing' and e.locked_at<now()-interval '10 minutes'))
      and coalesce(e.next_attempt_at,now())<=now() and e.attempt_count<e.max_attempts
      and e.recipient_email is not null
      and (cfg.test_capture_session_id is null or (cfg.test_expires_at>now() and exists(
        select 1 from public.payroll_capture_sessions qa where qa.id=cfg.test_capture_session_id
          and qa.company_id=r.company_id and qa.materialized_payment_request_id=r.id)))
    order by e.created_at,e.id for update of e skip locked limit 5
  ), claimed as (
    update public.notification_events e set status='processing',locked_at=now(),locked_by=p_worker_id,last_attempt_at=now(),updated_at=now(),
      payload=jsonb_set(e.payload,'{dispatch_first_attempt_at}',coalesce(e.payload->'dispatch_first_attempt_at',to_jsonb(now())))
      from candidate c where c.id=e.id returning e.id
  ) select coalesce(jsonb_agg(id),'[]'::jsonb) into result from claimed;
  return result;
end;
$$;
revoke all on function public.claim_payroll_notifications(text) from public,anon,authenticated;
grant execute on function public.claim_payroll_notifications(text) to service_role;

create or replace function public.get_payroll_notification_document(p_event_id uuid,p_worker_id text)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare e public.notification_events%rowtype; r public.payment_requests%rowtype;
  s public.payroll_capture_sessions%rowtype; cfg public.payroll_notification_settings%rowtype;
  channels jsonb; attachments jsonb; recipient_ok boolean; test_email text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PAYROLL_NOTIFICATION_SERVICE_REQUIRED'; end if;
  select * into e from public.notification_events where id=p_event_id and status='processing' and locked_by=p_worker_id
    and event_type in ('payroll.registered','payroll.paid') and source_table='payment_requests';
  if not found then raise exception 'PAYROLL_NOTIFICATION_CLAIM_REQUIRED'; end if;
  select * into r from public.payment_requests where id=e.source_id and request_type::text='nomina';
  select * into s from public.payroll_capture_sessions where materialized_payment_request_id=r.id and capture_state='materialized' order by materialized_at limit 1;
  select * into cfg from public.payroll_notification_settings where company_id=r.company_id and dispatch_enabled;
  if not found or s.id is null then raise exception 'PAYROLL_NOTIFICATION_SCOPE_REQUIRED'; end if;
  if cfg.test_capture_session_id is not null then
    if cfg.test_capture_session_id<>s.id or cfg.test_expires_at<=now() then raise exception 'PAYROLL_NOTIFICATION_TEST_SCOPE_REQUIRED'; end if;
    select lower(btrim(p.email)) into test_email from public.profiles p where p.id=cfg.test_recipient_profile_id and p.active
      and private.payroll_profile_can_capture(p.id,r.company_id);
    if not coalesce(test_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$',false)
      then raise exception 'PAYROLL_NOTIFICATION_TEST_RECIPIENT_REQUIRED'; end if;
  end if;
  recipient_ok:=case when e.event_type='payroll.registered'
    then e.recipient_profile_id=cfg.finance_recipient_profile_id and private.profile_has_company_role(e.recipient_profile_id,r.company_id,array['finance'])
    else e.recipient_profile_id=s.created_by and private.payroll_profile_can_capture(e.recipient_profile_id,r.company_id) end;
  if not coalesce(recipient_ok,false) or not exists(select 1 from public.profiles p where p.id=e.recipient_profile_id
    and p.active and lower(btrim(p.email))=e.recipient_email) then raise exception 'PAYROLL_NOTIFICATION_RECIPIENT_CHANGED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('channel',c.channel,'amount',c.amount) order by c.channel),'[]'::jsonb)
    into channels from public.payroll_channels c where c.payment_request_id=r.id;
  attachments:='[]'::jsonb;
  if e.event_type='payroll.paid' then
    if r.status::text<>'paid' then raise exception 'PAYROLL_NOTIFICATION_PAID_REQUIRED'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('channel',c.channel,'file_id',f.id,'bucket',f.storage_bucket,
      'path',f.storage_path,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'sha256',f.sha256) order by c.channel),'[]'::jsonb)
      into attachments from public.payroll_channels c join public.payroll_run_files f on f.id=c.receipt_file_id
      and f.payment_request_id=c.payment_request_id and f.payroll_channel_id=c.id
      where c.payment_request_id=r.id and c.dispersion_status='dispersed' and c.reconciliation_status='reconciled'
        and f.kind='comprobante' and f.parsing_status='parsed' and f.parsing_version='payroll-channel-receipt-v1';
    if jsonb_array_length(attachments)=0 or jsonb_array_length(attachments)<>jsonb_array_length(channels)
      then raise exception 'PAYROLL_NOTIFICATION_EVIDENCE_REQUIRED'; end if;
  end if;
  return jsonb_build_object('event_id',e.id,'event_type',e.event_type,'request_id',r.id,'folio',r.request_number,
    'recipient_email',e.recipient_email,'test_recipient_email',test_email,'company',(select name from public.companies where id=r.company_id),
    'period_start',s.period_start,'period_end',s.period_end,'amount',r.amount_requested,'currency',r.currency,
    'channels',channels,'attachments',attachments,'url',cfg.app_origin||'/nomina?capture='||s.id);
end;
$$;
revoke all on function public.get_payroll_notification_document(uuid,text) from public,anon,authenticated;
grant execute on function public.get_payroll_notification_document(uuid,text) to service_role;
commit;
