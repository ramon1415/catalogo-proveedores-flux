begin;

alter table public.payment_requests
  add column if not exists partida_unsure boolean not null default false;

drop function if exists public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid,
  boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text
);

create or replace function public.create_payment_request(
  p_proveedor_id uuid,
  p_company_id uuid,
  p_cost_center_id uuid,
  p_budget_category_id uuid,
  p_budget_month date,
  p_amount_requested numeric,
  p_currency text default 'MXN'::text,
  p_exchange_rate numeric default 1,
  p_description text default null::text,
  p_notes text default null::text,
  p_requested_by uuid default null::uuid,
  p_is_extraordinary_adjustment boolean default false,
  p_approver_id uuid default null::uuid,
  p_approver_assignment_id uuid default null::uuid,
  p_subtotal_amount numeric default null,
  p_tax_amount numeric default null,
  p_withholding_amount numeric default null,
  p_invoice_uuid text default null,
  p_beneficiary_profile_id uuid default null,
  p_request_type text default null::text,
  p_partida_unsure boolean default false
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_current_profile_id uuid := public.current_profile_id();
  v_requester_id uuid;
  v_assignment public.approver_assignments%rowtype;
  v_has_pool boolean;
  v_budget_month date;
  v_currency text;
  v_exchange_rate numeric;
  v_budget_amount numeric;
  v_budget_result jsonb;
  v_budget_decision text;
  v_budget_block_reason text;
  v_available_before numeric;
  v_available_after numeric;
  v_shortfall numeric;
  v_request_number text;
  v_payment_request_id uuid;
  v_year integer;
  v_concept text;
  v_invoice_uuid text;
  v_request_type public.payment_request_type;
  v_is_reimbursement boolean;
begin
  if v_current_profile_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Tipo de solicitud: si no viene, se conserva el default histórico.
  v_request_type := coalesce(
    nullif(btrim(coalesce(p_request_type, '')), '')::public.payment_request_type,
    'provider_payment'::public.payment_request_type
  );
  -- Un beneficiario explícito también marca la solicitud como reembolso: el
  -- cliente viejo no manda p_request_type y no queremos dos fuentes de verdad.
  v_is_reimbursement := v_request_type = 'reimbursement'::public.payment_request_type
    or p_beneficiary_profile_id is not null;
  if v_is_reimbursement then
    v_request_type := 'reimbursement'::public.payment_request_type;
  end if;

  v_requester_id := coalesce(p_requested_by, v_current_profile_id);
  if v_requester_id <> v_current_profile_id
     and not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'requested_by_must_match_current_profile';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_requester_id and coalesce(active, true)
  ) then
    raise exception 'requested_by_not_found_or_inactive';
  end if;

  -- Destinatario del dinero: proveedor (normal) o empleado (reembolso).
  if v_is_reimbursement then
    if p_beneficiary_profile_id is null then
      raise exception 'beneficiary_profile_id_required';
    end if;
    if not exists (
      select 1 from public.profiles
      where id = p_beneficiary_profile_id and coalesce(active, true)
    ) then
      raise exception 'beneficiary_not_found_or_inactive';
    end if;
    -- Un reembolso puede referenciar al comercio como proveedor informativo,
    -- pero nunca es el destinatario; si viene, al menos debe existir.
    if p_proveedor_id is not null
       and not exists (select 1 from public.proveedores where id = p_proveedor_id) then
      raise exception 'El proveedor indicado no existe en public.proveedores';
    end if;
  else
    if p_proveedor_id is null then
      raise exception 'proveedor_id es obligatorio';
    end if;
    if not exists (select 1 from public.proveedores where id = p_proveedor_id) then
      raise exception 'El proveedor indicado no existe en public.proveedores';
    end if;
  end if;

  if p_company_id is null or not exists (
    select 1 from public.companies where id = p_company_id and coalesce(active, true)
  ) then
    raise exception 'La empresa indicada no existe';
  end if;
  if not public.has_active_company_membership(v_requester_id, p_company_id) then
    raise exception 'requester_company_membership_required';
  end if;
  if p_cost_center_id is null or not exists (
    select 1 from public.cost_centers where id = p_cost_center_id
  ) then
    raise exception 'El centro de costo indicado no existe';
  end if;
  if p_budget_category_id is null or not exists (
    select 1 from public.budget_categories where id = p_budget_category_id
  ) then
    raise exception 'La partida presupuestal indicada no existe';
  end if;
  if p_budget_month is null then
    raise exception 'budget_month es obligatorio';
  end if;
  if p_amount_requested is null or p_amount_requested <= 0 then
    raise exception 'amount_requested debe ser mayor a 0';
  end if;
  if p_approver_id is null then
    raise exception 'approver_id_required';
  end if;
  if p_approver_id = v_requester_id then
    raise exception 'requester_cannot_be_own_approver';
  end if;

  if p_subtotal_amount is not null then
    if p_subtotal_amount <= 0 then
      raise exception 'fiscal_subtotal_invalid';
    end if;
    if coalesce(p_tax_amount, 0) < 0 or coalesce(p_withholding_amount, 0) < 0 then
      raise exception 'fiscal_breakdown_invalid';
    end if;
    if abs((p_subtotal_amount + coalesce(p_tax_amount, 0) - coalesce(p_withholding_amount, 0)) - p_amount_requested) > 0.01 then
      raise exception 'fiscal_breakdown_mismatch';
    end if;
  elsif p_tax_amount is not null or p_withholding_amount is not null then
    raise exception 'fiscal_subtotal_required';
  end if;

  v_invoice_uuid := nullif(upper(trim(coalesce(p_invoice_uuid, ''))), '');
  if v_invoice_uuid is not null then
    if v_invoice_uuid !~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' then
      raise exception 'invoice_uuid_invalid';
    end if;
    if exists (
      select 1 from public.payment_requests pr
      where pr.company_id = p_company_id
        and upper(pr.invoice_uuid) = v_invoice_uuid
        and pr.status not in ('rejected', 'cancelled')
    ) then
      raise exception 'invoice_uuid_duplicate';
    end if;
  end if;

  v_has_pool := public.payment_request_has_active_approver_pool(v_requester_id, p_company_id);
  if v_has_pool then
    if p_approver_assignment_id is null then
      raise exception 'approver_assignment_id_required';
    end if;

    select * into v_assignment
    from public.approver_assignments aa
    where aa.id = p_approver_assignment_id
      and aa.company_id = p_company_id
      and aa.requester_id = v_requester_id
      and aa.approver_id = p_approver_id
      and aa.active;
    if not found then
      raise exception 'approver_not_in_configured_pool';
    end if;
    if not public.is_payment_request_approver_for_company(p_approver_id, p_company_id) then
      raise exception 'configured_approver_no_longer_eligible';
    end if;
  else
    if p_approver_assignment_id is not null then
      raise exception 'approver_assignment_not_allowed_without_pool';
    end if;
    if not public.payment_request_rule_allows(
      p_approver_id, p_company_id, p_cost_center_id, p_amount_requested, 'approved'
    ) then
      raise exception 'approver_not_allowed_by_approval_rules';
    end if;
  end if;

  v_currency := upper(coalesce(nullif(trim(p_currency), ''), 'MXN'));
  v_exchange_rate := coalesce(p_exchange_rate, 1);
  if v_exchange_rate <= 0 then
    raise exception 'exchange_rate debe ser mayor a 0';
  end if;

  v_budget_month := date_trunc('month', p_budget_month)::date;
  v_budget_amount := round(coalesce(p_subtotal_amount, p_amount_requested) * v_exchange_rate, 2);
  v_year := extract(year from v_budget_month)::integer;
  v_concept := coalesce(nullif(trim(p_description), ''), 'Solicitud de pago');

  v_budget_result := public.verify_budget_availability(
    p_company_id,
    p_cost_center_id,
    p_budget_category_id,
    v_budget_month,
    v_budget_amount,
    coalesce(p_is_extraordinary_adjustment, false)
  );
  v_budget_decision := coalesce(v_budget_result ->> 'status', 'bloqueado');
  if v_budget_decision not in ('aprobable', 'bloqueado') then
    v_budget_decision := 'bloqueado';
  end if;
  v_budget_block_reason := v_budget_result ->> 'motivo';
  v_available_before := nullif(v_budget_result ->> 'disponible_actual', '')::numeric;
  v_available_after := nullif(v_budget_result ->> 'disponible_despues', '')::numeric;
  v_shortfall := nullif(v_budget_result ->> 'faltante', '')::numeric;
  v_request_number := public.generate_payment_request_number(v_year);

  insert into public.payment_requests (
    provider_id, proveedor_id, beneficiary_profile_id,
    company_id, cost_center_id, budget_category_id,
    budget_month, request_type, requested_by, approver_id, approver_assignment_id,
    approver_selection_source,
    amount_requested, currency, exchange_rate, requires_invoice, invoice_received,
    subtotal_amount, tax_amount, withholding_amount, invoice_uuid,
    status, concept, description, notes, submitted_at, request_number,
    budget_decision, budget_block_reason, budget_available_before,
    budget_available_after, budget_shortfall, budget_checked_at, budget_result,
    is_extraordinary_adjustment, partida_unsure, created_at, updated_at
  ) values (
    null, p_proveedor_id, p_beneficiary_profile_id,
    p_company_id, p_cost_center_id, p_budget_category_id,
    v_budget_month, v_request_type, v_requester_id,
    p_approver_id, p_approver_assignment_id,
    case when p_approver_assignment_id is null then 'approval_rules' else 'assigned' end,
    p_amount_requested, v_currency,
    v_exchange_rate, false, false,
    p_subtotal_amount, p_tax_amount, p_withholding_amount, v_invoice_uuid,
    'submitted'::payment_request_status,
    v_concept, p_description, p_notes, now(), v_request_number,
    v_budget_decision, v_budget_block_reason, v_available_before,
    v_available_after, v_shortfall, now(), v_budget_result,
    coalesce(p_is_extraordinary_adjustment, false), coalesce(p_partida_unsure, false), now(), now()
  ) returning id into v_payment_request_id;

  return jsonb_build_object(
    'payment_request_id', v_payment_request_id,
    'request_number', v_request_number,
    'status', 'submitted',
    'request_type', v_request_type,
    'beneficiary_profile_id', p_beneficiary_profile_id,
    'budget_decision', v_budget_decision,
    'budget_block_reason', v_budget_block_reason,
    'budget_result', v_budget_result,
    'approver_id', p_approver_id,
    'approver_assignment_id', p_approver_assignment_id,
    'approver_source', case when p_approver_assignment_id is null then 'approval_rules' else 'assigned' end,
    'partida_unsure', coalesce(p_partida_unsure, false)
  );
