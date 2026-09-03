-- PROD: flujo de reembolsos por beneficiario empleado, aislado por empresa.
-- Migración consolidada desde el estado certificado en DEV. No incluye Proyectos.
begin;

-- Reembolsos: el dinero va al EMPLEADO, no a un proveedor del catálogo.
-- Hoy el tipo 'reimbursement' existe en el dropdown pero no cambia nada: el
-- formulario exige proveedor, así que la única salida era dar de alta a la
-- persona como proveedor (contamina el catálogo, choca con la gobernanza de
-- altas y el dedup por RFC) o poner al comercio (y el layout le dispersaría
-- al comercio). Aquí se separa el beneficiario del proveedor.

-- 1) Datos bancarios del empleado -------------------------------------------
-- NO van en `profiles`: esa tabla es legible por cualquier autenticado
-- (policy profiles_select = true). Tabla propia con RLS estricta: cada quien
-- ve/edita SOLO los suyos; Finanzas los lee para dispersar.
create table if not exists public.employee_bank_accounts (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  banco text,
  clabe text,
  cuenta text,
  beneficiary_name text,
  updated_at timestamptz not null default now()
);

alter table public.employee_bank_accounts enable row level security;

create policy employee_bank_accounts_select on public.employee_bank_accounts
  for select using (
    profile_id = public.current_profile_id()
    or public.current_user_has_role(array['finance','finanzas','treasury','tesoreria','administracion','sysadmin','system_admin','superadmin'])
  );

create policy employee_bank_accounts_write_self on public.employee_bank_accounts
  for all using (
    profile_id = public.current_profile_id()
    or public.current_user_has_role(public.flux_sysadmin_roles())
  )
  with check (
    profile_id = public.current_profile_id()
    or public.current_user_has_role(public.flux_sysadmin_roles())
  );

-- 2) Beneficiario de la solicitud -------------------------------------------
-- En un reembolso proveedor_id deja de ser el destinatario del dinero: quien
-- cobra es este perfil. El resto de tipos lo deja null y no cambia nada.
alter table public.payment_requests
  add column if not exists beneficiary_profile_id uuid references public.profiles (id);

comment on column public.payment_requests.beneficiary_profile_id is
  'Reembolsos: empleado que recibe el dinero. El proveedor de la solicitud (si lo hay) es el comercio, no el destinatario del pago.';

-- 3) Desglose del reembolso --------------------------------------------------
-- Un reembolso junta N comprobantes de emisores distintos y de partidas
-- distintas, más gastos sin comprobante (propinas) que NO son deducibles.
-- Cada renglón lleva su partida y su CFDI parseado; la suma se concilia
-- contra amount_requested en la comprobación.
create table if not exists public.reimbursement_items (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests (id) on delete cascade,
  budget_category_id uuid references public.budget_categories (id),
  descripcion text not null,
  amount numeric not null check (amount > 0),
  subtotal_amount numeric,
  tax_amount numeric,
  deducible boolean not null default true,   -- propinas y similares: false
  invoice_uuid text,                          -- folio fiscal del comprobante del renglón
  cfdi_data jsonb,                            -- CFDI del EMISOR REAL (no del empleado)
  storage_path text,
  created_at timestamptz not null default now()
);

create index if not exists reimbursement_items_request_idx
  on public.reimbursement_items (payment_request_id);

-- Un mismo folio fiscal no puede reembolsarse dos veces en la empresa.
create unique index if not exists reimbursement_items_uuid_unique
  on public.reimbursement_items (upper(invoice_uuid))
  where invoice_uuid is not null;

alter table public.reimbursement_items enable row level security;

-- Se ve/edita con la misma llave que la solicitud madre: si puedes ver la
-- solicitud (RLS de payment_requests), puedes ver su desglose.
create policy reimbursement_items_all on public.reimbursement_items
  for all using (
    exists (select 1 from public.payment_requests pr where pr.id = payment_request_id)
  )
  with check (
    exists (select 1 from public.payment_requests pr where pr.id = payment_request_id)
  );

-- Regla contable: incluso un gasto no deducible debe atribuirse a una
-- partida/departamento. La tabla estaba vacía al aplicar esta versión en DEV.
alter table public.reimbursement_items
  alter column budget_category_id set not null;

comment on column public.reimbursement_items.budget_category_id is
  'Obligatoria SIEMPRE, incluso en renglones no deducibles: es la que atribuye el gasto a su departamento/centro de costo (regla de contabilidad).';

-- Reembolsos, lado servidor. Sin esto el flujo no existe: create_payment_request
-- aborta con 'proveedor_id es obligatorio' y el validador de layout exige
-- proveedor + sus datos bancarios. Aquí el beneficiario empleado se vuelve un
-- destinatario de primera clase.

