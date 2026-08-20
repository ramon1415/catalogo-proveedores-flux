-- N4B: payroll channel receipt evidence, reconciliation, and final paid close.
-- Flux verifies uploaded receipt bytes and records reconciliation; it does not execute payments.

begin;

do $precheck$
begin
  if to_regclass('public.payroll_channels') is null
     or to_regclass('public.payroll_run_files') is null
     or to_regprocedure('public.get_payroll_dispersion_summary(uuid)') is null
     or to_regprocedure('public.payroll_request_has_valid_materialization(uuid)') is null
     or to_regprocedure('public.payroll_has_finance_pii_access()') is null then
    raise exception 'payroll_n4b_prerequisite_missing';
  end if;
end;
$precheck$;

alter table public.payroll_channels
  add column if not exists receipt_file_id uuid,
  add column if not exists receipt_amount numeric,
  add column if not exists receipt_payment_date date,
  add column if not exists receipt_reference_hint text;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.payroll_channels'::regclass
      and conname='payroll_channels_receipt_file_id_fkey'
  ) then
    alter table public.payroll_channels
      add constraint payroll_channels_receipt_file_id_fkey
      foreign key(receipt_file_id) references public.payroll_run_files(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.payroll_channels'::regclass
      and conname='payroll_channels_reconciliation_receipt_check'
  ) then
    alter table public.payroll_channels
      add constraint payroll_channels_reconciliation_receipt_check check (
        (reconciliation_status='pending'
          and receipt_file_id is null
          and receipt_amount is null
          and receipt_payment_date is null
          and receipt_reference_hint is null)
        or
        (reconciliation_status='reconciled'
          and receipt_file_id is not null
          and receipt_amount=amount
          and receipt_payment_date is not null
          and nullif(btrim(receipt_reference_hint),'') is not null)
        or reconciliation_status='exception'
      );
  end if;
end;
$constraints$;

create unique index if not exists payroll_channels_receipt_file_unique_idx
  on public.payroll_channels(receipt_file_id)
  where receipt_file_id is not null;

create or replace function public.payroll_run_file_storage_insert_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select public.payroll_has_finance_pii_access()
    and p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
    and exists (
      select 1
      from public.payroll_run_files file
      join public.payroll_channels channel on channel.id=file.payroll_channel_id
      join public.payment_requests request on request.id=file.payment_request_id
      where file.storage_bucket='payroll-private'
        and file.storage_path=p_name
        and file.kind='comprobante'
        and file.parsing_status='pending'
        and file.parsing_version is null
        and channel.payment_request_id=request.id
        and channel.dispersion_status='dispersed'
        and channel.reconciliation_status='pending'
        and request.request_type::text='nomina'
        and request.status::text='approved'
        and public.payroll_request_has_valid_materialization(request.id)
        and public.has_active_company_membership(public.current_profile_id(),request.company_id)
    );
$$;

revoke all on function public.payroll_run_file_storage_insert_allowed(text) from public,anon,authenticated;

drop policy if exists payroll_private_finance_insert on storage.objects;
create policy payroll_private_finance_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='payroll-private'
  and public.payroll_run_file_storage_insert_allowed(name)
);

