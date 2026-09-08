-- Private IMSS/ISN obligations. Explicit company activation is separate.
begin;
set local lock_timeout='5s';
create table public.payroll_obligation_settings (
 company_id uuid references public.companies(id), kind text check(kind in('imss','isn_cdmx')),
 enabled boolean not null default false, budget_category_id uuid references public.budget_categories(id),
 dispatch_enabled boolean not null default false, test_recipient_profile_id uuid references public.profiles(id),
 primary key(company_id,kind)
);
create table public.payroll_obligations (
 id uuid primary key, company_id uuid not null references public.companies(id),
 kind text not null check(kind in('imss','isn_cdmx')), status text not null default 'draft' check(status in('draft','submitted','approved','paid','cancelled')),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 version integer not null default 1, taxpayer_rfc text, employer_registration text,
 period_start date, period_end date, amount_minor bigint check(amount_minor>0 and amount_minor<=9007199254740991),
 due_date date, payment_reference text, cost_center_id uuid references public.cost_centers(id),
 budget_category_id uuid references public.budget_categories(id), budget_month date, budget_result jsonb,
 submitted_at timestamptz, confirmed_by uuid references public.profiles(id), confirmed_at timestamptz,
 paid_by uuid references public.profiles(id), paid_at timestamptz, payment_date date, bank_reference text,
 foreign key(company_id,kind) references public.payroll_obligation_settings(company_id,kind),
 check(period_start<=period_end), check(budget_month=date_trunc('month',budget_month)::date),
 check(status not in('submitted','approved','paid') or (period_start is not null and period_end is not null and amount_minor is not null
   and cost_center_id is not null and budget_category_id is not null and budget_month is not null and budget_result->>'status'='aprobable')),
 check(status<>'paid' or (paid_by is not null and paid_at is not null and payment_date is not null and nullif(btrim(bank_reference),'') is not null))
);
create index payroll_obligations_company_created_idx on public.payroll_obligations(company_id,created_at desc,id);
create index payroll_obligations_budget_idx on public.payroll_obligations(company_id,cost_center_id,budget_category_id,budget_month) where status in('submitted','approved','paid');
create unique index payroll_obligations_reference_unique on public.payroll_obligations(company_id,kind,payment_reference) where status<>'cancelled' and payment_reference is not null;
create table public.payroll_obligation_files (
 id uuid primary key default gen_random_uuid(), obligation_id uuid not null references public.payroll_obligations(id),
 kind text not null check(kind in('imss_sipare','imss_sua','imss_ema','isn_cdmx','receipt')),
 active boolean not null default true, status text not null default 'reserved' check(status in('reserved','verified')),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '1 hour', verified_at timestamptz,
 size_bytes bigint not null check(size_bytes between 100 and 10485760), sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 storage_path text not null unique, parsed jsonb
);
create unique index payroll_obligation_files_current_idx on public.payroll_obligation_files(obligation_id,kind) where active;
create table public.payroll_obligation_audit (
 id bigint generated always as identity primary key, obligation_id uuid not null references public.payroll_obligations(id),
 actor_id uuid not null references public.profiles(id), action text not null, created_at timestamptz not null default now()
);
create index payroll_obligation_audit_obligation_idx on public.payroll_obligation_audit(obligation_id,created_at);
alter table public.payroll_obligation_settings enable row level security;
alter table public.payroll_obligations enable row level security;
alter table public.payroll_obligation_files enable row level security;
alter table public.payroll_obligation_audit enable row level security;
revoke all on public.payroll_obligation_settings,public.payroll_obligations,public.payroll_obligation_files,public.payroll_obligation_audit from public,anon,authenticated;
grant all on public.payroll_obligation_settings,public.payroll_obligations,public.payroll_obligation_files,public.payroll_obligation_audit to service_role;