-- 1) create_payment_request: acepta beneficiario y tipo -----------------------
-- El proveedor deja de ser obligatorio SOLO en reembolsos (donde el
-- destinatario es una persona). El beneficiario se persiste en la MISMA
-- transacción que la solicitud: antes el cliente lo escribía con un UPDATE
-- posterior, así que una solicitud podía quedar sin destinatario si ese
-- segundo viaje fallaba.
drop function if exists public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid, boolean, uuid, uuid, numeric, numeric, numeric, text
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
  p_request_type text default null
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
    is_extraordinary_adjustment, created_at, updated_at
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
    coalesce(p_is_extraordinary_adjustment, false), now(), now()
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
    'approver_source', case when p_approver_assignment_id is null then 'approval_rules' else 'assigned' end
  );
end;
$function$;

-- 2) Validador de layout: en reembolso se valida al EMPLEADO ------------------
-- Antes exigía proveedor y sus datos bancarios siempre, así que un reembolso
-- nunca podía completar su línea. Ahora la rama de reembolso valida contra
-- employee_bank_accounts (que es de donde saldrá la CLABE de la dispersión).
create or replace function public.payment_request_layout_missing_fields(p_request payment_requests)
 returns text[]
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company public.companies%rowtype;
  v_company_found boolean := false;
  v_company_account public.company_bank_accounts%rowtype;
  v_company_account_found boolean := false;
  v_provider public.proveedores%rowtype;
  v_provider_found boolean := false;
  v_is_reimbursement boolean := p_request.request_type = 'reimbursement'::public.payment_request_type;
  v_beneficiary public.employee_bank_accounts%rowtype;
  v_beneficiary_found boolean := false;
  v_clabe text;
  v_cuenta text;
  v_source_normalized text;
  v_payment_concept text := coalesce(
    nullif(btrim(p_request.payment_concept), ''),
    nullif(btrim(p_request.concept), ''),
    nullif(btrim(p_request.description), '')
  );
  v_missing text[];
begin
  if p_request.company_id is not null then
    select * into v_company from public.companies company where company.id = p_request.company_id;
    v_company_found := found;
  end if;

  if p_request.company_bank_account_id is not null then
    select * into v_company_account from public.company_bank_accounts company_account
    where company_account.id = p_request.company_bank_account_id;
    v_company_account_found := found;
  end if;

  if p_request.proveedor_id is not null then
    select * into v_provider from public.proveedores provider where provider.id = p_request.proveedor_id;
    v_provider_found := found;
  end if;

  if v_is_reimbursement and p_request.beneficiary_profile_id is not null then
    select * into v_beneficiary from public.employee_bank_accounts eba
    where eba.profile_id = p_request.beneficiary_profile_id;
    v_beneficiary_found := found;
  end if;

  v_clabe := regexp_replace(coalesce(v_beneficiary.clabe, ''), '[[:space:]-]', '', 'g');
  v_cuenta := regexp_replace(coalesce(v_beneficiary.cuenta, ''), '[[:space:]-]', '', 'g');

  v_source_normalized := regexp_replace(
    coalesce(v_company_account.account_number, ''), '[[:space:]-]', '', 'g'
  );

  v_missing := array_remove(array[
    case when p_request.scheduled_payment_date is null then 'scheduled_payment_date' end,
    case when p_request.company_id is null then 'company_id' end,
    case when p_request.company_id is not null and not v_company_found then 'company_not_found' end,
    case when v_company_found and not coalesce(v_company.active, false) then 'company_inactive' end,
    case
      when v_company_found
        and coalesce(nullif(btrim(v_company.legal_name), ''), nullif(btrim(v_company.name), '')) is null
        then 'company_name'
    end,
    case when p_request.company_bank_account_id is null then 'company_bank_account_id' end,
    case
      when p_request.company_bank_account_id is not null and not v_company_account_found
        then 'company_bank_account_id_not_found'
    end,
    case
      when v_company_account_found and v_company_account.company_id is distinct from p_request.company_id
        then 'company_bank_account_company_mismatch'
    end,
    case
      when v_company_account_found and not coalesce(v_company_account.active, false)
        then 'company_bank_account_inactive'
    end,
    case
      when v_company_account_found and nullif(btrim(v_company_account.account_number), '') is null
        then 'source_account_number'
    end,
    case
      when v_company_account_found
        and nullif(btrim(v_company_account.account_number), '') is not null
        and v_source_normalized !~ '^[0-9]{1,18}$'
        then 'source_account_number_invalid'
    end,
    -- Destinatario: proveedor en el flujo normal, empleado en reembolso.
    case when not v_is_reimbursement and p_request.proveedor_id is null then 'proveedor_id' end,
    case
      when p_request.proveedor_id is not null and not v_provider_found then 'proveedor_not_found'
    end,
    case
      when not v_is_reimbursement and v_provider_found and not coalesce(v_provider.activo, false)
        then 'proveedor_inactive'
    end,
    case when v_is_reimbursement and p_request.beneficiary_profile_id is null then 'beneficiary_profile_id' end,
    case
      when v_is_reimbursement and p_request.beneficiary_profile_id is not null and not v_beneficiary_found
        then 'beneficiary_bank_account_missing'
    end,
    case
      when v_is_reimbursement and v_beneficiary_found
        and nullif(btrim(v_beneficiary.beneficiary_name), '') is null
        then 'beneficiary_name'
    end,
    case
      when v_is_reimbursement and v_beneficiary_found and nullif(btrim(v_beneficiary.banco), '') is null
        then 'beneficiary_bank'
    end,
    case
      when v_is_reimbursement and v_beneficiary_found
        and v_clabe = '' and v_cuenta = ''
        then 'beneficiary_destination'
    end,
    case
      when v_is_reimbursement and v_clabe <> '' and v_clabe !~ '^[0-9]{18}$'
        then 'beneficiary_clabe_invalid'
    end,
    case
      when nullif(btrim(p_request.payment_reference), '') is null then 'payment_reference'
    end,
    case
      when nullif(btrim(p_request.payment_reference), '') is not null
        and btrim(p_request.payment_reference) !~ '^[0-9]{1,5}$'
        then 'payment_reference_invalid'
    end,
    case when v_payment_concept is null then 'payment_concept' end,
    case
      when v_payment_concept is not null
        and (char_length(v_payment_concept) > 120 or v_payment_concept ~ '[[:cntrl:]]')
        then 'payment_concept_invalid'
    end,
    case
      when coalesce(nullif(upper(btrim(p_request.currency)), ''), 'MXN') <> 'MXN'
        then 'unsupported_layout_currency'
    end,
    case when coalesce(p_request.amount_requested, 0) <= 0 then 'invalid_amount' end
  ]::text[], null);

  -- Los requisitos bancarios del proveedor solo aplican cuando ÉL cobra.
  if v_provider_found and not v_is_reimbursement then
    v_missing := v_missing || public.provider_payment_execution_missing_fields(v_provider);
  end if;

  select coalesce(
    array_agg(distinct missing_field.field_name order by missing_field.field_name),
    array[]::text[]
  ) into v_missing
  from unnest(v_missing) as missing_field(field_name);

  return v_missing;
