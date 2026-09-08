-- Payroll production baseline: captured from the DEV flow validated through PR #574.

-- No prior DEV migrations, unrelated modules, accounting activation or historical backfill.

begin;

set local lock_timeout='5s';

set local statement_timeout='120s';

set local search_path='public','extensions','pg_catalog';

do $preflight$ begin

  if to_regclass('public.payroll_capture_sessions') is not null or to_regclass('public.payroll_channels') is not null then raise exception 'PAYROLL_PROD_BASELINE_ALREADY_PRESENT'; end if;

  if not exists(select 1 from pg_enum where enumtypid='public.payment_request_type'::regtype and enumlabel='nomina') then raise exception 'PAYROLL_PROD_REQUEST_TYPE_REQUIRED'; end if;

  if to_regprocedure('private.profile_has_company_role(uuid,uuid,text[])') is null or to_regprocedure('public.payroll_active_company_access(uuid)') is null then raise exception 'PAYROLL_PROD_COMPANY_AUTH_REQUIRED'; end if;

  if to_regprocedure('public.claim_notification_events_for_dispatcher_v2(integer,text,text[],timestamp with time zone)') is null then raise exception 'PAYROLL_PROD_NOTIFICATION_V2_REQUIRED'; end if;

  if to_regclass('cron.job') is null or to_regclass('vault.decrypted_secrets') is null then raise exception 'PAYROLL_PROD_NOTIFICATION_WAKEUP_REQUIRED'; end if;

  if exists(select 1 from budget_categories where code='PAYROLL_NON_BUDGET') then raise exception 'PAYROLL_PROD_CATEGORY_ALREADY_PRESENT'; end if;

  if (select count(*) from pg_trigger where tgrelid='public.payment_requests'::regclass and (tgname,md5(pg_get_triggerdef(oid))) in (('payment_request_created_notification_event','995c373c7b96dee78458f8d0b93d294d'),('validate_payment_request_approver_scope_insert','d2c6b72bdd58356bcc797087f5eafbee'),('validate_payment_request_approver_scope_update','5ab03b7e7d9bc728f1496fdd6eb8bab2')))<>3 then raise exception 'PAYROLL_PROD_SHARED_TRIGGER_DRIFT'; end if;

end $preflight$;

alter table public.payment_requests add column "payroll_subtype" text;

alter table public.payment_requests add column "payroll_period_start" date;

alter table public.payment_requests add column "payroll_period_end" date;

alter table public.payment_requests add constraint "payment_requests_payroll_contract_check" CHECK (request_type::text = 'nomina'::text AND (payroll_subtype = ANY (ARRAY['ordinaria'::text, 'extraordinaria'::text])) AND payroll_period_start IS NOT NULL AND payroll_period_end IS NOT NULL AND payroll_period_start <= payroll_period_end AND company_id IS NOT NULL AND company_bank_account_id IS NOT NULL AND cost_center_id IS NOT NULL AND provider_id IS NULL AND proveedor_id IS NULL AND provider_bank_account_id IS NULL OR request_type::text <> 'nomina'::text AND payroll_subtype IS NULL AND payroll_period_start IS NULL AND payroll_period_end IS NULL);

alter table public.payment_requests add constraint "payment_requests_payroll_draft_no_submission_check" CHECK (request_type::text <> 'nomina'::text OR status::text <> 'draft'::text OR approver_id IS NULL AND approver_assignment_id IS NULL AND approver_selection_source IS NULL AND submitted_at IS NULL AND approved_by IS NULL AND approved_at IS NULL);

alter table public.payment_requests add constraint "payment_requests_payroll_submission_snapshot_check" CHECK (request_type::text <> 'nomina'::text OR status::text = 'draft'::text OR approver_id IS NOT NULL AND (approver_selection_source = ANY (ARRAY['assigned'::text, 'approval_rules'::text])) AND submitted_at IS NOT NULL OR no_presupuestal IS TRUE AND (status::text = ANY (ARRAY['approved'::text, 'finance_validation'::text, 'scheduled'::text, 'paid'::text])) AND approver_id IS NULL AND approver_assignment_id IS NULL AND approver_selection_source IS NULL AND submitted_at IS NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL);

create table public."payroll_capture_files" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "kind" text not null,
  "channel" text,
  "storage_bucket" text default 'payroll-private'::text not null,
  "storage_path" text not null,
  "extension" text not null,
  "mime_type" text not null,
  "size_bytes" bigint not null,
  "sha256" text not null,
  "upload_state" text default 'reserved'::text not null,
  "capability_code" text not null,
  "parsing_status" text not null,
  "validation_authority" text not null,
  "parser_version" text,
  "parser_contract" text,
  "record_count" integer,
  "total_amount_minor" bigint,
  "issue_codes" text[] default ARRAY[]::text[] not null,
  "is_current" boolean default false not null,
  "reserved_by" uuid not null,
  "uploaded_by" uuid,
  "reserved_at" timestamp with time zone default now() not null,
  "uploaded_at" timestamp with time zone,
  "updated_at" timestamp with time zone default now() not null
);

alter table public."payroll_capture_files" enable row level security;

create table public."payroll_capture_grants" (
  "profile_id" uuid not null,
  "company_id" uuid not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);

alter table public."payroll_capture_grants" enable row level security;

create table public."payroll_capture_sessions" (
  "id" uuid default gen_random_uuid() not null,
  "reserved_payment_request_id" uuid default gen_random_uuid() not null,
  "company_id" uuid not null,
  "company_bank_account_id" uuid not null,
  "payroll_subtype" text not null,
  "period_start" date not null,
  "period_end" date not null,
  "concept" text not null,
  "notes" text,
  "expected_channels" text[] not null,
  "capture_state" text default 'draft'::text not null,
  "validation_status" text default 'incomplete'::text not null,
  "version" integer default 1 not null,
  "created_by" uuid not null,
  "updated_by" uuid not null,
  "expires_at" timestamp with time zone default (now() + '30 days'::interval) not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "cost_center_id" uuid,
  "budget_category_id" uuid,
  "budget_month" date,
  "materialized_payment_request_id" uuid,
  "materialized_at" timestamp with time zone,
  "materialized_by" uuid,
  "materialization_idempotency_hash" text,
  "server_verification_summary" jsonb
);

alter table public."payroll_capture_sessions" enable row level security;

create table public."payroll_channels" (
  "id" uuid default gen_random_uuid() not null,
  "payment_request_id" uuid not null,
  "channel" text not null,
  "amount" numeric(14,2) not null,
  "currency" text default 'MXN'::text not null,
  "layout_file_id" uuid,
  "dispersion_status" text default 'pending'::text not null,
  "dispersed_at" timestamp with time zone,
  "dispersed_by" uuid,
  "dispersion_note" text,
  "reconciliation_status" text default 'pending'::text not null,
  "reconciled_at" timestamp with time zone,
  "reconciled_by" uuid,
  "reconciliation_note" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "benefit_amount" numeric,
  "fee_amount" numeric,
  "tax_amount" numeric,
  "expected_funding_amount" numeric,
  "funding_variance_acknowledged_at" timestamp with time zone,
  "funding_variance_acknowledged_by" uuid,
  "funding_variance_note" text,
  "receipt_file_id" uuid,
  "receipt_amount" numeric,
  "receipt_payment_date" date,
  "receipt_reference_hint" text
);

alter table public."payroll_channels" enable row level security;

create table public."payroll_notification_settings" (
  "company_id" uuid not null,
  "finance_recipient_profile_id" uuid,
  "dispatch_enabled" boolean default false not null,
  "app_origin" text not null,
  "created_at" timestamp with time zone default now() not null,
  "test_capture_session_id" uuid,
  "test_recipient_profile_id" uuid,
  "test_expires_at" timestamp with time zone
);

alter table public."payroll_notification_settings" enable row level security;

create table public."payroll_provision_entries" (
  "payment_request_id" uuid not null,
  "company_id" uuid not null,
  "cost_center_id" uuid not null,
  "budget_version_id" uuid not null,
  "budget_category_id" uuid not null,
  "budget_line_id" uuid not null,
  "provision_month" date not null,
  "provision_base_amount" numeric(18,2) not null,
  "calculation_policy" text not null,
  "policy_version" text not null,
  "aguinaldo_factor" numeric(12,8) not null,
  "vacation_premium_factor" numeric(12,8) not null,
  "combined_factor" numeric(12,8) not null,
  "aguinaldo_amount" numeric(18,2) not null,
  "vacation_premium_amount" numeric(18,2) not null,
  "provision_amount" numeric(18,2) not null,
  "budget_line_amount_before" numeric(18,2) not null,
  "budget_line_amount_after" numeric(18,2) not null,
  "created_at" timestamp with time zone default now() not null,
  "created_by" uuid
);

alter table public."payroll_provision_entries" enable row level security;

create table public."payroll_provision_settings" (
  "company_id" uuid not null,
  "calculation_policy" text default 'pending'::text not null,
  "configured_aguinaldo_factor" numeric(12,8),
  "configured_vacation_premium_factor" numeric(12,8),
  "budget_category_id" uuid not null,
  "posting_month_rule" text default 'period_end_month'::text not null,
  "active" boolean default true not null,
  "updated_by" uuid,
  "updated_at" timestamp with time zone default now() not null
);

alter table public."payroll_provision_settings" enable row level security;

create table public."payroll_run_files" (
  "id" uuid default gen_random_uuid() not null,
  "payment_request_id" uuid not null,
  "payroll_channel_id" uuid,
  "kind" text not null,
  "storage_bucket" text default 'payroll-private'::text not null,
  "storage_path" text not null,
  "original_filename" text not null,
  "mime_type" text not null,
  "size_bytes" bigint not null,
  "sha256" text not null,
  "uploaded_by" uuid not null,
  "uploaded_at" timestamp with time zone default now() not null,
  "parsing_status" text default 'not_started'::text not null,
  "parsing_version" text,
  "parsing_metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "capture_file_id" uuid
);

alter table public."payroll_run_files" enable row level security;

