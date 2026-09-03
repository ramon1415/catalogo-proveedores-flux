-- Reembolsos: alinear la autorización de servidor con la experiencia React.
--
-- Contrato:
--   * operator: sólo crea un reembolso a su propio nombre y no lo edita después;
--   * finance/sysadmin: puede editar reembolsos no terminales de su empresa;
--   * director: puede decidir, pero no modificar datos operativos del reembolso;
--   * solicitudes terminales: sus datos operativos son inmutables.

-- El guard existente consultaba profile_company_memberships directamente. Bajo
-- RLS, Finanzas no puede ver la fila de membresía de otro beneficiario y el
-- trigger rechazaba una relación válida. Reutilizamos el helper canónico, que
-- sólo devuelve un booleano y no expone la membresía al navegador.
create or replace function private.enforce_payment_request_tenant_references()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.beneficiary_profile_id is not null
     and (
       new.company_id is null
       or not public.has_active_company_membership(
         new.beneficiary_profile_id,
         new.company_id
       )
     ) then
    raise exception 'beneficiary_company_membership_required';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_payment_request_tenant_references()
  from public, anon, authenticated;

create or replace function private.enforce_reimbursement_actor_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_actor uuid := public.current_profile_id();
  v_is_finance boolean;
  v_business_changed boolean := false;
begin
  -- Procesos internos sin JWT conservan su comportamiento. Las llamadas del
  -- navegador siempre tienen auth.uid() y deben resolver un perfil Flux.
  if auth.uid() is null then
    return new;
  end if;
  if v_actor is null then
    raise exception 'reimbursement_actor_profile_required';
  end if;

  if coalesce(new.request_type::text, '') <> 'reimbursement'
     and new.beneficiary_profile_id is null then
    return new;
  end if;

  v_is_finance := private.current_profile_has_company_role(
    new.company_id, array['finance','sysadmin']::text[]
  );

  if tg_op = 'INSERT' then
    if not v_is_finance
       and (
         new.requested_by is distinct from v_actor
         or new.beneficiary_profile_id is distinct from v_actor
       ) then
      raise exception 'reimbursement_operator_must_be_own_beneficiary';
    end if;
    return new;
  end if;

  v_business_changed := row(
    new.company_id,
    new.requested_by,
    new.beneficiary_profile_id,
    new.provider_id,
    new.proveedor_id,
    new.cost_center_id,
    new.budget_category_id,
    new.budget_month,
    new.amount_requested,
    new.currency,
    new.exchange_rate,
    new.description,
    new.notes,
    new.invoice_storage_path,
    new.invoice_uuid,
    new.subtotal_amount,
    new.tax_amount,
    new.withholding_amount,
    new.payment_method,
    new.is_extraordinary_adjustment
  ) is distinct from row(
    old.company_id,
    old.requested_by,
    old.beneficiary_profile_id,
    old.provider_id,
    old.proveedor_id,
    old.cost_center_id,
    old.budget_category_id,
    old.budget_month,
    old.amount_requested,
    old.currency,
    old.exchange_rate,
    old.description,
    old.notes,
    old.invoice_storage_path,
    old.invoice_uuid,
    old.subtotal_amount,
    old.tax_amount,
    old.withholding_amount,
    old.payment_method,
    old.is_extraordinary_adjustment
  );

  if old.status::text in ('approved','scheduled','paid','rejected','cancelled')
     and v_business_changed then
    raise exception 'reimbursement_terminal_request_immutable';
  end if;

  if v_is_finance then
    return new;
  end if;

  -- Dirección puede cambiar únicamente columnas del ciclo de decisión. Los
  -- datos operativos permanecen reservados para Finanzas.
  if old.requested_by is distinct from v_actor then
    if v_business_changed then
      raise exception 'reimbursement_finance_role_required_for_edit';
    end if;
    return new;
  end if;

  -- El único UPDATE del solicitante que se conserva es la metadata posterior
  -- a create_payment_request: payment_method mientras la solicitud acaba de
  -- quedar submitted. Cualquier otro cambio debe ser rechazado en servidor.
  if (
    to_jsonb(new) - array['updated_at','approval_material_updated_at','payment_method']::text[]
  ) is distinct from (
    to_jsonb(old) - array['updated_at','approval_material_updated_at','payment_method']::text[]
  ) then
    raise exception 'reimbursement_operator_edit_not_allowed';
  end if;
  if new.payment_method is distinct from old.payment_method
     and old.status::text <> 'submitted' then
    raise exception 'reimbursement_operator_edit_not_allowed';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_reimbursement_actor_scope()
  from public, anon, authenticated;

-- Evita recursión de RLS al comprobar si el desglose inicial ya existe. El
-- helper vive en private, sólo devuelve un booleano y no expone filas.
create or replace function private.reimbursement_has_no_items(
  p_payment_request_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select not exists (
    select 1
    from public.reimbursement_items item
    where item.payment_request_id = p_payment_request_id
      and item.company_id = p_company_id
  );
$function$;

revoke all on function private.reimbursement_has_no_items(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.reimbursement_has_no_items(uuid, uuid)
  to authenticated, service_role;

drop trigger if exists reimbursement_actor_scope_guard
  on public.payment_requests;
create trigger reimbursement_actor_scope_guard
before insert or update on public.payment_requests
for each row execute function private.enforce_reimbursement_actor_scope();

-- El operador inserta el desglose sólo para la solicitud que acaba de crear a
-- su propio nombre. La edición o eliminación posterior es exclusiva de
-- Finanzas y sólo mientras la solicitud no sea terminal.
drop policy if exists reimbursement_items_insert on public.reimbursement_items;
create policy reimbursement_items_insert
  on public.reimbursement_items
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.payment_requests request
      where request.id = reimbursement_items.payment_request_id
        and request.company_id = reimbursement_items.company_id
        and (
          private.current_profile_has_company_role(
            reimbursement_items.company_id, array['finance','sysadmin']::text[]
          )
          or (
            request.requested_by = public.current_profile_id()
            and request.beneficiary_profile_id = public.current_profile_id()
            and request.status::text = 'submitted'
            and private.reimbursement_has_no_items(
              request.id,
              request.company_id
            )
          )
        )
    )
  );

