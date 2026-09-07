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