create function private.payroll_obligation_permission(p_profile uuid,p_company uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.companies c on c.id=p_company where p.id=p_profile and p.active and c.active)
 and (private.profile_has_company_role(p_profile,p_company,array[]::text[])
 or (public.has_active_company_membership(p_profile,p_company) and case p_permission
 when 'capture' then exists(select 1 from public.payroll_capture_grants g where g.profile_id=p_profile and g.company_id=p_company and g.active)
 when 'pay' then private.profile_has_company_role(p_profile,p_company,array['finance'])
 when 'read' then (exists(select 1 from public.payroll_capture_grants g where g.profile_id=p_profile and g.company_id=p_company and g.active)
   or private.profile_has_company_role(p_profile,p_company,array['finance'])) else false end));
$$;
create function private.payroll_obligation_actor(p_company uuid,p_permission text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=public.current_profile_id(); begin
 if auth.uid() is null or not coalesce(private.payroll_obligation_permission(actor,p_company,p_permission),false)
 then raise exception 'OBLIGATION_ACCESS_DENIED'; end if; return actor;
end; $$;

create function public.get_payroll_obligation_context(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=public.current_profile_id(); begin
 if not private.payroll_obligation_permission(actor,p_company_id,'read') or auth.uid() is null then
 return jsonb_build_object('can_capture',false,'can_pay',false,'kinds','[]'::jsonb); end if;
 return jsonb_build_object('can_capture',private.payroll_obligation_permission(actor,p_company_id,'capture'),
 'can_pay',private.payroll_obligation_permission(actor,p_company_id,'pay'),
 'company_rfc',(select rfc from public.companies where id=p_company_id),
 'kinds',(select coalesce(jsonb_agg(jsonb_build_object('kind',s.kind,'category_id',s.budget_category_id,'category_name',b.name,
 'centers',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)),'[]'::jsonb)
 from public.company_cost_center_budget_categories a join public.cost_centers c on c.id=a.cost_center_id and c.active
 where a.company_id=s.company_id and a.budget_category_id=s.budget_category_id and a.active))), '[]'::jsonb)
 from public.payroll_obligation_settings s left join public.budget_categories b on b.id=s.budget_category_id where s.company_id=p_company_id and s.enabled));
end; $$;

