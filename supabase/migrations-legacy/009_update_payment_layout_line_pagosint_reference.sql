-- Permite completar referencia PAGOSINT en lineas de layout sin abrir update general a payment_layout_lines.

create or replace function public.update_payment_layout_line_pagosint_reference(
  p_line_id uuid,
  p_payment_reference text,
  p_beneficiary_name text default null,
  p_payment_concept text default null
)
returns table (
  id uuid,
  payment_reference text,
  beneficiary_name text,
  payment_concept text,
  updated_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference text := nullif(regexp_replace(coalesce(p_payment_reference, ''), '\D', '', 'g'), '');
  v_beneficiary text := nullif(btrim(coalesce(p_beneficiary_name, '')), '');
  v_concept text := nullif(btrim(coalesce(p_payment_concept, '')), '');
  v_destination_type text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not current_user_has_role(flux_member_roles()) then
    raise exception 'not_authorized_to_update_layout_lines';
  end if;

  if v_reference is null then
    raise exception 'pagosint_reference_required';
  end if;

  if length(v_reference) > 5 then
    raise exception 'pagosint_reference_too_long';
  end if;

  select pll.destination_type
    into v_destination_type
  from public.payment_layout_lines pll
  where pll.id = p_line_id
  for update;

  if not found then
    raise exception 'payment_layout_line_not_found';
  end if;

  if coalesce(v_destination_type, '') <> 'clabe' then
    raise exception 'pagosint_reference_only_for_interbank_lines';
  end if;

  return query
  update public.payment_layout_lines pll
     set payment_reference = v_reference,
         beneficiary_name = coalesce(v_beneficiary, pll.beneficiary_name),
         payment_concept = coalesce(v_concept, pll.payment_concept),
         updated_at = now()
   where pll.id = p_line_id
   returning pll.id, pll.payment_reference, pll.beneficiary_name, pll.payment_concept, pll.updated_at;
end;
$$;

revoke all on function public.update_payment_layout_line_pagosint_reference(uuid, text, text, text) from public;
grant execute on function public.update_payment_layout_line_pagosint_reference(uuid, text, text, text) to authenticated;
