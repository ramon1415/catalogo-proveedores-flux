-- CIE: preserve the issuer reference and allow scoped correction of unpaid lines.
-- No backfill, payment execution, role changes or edits to historical payments.
create or replace function private.cie_reference_error(p_reference text, p_convenio text)
returns text language sql immutable set search_path = '' as $function$
  select case
    when nullif(btrim(p_reference), '') is null then 'cie_reference_required'
    when char_length(btrim(p_reference)) > 20 then 'cie_reference_too_long'
    when btrim(p_reference) !~ '^[ -~]+$' or position('|' in p_reference) > 0 then 'cie_reference_invalid'
    when btrim(p_convenio) ~ '^[0-9]{6,7}$'
      and lpad(btrim(p_convenio), 7, '0') = '0578869'
      and (char_length(btrim(p_reference)) <> 20 or btrim(p_reference) ~ '[[:space:]]')
      then 'cie_reference_cfe_requires_20_characters'
    else null
  end;
$function$;
revoke all on function private.cie_reference_error(text,text) from public, anon;
grant execute on function private.cie_reference_error(text,text) to authenticated, service_role;

create or replace function private.validate_layout_cie_reference()
returns trigger language plpgsql set search_path = '' as $function$
declare v_error text;
begin
  if lower(btrim(new.destination_type)) = 'convenio' then
    v_error := private.cie_reference_error(new.payment_reference, new.convenio_number);
    if v_error is not null then raise exception using message = v_error; end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.validate_layout_cie_reference() from public, anon, authenticated;

-- Runs after snapshot_payment_layout_line_convenio_trg alphabetically, so the
-- rule uses the immutable agreement snapshot rather than the live provider.
create trigger validate_layout_cie_reference_trg
before insert or update of payment_reference, convenio_number, destination_type
on public.payment_layout_lines
for each row execute function private.validate_layout_cie_reference();

create table private.payment_layout_cie_reference_audit (
  id bigint generated always as identity primary key,
  line_id uuid not null references public.payment_layout_lines(id),
  actor_profile_id uuid not null references public.profiles(id),
  previous_reference text,
  new_reference text not null,
  bank_rejection_confirmed boolean not null,
  created_at timestamptz not null default now()
);
alter table private.payment_layout_cie_reference_audit enable row level security;
revoke all on private.payment_layout_cie_reference_audit from public, anon, authenticated;
grant select on private.payment_layout_cie_reference_audit to service_role;

-- The existing line table has SELECT RLS only. Keep this narrowly privileged
-- operation in private; the public RPC is an invoker wrapper.
create or replace function private.update_layout_cie_reference(
  p_line_id uuid,
  p_payment_reference text,
  p_expected_reference text,
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
  if not coalesce(private.current_profile_has_company_role(v_line.company_id, public.flux_member_roles()), false) then
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
  if v_line.payment_reference is distinct from p_expected_reference then raise exception 'cie_reference_changed'; end if;
  if coalesce(v_line.convenio_number, '') !~ '^[0-9]{6,7}$' then raise exception 'cie_reference_invalid'; end if;
  v_error := private.cie_reference_error(v_reference, v_line.convenio_number);
  if v_error is not null then raise exception using message = v_error; end if;

  if v_line.payment_reference is distinct from v_reference then
    update public.payment_layout_lines set payment_reference = v_reference, updated_at = clock_timestamp()
      where id = p_line_id;
    insert into private.payment_layout_cie_reference_audit(line_id,actor_profile_id,previous_reference,new_reference,bank_rejection_confirmed)
      values(p_line_id,v_actor,v_line.payment_reference,v_reference,coalesce(p_bank_rejection_confirmed,false));
  end if;
  return jsonb_build_object('id',p_line_id,'payment_reference',v_reference,'requires_redownload',true);
end;
$function$;
revoke all on function private.update_layout_cie_reference(uuid,text,text,boolean) from public, anon;
grant execute on function private.update_layout_cie_reference(uuid,text,text,boolean) to authenticated;

create or replace function public.update_payment_layout_line_cie_reference(
  p_line_id uuid,
  p_payment_reference text,
  p_expected_reference text,
  p_bank_rejection_confirmed boolean default false
)
returns jsonb language sql security invoker set search_path = '' as $function$
  select private.update_layout_cie_reference(p_line_id,p_payment_reference,p_expected_reference,p_bank_rejection_confirmed);
$function$;
revoke all on function public.update_payment_layout_line_cie_reference(uuid,text,text,boolean) from public, anon;
grant execute on function public.update_payment_layout_line_cie_reference(uuid,text,text,boolean) to authenticated;