create or replace function public.reserve_payroll_channel_receipt(
  p_payment_request_id uuid,
  p_payroll_channel_id uuid,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_original_filename text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_channel public.payroll_channels%rowtype;
  v_file_id uuid := gen_random_uuid();
  v_filename text := btrim(coalesce(p_original_filename,''));
  v_path text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'PAYROLL_FINANCE_REQUIRED';
  end if;

  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.status::text<>'approved' then raise exception 'PAYROLL_RECEIPT_REQUIRES_APPROVED_REQUEST'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_RECEIPT_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_RECEIPT_MATERIALIZATION_REQUIRED'; end if;

  select * into v_channel
  from public.payroll_channels
  where id=p_payroll_channel_id and payment_request_id=v_request.id
  for update;
  if not found then raise exception 'PAYROLL_RECEIPT_CHANNEL_REQUIRED'; end if;
  if v_channel.dispersion_status<>'dispersed' then raise exception 'PAYROLL_RECEIPT_REQUIRES_DISPERSED_CHANNEL'; end if;
  if v_channel.reconciliation_status<>'pending' then raise exception 'PAYROLL_RECEIPT_RECONCILIATION_ALREADY_STARTED'; end if;

  if lower(btrim(coalesce(p_mime_type,'')))<>'application/pdf' then raise exception 'PAYROLL_RECEIPT_PDF_REQUIRED'; end if;
  if p_size_bytes is null or p_size_bytes<100 or p_size_bytes>10485760 then raise exception 'PAYROLL_RECEIPT_SIZE_INVALID'; end if;
  if lower(coalesce(p_sha256,'')) !~ '^[0-9a-f]{64}$' then raise exception 'PAYROLL_RECEIPT_SHA256_INVALID'; end if;
  if length(v_filename)<1 or length(v_filename)>180
     or position('/' in v_filename)>0
     or position(chr(92) in v_filename)>0
     or v_filename ~ '[[:cntrl:]]' then
    raise exception 'PAYROLL_RECEIPT_FILENAME_INVALID';
  end if;

  v_path := v_request.id::text || '/' || v_file_id::text || '.pdf';

  insert into public.payroll_run_files(
    id,payment_request_id,payroll_channel_id,kind,storage_bucket,storage_path,
    original_filename,mime_type,size_bytes,sha256,uploaded_by,
    parsing_status,parsing_version,parsing_metadata,capture_file_id
  ) values (
    v_file_id,v_request.id,v_channel.id,'comprobante','payroll-private',v_path,
    v_filename,'application/pdf',p_size_bytes,lower(p_sha256),v_actor,
    'pending',null,'{}'::jsonb,null
  );

  return jsonb_build_object(
    'run_file_id',v_file_id,
    'storage_bucket','payroll-private',
    'storage_path',v_path,
    'mime_type','application/pdf',
    'size_bytes',p_size_bytes,
    'sha256',lower(p_sha256)
  );
end;
$$;

revoke all on function public.reserve_payroll_channel_receipt(uuid,uuid,text,bigint,text,text) from public,anon;
grant execute on function public.reserve_payroll_channel_receipt(uuid,uuid,text,bigint,text,text) to authenticated;

create or replace function public.get_payroll_receipt_verification_context(p_run_file_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_file public.payroll_run_files%rowtype;
  v_channel public.payroll_channels%rowtype;
  v_request public.payment_requests%rowtype;
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
  return jsonb_build_object(
    'run_file_id',v_file.id,
    'payment_request_id',v_request.id,
    'payroll_channel_id',v_channel.id,
    'storage_bucket',v_file.storage_bucket,
    'storage_path',v_file.storage_path,
    'mime_type',v_file.mime_type,
    'size_bytes',v_file.size_bytes,
    'sha256',v_file.sha256
  );
end;
$$;

revoke all on function public.get_payroll_receipt_verification_context(uuid) from public,anon;
grant execute on function public.get_payroll_receipt_verification_context(uuid) to authenticated;

create or replace function public.confirm_payroll_channel_receipt_internal(
  p_run_file_id uuid,
  p_sha256 text,
  p_size_bytes bigint,
  p_mime_type text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_file public.payroll_run_files%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'PAYROLL_RECEIPT_SERVICE_ROLE_REQUIRED'; end if;
  select * into v_file from public.payroll_run_files where id=p_run_file_id for update;
  if not found or v_file.kind<>'comprobante' then raise exception 'PAYROLL_RECEIPT_FILE_REQUIRED'; end if;

  if v_file.parsing_status='parsed' and v_file.parsing_version='payroll-channel-receipt-v1' then
    if v_file.sha256=lower(p_sha256) and v_file.size_bytes=p_size_bytes and v_file.mime_type=lower(p_mime_type) then
      return jsonb_build_object('status','already_verified','run_file_id',v_file.id);
    end if;
    raise exception 'PAYROLL_RECEIPT_VERIFICATION_MISMATCH';
  end if;

  if v_file.parsing_status<>'pending'
     or v_file.sha256<>lower(coalesce(p_sha256,''))
     or v_file.size_bytes<>p_size_bytes
     or v_file.mime_type<>lower(coalesce(p_mime_type,''))
     or v_file.mime_type<>'application/pdf' then
    raise exception 'PAYROLL_RECEIPT_VERIFICATION_MISMATCH';
  end if;

  update public.payroll_run_files
  set parsing_status='parsed',
      parsing_version='payroll-channel-receipt-v1',
      parsing_metadata=jsonb_build_object(
        'evidence_class','payroll_channel_receipt',
        'parser_version','payroll-channel-receipt-v1'
      ),
      updated_at=now()
  where id=v_file.id;

  return jsonb_build_object('status','verified','run_file_id',v_file.id);
end;
$$;

revoke all on function public.confirm_payroll_channel_receipt_internal(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.confirm_payroll_channel_receipt_internal(uuid,text,bigint,text) to service_role;

create or replace function public.get_payroll_reconciliation_summary(p_payment_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_company_name text;
  v_channels jsonb;
  v_count integer;
  v_dispersed integer;
  v_reconciled integer;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_RECONCILIATION_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  select name into v_company_name from public.companies where id=v_request.company_id;

  select count(*)::integer,
         count(*) filter(where channel.dispersion_status='dispersed')::integer,
         count(*) filter(where channel.reconciliation_status='reconciled')::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'id',channel.id,
           'channel',channel.channel,
           'amount',channel.amount,
           'currency',channel.currency,
           'dispersion_status',channel.dispersion_status,
           'reconciliation_status',channel.reconciliation_status,
           'receipt_verified',(file.id is not null and file.parsing_status='parsed' and file.parsing_version='payroll-channel-receipt-v1'),
           'receipt_payment_date',channel.receipt_payment_date,
           'reference_hint',case when channel.receipt_reference_hint is null then null else '••••' || right(channel.receipt_reference_hint,4) end
         ) order by case channel.channel when 'banco' then 1 when 'spei' then 2 else 3 end),'[]'::jsonb)
    into v_count,v_dispersed,v_reconciled,v_channels
  from public.payroll_channels channel
  left join public.payroll_run_files file on file.id=channel.receipt_file_id
  where channel.payment_request_id=v_request.id;

  return jsonb_build_object(
    'payment_request_id',v_request.id,
    'request_number',v_request.request_number,
    'company_name',v_company_name,
    'request_status',v_request.status::text,
    'amount_requested',v_request.amount_requested,
    'currency',v_request.currency,
    'channel_count',v_count,
    'dispersed_count',v_dispersed,
    'reconciled_count',v_reconciled,
    'all_dispersed',(v_count>0 and v_dispersed=v_count),
    'all_reconciled',(v_count>0 and v_reconciled=v_count),
    'can_close_paid',(v_request.status::text='approved' and v_count>0 and v_dispersed=v_count and v_reconciled=v_count),
    'channels',v_channels
  );
end;
$$;

revoke all on function public.get_payroll_reconciliation_summary(uuid) from public,anon;
grant execute on function public.get_payroll_reconciliation_summary(uuid) to authenticated;

create or replace function public.get_payroll_reconciliation_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare v_actor uuid := public.current_profile_id();
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'payment_request_id',request.id,
      'request_number',request.request_number,
      'company_name',company.name,
      'amount_requested',request.amount_requested,
      'currency',request.currency,
      'channel_count',counts.channel_count,
      'reconciled_count',counts.reconciled_count
    ) order by request.approved_at desc nulls last,request.id)
    from public.payment_requests request
    join public.companies company on company.id=request.company_id
    cross join lateral (
      select count(*)::integer channel_count,
             count(*) filter(where channel.dispersion_status='dispersed')::integer dispersed_count,
             count(*) filter(where channel.reconciliation_status='reconciled')::integer reconciled_count
      from public.payroll_channels channel where channel.payment_request_id=request.id
    ) counts
    where request.request_type::text='nomina'
      and request.status::text='approved'
      and counts.channel_count>0
      and counts.dispersed_count=counts.channel_count
      and public.payroll_request_has_valid_materialization(request.id)
      and public.has_active_company_membership(v_actor,request.company_id)
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.get_payroll_reconciliation_queue() from public,anon;
grant execute on function public.get_payroll_reconciliation_queue() to authenticated;