create table public."payroll_run_lines" (
  "id" uuid default gen_random_uuid() not null,
  "payment_request_id" uuid not null,
  "source_file_id" uuid not null,
  "source_sheet" text not null,
  "source_row_number" integer not null,
  "extraction_version" text not null,
  "employee_name" text not null,
  "rfc" text,
  "curp" text,
  "nss" text,
  "bank_name" text,
  "bank_account" text,
  "clabe" text,
  "net_amount" numeric(14,2) not null,
  "bank_amount" numeric(14,2) default 0 not null,
  "spei_amount" numeric(14,2) default 0 not null,
  "vouchers_amount" numeric(14,2) default 0 not null,
  "reconciliation_state" text default 'pending'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

alter table public."payroll_run_lines" enable row level security;

alter table public."payroll_capture_files" add constraint "payroll_capture_files_pkey" PRIMARY KEY (id);

alter table public."payroll_capture_grants" add constraint "payroll_capture_grants_pkey" PRIMARY KEY (profile_id, company_id);

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_pkey" PRIMARY KEY (id);

alter table public."payroll_channels" add constraint "payroll_channels_pkey" PRIMARY KEY (id);

alter table public."payroll_notification_settings" add constraint "payroll_notification_settings_pkey" PRIMARY KEY (company_id);

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_pkey" PRIMARY KEY (payment_request_id);

alter table public."payroll_provision_settings" add constraint "payroll_provision_settings_pkey" PRIMARY KEY (company_id);

alter table public."payroll_run_files" add constraint "payroll_run_files_pkey" PRIMARY KEY (id);

alter table public."payroll_run_lines" add constraint "payroll_run_lines_pkey" PRIMARY KEY (id);

alter table public."payroll_capture_files" add constraint "payroll_capture_files_storage_path_key" UNIQUE (storage_path);

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_materialized_payment_request_id_key" UNIQUE (materialized_payment_request_id);

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_reserved_payment_request_id_key" UNIQUE (reserved_payment_request_id);

alter table public."payroll_channels" add constraint "payroll_channels_request_channel_key" UNIQUE (payment_request_id, channel);

alter table public."payroll_run_files" add constraint "payroll_run_files_capture_file_id_key" UNIQUE (capture_file_id);

alter table public."payroll_run_files" add constraint "payroll_run_files_storage_path_key" UNIQUE (storage_path);

alter table public."payroll_run_lines" add constraint "payroll_run_lines_source_row_key" UNIQUE (payment_request_id, source_file_id, source_row_number);

CREATE OR REPLACE FUNCTION public.payroll_request_has_valid_materialization(p_payment_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.payroll_capture_sessions s
    where s.materialized_payment_request_id = p_payment_request_id
      and s.capture_state = 'materialized'
      and s.validation_status = 'valid'
      and s.materialized_at is not null
      and s.materialized_by is not null
      and s.server_verification_summary is not null
  );
$function$;

revoke all on function "public"."payroll_request_has_valid_materialization"(p_payment_request_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_request_has_valid_materialization"(p_payment_request_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION private.payroll_profile_can_capture(p_profile_id uuid, p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.profiles p where p.id=p_profile_id and p.active)
    and (
      private.profile_has_company_role(p_profile_id,p_company_id,array['finance']::text[])
      or (
        public.has_active_company_membership(p_profile_id,p_company_id)
        and exists (select 1 from public.payroll_capture_grants g
          where g.profile_id=p_profile_id and g.company_id=p_company_id and g.active)
      )
    );
$function$;

revoke all on function "private"."payroll_profile_can_capture"(p_profile_id uuid, p_company_id uuid) from PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.enqueue_payroll_lifecycle(p_request_id uuid, p_event_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

revoke all on function "private"."enqueue_payroll_lifecycle"(p_request_id uuid, p_event_type text) from PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.payroll_paid_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin perform private.enqueue_payroll_lifecycle(new.id,'payroll.paid'); return new; end; $function$;

revoke all on function "private"."payroll_paid_notification"() from PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.payroll_registered_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin perform private.enqueue_payroll_lifecycle(new.materialized_payment_request_id,'payroll.registered'); return new; end; $function$;

revoke all on function "private"."payroll_registered_notification"() from PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.wake_payroll_notifications()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

revoke all on function "private"."wake_payroll_notifications"() from PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.payroll_has_finance_pii_access()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.current_profile_id() is not null
    and public.current_user_has_role(array[
      'finance',
      'finanzas',
      'treasury',
      'tesoreria',
      'administracion'
    ]::text[]);
$function$;

revoke all on function "public"."payroll_has_finance_pii_access"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_has_finance_pii_access"() to "authenticated";

grant EXECUTE on function "public"."payroll_has_finance_pii_access"() to "service_role";

CREATE OR REPLACE FUNCTION public.acknowledge_payroll_toka_funding_variance(p_payment_request_id uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_channel public.payroll_channels%rowtype;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.status::text<>'draft'
     or not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_TOKA_VARIANCE_REVIEW_NOT_ALLOWED'; end if;
  select * into v_channel from public.payroll_channels where payment_request_id=v_request.id and channel='vales' for update;
  if not found then raise exception 'PAYROLL_TOKA_CHANNEL_REQUIRED'; end if;
  if v_channel.amount is not distinct from v_channel.expected_funding_amount then return jsonb_build_object('status','no_variance','payment_request_id',v_request.id); end if;
  if v_channel.funding_variance_acknowledged_at is not null then return jsonb_build_object('status','already_acknowledged','payment_request_id',v_request.id); end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null or char_length(btrim(p_note))>500 then raise exception 'PAYROLL_TOKA_VARIANCE_NOTE_REQUIRED'; end if;
  update public.payroll_channels set funding_variance_acknowledged_at=now(),funding_variance_acknowledged_by=v_actor,
    funding_variance_note=btrim(p_note),updated_at=now() where id=v_channel.id;
  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values('payroll_toka_variance',v_request.id,'acknowledge_funding_variance',null,
    jsonb_build_object('redacted',true,'operation','toka_funding_variance_acknowledged'),v_actor,
    'Funding variance acknowledgement excludes employee and bank values.');
  return jsonb_build_object('status','acknowledged','payment_request_id',v_request.id);
end;
$function$;

revoke all on function "public"."acknowledge_payroll_toka_funding_variance"(p_payment_request_id uuid, p_note text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."acknowledge_payroll_toka_funding_variance"(p_payment_request_id uuid, p_note text) to "authenticated";

grant EXECUTE on function "public"."acknowledge_payroll_toka_funding_variance"(p_payment_request_id uuid, p_note text) to "service_role";

CREATE OR REPLACE FUNCTION public.claim_payroll_notifications(p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

revoke all on function "public"."claim_payroll_notifications"(p_worker_id text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."claim_payroll_notifications"(p_worker_id text) to "service_role";

CREATE OR REPLACE FUNCTION public.close_payroll_as_paid(p_payment_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_count integer; v_ready integer;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_PAID_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if v_request.status::text='paid' then return jsonb_build_object('status','already_paid','payment_request_id',v_request.id,'paid_at',v_request.paid_at); end if;
  if v_request.status::text<>'approved' then raise exception 'PAYROLL_PAID_REQUIRES_APPROVED_REQUEST'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_PAID_MATERIALIZATION_REQUIRED'; end if;
  select count(*)::integer,count(*) filter(where channel.dispersion_status='dispersed' and channel.reconciliation_status='reconciled' and channel.receipt_file_id is not null and file.id is not null and file.parsing_status='parsed' and file.parsing_version='payroll-channel-receipt-v1')::integer into v_count,v_ready
  from public.payroll_channels channel left join public.payroll_run_files file on file.id=channel.receipt_file_id where channel.payment_request_id=v_request.id;
  if v_count=0 or v_ready<>v_count then raise exception 'PAYROLL_PAID_RECONCILIATION_REQUIRED'; end if;
  perform set_config('app.payroll_n4b_close_request',v_request.id::text,true);
  update public.payment_requests set status='paid'::public.payment_request_status,paid_at=now(),paid_by=v_actor,updated_at=now() where id=v_request.id;
  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes) values('payroll_reconciliation',v_request.id,'close_paid',null,jsonb_build_object('redacted',true,'operation','payroll_close_paid'),v_actor,'Payroll paid close stores no employee, bank-account or receipt-reference values in audit.');
  return jsonb_build_object('status','paid','payment_request_id',v_request.id,'paid_at',(select paid_at from public.payment_requests where id=v_request.id));
end; $function$;

revoke all on function "public"."close_payroll_as_paid"(p_payment_request_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."close_payroll_as_paid"(p_payment_request_id uuid) to "authenticated";

grant EXECUTE on function "public"."close_payroll_as_paid"(p_payment_request_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_capture_company_access(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select private.payroll_profile_can_capture(public.current_profile_id(),p_company_id); $function$;

revoke all on function "public"."payroll_capture_company_access"(p_company_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_capture_company_access"(p_company_id uuid) to "authenticated";

grant EXECUTE on function "public"."payroll_capture_company_access"(p_company_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_has_capture_access()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.companies c
    where public.payroll_capture_company_access(c.id));
$function$;

revoke all on function "public"."payroll_has_capture_access"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_has_capture_access"() to "authenticated";

grant EXECUTE on function "public"."payroll_has_capture_access"() to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_capture_refresh_state(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_session public.payroll_capture_sessions%rowtype; v_missing boolean;
begin
  select * into v_session from public.payroll_capture_sessions where id=p_session_id for update;
  if not found then raise exception 'payroll_capture_session_not_found'; end if;
  v_missing:=not exists(select 1 from public.payroll_capture_files f where f.session_id=v_session.id and f.kind='caratula' and f.upload_state='uploaded' and f.is_current)
    or ('banco'=any(v_session.expected_channels) and not exists(select 1 from public.payroll_capture_files f where f.session_id=v_session.id and f.kind='layout_mismo_banco' and f.upload_state='uploaded' and f.is_current))
    or ('spei'=any(v_session.expected_channels) and not exists(select 1 from public.payroll_capture_files f where f.session_id=v_session.id and f.kind='layout_spei' and f.upload_state='uploaded' and f.is_current))
    or ('vales'=any(v_session.expected_channels) and (
      not exists(select 1 from public.payroll_capture_files f where f.session_id=v_session.id and f.kind='layout_toka' and f.upload_state='uploaded' and f.is_current)
      or not exists(select 1 from public.payroll_capture_files f where f.session_id=v_session.id and f.kind='cfdi_vales' and f.upload_state='uploaded' and f.is_current)
    ));
  update public.payroll_capture_sessions set capture_state=case when v_missing then 'files_pending' else 'validation_pending' end,
    validation_status=case when v_missing then 'incomplete' else 'blocked' end,updated_at=now() where id=v_session.id;
end;
$function$;

revoke all on function "public"."payroll_capture_refresh_state"(p_session_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_capture_refresh_state"(p_session_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.confirm_payroll_capture_file_unscoped_internal(p_file_id uuid, p_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_file public.payroll_capture_files%rowtype;
  v_session public.payroll_capture_sessions%rowtype;
  v_object storage.objects%rowtype;
begin
  if v_actor is null or not public.payroll_has_capture_access() then
    raise exception 'payroll_capture_finance_required';
  end if;

  select * into v_file
  from public.payroll_capture_files
  where id = p_file_id
  for update;

  if not found or v_file.upload_state <> 'reserved' then
    raise exception 'payroll_capture_file_reservation_not_found';
  end if;
  if p_sha256 is distinct from v_file.sha256 then
    raise exception 'payroll_capture_file_hash_mismatch';
  end if;

  select * into v_session
  from public.payroll_capture_sessions
  where id = v_file.session_id
  for update;

  if not found or v_session.expires_at <= now() then
    raise exception 'payroll_capture_session_expired';
  end if;

  select * into v_object
  from storage.objects object
  where object.bucket_id = v_file.storage_bucket
    and object.name = v_file.storage_path;

  if not found
     or coalesce((v_object.metadata ->> 'size')::bigint, -1) <> v_file.size_bytes
     or coalesce(v_object.metadata ->> 'mimetype', '') <> v_file.mime_type then
    raise exception 'payroll_capture_storage_object_mismatch';
  end if;

  update public.payroll_capture_files
  set is_current = false,
      updated_at = now()
  where session_id = v_file.session_id
    and kind = v_file.kind
    and is_current;

  update public.payroll_capture_files
  set upload_state = 'uploaded',
      is_current = true,
      uploaded_by = v_actor,
      uploaded_at = now(),
      updated_at = now()
  where id = v_file.id;

  update public.payroll_capture_sessions
  set updated_by = v_actor,
      version = version + 1,
      updated_at = now()
  where id = v_session.id;

  perform public.payroll_capture_refresh_state(v_session.id);

  return (
    select jsonb_build_object(
      'session_id', session.id,
      'capture_state', session.capture_state,
      'validation_status', session.validation_status,
      'version', session.version
    )
    from public.payroll_capture_sessions session
    where session.id = v_session.id
  );
end;
$function$;

revoke all on function "public"."confirm_payroll_capture_file_unscoped_internal"(p_file_id uuid, p_sha256 text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."confirm_payroll_capture_file_unscoped_internal"(p_file_id uuid, p_sha256 text) to "service_role";

CREATE OR REPLACE FUNCTION public.confirm_payroll_capture_file(p_file_id uuid, p_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company_id uuid;
begin
  select session.company_id into v_company_id
  from public.payroll_capture_files file
  join public.payroll_capture_sessions session on session.id = file.session_id
  where file.id = p_file_id;

  if v_company_id is null then
    raise exception 'PAYROLL_CAPTURE_FILE_RESERVATION_NOT_FOUND';
  end if;
  if not public.payroll_capture_company_access(v_company_id) then
    raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
  end if;

  return public.confirm_payroll_capture_file_unscoped_internal(p_file_id, p_sha256);
end;
$function$;

revoke all on function "public"."confirm_payroll_capture_file"(p_file_id uuid, p_sha256 text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."confirm_payroll_capture_file"(p_file_id uuid, p_sha256 text) to "authenticated";

grant EXECUTE on function "public"."confirm_payroll_capture_file"(p_file_id uuid, p_sha256 text) to "service_role";

CREATE OR REPLACE FUNCTION public.confirm_payroll_channel_receipt_internal(p_run_file_id uuid, p_sha256 text, p_size_bytes bigint, p_mime_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_file public.payroll_run_files%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'PAYROLL_RECEIPT_SERVICE_ROLE_REQUIRED'; end if;
  select * into v_file from public.payroll_run_files where id=p_run_file_id for update;
  if not found or v_file.kind<>'comprobante' then raise exception 'PAYROLL_RECEIPT_FILE_REQUIRED'; end if;
  if v_file.parsing_status='parsed' and v_file.parsing_version='payroll-channel-receipt-v1' then
    if v_file.sha256=lower(p_sha256) and v_file.size_bytes=p_size_bytes and v_file.mime_type=lower(p_mime_type) then return jsonb_build_object('status','already_verified','run_file_id',v_file.id); end if;
    raise exception 'PAYROLL_RECEIPT_VERIFICATION_MISMATCH';
  end if;
  if v_file.parsing_status<>'pending' or v_file.sha256<>lower(coalesce(p_sha256,'')) or v_file.size_bytes<>p_size_bytes or v_file.mime_type<>lower(coalesce(p_mime_type,'')) or v_file.mime_type<>'application/pdf' then raise exception 'PAYROLL_RECEIPT_VERIFICATION_MISMATCH'; end if;
  update public.payroll_run_files set parsing_status='parsed',parsing_version='payroll-channel-receipt-v1',parsing_metadata=jsonb_build_object('evidence_class','payroll_channel_receipt','parser_version','payroll-channel-receipt-v1'),updated_at=now() where id=v_file.id;
  return jsonb_build_object('status','verified','run_file_id',v_file.id);
end; $function$;

revoke all on function "public"."confirm_payroll_channel_receipt_internal"(p_run_file_id uuid, p_sha256 text, p_size_bytes bigint, p_mime_type text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."confirm_payroll_channel_receipt_internal"(p_run_file_id uuid, p_sha256 text, p_size_bytes bigint, p_mime_type text) to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_ready_for_dispersion(p_payment_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists(
    select 1 from public.payment_requests request
    where request.id=p_payment_request_id and request.request_type::text='nomina'
      and request.status::text='approved' and request.approved_by is not null and request.approved_at is not null
      and public.payroll_request_has_valid_materialization(request.id)
      and not exists(
        select 1 from public.payroll_channels channel
        where channel.payment_request_id=request.id and channel.channel='vales'
          and channel.amount is distinct from channel.expected_funding_amount
          and channel.funding_variance_acknowledged_at is null
      )
  );
$function$;

revoke all on function "public"."payroll_ready_for_dispersion"(p_payment_request_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_ready_for_dispersion"(p_payment_request_id uuid) to "authenticated";

grant EXECUTE on function "public"."payroll_ready_for_dispersion"(p_payment_request_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.confirm_payroll_finance_review(p_payment_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_category_code text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_FINANCE_CONFIRM_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if v_request.status::text='approved' and v_request.approver_id is null and v_request.approved_by is not null then
    return jsonb_build_object('status','already_confirmed','payment_request_id',v_request.id,'request_number',v_request.request_number,'payment_ready',public.payroll_ready_for_dispersion(v_request.id),'payment_flow_state','ready_for_payment','ready_for_dispersion',public.payroll_ready_for_dispersion(v_request.id));
  end if;
  if v_request.status::text<>'draft' then raise exception 'PAYROLL_FINANCE_CONFIRM_REQUIRES_DRAFT'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_VALID_MATERIALIZATION_REQUIRED'; end if;
  select code into v_category_code from public.budget_categories where id=v_request.budget_category_id;
  if not v_request.no_presupuestal or v_category_code is distinct from 'PAYROLL_NON_BUDGET' then raise exception 'PAYROLL_NON_BUDGET_CONTEXT_REQUIRED'; end if;
  if v_request.approver_id is not null or v_request.approver_assignment_id is not null or v_request.approver_selection_source is not null or v_request.submitted_at is not null then raise exception 'PAYROLL_APPROVER_NOT_ALLOWED'; end if;
  if exists(select 1 from public.payroll_channels channel where channel.payment_request_id=v_request.id and channel.channel='vales' and channel.amount is distinct from channel.expected_funding_amount and channel.funding_variance_acknowledged_at is null) then raise exception 'PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED'; end if;
  perform set_config('app.payroll_finance_confirm',v_request.id::text,true);
  update public.payment_requests set status='approved',approved_by=v_actor,approved_at=now() where id=v_request.id;
  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values('payroll_finance_review',v_request.id,'confirm_amounts',jsonb_build_object('status','draft'),jsonb_build_object('status','approved','non_budget',true,'payment_flow_state','ready_for_payment','payment_execution',false),v_actor,'Finanzas confirmó los montos. La corrida quedó lista para su flujo propio de pago; no se envió a corte semanal y Flux no ejecutó pagos.');
  return jsonb_build_object('status','confirmed','payment_request_id',v_request.id,'request_number',v_request.request_number,'payment_ready',true,'payment_flow_state','ready_for_payment','ready_for_dispersion',true);
end; $function$;

revoke all on function "public"."confirm_payroll_finance_review"(p_payment_request_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."confirm_payroll_finance_review"(p_payment_request_id uuid) to "authenticated";

grant EXECUTE on function "public"."confirm_payroll_finance_review"(p_payment_request_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.enqueue_payroll_submission_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile public.profiles%rowtype;
  v_role_name text;
  v_status text := 'pending';
  v_last_error text;
  v_payload jsonb;
begin
  select * into v_profile
  from public.profiles
  where id = new.approver_id and coalesce(active, true);

  if not found then
    v_status := 'dead_letter';
    v_last_error := 'approver_profile_not_found';
  elsif not public.is_payment_request_approver_for_company(new.approver_id, new.company_id) then
    v_status := 'dead_letter';
    v_last_error := 'approver_not_eligible_for_company';
  elsif nullif(btrim(coalesce(v_profile.email, '')), '') is null then
    v_status := 'dead_letter';
    v_last_error := 'recipient_email_missing';
  end if;

  select lower(trim(r.name)) into v_role_name
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.profile_id = new.approver_id
    and lower(trim(r.name)) = any (public.payment_request_approver_role_names())
  order by lower(trim(r.name))
  limit 1;

  v_payload := public.notification_payment_request_payload_with_extra(
    new.id,
    jsonb_build_object(
      'approver', coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email),
      'approver_profile_id', new.approver_id,
      'submission_source', 'payroll_n3b'
    )
  );

  insert into public.notification_events (
    event_type, source_table, source_id, source_folio, recipient_type,
    recipient_profile_id, recipient_email, recipient_role, channel, priority,
    subject, payload, idempotency_key, status, last_error, next_attempt_at
  ) values (
    'payment_request.created', 'payment_requests', new.id, new.request_number,
    'administrador_sistema',
    case when v_profile.id is not null then v_profile.id else null end,
    case when v_status = 'pending' then nullif(btrim(v_profile.email), '') else null end,
    v_role_name, 'email', 'normal',
    'Nueva solicitud de pago: ' || coalesce(new.request_number, new.id::text),
    v_payload,
    'payment_request.created:' || new.id::text || ':approver',
    v_status, v_last_error,
    case when v_status = 'pending' then now() else null end
  )
  on conflict (idempotency_key) do nothing;

  return new;
exception
  when others then
    insert into public.notification_events (
      event_type, source_table, source_id, source_folio, recipient_type,
      channel, priority, subject, payload, idempotency_key, status, last_error
    ) values (
      'payment_request.created', 'payment_requests', new.id, new.request_number,
      'administrador_sistema', 'email', 'normal',
      'Nueva solicitud de pago: ' || coalesce(new.request_number, new.id::text),
      jsonb_build_object('folio', new.request_number, 'path', '/solicitudes.html'),
      'payment_request.created:' || new.id::text || ':enqueue-error',
      'dead_letter', 'created_notification_enqueue_failed'
    )
    on conflict (idempotency_key) do nothing;
    return new;
end;
$function$;

revoke all on function "public"."enqueue_payroll_submission_notification"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."enqueue_payroll_submission_notification"() to "service_role";

CREATE OR REPLACE FUNCTION public.get_my_payroll_access(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'can_capture',public.payroll_capture_company_access(p_company_id),
    'can_pay',public.payroll_has_finance_pii_access() and public.payroll_active_company_access(p_company_id)
  );
$function$;

revoke all on function "public"."get_my_payroll_access"(p_company_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."get_my_payroll_access"(p_company_id uuid) to "authenticated";

grant EXECUTE on function "public"."get_my_payroll_access"(p_company_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.get_payroll_capture_context(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.payroll_capture_company_access(p_company_id) then
    raise exception 'PAYROLL_CAPTURE_ACCESS_REQUIRED';
  end if;
  return jsonb_build_object(
    'accounts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'company_id',a.company_id,'name',a.name,'bank_name',a.bank_name,
      'currency',a.currency,'account_type',a.account_type,'last4',a.last4,
      'account_number',a.account_number,'clabe',a.clabe,'active',a.active) order by a.name)
      from public.company_bank_accounts a where a.company_id=p_company_id and a.active
        and a.account_type::text='bank' and upper(a.currency) in ('MXN','MXP')),'[]'::jsonb),
    'costCenters',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'code',c.code,'active',c.active) order by c.name)
      from public.cost_centers c where c.active and exists (select 1 from public.company_cost_centers m
        where m.cost_center_id=c.id and m.company_id=p_company_id and m.active)),'[]'::jsonb),
    'mappings',coalesce((select jsonb_agg(jsonb_build_object('company_id',m.company_id,'cost_center_id',m.cost_center_id,'active',m.active))
      from public.company_cost_centers m where m.company_id=p_company_id and m.active),'[]'::jsonb)
  );
end;
$function$;

revoke all on function "public"."get_payroll_capture_context"(p_company_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."get_payroll_capture_context"(p_company_id uuid) to "authenticated";

grant EXECUTE on function "public"."get_payroll_capture_context"(p_company_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.get_payroll_capture_file_url(p_file_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
  v_file record;
begin
  if p_file_id is null then
    raise exception 'PAYROLL_CAPTURE_FILE_ID_REQUIRED';
  end if;

  select
    f.id,
    f.kind,
    f.storage_bucket,
    f.storage_path,
    f.extension,
    f.upload_state,
    f.is_current,
    s.id as session_id,
    s.company_id,
    s.capture_state,
    s.expires_at
  into v_file
  from public.payroll_capture_files f
  join public.payroll_capture_sessions s on s.id = f.session_id
  where f.id = p_file_id
    and f.upload_state = 'uploaded'
    and f.is_current;

  if not found then
    raise exception 'PAYROLL_CAPTURE_FILE_NOT_FOUND';
  end if;

  if not v_is_service then
    if v_actor is null or not public.payroll_has_capture_access() then
      raise exception 'PAYROLL_CAPTURE_FINANCE_REQUIRED';
    end if;

    if not public.payroll_capture_company_access(v_file.company_id) then
      raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
    end if;

    if not (
      (v_file.expires_at > now() and v_file.capture_state <> 'materialized')
      or
      (
        v_file.capture_state = 'materialized'
        and exists (
          select 1
          from public.payroll_run_files rf
          where rf.capture_file_id = v_file.id
        )
      )
    ) then
      raise exception 'PAYROLL_CAPTURE_FILE_NOT_DOWNLOADABLE';
    end if;
  end if;

  if v_file.storage_bucket <> 'payroll-private' then
    raise exception 'PAYROLL_CAPTURE_FILE_SCOPE_MISMATCH';
  end if;

  if v_file.storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$' then
    raise exception 'PAYROLL_CAPTURE_FILE_SCOPE_MISMATCH';
  end if;

  return jsonb_build_object(
    'file_id', v_file.id,
    'storage_bucket', v_file.storage_bucket,
    'storage_path', v_file.storage_path,
    'download_name', v_file.kind || '.' || v_file.extension
  );
end;
$function$;

revoke all on function "public"."get_payroll_capture_file_url"(p_file_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."get_payroll_capture_file_url"(p_file_id uuid) to "authenticated";

grant EXECUTE on function "public"."get_payroll_capture_file_url"(p_file_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.get_payroll_capture_sessions_unscoped_internal(p_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if public.current_profile_id() is null or not public.payroll_has_capture_access() then
    raise exception 'payroll_capture_finance_required';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', session.id,
      'company_id', session.company_id,
      'company_bank_account_id', session.company_bank_account_id,
      'cost_center_id', session.cost_center_id,
      'budget_category_id', session.budget_category_id,
      'budget_month', session.budget_month,
      'payroll_subtype', session.payroll_subtype,
      'period_start', session.period_start,
      'period_end', session.period_end,
      'concept', session.concept,
      'notes', session.notes,
      'expected_channels', session.expected_channels,
      'capture_state', session.capture_state,
      'validation_status', session.validation_status,
      'version', session.version,
      'expires_at', session.expires_at,
      'updated_at', session.updated_at,
      'materialized_payment_request_id', session.materialized_payment_request_id,
      'materialized_at', session.materialized_at,
      'server_verification_summary', session.server_verification_summary,
      'payment_request_number', request.request_number,
      'payment_request_status', request.status::text,
      'finance_confirmation_pending', coalesce(
        request.request_type::text = 'nomina' and request.status::text = 'draft'
        and request.no_presupuestal and request.approver_id is null and request.submitted_at is null, false),
      'payment_ready', case when request.id is null then false else public.payroll_ready_for_dispersion(request.id) end,
      'payment_flow_state', case
        when request.id is null then null
        when request.status::text = 'draft' and request.no_presupuestal and request.approver_id is null then 'pending_finance_confirmation'
        when public.payroll_ready_for_dispersion(request.id) then 'ready_for_payment'
        when request.status::text = 'approved' then 'payment_blocked'
        else request.status::text end,
      'files', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', file.id,
          'kind', file.kind,
          'channel', file.channel,
          'capability_code', file.capability_code,
          'parsing_status', file.parsing_status,
          'validation_authority', file.validation_authority,
          'parser_version', file.parser_version,
          'parser_contract', file.parser_contract,
          'record_count', case
            when session.materialized_payment_request_id is null then file.record_count
            when verified.parsing_metadata->>'row_count' ~ '^[0-9]{1,9}$'
              then (verified.parsing_metadata->>'row_count')::integer
            else null end,
          'total_amount_minor', case
            when session.materialized_payment_request_id is null then file.total_amount_minor
            when verified.id is not null then round(100 * case file.kind
              when 'caratula' then cover.net_amount
              when 'cfdi_vales' then channel.benefit_amount
              when 'layout_mismo_banco' then channel.amount
              when 'layout_spei' then channel.amount
              when 'layout_toka' then channel.amount
              else null end)::bigint
            else null end,
          'issue_codes', file.issue_codes,
          'uploaded_at', file.uploaded_at
        ) order by file.uploaded_at desc)
        from public.payroll_capture_files file
        left join public.payroll_run_files verified
          on session.capture_state = 'materialized'
          and verified.capture_file_id = file.id
          and verified.payment_request_id = request.id
          and verified.kind = file.kind
          and verified.sha256 = file.sha256
          and verified.parsing_status = 'parsed'
          and verified.parsing_metadata->>'evidence_class' = 'SERVER_VERIFIED'
        left join public.payroll_channels channel
          on channel.id = verified.payroll_channel_id
          and channel.payment_request_id = request.id
          and channel.channel = file.channel
        left join lateral (
          select sum(line.net_amount) as net_amount
          from public.payroll_run_lines line
          where file.kind = 'caratula'
            and line.payment_request_id = request.id
            and line.source_file_id = verified.id
        ) cover on true
        where file.session_id = session.id
          and file.upload_state = 'uploaded'
          and file.is_current
      ), '[]'::jsonb)
    ) order by session.updated_at desc)
    from (
      select * from public.payroll_capture_sessions
      where (p_session_id is null or id = p_session_id)
        and (expires_at > now() or (capture_state = 'materialized' and materialized_payment_request_id is not null))
        and public.payroll_capture_company_access(company_id)
      order by updated_at desc
      limit 50
    ) session
    left join public.payment_requests request
      on request.id = session.materialized_payment_request_id
      and request.company_id = session.company_id
      and request.request_type::text = 'nomina'
  ), '[]'::jsonb);
end;
$function$;

revoke all on function "public"."get_payroll_capture_sessions_unscoped_internal"(p_session_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."get_payroll_capture_sessions_unscoped_internal"(p_session_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.get_payroll_capture_sessions(p_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_unscoped jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' then
    return public.get_payroll_capture_sessions_unscoped_internal(p_session_id);
  end if;

  if v_actor is null or not public.payroll_has_capture_access() then
    raise exception 'PAYROLL_CAPTURE_FINANCE_REQUIRED';
  end if;

  v_unscoped := public.get_payroll_capture_sessions_unscoped_internal(p_session_id);

  return coalesce((
    select jsonb_agg(item)
    from jsonb_array_elements(v_unscoped) item
    where public.payroll_capture_company_access((item ->> 'company_id')::uuid)
  ), '[]'::jsonb);
end;
$function$;

revoke all on function "public"."get_payroll_capture_sessions"(p_session_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."get_payroll_capture_sessions"(p_session_id uuid) to "authenticated";

grant EXECUTE on function "public"."get_payroll_capture_sessions"(p_session_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_can_read_summary(p_payment_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.payroll_has_finance_pii_access()
    or exists (
      select 1
      from public.payment_requests request
      where request.id = p_payment_request_id
        and request.request_type::text = 'nomina'
        and (
          request.requested_by = public.current_profile_id()
          or request.approver_id = public.current_profile_id()
          or exists (
            select 1
            from public.company_directors director
            where director.company_id = request.company_id
              and director.director_profile_id = public.current_profile_id()
              and director.active
          )
        )
    );
$function$;

revoke all on function "public"."payroll_can_read_summary"(p_payment_request_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_can_read_summary"(p_payment_request_id uuid) to "authenticated";

grant EXECUTE on function "public"."payroll_can_read_summary"(p_payment_request_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.get_payroll_dispersion_summary(p_payment_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_company_name text; v_channels jsonb; v_channel_count integer:=0; v_pending_count integer:=0; v_dispersed_count integer:=0; v_failed_count integer:=0; v_overall_status text:='not_ready'; v_action_allowed boolean:=false; v_payment_ready boolean:=false;
begin
  if v_actor is null then raise exception 'PAYROLL_AUTH_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  select company.name into v_company_name from public.companies company where company.id=v_request.company_id;
  if not public.payroll_can_read_summary(v_request.id) then raise exception 'PAYROLL_SUMMARY_ACCESS_DENIED'; end if;
  select count(*)::integer,count(*) filter(where channel.dispersion_status='pending')::integer,count(*) filter(where channel.dispersion_status='dispersed')::integer,count(*) filter(where channel.dispersion_status='failed')::integer,coalesce(jsonb_agg(jsonb_build_object('id',channel.id,'channel',channel.channel,'amount',channel.amount,'currency',channel.currency,'dispersion_status',channel.dispersion_status,'dispersed_at',channel.dispersed_at,'has_failure_note',channel.dispersion_note is not null,'reconciliation_status',channel.reconciliation_status) order by case channel.channel when 'banco' then 1 when 'spei' then 2 else 3 end),'[]'::jsonb) into v_channel_count,v_pending_count,v_dispersed_count,v_failed_count,v_channels from public.payroll_channels channel where channel.payment_request_id=v_request.id;
  v_payment_ready:=public.payroll_ready_for_dispersion(v_request.id);
  if v_payment_ready and v_channel_count>0 then v_overall_status:=case when v_failed_count>0 then 'failed' when v_dispersed_count=v_channel_count then 'dispersed' when v_dispersed_count>0 then 'partial' else 'pending' end; end if;
  v_action_allowed:=public.payroll_has_finance_pii_access() and public.payroll_active_company_access(v_request.company_id) and v_payment_ready and v_channel_count>0;
  return jsonb_build_object('payment_request_id',v_request.id,'request_number',v_request.request_number,'company_id',v_request.company_id,'company_name',v_company_name,'request_status',v_request.status,'amount_requested',v_request.amount_requested,'currency',v_request.currency,'overall_status',v_overall_status,'action_allowed',v_action_allowed,'payment_ready',v_payment_ready,'payment_flow_state',case when v_payment_ready then 'ready_for_payment' else 'pending_finance_confirmation' end,'channel_count',v_channel_count,'pending_count',v_pending_count,'dispersed_count',v_dispersed_count,'failed_count',v_failed_count,'all_dispersed',(v_channel_count>0 and v_dispersed_count=v_channel_count),'channels',v_channels);
end; $function$;

revoke all on function "public"."get_payroll_dispersion_summary"(p_payment_request_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."get_payroll_dispersion_summary"(p_payment_request_id uuid) to "authenticated";

grant EXECUTE on function "public"."get_payroll_dispersion_summary"(p_payment_request_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.get_payroll_materialization_context_internal(p_capture_session_id uuid, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare v_session public.payroll_capture_sessions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'payroll_materialization_service_role_required'; end if;
  select * into v_session from public.payroll_capture_sessions where id=p_capture_session_id;
  if not found then raise exception 'payroll_capture_not_found'; end if;
  if v_session.capture_state='materialized' then
    if p_expected_version not in (v_session.version,v_session.version-1) then raise exception 'payroll_capture_version_conflict'; end if;
  elsif v_session.version<>p_expected_version then
    raise exception 'payroll_capture_version_conflict';
  end if;

  return jsonb_build_object(
    'id',v_session.id,'version',v_session.version,
    'reserved_payment_request_id',v_session.reserved_payment_request_id,
    'company_id',v_session.company_id,'company_bank_account_id',v_session.company_bank_account_id,
    'cost_center_id',v_session.cost_center_id,'budget_category_id',v_session.budget_category_id,
    'budget_month',v_session.budget_month,'payroll_subtype',v_session.payroll_subtype,
    'period_start',v_session.period_start,'period_end',v_session.period_end,
    'concept',v_session.concept,'notes',v_session.notes,
    'expected_channels',v_session.expected_channels,'capture_state',v_session.capture_state,
    'validation_status',v_session.validation_status,'expires_at',v_session.expires_at,
    'source_accounts',(select jsonb_build_array(a.account_number,a.clabe)
      from public.company_bank_accounts a where a.id=v_session.company_bank_account_id
        and a.company_id=v_session.company_id and a.active and a.account_type::text='bank'
        and upper(a.currency) in ('MXN','MXP')),
    'files',coalesce((select jsonb_agg(jsonb_build_object(
      'id',f.id,'kind',f.kind,'channel',f.channel,'storage_bucket',f.storage_bucket,
      'storage_path',f.storage_path,'mime_type',f.mime_type,'size_bytes',f.size_bytes,
      'sha256',f.sha256,'upload_state',f.upload_state,'capability_code',f.capability_code,
      'parsing_status',f.parsing_status,'validation_authority',f.validation_authority,
      'parser_version',f.parser_version,'parser_contract',f.parser_contract,
      'record_count',f.record_count,'total_amount_minor',f.total_amount_minor,
      'object_size',nullif(o.metadata->>'size','')::bigint,'object_mime',o.metadata->>'mimetype'
    ) order by f.kind) from public.payroll_capture_files f
      left join storage.objects o on o.bucket_id=f.storage_bucket and o.name=f.storage_path
      where f.session_id=v_session.id and f.is_current and f.upload_state='uploaded'),'[]'::jsonb)
  );
end;
$function$;

revoke all on function "public"."get_payroll_materialization_context_internal"(p_capture_session_id uuid, p_expected_version integer) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."get_payroll_materialization_context_internal"(p_capture_session_id uuid, p_expected_version integer) to "service_role";

CREATE OR REPLACE FUNCTION public.get_payroll_notification_document(p_event_id uuid, p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

revoke all on function "public"."get_payroll_notification_document"(p_event_id uuid, p_worker_id text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."get_payroll_notification_document"(p_event_id uuid, p_worker_id text) to "service_role";

CREATE OR REPLACE FUNCTION public.get_payroll_receipt_file_url(p_file_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file record;
begin
  select f.id,f.storage_bucket,f.storage_path,c.channel,p.company_id into v_file
    from public.payroll_run_files f
    join public.payroll_channels c on c.receipt_file_id=f.id and c.id=f.payroll_channel_id and c.payment_request_id=f.payment_request_id
    join public.payment_requests p on p.id=c.payment_request_id
    where f.id=p_file_id and p.request_type::text='nomina'
      and c.reconciliation_status='reconciled' and f.parsing_status='parsed'
      and f.parsing_version='payroll-channel-receipt-v1'
      and f.kind='comprobante' and f.storage_bucket='payroll-private';
  if not found then raise exception 'PAYROLL_RECEIPT_FILE_NOT_FOUND'; end if;
  if not public.payroll_capture_company_access(v_file.company_id) then
    raise exception 'PAYROLL_CAPTURE_ACCESS_REQUIRED';
  end if;
  return jsonb_build_object('file_id',v_file.id,'storage_bucket',v_file.storage_bucket,
    'storage_path',v_file.storage_path,'download_name',v_file.channel||'.pdf');
end;
$function$;

revoke all on function "public"."get_payroll_receipt_file_url"(p_file_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."get_payroll_receipt_file_url"(p_file_id uuid) to "authenticated";

grant EXECUTE on function "public"."get_payroll_receipt_file_url"(p_file_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.get_payroll_receipt_verification_context(p_run_file_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=public.current_profile_id(); v_file public.payroll_run_files%rowtype; v_channel public.payroll_channels%rowtype; v_request public.payment_requests%rowtype;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_file from public.payroll_run_files where id=p_run_file_id;
  if not found or v_file.kind<>'comprobante' then raise exception 'PAYROLL_RECEIPT_FILE_REQUIRED'; end if;
  select * into v_channel from public.payroll_channels where id=v_file.payroll_channel_id;
  select * into v_request from public.payment_requests where id=v_file.payment_request_id;
  if v_channel.id is null or v_request.id is null or v_channel.payment_request_id<>v_request.id then raise exception 'PAYROLL_RECEIPT_SCOPE_MISMATCH'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_RECEIPT_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if v_request.status::text<>'approved' or not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_RECEIPT_REQUEST_NOT_READY'; end if;
  if v_channel.dispersion_status<>'dispersed' or v_channel.reconciliation_status<>'pending' then raise exception 'PAYROLL_RECEIPT_CHANNEL_NOT_READY'; end if;
  if v_file.parsing_status<>'pending' or v_file.parsing_version is not null then raise exception 'PAYROLL_RECEIPT_ALREADY_VERIFIED'; end if;
  return jsonb_build_object('run_file_id',v_file.id,'payment_request_id',v_request.id,'payroll_channel_id',v_channel.id,'storage_bucket',v_file.storage_bucket,'storage_path',v_file.storage_path,'mime_type',v_file.mime_type,'size_bytes',v_file.size_bytes,'sha256',v_file.sha256);
end; $function$;

revoke all on function "public"."get_payroll_receipt_verification_context"(p_run_file_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."get_payroll_receipt_verification_context"(p_run_file_id uuid) to "authenticated";

grant EXECUTE on function "public"."get_payroll_receipt_verification_context"(p_run_file_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.get_payroll_reconciliation_summary(p_payment_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_company_name text; v_channels jsonb; v_count integer; v_dispersed integer; v_reconciled integer;
begin
  if v_actor is null or not public.payroll_has_capture_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.payroll_capture_company_access(v_request.company_id) then raise exception 'PAYROLL_RECONCILIATION_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  select name into v_company_name from public.companies where id=v_request.company_id;
  select count(*)::integer,count(*) filter(where channel.dispersion_status='dispersed')::integer,count(*) filter(where channel.reconciliation_status='reconciled')::integer,
    coalesce(jsonb_agg(jsonb_build_object('id',channel.id,'channel',channel.channel,'amount',channel.amount,'currency',channel.currency,'dispersion_status',channel.dispersion_status,'reconciliation_status',channel.reconciliation_status,'receipt_verified',(file.id is not null and file.parsing_status='parsed' and file.parsing_version='payroll-channel-receipt-v1'),'receipt_file_id',channel.receipt_file_id,'receipt_amount',channel.receipt_amount,'receipt_payment_date',channel.receipt_payment_date,'reference_hint',case when channel.receipt_reference_hint is null then null else '••••'||right(channel.receipt_reference_hint,4) end) order by case channel.channel when 'banco' then 1 when 'spei' then 2 else 3 end),'[]'::jsonb)
  into v_count,v_dispersed,v_reconciled,v_channels
  from public.payroll_channels channel left join public.payroll_run_files file on file.id=channel.receipt_file_id where channel.payment_request_id=v_request.id;
  return jsonb_build_object('payment_request_id',v_request.id,'request_number',v_request.request_number,'company_name',v_company_name,'request_status',v_request.status::text,'amount_requested',v_request.amount_requested,'currency',v_request.currency,'channel_count',v_count,'dispersed_count',v_dispersed,'reconciled_count',v_reconciled,'all_dispersed',(v_count>0 and v_dispersed=v_count),'all_reconciled',(v_count>0 and v_reconciled=v_count),'can_close_paid',(public.payroll_has_finance_pii_access() and public.payroll_active_company_access(v_request.company_id) and v_request.status::text='approved' and v_count>0 and v_dispersed=v_count and v_reconciled=v_count),'channels',v_channels);
end; $function$;

revoke all on function "public"."get_payroll_reconciliation_summary"(p_payment_request_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."get_payroll_reconciliation_summary"(p_payment_request_id uuid) to "authenticated";

grant EXECUTE on function "public"."get_payroll_reconciliation_summary"(p_payment_request_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.get_payroll_submission_summary(p_payment_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_employee_net numeric; v_channels jsonb; v_category_code text; v_direct_flow boolean:=false; v_payment_ready boolean:=false; v_flow_state text;
begin
  if v_actor is null or not public.payroll_has_capture_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.payroll_capture_company_access(v_request.company_id) then raise exception 'PAYROLL_SUBMIT_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  select code into v_category_code from public.budget_categories where id=v_request.budget_category_id;
  v_direct_flow:=coalesce(v_request.no_presupuestal,false) and v_category_code='PAYROLL_NON_BUDGET' and v_request.approver_id is null and v_request.submitted_at is null;
  v_payment_ready:=public.payroll_ready_for_dispersion(v_request.id);
  v_flow_state:=case when v_direct_flow and v_request.status::text='draft' then 'pending_finance_confirmation' when v_payment_ready then 'ready_for_payment' when v_request.status::text='approved' then 'payment_blocked' else v_request.status::text end;
  select coalesce(sum(net_amount),0) into v_employee_net from public.payroll_run_lines where payment_request_id=v_request.id;
  select coalesce(jsonb_agg(jsonb_build_object('channel',channel.channel,'amount',channel.amount,'benefit_amount',channel.benefit_amount,'fee_amount',channel.fee_amount,'tax_amount',channel.tax_amount,'expected_funding_amount',channel.expected_funding_amount,'funding_variance',case when channel.channel='vales' then channel.amount-channel.expected_funding_amount else null end,'funding_variance_acknowledged',channel.funding_variance_acknowledged_at is not null,'funding_variance_acknowledged_at',channel.funding_variance_acknowledged_at) order by channel.channel),'[]'::jsonb) into v_channels from public.payroll_channels channel where channel.payment_request_id=v_request.id;
  return jsonb_build_object('payment_request_id',v_request.id,'request_number',v_request.request_number,'status',v_request.status,'company_id',v_request.company_id,'cost_center_id',v_request.cost_center_id,'amount_requested',v_request.amount_requested,'employee_net',v_employee_net,'currency',v_request.currency,'payroll_subtype',v_request.payroll_subtype,'period_start',v_request.payroll_period_start,'period_end',v_request.payroll_period_end,'approver_id',v_request.approver_id,'approver_assignment_id',v_request.approver_assignment_id,'approver_selection_source',v_request.approver_selection_source,'submitted_at',v_request.submitted_at,'budget_category_id',v_request.budget_category_id,'budget_month',v_request.budget_month,'budget_decision',v_request.budget_decision,'budget_block_reason',v_request.budget_block_reason,'budget_available_before',v_request.budget_available_before,'budget_available_after',v_request.budget_available_after,'budget_shortfall',v_request.budget_shortfall,'budget_checked_at',v_request.budget_checked_at,'budget_ready',(coalesce(v_request.no_presupuestal,false) or (v_request.budget_decision='aprobable' and v_request.budget_category_id is not null and v_request.budget_month is not null)),'finance_confirmation_pending',(v_direct_flow and v_request.status::text='draft'),'payment_ready',v_payment_ready,'payment_flow_state',v_flow_state,'channels',v_channels);
end; $function$;

revoke all on function "public"."get_payroll_submission_summary"(p_payment_request_id uuid) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."get_payroll_submission_summary"(p_payment_request_id uuid) to "authenticated";

grant EXECUTE on function "public"."get_payroll_submission_summary"(p_payment_request_id uuid) to "service_role";

CREATE OR REPLACE FUNCTION public.guard_payroll_approval_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request public.payment_requests%rowtype;
begin
  select * into v_request
  from public.payment_requests
  where id = new.payment_request_id;

  if not found or v_request.request_type::text <> 'nomina' then
    return new;
  end if;

  if v_request.status::text <> 'submitted'
     or v_request.approver_id is null
     or v_request.submitted_at is null
     or not public.payroll_request_has_valid_materialization(v_request.id) then
    raise exception 'PAYROLL_NOT_SUBMITTED_FOR_APPROVAL';
  end if;
  if new.actor_profile_id is distinct from v_request.approver_id then
    raise exception 'selected_approver_only';
  end if;
  if new.action not in ('approved','rejected','changes_requested')
     or new.from_status is distinct from 'submitted'
     or new.to_status is distinct from (case new.action
       when 'approved' then 'approved'
       when 'rejected' then 'rejected'
       when 'changes_requested' then 'changes_requested'
     end) then
    raise exception 'PAYROLL_INVALID_APPROVAL_DECISION';
  end if;

  return new;
end;
$function$;

revoke all on function "public"."guard_payroll_approval_insert"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."guard_payroll_approval_insert"() to "service_role";

CREATE OR REPLACE FUNCTION public.guard_payroll_budget_snapshot_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.request_type::text <> 'nomina'
     or not public.payroll_request_has_valid_materialization(old.id) then
    return new;
  end if;

  if current_setting('app.payroll_n5a_budget_snapshot',true) is distinct from old.id::text then
    raise exception 'PAYROLL_BUDGET_SNAPSHOT_RPC_REQUIRED';
  end if;
  return new;
end;
$function$;

revoke all on function "public"."guard_payroll_budget_snapshot_immutable"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."guard_payroll_budget_snapshot_immutable"() to "authenticated";

grant EXECUTE on function "public"."guard_payroll_budget_snapshot_immutable"() to "service_role";

CREATE OR REPLACE FUNCTION public.guard_payroll_channel_financial_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if public.payroll_request_has_valid_materialization(old.payment_request_id)
     and (new.amount is distinct from old.amount or new.currency is distinct from old.currency
       or new.benefit_amount is distinct from old.benefit_amount or new.fee_amount is distinct from old.fee_amount
       or new.tax_amount is distinct from old.tax_amount or new.expected_funding_amount is distinct from old.expected_funding_amount) then
    raise exception 'PAYROLL_CHANNEL_FINANCIAL_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end;
$function$;

revoke all on function "public"."guard_payroll_channel_financial_snapshot"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."guard_payroll_channel_financial_snapshot"() to "service_role";

CREATE OR REPLACE FUNCTION public.guard_payroll_materialized_request_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_budget_context_allowed boolean := false;
begin
  if old.request_type::text <> 'nomina'
     or not public.payroll_request_has_valid_materialization(old.id) then
    return new;
  end if;

  v_budget_context_allowed := old.status::text='draft'
    and current_setting('app.payroll_n5a_budget_context',true) is not distinct from old.id::text
    and v_actor is not null
    and v_actor is not distinct from old.requested_by
    and public.payroll_has_finance_pii_access();

  -- Every non-budget material field remains frozen without exception.
  if new.request_type is distinct from old.request_type
     or new.company_id is distinct from old.company_id
     or new.company_bank_account_id is distinct from old.company_bank_account_id
     or new.cost_center_id is distinct from old.cost_center_id
     or new.amount_requested is distinct from old.amount_requested
     or new.currency is distinct from old.currency
     or new.exchange_rate is distinct from old.exchange_rate
     or new.requested_by is distinct from old.requested_by
     or new.payroll_subtype is distinct from old.payroll_subtype
     or new.payroll_period_start is distinct from old.payroll_period_start
     or new.payroll_period_end is distinct from old.payroll_period_end
     or new.provider_id is distinct from old.provider_id
     or new.proveedor_id is distinct from old.proveedor_id
     or new.provider_bank_account_id is distinct from old.provider_bank_account_id
     or new.payment_method is distinct from old.payment_method
     or new.is_extraordinary_adjustment is distinct from old.is_extraordinary_adjustment
     or new.concept is distinct from old.concept
     or new.description is distinct from old.description
     or new.notes is distinct from old.notes then
    raise exception 'PAYROLL_MATERIALIZED_REQUEST_IMMUTABLE';
  end if;

  if new.budget_category_id is distinct from old.budget_category_id
     or new.budget_month is distinct from old.budget_month then
    if not v_budget_context_allowed then
      raise exception 'PAYROLL_BUDGET_CONTEXT_RPC_REQUIRED';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function "public"."guard_payroll_materialized_request_immutable"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."guard_payroll_materialized_request_immutable"() to "service_role";

CREATE OR REPLACE FUNCTION public.guard_payroll_request_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_channel_count integer;
  v_ready_count integer;
begin
  if old.request_type::text<>'nomina' or new.status is not distinct from old.status then
    return new;
  end if;

  if old.status::text='draft' then
    if new.status::text='approved' then
      if current_setting('app.payroll_finance_confirm',true) is distinct from old.id::text then
        raise exception 'PAYROLL_FINANCE_CONFIRM_RPC_REQUIRED';
      end if;
      if v_actor is null or not public.payroll_has_finance_pii_access() then
        raise exception 'PAYROLL_FINANCE_REQUIRED';
      end if;
      if not public.has_active_company_membership(v_actor,old.company_id) then
        raise exception 'PAYROLL_FINANCE_CONFIRM_COMPANY_MEMBERSHIP_REQUIRED';
      end if;
      if not public.payroll_request_has_valid_materialization(old.id) then
        raise exception 'PAYROLL_VALID_MATERIALIZATION_REQUIRED';
      end if;
      if not old.no_presupuestal then
        raise exception 'PAYROLL_NON_BUDGET_CONTEXT_REQUIRED';
      end if;
      if exists(
        select 1 from public.payroll_channels c
        where c.payment_request_id=old.id
          and c.channel='vales'
          and c.amount is distinct from c.expected_funding_amount
          and c.funding_variance_acknowledged_at is null
      ) then
        raise exception 'PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED';
      end if;
      if new.approver_id is not null
         or new.approver_assignment_id is not null
         or new.approver_selection_source is not null
         or new.submitted_at is not null then
        raise exception 'PAYROLL_APPROVER_NOT_ALLOWED';
      end if;
      if new.approved_by is distinct from v_actor or new.approved_at is null then
        raise exception 'PAYROLL_FINANCE_CONFIRM_SNAPSHOT_REQUIRED';
      end if;
      return new;
    end if;

    if new.status::text='submitted' then
      if old.no_presupuestal then
        raise exception 'PAYROLL_APPROVAL_FLOW_DISABLED';
      end if;
      if current_setting('app.payroll_n5a_submit',true) is distinct from old.id::text then
        raise exception 'PAYROLL_BUDGET_SUBMIT_RPC_REQUIRED';
      end if;
      if old.budget_category_id is null
         or old.budget_month is null
         or old.budget_decision<>'aprobable'
         or old.budget_checked_at is null then
        raise exception 'PAYROLL_BUDGET_NOT_APPROVABLE';
      end if;
      if v_actor is null
         or not public.payroll_has_finance_pii_access()
         or old.requested_by is distinct from v_actor
         or new.approver_id is null
         or new.approver_selection_source is null
         or new.submitted_at is null
         or not public.payroll_request_has_valid_materialization(old.id) then
        raise exception 'PAYROLL_NOT_READY_FOR_SUBMISSION';
      end if;
      return new;
    end if;

    raise exception 'PAYROLL_STATUS_TRANSITION_NOT_ENABLED';
  end if;

  if old.status::text='submitted' then
    if new.status::text not in ('approved','rejected','changes_requested') then
      raise exception 'PAYROLL_INVALID_APPROVAL_STATUS_TRANSITION';
    end if;
    if v_actor is null or old.approver_id is distinct from v_actor then
      raise exception 'selected_approver_only';
    end if;
    if not exists (
      select 1 from public.payment_request_approvals a
      where a.payment_request_id=old.id
        and a.actor_profile_id=v_actor
        and a.from_status='submitted'
        and a.to_status=new.status::text
        and a.created_at>=transaction_timestamp()
    ) then
      raise exception 'PAYROLL_DECISION_RECORD_REQUIRED';
    end if;
    return new;
  end if;

  if old.status::text='approved' then
    if new.status::text<>'paid' then
      raise exception 'PAYROLL_POST_DECISION_TRANSITION_NOT_ENABLED';
    end if;
    if current_setting('app.payroll_n4b_close_request',true) is distinct from old.id::text then
      raise exception 'PAYROLL_PAID_CLOSE_RPC_REQUIRED';
    end if;
    if v_actor is null or not public.payroll_has_finance_pii_access() then
      raise exception 'PAYROLL_FINANCE_REQUIRED';
    end if;
    if not public.has_active_company_membership(v_actor,old.company_id) then
      raise exception 'PAYROLL_PAID_COMPANY_MEMBERSHIP_REQUIRED';
    end if;
    if not public.payroll_request_has_valid_materialization(old.id) then
      raise exception 'PAYROLL_PAID_MATERIALIZATION_REQUIRED';
    end if;

    select count(*)::integer,
           count(*) filter(where channel.dispersion_status='dispersed'
                              and channel.reconciliation_status='reconciled'
                              and channel.receipt_file_id is not null
                              and file.id is not null
                              and file.parsing_status='parsed'
                              and file.parsing_version='payroll-channel-receipt-v1')::integer
      into v_channel_count,v_ready_count
    from public.payroll_channels channel
    left join public.payroll_run_files file on file.id=channel.receipt_file_id
    where channel.payment_request_id=old.id;

    if v_channel_count=0 or v_ready_count<>v_channel_count then
      raise exception 'PAYROLL_PAID_RECONCILIATION_REQUIRED';
    end if;
    if new.paid_at is null or new.paid_by is distinct from v_actor then
      raise exception 'PAYROLL_PAID_SNAPSHOT_REQUIRED';
    end if;
    return new;
  end if;

  if old.status::text in ('rejected','changes_requested') then
    raise exception 'PAYROLL_POST_DECISION_TRANSITION_NOT_ENABLED';
  end if;
  raise exception 'PAYROLL_STATUS_TRANSITION_NOT_ENABLED';
end;
$function$;

revoke all on function "public"."guard_payroll_request_status_transition"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."guard_payroll_request_status_transition"() to "service_role";

CREATE OR REPLACE FUNCTION public.guard_payroll_submitted_at_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.request_type::text <> 'nomina'
     or not public.payroll_request_has_valid_materialization(old.id)
     or new.submitted_at is not distinct from old.submitted_at then
    return new;
  end if;

  if old.status::text = 'draft'
     and new.status::text = 'submitted'
     and old.submitted_at is null
     and new.submitted_at is not null then
    return new;
  end if;

  raise exception 'PAYROLL_SUBMITTED_AT_IMMUTABLE';
end;
$function$;

revoke all on function "public"."guard_payroll_submitted_at_immutable"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."guard_payroll_submitted_at_immutable"() to "service_role";

CREATE OR REPLACE FUNCTION public.guard_payroll_toka_variance_before_submit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if exists(select 1 from public.payroll_channels c where c.payment_request_id=old.id and c.channel='vales'
      and c.amount is distinct from c.expected_funding_amount and c.funding_variance_acknowledged_at is null)
  then raise exception 'PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED'; end if;
  return new;
end;
$function$;

revoke all on function "public"."guard_payroll_toka_variance_before_submit"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."guard_payroll_toka_variance_before_submit"() to "service_role";

CREATE OR REPLACE FUNCTION public.post_payroll_provision_internal(p_payment_request_id uuid, p_base_amount_minor bigint, p_server_aguinaldo_factor numeric DEFAULT NULL::numeric, p_server_vacation_premium_factor numeric DEFAULT NULL::numeric, p_policy_version text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request public.payment_requests%rowtype;
  v_setting public.payroll_provision_settings%rowtype;
  v_existing public.payroll_provision_entries%rowtype;
  v_budget_version public.budget_versions%rowtype;
  v_budget_month date;
  v_base numeric(18,2);
  v_aguinaldo_factor numeric(12,8);
  v_vacation_factor numeric(12,8);
  v_combined_factor numeric(12,8);
  v_aguinaldo numeric(18,2);
  v_vacation numeric(18,2);
  v_provision numeric(18,2);
  v_policy_version text;
  v_before numeric(18,2):=0;
  v_after numeric(18,2);
  v_budget_line_id uuid;
  v_count integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'PAYROLL_PROVISION_SERVICE_ROLE_REQUIRED'; end if;
  if p_base_amount_minor is null or p_base_amount_minor<=0 then raise exception 'PAYROLL_PROVISION_BASE_REQUIRED'; end if;

  select * into v_existing from public.payroll_provision_entries where payment_request_id=p_payment_request_id;
  if found then
    return jsonb_build_object('status','already_posted','payment_request_id',p_payment_request_id,'provision_amount',v_existing.provision_amount,
      'calculation_policy',v_existing.calculation_policy,'policy_version',v_existing.policy_version);
  end if;

  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.payroll_period_end is null or v_request.cost_center_id is null then raise exception 'PAYROLL_PROVISION_CONTEXT_REQUIRED'; end if;

  select * into v_setting from public.payroll_provision_settings where company_id=v_request.company_id and active;
  if not found or v_setting.calculation_policy='pending' then
    return jsonb_build_object(
      'status','pending_configuration',
      'payment_request_id',p_payment_request_id,
      'calculation_policy','pending',
      'policy_version',null
    );
  end if;

  if v_setting.calculation_policy='configured_components' then
    v_aguinaldo_factor:=v_setting.configured_aguinaldo_factor;
    v_vacation_factor:=v_setting.configured_vacation_premium_factor;
    v_policy_version:='configured-components-v1';
  elsif v_setting.calculation_policy='server_calculated_components' then
    v_aguinaldo_factor:=p_server_aguinaldo_factor;
    v_vacation_factor:=p_server_vacation_premium_factor;
    v_policy_version:=nullif(btrim(coalesce(p_policy_version,'')),'');
    if v_aguinaldo_factor is null or v_vacation_factor is null or v_policy_version is null then
      raise exception 'PAYROLL_PROVISION_SERVER_CALCULATION_REQUIRED';
    end if;
  else
    raise exception 'PAYROLL_PROVISION_POLICY_REQUIRED';
  end if;

  if v_aguinaldo_factor<0 or v_vacation_factor<0
     or v_aguinaldo_factor+v_vacation_factor<=0
     or v_aguinaldo_factor+v_vacation_factor>=1 then raise exception 'PAYROLL_PROVISION_FACTOR_INVALID'; end if;
  v_combined_factor:=v_aguinaldo_factor+v_vacation_factor;

  select count(*) into v_count from public.budget_versions where active and year=extract(year from v_request.payroll_period_end)::integer;
  if v_count<>1 then raise exception 'PAYROLL_PROVISION_ACTIVE_BUDGET_VERSION_REQUIRED'; end if;
  select * into v_budget_version from public.budget_versions where active and year=extract(year from v_request.payroll_period_end)::integer limit 1;
  if v_budget_version.locked then raise exception 'PAYROLL_PROVISION_BUDGET_VERSION_LOCKED'; end if;

  v_budget_month:=date_trunc('month',v_request.payroll_period_end)::date;
  v_base:=p_base_amount_minor/100.0;
  v_aguinaldo:=round(v_base*v_aguinaldo_factor,2);
  v_vacation:=round(v_base*v_vacation_factor,2);
  v_provision:=v_aguinaldo+v_vacation;
  if v_provision<=0 then raise exception 'PAYROLL_PROVISION_AMOUNT_INVALID'; end if;

  select id,amount into v_budget_line_id,v_before from public.budget_lines
  where budget_version_id=v_budget_version.id and company_id=v_request.company_id and cost_center_id=v_request.cost_center_id
    and budget_category_id=v_setting.budget_category_id and budget_month=v_budget_month for update;
  if found then
    v_after:=v_before+v_provision;
    update public.budget_lines set amount=v_after where id=v_budget_line_id;
  else
    v_before:=0; v_after:=v_provision;
    insert into public.budget_lines(budget_version_id,company_id,cost_center_id,budget_category_id,budget_month,amount)
    values(v_budget_version.id,v_request.company_id,v_request.cost_center_id,v_setting.budget_category_id,v_budget_month,v_after)
    returning id into v_budget_line_id;
  end if;

  insert into public.payroll_provision_entries(payment_request_id,company_id,cost_center_id,budget_version_id,budget_category_id,budget_line_id,
    provision_month,provision_base_amount,calculation_policy,policy_version,aguinaldo_factor,vacation_premium_factor,combined_factor,
    aguinaldo_amount,vacation_premium_amount,provision_amount,budget_line_amount_before,budget_line_amount_after,created_by)
  values(v_request.id,v_request.company_id,v_request.cost_center_id,v_budget_version.id,v_setting.budget_category_id,v_budget_line_id,
    v_budget_month,v_base,v_setting.calculation_policy,v_policy_version,v_aguinaldo_factor,v_vacation_factor,v_combined_factor,
    v_aguinaldo,v_vacation,v_provision,v_before,v_after,v_request.requested_by);

  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values('payroll_provision',v_request.id,'post',null,
    jsonb_build_object('redacted',true,'operation','automatic_payroll_provision','calculation_policy',v_setting.calculation_policy,'policy_version',v_policy_version),
    v_request.requested_by,'Automatic payroll provision posted from server-derived cover base. Activity log omits salary/base/factor values.');

  return jsonb_build_object('status','posted','payment_request_id',v_request.id,'provision_amount',v_provision,'provision_month',v_budget_month,
    'aguinaldo_amount',v_aguinaldo,'vacation_premium_amount',v_vacation,'calculation_policy',v_setting.calculation_policy,'policy_version',v_policy_version,
    'budget_category_id',v_setting.budget_category_id,'budget_line_id',v_budget_line_id);
end;
$function$;

revoke all on function "public"."post_payroll_provision_internal"(p_payment_request_id uuid, p_base_amount_minor bigint, p_server_aguinaldo_factor numeric, p_server_vacation_premium_factor numeric, p_policy_version text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."post_payroll_provision_internal"(p_payment_request_id uuid, p_base_amount_minor bigint, p_server_aguinaldo_factor numeric, p_server_vacation_premium_factor numeric, p_policy_version text) to "service_role";

CREATE OR REPLACE FUNCTION public.materialize_payroll_capture_internal(p_capture_session_id uuid, p_expected_version integer, p_idempotency_key_hash text, p_server_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_session public.payroll_capture_sessions%rowtype; v_actor uuid; v_request_id uuid; v_channel jsonb; v_file jsonb; v_line jsonb;
  v_channel_ids jsonb:='{}'::jsonb; v_file_ids jsonb:='{}'::jsonb; v_amount_minor bigint:=0; v_count integer; v_warning_codes jsonb; v_provision jsonb;
  v_year integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'payroll_materialization_service_role_required'; end if;
  if p_idempotency_key_hash !~ '^[0-9a-f]{64}$' then raise exception 'payroll_materialization_idempotency_invalid'; end if;
  select * into v_session from public.payroll_capture_sessions where id=p_capture_session_id for update;
  if not found then raise exception 'payroll_capture_not_found'; end if;
  if v_session.capture_state='materialized' then
    if v_session.materialization_idempotency_hash=p_idempotency_key_hash then return jsonb_build_object('status','already_materialized','payment_request_id',v_session.materialized_payment_request_id); end if;
    raise exception 'payroll_capture_already_materialized';
  end if;
  if v_session.version<>p_expected_version then raise exception 'payroll_capture_version_conflict'; end if;
  if v_session.expires_at<=now() then raise exception 'payroll_capture_expired'; end if;
  if v_session.capture_state not in ('validation_pending','ready_for_submission') then raise exception 'payroll_capture_not_materializable'; end if;
  if v_session.cost_center_id is null then raise exception 'payroll_capture_accounting_context_required'; end if;
  if p_server_result->>'contract_version'<>'payroll-normalized-v1' or coalesce((p_server_result->>'valid')::boolean,false) is not true
     or jsonb_array_length(coalesce(p_server_result->'issues','[]'::jsonb))<>0 then raise exception 'payroll_server_validation_required'; end if;
  if coalesce((p_server_result->>'provision_base_amount_minor')::bigint,0)<=0 then raise exception 'PAYROLL_PROVISION_BASE_REQUIRED'; end if;
  v_actor:=(p_server_result->>'actor_profile_id')::uuid;
  if v_actor is null then raise exception 'payroll_materialization_actor_required'; end if;
  if not private.payroll_profile_can_capture(v_actor,v_session.company_id) then raise exception 'payroll_materialization_finance_required'; end if;
  if (p_server_result->>'capture_session_id')::uuid<>v_session.id or (p_server_result->>'capture_version')::integer<>v_session.version then raise exception 'payroll_server_result_binding_mismatch'; end if;
  if not exists(select 1 from jsonb_array_elements(p_server_result->'files') x where x->>'kind'='caratula' and x->>'authority'='server_verified') then raise exception 'PAYROLL_COVER_SHEET_FORMAT_UNVERIFIED'; end if;

  select coalesce(sum((x->>'amount_minor')::bigint),0),count(*) into v_amount_minor,v_count
  from jsonb_array_elements(p_server_result->'channels') x where (x->>'amount_minor')::bigint>0;
  if v_count=0 or v_amount_minor<=0 then raise exception 'payroll_channel_totals_invalid'; end if;
  if v_count<>cardinality(v_session.expected_channels) or exists(select 1 from unnest(v_session.expected_channels) expected where not exists(
      select 1 from jsonb_array_elements(p_server_result->'channels') x where x->>'channel'=expected and (x->>'amount_minor')::bigint>0))
  then raise exception 'payroll_channel_inventory_mismatch'; end if;
  select count(*) into v_count from public.payroll_capture_files where session_id=v_session.id and is_current and upload_state='uploaded';
  if v_count<>jsonb_array_length(p_server_result->'files') then raise exception 'payroll_file_inventory_mismatch'; end if;
  if jsonb_array_length(p_server_result->'lines')=0 then raise exception 'payroll_server_lines_required'; end if;

  v_year:=coalesce(extract(year from v_session.budget_month)::int, extract(year from now())::int);
  v_request_id:=v_session.reserved_payment_request_id;
  insert into public.payment_requests(id,request_number,request_type,requested_by,company_id,company_bank_account_id,cost_center_id,budget_category_id,budget_month,
    amount_requested,currency,exchange_rate,status,concept,description,notes,payroll_subtype,payroll_period_start,payroll_period_end,
    provider_id,proveedor_id,provider_bank_account_id,approver_id,submitted_at)
  values(v_request_id,public.generate_payment_request_number(v_year),'nomina',v_actor,v_session.company_id,v_session.company_bank_account_id,v_session.cost_center_id,v_session.budget_category_id,v_session.budget_month,
    v_amount_minor/100.0,'MXN',1,'draft',v_session.concept,v_session.concept,v_session.notes,v_session.payroll_subtype,v_session.period_start,v_session.period_end,
    null,null,null,null,null);

  for v_channel in select value from jsonb_array_elements(p_server_result->'channels') loop
    if v_channel->>'channel'<>all(v_session.expected_channels) then raise exception 'payroll_channel_inventory_mismatch'; end if;
    v_actor:=null;
    insert into public.payroll_channels(payment_request_id,channel,amount,currency,benefit_amount,fee_amount,tax_amount,expected_funding_amount)
    values(v_request_id,v_channel->>'channel',(v_channel->>'amount_minor')::bigint/100.0,'MXN',
      case when v_channel->>'channel'='vales' then (v_channel->>'benefit_amount_minor')::bigint/100.0 else null end,
      case when v_channel->>'channel'='vales' then (v_channel->>'fee_amount_minor')::bigint/100.0 else null end,
      case when v_channel->>'channel'='vales' then (v_channel->>'tax_amount_minor')::bigint/100.0 else null end,
      case when v_channel->>'channel'='vales' then (v_channel->>'expected_funding_amount_minor')::bigint/100.0 else null end)
    returning id into v_actor;
    v_channel_ids:=v_channel_ids||jsonb_build_object(v_channel->>'channel',v_actor);
  end loop;

  for v_file in select value from jsonb_array_elements(p_server_result->'files') loop
    v_actor:=null;
    insert into public.payroll_run_files(payment_request_id,payroll_channel_id,kind,storage_bucket,storage_path,original_filename,mime_type,size_bytes,sha256,
      uploaded_by,uploaded_at,parsing_status,parsing_version,parsing_metadata,capture_file_id)
    select v_request_id,case when f.channel is null then null else (v_channel_ids->>f.channel)::uuid end,f.kind,f.storage_bucket,f.storage_path,
      f.kind||'.'||f.extension,f.mime_type,f.size_bytes,v_file->>'sha256',f.uploaded_by,f.uploaded_at,'parsed',v_file->>'parser_version',
      jsonb_build_object('evidence_class','SERVER_VERIFIED','parser_version',v_file->>'parser_version','row_count',coalesce((v_file->>'record_count')::integer,0),'issue_codes','[]'::jsonb),f.id
    from public.payroll_capture_files f where f.id=(v_file->>'capture_file_id')::uuid and f.session_id=v_session.id
      and f.sha256=v_file->>'sha256' and f.is_current and f.upload_state='uploaded' returning id into v_actor;
    if v_actor is null then raise exception 'payroll_server_file_binding_mismatch'; end if;
    v_file_ids:=v_file_ids||jsonb_build_object(v_file->>'capture_file_id',v_actor);
  end loop;

  for v_line in select value from jsonb_array_elements(p_server_result->'lines') loop
    insert into public.payroll_run_lines(payment_request_id,source_file_id,source_sheet,source_row_number,extraction_version,employee_name,rfc,curp,nss,
      bank_name,bank_account,clabe,net_amount,bank_amount,spei_amount,vouchers_amount)
    values(v_request_id,(v_file_ids->>(v_line->>'source_capture_file_id'))::uuid,v_line->>'source_sheet',(v_line->>'source_row_number')::integer,
      v_line->>'extraction_version',v_line->>'employee_name',nullif(v_line->>'rfc',''),nullif(v_line->>'curp',''),nullif(v_line->>'nss',''),
      nullif(v_line->>'bank_name',''),nullif(v_line->>'bank_account',''),nullif(v_line->>'clabe',''),
      (v_line->>'net_amount_minor')::bigint/100.0,(v_line->>'bank_amount_minor')::bigint/100.0,
      (v_line->>'spei_amount_minor')::bigint/100.0,(v_line->>'vouchers_amount_minor')::bigint/100.0);
  end loop;

  update public.payroll_channels c set layout_file_id=f.id from public.payroll_run_files f
  where c.payment_request_id=v_request_id and f.payroll_channel_id=c.id
    and f.kind=case c.channel when 'banco' then 'layout_mismo_banco' when 'spei' then 'layout_spei' else 'layout_toka' end;

  v_provision:=public.post_payroll_provision_internal(
    v_request_id,
    (p_server_result->>'provision_base_amount_minor')::bigint,
    nullif(p_server_result->>'provision_aguinaldo_factor','')::numeric,
    nullif(p_server_result->>'provision_vacation_premium_factor','')::numeric,
    nullif(p_server_result->>'provision_policy_version','')
  );

  select coalesce(jsonb_agg(w->>'code'),'[]'::jsonb) into v_warning_codes
  from jsonb_array_elements(coalesce(p_server_result->'warnings','[]'::jsonb)) w;
  update public.payroll_capture_sessions set capture_state='materialized',validation_status='valid',materialized_payment_request_id=v_request_id,
    materialized_at=now(),materialized_by=(p_server_result->>'actor_profile_id')::uuid,materialization_idempotency_hash=p_idempotency_key_hash,
    server_verification_summary=jsonb_build_object('contract_version','payroll-normalized-v1','file_count',jsonb_array_length(p_server_result->'files'),
      'line_count',jsonb_array_length(p_server_result->'lines'),'parser_versions',p_server_result->'parser_versions','verified_at',p_server_result->>'verified_at',
      'warning_codes',v_warning_codes,'finance_review_required',coalesce((p_server_result->>'finance_review_required')::boolean,false),
      'provision_base_amount_minor',(p_server_result->>'provision_base_amount_minor')::bigint,'provision_status',v_provision->>'status',
      'provision_calculation_policy',v_provision->>'calculation_policy','provision_policy_version',v_provision->>'policy_version'),
    version=version+1,updated_at=now(),updated_by=(p_server_result->>'actor_profile_id')::uuid where id=v_session.id;

  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values('payroll_materialization',v_session.id,'materialize',null,jsonb_build_object('redacted',true,'operation','server_verified_materialization'),
    (p_server_result->>'actor_profile_id')::uuid,'Server verification audit contains no employee, identifier, bank account, salary, or raw-byte values.');
  if exists(select 1 from public.notification_events where source_id=v_request_id and event_type<>'payroll.registered')
     or exists(select 1 from public.payment_request_approvals where payment_request_id=v_request_id)
     or exists(select 1 from public.approval_batch_items where payment_request_id=v_request_id)
  then raise exception 'payroll_materialization_side_effect_detected'; end if;
  return jsonb_build_object('status','materialized','payment_request_id',v_request_id,
    'finance_review_required',coalesce((p_server_result->>'finance_review_required')::boolean,false),
    'provision_status',v_provision->>'status','provision_calculation_policy',v_provision->>'calculation_policy');
end;
$function$;

revoke all on function "public"."materialize_payroll_capture_internal"(p_capture_session_id uuid, p_expected_version integer, p_idempotency_key_hash text, p_server_result jsonb) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."materialize_payroll_capture_internal"(p_capture_session_id uuid, p_expected_version integer, p_idempotency_key_hash text, p_server_result jsonb) to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_capture_channels_valid(p_channels text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(cardinality(p_channels) between 1 and 3, false)
    and p_channels <@ array['banco', 'spei', 'vales']::text[]
    and cardinality(p_channels) = (
      select count(distinct channel_name)
      from unnest(p_channels) as channel_name
    );
$function$;

revoke all on function "public"."payroll_capture_channels_valid"(p_channels text[]) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_capture_channels_valid"(p_channels text[]) to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_capture_storage_insert_allowed_unscoped_internal(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.payroll_has_capture_access()
    and p_name ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'
    and exists (
      select 1
      from public.payroll_capture_files file
      join public.payroll_capture_sessions session on session.id = file.session_id
      where file.storage_path = p_name
        and file.storage_bucket = 'payroll-private'
        and file.upload_state = 'reserved'
        and session.company_id::text = split_part(p_name, '/', 1)
        and session.reserved_payment_request_id::text = split_part(p_name, '/', 2)
        and session.expires_at > now()
        and session.capture_state in ('draft', 'files_pending', 'validation_pending')
    );
$function$;

revoke all on function "public"."payroll_capture_storage_insert_allowed_unscoped_internal"(p_name text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_capture_storage_insert_allowed_unscoped_internal"(p_name text) to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_capture_storage_insert_allowed(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.payroll_capture_company_access(case when p_name ~ '^[0-9a-f-]{36}/' then split_part(p_name,'/',1)::uuid else null end)
    and public.payroll_capture_storage_insert_allowed_unscoped_internal(p_name);
$function$;

revoke all on function "public"."payroll_capture_storage_insert_allowed"(p_name text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_capture_storage_insert_allowed"(p_name text) to "authenticated";

grant EXECUTE on function "public"."payroll_capture_storage_insert_allowed"(p_name text) to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_capture_storage_select_allowed_unscoped_internal(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.payroll_has_capture_access() and exists (
    select 1 from public.payroll_capture_files f
    join public.payroll_capture_sessions s on s.id=f.session_id
    where f.storage_path=p_name and f.storage_bucket='payroll-private'
      and f.upload_state='uploaded' and f.is_current
      and (
        (s.expires_at>now() and s.capture_state<>'materialized')
        or (s.capture_state='materialized' and exists(
          select 1 from public.payroll_run_files rf where rf.capture_file_id=f.id
        ))
      )
  );
$function$;

revoke all on function "public"."payroll_capture_storage_select_allowed_unscoped_internal"(p_name text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_capture_storage_select_allowed_unscoped_internal"(p_name text) to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_capture_storage_select_allowed(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.payroll_capture_company_access(case when p_name ~ '^[0-9a-f-]{36}/' then split_part(p_name,'/',1)::uuid else null end)
    and public.payroll_capture_storage_select_allowed_unscoped_internal(p_name);
$function$;

revoke all on function "public"."payroll_capture_storage_select_allowed"(p_name text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_capture_storage_select_allowed"(p_name text) to "authenticated";

grant EXECUTE on function "public"."payroll_capture_storage_select_allowed"(p_name text) to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_enforce_request_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request_id uuid;
  v_request_type text;
  v_request_amount numeric;
  v_channel_count integer;
  v_channel_total numeric;
begin
  if tg_relid = 'public.payment_requests'::regclass then
    if tg_op not in ('INSERT', 'UPDATE') then
      raise exception 'payroll_total_guard_unexpected_payment_request_op';
    end if;

    v_request_id := nullif(to_jsonb(new) ->> 'id', '')::uuid;
  elsif tg_relid = 'public.payroll_channels'::regclass then
    if tg_op = 'DELETE' then
      v_request_id :=
        nullif(to_jsonb(old) ->> 'payment_request_id', '')::uuid;
    elsif tg_op in ('INSERT', 'UPDATE') then
      v_request_id :=
        nullif(to_jsonb(new) ->> 'payment_request_id', '')::uuid;
    else
      raise exception 'payroll_total_guard_unexpected_payroll_channel_op';
    end if;
  else
    raise exception 'payroll_total_guard_unexpected_trigger_source';
  end if;

  if v_request_id is null then
    raise exception 'payroll_total_guard_request_id_missing';
  end if;

  select request.request_type::text, request.amount_requested
    into v_request_type, v_request_amount
  from public.payment_requests request
  where request.id = v_request_id;

  if not found then
    return null;
  end if;

  select count(*), coalesce(sum(channel.amount), 0)
    into v_channel_count, v_channel_total
  from public.payroll_channels channel
  where channel.payment_request_id = v_request_id;

  if v_request_type <> 'nomina' then
    if v_channel_count > 0 then
      raise exception 'payroll_channels_require_nomina_request';
    end if;
    return null;
  end if;

  if v_channel_count = 0 or v_channel_total <> v_request_amount then
    raise exception 'payroll_total_mismatch';
  end if;

  return null;
end;
$function$;

revoke all on function "public"."payroll_enforce_request_total"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_enforce_request_total"() to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_force_non_budget_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_category_id uuid;
begin
  if new.request_type::text <> 'nomina' then
    return new;
  end if;

  select id into v_category_id
  from public.budget_categories
  where code='PAYROLL_NON_BUDGET' and active and no_presupuestal
  limit 1;

  if v_category_id is null then
    raise exception 'PAYROLL_NON_BUDGET_CATEGORY_REQUIRED';
  end if;

  new.budget_category_id := v_category_id;
  new.budget_month := date_trunc('month',coalesce(new.payroll_period_start,current_date))::date;
  return new;
end;
$function$;

revoke all on function "public"."payroll_force_non_budget_context"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_force_non_budget_context"() to "authenticated";

grant EXECUTE on function "public"."payroll_force_non_budget_context"() to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_redacted_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_entity_id uuid;
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_changed_fields text[];
begin
  v_entity_id := case when tg_op = 'DELETE' then old.id else new.id end;

  select coalesce(array_agg(field_name order by field_name), array[]::text[])
    into v_changed_fields
  from (
    select field_name
    from (
      select jsonb_object_keys(v_old) as field_name
      union
      select jsonb_object_keys(v_new) as field_name
    ) fields
    where v_old -> field_name is distinct from v_new -> field_name
  ) changed;

  insert into public.activity_log (
    entity_type,
    entity_id,
    action,
    old_values,
    new_values,
    performed_by,
    notes
  ) values (
    tg_table_name,
    v_entity_id,
    lower(tg_op),
    null,
    jsonb_build_object(
      'redacted', true,
      'changed_fields', to_jsonb(v_changed_fields)
    ),
    public.current_profile_id(),
    'Payroll audit stores field names only; PII and monetary values are redacted.'
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function "public"."payroll_redacted_audit"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_redacted_audit"() to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_reject_normal_layout_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if exists (
    select 1
    from public.payment_requests request
    where request.id = new.payment_request_id
      and request.request_type::text = 'nomina'
  ) then
    raise exception 'payroll_external_layout_required';
  end if;

  return new;
end;
$function$;

revoke all on function "public"."payroll_reject_normal_layout_line"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_reject_normal_layout_line"() to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_run_file_storage_insert_allowed(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.payroll_has_finance_pii_access()
    and p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
    and exists (
      select 1 from public.payroll_run_files file
      join public.payroll_channels channel on channel.id=file.payroll_channel_id
      join public.payment_requests request on request.id=file.payment_request_id
      where file.storage_bucket='payroll-private' and file.storage_path=p_name and file.kind='comprobante'
        and file.parsing_status='pending' and file.parsing_version is null
        and channel.payment_request_id=request.id and channel.dispersion_status='dispersed' and channel.reconciliation_status='pending'
        and request.request_type::text='nomina' and request.status::text='approved'
        and public.payroll_request_has_valid_materialization(request.id)
        and public.payroll_active_company_access(request.company_id)
    );
$function$;

revoke all on function "public"."payroll_run_file_storage_insert_allowed"(p_name text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_run_file_storage_insert_allowed"(p_name text) to "service_role";

grant EXECUTE on function "public"."payroll_run_file_storage_insert_allowed"(p_name text) to "authenticated";

CREATE OR REPLACE FUNCTION public.payroll_storage_company_access(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company_id uuid;
begin
  if p_name is null or p_name !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then
    return false;
  end if;

  v_company_id := split_part(p_name, '/', 1)::uuid;
  return public.payroll_active_company_access(v_company_id);
end;
$function$;

revoke all on function "public"."payroll_storage_company_access"(p_name text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_storage_company_access"(p_name text) to "authenticated";

grant EXECUTE on function "public"."payroll_storage_company_access"(p_name text) to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_validate_channel_parent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request public.payment_requests%rowtype;
  v_layout_file public.payroll_run_files%rowtype;
begin
  select * into v_request
  from public.payment_requests
  where id = new.payment_request_id;

  if not found or v_request.request_type::text <> 'nomina' then
    raise exception 'payroll_channel_parent_must_be_nomina';
  end if;

  if new.currency <> upper(v_request.currency) then
    raise exception 'payroll_channel_currency_mismatch';
  end if;

  if new.layout_file_id is not null then
    select * into v_layout_file
    from public.payroll_run_files
    where id = new.layout_file_id;

    if not found
       or v_layout_file.payment_request_id <> new.payment_request_id
       or v_layout_file.payroll_channel_id <> new.id
       or (new.channel = 'banco' and v_layout_file.kind <> 'layout_mismo_banco')
       or (new.channel = 'spei' and v_layout_file.kind <> 'layout_spei')
       or (new.channel = 'vales' and v_layout_file.kind <> 'layout_toka') then
      raise exception 'payroll_channel_layout_file_mismatch';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function "public"."payroll_validate_channel_parent"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_validate_channel_parent"() to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_validate_file_parent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request_type text;
  v_channel text;
  v_channel_request_id uuid;
begin
  select request.request_type::text into v_request_type
  from public.payment_requests request
  where request.id = new.payment_request_id;

  if v_request_type is distinct from 'nomina' then
    raise exception 'payroll_file_parent_must_be_nomina';
  end if;

  if new.payroll_channel_id is not null then
    select channel.channel, channel.payment_request_id
      into v_channel, v_channel_request_id
    from public.payroll_channels channel
    where channel.id = new.payroll_channel_id;

    if v_channel_request_id is distinct from new.payment_request_id
       or (new.kind = 'layout_mismo_banco' and v_channel <> 'banco')
       or (new.kind = 'layout_spei' and v_channel <> 'spei')
       or (new.kind in ('layout_toka', 'cfdi_vales') and v_channel <> 'vales') then
      raise exception 'payroll_file_channel_mismatch';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function "public"."payroll_validate_file_parent"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_validate_file_parent"() to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_validate_line_parent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request_type text;
  v_file_request_id uuid;
  v_file_kind text;
begin
  select request.request_type::text into v_request_type
  from public.payment_requests request
  where request.id = new.payment_request_id;

  select file.payment_request_id, file.kind
    into v_file_request_id, v_file_kind
  from public.payroll_run_files file
  where file.id = new.source_file_id;

  if v_request_type is distinct from 'nomina'
     or v_file_request_id is distinct from new.payment_request_id
     or v_file_kind is distinct from 'caratula' then
    raise exception 'payroll_line_source_must_be_request_caratula';
  end if;

  return new;
end;
$function$;

revoke all on function "public"."payroll_validate_line_parent"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_validate_line_parent"() to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_validate_materialized_capture_file()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_capture public.payroll_capture_files%rowtype;
  v_session public.payroll_capture_sessions%rowtype;
  v_request public.payment_requests%rowtype;
begin
  if new.capture_file_id is null then return new; end if;
  select * into v_capture from public.payroll_capture_files where id = new.capture_file_id;
  select * into v_session from public.payroll_capture_sessions where id = v_capture.session_id;
  select * into v_request from public.payment_requests where id = new.payment_request_id;
  if not found
     or v_capture.upload_state <> 'uploaded' or not v_capture.is_current
     or v_capture.storage_bucket <> new.storage_bucket
     or v_capture.storage_path <> new.storage_path
     or v_capture.size_bytes <> new.size_bytes
     or v_capture.sha256 <> new.sha256
     or v_session.reserved_payment_request_id <> new.payment_request_id
     or v_session.company_id <> v_request.company_id
     or split_part(new.storage_path,'/',1) <> v_session.company_id::text
     or split_part(new.storage_path,'/',2) <> new.payment_request_id::text then
    raise exception 'payroll_capture_file_provenance_mismatch';
  end if;
  return new;
end;
$function$;

revoke all on function "public"."payroll_validate_materialized_capture_file"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_validate_materialized_capture_file"() to "service_role";

CREATE OR REPLACE FUNCTION public.payroll_validate_request_contract()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.request_type::text <> 'nomina' then
    return new;
  end if;

  if new.currency <> upper(new.currency)
     or not exists (
       select 1
       from public.company_bank_accounts account
       where account.id = new.company_bank_account_id
         and account.company_id = new.company_id
         and coalesce(account.active, true)
     ) then
    raise exception 'payroll_source_account_not_active_for_company';
  end if;

  return new;
end;
$function$;

revoke all on function "public"."payroll_validate_request_contract"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."payroll_validate_request_contract"() to "service_role";

CREATE OR REPLACE FUNCTION public.reconcile_payroll_channel(p_payment_request_id uuid, p_payroll_channel_id uuid, p_receipt_file_id uuid, p_receipt_amount numeric, p_payment_date date, p_reference_hint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_channel public.payroll_channels%rowtype; v_file public.payroll_run_files%rowtype; v_reference text:=nullif(btrim(coalesce(p_reference_hint,'')),'');
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.status::text<>'approved' then raise exception 'PAYROLL_RECONCILIATION_REQUIRES_APPROVED_REQUEST'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_RECONCILIATION_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_RECONCILIATION_MATERIALIZATION_REQUIRED'; end if;
  select * into v_channel from public.payroll_channels where id=p_payroll_channel_id and payment_request_id=v_request.id for update;
  if not found then raise exception 'PAYROLL_RECONCILIATION_CHANNEL_REQUIRED'; end if;
  if v_channel.reconciliation_status='reconciled' then
    if v_channel.receipt_file_id=p_receipt_file_id and v_channel.receipt_amount=p_receipt_amount and v_channel.receipt_payment_date=p_payment_date and v_channel.receipt_reference_hint=v_reference then return jsonb_build_object('result','already_reconciled','summary',public.get_payroll_reconciliation_summary(v_request.id)); end if;
    raise exception 'PAYROLL_RECONCILIATION_ALREADY_FINAL';
  end if;
  if v_channel.reconciliation_status<>'pending' then raise exception 'PAYROLL_RECONCILIATION_STATUS_INVALID'; end if;
  if v_channel.dispersion_status<>'dispersed' then raise exception 'PAYROLL_RECONCILIATION_REQUIRES_DISPERSED_CHANNEL'; end if;
  select * into v_file from public.payroll_run_files where id=p_receipt_file_id and payment_request_id=v_request.id and payroll_channel_id=v_channel.id and kind='comprobante';
  if not found or v_file.parsing_status<>'parsed' or v_file.parsing_version<>'payroll-channel-receipt-v1' then raise exception 'PAYROLL_RECONCILIATION_VERIFIED_RECEIPT_REQUIRED'; end if;
  if p_receipt_amount is null or p_receipt_amount<>v_channel.amount then raise exception 'PAYROLL_RECONCILIATION_AMOUNT_MISMATCH'; end if;
  if p_payment_date is null or p_payment_date>current_date+1 then raise exception 'PAYROLL_RECONCILIATION_PAYMENT_DATE_INVALID'; end if;
  if v_reference is null or length(v_reference)<3 or length(v_reference)>120 then raise exception 'PAYROLL_RECONCILIATION_REFERENCE_REQUIRED'; end if;
  update public.payroll_channels set reconciliation_status='reconciled',reconciled_at=now(),reconciled_by=v_actor,reconciliation_note=null,receipt_file_id=v_file.id,receipt_amount=p_receipt_amount,receipt_payment_date=p_payment_date,receipt_reference_hint=v_reference where id=v_channel.id;
  return jsonb_build_object('result','reconciled','summary',public.get_payroll_reconciliation_summary(v_request.id));
end; $function$;

revoke all on function "public"."reconcile_payroll_channel"(p_payment_request_id uuid, p_payroll_channel_id uuid, p_receipt_file_id uuid, p_receipt_amount numeric, p_payment_date date, p_reference_hint text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."reconcile_payroll_channel"(p_payment_request_id uuid, p_payroll_channel_id uuid, p_receipt_file_id uuid, p_receipt_amount numeric, p_payment_date date, p_reference_hint text) to "authenticated";

grant EXECUTE on function "public"."reconcile_payroll_channel"(p_payment_request_id uuid, p_payroll_channel_id uuid, p_receipt_file_id uuid, p_receipt_amount numeric, p_payment_date date, p_reference_hint text) to "service_role";

CREATE OR REPLACE FUNCTION public.record_payroll_channel_dispersion(p_payment_request_id uuid, p_payroll_channel_id uuid, p_action text, p_failure_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_channel public.payroll_channels%rowtype; v_action text:=lower(btrim(coalesce(p_action,''))); v_note text:=nullif(btrim(coalesce(p_failure_note,'')),''); v_result text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  if v_action not in ('dispersed','failed') then raise exception 'PAYROLL_DISPERSION_ACTION_INVALID'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.status::text<>'approved' then raise exception 'PAYROLL_FINANCE_CONFIRMATION_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_DISPERSION_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_DISPERSION_MATERIALIZATION_REQUIRED'; end if;
  if not public.payroll_ready_for_dispersion(v_request.id) then raise exception 'PAYROLL_FINANCE_CONFIRMATION_REQUIRED'; end if;
  select * into v_channel from public.payroll_channels where id=p_payroll_channel_id and payment_request_id=v_request.id for update;
  if not found then raise exception 'PAYROLL_DISPERSION_CHANNEL_REQUIRED'; end if;
  if v_channel.reconciliation_status<>'pending' then raise exception 'PAYROLL_DISPERSION_RECONCILIATION_ALREADY_STARTED'; end if;
  if v_channel.dispersion_status='dispersed' then if v_action='dispersed' then return jsonb_build_object('result','already_dispersed','summary',public.get_payroll_dispersion_summary(v_request.id)); end if; raise exception 'PAYROLL_DISPERSION_ALREADY_FINAL'; end if;
  if v_action='failed' then
    if v_note is null or length(v_note)<3 or length(v_note)>500 then raise exception 'PAYROLL_DISPERSION_FAILURE_NOTE_REQUIRED'; end if;
    if v_channel.dispersion_status='failed' then if v_channel.dispersion_note=v_note then return jsonb_build_object('result','already_failed','summary',public.get_payroll_dispersion_summary(v_request.id)); end if; raise exception 'PAYROLL_DISPERSION_FAILURE_ALREADY_RECORDED'; end if;
    update public.payroll_channels set dispersion_status='failed',dispersed_at=now(),dispersed_by=v_actor,dispersion_note=v_note where id=v_channel.id; v_result:='failed_recorded';
  else
    if v_note is not null then raise exception 'PAYROLL_DISPERSION_NOTE_ONLY_FOR_FAILURE'; end if;
    update public.payroll_channels set dispersion_status='dispersed',dispersed_at=now(),dispersed_by=v_actor,dispersion_note=null where id=v_channel.id; v_result:='dispersed';
  end if;
  return jsonb_build_object('result',v_result,'summary',public.get_payroll_dispersion_summary(v_request.id));
end; $function$;

revoke all on function "public"."record_payroll_channel_dispersion"(p_payment_request_id uuid, p_payroll_channel_id uuid, p_action text, p_failure_note text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."record_payroll_channel_dispersion"(p_payment_request_id uuid, p_payroll_channel_id uuid, p_action text, p_failure_note text) to "authenticated";

grant EXECUTE on function "public"."record_payroll_channel_dispersion"(p_payment_request_id uuid, p_payroll_channel_id uuid, p_action text, p_failure_note text) to "service_role";

CREATE OR REPLACE FUNCTION public.reserve_payroll_capture_file_unscoped_internal(p_session_id uuid, p_expected_version integer, p_kind text, p_extension text, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_parser_version text, p_parser_contract text, p_record_count integer, p_total_amount_minor bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare
  v_actor uuid:=public.current_profile_id();
  v_session public.payroll_capture_sessions%rowtype;
  v_file_id uuid:=gen_random_uuid();
  v_channel text;
  v_path text;
  v_server_only boolean:=false;
begin
  if v_actor is null or not public.payroll_has_capture_access() then raise exception 'payroll_capture_finance_required'; end if;
  select * into v_session from public.payroll_capture_sessions where id=p_session_id for update;
  if not found then raise exception 'payroll_capture_session_not_found'; end if;
  if v_session.expires_at<=now() then raise exception 'payroll_capture_session_expired'; end if;
  if p_expected_version is null or v_session.version<>p_expected_version then raise exception 'payroll_capture_version_conflict'; end if;
  if p_size_bytes not between 1 and 26214400 or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'payroll_capture_file_metadata_invalid'; end if;

  case p_kind
    when 'caratula' then
      if p_extension<>'xlsx' or p_mime_type<>'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then
        raise exception 'payroll_capture_cover_validation_required';
      end if;
      v_channel:=null; v_server_only:=true;
    when 'layout_mismo_banco' then
      if not ('banco'=any(v_session.expected_channels)) or p_extension<>'txt' or p_mime_type<>'text/plain' then
        raise exception 'payroll_capture_same_bank_validation_required';
      end if;
      v_channel:='banco'; v_server_only:=true;
    when 'layout_spei' then
      if not ('spei'=any(v_session.expected_channels)) or p_extension<>'txt' or p_mime_type<>'text/plain'
         or p_parser_version is distinct from 'payroll-normalized-v1'
         or p_parser_contract is distinct from 'bbva-simulator-pagos-interbancarios-128-v1'
         or coalesce(p_record_count,0)<=0 or coalesce(p_total_amount_minor,0)<=0 then
        raise exception 'payroll_capture_spei_validation_required';
      end if;
      v_channel:='spei';
    when 'layout_toka' then
      if not ('vales'=any(v_session.expected_channels)) or p_extension<>'txt' or p_mime_type<>'text/plain' then
        raise exception 'payroll_capture_toka_funding_validation_required';
      end if;
      v_channel:='vales'; v_server_only:=true;
    when 'cfdi_vales' then
      if not ('vales'=any(v_session.expected_channels)) or p_extension<>'xml' or p_mime_type not in ('application/xml','text/xml') then
        raise exception 'payroll_capture_toka_cfdi_validation_required';
      end if;
      v_channel:='vales'; v_server_only:=true;
    else
      raise exception 'payroll_capture_file_kind_unsupported';
  end case;

  if v_server_only and (
    p_parser_version is not null or p_parser_contract is not null
    or p_record_count is not null or p_total_amount_minor is not null
  ) then
    raise exception 'payroll_capture_server_only_parser_metadata_forbidden';
  end if;

  v_path:=concat(v_session.company_id::text,'/',v_session.reserved_payment_request_id::text,'/',v_file_id::text,'.',p_extension);
  insert into public.payroll_capture_files(
    id,session_id,kind,channel,storage_path,extension,mime_type,size_bytes,sha256,
    capability_code,parsing_status,validation_authority,parser_version,parser_contract,
    record_count,total_amount_minor,issue_codes,reserved_by
  ) values(
    v_file_id,v_session.id,p_kind,v_channel,v_path,p_extension,p_mime_type,p_size_bytes,p_sha256,
    'supported_certified',
    case when v_server_only then 'server_verification_pending' else 'client_parsed_unverified' end,
    case when v_server_only then 'server_only' else 'browser_client_attested' end,
    case when v_server_only then null else p_parser_version end,
    case when v_server_only then null else p_parser_contract end,
    case when v_server_only then null else p_record_count end,
    case when v_server_only then null else p_total_amount_minor end,
    array[]::text[],v_actor
  );

  return jsonb_build_object('file_id',v_file_id,'storage_bucket','payroll-private','storage_path',v_path);
end;
$function$;

revoke all on function "public"."reserve_payroll_capture_file_unscoped_internal"(p_session_id uuid, p_expected_version integer, p_kind text, p_extension text, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_parser_version text, p_parser_contract text, p_record_count integer, p_total_amount_minor bigint) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."reserve_payroll_capture_file_unscoped_internal"(p_session_id uuid, p_expected_version integer, p_kind text, p_extension text, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_parser_version text, p_parser_contract text, p_record_count integer, p_total_amount_minor bigint) to "service_role";

CREATE OR REPLACE FUNCTION public.reserve_payroll_capture_file(p_session_id uuid, p_expected_version integer, p_kind text, p_extension text, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_parser_version text, p_parser_contract text, p_record_count integer, p_total_amount_minor bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company_id uuid;
begin
  select company_id into v_company_id
  from public.payroll_capture_sessions
  where id = p_session_id;

  if v_company_id is null then
    raise exception 'PAYROLL_CAPTURE_SESSION_NOT_FOUND';
  end if;
  if not public.payroll_capture_company_access(v_company_id) then
    raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
  end if;

  return public.reserve_payroll_capture_file_unscoped_internal(
    p_session_id,
    p_expected_version,
    p_kind,
    p_extension,
    p_mime_type,
    p_size_bytes,
    p_sha256,
    p_parser_version,
    p_parser_contract,
    p_record_count,
    p_total_amount_minor
  );
end;
$function$;

revoke all on function "public"."reserve_payroll_capture_file"(p_session_id uuid, p_expected_version integer, p_kind text, p_extension text, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_parser_version text, p_parser_contract text, p_record_count integer, p_total_amount_minor bigint) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."reserve_payroll_capture_file"(p_session_id uuid, p_expected_version integer, p_kind text, p_extension text, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_parser_version text, p_parser_contract text, p_record_count integer, p_total_amount_minor bigint) to "authenticated";

grant EXECUTE on function "public"."reserve_payroll_capture_file"(p_session_id uuid, p_expected_version integer, p_kind text, p_extension text, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_parser_version text, p_parser_contract text, p_record_count integer, p_total_amount_minor bigint) to "service_role";

CREATE OR REPLACE FUNCTION public.reserve_payroll_channel_receipt(p_payment_request_id uuid, p_payroll_channel_id uuid, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_original_filename text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_channel public.payroll_channels%rowtype; v_file_id uuid:=gen_random_uuid(); v_filename text:=btrim(coalesce(p_original_filename,'')); v_path text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.status::text<>'approved' then raise exception 'PAYROLL_RECEIPT_REQUIRES_APPROVED_REQUEST'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_RECEIPT_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_RECEIPT_MATERIALIZATION_REQUIRED'; end if;
  select * into v_channel from public.payroll_channels where id=p_payroll_channel_id and payment_request_id=v_request.id for update;
  if not found then raise exception 'PAYROLL_RECEIPT_CHANNEL_REQUIRED'; end if;
  if v_channel.dispersion_status<>'dispersed' then raise exception 'PAYROLL_RECEIPT_REQUIRES_DISPERSED_CHANNEL'; end if;
  if v_channel.reconciliation_status<>'pending' then raise exception 'PAYROLL_RECEIPT_RECONCILIATION_ALREADY_STARTED'; end if;
  if lower(btrim(coalesce(p_mime_type,'')))<>'application/pdf' then raise exception 'PAYROLL_RECEIPT_PDF_REQUIRED'; end if;
  if p_size_bytes is null or p_size_bytes<100 or p_size_bytes>10485760 then raise exception 'PAYROLL_RECEIPT_SIZE_INVALID'; end if;
  if lower(coalesce(p_sha256,'')) !~ '^[0-9a-f]{64}$' then raise exception 'PAYROLL_RECEIPT_SHA256_INVALID'; end if;
  if length(v_filename)<1 or length(v_filename)>180 or position('/' in v_filename)>0 or position(chr(92) in v_filename)>0 or v_filename ~ '[[:cntrl:]]' then raise exception 'PAYROLL_RECEIPT_FILENAME_INVALID'; end if;
  v_path:=v_request.id::text||'/'||v_file_id::text||'.pdf';
  insert into public.payroll_run_files(id,payment_request_id,payroll_channel_id,kind,storage_bucket,storage_path,original_filename,mime_type,size_bytes,sha256,uploaded_by,parsing_status,parsing_version,parsing_metadata,capture_file_id)
  values(v_file_id,v_request.id,v_channel.id,'comprobante','payroll-private',v_path,v_filename,'application/pdf',p_size_bytes,lower(p_sha256),v_actor,'pending',null,'{}'::jsonb,null);
  return jsonb_build_object('run_file_id',v_file_id,'storage_bucket','payroll-private','storage_path',v_path,'mime_type','application/pdf','size_bytes',p_size_bytes,'sha256',lower(p_sha256));
end; $function$;

revoke all on function "public"."reserve_payroll_channel_receipt"(p_payment_request_id uuid, p_payroll_channel_id uuid, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_original_filename text) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."reserve_payroll_channel_receipt"(p_payment_request_id uuid, p_payroll_channel_id uuid, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_original_filename text) to "authenticated";

grant EXECUTE on function "public"."reserve_payroll_channel_receipt"(p_payment_request_id uuid, p_payroll_channel_id uuid, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_original_filename text) to "service_role";

CREATE OR REPLACE FUNCTION public.save_payroll_capture_session_unscoped_internal(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_session public.payroll_capture_sessions%rowtype;
begin
  if v_actor is null or not public.payroll_has_capture_access() then
    raise exception 'payroll_capture_finance_required';
  end if;

  if p_company_id is null
     or p_company_bank_account_id is null
     or p_payroll_subtype not in ('ordinaria', 'extraordinaria')
     or p_period_start is null
     or p_period_end is null
     or p_period_start > p_period_end
     or char_length(btrim(coalesce(p_concept, ''))) not between 3 and 500
     or char_length(coalesce(p_notes, '')) > 2000
     or not public.payroll_capture_channels_valid(p_expected_channels) then
    raise exception 'payroll_capture_metadata_invalid';
  end if;

  if not exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and coalesce(company.active, true)
  ) or not exists (
    select 1
    from public.company_bank_accounts account
    where account.id = p_company_bank_account_id
      and account.company_id = p_company_id
      and coalesce(account.active, true)
      and account.account_type::text = 'bank'
      and account.currency = 'MXN'
  ) then
    raise exception 'payroll_capture_source_account_invalid';
  end if;

  if p_session_id is null then
    if p_expected_version is not null then
      raise exception 'payroll_capture_version_must_be_null_for_create';
    end if;

    insert into public.payroll_capture_sessions (
      company_id,
      company_bank_account_id,
      payroll_subtype,
      period_start,
      period_end,
      concept,
      notes,
      expected_channels,
      created_by,
      updated_by
    ) values (
      p_company_id,
      p_company_bank_account_id,
      p_payroll_subtype,
      p_period_start,
      p_period_end,
      btrim(p_concept),
      nullif(btrim(coalesce(p_notes, '')), ''),
      p_expected_channels,
      v_actor,
      v_actor
    ) returning * into v_session;
  else
    select * into v_session
    from public.payroll_capture_sessions
    where id = p_session_id
    for update;

    if not found then
      raise exception 'payroll_capture_session_not_found';
    end if;
    if p_expected_version is null or v_session.version <> p_expected_version then
      raise exception 'payroll_capture_version_conflict';
    end if;
    if v_session.expires_at <= now() then
      raise exception 'payroll_capture_session_expired';
    end if;
    if p_company_id <> v_session.company_id
       and exists (
         select 1 from public.payroll_capture_files file
         where file.session_id = v_session.id
       ) then
      raise exception 'payroll_capture_company_locked_after_file_reservation';
    end if;
    if p_company_bank_account_id <> v_session.company_bank_account_id
       and exists (
         select 1 from public.payroll_capture_files file
         where file.session_id = v_session.id
           and file.kind = 'layout_spei'
       ) then
      raise exception 'payroll_capture_source_account_locked_after_spei';
    end if;
    if exists (
      select 1
      from public.payroll_capture_files file
      where file.session_id = v_session.id
        and file.channel is not null
        and not (file.channel = any(p_expected_channels))
    ) then
      raise exception 'payroll_capture_channel_locked_after_file_reservation';
    end if;

    update public.payroll_capture_sessions
    set company_id = p_company_id,
        company_bank_account_id = p_company_bank_account_id,
        payroll_subtype = p_payroll_subtype,
        period_start = p_period_start,
        period_end = p_period_end,
        concept = btrim(p_concept),
        notes = nullif(btrim(coalesce(p_notes, '')), ''),
        expected_channels = p_expected_channels,
        updated_by = v_actor,
        updated_at = now(),
        version = version + 1
    where id = p_session_id
    returning * into v_session;
  end if;

  perform public.payroll_capture_refresh_state(v_session.id);

  select * into v_session
  from public.payroll_capture_sessions
  where id = v_session.id;

  return jsonb_build_object(
    'id', v_session.id,
    'capture_state', v_session.capture_state,
    'validation_status', v_session.validation_status,
    'version', v_session.version
  );
end;
$function$;

revoke all on function "public"."save_payroll_capture_session_unscoped_internal"(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[]) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."save_payroll_capture_session_unscoped_internal"(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[]) to "service_role";

CREATE OR REPLACE FUNCTION public.save_payroll_capture_session(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing_company_id uuid;
begin
  if not public.payroll_capture_company_access(p_company_id) then
    raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
  end if;

  if p_session_id is not null then
    select company_id into v_existing_company_id
    from public.payroll_capture_sessions
    where id = p_session_id;

    if v_existing_company_id is null then
      raise exception 'PAYROLL_CAPTURE_SESSION_NOT_FOUND';
    end if;
    if not public.payroll_capture_company_access(v_existing_company_id) then
      raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
    end if;
  end if;

  return public.save_payroll_capture_session_unscoped_internal(
    p_session_id,
    p_expected_version,
    p_company_id,
    p_company_bank_account_id,
    p_payroll_subtype,
    p_period_start,
    p_period_end,
    p_concept,
    p_notes,
    p_expected_channels
  );
end;
$function$;

revoke all on function "public"."save_payroll_capture_session"(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[]) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."save_payroll_capture_session"(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[]) to "authenticated";

grant EXECUTE on function "public"."save_payroll_capture_session"(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[]) to "service_role";

CREATE OR REPLACE FUNCTION public.save_payroll_capture_session_n3g(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_cost_center_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_existing public.payroll_capture_sessions%rowtype;
  v_result jsonb;
  v_id uuid;
begin
  if v_actor is null or not public.payroll_has_capture_access() then
    raise exception 'payroll_capture_finance_required';
  end if;
  if p_cost_center_id is null or not exists (
    select 1
    from public.company_cost_centers ccc
    join public.cost_centers cc on cc.id=ccc.cost_center_id
    where ccc.company_id=p_company_id
      and ccc.cost_center_id=p_cost_center_id
      and ccc.active and cc.active
  ) then
    raise exception 'payroll_capture_cost_center_invalid';
  end if;

  if p_session_id is not null then
    select * into v_existing from public.payroll_capture_sessions where id=p_session_id for update;
    if not found then raise exception 'payroll_capture_session_not_found'; end if;
    if v_existing.capture_state='materialized' then raise exception 'payroll_capture_materialized_locked'; end if;
  end if;

  v_result := public.save_payroll_capture_session(
    p_session_id,p_expected_version,p_company_id,p_company_bank_account_id,
    p_payroll_subtype,p_period_start,p_period_end,p_concept,p_notes,p_expected_channels
  );
  v_id := (v_result->>'id')::uuid;

  update public.payroll_capture_sessions
  set cost_center_id=p_cost_center_id,
      updated_by=v_actor,
      updated_at=now()
  where id=v_id;

  return v_result || jsonb_build_object('cost_center_id',p_cost_center_id);
end;
$function$;

revoke all on function "public"."save_payroll_capture_session_n3g"(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_cost_center_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[]) from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."save_payroll_capture_session_n3g"(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_cost_center_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[]) to "authenticated";

grant EXECUTE on function "public"."save_payroll_capture_session_n3g"(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_cost_center_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[]) to "service_role";

CREATE OR REPLACE FUNCTION public.validate_payroll_submit_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_assignment public.approver_assignments%rowtype;
begin
  if old.request_type::text <> 'nomina'
     or new.request_type::text <> 'nomina'
     or old.status::text <> 'draft'
     or new.status::text <> 'submitted' then
    raise exception 'PAYROLL_INVALID_SUBMISSION_TRANSITION';
  end if;

  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'PAYROLL_FINANCE_REQUIRED';
  end if;
  if old.requested_by is distinct from v_actor then
    raise exception 'PAYROLL_SUBMIT_REQUESTER_REQUIRED';
  end if;
  if not public.has_active_company_membership(v_actor, old.company_id) then
    raise exception 'PAYROLL_SUBMIT_COMPANY_MEMBERSHIP_REQUIRED';
  end if;
  if not public.payroll_request_has_valid_materialization(old.id) then
    raise exception 'PAYROLL_VALID_MATERIALIZATION_REQUIRED';
  end if;

  if old.approver_id is not null
     or old.approver_assignment_id is not null
     or old.approver_selection_source is not null
     or old.submitted_at is not null then
    raise exception 'PAYROLL_APPROVER_ALREADY_SELECTED';
  end if;
  if new.approver_id is null
     or new.approver_selection_source is null
     or new.submitted_at is null then
    raise exception 'PAYROLL_APPROVER_SNAPSHOT_REQUIRED';
  end if;
  if new.approver_id = v_actor then
    raise exception 'requester_cannot_be_own_approver';
  end if;
  if new.approved_by is not null or new.approved_at is not null then
    raise exception 'PAYROLL_APPROVAL_TIMESTAMPS_NOT_ALLOWED_AT_SUBMIT';
  end if;

  if new.company_id is distinct from old.company_id
     or new.company_bank_account_id is distinct from old.company_bank_account_id
     or new.cost_center_id is distinct from old.cost_center_id
     or new.budget_category_id is distinct from old.budget_category_id
     or new.budget_month is distinct from old.budget_month
     or new.amount_requested is distinct from old.amount_requested
     or new.currency is distinct from old.currency
     or new.exchange_rate is distinct from old.exchange_rate
     or new.requested_by is distinct from old.requested_by
     or new.payroll_subtype is distinct from old.payroll_subtype
     or new.payroll_period_start is distinct from old.payroll_period_start
     or new.payroll_period_end is distinct from old.payroll_period_end
     or new.provider_id is distinct from old.provider_id
     or new.proveedor_id is distinct from old.proveedor_id
     or new.provider_bank_account_id is distinct from old.provider_bank_account_id
     or new.concept is distinct from old.concept
     or new.description is distinct from old.description
     or new.notes is distinct from old.notes then
    raise exception 'PAYROLL_MATERIALIZATION_IMMUTABLE_AT_SUBMIT';
  end if;

  if new.approver_assignment_id is not null then
    if new.approver_selection_source is distinct from 'assigned' then
      raise exception 'approver_assignment_source_mismatch';
    end if;
    select * into v_assignment
    from public.approver_assignments aa
    where aa.id = new.approver_assignment_id
      and aa.company_id = old.company_id
      and aa.requester_id = old.requested_by
      and aa.approver_id = new.approver_id
      and aa.active;
    if not found then
      raise exception 'approver_not_in_configured_pool';
    end if;
    if not public.is_payment_request_approver_for_company(new.approver_id, old.company_id) then
      raise exception 'configured_approver_no_longer_eligible';
    end if;
  else
    if new.approver_selection_source is distinct from 'approval_rules' then
      raise exception 'approver_selection_source_required';
    end if;
    if public.payment_request_has_active_approver_pool(old.requested_by, old.company_id) then
      raise exception 'approver_must_come_from_configured_pool';
    end if;
    if not public.is_payment_request_approver_for_company(new.approver_id, old.company_id) then
      raise exception 'approver_not_eligible_for_company';
    end if;
    if not public.payment_request_rule_allows(
      new.approver_id,
      old.company_id,
      old.cost_center_id,
      old.amount_requested,
      'approved'
    ) then
      raise exception 'approver_not_allowed_by_approval_rules';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function "public"."validate_payroll_submit_transition"() from PUBLIC, anon, authenticated, service_role;

grant EXECUTE on function "public"."validate_payroll_submit_transition"() to "service_role";

-- PROD grants Finance through company memberships. No global role is added.
create or replace function public.payroll_has_finance_pii_access()
returns boolean language sql stable security definer set search_path=''
as $$
  select public.current_profile_id() is not null and exists (
    select 1 from public.profile_company_memberships m
    where m.profile_id=public.current_profile_id() and m.active
      and public.has_active_company_membership(m.profile_id,m.company_id)
      and private.profile_has_company_role(m.profile_id,m.company_id,array['finance'])
  );
$$;

create function private.payroll_request_finance_access(p_request_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select public.current_profile_id() is not null and exists (
    select 1 from public.payment_requests r
    where r.id=p_request_id and r.request_type::text='nomina'
      and public.has_active_company_membership(public.current_profile_id(),r.company_id)
      and private.profile_has_company_role(public.current_profile_id(),r.company_id,array['finance'])
  );
$$;
revoke all on function private.payroll_request_finance_access(uuid) from PUBLIC,anon;
grant execute on function private.payroll_request_finance_access(uuid) to authenticated,service_role;

create or replace function public.payroll_can_read_summary(p_payment_request_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists (
    select 1 from public.payment_requests r
    where r.id=p_payment_request_id and r.request_type::text='nomina'
      and public.has_active_company_membership(public.current_profile_id(),r.company_id)
      and (private.payroll_profile_can_capture(public.current_profile_id(),r.company_id)
        or private.profile_has_company_role(public.current_profile_id(),r.company_id,array['director']))
  );
$$;

-- The tested implementations remain intact behind a company-specific entry gate.
alter function public.confirm_payroll_finance_review(uuid) set schema private;
revoke all on function private.confirm_payroll_finance_review(uuid) from PUBLIC,anon,authenticated;
create function public.confirm_payroll_finance_review(p_payment_request_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$ begin
  if not private.payroll_request_finance_access(p_payment_request_id) then raise exception 'PAYROLL_FINANCE_COMPANY_REQUIRED'; end if;
  return private.confirm_payroll_finance_review(p_payment_request_id);
end $$;

alter function public.acknowledge_payroll_toka_funding_variance(uuid,text) set schema private;
revoke all on function private.acknowledge_payroll_toka_funding_variance(uuid,text) from PUBLIC,anon,authenticated;
create function public.acknowledge_payroll_toka_funding_variance(p_payment_request_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=''
as $$ begin
  if not private.payroll_request_finance_access(p_payment_request_id) then raise exception 'PAYROLL_FINANCE_COMPANY_REQUIRED'; end if;
  return private.acknowledge_payroll_toka_funding_variance(p_payment_request_id,p_note);
end $$;

alter function public.record_payroll_channel_dispersion(uuid,uuid,text,text) set schema private;
revoke all on function private.record_payroll_channel_dispersion(uuid,uuid,text,text) from PUBLIC,anon,authenticated;
create function public.record_payroll_channel_dispersion(p_payment_request_id uuid,p_payroll_channel_id uuid,p_action text,p_failure_note text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$ begin
  if not private.payroll_request_finance_access(p_payment_request_id) then raise exception 'PAYROLL_FINANCE_COMPANY_REQUIRED'; end if;
  return private.record_payroll_channel_dispersion(p_payment_request_id,p_payroll_channel_id,p_action,p_failure_note);
end $$;

alter function public.reserve_payroll_channel_receipt(uuid,uuid,text,bigint,text,text) set schema private;
revoke all on function private.reserve_payroll_channel_receipt(uuid,uuid,text,bigint,text,text) from PUBLIC,anon,authenticated;
create function public.reserve_payroll_channel_receipt(p_payment_request_id uuid,p_payroll_channel_id uuid,p_mime_type text,p_size_bytes bigint,p_sha256 text,p_original_filename text)
returns jsonb language plpgsql security definer set search_path=''
as $$ begin
  if not private.payroll_request_finance_access(p_payment_request_id) then raise exception 'PAYROLL_FINANCE_COMPANY_REQUIRED'; end if;
  return private.reserve_payroll_channel_receipt(p_payment_request_id,p_payroll_channel_id,p_mime_type,p_size_bytes,p_sha256,p_original_filename);
end $$;

alter function public.get_payroll_receipt_verification_context(uuid) set schema private;
revoke all on function private.get_payroll_receipt_verification_context(uuid) from PUBLIC,anon,authenticated;
create function public.get_payroll_receipt_verification_context(p_run_file_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare request_id uuid; begin
  select payment_request_id into request_id from public.payroll_run_files where id=p_run_file_id;
  if not private.payroll_request_finance_access(request_id) then raise exception 'PAYROLL_FINANCE_COMPANY_REQUIRED'; end if;
  return private.get_payroll_receipt_verification_context(p_run_file_id);
end $$;

alter function public.reconcile_payroll_channel(uuid,uuid,uuid,numeric,date,text) set schema private;
revoke all on function private.reconcile_payroll_channel(uuid,uuid,uuid,numeric,date,text) from PUBLIC,anon,authenticated;
create function public.reconcile_payroll_channel(p_payment_request_id uuid,p_payroll_channel_id uuid,p_receipt_file_id uuid,p_receipt_amount numeric,p_payment_date date,p_reference_hint text)
returns jsonb language plpgsql security definer set search_path=''
as $$ begin
  if not private.payroll_request_finance_access(p_payment_request_id) then raise exception 'PAYROLL_FINANCE_COMPANY_REQUIRED'; end if;
  return private.reconcile_payroll_channel(p_payment_request_id,p_payroll_channel_id,p_receipt_file_id,p_receipt_amount,p_payment_date,p_reference_hint);
end $$;

alter function public.close_payroll_as_paid(uuid) set schema private;
revoke all on function private.close_payroll_as_paid(uuid) from PUBLIC,anon,authenticated;
create function public.close_payroll_as_paid(p_payment_request_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$ begin
  if not private.payroll_request_finance_access(p_payment_request_id) then raise exception 'PAYROLL_FINANCE_COMPANY_REQUIRED'; end if;
  return private.close_payroll_as_paid(p_payment_request_id);
end $$;

revoke all on function public.confirm_payroll_finance_review(uuid),
  public.acknowledge_payroll_toka_funding_variance(uuid,text),
  public.record_payroll_channel_dispersion(uuid,uuid,text,text),
  public.reserve_payroll_channel_receipt(uuid,uuid,text,bigint,text,text),
  public.get_payroll_receipt_verification_context(uuid),
  public.reconcile_payroll_channel(uuid,uuid,uuid,numeric,date,text),
  public.close_payroll_as_paid(uuid) from PUBLIC,anon;
grant execute on function public.confirm_payroll_finance_review(uuid),
  public.acknowledge_payroll_toka_funding_variance(uuid,text),
  public.record_payroll_channel_dispersion(uuid,uuid,text,text),
  public.reserve_payroll_channel_receipt(uuid,uuid,text,bigint,text,text),
  public.get_payroll_receipt_verification_context(uuid),
  public.reconcile_payroll_channel(uuid,uuid,uuid,numeric,date,text),
  public.close_payroll_as_paid(uuid) to authenticated,service_role;


alter table public."payroll_capture_files" add constraint "payroll_capture_files_bucket_check" CHECK (storage_bucket = 'payroll-private'::text);

alter table public."payroll_capture_files" add constraint "payroll_capture_files_capability_check" CHECK (kind = 'layout_spei'::text AND capability_code = 'supported_certified'::text AND parsing_status = 'client_parsed_unverified'::text AND validation_authority = 'browser_client_attested'::text OR (kind = ANY (ARRAY['caratula'::text, 'layout_mismo_banco'::text, 'layout_toka'::text, 'cfdi_vales'::text])) AND capability_code = 'supported_certified'::text AND parsing_status = 'server_verification_pending'::text AND validation_authority = 'server_only'::text);

alter table public."payroll_capture_files" add constraint "payroll_capture_files_channel_check" CHECK (kind = 'caratula'::text AND channel IS NULL OR kind = 'layout_mismo_banco'::text AND NOT channel IS DISTINCT FROM 'banco'::text OR kind = 'layout_spei'::text AND NOT channel IS DISTINCT FROM 'spei'::text OR (kind = ANY (ARRAY['layout_toka'::text, 'cfdi_vales'::text])) AND NOT channel IS DISTINCT FROM 'vales'::text);

alter table public."payroll_capture_files" add constraint "payroll_capture_files_extension_check" CHECK (extension = ANY (ARRAY['xlsx'::text, 'txt'::text, 'xml'::text]));

alter table public."payroll_capture_files" add constraint "payroll_capture_files_hash_check" CHECK (sha256 ~ '^[0-9a-f]{64}$'::text);

alter table public."payroll_capture_files" add constraint "payroll_capture_files_kind_check" CHECK (kind = ANY (ARRAY['caratula'::text, 'layout_mismo_banco'::text, 'layout_spei'::text, 'layout_toka'::text, 'cfdi_vales'::text]));

alter table public."payroll_capture_files" add constraint "payroll_capture_files_media_contract_check" CHECK (kind = 'caratula'::text AND extension = 'xlsx'::text AND mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text OR (kind = ANY (ARRAY['layout_mismo_banco'::text, 'layout_spei'::text, 'layout_toka'::text])) AND extension = 'txt'::text AND mime_type = 'text/plain'::text OR kind = 'cfdi_vales'::text AND extension = 'xml'::text AND (mime_type = ANY (ARRAY['application/xml'::text, 'text/xml'::text])));

alter table public."payroll_capture_files" add constraint "payroll_capture_files_mime_check" CHECK (mime_type = ANY (ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text, 'text/plain'::text, 'application/xml'::text, 'text/xml'::text]));

alter table public."payroll_capture_files" add constraint "payroll_capture_files_parser_check" CHECK (issue_codes = ARRAY[]::text[] AND (kind = 'layout_spei'::text AND parser_version = 'payroll-normalized-v1'::text AND parser_contract = 'bbva-simulator-pagos-interbancarios-128-v1'::text AND record_count IS NOT NULL AND record_count > 0 AND total_amount_minor IS NOT NULL AND total_amount_minor > 0 OR (kind = ANY (ARRAY['caratula'::text, 'layout_mismo_banco'::text, 'layout_toka'::text, 'cfdi_vales'::text])) AND parser_version IS NULL AND parser_contract IS NULL AND record_count IS NULL AND total_amount_minor IS NULL));

alter table public."payroll_capture_files" add constraint "payroll_capture_files_path_check" CHECK (storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'::text);

alter table public."payroll_capture_files" add constraint "payroll_capture_files_reserved_by_fkey" FOREIGN KEY (reserved_by) REFERENCES profiles(id) ON DELETE RESTRICT;

alter table public."payroll_capture_files" add constraint "payroll_capture_files_session_id_fkey" FOREIGN KEY (session_id) REFERENCES payroll_capture_sessions(id) ON DELETE RESTRICT;

alter table public."payroll_capture_files" add constraint "payroll_capture_files_size_check" CHECK (size_bytes >= 1 AND size_bytes <= 26214400);

alter table public."payroll_capture_files" add constraint "payroll_capture_files_upload_check" CHECK (upload_state = 'reserved'::text AND uploaded_by IS NULL AND uploaded_at IS NULL AND NOT is_current OR upload_state = 'uploaded'::text AND uploaded_by IS NOT NULL AND uploaded_at IS NOT NULL);

alter table public."payroll_capture_files" add constraint "payroll_capture_files_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE RESTRICT;

CREATE INDEX payroll_capture_files_session_kind_idx ON public.payroll_capture_files USING btree (session_id, kind, reserved_at DESC);

CREATE UNIQUE INDEX payroll_capture_files_current_kind_uidx ON public.payroll_capture_files USING btree (session_id, kind) WHERE is_current;

revoke all on table public."payroll_capture_files" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table public."payroll_capture_files" to "service_role";

grant SELECT on table public."payroll_capture_files" to "service_role";

grant UPDATE on table public."payroll_capture_files" to "service_role";

grant DELETE on table public."payroll_capture_files" to "service_role";

grant TRUNCATE on table public."payroll_capture_files" to "service_role";

grant REFERENCES on table public."payroll_capture_files" to "service_role";

grant TRIGGER on table public."payroll_capture_files" to "service_role";

grant MAINTAIN on table public."payroll_capture_files" to "service_role";

alter table public."payroll_capture_grants" add constraint "payroll_capture_grants_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

alter table public."payroll_capture_grants" add constraint "payroll_capture_grants_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

revoke all on table public."payroll_capture_grants" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table public."payroll_capture_grants" to "service_role";

grant SELECT on table public."payroll_capture_grants" to "service_role";

grant UPDATE on table public."payroll_capture_grants" to "service_role";

grant DELETE on table public."payroll_capture_grants" to "service_role";

grant TRUNCATE on table public."payroll_capture_grants" to "service_role";

grant REFERENCES on table public."payroll_capture_grants" to "service_role";

grant TRIGGER on table public."payroll_capture_grants" to "service_role";

grant MAINTAIN on table public."payroll_capture_grants" to "service_role";

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_budget_category_id_fkey" FOREIGN KEY (budget_category_id) REFERENCES budget_categories(id) ON DELETE RESTRICT;

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_budget_month_check" CHECK (budget_month IS NULL OR date_trunc('month'::text, budget_month::timestamp without time zone)::date = budget_month);

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_channels_check" CHECK (payroll_capture_channels_valid(expected_channels));

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_company_bank_account_id_fkey" FOREIGN KEY (company_bank_account_id) REFERENCES company_bank_accounts(id) ON DELETE RESTRICT;

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_concept_check" CHECK (char_length(btrim(concept)) >= 3 AND char_length(btrim(concept)) <= 500);

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_cost_center_id_fkey" FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id) ON DELETE RESTRICT;

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_expiry_check" CHECK (expires_at > created_at);

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_materialized_by_fkey" FOREIGN KEY (materialized_by) REFERENCES profiles(id) ON DELETE RESTRICT;

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_materialized_check" CHECK (capture_state <> 'materialized'::text AND materialized_payment_request_id IS NULL AND materialized_at IS NULL AND materialized_by IS NULL AND materialization_idempotency_hash IS NULL AND server_verification_summary IS NULL OR capture_state = 'materialized'::text AND validation_status = 'valid'::text AND materialized_payment_request_id IS NOT NULL AND materialized_at IS NOT NULL AND materialized_by IS NOT NULL AND materialization_idempotency_hash ~ '^[0-9a-f]{64}$'::text AND jsonb_typeof(server_verification_summary) = 'object'::text AND (server_verification_summary - ARRAY['contract_version'::text, 'file_count'::text, 'line_count'::text, 'parser_versions'::text, 'verified_at'::text, 'warning_codes'::text, 'finance_review_required'::text, 'provision_base_amount_minor'::text, 'provision_status'::text, 'provision_calculation_policy'::text, 'provision_policy_version'::text]) = '{}'::jsonb);

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_materialized_payment_request_id_fkey" FOREIGN KEY (materialized_payment_request_id) REFERENCES payment_requests(id) ON DELETE RESTRICT;

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_notes_check" CHECK (notes IS NULL OR char_length(notes) <= 2000);

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_period_check" CHECK (period_start <= period_end);

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_state_check" CHECK (capture_state = ANY (ARRAY['draft'::text, 'files_pending'::text, 'validation_pending'::text, 'ready_for_submission'::text, 'materialized'::text]));

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_subtype_check" CHECK (payroll_subtype = ANY (ARRAY['ordinaria'::text, 'extraordinaria'::text]));

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE RESTRICT;

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_validation_check" CHECK (validation_status = ANY (ARRAY['incomplete'::text, 'blocked'::text, 'valid'::text]));

alter table public."payroll_capture_sessions" add constraint "payroll_capture_sessions_version_check" CHECK (version > 0);

CREATE INDEX payroll_capture_sessions_budget_category_idx ON public.payroll_capture_sessions USING btree (budget_category_id) WHERE (budget_category_id IS NOT NULL);

CREATE INDEX payroll_capture_sessions_cost_center_idx ON public.payroll_capture_sessions USING btree (cost_center_id) WHERE (cost_center_id IS NOT NULL);

CREATE INDEX payroll_capture_sessions_actor_updated_idx ON public.payroll_capture_sessions USING btree (created_by, updated_at DESC);

CREATE INDEX payroll_capture_sessions_company_state_idx ON public.payroll_capture_sessions USING btree (company_id, capture_state, updated_at DESC);

revoke all on table public."payroll_capture_sessions" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table public."payroll_capture_sessions" to "service_role";

grant SELECT on table public."payroll_capture_sessions" to "service_role";

grant UPDATE on table public."payroll_capture_sessions" to "service_role";

grant DELETE on table public."payroll_capture_sessions" to "service_role";

grant TRUNCATE on table public."payroll_capture_sessions" to "service_role";

grant REFERENCES on table public."payroll_capture_sessions" to "service_role";

grant TRIGGER on table public."payroll_capture_sessions" to "service_role";

grant MAINTAIN on table public."payroll_capture_sessions" to "service_role";

alter table public."payroll_channels" add constraint "payroll_channels_amount_check" CHECK (amount > 0::numeric);

alter table public."payroll_channels" add constraint "payroll_channels_channel_check" CHECK (channel = ANY (ARRAY['banco'::text, 'spei'::text, 'vales'::text]));

alter table public."payroll_channels" add constraint "payroll_channels_currency_check" CHECK (currency = upper(currency) AND currency ~ '^[A-Z]{3}$'::text);

alter table public."payroll_channels" add constraint "payroll_channels_dispersed_by_fkey" FOREIGN KEY (dispersed_by) REFERENCES profiles(id);

alter table public."payroll_channels" add constraint "payroll_channels_dispersion_lifecycle_check" CHECK (dispersion_status = 'pending'::text AND dispersed_at IS NULL AND dispersed_by IS NULL AND dispersion_note IS NULL OR dispersion_status = 'dispersed'::text AND dispersed_at IS NOT NULL AND dispersed_by IS NOT NULL AND dispersion_note IS NULL OR dispersion_status = 'failed'::text AND dispersed_at IS NOT NULL AND dispersed_by IS NOT NULL AND NULLIF(btrim(dispersion_note), ''::text) IS NOT NULL);

alter table public."payroll_channels" add constraint "payroll_channels_dispersion_status_check" CHECK (dispersion_status = ANY (ARRAY['pending'::text, 'dispersed'::text, 'failed'::text]));

alter table public."payroll_channels" add constraint "payroll_channels_funding_variance_acknowledged_by_fkey" FOREIGN KEY (funding_variance_acknowledged_by) REFERENCES profiles(id);

alter table public."payroll_channels" add constraint "payroll_channels_layout_file_fkey" FOREIGN KEY (layout_file_id) REFERENCES payroll_run_files(id) ON DELETE SET NULL;

alter table public."payroll_channels" add constraint "payroll_channels_payment_request_id_fkey" FOREIGN KEY (payment_request_id) REFERENCES payment_requests(id) ON DELETE CASCADE;

alter table public."payroll_channels" add constraint "payroll_channels_receipt_file_id_fkey" FOREIGN KEY (receipt_file_id) REFERENCES payroll_run_files(id) ON DELETE SET NULL;

alter table public."payroll_channels" add constraint "payroll_channels_reconciled_by_fkey" FOREIGN KEY (reconciled_by) REFERENCES profiles(id);

alter table public."payroll_channels" add constraint "payroll_channels_reconciliation_lifecycle_check" CHECK (reconciliation_status = 'pending'::text AND reconciled_at IS NULL AND reconciled_by IS NULL AND reconciliation_note IS NULL OR reconciliation_status = 'reconciled'::text AND dispersion_status = 'dispersed'::text AND reconciled_at IS NOT NULL AND reconciled_by IS NOT NULL AND reconciliation_note IS NULL OR reconciliation_status = 'exception'::text AND reconciled_at IS NOT NULL AND reconciled_by IS NOT NULL AND NULLIF(btrim(reconciliation_note), ''::text) IS NOT NULL);

alter table public."payroll_channels" add constraint "payroll_channels_reconciliation_receipt_check" CHECK (reconciliation_status = 'pending'::text AND receipt_file_id IS NULL AND receipt_amount IS NULL AND receipt_payment_date IS NULL AND receipt_reference_hint IS NULL OR reconciliation_status = 'reconciled'::text AND receipt_file_id IS NOT NULL AND receipt_amount = amount AND receipt_payment_date IS NOT NULL AND NULLIF(btrim(receipt_reference_hint), ''::text) IS NOT NULL OR reconciliation_status = 'exception'::text);

alter table public."payroll_channels" add constraint "payroll_channels_reconciliation_status_check" CHECK (reconciliation_status = ANY (ARRAY['pending'::text, 'reconciled'::text, 'exception'::text]));

alter table public."payroll_channels" add constraint "payroll_channels_vales_breakdown_check" CHECK (channel <> 'vales'::text AND benefit_amount IS NULL AND fee_amount IS NULL AND tax_amount IS NULL AND expected_funding_amount IS NULL AND funding_variance_acknowledged_at IS NULL AND funding_variance_acknowledged_by IS NULL AND funding_variance_note IS NULL OR channel = 'vales'::text AND benefit_amount IS NOT NULL AND benefit_amount >= 0::numeric AND fee_amount IS NOT NULL AND fee_amount >= 0::numeric AND tax_amount IS NOT NULL AND tax_amount >= 0::numeric AND expected_funding_amount IS NOT NULL AND expected_funding_amount > 0::numeric AND expected_funding_amount = (benefit_amount + fee_amount + tax_amount) AND (amount = expected_funding_amount AND funding_variance_acknowledged_at IS NULL AND funding_variance_acknowledged_by IS NULL AND funding_variance_note IS NULL OR amount <> expected_funding_amount AND (funding_variance_acknowledged_at IS NULL AND funding_variance_acknowledged_by IS NULL AND funding_variance_note IS NULL OR funding_variance_acknowledged_at IS NOT NULL AND funding_variance_acknowledged_by IS NOT NULL AND NULLIF(btrim(funding_variance_note), ''::text) IS NOT NULL)));

CREATE UNIQUE INDEX payroll_channels_receipt_file_unique_idx ON public.payroll_channels USING btree (receipt_file_id) WHERE (receipt_file_id IS NOT NULL);

CREATE INDEX payroll_channels_request_reconciliation_idx ON public.payroll_channels USING btree (payment_request_id, reconciliation_status, channel);

revoke all on table public."payroll_channels" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table public."payroll_channels" to "service_role";

grant SELECT on table public."payroll_channels" to "service_role";

grant UPDATE on table public."payroll_channels" to "service_role";

grant DELETE on table public."payroll_channels" to "service_role";

grant TRUNCATE on table public."payroll_channels" to "service_role";

grant REFERENCES on table public."payroll_channels" to "service_role";

grant TRIGGER on table public."payroll_channels" to "service_role";

grant MAINTAIN on table public."payroll_channels" to "service_role";

grant SELECT on table public."payroll_channels" to "authenticated";

alter table public."payroll_notification_settings" add constraint "payroll_notification_settings_app_origin_check" CHECK (app_origin ~ '^https://[a-zA-Z0-9.-]+$'::text);

alter table public."payroll_notification_settings" add constraint "payroll_notification_settings_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

alter table public."payroll_notification_settings" add constraint "payroll_notification_settings_finance_recipient_profile_id_fkey" FOREIGN KEY (finance_recipient_profile_id) REFERENCES profiles(id);

alter table public."payroll_notification_settings" add constraint "payroll_notification_settings_test_capture_session_id_fkey" FOREIGN KEY (test_capture_session_id) REFERENCES payroll_capture_sessions(id);

alter table public."payroll_notification_settings" add constraint "payroll_notification_settings_test_recipient_profile_id_fkey" FOREIGN KEY (test_recipient_profile_id) REFERENCES profiles(id);

alter table public."payroll_notification_settings" add constraint "payroll_notification_test_scope_complete" CHECK (test_capture_session_id IS NULL AND test_recipient_profile_id IS NULL AND test_expires_at IS NULL OR test_capture_session_id IS NOT NULL AND test_recipient_profile_id IS NOT NULL AND test_expires_at IS NOT NULL);

revoke all on table public."payroll_notification_settings" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table public."payroll_notification_settings" to "service_role";

grant SELECT on table public."payroll_notification_settings" to "service_role";

grant UPDATE on table public."payroll_notification_settings" to "service_role";

grant DELETE on table public."payroll_notification_settings" to "service_role";

grant TRUNCATE on table public."payroll_notification_settings" to "service_role";

grant REFERENCES on table public."payroll_notification_settings" to "service_role";

grant TRIGGER on table public."payroll_notification_settings" to "service_role";

grant MAINTAIN on table public."payroll_notification_settings" to "service_role";

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_aguinaldo_amount_check" CHECK (aguinaldo_amount >= 0::numeric);

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_aguinaldo_factor_check" CHECK (aguinaldo_factor >= 0::numeric);

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_budget_category_id_fkey" FOREIGN KEY (budget_category_id) REFERENCES budget_categories(id);

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_budget_line_id_fkey" FOREIGN KEY (budget_line_id) REFERENCES budget_lines(id);

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_budget_version_id_fkey" FOREIGN KEY (budget_version_id) REFERENCES budget_versions(id);

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_calculation_policy_check" CHECK (calculation_policy = ANY (ARRAY['configured_components'::text, 'server_calculated_components'::text]));

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_check" CHECK (combined_factor = (aguinaldo_factor + vacation_premium_factor));

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_check1" CHECK (provision_amount = (aguinaldo_amount + vacation_premium_amount));

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_combined_factor_check" CHECK (combined_factor > 0::numeric AND combined_factor < 1::numeric);

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_cost_center_id_fkey" FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id);

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id);

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_payment_request_id_fkey" FOREIGN KEY (payment_request_id) REFERENCES payment_requests(id) ON DELETE RESTRICT;

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_provision_amount_check" CHECK (provision_amount > 0::numeric);

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_provision_base_amount_check" CHECK (provision_base_amount > 0::numeric);

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_vacation_premium_amount_check" CHECK (vacation_premium_amount >= 0::numeric);

alter table public."payroll_provision_entries" add constraint "payroll_provision_entries_vacation_premium_factor_check" CHECK (vacation_premium_factor >= 0::numeric);

revoke all on table public."payroll_provision_entries" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table public."payroll_provision_entries" to "service_role";

grant SELECT on table public."payroll_provision_entries" to "service_role";

grant UPDATE on table public."payroll_provision_entries" to "service_role";

grant DELETE on table public."payroll_provision_entries" to "service_role";

grant TRUNCATE on table public."payroll_provision_entries" to "service_role";

grant REFERENCES on table public."payroll_provision_entries" to "service_role";

grant TRIGGER on table public."payroll_provision_entries" to "service_role";

grant MAINTAIN on table public."payroll_provision_entries" to "service_role";

grant SELECT on table public."payroll_provision_entries" to "authenticated";

alter table public."payroll_provision_settings" add constraint "payroll_provision_settings_budget_category_id_fkey" FOREIGN KEY (budget_category_id) REFERENCES budget_categories(id);

alter table public."payroll_provision_settings" add constraint "payroll_provision_settings_calculation_policy_check" CHECK (calculation_policy = ANY (ARRAY['pending'::text, 'configured_components'::text, 'server_calculated_components'::text]));

alter table public."payroll_provision_settings" add constraint "payroll_provision_settings_check" CHECK (calculation_policy = 'pending'::text AND configured_aguinaldo_factor IS NULL AND configured_vacation_premium_factor IS NULL OR calculation_policy = 'server_calculated_components'::text AND configured_aguinaldo_factor IS NULL AND configured_vacation_premium_factor IS NULL OR calculation_policy = 'configured_components'::text AND configured_aguinaldo_factor IS NOT NULL AND configured_aguinaldo_factor >= 0::numeric AND configured_vacation_premium_factor IS NOT NULL AND configured_vacation_premium_factor >= 0::numeric AND (configured_aguinaldo_factor + configured_vacation_premium_factor) > 0::numeric AND (configured_aguinaldo_factor + configured_vacation_premium_factor) < 1::numeric);

alter table public."payroll_provision_settings" add constraint "payroll_provision_settings_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

alter table public."payroll_provision_settings" add constraint "payroll_provision_settings_posting_month_rule_check" CHECK (posting_month_rule = 'period_end_month'::text);

alter table public."payroll_provision_settings" add constraint "payroll_provision_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id);

revoke all on table public."payroll_provision_settings" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table public."payroll_provision_settings" to "service_role";

grant SELECT on table public."payroll_provision_settings" to "service_role";

grant UPDATE on table public."payroll_provision_settings" to "service_role";

grant DELETE on table public."payroll_provision_settings" to "service_role";

grant TRUNCATE on table public."payroll_provision_settings" to "service_role";

grant REFERENCES on table public."payroll_provision_settings" to "service_role";

grant TRIGGER on table public."payroll_provision_settings" to "service_role";

grant MAINTAIN on table public."payroll_provision_settings" to "service_role";

grant SELECT on table public."payroll_provision_settings" to "authenticated";

alter table public."payroll_run_files" add constraint "payroll_run_files_bucket_check" CHECK (storage_bucket = 'payroll-private'::text);

alter table public."payroll_run_files" add constraint "payroll_run_files_capture_file_id_fkey" FOREIGN KEY (capture_file_id) REFERENCES payroll_capture_files(id) ON DELETE RESTRICT;

alter table public."payroll_run_files" add constraint "payroll_run_files_channel_kind_check" CHECK ((kind = ANY (ARRAY['caratula'::text, 'cfdi_nomina'::text, 'otros'::text])) AND payroll_channel_id IS NULL OR (kind = ANY (ARRAY['layout_mismo_banco'::text, 'layout_spei'::text, 'layout_toka'::text, 'cfdi_vales'::text, 'comprobante'::text])) AND payroll_channel_id IS NOT NULL);

alter table public."payroll_run_files" add constraint "payroll_run_files_filename_check" CHECK (NULLIF(btrim(original_filename), ''::text) IS NOT NULL AND POSITION(('/'::text) IN (original_filename)) = 0 AND POSITION((chr(92)) IN (original_filename)) = 0 AND original_filename !~ '[[:cntrl:]]'::text);

alter table public."payroll_run_files" add constraint "payroll_run_files_hash_check" CHECK (sha256 ~ '^[0-9a-f]{64}$'::text);

alter table public."payroll_run_files" add constraint "payroll_run_files_kind_check" CHECK (kind = ANY (ARRAY['caratula'::text, 'layout_mismo_banco'::text, 'layout_spei'::text, 'layout_toka'::text, 'cfdi_vales'::text, 'comprobante'::text, 'cfdi_nomina'::text, 'otros'::text]));

alter table public."payroll_run_files" add constraint "payroll_run_files_metadata_check" CHECK (jsonb_typeof(parsing_metadata) = 'object'::text AND (parsing_metadata - ARRAY['evidence_class'::text, 'headers'::text, 'issue_codes'::text, 'parser_version'::text, 'row_count'::text, 'sheet_names'::text]) = '{}'::jsonb);

alter table public."payroll_run_files" add constraint "payroll_run_files_mime_check" CHECK (mime_type = ANY (ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text, 'text/plain'::text, 'application/xml'::text, 'text/xml'::text, 'application/pdf'::text]));

alter table public."payroll_run_files" add constraint "payroll_run_files_parsing_status_check" CHECK (parsing_status = ANY (ARRAY['not_started'::text, 'pending'::text, 'parsed'::text, 'blocked'::text, 'failed'::text]));

alter table public."payroll_run_files" add constraint "payroll_run_files_parsing_version_check" CHECK ((parsing_status = ANY (ARRAY['not_started'::text, 'pending'::text])) AND parsing_version IS NULL OR (parsing_status = ANY (ARRAY['parsed'::text, 'blocked'::text, 'failed'::text])) AND NULLIF(btrim(parsing_version), ''::text) IS NOT NULL);

alter table public."payroll_run_files" add constraint "payroll_run_files_path_check" CHECK (capture_file_id IS NULL AND storage_path ~~ (payment_request_id::text || '/%'::text) AND storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,10}$'::text OR capture_file_id IS NOT NULL AND split_part(storage_path, '/'::text, 2) = payment_request_id::text AND storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,10}$'::text);

alter table public."payroll_run_files" add constraint "payroll_run_files_payment_request_id_fkey" FOREIGN KEY (payment_request_id) REFERENCES payment_requests(id) ON DELETE CASCADE;

alter table public."payroll_run_files" add constraint "payroll_run_files_payroll_channel_id_fkey" FOREIGN KEY (payroll_channel_id) REFERENCES payroll_channels(id) ON DELETE CASCADE;

alter table public."payroll_run_files" add constraint "payroll_run_files_size_check" CHECK (size_bytes >= 1 AND size_bytes <= 26214400);

alter table public."payroll_run_files" add constraint "payroll_run_files_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES profiles(id);

CREATE INDEX payroll_run_files_request_kind_idx ON public.payroll_run_files USING btree (payment_request_id, kind, uploaded_at);

CREATE INDEX payroll_run_files_channel_idx ON public.payroll_run_files USING btree (payroll_channel_id, kind) WHERE (payroll_channel_id IS NOT NULL);

revoke all on table public."payroll_run_files" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table public."payroll_run_files" to "service_role";

grant SELECT on table public."payroll_run_files" to "service_role";

grant UPDATE on table public."payroll_run_files" to "service_role";

grant DELETE on table public."payroll_run_files" to "service_role";

grant TRUNCATE on table public."payroll_run_files" to "service_role";

grant REFERENCES on table public."payroll_run_files" to "service_role";

grant TRIGGER on table public."payroll_run_files" to "service_role";

grant MAINTAIN on table public."payroll_run_files" to "service_role";

grant SELECT on table public."payroll_run_files" to "authenticated";

alter table public."payroll_run_lines" add constraint "payroll_run_lines_amounts_check" CHECK (net_amount >= 0::numeric AND bank_amount >= 0::numeric AND spei_amount >= 0::numeric AND vouchers_amount >= 0::numeric AND net_amount = (bank_amount + spei_amount + vouchers_amount) AND (net_amount > 0::numeric OR bank_amount = 0::numeric AND spei_amount = 0::numeric AND vouchers_amount = 0::numeric));

alter table public."payroll_run_lines" add constraint "payroll_run_lines_identity_check" CHECK (NULLIF(btrim(employee_name), ''::text) IS NOT NULL AND (NULLIF(btrim(rfc), ''::text) IS NOT NULL OR NULLIF(btrim(curp), ''::text) IS NOT NULL OR NULLIF(btrim(nss), ''::text) IS NOT NULL));

alter table public."payroll_run_lines" add constraint "payroll_run_lines_payment_request_id_fkey" FOREIGN KEY (payment_request_id) REFERENCES payment_requests(id) ON DELETE CASCADE;

alter table public."payroll_run_lines" add constraint "payroll_run_lines_reconciliation_state_check" CHECK (reconciliation_state = ANY (ARRAY['pending'::text, 'matched'::text, 'blocking_issue'::text]));

alter table public."payroll_run_lines" add constraint "payroll_run_lines_source_check" CHECK (source_row_number > 0 AND NULLIF(btrim(source_sheet), ''::text) IS NOT NULL AND NULLIF(btrim(extraction_version), ''::text) IS NOT NULL);

alter table public."payroll_run_lines" add constraint "payroll_run_lines_source_file_id_fkey" FOREIGN KEY (source_file_id) REFERENCES payroll_run_files(id) ON DELETE RESTRICT;

CREATE INDEX payroll_run_lines_request_source_idx ON public.payroll_run_lines USING btree (payment_request_id, source_file_id, source_row_number);

revoke all on table public."payroll_run_lines" from PUBLIC, anon, authenticated, service_role;

grant INSERT on table public."payroll_run_lines" to "service_role";

grant SELECT on table public."payroll_run_lines" to "service_role";

grant UPDATE on table public."payroll_run_lines" to "service_role";

grant DELETE on table public."payroll_run_lines" to "service_role";

grant TRUNCATE on table public."payroll_run_lines" to "service_role";

grant REFERENCES on table public."payroll_run_lines" to "service_role";

grant TRIGGER on table public."payroll_run_lines" to "service_role";

grant MAINTAIN on table public."payroll_run_lines" to "service_role";

grant SELECT on table public."payroll_run_lines" to "authenticated";

create policy "payroll_channels_summary_select" on public."payroll_channels" for SELECT to "authenticated" using (payroll_can_read_summary(payment_request_id));

create policy "payroll_provision_entries_finance_read" on public."payroll_provision_entries" for SELECT to "authenticated" using (( SELECT private.current_profile_has_company_role(payroll_provision_entries.company_id, ARRAY['finance'::text]) AS current_profile_has_company_role));

create policy "payroll_provision_settings_finance_read" on public."payroll_provision_settings" for SELECT to "authenticated" using (( SELECT private.current_profile_has_company_role(payroll_provision_settings.company_id, ARRAY['finance'::text]) AS current_profile_has_company_role));

create policy "payroll_run_files_finance_select" on public."payroll_run_files" for SELECT to "authenticated" using (private.payroll_request_finance_access(payment_request_id));

create policy "payroll_run_lines_finance_select" on public."payroll_run_lines" for SELECT to "authenticated" using (private.payroll_request_finance_access(payment_request_id));

CREATE TRIGGER payment_layout_lines_reject_payroll BEFORE INSERT OR UPDATE OF payment_request_id ON payment_layout_lines FOR EACH ROW EXECUTE FUNCTION payroll_reject_normal_layout_line();

CREATE TRIGGER guard_payroll_approval_insert BEFORE INSERT ON payment_request_approvals FOR EACH ROW EXECUTE FUNCTION guard_payroll_approval_insert();

CREATE TRIGGER guard_payroll_budget_snapshot_immutable BEFORE UPDATE OF budget_decision, budget_block_reason, budget_available_before, budget_available_after, budget_shortfall, budget_checked_at, budget_result ON payment_requests FOR EACH ROW WHEN (old.request_type::text = 'nomina'::text) EXECUTE FUNCTION guard_payroll_budget_snapshot_immutable();

CREATE TRIGGER guard_payroll_materialized_request_immutable BEFORE UPDATE OF request_type, company_id, company_bank_account_id, cost_center_id, budget_category_id, budget_month, amount_requested, currency, exchange_rate, requested_by, payroll_subtype, payroll_period_start, payroll_period_end, provider_id, proveedor_id, provider_bank_account_id, payment_method, is_extraordinary_adjustment, concept, description, notes ON payment_requests FOR EACH ROW WHEN (old.request_type::text = 'nomina'::text) EXECUTE FUNCTION guard_payroll_materialized_request_immutable();

CREATE TRIGGER guard_payroll_request_status_transition BEFORE UPDATE OF status ON payment_requests FOR EACH ROW WHEN (old.request_type::text = 'nomina'::text) EXECUTE FUNCTION guard_payroll_request_status_transition();

CREATE TRIGGER guard_payroll_submitted_at_immutable BEFORE UPDATE OF submitted_at ON payment_requests FOR EACH ROW WHEN (old.request_type::text = 'nomina'::text) EXECUTE FUNCTION guard_payroll_submitted_at_immutable();

CREATE TRIGGER guard_payroll_toka_variance_before_submit BEFORE UPDATE OF status ON payment_requests FOR EACH ROW WHEN (old.request_type::text = 'nomina'::text AND old.status::text = 'draft'::text AND new.status::text = 'submitted'::text) EXECUTE FUNCTION guard_payroll_toka_variance_before_submit();

CREATE TRIGGER payment_requests_payroll_contract_guard BEFORE INSERT OR UPDATE OF request_type, company_id, company_bank_account_id, currency, payroll_subtype, payroll_period_start, payroll_period_end ON payment_requests FOR EACH ROW EXECUTE FUNCTION payroll_validate_request_contract();

CREATE CONSTRAINT TRIGGER payment_requests_payroll_total_guard AFTER INSERT OR UPDATE ON payment_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll_enforce_request_total();

CREATE TRIGGER payroll_paid_notification AFTER UPDATE ON payment_requests FOR EACH ROW WHEN (new.request_type::text = 'nomina'::text AND new.status::text = 'paid'::text AND old.status::text IS DISTINCT FROM 'paid'::text) EXECUTE FUNCTION private.payroll_paid_notification();

CREATE TRIGGER payroll_submission_notification_event AFTER UPDATE OF status ON payment_requests FOR EACH ROW WHEN (old.request_type::text = 'nomina'::text AND new.request_type::text = 'nomina'::text AND old.status::text = 'draft'::text AND new.status::text = 'submitted'::text) EXECUTE FUNCTION enqueue_payroll_submission_notification();

CREATE TRIGGER validate_payroll_submit_transition BEFORE UPDATE OF status, approver_id, approver_assignment_id, approver_selection_source, submitted_at ON payment_requests FOR EACH ROW WHEN (old.request_type::text = 'nomina'::text AND new.request_type::text = 'nomina'::text AND old.status::text = 'draft'::text AND new.status::text = 'submitted'::text) EXECUTE FUNCTION validate_payroll_submit_transition();

CREATE TRIGGER yy_payroll_force_non_budget_context BEFORE INSERT ON payment_requests FOR EACH ROW EXECUTE FUNCTION payroll_force_non_budget_context();

CREATE TRIGGER payroll_capture_files_redacted_audit AFTER INSERT OR DELETE OR UPDATE ON payroll_capture_files FOR EACH ROW EXECUTE FUNCTION payroll_redacted_audit();

CREATE TRIGGER payroll_capture_sessions_redacted_audit AFTER INSERT OR DELETE OR UPDATE ON payroll_capture_sessions FOR EACH ROW EXECUTE FUNCTION payroll_redacted_audit();

CREATE TRIGGER payroll_registered_notification AFTER UPDATE ON payroll_capture_sessions FOR EACH ROW WHEN (new.capture_state = 'materialized'::text AND old.capture_state IS DISTINCT FROM 'materialized'::text) EXECUTE FUNCTION private.payroll_registered_notification();

CREATE TRIGGER guard_payroll_channel_financial_snapshot BEFORE UPDATE OF amount, currency, benefit_amount, fee_amount, tax_amount, expected_funding_amount ON payroll_channels FOR EACH ROW EXECUTE FUNCTION guard_payroll_channel_financial_snapshot();

CREATE TRIGGER payroll_channels_parent_guard BEFORE INSERT OR UPDATE ON payroll_channels FOR EACH ROW EXECUTE FUNCTION payroll_validate_channel_parent();

CREATE TRIGGER payroll_channels_redacted_audit AFTER INSERT OR DELETE OR UPDATE ON payroll_channels FOR EACH ROW EXECUTE FUNCTION payroll_redacted_audit();

CREATE TRIGGER payroll_channels_set_updated_at BEFORE UPDATE ON payroll_channels FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE CONSTRAINT TRIGGER payroll_channels_total_guard AFTER INSERT OR DELETE OR UPDATE ON payroll_channels DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll_enforce_request_total();

CREATE TRIGGER payroll_run_files_capture_provenance_guard BEFORE INSERT OR UPDATE OF capture_file_id, storage_path, sha256, size_bytes ON payroll_run_files FOR EACH ROW EXECUTE FUNCTION payroll_validate_materialized_capture_file();

CREATE TRIGGER payroll_run_files_parent_guard BEFORE INSERT OR UPDATE ON payroll_run_files FOR EACH ROW EXECUTE FUNCTION payroll_validate_file_parent();

CREATE TRIGGER payroll_run_files_redacted_audit AFTER INSERT OR DELETE OR UPDATE ON payroll_run_files FOR EACH ROW EXECUTE FUNCTION payroll_redacted_audit();

CREATE TRIGGER payroll_run_files_set_updated_at BEFORE UPDATE ON payroll_run_files FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER payroll_run_lines_parent_guard BEFORE INSERT OR UPDATE ON payroll_run_lines FOR EACH ROW EXECUTE FUNCTION payroll_validate_line_parent();

CREATE TRIGGER payroll_run_lines_redacted_audit AFTER INSERT OR DELETE OR UPDATE ON payroll_run_lines FOR EACH ROW EXECUTE FUNCTION payroll_redacted_audit();

CREATE TRIGGER payroll_run_lines_set_updated_at BEFORE UPDATE ON payroll_run_lines FOR EACH ROW EXECUTE FUNCTION set_updated_at();

create policy "payroll_private_capture_finance_insert" on storage.objects for INSERT to "authenticated" with check (((bucket_id = 'payroll-private'::text) AND payroll_capture_storage_insert_allowed(name)));

create policy "payroll_private_capture_finance_select" on storage.objects for SELECT to "authenticated" using (((bucket_id = 'payroll-private'::text) AND payroll_capture_storage_select_allowed(name)));

create policy "payroll_private_capture_no_update" on storage.objects as restrictive for UPDATE to "authenticated" using (((bucket_id <> 'payroll-private'::text) OR (name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'::text))) with check (((bucket_id <> 'payroll-private'::text) OR (name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'::text)));

create policy "payroll_private_finance_insert" on storage.objects for INSERT to "authenticated" with check (((bucket_id = 'payroll-private'::text) AND payroll_run_file_storage_insert_allowed(name)));

create policy "payroll_private_finance_select" on storage.objects for SELECT to "authenticated" using (((bucket_id = 'payroll-private'::text) AND (name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'::text) AND payroll_storage_company_access(name)));

create policy "payroll_private_finance_update" on storage.objects for UPDATE to "authenticated" using (((bucket_id = 'payroll-private'::text) AND payroll_storage_company_access(name))) with check (((bucket_id = 'payroll-private'::text) AND (name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'::text) AND payroll_storage_company_access(name)));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('payroll-private','payroll-private',false,26214400,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','application/xml','text/xml','application/pdf']);

insert into public.budget_categories(code,name,active,no_presupuestal) values ('PAYROLL_NON_BUDGET','Nómina · registro no presupuestal',true,true);

drop trigger payment_request_created_notification_event on public.payment_requests;
create trigger payment_request_created_notification_event after insert on public.payment_requests for each row
when (new.request_type::text <> 'nomina') execute function public.enqueue_payment_request_created_notification();
drop trigger validate_payment_request_approver_scope_insert on public.payment_requests;
create trigger validate_payment_request_approver_scope_insert before insert on public.payment_requests for each row
when (new.request_type::text <> 'nomina') execute function public.validate_payment_request_approver_scope();
drop trigger validate_payment_request_approver_scope_update on public.payment_requests;
create trigger validate_payment_request_approver_scope_update before update of approver_id,approver_assignment_id,approver_selection_source,company_id,requested_by,cost_center_id,amount_requested on public.payment_requests for each row
when (new.request_type::text <> 'nomina') execute function public.validate_payment_request_approver_scope();

select cron.schedule('payroll-notification-dispatcher','* * * * *','select private.wake_payroll_notifications();');

notify pgrst, 'reload schema';

commit;
