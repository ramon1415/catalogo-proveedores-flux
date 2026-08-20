-- N3F forward compatibility: non-SPEI real physical files are uploadable without
-- trusting a browser parser. The Edge remains the only authority for these bytes.
-- No business data backfill.

begin;

do $precheck$
begin
  if to_regclass('public.payroll_capture_files') is null
     or to_regprocedure('public.acknowledge_payroll_toka_funding_variance(uuid,text)') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='payroll_channels' and column_name='benefit_amount'
     ) then
    raise exception 'payroll_n3f_staging_prerequisite_missing';
  end if;
  if exists(select 1 from public.payroll_capture_sessions)
     or exists(select 1 from public.payroll_capture_files)
     or exists(select 1 from public.payment_requests where request_type::text='nomina') then
    raise exception 'payroll_n3f_staging_requires_zero_payroll_state';
  end if;
end;
$precheck$;

alter table public.payroll_capture_files drop constraint payroll_capture_files_capability_check;
alter table public.payroll_capture_files drop constraint payroll_capture_files_parser_check;

alter table public.payroll_capture_files add constraint payroll_capture_files_capability_check check (
  (
    kind='layout_spei'
    and capability_code='supported_certified'
    and parsing_status='client_parsed_unverified'
    and validation_authority='browser_client_attested'
  )
  or
  (
    kind in ('caratula','layout_mismo_banco','layout_toka','cfdi_vales')
    and capability_code='supported_certified'
    and parsing_status='server_verification_pending'
    and validation_authority='server_only'
  )
);

alter table public.payroll_capture_files add constraint payroll_capture_files_parser_check check (
  issue_codes=array[]::text[]
  and (
    (
      kind='layout_spei'
      and parser_version='payroll-normalized-v1'
      and parser_contract='bbva-simulator-pagos-interbancarios-128-v1'
      and record_count is not null and record_count>0
      and total_amount_minor is not null and total_amount_minor>0
    )
    or
    (
      kind in ('caratula','layout_mismo_banco','layout_toka','cfdi_vales')
      and parser_version is null
      and parser_contract is null
      and record_count is null
      and total_amount_minor is null
    )
  )
);

create or replace function public.reserve_payroll_capture_file(
  p_session_id uuid,p_expected_version integer,p_kind text,p_extension text,p_mime_type text,
  p_size_bytes bigint,p_sha256 text,p_parser_version text,p_parser_contract text,p_record_count integer,p_total_amount_minor bigint
)
returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare
  v_actor uuid:=public.current_profile_id();
  v_session public.payroll_capture_sessions%rowtype;
  v_file_id uuid:=gen_random_uuid();
  v_channel text;
  v_path text;
  v_server_only boolean:=false;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'payroll_capture_finance_required'; end if;
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
$$;

revoke all on function public.reserve_payroll_capture_file(uuid,integer,text,text,text,bigint,text,text,text,integer,bigint) from public,anon;
grant execute on function public.reserve_payroll_capture_file(uuid,integer,text,text,text,bigint,text,text,text,integer,bigint) to authenticated,service_role;

do $postcheck$
declare v_cap text; v_parser text;
begin
  select pg_get_constraintdef(oid) into v_cap
  from pg_constraint where conrelid='public.payroll_capture_files'::regclass and conname='payroll_capture_files_capability_check';
  select pg_get_constraintdef(oid) into v_parser
  from pg_constraint where conrelid='public.payroll_capture_files'::regclass and conname='payroll_capture_files_parser_check';
  if v_cap not like '%server_verification_pending%'
     or v_cap not like '%server_only%'
     or v_parser not like '%parser_version IS NULL%'
     or to_regprocedure('public.reserve_payroll_capture_file(uuid,integer,text,text,text,bigint,text,text,text,integer,bigint)') is null then
    raise exception 'payroll_n3f_staging_contract_incomplete';
  end if;
end;
$postcheck$;

commit;
