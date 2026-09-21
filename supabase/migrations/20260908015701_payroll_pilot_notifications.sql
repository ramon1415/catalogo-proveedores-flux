-- Two lifecycle messages per run, using the existing transactional outbox.
-- No historical backfill or automatic activation of real delivery.
begin;
set local lock_timeout='5s';

create table public.payroll_notification_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  finance_recipient_profile_id uuid references public.profiles(id),
  dispatch_enabled boolean not null default false,
  app_origin text not null check (app_origin ~ '^https://[a-zA-Z0-9.-]+$'),
  created_at timestamptz not null default now()
);
alter table public.payroll_notification_settings enable row level security;
revoke all on public.payroll_notification_settings from public,anon,authenticated;
grant select,insert,update,delete on public.payroll_notification_settings to service_role;

create or replace function private.enqueue_payroll_lifecycle(p_request_id uuid,p_event_type text)
returns void language plpgsql security definer set search_path=''
as $$
declare r public.payment_requests%rowtype; s public.payroll_capture_sessions%rowtype;
  recipient uuid; email_address text; recipient_ok boolean; payload jsonb;
begin
  if p_event_type not in ('payroll.registered','payroll.paid') then raise exception 'PAYROLL_EVENT_INVALID'; end if;
  select * into r from public.payment_requests where id=p_request_id and request_type::text='nomina';
  if not found or not public.payroll_request_has_valid_materialization(r.id) then raise exception 'PAYROLL_EVENT_MATERIALIZATION_REQUIRED'; end if;
  select * into s from public.payroll_capture_sessions where materialized_payment_request_id=r.id and capture_state='materialized' order by materialized_at limit 1;
  if p_event_type='payroll.registered' then
    select finance_recipient_profile_id into recipient from public.payroll_notification_settings where company_id=r.company_id;
    recipient_ok:=private.profile_has_company_role(recipient,r.company_id,array['finance']);
  else
    if r.status::text<>'paid' or not exists(select 1 from public.payroll_channels where payment_request_id=r.id)
      or exists(select 1 from public.payroll_channels c left join public.payroll_run_files f on f.id=c.receipt_file_id
        where c.payment_request_id=r.id and (c.dispersion_status<>'dispersed' or c.reconciliation_status<>'reconciled'
          or f.id is null or f.parsing_status<>'parsed' or f.parsing_version is distinct from 'payroll-channel-receipt-v1'))
      then raise exception 'PAYROLL_EVENT_PAID_EVIDENCE_REQUIRED'; end if;
    recipient:=s.created_by;
    recipient_ok:=private.payroll_profile_can_capture(recipient,r.company_id);
  end if;
  select lower(btrim(p.email)) into email_address from public.profiles p where p.id=recipient and p.active and recipient_ok;
  recipient_ok:=coalesce(email_address ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$',false);
  -- Only aggregate, server-authored fields. Attachments are resolved afresh by a service-only RPC.
  payload:=jsonb_build_object('company_id',r.company_id,'capture_session_id',s.id,'period_start',s.period_start,'period_end',s.period_end);
  insert into public.notification_events(event_type,source_table,source_id,source_folio,recipient_type,
    recipient_profile_id,recipient_email,channel,priority,payload,idempotency_key,status,last_error,next_attempt_at)
  values(p_event_type,'payment_requests',r.id,r.request_number,'usuario_solicitante',recipient,email_address,
    'email','normal',payload,p_event_type||':'||r.id,
    case when recipient_ok then 'pending' else 'dead_letter' end,
    case when recipient_ok then null else 'PAYROLL_NOTIFICATION_RECIPIENT_REQUIRED' end,
    case when recipient_ok then now() else null end)
  on conflict(idempotency_key) do nothing;
end;
$$;
revoke all on function private.enqueue_payroll_lifecycle(uuid,text) from public,anon,authenticated,service_role;

create or replace function private.payroll_registered_notification()
returns trigger language plpgsql security definer set search_path=''
as $$ begin perform private.enqueue_payroll_lifecycle(new.materialized_payment_request_id,'payroll.registered'); return new; end; $$;
create or replace function private.payroll_paid_notification()
returns trigger language plpgsql security definer set search_path=''
as $$ begin perform private.enqueue_payroll_lifecycle(new.id,'payroll.paid'); return new; end; $$;
revoke all on function private.payroll_registered_notification(),private.payroll_paid_notification() from public,anon,authenticated,service_role;
create trigger payroll_registered_notification after update on public.payroll_capture_sessions for each row
  when(new.capture_state='materialized' and old.capture_state is distinct from 'materialized')
  execute function private.payroll_registered_notification();
create trigger payroll_paid_notification after update on public.payment_requests for each row
  when(new.request_type::text='nomina' and new.status::text='paid' and old.status::text is distinct from 'paid')
  execute function private.payroll_paid_notification();

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
  channels jsonb; attachments jsonb; recipient_ok boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PAYROLL_NOTIFICATION_SERVICE_REQUIRED'; end if;
  select * into e from public.notification_events where id=p_event_id and status='processing' and locked_by=p_worker_id
    and event_type in ('payroll.registered','payroll.paid') and source_table='payment_requests';
  if not found then raise exception 'PAYROLL_NOTIFICATION_CLAIM_REQUIRED'; end if;
  select * into r from public.payment_requests where id=e.source_id and request_type::text='nomina';
  select * into s from public.payroll_capture_sessions where materialized_payment_request_id=r.id and capture_state='materialized' order by materialized_at limit 1;
  select * into cfg from public.payroll_notification_settings where company_id=r.company_id and dispatch_enabled;
  if not found or s.id is null then raise exception 'PAYROLL_NOTIFICATION_SCOPE_REQUIRED'; end if;
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
    'recipient_email',e.recipient_email,'company',(select name from public.companies where id=r.company_id),
    'period_start',s.period_start,'period_end',s.period_end,'amount',r.amount_requested,'currency',r.currency,
    'channels',channels,'attachments',attachments,'url',cfg.app_origin||'/nomina?capture='||s.id);
