begin;

create or replace function public.mark_payment_request_material_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.approval_material_updated_at := clock_timestamp();
    return new;
  end if;

  if pg_trigger_depth() > 1
     and new.approval_material_updated_at is distinct from old.approval_material_updated_at then
    return new;
  end if;

  if row(
    old.provider_id,
    old.provider_bank_account_id,
    old.proveedor_id,
    old.company_id,
    old.cost_center_id,
    old.budget_category_id,
    old.amount_requested,
    old.currency,
    old.exchange_rate,
    old.request_type,
    old.payment_method,
    old.company_bank_account_id,
    old.payment_concept
  ) is distinct from row(
    new.provider_id,
    new.provider_bank_account_id,
    new.proveedor_id,
    new.company_id,
    new.cost_center_id,
    new.budget_category_id,
    new.amount_requested,
    new.currency,
    new.exchange_rate,
    new.request_type,
    new.payment_method,
    new.company_bank_account_id,
    new.payment_concept
  ) then
    new.approval_material_updated_at := clock_timestamp();
  else
    new.approval_material_updated_at := old.approval_material_updated_at;
  end if;
  return new;
end
$$;

comment on function public.mark_payment_request_material_change()
  is 'Actualizar approval_material_updated_at ignorando cambios operativos no materiales (fecha programada de pago/referencia).';

commit;
