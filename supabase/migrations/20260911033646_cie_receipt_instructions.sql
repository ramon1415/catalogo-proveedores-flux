-- Correct the bank instructions on unpaid CIE snapshots atomically.
-- Historical requests, approvals, amounts, accounts and payment states are unchanged.
alter table private.payment_layout_cie_reference_audit
  add column previous_concept text,
  add column new_concept text;

create or replace function private.update_layout_cie_instructions(
  p_line_id uuid,
  p_payment_reference text,
  p_expected_reference text,
  p_payment_concept text,
  p_expected_concept text,
  p_bank_rejection_confirmed boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_actor uuid;
  v_layout_id uuid;
  v_line public.payment_layout_lines%rowtype;
  v_layout public.payment_layouts%rowtype;
  v_reference text := btrim(p_payment_reference);
  v_error text;
  v_concept text := btrim(p_payment_concept);
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_actor := public.current_profile_id();
  if v_actor is null then raise exception 'cie_reference_not_authorized'; end if;
  select l.layout_id into v_layout_id from public.payment_layout_lines l where l.id = p_line_id;
  if not found then raise exception 'cie_reference_line_not_found'; end if;

  -- Same lock order as layout confirmation: parent before child.
  select * into v_layout from public.payment_layouts where id = v_layout_id for update;
  if not found then raise exception 'cie_reference_line_not_found'; end if;
  select * into v_line from public.payment_layout_lines where id = p_line_id for update;
  if not found or v_line.layout_id is distinct from v_layout.id or v_line.destination_type is distinct from 'convenio' then
    raise exception 'cie_reference_line_not_found';
  end if;
  if not coalesce(private.current_profile_has_company_role(v_line.company_id, array['finance']::text[]), false) then
    raise exception 'cie_reference_not_authorized';
  end if;
  if v_line.status is distinct from 'included'
    or coalesce(v_layout.status::text, '') not in ('draft','generated','uploaded')
    or exists (select 1 from public.payment_requests r where r.id = v_line.payment_request_id and r.status::text in ('paid','cancelled'))
    or exists (select 1 from public.payment_receipts r where r.payment_request_id = v_line.payment_request_id)
  then raise exception 'cie_reference_line_locked'; end if;
  if v_layout.status::text = 'uploaded' and not coalesce(p_bank_rejection_confirmed, false) then
    raise exception 'cie_reference_bank_rejection_confirmation_required';
  end if;
  if v_line.payment_reference is distinct from p_expected_reference or v_line.payment_concept is distinct from p_expected_concept then raise exception 'cie_reference_changed'; end if;
  if coalesce(v_line.convenio_number, '') !~ '^[0-9]{6,7}$' then raise exception 'cie_reference_invalid'; end if;
  v_error := private.cie_reference_error(v_reference, v_line.convenio_number);
  if v_error is not null then raise exception using message = v_error; end if;

  if nullif(v_concept, '') is null then raise exception 'cie_concept_required'; end if;
  if char_length(v_concept) > 30 or v_concept !~ '^[ -~]+$' or position('|' in v_concept) > 0 then raise exception 'cie_concept_invalid'; end if;

  if v_line.payment_reference is distinct from v_reference or v_line.payment_concept is distinct from v_concept then
    update public.payment_layout_lines set payment_reference = v_reference, payment_concept = v_concept, updated_at = clock_timestamp()
      where id = p_line_id;
    insert into private.payment_layout_cie_reference_audit(line_id,actor_profile_id,previous_reference,new_reference,bank_rejection_confirmed,previous_concept,new_concept)
      values(p_line_id,v_actor,v_line.payment_reference,v_reference,coalesce(p_bank_rejection_confirmed,false),v_line.payment_concept,v_concept);
  end if;
  return jsonb_build_object('id',p_line_id,'payment_reference',v_reference,'payment_concept',v_concept,'requires_redownload',true);
end;
$function$;
revoke all on function private.update_layout_cie_instructions(uuid,text,text,text,text,boolean) from public, anon;
grant execute on function private.update_layout_cie_instructions(uuid,text,text,text,text,boolean) to authenticated;

create or replace function public.update_payment_layout_line_cie_instructions(
  p_line_id uuid,
  p_payment_reference text,
  p_expected_reference text,
  p_payment_concept text,
  p_expected_concept text,
  p_bank_rejection_confirmed boolean default false
)
returns jsonb language sql security invoker set search_path = '' as $function$
  select private.update_layout_cie_instructions(p_line_id,p_payment_reference,p_expected_reference,p_payment_concept,p_expected_concept,p_bank_rejection_confirmed);
$function$;
revoke all on function public.update_payment_layout_line_cie_instructions(uuid,text,text,text,text,boolean) from public, anon;
grant execute on function public.update_payment_layout_line_cie_instructions(uuid,text,text,text,text,boolean) to authenticated;