end;
$$;
revoke all on function public.get_payroll_notification_document(uuid,text) from public,anon,authenticated;
grant execute on function public.get_payroll_notification_document(uuid,text) to service_role;

-- pg_net and the existing Vault secret wake only this payroll worker. Delivery
-- remains disabled per company until the pilot configuration is reviewed.
create or replace function private.wake_payroll_notifications()
returns bigint language plpgsql security definer set search_path=''
as $$
declare endpoint text; secret_value text; request_id bigint;
begin
  if not exists(select 1 from public.payroll_notification_settings where dispatch_enabled) then return null; end if;
  select max(decrypted_secret) filter(where name='notification_payment_outcome_dispatcher_url'),
    max(decrypted_secret) filter(where name='notification_dispatcher_secret') into endpoint,secret_value
    from vault.decrypted_secrets where name in ('notification_payment_outcome_dispatcher_url','notification_dispatcher_secret');
  if endpoint !~ '^https://[a-z0-9]{20}[.]supabase[.]co/functions/v1/notification-dispatcher$' or secret_value is null then return null; end if;
  endpoint:=replace(endpoint,'/notification-dispatcher','/payroll-notification-dispatcher');
  select net.http_post(url:=endpoint,body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','x-notification-dispatcher-secret',secret_value),
    timeout_milliseconds:=2000) into request_id;
  return request_id;
exception when others then raise warning 'PAYROLL_NOTIFICATION_WAKE_FAILED'; return null;
end;
$$;
revoke all on function private.wake_payroll_notifications() from public,anon,authenticated,service_role;
select cron.schedule('payroll-notification-recovery','* * * * *','select private.wake_payroll_notifications();');
commit;
