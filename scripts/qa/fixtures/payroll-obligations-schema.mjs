const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [company,other,rh,finance,outsider,category,center,budgetVersion]=[1,2,3,4,5,6,7,8].map(id);
export const obligationSchemaSQL=`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema private;create schema auth;create schema storage;create schema cron;
 create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
 grant usage on schema public,private,auth,storage to authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.profile',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role',current_setting('request.jwt.claim.role',true))$$;
 create function public.current_profile_id() returns uuid language sql stable as $$select auth.uid()$$;
 create table companies(id uuid primary key,name text,active boolean,rfc text);
 create table profiles(id uuid primary key,active boolean,email text);
 create table test_memberships(profile_id uuid,company_id uuid,role text,active boolean);
 create function public.has_active_company_membership(p uuid,c uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from test_memberships where profile_id=p and company_id=c and active)$$;
 create function private.profile_has_company_role(p uuid,c uuid,r text[]) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from test_memberships where profile_id=p and company_id=c and active and role=any(r))$$;
 create table payroll_capture_grants(profile_id uuid,company_id uuid,active boolean);
 create table cost_centers(id uuid primary key,name text,active boolean);
 create table budget_categories(id uuid primary key,name text,active boolean,no_presupuestal boolean);
 create table company_cost_center_budget_categories(company_id uuid,cost_center_id uuid,budget_category_id uuid,active boolean);
 create table budget_versions(id uuid primary key,active boolean);
 create table budget_lines(id uuid primary key default gen_random_uuid(),company_id uuid,cost_center_id uuid,budget_category_id uuid,budget_version_id uuid,budget_month date,amount numeric);
 create table payment_requests(id uuid primary key default gen_random_uuid(),company_id uuid,cost_center_id uuid,budget_category_id uuid,budget_month date,amount_requested numeric,status text,no_presupuestal boolean default false,budget_decision text default 'aprobable',subtotal_amount numeric,exchange_rate numeric default 1);
 create view public.budget_availability with(security_invoker=true) as select b.company_id,b.cost_center_id,b.budget_category_id,b.budget_month,b.amount budgeted,
 coalesce(sum(r.amount_requested),0) committed,coalesce(sum(r.amount_requested)filter(where r.status='paid'),0) executed,b.amount-coalesce(sum(r.amount_requested),0) available
 from budget_lines b left join payment_requests r using(company_id,cost_center_id,budget_category_id,budget_month) group by b.company_id,b.cost_center_id,b.budget_category_id,b.budget_month,b.amount;
 grant select on budget_availability,budget_lines,payment_requests to authenticated,service_role;
 create function verify_budget_availability(c uuid,cc uuid,bc uuid,m date,a numeric,e boolean,np boolean) returns jsonb language sql set search_path=public as $$
 select jsonb_build_object('status',case when exists(select 1 from company_cost_center_budget_categories where company_id=c and cost_center_id=cc and budget_category_id=bc and active)
 and (select available from budget_availability where company_id=c and cost_center_id=cc and budget_category_id=bc and budget_month=m)>=a then 'aprobable' else 'bloqueado' end)$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant insert on storage.objects to authenticated;
 create table payroll_notification_settings(company_id uuid primary key,finance_recipient_profile_id uuid,app_origin text);
 create table notification_events(id uuid primary key default gen_random_uuid(),event_type text,source_table text,source_id uuid,source_folio text,recipient_type text,recipient_profile_id uuid,recipient_email text,channel text,priority text,payload jsonb,idempotency_key text unique,status text,last_error text,next_attempt_at timestamptz,locked_by text,locked_at timestamptz,last_attempt_at timestamptz,updated_at timestamptz,attempt_count integer default 0,max_attempts integer default 5,created_at timestamptz default now());
 insert into companies values('${company}','A',true,'AAA010101AAA'),('${other}','B',true,'BBB010101BBB');
 insert into profiles values('${rh}',true,'rh@example.com'),('${finance}',true,'finance@example.com'),('${outsider}',true,'other@example.com');
 insert into test_memberships values('${rh}','${company}','operator',true),('${finance}','${company}','finance',true),('${outsider}','${company}','operator',true);
 insert into payroll_capture_grants values('${rh}','${company}',true);
 insert into cost_centers values('${center}','Cost center',true);insert into budget_categories values('${category}','IMSS',true,false);
 insert into company_cost_center_budget_categories values('${company}','${center}','${category}',true);
 insert into budget_versions values('${budgetVersion}',true);insert into budget_lines(company_id,cost_center_id,budget_category_id,budget_version_id,budget_month,amount) values('${company}','${center}','${category}','${budgetVersion}','2026-07-01',1000);
 insert into payroll_notification_settings values('${company}','${finance}','https://flux.example.com');
`;