end;
$function$;

alter function public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid,
  boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text, boolean
) owner to postgres;
revoke all on function public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid,
  boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text, boolean
) from public, anon;
grant execute on function public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid,
  boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text, boolean
) to authenticated, service_role;

drop function if exists public.create_payment_request_with_document(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text,
  uuid, boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text, text
);

create or replace function public.create_payment_request_with_document(
  p_proveedor_id uuid,
  p_company_id uuid,
  p_cost_center_id uuid,
  p_budget_category_id uuid,
  p_budget_month date,
  p_amount_requested numeric,
  p_currency text default 'MXN'::text,
  p_exchange_rate numeric default 1,
  p_description text default null::text,
  p_notes text default null::text,
  p_requested_by uuid default null::uuid,
  p_is_extraordinary_adjustment boolean default false,
  p_approver_id uuid default null::uuid,
  p_approver_assignment_id uuid default null::uuid,
  p_subtotal_amount numeric default null::numeric,
  p_tax_amount numeric default null::numeric,
  p_withholding_amount numeric default null::numeric,
  p_invoice_uuid text default null::text,
  p_beneficiary_profile_id uuid default null::uuid,
  p_request_type text default null::text,
  p_invoice_storage_path text default null::text,
  p_partida_unsure boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $function$
declare
  v_profile_id uuid := public.current_profile_id();
  v_result jsonb;
  v_request_id uuid;
  v_storage_path text := nullif(btrim(p_invoice_storage_path), '');
begin
  if v_profile_id is null then
    raise exception 'not_authenticated';
  end if;

  if lower(coalesce(nullif(btrim(p_request_type), ''), 'provider_payment')) = 'reimbursement' then
    raise exception 'request_document_wrapper_not_for_reimbursement';
  end if;

  if v_storage_path is null then
    raise exception 'request_document_required';
  end if;

  if v_storage_path !~* '^solicitudes/drafts/[0-9a-f-]{36}/[^/]+\.(jpg|jpeg|png|webp|pdf|xml)$'
     or split_part(v_storage_path, '/', 3) <> v_profile_id::text then
    raise exception 'request_document_path_invalid';
  end if;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'payment-receipts'
      and object.name = v_storage_path
      and object.owner = auth.uid()
  ) then
    raise exception 'request_document_not_found_or_not_owned';
  end if;

  v_result := public.create_payment_request(
    p_proveedor_id => p_proveedor_id,
    p_company_id => p_company_id,
    p_cost_center_id => p_cost_center_id,
    p_budget_category_id => p_budget_category_id,
    p_budget_month => p_budget_month,
    p_amount_requested => p_amount_requested,
    p_currency => p_currency,
    p_exchange_rate => p_exchange_rate,
    p_description => p_description,
    p_notes => p_notes,
    p_requested_by => p_requested_by,
    p_is_extraordinary_adjustment => p_is_extraordinary_adjustment,
    p_approver_id => p_approver_id,
    p_approver_assignment_id => p_approver_assignment_id,
    p_subtotal_amount => p_subtotal_amount,
    p_tax_amount => p_tax_amount,
    p_withholding_amount => p_withholding_amount,
    p_invoice_uuid => p_invoice_uuid,
    p_beneficiary_profile_id => p_beneficiary_profile_id,
    p_request_type => p_request_type,
    p_partida_unsure => p_partida_unsure
  );

  v_request_id := coalesce(
    nullif(v_result ->> 'payment_request_id', '')::uuid,
    nullif(v_result ->> 'id', '')::uuid
  );

  if v_request_id is null then
    raise exception 'request_document_payment_request_id_missing';
  end if;

  update public.payment_requests
     set invoice_storage_path = v_storage_path,
         updated_at = now()
   where id = v_request_id
     and requested_by = v_profile_id;

  if not found then
    raise exception 'request_document_link_failed';
  end if;

  return coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('invoice_storage_path', v_storage_path);