drop policy if exists reimbursement_items_update on public.reimbursement_items;
create policy reimbursement_items_update
  on public.reimbursement_items
  for update to authenticated
  using (
    exists (
      select 1
      from public.payment_requests request
      where request.id = reimbursement_items.payment_request_id
        and request.company_id = reimbursement_items.company_id
        and request.status::text not in ('approved','scheduled','paid','rejected','cancelled')
        and private.current_profile_has_company_role(
          reimbursement_items.company_id, array['finance','sysadmin']::text[]
        )
    )
  )
  with check (
    exists (
      select 1
      from public.payment_requests request
      where request.id = reimbursement_items.payment_request_id
        and request.company_id = reimbursement_items.company_id
        and request.status::text not in ('approved','scheduled','paid','rejected','cancelled')
        and private.current_profile_has_company_role(
          reimbursement_items.company_id, array['finance','sysadmin']::text[]
        )
    )
  );

drop policy if exists reimbursement_items_delete on public.reimbursement_items;
create policy reimbursement_items_delete
  on public.reimbursement_items
  for delete to authenticated
  using (
    exists (
      select 1
      from public.payment_requests request
      where request.id = reimbursement_items.payment_request_id
        and request.company_id = reimbursement_items.company_id
        and request.status::text not in ('approved','scheduled','paid','rejected','cancelled')
        and private.current_profile_has_company_role(
          reimbursement_items.company_id, array['finance','sysadmin']::text[]
        )
    )
  );

create or replace function public.update_reimbursement_request(
  p_payment_request_id uuid,
  p_beneficiary_profile_id uuid,
  p_cost_center_id uuid,
  p_budget_month date,
  p_currency text,
  p_exchange_rate numeric,
  p_description text,
  p_notes text,
  p_payment_method text,
  p_is_extraordinary_adjustment boolean,
  p_items jsonb
)
returns jsonb
language plpgsql
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_item jsonb;
  v_category_id uuid;
  v_dominant_category_id uuid;
  v_amount numeric;
  v_total numeric := 0;
  v_dominant_amount numeric := -1;
  v_item_subtotal numeric;
  v_item_tax numeric;
  v_deducible boolean;
  v_deducible_total numeric := 0;
  v_deducible_subtotal numeric := 0;
  v_tax numeric := 0;
  v_has_fiscal boolean := false;
  v_fiscal_ok boolean := false;
  v_subtotal numeric;
  v_invoice_uuid text;
  v_invoice_uuids text[] := array[]::text[];
  v_storage_path text;
  v_budget_month date;
  v_currency text;
  v_exchange_rate numeric;
  v_budget_amount numeric;
  v_old_budget_amount numeric;
  v_budget_result jsonb;
  v_budget_decision text;
  v_budget_block_reason text;
  v_available_before numeric;
  v_available_after numeric;
  v_shortfall numeric;
  v_old_counts boolean;
