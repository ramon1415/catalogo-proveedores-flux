-- DEV only. Exercise the existing synthetic CIE fixture and roll everything back.
-- Run through execute_sql with the DEV project selected; never execute in PROD.
begin;
do $test$
declare
  v_line public.payment_layout_lines%rowtype;
  v_after public.payment_layout_lines%rowtype;
  v_actor uuid;
  v_other uuid;
  v_paid public.payment_layout_lines%rowtype;
  v_before_audit bigint;
  v_probe public.payment_requests%rowtype;
  v_baseline_missing text[];
  v_checks integer := 0;
begin
  select l.* into strict v_line
  from public.payment_layout_lines l
  join public.payment_layouts pl on pl.id=l.layout_id
  join public.payment_requests pr on pr.id=l.payment_request_id
  where l.destination_type='convenio' and l.convenio_number='1234567'
    and l.status='included' and pl.status::text in ('draft','generated')
    and pr.status::text not in ('paid','cancelled')
    and not exists(select 1 from public.payment_receipts r where r.payment_request_id=l.payment_request_id)
  order by l.created_at limit 1;
  select p.auth_user_id into strict v_actor from public.profiles p
    where p.auth_user_id is not null and coalesce(p.active,true)
    and private.profile_has_company_role(p.id,v_line.company_id,public.flux_member_roles()) limit 1;
  select p.auth_user_id into strict v_other from public.profiles p
    where p.auth_user_id is not null and coalesce(p.active,true)
    and not private.profile_has_company_role(p.id,v_line.company_id,public.flux_member_roles()) limit 1;
  select count(*) into v_before_audit from private.payment_layout_cie_reference_audit;

  if has_function_privilege('anon','public.update_payment_layout_line_cie_reference(uuid,text,text,boolean)','EXECUTE')
    or has_function_privilege('anon','private.update_layout_cie_reference(uuid,text,text,boolean)','EXECUTE')
    or has_table_privilege('authenticated','private.payment_layout_cie_reference_audit','SELECT')
  then raise exception 'unsafe CIE privileges'; end if;
  v_checks := v_checks+1;

  if private.cie_reference_error('10092','0578869') is distinct from 'cie_reference_cfe_requires_20_characters'
    or private.cie_reference_error('00123456789012345678','0578869') is not null
    or private.cie_reference_error('12345678','1234567') is not null
  then raise exception 'issuer reference contract failed'; end if;
  v_checks := v_checks+1;

  perform set_config('request.jwt.claims','{}',true);
  set local role authenticated;
  begin
    perform public.update_payment_layout_line_cie_reference(v_line.id,'00123456789012345678',v_line.payment_reference,false);
    raise exception 'unauthenticated accepted';
  exception when others then if sqlerrm <> 'not_authenticated' then raise; end if; end;
  reset role;
  v_checks := v_checks+1;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_other,'role','authenticated')::text,true);
  set local role authenticated;
  begin
    perform public.update_payment_layout_line_cie_reference(v_line.id,'00123456789012345678',v_line.payment_reference,false);
    raise exception 'foreign company accepted';
  exception when others then if sqlerrm <> 'cie_reference_not_authorized' then raise; end if; end;
  reset role;
  v_checks := v_checks+1;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
  set local role authenticated;
  begin
    perform public.update_payment_layout_line_cie_reference(v_line.id,repeat('1',21),v_line.payment_reference,false);
    raise exception 'oversized reference accepted';
  exception when others then if sqlerrm <> 'cie_reference_too_long' then raise; end if; end;
  begin
    perform public.update_payment_layout_line_cie_reference(v_line.id,'00123456789012345678','stale expected value',false);
    raise exception 'concurrent change overwritten';
  exception when others then if sqlerrm <> 'cie_reference_changed' then raise; end if; end;
  perform public.update_payment_layout_line_cie_reference(v_line.id,'00123456789012345678',v_line.payment_reference,false);
  perform public.update_payment_layout_line_cie_reference(v_line.id,'00123456789012345678','00123456789012345678',false);
  reset role;
  v_checks := v_checks+4;

  select * into strict v_after from public.payment_layout_lines where id=v_line.id;
  if v_after.payment_reference <> '00123456789012345678'
    or (to_jsonb(v_after)-'payment_reference'-'updated_at') is distinct from (to_jsonb(v_line)-'payment_reference'-'updated_at')
    or (select count(*) from private.payment_layout_cie_reference_audit) <> v_before_audit+1
  then raise exception 'reference correction changed protected data or audit count'; end if;
  v_checks := v_checks+1;

  update public.payment_layouts set status='uploaded' where id=v_line.layout_id;
  set local role authenticated;
  begin
    perform public.update_payment_layout_line_cie_reference(v_line.id,'00123456789012345679','00123456789012345678',false);
    raise exception 'uploaded payment changed without bank confirmation';
  exception when others then if sqlerrm <> 'cie_reference_bank_rejection_confirmation_required' then raise; end if; end;
  perform public.update_payment_layout_line_cie_reference(v_line.id,'00123456789012345679','00123456789012345678',true);
  reset role;
  v_checks := v_checks+2;

  select l.* into strict v_paid from public.payment_layout_lines l where l.destination_type='convenio' and l.status='paid' and l.company_id=v_line.company_id limit 1;
  set local role authenticated;
  begin
    perform public.update_payment_layout_line_cie_reference(v_paid.id,'00123456789012345678',v_paid.payment_reference,true);
    raise exception 'paid payment changed';
  exception when others then if sqlerrm <> 'cie_reference_line_locked' then raise; end if; end;
  reset role;
  v_checks := v_checks+1;
  -- Exercise the actual eligibility helper without writing requests.
  select * into strict v_probe from public.payment_requests where id=v_line.payment_request_id;
  v_probe.payment_reference := '12345';
  v_baseline_missing := public.payment_request_layout_missing_fields(v_probe);
  foreach v_probe.payment_reference in array array['00123456789012345678','ref-12345'] loop
    if public.payment_request_layout_missing_fields(v_probe) is distinct from v_baseline_missing then
      raise exception 'valid CIE issuer reference changed eligibility or unrelated requirements';
    end if;
    v_checks := v_checks+1;
  end loop;
  v_probe.payment_reference := repeat('1',21);
  if not ('payment_reference_invalid'=any(public.payment_request_layout_missing_fields(v_probe))) then
    raise exception 'oversized CIE reference classified ready';
  end if;
  v_checks := v_checks+1;
  select r.* into strict v_probe from public.payment_requests r join public.proveedores p on p.id=r.proveedor_id
    where p.destination_type='clabe' and r.request_type::text<>'reimbursement' limit 1;
  v_probe.payment_reference := '00123456789012345678';
  if not ('payment_reference_invalid'=any(public.payment_request_layout_missing_fields(v_probe))) then
    raise exception 'interbank reference rule changed';
  end if;
  v_checks := v_checks+1;
  perform set_config('flux.cie_qa_result',jsonb_build_object('status','PASS','checks',v_checks,'rollback',true)::text,true);
end;
$test$;
select current_setting('flux.cie_qa_result')::jsonb as result;
rollback;
