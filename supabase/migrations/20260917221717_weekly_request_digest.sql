-- Weekly request digest. Read-only with respect to payment requests and approvals.
-- Private outbox freezes the snapshot, recipient and complete MIME payload for retries.
create schema if not exists private;
create table private.weekly_request_digest_settings (
  singleton boolean primary key default true check(singleton),
  environment text not null check(environment in ('dev','prod')),
  project_ref text not null,
  recipient text not null,
  enabled boolean not null default true,
  period_start timestamptz not null,
  next_cutoff timestamptz not null,
  check(next_cutoff>period_start),
  check ((environment='dev' and project_ref='scsirgbuqjcwoaxfacth' and recipient='ramon@quantta.mx')
      or (environment='prod' and project_ref='ucantptjhwttexzmslvm' and recipient='lisette@dezdez.earth'))
);
create table private.weekly_request_digest_runs (
  id uuid primary key default gen_random_uuid(),
  period_start timestamptz not null,
  period_end timestamptz not null unique,
  document jsonb not null,
  status text not null check(status in ('pending','processing','sent','empty','needs_review')),
  payload jsonb,
  worker_id uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  first_send_at timestamptz,
  provider_id text,
  error_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check(period_end>period_start)
);
alter table private.weekly_request_digest_settings enable row level security;
alter table private.weekly_request_digest_runs enable row level security;
revoke all on private.weekly_request_digest_settings,private.weekly_request_digest_runs from public,anon,authenticated;

create or replace function private.weekly_request_digest_cutoff(p_at timestamptz)
returns timestamptz language sql stable set search_path='' as $$
  select case when p_at>=candidate then candidate else candidate-interval '7 days' end
  from (select (date_trunc('week',p_at at time zone 'America/Mexico_City')+interval '2 days 17 hours') at time zone 'America/Mexico_City' candidate) x;
$$;

create or replace function private.weekly_request_digest_document(p_id uuid,p_start timestamptz,p_end timestamptz)
returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('id',p_id,'environment',s.environment,'recipient',s.recipient,
 'period_start',p_start,'period_end',p_end,'rows',coalesce((
  select jsonb_agg(jsonb_build_object(
   'id',r.id,'folio',coalesce(r.request_number,r.id::text),'company',c.name,
   'beneficiary',coalesce(bp.full_name,p.alias,p.nombre_completo,rq.full_name,'Sin beneficiario'),
   'description',coalesce(r.description,r.concept,''),'cost_center',coalesce(cc.code||' - ','')||coalesce(cc.name,'Sin centro'),
   'category',case when bc.name='Sin partida' then 'Sin partida'||case when nullif(r.sin_partida_description,'') is not null then ' ('||r.sin_partida_description||')' else '' end else coalesce(bc.code||' - ','')||coalesce(bc.name,'Sin partida') end,
   'amount_minor',coalesce(round(r.amount_requested*100),0)::bigint,'currency',upper(coalesce(nullif(r.currency,''),'MXN')),
   'status',r.status,'request_type',r.request_type,'requester',coalesce(rq.full_name,'Sin solicitante'),'created_at',r.created_at
  ) order by c.name,r.created_at,r.id)
  from public.payment_requests r join public.companies c on c.id=r.company_id
  left join public.proveedores p on p.id=r.proveedor_id
  left join public.profiles bp on bp.id=r.beneficiary_profile_id
  left join public.profiles rq on rq.id=r.requested_by
  left join public.cost_centers cc on cc.id=r.cost_center_id
  left join public.budget_categories bc on bc.id=r.budget_category_id
  where r.created_at>=p_start and r.created_at<p_end
   and c.name in ('Operadora Tlacatecpan','Soporte Fersana')
   and r.status::text<>'rejected'
   and coalesce(r.exception_status,'')<>'rejected'
   and not exists(select 1 from public.approval_batch_items i where i.payment_request_id=r.id
     and i.removed_at is null and i.director_status='rejected' and coalesce(i.rebatch_status,'')<>'released')
 ),'[]'::jsonb)) from private.weekly_request_digest_settings s where singleton;
$$;