begin
  if auth.uid() is null or v_actor is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_request
  from public.payment_requests request
  where request.id = p_payment_request_id
  for update;
  if not found then
    raise exception 'reimbursement_request_not_found';
  end if;
  if v_request.request_type::text <> 'reimbursement'
     and v_request.beneficiary_profile_id is null then
    raise exception 'request_is_not_reimbursement';
  end if;
  if not private.current_profile_has_company_role(
    v_request.company_id, array['finance','sysadmin']::text[]
  ) then
    raise exception 'reimbursement_finance_role_required_for_edit';
  end if;
  if v_request.status::text in ('approved','scheduled','paid','rejected','cancelled') then
    raise exception 'reimbursement_terminal_request_immutable';
  end if;

  if p_beneficiary_profile_id is null
     or not public.has_active_company_membership(
       p_beneficiary_profile_id,
       v_request.company_id
     ) then
    raise exception 'beneficiary_company_membership_required';
  end if;
  if not exists (
    select 1
    from public.employee_bank_accounts account
    where account.profile_id = p_beneficiary_profile_id
      and account.company_id = v_request.company_id
      and nullif(btrim(account.beneficiary_name), '') is not null
      and nullif(btrim(account.banco), '') is not null
      and (
        coalesce(account.clabe, '') ~ '^[0-9]{18}$'
        or nullif(btrim(account.cuenta), '') is not null
      )
  ) then
    raise exception 'beneficiary_bank_account_required';
  end if;

  v_budget_month := date_trunc('month', p_budget_month)::date;
  v_currency := upper(coalesce(nullif(btrim(p_currency), ''), 'MXN'));
  v_exchange_rate := coalesce(p_exchange_rate, 1);
  if p_cost_center_id is null or v_budget_month is null then
    raise exception 'reimbursement_budget_scope_required';
  end if;
  if v_currency not in ('MXN','USD') or v_exchange_rate <= 0 then
    raise exception 'reimbursement_currency_invalid';
  end if;
  if coalesce(nullif(btrim(p_description), ''), '') = '' then
    raise exception 'reimbursement_description_required';
  end if;
  if p_payment_method not in ('transfer','cash','check','other') then
    raise exception 'reimbursement_payment_method_invalid';
  end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'reimbursement_items_required';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_category_id := nullif(v_item ->> 'budget_category_id', '')::uuid;
    v_amount := nullif(v_item ->> 'amount', '')::numeric;
    v_item_subtotal := nullif(v_item ->> 'subtotal_amount', '')::numeric;
    v_item_tax := nullif(v_item ->> 'tax_amount', '')::numeric;
    v_deducible := coalesce((v_item ->> 'deducible')::boolean, true);
    v_invoice_uuid := nullif(upper(btrim(coalesce(v_item ->> 'invoice_uuid', ''))), '');
    v_storage_path := nullif(btrim(coalesce(v_item ->> 'storage_path', '')), '');

    if nullif(btrim(coalesce(v_item ->> 'descripcion', '')), '') is null then
      raise exception 'reimbursement_item_description_required';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'reimbursement_item_amount_invalid';
    end if;
    if v_category_id is null or not exists (
      select 1
      from public.company_cost_center_budget_categories relation
      where relation.company_id = v_request.company_id
        and relation.cost_center_id = p_cost_center_id
        and relation.budget_category_id = v_category_id
        and relation.active
    ) then
      raise exception 'reimbursement_item_budget_category_invalid';
    end if;
    if v_deducible and v_storage_path is null then
      raise exception 'reimbursement_item_receipt_required';
    end if;
    if v_item_subtotal is not null and v_item_subtotal <= 0 then
      raise exception 'reimbursement_item_subtotal_invalid';
    end if;
    if coalesce(v_item_tax, 0) < 0 then
      raise exception 'reimbursement_item_tax_invalid';
    end if;
    if v_invoice_uuid is not null then
      if v_invoice_uuid !~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' then
        raise exception 'reimbursement_item_invoice_uuid_invalid';
      end if;
      if v_invoice_uuid = any(v_invoice_uuids) then
        raise exception 'reimbursement_item_invoice_uuid_duplicate';
      end if;
      v_invoice_uuids := array_append(v_invoice_uuids, v_invoice_uuid);
    end if;

    v_total := v_total + v_amount;
    if v_amount > v_dominant_amount then
      v_dominant_amount := v_amount;
      v_dominant_category_id := v_category_id;
    end if;
    if v_deducible and v_item_subtotal is not null then
      v_has_fiscal := true;
      v_deducible_total := v_deducible_total + v_amount;
      v_deducible_subtotal := v_deducible_subtotal + v_item_subtotal;
      v_tax := v_tax + coalesce(v_item_tax, 0);
    end if;
  end loop;

  v_total := round(v_total, 2);
  v_fiscal_ok := v_has_fiscal
    and abs((v_deducible_subtotal + v_tax) - v_deducible_total) <= 0.01;
  v_subtotal := case when v_fiscal_ok then round(v_total - v_tax, 2) else null end;
  v_tax := case when v_fiscal_ok then round(v_tax, 2) else null end;
  v_budget_amount := round(coalesce(v_subtotal, v_total) * v_exchange_rate, 2);

  v_budget_result := public.verify_budget_availability(
    v_request.company_id,
    p_cost_center_id,
    v_dominant_category_id,
    v_budget_month,
    v_budget_amount,
    coalesce(p_is_extraordinary_adjustment, false)
  );

  -- La vista ya descuenta la solicitud vigente. Si la edición conserva su
  -- misma línea presupuestal, se devuelve temporalmente ese compromiso antes
  -- de evaluar el nuevo monto para evitar contarlo dos veces.
  v_old_counts := v_request.status::text in (
      'submitted','pending_approval','approved','finance_validation','scheduled','paid'
    ) and v_request.budget_decision = 'aprobable';
  if v_old_counts
     and v_request.cost_center_id = p_cost_center_id
     and v_request.budget_category_id = v_dominant_category_id
     and date_trunc('month', v_request.budget_month)::date = v_budget_month
     and not coalesce(p_is_extraordinary_adjustment, false)
     and coalesce(v_budget_result ->> 'motivo', 'sin_disponible') in ('sin_disponible','') then
    v_old_budget_amount := round(
      coalesce(v_request.subtotal_amount, v_request.amount_requested)
      * coalesce(v_request.exchange_rate, 1),
      2
    );
    v_available_before := coalesce((v_budget_result ->> 'disponible_actual')::numeric, 0)
      + v_old_budget_amount;
    v_available_after := v_available_before - v_budget_amount;
    v_shortfall := greatest(v_budget_amount - v_available_before, 0);
    v_budget_result := jsonb_build_object(
      'status', case when v_shortfall = 0 then 'aprobable' else 'bloqueado' end,
      'motivo', case when v_shortfall = 0 then null else 'sin_disponible' end,
      'disponible_actual', v_available_before,
      'disponible_despues', v_available_after,
      'faltante', v_shortfall
    );
  end if;

  v_budget_decision := coalesce(v_budget_result ->> 'status', 'bloqueado');
  v_budget_block_reason := v_budget_result ->> 'motivo';
  v_available_before := nullif(v_budget_result ->> 'disponible_actual', '')::numeric;
  v_available_after := nullif(v_budget_result ->> 'disponible_despues', '')::numeric;
  v_shortfall := nullif(v_budget_result ->> 'faltante', '')::numeric;

  update public.payment_requests request
  set beneficiary_profile_id = p_beneficiary_profile_id,
      cost_center_id = p_cost_center_id,
      budget_category_id = v_dominant_category_id,
      budget_month = v_budget_month,
      amount_requested = v_total,
      currency = v_currency,
      exchange_rate = v_exchange_rate,
      description = btrim(p_description),
      concept = btrim(p_description),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      payment_method = p_payment_method,
      is_extraordinary_adjustment = coalesce(p_is_extraordinary_adjustment, false),
      subtotal_amount = v_subtotal,
      tax_amount = v_tax,
      withholding_amount = null,
      invoice_uuid = null,
      budget_decision = v_budget_decision,
      budget_block_reason = v_budget_block_reason,
      budget_available_before = v_available_before,
      budget_available_after = v_available_after,
      budget_shortfall = v_shortfall,
      budget_checked_at = now(),
      budget_result = v_budget_result,
      updated_at = now()
  where request.id = v_request.id;

  delete from public.reimbursement_items item
  where item.payment_request_id = v_request.id
    and item.company_id = v_request.company_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.reimbursement_items (
      payment_request_id,
      company_id,
      budget_category_id,
      descripcion,
      amount,
      subtotal_amount,
      tax_amount,
      deducible,
      invoice_uuid,
      cfdi_data,
      storage_path
    ) values (
      v_request.id,
      v_request.company_id,
      (v_item ->> 'budget_category_id')::uuid,
      btrim(v_item ->> 'descripcion'),
      (v_item ->> 'amount')::numeric,
      nullif(v_item ->> 'subtotal_amount', '')::numeric,
      nullif(v_item ->> 'tax_amount', '')::numeric,
      coalesce((v_item ->> 'deducible')::boolean, true),
      nullif(upper(btrim(coalesce(v_item ->> 'invoice_uuid', ''))), ''),
      v_item -> 'cfdi_data',
      nullif(btrim(coalesce(v_item ->> 'storage_path', '')), '')
    );
  end loop;

  return jsonb_build_object(
    'payment_request_id', v_request.id,
    'beneficiary_profile_id', p_beneficiary_profile_id,
    'amount_requested', v_total,
    'budget_category_id', v_dominant_category_id,
    'budget_decision', v_budget_decision,
    'budget_result', v_budget_result
  );
