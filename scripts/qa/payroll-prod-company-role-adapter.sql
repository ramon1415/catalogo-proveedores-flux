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