create or replace function public.reconcile_payroll_channel(
  p_payment_request_id uuid,
  p_payroll_channel_id uuid,
  p_receipt_file_id uuid,
  p_receipt_amount numeric,
  p_payment_date date,
  p_reference_hint text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_channel public.payroll_channels%rowtype;
  v_file public.payroll_run_files%rowtype;
  v_reference text := nullif(btrim(coalesce(p_reference_hint,'')),'');
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.status::text<>'approved' then raise exception 'PAYROLL_RECONCILIATION_REQUIRES_APPROVED_REQUEST'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_RECONCILIATION_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_RECONCILIATION_MATERIALIZATION_REQUIRED'; end if;

  select * into v_channel from public.payroll_channels
  where id=p_payroll_channel_id and payment_request_id=v_request.id for update;
  if not found then raise exception 'PAYROLL_RECONCILIATION_CHANNEL_REQUIRED'; end if;

  if v_channel.reconciliation_status='reconciled' then
    if v_channel.receipt_file_id=p_receipt_file_id
       and v_channel.receipt_amount=p_receipt_amount
       and v_channel.receipt_payment_date=p_payment_date
       and v_channel.receipt_reference_hint=v_reference then
      return jsonb_build_object('result','already_reconciled','summary',public.get_payroll_reconciliation_summary(v_request.id));
    end if;
    raise exception 'PAYROLL_RECONCILIATION_ALREADY_FINAL';
  end if;
  if v_channel.reconciliation_status<>'pending' then raise exception 'PAYROLL_RECONCILIATION_STATUS_INVALID'; end if;
  if v_channel.dispersion_status<>'dispersed' then raise exception 'PAYROLL_RECONCILIATION_REQUIRES_DISPERSED_CHANNEL'; end if;

  select * into v_file from public.payroll_run_files
  where id=p_receipt_file_id
    and payment_request_id=v_request.id
    and payroll_channel_id=v_channel.id
    and kind='comprobante';
  if not found or v_file.parsing_status<>'parsed' or v_file.parsing_version<>'payroll-channel-receipt-v1' then
    raise exception 'PAYROLL_RECONCILIATION_VERIFIED_RECEIPT_REQUIRED';
  end if;

  if p_receipt_amount is null or p_receipt_amount<>v_channel.amount then raise exception 'PAYROLL_RECONCILIATION_AMOUNT_MISMATCH'; end if;
  if p_payment_date is null or p_payment_date>current_date+1 then raise exception 'PAYROLL_RECONCILIATION_PAYMENT_DATE_INVALID'; end if;
  if v_reference is null or length(v_reference)<3 or length(v_reference)>120 then raise exception 'PAYROLL_RECONCILIATION_REFERENCE_REQUIRED'; end if;

  update public.payroll_channels
  set reconciliation_status='reconciled',
      reconciled_at=now(),
      reconciled_by=v_actor,
      reconciliation_note=null,
      receipt_file_id=v_file.id,
      receipt_amount=p_receipt_amount,
      receipt_payment_date=p_payment_date,
      receipt_reference_hint=v_reference
  where id=v_channel.id;

  return jsonb_build_object('result','reconciled','summary',public.get_payroll_reconciliation_summary(v_request.id));
end;
$$;

revoke all on function public.reconcile_payroll_channel(uuid,uuid,uuid,numeric,date,text) from public,anon;
grant execute on function public.reconcile_payroll_channel(uuid,uuid,uuid,numeric,date,text) to authenticated;

create or replace function public.guard_payroll_request_status_transition()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_channel_count integer;
  v_ready_count integer;
begin
  if old.request_type::text<>'nomina' or new.status is not distinct from old.status then return new; end if;

  if old.status::text='draft' then
    if new.status::text<>'submitted'
       or v_actor is null
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

  if old.status::text='submitted' then
    if new.status::text not in ('approved','rejected','changes_requested') then raise exception 'PAYROLL_INVALID_APPROVAL_STATUS_TRANSITION'; end if;
    if v_actor is null or old.approver_id is distinct from v_actor then raise exception 'selected_approver_only'; end if;
    if not exists (
      select 1 from public.payment_request_approvals a
      where a.payment_request_id=old.id
        and a.actor_profile_id=v_actor
        and a.from_status='submitted'
        and a.to_status=new.status::text
        and a.created_at>=transaction_timestamp()
    ) then raise exception 'PAYROLL_DECISION_RECORD_REQUIRED'; end if;
    return new;
  end if;

  if old.status::text='approved' then
    if new.status::text<>'paid' then raise exception 'PAYROLL_POST_DECISION_TRANSITION_NOT_ENABLED'; end if;
    if current_setting('app.payroll_n4b_close_request',true) is distinct from old.id::text then raise exception 'PAYROLL_PAID_CLOSE_RPC_REQUIRED'; end if;
    if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
    if not public.has_active_company_membership(v_actor,old.company_id) then raise exception 'PAYROLL_PAID_COMPANY_MEMBERSHIP_REQUIRED'; end if;
    if not public.payroll_request_has_valid_materialization(old.id) then raise exception 'PAYROLL_PAID_MATERIALIZATION_REQUIRED'; end if;

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

    if v_channel_count=0 or v_ready_count<>v_channel_count then raise exception 'PAYROLL_PAID_RECONCILIATION_REQUIRED'; end if;
    if new.paid_at is null or new.paid_by is distinct from v_actor then raise exception 'PAYROLL_PAID_SNAPSHOT_REQUIRED'; end if;
    return new;
  end if;

  if old.status::text in ('rejected','changes_requested') then raise exception 'PAYROLL_POST_DECISION_TRANSITION_NOT_ENABLED'; end if;
  raise exception 'PAYROLL_STATUS_TRANSITION_NOT_ENABLED';
end;
$$;

create or replace function public.close_payroll_as_paid(p_payment_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_count integer;
  v_ready integer;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_PAID_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if v_request.status::text='paid' then return jsonb_build_object('status','already_paid','payment_request_id',v_request.id,'paid_at',v_request.paid_at); end if;
  if v_request.status::text<>'approved' then raise exception 'PAYROLL_PAID_REQUIRES_APPROVED_REQUEST'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_PAID_MATERIALIZATION_REQUIRED'; end if;

  select count(*)::integer,
         count(*) filter(where channel.dispersion_status='dispersed'
                            and channel.reconciliation_status='reconciled'
                            and channel.receipt_file_id is not null
                            and file.id is not null
                            and file.parsing_status='parsed'
                            and file.parsing_version='payroll-channel-receipt-v1')::integer
    into v_count,v_ready
  from public.payroll_channels channel
  left join public.payroll_run_files file on file.id=channel.receipt_file_id
  where channel.payment_request_id=v_request.id;
  if v_count=0 or v_ready<>v_count then raise exception 'PAYROLL_PAID_RECONCILIATION_REQUIRED'; end if;

  perform set_config('app.payroll_n4b_close_request',v_request.id::text,true);
  update public.payment_requests
  set status='paid'::public.payment_request_status,
      paid_at=now(),
      paid_by=v_actor,
      updated_at=now()
  where id=v_request.id;

  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values('payroll_reconciliation',v_request.id,'close_paid',null,
    jsonb_build_object('redacted',true,'operation','payroll_close_paid'),v_actor,
    'Payroll paid close stores no employee, bank-account or receipt-reference values in audit.');

  return jsonb_build_object('status','paid','payment_request_id',v_request.id,'paid_at',(select paid_at from public.payment_requests where id=v_request.id));
end;
$$;

revoke all on function public.close_payroll_as_paid(uuid) from public,anon;
grant execute on function public.close_payroll_as_paid(uuid) to authenticated;

do $postcheck$
begin
  if to_regprocedure('public.reserve_payroll_channel_receipt(uuid,uuid,text,bigint,text,text)') is null
     or to_regprocedure('public.get_payroll_receipt_verification_context(uuid)') is null
     or to_regprocedure('public.confirm_payroll_channel_receipt_internal(uuid,text,bigint,text)') is null
     or to_regprocedure('public.reconcile_payroll_channel(uuid,uuid,uuid,numeric,date,text)') is null
     or to_regprocedure('public.get_payroll_reconciliation_summary(uuid)') is null
     or to_regprocedure('public.get_payroll_reconciliation_queue()') is null
     or to_regprocedure('public.close_payroll_as_paid(uuid)') is null then
    raise exception 'payroll_n4b_contract_incomplete';
  end if;
end;
$postcheck$;

commit;