end;
$function$;

revoke all on function public.update_reimbursement_request(
  uuid, uuid, uuid, date, text, numeric, text, text, text, boolean, jsonb
) from public, anon;
grant execute on function public.update_reimbursement_request(
  uuid, uuid, uuid, date, text, numeric, text, text, text, boolean, jsonb
) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- Integración de reembolsos con cortes semanales, documentos y layouts.
--
-- Las funciones históricas modelaban todo pago por transferencia como pago a
-- proveedor. Conservamos esos contratos como implementación base y aplicamos
-- una capa explícita para reembolsos: el beneficiario es el empleado, nunca un
-- registro artificial en proveedores.

create or replace function private.payment_request_payee_document(
  p_payment_request_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'provider', payee.display_name,
    'provider_name', payee.display_name,
    'request_type', request.request_type::text,
    'payee_kind', case
      when request.request_type::text = 'reimbursement'
        or request.beneficiary_profile_id is not null
        then 'employee_beneficiary'
      else 'provider'
    end
  )
  from public.payment_requests request
  left join public.proveedores provider
    on provider.id = request.proveedor_id
  left join public.employee_bank_accounts beneficiary_bank
    on beneficiary_bank.profile_id = request.beneficiary_profile_id
   and beneficiary_bank.company_id = request.company_id
  left join public.profiles beneficiary_profile
    on beneficiary_profile.id = request.beneficiary_profile_id
  cross join lateral (
    select case
      when request.request_type::text = 'reimbursement'
        or request.beneficiary_profile_id is not null
        then coalesce(
          nullif(btrim(beneficiary_bank.beneficiary_name), ''),
          nullif(btrim(beneficiary_profile.full_name), ''),
          'Beneficiario sin nombre'
        )
      else coalesce(
        nullif(btrim(provider.alias), ''),
        nullif(btrim(provider.nombre_completo), ''),
        'Proveedor sin nombre'
      )
    end as display_name
  ) payee
  where request.id = p_payment_request_id;
$function$;

revoke all on function private.payment_request_payee_document(uuid)
  from public, anon, authenticated;
grant execute on function private.payment_request_payee_document(uuid)
  to service_role;

-- Se conserva la evaluación histórica y sólo se reemplaza el requisito de
-- proveedor por el de beneficiario activo cuando la solicitud es reembolso.
alter function public.approval_batch_request_eligibility(uuid, uuid)
  rename to approval_batch_request_eligibility_pre_reimb;