create function public.get_payroll_obligations(p_company_id uuid,p_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.payroll_obligation_actor(p_company_id,'read'); result jsonb; begin
 select coalesce(jsonb_agg(q.doc order by q.created_at desc,q.id),'[]'::jsonb) into result from (
 select o.id,o.created_at,to_jsonb(o)||jsonb_build_object('files',(select coalesce(jsonb_agg(jsonb_build_object(
 'id',f.id,'kind',f.kind,'status',f.status,'parsed',f.parsed) order by f.created_at),'[]'::jsonb)
 from public.payroll_obligation_files f where f.obligation_id=o.id and f.active)) as doc
 from public.payroll_obligations o where o.company_id=p_company_id and (p_id is null or o.id=p_id)
 and (private.payroll_obligation_permission(actor,p_company_id,'capture') or o.status in('submitted','approved') or (o.status='paid' and (p_id is not null or o.paid_by=actor)))
 order by o.created_at desc,o.id limit 200) q; return result;
end; $$;

create function public.save_payroll_obligation(p_id uuid,p_company_id uuid,p_kind text,p_version integer default null,p_cost_center_id uuid default null,p_budget_month date default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.payroll_obligation_actor(p_company_id,'capture'); o public.payroll_obligations%rowtype; cfg public.payroll_obligation_settings%rowtype; begin
 select * into cfg from public.payroll_obligation_settings where company_id=p_company_id and kind=p_kind and enabled;
 if not found then raise exception 'OBLIGATION_NOT_ENABLED'; end if;
 if p_id is null then raise exception 'OBLIGATION_ID_REQUIRED'; end if;
 select * into o from public.payroll_obligations where id=p_id for update;
 if found then
  if o.company_id<>p_company_id or o.kind<>p_kind then raise exception 'OBLIGATION_SCOPE_MISMATCH'; end if;
  if o.status<>'draft' then raise exception 'OBLIGATION_DRAFT_REQUIRED'; end if;
  if o.version is distinct from p_version then raise exception 'OBLIGATION_STALE_VERSION'; end if;
 end if;
 if p_cost_center_id is not null and not exists(select 1 from public.company_cost_center_budget_categories a
 join public.cost_centers c on c.id=a.cost_center_id and c.active join public.budget_categories b on b.id=a.budget_category_id and b.active and not b.no_presupuestal
 where a.company_id=p_company_id and a.cost_center_id=p_cost_center_id and a.budget_category_id=cfg.budget_category_id and a.active)
 then raise exception 'OBLIGATION_BUDGET_ASSIGNMENT_REQUIRED'; end if;
 if o.id is null then
  insert into public.payroll_obligations(id,company_id,kind,created_by,cost_center_id,budget_category_id,budget_month)
  values(p_id,p_company_id,p_kind,actor,p_cost_center_id,cfg.budget_category_id,date_trunc('month',p_budget_month)::date);
 else update public.payroll_obligations set cost_center_id=p_cost_center_id,budget_category_id=cfg.budget_category_id,
 budget_month=date_trunc('month',p_budget_month)::date,version=version+1,updated_at=now() where id=p_id; end if;
 insert into public.payroll_obligation_audit(obligation_id,actor_id,action) values(p_id,actor,'save_draft'); return p_id;
end; $$;

create function public.reserve_payroll_obligation_file(p_id uuid,p_version integer,p_kind text,p_size_bytes bigint,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.payroll_obligations%rowtype; actor uuid; file_id uuid:=gen_random_uuid(); path text; begin
 select * into o from public.payroll_obligations where id=p_id for update;
 if not found then raise exception 'OBLIGATION_NOT_FOUND'; end if;
 actor:=private.payroll_obligation_actor(o.company_id,case when p_kind='receipt' then 'pay' else 'capture' end);
 if o.version is distinct from p_version then raise exception 'OBLIGATION_STALE_VERSION'; end if;
 if (p_kind='receipt' and o.status<>'approved') or (p_kind<>'receipt' and o.status<>'draft') then raise exception 'OBLIGATION_FILE_STATE_INVALID'; end if;
 if not (p_kind='receipt' or (o.kind='imss' and p_kind in('imss_sipare','imss_sua','imss_ema')) or (o.kind='isn_cdmx' and p_kind='isn_cdmx'))
 then raise exception 'OBLIGATION_FILE_KIND_INVALID'; end if;
 if exists(select 1 from public.payroll_obligation_files f join public.payroll_obligations other on other.id=f.obligation_id
 where other.company_id=o.company_id and other.id<>o.id and other.status<>'cancelled' and f.active and f.sha256=p_sha256)
 then raise exception 'OBLIGATION_DUPLICATE_DOCUMENT'; end if;
 path:=o.company_id||'/'||o.id||'/'||file_id||'.pdf';
 update public.payroll_obligation_files set active=false where obligation_id=o.id and kind=p_kind and active;
 insert into public.payroll_obligation_files(id,obligation_id,kind,created_by,size_bytes,sha256,storage_path)
 values(file_id,o.id,p_kind,actor,p_size_bytes,p_sha256,path);
 update public.payroll_obligations set version=version+1,updated_at=now() where id=o.id;
 return jsonb_build_object('file_id',file_id,'bucket','payroll-obligations','path',path);
end; $$;

create function private.payroll_obligation_upload_allowed(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.payroll_obligation_files f join public.payroll_obligations o on o.id=f.obligation_id
 where f.storage_path=p_path and f.active and f.status='reserved' and f.expires_at>now() and f.created_by=public.current_profile_id()
 and ((f.kind='receipt' and o.status='approved') or (f.kind<>'receipt' and o.status='draft'))
 and private.payroll_obligation_permission(f.created_by,o.company_id,case when f.kind='receipt' then 'pay' else 'capture' end));
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('payroll-obligations','payroll-obligations',false,10485760,array['application/pdf']);
create policy payroll_obligation_reserved_upload on storage.objects for insert to authenticated
with check(bucket_id='payroll-obligations' and private.payroll_obligation_upload_allowed(name));

create function public.get_payroll_obligation_file_context(p_file_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.payroll_obligation_files%rowtype; o public.payroll_obligations%rowtype; actor uuid; begin
 select * into f from public.payroll_obligation_files where id=p_file_id and active;
 if not found then raise exception 'OBLIGATION_FILE_NOT_FOUND'; end if;
 select * into o from public.payroll_obligations where id=f.obligation_id;
 actor:=private.payroll_obligation_actor(o.company_id,case when p_action='verify' then case when f.kind='receipt' then 'pay' else 'capture' end else 'read' end);
 if p_action='verify' then
  if f.created_by<>actor or not ((f.kind='receipt' and o.status='approved') or (f.kind<>'receipt' and o.status='draft')) then raise exception 'OBLIGATION_FILE_STATE_INVALID'; end if;
 elsif p_action='download' then
  if f.status<>'verified' or (o.status='draft' and not private.payroll_obligation_permission(actor,o.company_id,'capture')) then raise exception 'OBLIGATION_FILE_NOT_READY'; end if;
 else raise exception 'OBLIGATION_ACTION_INVALID'; end if;
 insert into public.payroll_obligation_audit(obligation_id,actor_id,action) values(o.id,actor,p_action||'_file');
 return jsonb_build_object('file_id',f.id,'obligation_id',o.id,'company_id',o.company_id,'actor_id',actor,'kind',f.kind,
 'bucket','payroll-obligations','path',f.storage_path,'size_bytes',f.size_bytes,'sha256',f.sha256,
 'company_rfc',(select rfc from public.companies where id=o.company_id));
end; $$;

create function public.complete_payroll_obligation_file(p_file_id uuid,p_actor_id uuid,p_sha256 text,p_parsed jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare f public.payroll_obligation_files%rowtype; o public.payroll_obligations%rowtype; v_parsed jsonb; company_rfc text; begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'OBLIGATION_SERVICE_REQUIRED'; end if;
 select o1.* into o from public.payroll_obligations o1 join public.payroll_obligation_files f1 on f1.obligation_id=o1.id where f1.id=p_file_id for update of o1;
 select * into f from public.payroll_obligation_files where id=p_file_id for update;
 if f.id is null or not f.active or f.created_by<>p_actor_id or f.sha256<>p_sha256 or f.expires_at<=now()
 or not private.payroll_obligation_permission(p_actor_id,o.company_id,case when f.kind='receipt' then 'pay' else 'capture' end)
 then raise exception 'OBLIGATION_FILE_SCOPE_INVALID'; end if;
 if (f.kind='receipt' and o.status<>'approved') or (f.kind<>'receipt' and o.status<>'draft') then raise exception 'OBLIGATION_FILE_STATE_INVALID'; end if;
 if f.status='verified' then return; end if;
 if f.kind<>'receipt' then
  select regexp_replace(upper(rfc),'[^A-Z0-9Ñ&]','','g') into company_rfc from public.companies where id=o.company_id;
  if nullif(company_rfc,'') is null or p_parsed->>'taxpayerRfc' is distinct from company_rfc then raise exception 'OBLIGATION_COMPANY_RFC_MISMATCH'; end if;
  if p_parsed->>'kind' is distinct from f.kind or coalesce(jsonb_array_length(p_parsed->'issues'),1)<>0 then raise exception 'OBLIGATION_DOCUMENT_INVALID'; end if;
  v_parsed:=jsonb_build_object('kind',p_parsed->>'kind','taxpayerRfc',p_parsed->>'taxpayerRfc',
   'employerRegistration',p_parsed->>'employerRegistration','periodStart',p_parsed->>'periodStart','periodEnd',p_parsed->>'periodEnd',
   'amountMinor',(p_parsed->>'amountMinor')::bigint,'dueDate',p_parsed->>'dueDate','paymentReference',p_parsed->>'paymentReference');
  if f.kind in('imss_sipare','isn_cdmx') then
   update public.payroll_obligations set taxpayer_rfc=company_rfc,employer_registration=v_parsed->>'employerRegistration',
   period_start=(v_parsed->>'periodStart')::date,period_end=(v_parsed->>'periodEnd')::date,amount_minor=(v_parsed->>'amountMinor')::bigint,
   due_date=(v_parsed->>'dueDate')::date,payment_reference=v_parsed->>'paymentReference',
   budget_month=coalesce(budget_month,date_trunc('month',(v_parsed->>'periodStart')::date)::date) where id=o.id;
  end if;
 else v_parsed:=jsonb_build_object('amount',p_parsed->>'amount','paymentDate',p_parsed->>'paymentDate','reference',left(p_parsed->>'reference',120),'currency',p_parsed->>'currency'); end if;
 update public.payroll_obligation_files set status='verified',verified_at=now(),parsed=v_parsed where id=f.id;
 update public.payroll_obligations set version=version+1,updated_at=now() where id=o.id;
 insert into public.payroll_obligation_audit(obligation_id,actor_id,action) values(o.id,p_actor_id,'verified_'||f.kind);
end; $$;

-- Only aggregate obligations enter the canonical budget view; users do not
-- need SELECT on the confidential source table to see the reserved amount.
create function public.payroll_obligation_budget_totals()
returns table(company_id uuid,cost_center_id uuid,budget_category_id uuid,budget_month date,committed numeric,executed numeric)
language sql stable security definer set search_path='' as $$
 select o.company_id,o.cost_center_id,o.budget_category_id,o.budget_month,sum(o.amount_minor)/100::numeric,
 coalesce(sum(o.amount_minor) filter(where o.status='paid'),0)/100::numeric
 from public.payroll_obligations o where o.status in('submitted','approved','paid')
 and (coalesce(auth.jwt()->>'role','')='service_role' or public.has_active_company_membership(public.current_profile_id(),o.company_id)
 or private.profile_has_company_role(public.current_profile_id(),o.company_id,array[]::text[]))
 group by o.company_id,o.cost_center_id,o.budget_category_id,o.budget_month;
$$;
-- Preserve the existing view OID, dependencies, invoker security and all
-- pre-existing request arithmetic. Fail if this migration was already applied.
do $$ declare original text:=pg_get_viewdef('public.budget_availability'::regclass,true); begin
 if original ilike '%payroll_obligation_budget_totals%' then raise exception 'OBLIGATION_BUDGET_ALREADY_INSTALLED'; end if;
 execute 'create or replace view public.budget_availability with(security_invoker=true) as with original as ('||rtrim(original,'; ')||')
 select b.company_id,b.cost_center_id,b.budget_category_id,b.budget_month,b.budgeted,
 b.committed+coalesce(o.committed,0) as committed,b.executed+coalesce(o.executed,0) as executed,
 b.available-coalesce(o.committed,0) as available from original b left join public.payroll_obligation_budget_totals() o
 using(company_id,cost_center_id,budget_category_id,budget_month)';
end $$;

create function private.enqueue_payroll_obligation_event(p_id uuid,p_event text)
returns void language plpgsql security definer set search_path='' as $$
declare o public.payroll_obligations%rowtype; recipient uuid; email_address text; begin
 select * into strict o from public.payroll_obligations where id=p_id;
 if p_event='payroll.obligation.registered' then select finance_recipient_profile_id into recipient from public.payroll_notification_settings where company_id=o.company_id;
 elsif p_event='payroll.obligation.paid' and o.status='paid' then recipient:=o.created_by;
 else raise exception 'OBLIGATION_EVENT_INVALID'; end if;
 select lower(btrim(email)) into email_address from public.profiles where id=recipient and active
 and private.payroll_obligation_permission(recipient,o.company_id,case when p_event='payroll.obligation.paid' then 'capture' else 'pay' end);
 insert into public.notification_events(event_type,source_table,source_id,source_folio,recipient_type,recipient_profile_id,
 recipient_email,channel,priority,payload,idempotency_key,status,last_error,next_attempt_at)
 values(p_event,'payroll_obligations',o.id,upper(o.kind)||'-'||left(o.id::text,8),'usuario_solicitante',recipient,email_address,'email','normal',
 jsonb_build_object('company_id',o.company_id),p_event||':'||o.id,
 case when email_address~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then 'pending' else 'dead_letter' end,
 case when email_address is null then 'OBLIGATION_RECIPIENT_REQUIRED' end,now()) on conflict(idempotency_key) do nothing;
end; $$;

create function public.transition_payroll_obligation(p_id uuid,p_version integer,p_action text,p_amount_minor bigint default null,p_payment_date date default null,p_reference text default null)
returns text language plpgsql security definer set search_path='' as $$
declare o public.payroll_obligations%rowtype; actor uuid; result jsonb; primary_kind text; begin
 select * into o from public.payroll_obligations where id=p_id for update;
 if not found then raise exception 'OBLIGATION_NOT_FOUND'; end if;
 actor:=private.payroll_obligation_actor(o.company_id,case when p_action in('confirm','pay') or (p_action='cancel' and o.status<>'draft') then 'pay' else 'capture' end);
 if (p_action='submit' and o.status='submitted') or (p_action='confirm' and o.status='approved') or (p_action='pay' and o.status='paid') or (p_action='cancel' and o.status='cancelled') then return o.status; end if;
 if o.version is distinct from p_version then raise exception 'OBLIGATION_STALE_VERSION'; end if;
 if p_action='submit' then
  if o.status<>'draft' then raise exception 'OBLIGATION_DRAFT_REQUIRED'; end if;
  if not exists(select 1 from public.payroll_obligation_settings where company_id=o.company_id and kind=o.kind and enabled and budget_category_id=o.budget_category_id)
  then raise exception 'OBLIGATION_NOT_ENABLED'; end if;
  primary_kind:=case when o.kind='imss' then 'imss_sipare' else 'isn_cdmx' end;
  if not exists(select 1 from public.payroll_obligation_files where obligation_id=o.id and active and kind=primary_kind and status='verified')
  or exists(select 1 from public.payroll_obligation_files f where f.obligation_id=o.id and f.active and (f.status<>'verified'
  or f.parsed->>'taxpayerRfc' is distinct from o.taxpayer_rfc or (f.parsed->>'amountMinor')::bigint is distinct from o.amount_minor
  or (f.parsed->>'periodStart')::date is distinct from o.period_start or (f.parsed->>'periodEnd')::date is distinct from o.period_end
  or (o.kind='imss' and f.parsed->>'employerRegistration' is distinct from o.employer_registration)
  or (nullif(f.parsed->>'dueDate','') is not null and (f.parsed->>'dueDate')::date is distinct from o.due_date)))
  then raise exception 'OBLIGATION_DOCUMENTS_INCONSISTENT'; end if;
  if o.cost_center_id is null or o.budget_category_id is null or o.budget_month is null or o.amount_minor is null
  or not exists(select 1 from public.budget_categories where id=o.budget_category_id and active and not no_presupuestal)
  then raise exception 'OBLIGATION_BUDGET_ASSIGNMENT_REQUIRED'; end if;
  perform 1 from public.budget_lines bl join public.budget_versions bv on bv.id=bl.budget_version_id and bv.active
  where bl.company_id=o.company_id and bl.cost_center_id=o.cost_center_id and bl.budget_category_id=o.budget_category_id and bl.budget_month=o.budget_month for update of bl;
  if not found then raise exception 'OBLIGATION_BUDGET_LINE_REQUIRED'; end if;
  result:=public.verify_budget_availability(o.company_id,o.cost_center_id,o.budget_category_id,o.budget_month,o.amount_minor/100::numeric,false,false);
  if result->>'status' is distinct from 'aprobable' then raise exception 'OBLIGATION_BUDGET_UNAVAILABLE'; end if;
  update public.payroll_obligations set status='submitted',submitted_at=now(),budget_result=result where id=o.id;
  perform private.enqueue_payroll_obligation_event(o.id,'payroll.obligation.registered');
 elsif p_action='confirm' then
  if o.status<>'submitted' then raise exception 'OBLIGATION_SUBMITTED_REQUIRED'; end if;
  if not exists(select 1 from public.budget_availability b where b.company_id=o.company_id and b.cost_center_id=o.cost_center_id
    and b.budget_category_id=o.budget_category_id and b.budget_month=o.budget_month and b.available>=0)
  then raise exception 'OBLIGATION_BUDGET_UNAVAILABLE'; end if;
  update public.payroll_obligations set status='approved',confirmed_by=actor,confirmed_at=now() where id=o.id;
 elsif p_action='pay' then
  if o.status<>'approved' then raise exception 'OBLIGATION_CONFIRMATION_REQUIRED'; end if;
  if p_amount_minor is distinct from o.amount_minor or p_payment_date is null or p_payment_date>current_date
  or nullif(btrim(p_reference),'') is null or length(p_reference)>120 then raise exception 'OBLIGATION_PAYMENT_FIELDS_INVALID'; end if;
  if not exists(select 1 from public.payroll_obligation_files where obligation_id=o.id and kind='receipt' and active and status='verified') then raise exception 'OBLIGATION_RECEIPT_REQUIRED'; end if;
  if exists(select 1 from public.payroll_obligation_files f where f.obligation_id=o.id and f.kind='receipt' and f.active and (
   nullif(f.parsed->>'currency','') is not null and f.parsed->>'currency'<>'MXN'
   or nullif(f.parsed->>'amount','') is not null and (f.parsed->>'amount')::numeric*100<>p_amount_minor
   or nullif(f.parsed->>'paymentDate','') is not null and (f.parsed->>'paymentDate')::date<>p_payment_date
   or nullif(f.parsed->>'reference','') is not null and f.parsed->>'reference'<>btrim(p_reference)))
  then raise exception 'OBLIGATION_PAYMENT_FIELDS_INVALID'; end if;
  update public.payroll_obligations set status='paid',paid_by=actor,paid_at=now(),payment_date=p_payment_date,bank_reference=btrim(p_reference) where id=o.id;
  perform private.enqueue_payroll_obligation_event(o.id,'payroll.obligation.paid');
 elsif p_action='cancel' then
  if o.status not in('draft','submitted','approved') then raise exception 'OBLIGATION_CANCEL_STATE_INVALID'; end if;
  update public.payroll_obligations set status='cancelled' where id=o.id;
  update public.notification_events set status='cancelled',next_attempt_at=null where source_table='payroll_obligations' and source_id=o.id and status in('pending','failed');
 else raise exception 'OBLIGATION_ACTION_INVALID'; end if;
 update public.payroll_obligations set version=version+1,updated_at=now() where id=o.id returning status into p_action;
 insert into public.payroll_obligation_audit(obligation_id,actor_id,action) values(o.id,actor,p_action); return p_action;
end; $$;

revoke all on function private.payroll_obligation_permission(uuid,uuid,text),private.payroll_obligation_actor(uuid,text),private.payroll_obligation_upload_allowed(text),private.enqueue_payroll_obligation_event(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.payroll_obligation_upload_allowed(text) to authenticated;
revoke all on function public.get_payroll_obligation_context(uuid),public.get_payroll_obligations(uuid,uuid),public.save_payroll_obligation(uuid,uuid,text,integer,uuid,date),public.reserve_payroll_obligation_file(uuid,integer,text,bigint,text),public.get_payroll_obligation_file_context(uuid,text),public.complete_payroll_obligation_file(uuid,uuid,text,jsonb),public.payroll_obligation_budget_totals(),public.transition_payroll_obligation(uuid,integer,text,bigint,date,text) from public,anon,authenticated;
grant execute on function public.get_payroll_obligation_context(uuid),public.get_payroll_obligations(uuid,uuid),public.save_payroll_obligation(uuid,uuid,text,integer,uuid,date),public.reserve_payroll_obligation_file(uuid,integer,text,bigint,text),public.get_payroll_obligation_file_context(uuid,text),public.payroll_obligation_budget_totals(),public.transition_payroll_obligation(uuid,integer,text,bigint,date,text) to authenticated;
grant execute on function public.complete_payroll_obligation_file(uuid,uuid,text,jsonb),public.payroll_obligation_budget_totals() to service_role;

create function public.claim_payroll_obligation_notifications(p_worker_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' or p_worker_id is null or length(p_worker_id) not between 1 and 120 then raise exception 'OBLIGATION_SERVICE_REQUIRED'; end if;
 update public.notification_events set status='dead_letter',last_error='OBLIGATION_DELIVERY_RESULT_UNKNOWN',locked_by=null,locked_at=null
 where source_table='payroll_obligations' and event_type in('payroll.obligation.registered','payroll.obligation.paid') and status in('processing','failed')
 and coalesce((payload->>'dispatch_first_attempt_at')::timestamptz,last_attempt_at)<now()-interval '23 hours';
 with candidates as(select e.id from public.notification_events e
 join public.payroll_obligations o on o.id=e.source_id and e.source_table='payroll_obligations'
 join public.payroll_obligation_settings s on s.company_id=o.company_id and s.kind=o.kind and s.enabled and s.dispatch_enabled
 where e.event_type in('payroll.obligation.registered','payroll.obligation.paid') and o.status<>'cancelled'
 and (e.status in('pending','failed') or (e.status='processing' and e.locked_at<now()-interval '10 minutes'))
 and coalesce(e.next_attempt_at,now())<=now() and e.attempt_count<e.max_attempts and e.recipient_email is not null
 order by e.created_at,e.id for update of e skip locked limit 5), claimed as(
 update public.notification_events e set status='processing',locked_by=p_worker_id,locked_at=now(),last_attempt_at=now(),updated_at=now(),
 payload=jsonb_set(e.payload,'{dispatch_first_attempt_at}',coalesce(e.payload->'dispatch_first_attempt_at',to_jsonb(now())))
 from candidates c where c.id=e.id returning e.id) select coalesce(jsonb_agg(id),'[]'::jsonb) into result from claimed;
 return result;
end; $$;
create function public.get_payroll_obligation_notification_document(p_event_id uuid,p_worker_id text)
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
 if not found or cfg.app_origin !~ '^https://[a-zA-Z0-9.-]+$' then raise exception 'OBLIGATION_NOTIFICATION_CONFIGURATION_REQUIRED'; end if;
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
revoke all on function public.claim_payroll_obligation_notifications(text),public.get_payroll_obligation_notification_document(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_payroll_obligation_notifications(text),public.get_payroll_obligation_notification_document(uuid,text) to service_role;
-- Recovery uses the existing dispatcher secret; disabled companies make no requests.
create function private.wake_payroll_obligation_notifications()
returns bigint language plpgsql security definer set search_path='' as $$
declare endpoint text; secret_value text; request_id bigint;
begin
 if not exists(select 1 from public.payroll_obligation_settings where enabled and dispatch_enabled) then return null; end if;
 select max(decrypted_secret) filter(where name='notification_payment_outcome_dispatcher_url'),
 max(decrypted_secret) filter(where name='notification_dispatcher_secret') into endpoint,secret_value
 from vault.decrypted_secrets where name in('notification_payment_outcome_dispatcher_url','notification_dispatcher_secret');
 if endpoint !~ '^https://[a-z0-9]{20}[.]supabase[.]co/functions/v1/notification-dispatcher$' or secret_value is null then return null; end if;
 endpoint:=replace(endpoint,'/notification-dispatcher','/payroll-obligation-notifications');
 select net.http_post(url:=endpoint,body:='{}'::jsonb,
 headers:=jsonb_build_object('Content-Type','application/json','x-notification-dispatcher-secret',secret_value),
 timeout_milliseconds:=2000) into request_id;
 return request_id;
exception when others then raise warning 'OBLIGATION_NOTIFICATION_WAKE_FAILED'; return null;
end; $$;
revoke all on function private.wake_payroll_obligation_notifications() from public,anon,authenticated,service_role;
select cron.schedule('payroll-obligation-notification-recovery','* * * * *','select private.wake_payroll_obligation_notifications();');
commit;