end
$function$;

-- El wrapper conserva intacta la función base pre_037 y sustituye el destino
-- por la cuenta bancaria del empleado cuando la solicitud es un reembolso.
create or replace function public.approval_batch_payment_layout_candidates(
  p_period_start date,
  p_period_end date,
  p_company_id uuid default null::uuid,
  p_company_bank_account_id uuid default null::uuid
)
 returns table(classification text, classification_reason text, payment_request_id uuid, request_number text, request_status text, company_id uuid, company_name text, proveedor_id uuid, provider_name text, company_bank_account_id uuid, source_account_number text, destination_type text, destination_value text, beneficiary_name text, amount numeric, currency text, payment_reference text, payment_concept text, scheduled_payment_date date, missing_fields text[], finance_approval_current boolean, direction_approval_current boolean, direction_decided_at timestamp with time zone, enforcement_required boolean, source_item_id uuid, source_batch_id uuid, source_batch_label text, source_batch_status text, director_status text, reject_reason text, rejected_by uuid, rejected_by_name text, rejected_at timestamp with time zone, rebatch_status text, latest_correction_note text, extraordinary_authorization_id uuid, extraordinary_category text, extraordinary_reason text, extraordinary_authorized_by uuid, extraordinary_authorized_by_name text, extraordinary_authorized_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select
    case
      when candidate.classification = 'ready_extraordinary'
        and not public.extraordinary_authorization_is_ready(
          candidate.extraordinary_authorization_id
        )
      then 'invalid_data'
      else candidate.classification
    end,
    case
      when candidate.classification = 'ready_extraordinary'
        and not public.extraordinary_authorization_is_ready(
          candidate.extraordinary_authorization_id
        )
      then 'extraordinary_not_ready_secure_contract'
      else candidate.classification_reason
    end,
    candidate.payment_request_id,
    candidate.request_number,
    candidate.request_status,
    candidate.company_id,
    candidate.company_name,
    candidate.proveedor_id,
    case
      when reimb.beneficiary_profile_id is not null
        then coalesce(nullif(btrim(beneficiary_bank.beneficiary_name), ''), beneficiary_profile.full_name, candidate.provider_name)
      else candidate.provider_name
    end,
    candidate.company_bank_account_id,
    candidate.source_account_number,
    case
      when reimb.beneficiary_profile_id is not null then
        case
          when regexp_replace(coalesce(beneficiary_bank.clabe, ''), '[[:space:]-]', '', 'g') <> '' then 'clabe'
          when regexp_replace(coalesce(beneficiary_bank.cuenta, ''), '[[:space:]-]', '', 'g') <> '' then 'cuenta'
          else candidate.destination_type
        end
      else candidate.destination_type
    end,
    case
      when reimb.beneficiary_profile_id is not null then
        coalesce(
          nullif(regexp_replace(coalesce(beneficiary_bank.clabe, ''), '[[:space:]-]', '', 'g'), ''),
          nullif(regexp_replace(coalesce(beneficiary_bank.cuenta, ''), '[[:space:]-]', '', 'g'), ''),
          candidate.destination_value
        )
      else candidate.destination_value
    end,
    case
      when reimb.beneficiary_profile_id is not null
        then coalesce(nullif(btrim(beneficiary_bank.beneficiary_name), ''), beneficiary_profile.full_name, candidate.beneficiary_name)
      else candidate.beneficiary_name
    end,
    candidate.amount,
    candidate.currency,
    candidate.payment_reference,
    candidate.payment_concept,
    candidate.scheduled_payment_date,
    candidate.missing_fields,
    candidate.finance_approval_current,
    candidate.direction_approval_current,
    candidate.direction_decided_at,
    candidate.enforcement_required,
    candidate.source_item_id,
    candidate.source_batch_id,
    candidate.source_batch_label,
    candidate.source_batch_status,
    candidate.director_status,
    candidate.reject_reason,
    candidate.rejected_by,
    candidate.rejected_by_name,
    candidate.rejected_at,
    candidate.rebatch_status,
    candidate.latest_correction_note,
    candidate.extraordinary_authorization_id,
    candidate.extraordinary_category,
    candidate.extraordinary_reason,
    candidate.extraordinary_authorized_by,
    candidate.extraordinary_authorized_by_name,
    candidate.extraordinary_authorized_at
  from public.approval_batch_payment_layout_candidates_pre_037(
    p_period_start,
    p_period_end,
    p_company_id,
    p_company_bank_account_id
  ) candidate
  left join public.payment_requests reimb
    on reimb.id = candidate.payment_request_id
   and reimb.request_type::text = 'reimbursement'
  left join public.employee_bank_accounts beneficiary_bank
    on beneficiary_bank.profile_id = reimb.beneficiary_profile_id
  left join public.profiles beneficiary_profile
    on beneficiary_profile.id = reimb.beneficiary_profile_id
  where not exists (
    select 1
    from public.payment_requests request
    where request.id = candidate.payment_request_id
      and request.request_type::text = 'nomina'
  );
$function$;

-- Estado final endurecido por empresa.
alter table public.employee_bank_accounts
  add column if not exists company_id uuid;

with sole_membership as (
  select profile_id, (array_agg(company_id order by company_id))[1] as company_id
  from public.profile_company_memberships
  where active
  group by profile_id
  having count(*) = 1
)
update public.employee_bank_accounts account
set company_id = membership.company_id
from sole_membership membership
where account.profile_id = membership.profile_id
  and account.company_id is null;

do $$
begin
  if exists (
    select 1 from public.employee_bank_accounts where company_id is null
  ) then
    raise exception 'employee_bank_accounts_company_backfill_ambiguous';
  end if;
end
$$;

alter table public.employee_bank_accounts
  alter column company_id set not null;

alter table public.employee_bank_accounts
  drop constraint if exists employee_bank_accounts_pkey;
alter table public.employee_bank_accounts
  add constraint employee_bank_accounts_pkey
  primary key (profile_id, company_id);

alter table public.employee_bank_accounts
  drop constraint if exists employee_bank_accounts_company_id_fkey;
alter table public.employee_bank_accounts
  add constraint employee_bank_accounts_company_id_fkey
  foreign key (company_id) references public.companies (id) on delete cascade;

alter table public.employee_bank_accounts
  drop constraint if exists employee_bank_accounts_membership_fkey;
alter table public.employee_bank_accounts
  add constraint employee_bank_accounts_membership_fkey
  foreign key (profile_id, company_id)
  references public.profile_company_memberships (profile_id, company_id)
  on delete cascade;

create index if not exists employee_bank_accounts_company_idx
  on public.employee_bank_accounts (company_id, profile_id);

alter table public.employee_bank_accounts enable row level security;
alter table public.employee_bank_accounts force row level security;
drop policy if exists employee_bank_accounts_select on public.employee_bank_accounts;
drop policy if exists employee_bank_accounts_write_self on public.employee_bank_accounts;
drop policy if exists employee_bank_accounts_insert on public.employee_bank_accounts;
drop policy if exists employee_bank_accounts_update on public.employee_bank_accounts;
drop policy if exists employee_bank_accounts_delete on public.employee_bank_accounts;

create policy employee_bank_accounts_select
  on public.employee_bank_accounts
  for select to authenticated
  using (
    (
      profile_id = public.current_profile_id()
      and public.has_active_company_membership(
        public.current_profile_id(), company_id
      )
    )
    or private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  );

create policy employee_bank_accounts_insert
  on public.employee_bank_accounts
  for insert to authenticated
  with check (
    (
      profile_id = public.current_profile_id()
      and public.has_active_company_membership(
        public.current_profile_id(), company_id
      )
    )
    or private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  );

create policy employee_bank_accounts_update
  on public.employee_bank_accounts
  for update to authenticated
  using (
    (
      profile_id = public.current_profile_id()
      and public.has_active_company_membership(
        public.current_profile_id(), company_id
      )
    )
    or private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  )
  with check (
    (
      profile_id = public.current_profile_id()
      and public.has_active_company_membership(
        public.current_profile_id(), company_id
      )
    )
    or private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  );

create policy employee_bank_accounts_delete
  on public.employee_bank_accounts
  for delete to authenticated
  using (
    (
      profile_id = public.current_profile_id()
      and public.has_active_company_membership(
        public.current_profile_id(), company_id
      )
    )
    or private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  );

revoke all on table public.employee_bank_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.employee_bank_accounts to authenticated;
grant select, insert, update, delete on table public.employee_bank_accounts to service_role;

alter table public.reimbursement_items
  add column if not exists company_id uuid;

update public.reimbursement_items item
set company_id = request.company_id
from public.payment_requests request
where request.id = item.payment_request_id
  and item.company_id is null;

do $$
begin
  if exists (
    select 1 from public.reimbursement_items where company_id is null
  ) then
    raise exception 'reimbursement_items_company_backfill_failed';
  end if;
end
$$;

alter table public.reimbursement_items
  alter column company_id set not null;

create unique index if not exists payment_requests_company_id_id_uq
  on public.payment_requests (company_id, id);

alter table public.reimbursement_items
  drop constraint if exists reimbursement_items_payment_request_id_fkey;
alter table public.reimbursement_items
  drop constraint if exists reimbursement_items_request_company_fkey;
alter table public.reimbursement_items
  add constraint reimbursement_items_request_company_fkey
  foreign key (company_id, payment_request_id)
  references public.payment_requests (company_id, id)
  on delete cascade;

drop index if exists public.reimbursement_items_uuid_unique;
create unique index reimbursement_items_company_uuid_unique
  on public.reimbursement_items (company_id, upper(invoice_uuid))
  where invoice_uuid is not null;

create index if not exists reimbursement_items_company_request_idx
  on public.reimbursement_items (company_id, payment_request_id);

alter table public.reimbursement_items enable row level security;
alter table public.reimbursement_items force row level security;
drop policy if exists reimbursement_items_all on public.reimbursement_items;
drop policy if exists reimbursement_items_select on public.reimbursement_items;
drop policy if exists reimbursement_items_insert on public.reimbursement_items;
drop policy if exists reimbursement_items_update on public.reimbursement_items;
drop policy if exists reimbursement_items_delete on public.reimbursement_items;

create policy reimbursement_items_select
  on public.reimbursement_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.payment_requests request
      where request.id = reimbursement_items.payment_request_id
        and request.company_id = reimbursement_items.company_id
    )
  );

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
          request.requested_by = public.current_profile_id()
          or private.current_profile_has_company_role(
            reimbursement_items.company_id, array['finance','sysadmin']::text[]
          )
        )
    )
  );