end;
$function$;

alter function public.create_payment_request_with_document(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text,
  uuid, boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text, text, boolean
) owner to postgres;
revoke all on function public.create_payment_request_with_document(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text,
  uuid, boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text, text, boolean
) from public, anon;
grant execute on function public.create_payment_request_with_document(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text,
  uuid, boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text, text, boolean
) to authenticated, service_role;

do $postcheck$
declare
  v_create text;
  v_document text;
  v_reimbursement text;
begin
  if to_regprocedure('public.create_payment_request(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text,boolean)') is null then
    raise exception 'create_payment_request_partida_unsure_signature_missing';
  end if;
  if to_regprocedure('public.create_payment_request_with_document(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text,text,boolean)') is null then
    raise exception 'create_payment_request_with_document_partida_unsure_signature_missing';
  end if;
  select pg_get_functiondef(to_regprocedure('public.create_payment_request(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text,boolean)')) into v_create;
  select pg_get_functiondef(to_regprocedure('public.create_payment_request_with_document(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text,text,boolean)')) into v_document;
  select pg_get_functiondef(p.oid) into v_reimbursement
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_reimbursement_request_with_documents'
    limit 1;
  if v_create not like '%partida_unsure%'
     or v_create not like '%beneficiary_profile_id%'
     or v_create not like '%invoice_uuid_duplicate%'
     or v_create not like '%payment_request_has_active_approver_pool%' then
    raise exception 'create_payment_request_prod_logic_regressed';
  end if;
  if v_document not like '%request_document_not_found_or_not_owned%'
     or v_document not like '%p_partida_unsure => p_partida_unsure%' then
    raise exception 'request_document_wrapper_partida_unsure_invalid';
  end if;
  if v_reimbursement is null
     or v_reimbursement not like '%public.create_payment_request(%'
     or v_reimbursement not like '%reimbursement_document_not_found_or_not_owned%' then
    raise exception 'atomic_reimbursement_wrapper_regressed';
  end if;
end
$postcheck$;

notify pgrst, 'reload schema';
commit;