revoke all on function public.approval_batch_request_eligibility_pre_reimb(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.approval_batch_request_eligibility_pre_reimb(uuid, uuid)
  to service_role;

create or replace function public.approval_batch_request_eligibility(
  p_payment_request_id uuid,
  p_exclude_batch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_request public.payment_requests%rowtype;
  v_result jsonb;
  v_budget jsonb;
  v_missing text[] := array[]::text[];
  v_budget_exception_current boolean := false;
begin
  v_result := public.approval_batch_request_eligibility_pre_reimb(
    p_payment_request_id,
    p_exclude_batch_id
  );

  select * into v_request
  from public.payment_requests request
  where request.id = p_payment_request_id;

  if not found
     or not (
       coalesce(v_request.request_type::text = 'reimbursement', false)
       or v_request.beneficiary_profile_id is not null
     ) then
    return v_result;
  end if;

  select coalesce(array_agg(value), array[]::text[])
    into v_missing
  from jsonb_array_elements_text(
    coalesce(v_result -> 'missing_fields', '[]'::jsonb)
  ) missing(value)
  where value not in ('proveedor_id', 'proveedor_not_found', 'proveedor_inactive');

  if v_request.beneficiary_profile_id is null then
    v_missing := array_append(v_missing, 'beneficiary_profile_id');
  elsif not public.has_active_company_membership(
    v_request.beneficiary_profile_id,
    v_request.company_id
  ) then
    v_missing := array_append(v_missing, 'beneficiary_company_membership');
  end if;

  select coalesce(array_agg(distinct field order by field), array[]::text[])
    into v_missing
  from unnest(v_missing) field;

  v_result := v_result || jsonb_build_object(
    'missing_fields', to_jsonb(v_missing),
    'request_type', 'reimbursement',
    'payee_kind', 'employee_beneficiary'
  );

  if cardinality(v_missing) > 0
     and coalesce(v_result ->> 'classification', '') in (
       'invalid_data', 'ready_for_batch'
     ) then
    return v_result || jsonb_build_object(
      'eligible', false,
      'classification', 'invalid_data',
      'reason', 'minimum_direction_data_missing'
    );
  end if;

  -- La implementación histórica se detuvo antes de presupuesto cuando el
  -- único faltante era proveedor_id. Retomamos exactamente ese último gate.
  if cardinality(v_missing) = 0
     and v_result ->> 'classification' = 'invalid_data'
     and v_result ->> 'reason' = 'minimum_direction_data_missing' then
    v_budget := public.approval_batch_budget_validation(v_request.id);
    v_budget_exception_current :=
      public.payment_request_has_current_approved_budget_exception(v_request);

    if coalesce(v_budget ->> 'status', 'bloqueado') <> 'aprobable'
       and not v_budget_exception_current then
      return v_result || jsonb_build_object(
        'eligible', false,
        'classification', case
          when v_budget ->> 'motivo' in (
            'sin_disponible',
            'partida_no_presupuestada',
            'sin_match_presupuesto'
          ) then 'budget_insufficient'
          else 'budget_validation_required'
        end,
        'reason', coalesce(
          v_budget ->> 'motivo',
          'budget_validation_required'
        ),
        'budget_status', v_budget ->> 'status',
        'budget_reason', v_budget ->> 'motivo',
        'budget_available', nullif(v_budget ->> 'disponible_actual', '')::numeric,
        'budget_after', nullif(v_budget ->> 'disponible_despues', '')::numeric,
        'budget_shortfall', nullif(v_budget ->> 'faltante', '')::numeric,
        'budget_authorization_source', null
      );
    end if;

    return v_result || jsonb_build_object(
      'eligible', true,
      'classification', 'ready_for_batch',
      'reason', null,
      'budget_status', v_budget ->> 'status',
      'budget_reason', v_budget ->> 'motivo',
      'budget_available', nullif(v_budget ->> 'disponible_actual', '')::numeric,
      'budget_after', nullif(v_budget ->> 'disponible_despues', '')::numeric,
      'budget_shortfall', nullif(v_budget ->> 'faltante', '')::numeric,
      'budget_authorization_source', case
        when v_budget_exception_current then 'approved_exception'
        else 'live_budget'
      end
    );
  end if;

  return v_result;
end;
$function$;

revoke all on function public.approval_batch_request_eligibility(uuid, uuid)
  from public, anon;
grant execute on function public.approval_batch_request_eligibility(uuid, uuid)
  to authenticated, service_role;

-- Las listas y el detalle mantienen su JSON compatible y agregan dos campos:
-- request_type y payee_kind. provider_name se conserva por compatibilidad, pero
-- para reembolsos contiene el nombre del empleado beneficiario.
alter function public.list_batch_eligible_requests(uuid)
  rename to list_batch_eligible_requests_pre_reimb;
revoke all on function public.list_batch_eligible_requests_pre_reimb(uuid)
  from public, anon, authenticated;
grant execute on function public.list_batch_eligible_requests_pre_reimb(uuid)
  to service_role;

create or replace function public.list_batch_eligible_requests(p_company_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(
    request_document || coalesce(
      private.payment_request_payee_document(
        nullif(request_document ->> 'id', '')::uuid
      ),
      '{}'::jsonb
    )
    order by ordinal
  ), '[]'::jsonb)
  from jsonb_array_elements(
    public.list_batch_eligible_requests_pre_reimb(p_company_id)
  ) with ordinality rows(request_document, ordinal);
$function$;

revoke all on function public.list_batch_eligible_requests(uuid)
  from public, anon;
grant execute on function public.list_batch_eligible_requests(uuid)
  to authenticated, service_role;

alter function public.get_approval_batch_detail(uuid)
  rename to get_approval_batch_detail_pre_reimb;
revoke all on function public.get_approval_batch_detail_pre_reimb(uuid)
  from public, anon, authenticated;
grant execute on function public.get_approval_batch_detail_pre_reimb(uuid)
  to service_role;

create or replace function public.get_approval_batch_detail(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_document jsonb;
  v_items jsonb;
begin
  v_document := public.get_approval_batch_detail_pre_reimb(p_batch_id);

  select coalesce(jsonb_agg(
    item_document || coalesce(
      private.payment_request_payee_document(
        nullif(item_document ->> 'payment_request_id', '')::uuid
      ),
      '{}'::jsonb
    )
    order by ordinal
  ), '[]'::jsonb)
    into v_items
  from jsonb_array_elements(
    coalesce(v_document -> 'items', '[]'::jsonb)
  ) with ordinality rows(item_document, ordinal);

  return jsonb_set(v_document, '{items}', v_items, true);
end;
$function$;

revoke all on function public.get_approval_batch_detail(uuid)
  from public, anon;
grant execute on function public.get_approval_batch_detail(uuid)
  to authenticated, service_role;

-- Los documentos de envío y decisión reutilizan todas las comprobaciones de
-- evento/worker originales. Sólo se normaliza la identidad de quien cobra.
alter function public.get_approval_batch_submitted_notification_document(uuid, text)
  rename to get_approval_batch_submitted_notification_document_pre_reimb;
revoke all on function public.get_approval_batch_submitted_notification_document_pre_reimb(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_approval_batch_submitted_notification_document_pre_reimb(uuid, text)
  to service_role;

create or replace function public.get_approval_batch_submitted_notification_document(
  p_notification_event_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_document jsonb;
  v_items jsonb;
begin
  v_document := public.get_approval_batch_submitted_notification_document_pre_reimb(
    p_notification_event_id,
    p_worker_id
  );

  select coalesce(jsonb_agg(
    item_document || coalesce(
      private.payment_request_payee_document(batch_item.payment_request_id),
      '{}'::jsonb
    )
    order by ordinal
  ), '[]'::jsonb)
    into v_items
  from jsonb_array_elements(
    coalesce(v_document -> 'items', '[]'::jsonb)
  ) with ordinality rows(item_document, ordinal)
  left join public.approval_batch_items batch_item
    on batch_item.id = nullif(item_document ->> 'item_id', '')::uuid;

  return jsonb_set(v_document, '{items}', v_items, true);
end;
$function$;

revoke all on function public.get_approval_batch_submitted_notification_document(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_approval_batch_submitted_notification_document(uuid, text)
  to service_role;

alter function public.get_approval_batch_decision_notification_document(uuid, text)
  rename to get_approval_batch_decision_notification_document_pre_reimb;
revoke all on function public.get_approval_batch_decision_notification_document_pre_reimb(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_approval_batch_decision_notification_document_pre_reimb(uuid, text)
  to service_role;

create or replace function public.get_approval_batch_decision_notification_document(
  p_notification_event_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_document jsonb;
  v_items jsonb;
begin
  v_document := public.get_approval_batch_decision_notification_document_pre_reimb(
    p_notification_event_id,
    p_worker_id
  );

  select coalesce(jsonb_agg(
    item_document || coalesce(
      private.payment_request_payee_document(batch_item.payment_request_id),
      '{}'::jsonb
    )
    order by ordinal
  ), '[]'::jsonb)
    into v_items
  from jsonb_array_elements(
    coalesce(v_document -> 'items', '[]'::jsonb)
  ) with ordinality rows(item_document, ordinal)
  left join public.approval_batch_items batch_item
    on batch_item.id = nullif(item_document ->> 'item_id', '')::uuid;

  return jsonb_set(v_document, '{items}', v_items, true);
end;
$function$;

revoke all on function public.get_approval_batch_decision_notification_document(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_approval_batch_decision_notification_document(uuid, text)
  to service_role;

-- El formulario de completado de Layouts también exigía un proveedor activo
-- antes de guardar fecha, referencia y cuenta origen. El flujo normal conserva
-- literalmente esa implementación; la rama de reembolso valida el destino
-- contra employee_bank_accounts y actualiza sólo datos operativos.
alter function public.complete_payment_request_layout_data(
  uuid, uuid, text, text, date
) rename to complete_payment_request_layout_data_pre_reimb;
revoke all on function public.complete_payment_request_layout_data_pre_reimb(
  uuid, uuid, text, text, date
) from public, anon, authenticated;
grant execute on function public.complete_payment_request_layout_data_pre_reimb(
  uuid, uuid, text, text, date
) to service_role;

create or replace function public.complete_payment_request_layout_data(
  p_payment_request_id uuid,
  p_company_bank_account_id uuid default null,
  p_payment_reference text default null,
  p_payment_concept text default null,
  p_scheduled_payment_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid;
  v_is_reimbursement boolean;
  v_request_before public.payment_requests%rowtype;
  v_request_after public.payment_requests%rowtype;
  v_reference text;
  v_reference_issue text;
  v_destination_type text;
  v_concept text;
  v_account_id uuid;
  v_schedule date;
  v_material_before timestamptz;
  v_direction_was_current boolean;
  v_direction_is_current boolean;
  v_direction_reapproval_required boolean := false;
  v_changed_fields text[];
  v_completed_fields text[];
  v_missing_before text[];
  v_missing_after text[];
begin
  if p_payment_request_id is null then
    raise exception 'payment_request_required';
  end if;

  select coalesce(request.request_type::text = 'reimbursement', false)
      or request.beneficiary_profile_id is not null
    into v_is_reimbursement
  from public.payment_requests request
  where request.id = p_payment_request_id;

  if not found then
    raise exception 'payment_request_not_found';
  end if;

  if not v_is_reimbursement then
    return public.complete_payment_request_layout_data_pre_reimb(
      p_payment_request_id,
      p_company_bank_account_id,
      p_payment_reference,
      p_payment_concept,
      p_scheduled_payment_date
    );
  end if;

  v_actor := public.approval_batch_require_finance();
  perform pg_advisory_xact_lock(
    hashtextextended(p_payment_request_id::text, 21021)
  );

  select * into v_request_before
  from public.payment_requests request
  where request.id = p_payment_request_id
  for update;

  if v_request_before.status::text in ('paid', 'cancelled')
     or public.approval_batch_request_has_any_execution_record(
       v_request_before.id
     ) then
    raise exception 'payment_request_layout_data_locked';
  end if;

  if v_request_before.beneficiary_profile_id is null
     or not public.has_active_company_membership(
       v_request_before.beneficiary_profile_id,
       v_request_before.company_id
     ) then
    raise exception 'reimbursement_beneficiary_membership_required';
  end if;

  select case
    when regexp_replace(
      coalesce(account.clabe, ''), '[[:space:]-]', '', 'g'
    ) <> '' then 'clabe'
    when regexp_replace(
      coalesce(account.cuenta, ''), '[[:space:]-]', '', 'g'
    ) <> '' then 'cuenta'
    else null
  end
    into v_destination_type
  from public.employee_bank_accounts account
  where account.profile_id = v_request_before.beneficiary_profile_id
    and account.company_id = v_request_before.company_id;

  v_account_id := coalesce(
    p_company_bank_account_id,
    v_request_before.company_bank_account_id
  );

  if v_account_id is not null and not exists (
    select 1
    from public.company_bank_accounts company_account
    where company_account.id = v_account_id
      and company_account.company_id = v_request_before.company_id
      and coalesce(company_account.active, false)
      and nullif(btrim(company_account.account_number), '') is not null
  ) then
    raise exception
      'company_bank_account_not_found_inactive_or_company_mismatch';
  end if;

  if p_payment_reference is null then
    v_reference := nullif(btrim(v_request_before.payment_reference), '');
  elsif v_destination_type = 'clabe' then
    v_reference := nullif(regexp_replace(
      coalesce(p_payment_reference, ''), '[[:space:]]', '', 'g'
    ), '');
  else
    v_reference := nullif(btrim(p_payment_reference), '');
  end if;

  v_reference_issue := public.payment_layout_reference_issue(
    v_reference,
    v_destination_type
  );

  if v_reference_issue = 'payment_reference_invalid' then
    if v_destination_type = 'clabe' and v_reference !~ '^[0-9]+$' then
      raise exception 'payment_reference_must_be_numeric';
    elsif v_destination_type = 'clabe' then
      raise exception 'payment_reference_too_long';
    else
      raise exception 'payment_reference_invalid';
    end if;
  end if;

  if p_payment_concept is null then
    v_concept := v_request_before.payment_concept;
  else
    v_concept := nullif(btrim(p_payment_concept), '');
  end if;

  if v_concept is not null and char_length(v_concept) > 120 then
    raise exception 'payment_concept_too_long';
  end if;
  if v_concept is not null and v_concept ~ '[[:cntrl:]]' then
    raise exception 'payment_concept_invalid_characters';
  end if;

  v_schedule := coalesce(
    p_scheduled_payment_date,
    v_request_before.scheduled_payment_date,
    v_request_before.due_date
  );
  v_material_before := v_request_before.approval_material_updated_at;
  v_direction_was_current :=
    public.approval_batch_request_has_current_direction_approval(
      v_request_before.id
    );
  v_missing_before :=
    public.payment_request_layout_missing_fields(v_request_before);

  v_changed_fields := array_remove(array[
    case when v_request_before.company_bank_account_id is distinct from
      v_account_id then 'company_bank_account_id' end,
    case when v_request_before.payment_reference is distinct from
      v_reference then 'payment_reference' end,
    case when v_request_before.payment_concept is distinct from
      v_concept then 'payment_concept' end,
    case when v_request_before.scheduled_payment_date is distinct from
      v_schedule then 'scheduled_payment_date' end
  ]::text[], null);

  perform set_config(
    'flux.payment_execution_rpc',
    v_request_before.id::text,
    true
  );

  update public.payment_requests request
  set company_bank_account_id = v_account_id,
      payment_reference = v_reference,
      payment_concept = v_concept,
      scheduled_payment_date = v_schedule,
      scheduled_by = case
        when v_schedule is distinct from request.scheduled_payment_date
          then v_actor
        else request.scheduled_by
      end,
      scheduled_at = case
        when v_schedule is distinct from request.scheduled_payment_date
          then clock_timestamp()
        else request.scheduled_at
      end,
      updated_at = clock_timestamp()
  where request.id = v_request_before.id;

  select * into v_request_after
  from public.payment_requests request
  where request.id = v_request_before.id;

  if v_request_after.approval_material_updated_at is distinct from
     v_material_before then
    raise exception 'operational_update_changed_approval_material_timestamp';
  end if;

  v_direction_is_current :=
    public.approval_batch_request_has_current_direction_approval(
      v_request_after.id
    );
  if v_direction_was_current and not v_direction_is_current then
    raise exception 'operational_update_invalidated_direction_approval';
  end if;

  v_missing_after :=
    public.payment_request_layout_missing_fields(v_request_after);

  select coalesce(
    array_agg(completed.field_name order by completed.field_name),
    array[]::text[]
  ) into v_completed_fields
  from unnest(v_missing_before) completed(field_name)
  where not (completed.field_name = any(v_missing_after));

  v_direction_reapproval_required := not v_direction_is_current and exists (
    select 1
    from public.approval_batch_items item
    where item.payment_request_id = v_request_after.id
      and item.removed_at is null
      and item.director_status = 'approved'
      and item.decided_at is not null
      and item.decided_at < v_request_after.approval_material_updated_at
  );

  return jsonb_build_object(
    'payment_request_id', v_request_after.id,
    'direction_was_current', v_direction_was_current,
    'direction_approval_current', v_direction_is_current,
    'direction_reapproval_required', v_direction_reapproval_required,
    'approval_preserved',
      v_direction_was_current and v_direction_is_current,
    'execution_data_updated', cardinality(v_changed_fields) > 0,
    'changed_fields', to_jsonb(v_changed_fields),
    'completed_fields', to_jsonb(v_completed_fields),
    'missing_fields', to_jsonb(v_missing_after),
    'history_preserved', true
  );
end;
$function$;

revoke all on function public.complete_payment_request_layout_data(
  uuid, uuid, text, text, date
) from public, anon;
grant execute on function public.complete_payment_request_layout_data(
  uuid, uuid, text, text, date
) to authenticated, service_role;

-- El candidato heredado calcula faltantes bancarios desde proveedores. Para
-- reembolsos retiramos exclusivamente esos campos y ejecutamos el validador
-- canónico de la cuenta del empleado, aislada por empresa.
create or replace function private.reimbursement_layout_missing_fields(
  p_candidate_missing text[],
  p_request public.payment_requests
)
returns text[]
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(array_agg(distinct field order by field), array[]::text[])
  from (
    select field
    from unnest(coalesce(p_candidate_missing, array[]::text[])) field
    where field not in (
      'proveedor_id', 'proveedor_not_found', 'proveedor_inactive',
      'beneficiary_name', 'beneficiary_name_invalid',
      'destination_type', 'destination_type_invalid',
      'clabe', 'clabe_invalid',
      'cuenta_bancaria', 'cuenta_bancaria_invalid',
      'convenio_number', 'convenio_number_invalid',
      'banco', 'banco_invalid'
    )
    union all
    select field
    from unnest(public.payment_request_layout_missing_fields(p_request)) field
  ) fields
  where field is not null;
$function$;

revoke all on function private.reimbursement_layout_missing_fields(
  text[], public.payment_requests
) from public, anon, authenticated;
grant execute on function private.reimbursement_layout_missing_fields(
  text[], public.payment_requests
) to service_role;

create or replace function public.approval_batch_payment_layout_candidates(
  p_period_start date,
  p_period_end date,
  p_company_id uuid default null::uuid,
  p_company_bank_account_id uuid default null::uuid
)
returns table(
  classification text,
  classification_reason text,
  payment_request_id uuid,
  request_number text,
  request_status text,
  company_id uuid,
  company_name text,
  proveedor_id uuid,
  provider_name text,
  company_bank_account_id uuid,
  source_account_number text,
  destination_type text,
  destination_value text,
  beneficiary_name text,
  amount numeric,
  currency text,
  payment_reference text,
  payment_concept text,
  scheduled_payment_date date,
  missing_fields text[],
  finance_approval_current boolean,
  direction_approval_current boolean,
  direction_decided_at timestamptz,
  enforcement_required boolean,
  source_item_id uuid,
  source_batch_id uuid,
  source_batch_label text,
  source_batch_status text,
  director_status text,
  reject_reason text,
  rejected_by uuid,
  rejected_by_name text,
  rejected_at timestamptz,
  rebatch_status text,
  latest_correction_note text,
  extraordinary_authorization_id uuid,
  extraordinary_category text,
  extraordinary_reason text,
  extraordinary_authorized_by uuid,
  extraordinary_authorized_by_name text,
  extraordinary_authorized_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  with resolved as (
    select
      candidate.*,
      coalesce(request.request_type::text = 'reimbursement', false)
        or request.beneficiary_profile_id is not null as is_reimbursement,
      case
        when request.request_type::text = 'reimbursement'
          or request.beneficiary_profile_id is not null
          then private.reimbursement_layout_missing_fields(
            candidate.missing_fields,
            request
          )
        else candidate.missing_fields
      end as effective_missing_fields,
      coalesce(
        nullif(btrim(beneficiary_bank.beneficiary_name), ''),
        nullif(btrim(beneficiary_profile.full_name), ''),
        candidate.provider_name,
        'Beneficiario sin nombre'
      ) as employee_name,
      case
        when regexp_replace(
          coalesce(beneficiary_bank.clabe, ''), '[[:space:]-]', '', 'g'
        ) <> '' then 'clabe'
        when regexp_replace(
          coalesce(beneficiary_bank.cuenta, ''), '[[:space:]-]', '', 'g'
        ) <> '' then 'cuenta'
        else candidate.destination_type
      end as employee_destination_type,
      coalesce(
        nullif(regexp_replace(
          coalesce(beneficiary_bank.clabe, ''), '[[:space:]-]', '', 'g'
        ), ''),
        nullif(regexp_replace(
          coalesce(beneficiary_bank.cuenta, ''), '[[:space:]-]', '', 'g'
        ), ''),
        candidate.destination_value
      ) as employee_destination_value
    from public.approval_batch_payment_layout_candidates_pre_037(
      p_period_start,
      p_period_end,
      p_company_id,
      p_company_bank_account_id
    ) candidate
    join public.payment_requests request
      on request.id = candidate.payment_request_id
    left join public.employee_bank_accounts beneficiary_bank
      on beneficiary_bank.profile_id = request.beneficiary_profile_id
     and beneficiary_bank.company_id = request.company_id
    left join public.profiles beneficiary_profile
      on beneficiary_profile.id = request.beneficiary_profile_id
    where request.request_type::text is distinct from 'nomina'
  ), normalized as (
    select
      resolved.*,
      case
        when resolved.is_reimbursement
         and resolved.classification = 'invalid_data'
         and resolved.classification_reason = 'incomplete_layout_data'
         and cardinality(resolved.effective_missing_fields) = 0 then
          case
            when resolved.extraordinary_authorization_id is not null
              then 'ready_extraordinary'
            when resolved.source_batch_status in ('draft', 'submitted')
              then 'pending_director'
            when resolved.director_status = 'approved'
             and not coalesce(resolved.direction_approval_current, false)
              then 'direction_reapproval_required'
            when resolved.director_status = 'approved'
             and resolved.source_batch_status in ('approved', 'partially_approved')
              then 'pending_finance_close'
            when resolved.director_status = 'approved'
             and resolved.source_batch_status = 'closed'
             and resolved.direction_approval_current
              then 'ready_regular'
            when resolved.director_status = 'rejected'
             and resolved.rebatch_status = 'released'
              then 'pending_director'
            when resolved.source_item_id is null
             and resolved.request_status = 'approved'
             and not resolved.enforcement_required
              then 'legacy_eligible'
            else 'pending_director'
          end
        else resolved.classification
      end as effective_classification,
      case
        when resolved.is_reimbursement
         and resolved.classification = 'invalid_data'
         and resolved.classification_reason = 'incomplete_layout_data'
         and cardinality(resolved.effective_missing_fields) = 0 then
          case
            when resolved.extraordinary_authorization_id is not null
              then 'extraordinary_authorized'
            when resolved.source_batch_status = 'draft' then 'batch_draft'
            when resolved.source_batch_status = 'submitted' then 'direction_pending'
            when resolved.director_status = 'approved'
             and not coalesce(resolved.direction_approval_current, false)
              then 'stale_direction_approval'
            when resolved.director_status = 'approved'
             and resolved.source_batch_status in ('approved', 'partially_approved')
              then 'finance_close_required'
            when resolved.director_status = 'rejected'
             and resolved.rebatch_status = 'released'
              then 'resubmission_available'
            when resolved.enforcement_required
             and resolved.source_item_id is null
              then 'closed_batch_required'
            when resolved.enforcement_required
              then 'direction_approval_required'
            when resolved.source_item_id is null
             and resolved.request_status = 'approved'
              then 'legacy_without_batch'
            else 'direction_approval_required'
          end
        else resolved.classification_reason
      end as effective_classification_reason
    from resolved
  )
  select
    case
      when normalized.effective_classification = 'ready_extraordinary'
       and not public.extraordinary_authorization_is_ready(
         normalized.extraordinary_authorization_id
       ) then 'invalid_data'
      else normalized.effective_classification
    end,
    case
      when normalized.effective_classification = 'ready_extraordinary'
       and not public.extraordinary_authorization_is_ready(
         normalized.extraordinary_authorization_id
       ) then 'extraordinary_not_ready_secure_contract'
      else normalized.effective_classification_reason
    end,
    normalized.payment_request_id,
    normalized.request_number,
    normalized.request_status,
    normalized.company_id,
    normalized.company_name,
    normalized.proveedor_id,
    case when normalized.is_reimbursement
      then normalized.employee_name else normalized.provider_name end,
    normalized.company_bank_account_id,
    normalized.source_account_number,
    case when normalized.is_reimbursement
      then normalized.employee_destination_type else normalized.destination_type end,
    case when normalized.is_reimbursement
      then normalized.employee_destination_value else normalized.destination_value end,
    case when normalized.is_reimbursement
      then normalized.employee_name else normalized.beneficiary_name end,
    normalized.amount,
    normalized.currency,
    normalized.payment_reference,
    normalized.payment_concept,
    normalized.scheduled_payment_date,
    normalized.effective_missing_fields,
    normalized.finance_approval_current,
    normalized.direction_approval_current,
    normalized.direction_decided_at,
    normalized.enforcement_required,
    normalized.source_item_id,
    normalized.source_batch_id,
    normalized.source_batch_label,
    normalized.source_batch_status,
    normalized.director_status,
    normalized.reject_reason,
    normalized.rejected_by,
    normalized.rejected_by_name,
    normalized.rejected_at,
    normalized.rebatch_status,
    normalized.latest_correction_note,
    normalized.extraordinary_authorization_id,
    normalized.extraordinary_category,
    normalized.extraordinary_reason,
    normalized.extraordinary_authorized_by,
    normalized.extraordinary_authorized_by_name,
    normalized.extraordinary_authorized_at
  from normalized;
$function$;

revoke all on function public.approval_batch_payment_layout_candidates(
  date, date, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.approval_batch_payment_layout_candidates(
  date, date, uuid, uuid
) to service_role;