create policy reimbursement_items_update
  on public.reimbursement_items
  for update to authenticated
  using (
    exists (
      select 1
      from public.payment_requests request
      where request.id = reimbursement_items.payment_request_id
        and request.company_id = reimbursement_items.company_id
        and (
          request.requested_by = public.current_profile_id()
          or private.current_profile_has_company_role(
            reimbursement_items.company_id, array['finance','sysadmin']::text[]
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.payment_requests request
      where request.id = reimbursement_items.payment_request_id
        and request.company_id = reimbursement_items.company_id
        and (
          request.requested_by = public.current_profile_id()
          or private.current_profile_has_company_role(
            reimbursement_items.company_id, array['finance','sysadmin']::text[]
          )
        )
    )
  );

create policy reimbursement_items_delete
  on public.reimbursement_items
  for delete to authenticated
  using (
    exists (
      select 1
      from public.payment_requests request
      where request.id = reimbursement_items.payment_request_id
        and request.company_id = reimbursement_items.company_id
        and (
          request.requested_by = public.current_profile_id()
          or private.current_profile_has_company_role(
            reimbursement_items.company_id, array['finance','sysadmin']::text[]
          )
        )
    )
  );

revoke all on table public.reimbursement_items from public, anon, authenticated;
grant select, insert, update, delete on table public.reimbursement_items to authenticated;
grant select, insert, update, delete on table public.reimbursement_items to service_role;


create or replace function private.enforce_payment_request_tenant_references()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.beneficiary_profile_id is not null
     and (
       new.company_id is null
       or not exists (
         select 1
         from public.profile_company_memberships membership
         where membership.profile_id = new.beneficiary_profile_id
           and membership.company_id = new.company_id
           and membership.active
       )
     ) then
    raise exception 'beneficiary_company_membership_required';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_payment_request_tenant_references()
  from public, anon, authenticated;

drop trigger if exists payment_requests_tenant_references_guard
  on public.payment_requests;
create trigger payment_requests_tenant_references_guard
before insert or update of company_id, beneficiary_profile_id
on public.payment_requests
for each row execute function private.enforce_payment_request_tenant_references();

create or replace function public.list_reimbursement_beneficiaries(
  p_company_id uuid
)
returns table (
  id uuid,
  full_name text,
  email text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := public.current_profile_id();
  v_can_choose boolean;
begin
  if auth.uid() is null or v_actor is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_active_company_membership(v_actor, p_company_id)
     and not private.current_profile_has_company_role(
       p_company_id, array['sysadmin']::text[]
     ) then
    raise exception 'company_membership_required';
  end if;

  v_can_choose := private.current_profile_has_company_role(
    p_company_id, array['finance','sysadmin']::text[]
  );

  return query
  select profile.id, profile.full_name, profile.email
  from public.profile_company_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.company_id = p_company_id
    and membership.active
    and coalesce(profile.active, true)
    and (v_can_choose or profile.id = v_actor)
  order by profile.full_name nulls last, profile.email nulls last;
end;
$function$;

revoke all on function public.list_reimbursement_beneficiaries(uuid)
  from public, anon;
grant execute on function public.list_reimbursement_beneficiaries(uuid)
  to authenticated, service_role;

-- 2) Validador de layout: en reembolso se valida al EMPLEADO ------------------
-- Antes exigía proveedor y sus datos bancarios siempre, así que un reembolso
-- nunca podía completar su línea. Ahora la rama de reembolso valida contra
-- employee_bank_accounts (que es de donde saldrá la CLABE de la dispersión).
create or replace function public.payment_request_layout_missing_fields(p_request payment_requests)
 returns text[]
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company public.companies%rowtype;
  v_company_found boolean := false;
  v_company_account public.company_bank_accounts%rowtype;
  v_company_account_found boolean := false;
  v_provider public.proveedores%rowtype;
  v_provider_found boolean := false;
  v_is_reimbursement boolean := p_request.request_type = 'reimbursement'::public.payment_request_type;
  v_beneficiary public.employee_bank_accounts%rowtype;
  v_beneficiary_found boolean := false;
  v_clabe text;
  v_cuenta text;
  v_source_normalized text;
  v_payment_concept text := coalesce(
    nullif(btrim(p_request.payment_concept), ''),
    nullif(btrim(p_request.concept), ''),
    nullif(btrim(p_request.description), '')
  );
  v_missing text[];
begin
  if p_request.company_id is not null then
    select * into v_company from public.companies company where company.id = p_request.company_id;
    v_company_found := found;
  end if;

  if p_request.company_bank_account_id is not null then
    select * into v_company_account from public.company_bank_accounts company_account
    where company_account.id = p_request.company_bank_account_id;
    v_company_account_found := found;
  end if;

  if p_request.proveedor_id is not null then
    select * into v_provider from public.proveedores provider where provider.id = p_request.proveedor_id;
    v_provider_found := found;
  end if;

  if v_is_reimbursement and p_request.beneficiary_profile_id is not null then
    select * into v_beneficiary from public.employee_bank_accounts eba
    where eba.profile_id = p_request.beneficiary_profile_id
      and eba.company_id = p_request.company_id;
    v_beneficiary_found := found;
  end if;

  v_clabe := regexp_replace(coalesce(v_beneficiary.clabe, ''), '[[:space:]-]', '', 'g');
  v_cuenta := regexp_replace(coalesce(v_beneficiary.cuenta, ''), '[[:space:]-]', '', 'g');

  v_source_normalized := regexp_replace(
    coalesce(v_company_account.account_number, ''), '[[:space:]-]', '', 'g'
  );

  v_missing := array_remove(array[
    case when p_request.scheduled_payment_date is null then 'scheduled_payment_date' end,
    case when p_request.company_id is null then 'company_id' end,
    case when p_request.company_id is not null and not v_company_found then 'company_not_found' end,
    case when v_company_found and not coalesce(v_company.active, false) then 'company_inactive' end,
    case
      when v_company_found
        and coalesce(nullif(btrim(v_company.legal_name), ''), nullif(btrim(v_company.name), '')) is null
        then 'company_name'
    end,
    case when p_request.company_bank_account_id is null then 'company_bank_account_id' end,
    case
      when p_request.company_bank_account_id is not null and not v_company_account_found
        then 'company_bank_account_id_not_found'
    end,
    case
      when v_company_account_found and v_company_account.company_id is distinct from p_request.company_id
        then 'company_bank_account_company_mismatch'
    end,
    case
      when v_company_account_found and not coalesce(v_company_account.active, false)
        then 'company_bank_account_inactive'
    end,
    case
      when v_company_account_found and nullif(btrim(v_company_account.account_number), '') is null
        then 'source_account_number'
    end,
    case
      when v_company_account_found
        and nullif(btrim(v_company_account.account_number), '') is not null
        and v_source_normalized !~ '^[0-9]{1,18}$'
        then 'source_account_number_invalid'
    end,
    -- Destinatario: proveedor en el flujo normal, empleado en reembolso.
    case when not v_is_reimbursement and p_request.proveedor_id is null then 'proveedor_id' end,
    case
      when p_request.proveedor_id is not null and not v_provider_found then 'proveedor_not_found'
    end,
    case
      when not v_is_reimbursement and v_provider_found and not coalesce(v_provider.activo, false)
        then 'proveedor_inactive'
    end,
    case when v_is_reimbursement and p_request.beneficiary_profile_id is null then 'beneficiary_profile_id' end,
    case
      when v_is_reimbursement and p_request.beneficiary_profile_id is not null and not v_beneficiary_found
        then 'beneficiary_bank_account_missing'
    end,
    case
      when v_is_reimbursement and v_beneficiary_found
        and nullif(btrim(v_beneficiary.beneficiary_name), '') is null
        then 'beneficiary_name'
    end,
    case
      when v_is_reimbursement and v_beneficiary_found and nullif(btrim(v_beneficiary.banco), '') is null
        then 'beneficiary_bank'
    end,
    case
      when v_is_reimbursement and v_beneficiary_found
        and v_clabe = '' and v_cuenta = ''
        then 'beneficiary_destination'
    end,
    case
      when v_is_reimbursement and v_clabe <> '' and v_clabe !~ '^[0-9]{18}$'
        then 'beneficiary_clabe_invalid'
    end,
    case
      when nullif(btrim(p_request.payment_reference), '') is null then 'payment_reference'
    end,
    case
      when nullif(btrim(p_request.payment_reference), '') is not null
        and btrim(p_request.payment_reference) !~ '^[0-9]{1,5}$'
        then 'payment_reference_invalid'
    end,
    case when v_payment_concept is null then 'payment_concept' end,
    case
      when v_payment_concept is not null
        and (char_length(v_payment_concept) > 120 or v_payment_concept ~ '[[:cntrl:]]')
        then 'payment_concept_invalid'
    end,
    case
      when coalesce(nullif(upper(btrim(p_request.currency)), ''), 'MXN') <> 'MXN'
        then 'unsupported_layout_currency'
    end,
    case when coalesce(p_request.amount_requested, 0) <= 0 then 'invalid_amount' end
  ]::text[], null);

  -- Los requisitos bancarios del proveedor solo aplican cuando ÉL cobra.
  if v_provider_found and not v_is_reimbursement then
    v_missing := v_missing || public.provider_payment_execution_missing_fields(v_provider);
  end if;

  select coalesce(
    array_agg(distinct missing_field.field_name order by missing_field.field_name),
    array[]::text[]
  ) into v_missing
  from unnest(v_missing) as missing_field(field_name);

  return v_missing;
end
$function$;


-- El wrapper conserva intacta la función base pre_037 y sustituye el destino
-- por la cuenta bancaria del empleado cuando la solicitud es un reembolso.
create or replace function public.approval_batch_payment_layout_candidates(
  p_period_start date,
  p_period_end date,
  p_company_id uuid default null::uuid,
  p_company_bank_account_id uuid default null::uuid
)
 returns table(classification text, classification_reason text, payment_request_id uuid, request_number text, request_status text, company_id uuid, company_name text, proveedor_id uuid, provider_name text, company_bank_account_id uuid, source_account_number text, destination_type text, destination_value text, beneficiary_name text, amount numeric, currency text, payment_reference text, payment_concept text, scheduled_payment_date date, missing_fields text[], finance_approval_current boolean, direction_approval_current boolean, direction_decided_at timestamp with time zone, enforcement_required boolean, source_item_id uuid, source_batch_id uuid, source_batch_label text, source_batch_status text, director_status text, reject_reason text, rejected_by uuid, rejected_by_name text, rejected_at timestamp with time zone, rebatch_status text, latest_correction_note text, extraordinary_authorization_id uuid, extraordinary_category text, extraordinary_reason text, extraordinary_authorized_by uuid, extraordinary_authorized_by_name text, extraordinary_authorized_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select
    case
      when candidate.classification = 'ready_extraordinary'
        and not public.extraordinary_authorization_is_ready(
          candidate.extraordinary_authorization_id
        )
      then 'invalid_data'
      else candidate.classification
    end,
    case
      when candidate.classification = 'ready_extraordinary'
        and not public.extraordinary_authorization_is_ready(
          candidate.extraordinary_authorization_id
        )
      then 'extraordinary_not_ready_secure_contract'
      else candidate.classification_reason
    end,
    candidate.payment_request_id,
    candidate.request_number,
    candidate.request_status,
    candidate.company_id,
    candidate.company_name,
    candidate.proveedor_id,
    case
      when reimb.beneficiary_profile_id is not null
        then coalesce(nullif(btrim(beneficiary_bank.beneficiary_name), ''), beneficiary_profile.full_name, candidate.provider_name)
      else candidate.provider_name
    end,
    candidate.company_bank_account_id,
    candidate.source_account_number,
    case
      when reimb.beneficiary_profile_id is not null then
        case
          when regexp_replace(coalesce(beneficiary_bank.clabe, ''), '[[:space:]-]', '', 'g') <> '' then 'clabe'
          when regexp_replace(coalesce(beneficiary_bank.cuenta, ''), '[[:space:]-]', '', 'g') <> '' then 'cuenta'
          else candidate.destination_type
        end
      else candidate.destination_type
    end,
    case
      when reimb.beneficiary_profile_id is not null then
        coalesce(
          nullif(regexp_replace(coalesce(beneficiary_bank.clabe, ''), '[[:space:]-]', '', 'g'), ''),
          nullif(regexp_replace(coalesce(beneficiary_bank.cuenta, ''), '[[:space:]-]', '', 'g'), ''),
          candidate.destination_value
        )
      else candidate.destination_value
    end,
    case
      when reimb.beneficiary_profile_id is not null
        then coalesce(nullif(btrim(beneficiary_bank.beneficiary_name), ''), beneficiary_profile.full_name, candidate.beneficiary_name)
      else candidate.beneficiary_name
    end,
    candidate.amount,
    candidate.currency,
    candidate.payment_reference,
    candidate.payment_concept,
    candidate.scheduled_payment_date,
    candidate.missing_fields,
    candidate.finance_approval_current,
    candidate.direction_approval_current,
    candidate.direction_decided_at,
    candidate.enforcement_required,
    candidate.source_item_id,
    candidate.source_batch_id,
    candidate.source_batch_label,
    candidate.source_batch_status,
    candidate.director_status,
    candidate.reject_reason,
    candidate.rejected_by,
    candidate.rejected_by_name,
    candidate.rejected_at,
    candidate.rebatch_status,
    candidate.latest_correction_note,
    candidate.extraordinary_authorization_id,
    candidate.extraordinary_category,
    candidate.extraordinary_reason,
    candidate.extraordinary_authorized_by,
    candidate.extraordinary_authorized_by_name,
    candidate.extraordinary_authorized_at
  from public.approval_batch_payment_layout_candidates_pre_037(
    p_period_start,
    p_period_end,
    p_company_id,
    p_company_bank_account_id
  ) candidate
  left join public.payment_requests reimb
    on reimb.id = candidate.payment_request_id
   and reimb.request_type::text = 'reimbursement'
  left join public.employee_bank_accounts beneficiary_bank
    on beneficiary_bank.profile_id = reimb.beneficiary_profile_id
   and beneficiary_bank.company_id = candidate.company_id
  left join public.profiles beneficiary_profile
    on beneficiary_profile.id = reimb.beneficiary_profile_id
  where not exists (
    select 1
    from public.payment_requests request
    where request.id = candidate.payment_request_id
      and request.request_type::text = 'nomina'
  );
$function$;


revoke all on function public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid,
  boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text
) from public, anon;
grant execute on function public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid,
  boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text
) to authenticated, service_role;

revoke all on function public.payment_request_layout_missing_fields(public.payment_requests)
  from public, anon;
grant execute on function public.payment_request_layout_missing_fields(public.payment_requests)
  to authenticated, service_role;

revoke all on function public.approval_batch_payment_layout_candidates(date, date, uuid, uuid)
  from public, anon;
grant execute on function public.approval_batch_payment_layout_candidates(date, date, uuid, uuid)
  to authenticated, service_role;


-- Yanin comparte Enseres; Alfredo permanece como responsable principal.
do $$
declare
  v_company_id uuid;
  v_cost_center_id uuid;
  v_budget_category_id uuid;
begin
  select relation.company_id, relation.cost_center_id, relation.budget_category_id
    into strict v_company_id, v_cost_center_id, v_budget_category_id
  from public.company_cost_center_budget_categories relation
  join public.companies company on company.id = relation.company_id
  join public.cost_centers cost_center on cost_center.id = relation.cost_center_id
  join public.budget_categories category on category.id = relation.budget_category_id
  where relation.active
    and lower(btrim(company.name)) = 'soporte fersana'
    and lower(btrim(cost_center.name)) = 'soporte fersana'
    and lower(btrim(category.name)) = 'enseres';

  if not exists (
    select 1
    from public.profiles profile
    join public.profile_company_memberships membership
      on membership.profile_id = profile.id
     and membership.company_id = v_company_id
     and membership.active
    where profile.active is distinct from false
      and lower(btrim(profile.email)) = 'ynavarrete@soportef.com'
  ) then
    raise exception 'yanin_active_fersana_membership_required';
  end if;

  insert into public.company_cost_center_budget_category_responsibles (
    company_id, cost_center_id, budget_category_id, responsible_email
  )
  values (
    v_company_id, v_cost_center_id, v_budget_category_id, 'ynavarrete@soportef.com'
  )
  on conflict do nothing;
end
$$;

-- Los clientes usan RPCs guardadas; estos helpers quedan sólo del lado servidor.
revoke execute on function public.payment_request_layout_missing_fields(public.payment_requests)
  from public, anon, authenticated;
grant execute on function public.payment_request_layout_missing_fields(public.payment_requests)
  to service_role;

revoke execute on function public.approval_batch_payment_layout_candidates(date, date, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.approval_batch_payment_layout_candidates(date, date, uuid, uuid)
  to service_role;

comment on function public.payment_request_layout_missing_fields(public.payment_requests) is
  'Internal layout validation helper; callable only by trusted server-side functions and service_role.';
comment on function public.approval_batch_payment_layout_candidates(date, date, uuid, uuid) is
  'Internal layout candidate wrapper; public clients must use guarded preview/create RPCs.';

commit;