-- Exposed RPCs are service-role only; end-user roles cannot read the consolidated data.
create or replace function public.preview_weekly_request_digest()
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('enabled',s.enabled,'environment',s.environment,'recipient',s.recipient,
 'next_cutoff',s.next_cutoff,'document',private.weekly_request_digest_document(gen_random_uuid(),
 s.period_start,least(now(),s.next_cutoff)))
 from private.weekly_request_digest_settings s where singleton;
$$;

create or replace function public.claim_weekly_request_digest(p_worker_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.weekly_request_digest_settings%rowtype; r private.weekly_request_digest_runs%rowtype;
 v_id uuid; v_doc jsonb; v_start timestamptz;
begin
 select * into s from private.weekly_request_digest_settings where singleton for update;
 if not found or not s.enabled then return null; end if;
 -- Never retry beyond Resend's 24h idempotency window after an uncertain send.
 update private.weekly_request_digest_runs set status='needs_review',error_code='RETRY_WINDOW_EXPIRED',worker_id=null,lease_until=null
 where status in ('pending','processing') and first_send_at<now()-interval '20 hours';
 select * into r from private.weekly_request_digest_runs
 where status in ('pending','processing') and (lease_until is null or lease_until<now())
 order by period_end limit 1 for update skip locked;
 if not found then
  if s.next_cutoff>now() then return null; end if;
  v_id:=gen_random_uuid();
  v_start:=s.period_start;
  v_doc:=private.weekly_request_digest_document(v_id,v_start,s.next_cutoff);
  insert into private.weekly_request_digest_runs(id,period_start,period_end,document,status)
  values(v_id,v_start,s.next_cutoff,v_doc,case when jsonb_array_length(v_doc->'rows')=0 then 'empty' else 'pending' end)
  returning * into r;
  update private.weekly_request_digest_settings set period_start=s.next_cutoff,next_cutoff=(s.next_cutoff at time zone 'America/Mexico_City'+interval '7 days') at time zone 'America/Mexico_City' where singleton;
  if r.status='empty' then return jsonb_build_object('id',r.id,'empty',true); end if;
 end if;
 update private.weekly_request_digest_runs set status='processing',worker_id=p_worker_id,lease_until=now()+interval '10 minutes',attempts=attempts+1 where id=r.id;
 return jsonb_build_object('id',r.id,'document',r.document,'payload',r.payload);
end;
$$;

create or replace function public.prepare_weekly_request_digest(p_id uuid,p_worker_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.weekly_request_digest_runs%rowtype;
begin
 select * into r from private.weekly_request_digest_runs where id=p_id for update;
 if not found or r.status<>'processing' or r.worker_id is distinct from p_worker_id or r.lease_until<=now() then raise exception 'DIGEST_LEASE_INVALID'; end if;
 if r.first_send_at<now()-interval '20 hours' then raise exception 'DIGEST_RETRY_EXPIRED'; end if;
 if r.payload is null then
  if jsonb_typeof(p_payload)<>'object' or p_payload->'to' is distinct from jsonb_build_array(r.document->>'recipient')
   or (p_payload-'from'-'to'-'subject'-'html'-'text'-'attachments')<>'{}'::jsonb
   or coalesce(p_payload->>'from','')='' or coalesce(p_payload->>'subject','')=''
   or coalesce(p_payload->>'html','')='' or coalesce(p_payload->>'text','')=''
   or jsonb_typeof(p_payload->'attachments') is distinct from 'array' or jsonb_array_length(p_payload->'attachments')<>1
   or coalesce(p_payload#>>'{attachments,0,content}','')='' or octet_length(p_payload::text)>28*1024*1024
  then raise exception 'DIGEST_PAYLOAD_INVALID'; end if;
  update private.weekly_request_digest_runs set payload=p_payload where id=p_id;
 end if;
 update private.weekly_request_digest_runs set first_send_at=coalesce(first_send_at,now()) where id=p_id returning payload into p_payload;
 return p_payload;
end;
$$;

create or replace function public.finish_weekly_request_digest(p_id uuid,p_worker_id uuid,p_provider_id text default null,p_error_code text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 update private.weekly_request_digest_runs set
 status=case when nullif(p_provider_id,'') is not null then 'sent' when attempts>=12 then 'needs_review' else 'pending' end,
 provider_id=nullif(p_provider_id,''),sent_at=case when nullif(p_provider_id,'') is not null then now() else null end,
 error_code=case when nullif(p_provider_id,'') is not null then null else left(regexp_replace(coalesce(p_error_code,'DIGEST_FAILED'),'[^A-Z0-9_]','','g'),80) end,
 worker_id=null,lease_until=case when nullif(p_provider_id,'') is null then now()+interval '5 minutes' else null end
 where id=p_id and worker_id=p_worker_id and status='processing';
 if not found then raise exception 'DIGEST_LEASE_INVALID'; end if;
end;
$$;

revoke all on function private.weekly_request_digest_cutoff(timestamptz),private.weekly_request_digest_document(uuid,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.preview_weekly_request_digest(),public.claim_weekly_request_digest(uuid),public.prepare_weekly_request_digest(uuid,uuid,jsonb),public.finish_weekly_request_digest(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.preview_weekly_request_digest(),public.claim_weekly_request_digest(uuid),public.prepare_weekly_request_digest(uuid,uuid,jsonb),public.finish_weekly_request_digest(uuid,uuid,text,text) to service_role;

-- Scheduler registration: resolve the environment from the already-installed Vault endpoint.
-- No secrets leave the database; only the existing dispatcher secret authenticates the worker.
create or replace function private.wake_weekly_request_digest(p_dry_run boolean default false)
returns bigint language plpgsql security definer set search_path='' as $$
declare endpoint text; secret_value text; s private.weekly_request_digest_settings%rowtype; request_id bigint;
begin
 select * into s from private.weekly_request_digest_settings where singleton;
 if not found or not s.enabled then return null; end if;
 if not p_dry_run and s.next_cutoff>now() and not exists(select 1 from private.weekly_request_digest_runs where status in ('pending','processing') and (lease_until is null or lease_until<=now())) then return null; end if;
 select max(decrypted_secret) filter(where name='notification_payment_outcome_dispatcher_url'),max(decrypted_secret) filter(where name='notification_dispatcher_secret')
 into endpoint,secret_value from vault.decrypted_secrets where name in ('notification_payment_outcome_dispatcher_url','notification_dispatcher_secret');
 if endpoint is distinct from 'https://'||s.project_ref||'.supabase.co/functions/v1/notification-dispatcher' or nullif(secret_value,'') is null then raise exception 'DIGEST_DISPATCHER_CONFIGURATION_INVALID'; end if;
 select net.http_post(url:=replace(endpoint,'/notification-dispatcher','/weekly-request-digest'),
 body:=jsonb_build_object('dry_run',p_dry_run),headers:=jsonb_build_object('Content-Type','application/json','x-notification-dispatcher-secret',secret_value),timeout_milliseconds:=10000) into request_id;
 return request_id;
end;
$$;
revoke all on function private.wake_weekly_request_digest(boolean) from public,anon,authenticated;

do $$
declare endpoint text; project_ref text; environment text; recipient text;
begin
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='notification_payment_outcome_dispatcher_url';
 project_ref:=substring(endpoint from '^https://([a-z0-9]{20})[.]supabase[.]co/functions/v1/notification-dispatcher$');
 if project_ref='scsirgbuqjcwoaxfacth' then environment:='dev';recipient:='ramon@quantta.mx';
 elsif project_ref='ucantptjhwttexzmslvm' then environment:='prod';recipient:='lisette@dezdez.earth';
 else raise exception 'DIGEST_UNKNOWN_ENVIRONMENT'; end if;
 insert into private.weekly_request_digest_settings(environment,project_ref,recipient,period_start,next_cutoff)
 values(environment,project_ref,recipient,timestamp '2026-09-18 00:00:00' at time zone 'America/Mexico_City',timestamp '2026-09-23 17:00:00' at time zone 'America/Mexico_City');
 -- A five-minute recovery poll is idle outside the due window. The cutoff itself
 -- is always Wednesday 17:00 America/Mexico_City, calculated in local time.
 perform cron.schedule('weekly-request-digest','*/5 * * * *','select private.wake_weekly_request_digest();');
end;
$$;
