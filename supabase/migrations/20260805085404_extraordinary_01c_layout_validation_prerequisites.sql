begin;

do $precheck$
begin
  if to_regclass('public.proveedores') is null
     or to_regclass('public.payment_requests') is null
     or to_regclass('public.companies') is null
     or to_regclass('public.company_bank_accounts') is null then
    raise exception '01c_layout_prerequisite: required tables are missing';
  end if;
  if to_regprocedure('public.provider_payment_execution_missing_fields(public.proveedores)') is not null
     or to_regprocedure('public.payment_request_layout_missing_fields(public.payment_requests)') is not null then
    raise exception '01c_layout_prerequisite: partial helper state detected';
  end if;
end
$precheck$;

create function public.provider_payment_execution_missing_fields(
  p_provider public.proveedores
)
returns text[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_destination_type text := lower(nullif(btrim(p_provider.destination_type), ''));
  v_clabe_normalized text := regexp_replace(
    coalesce(p_provider.clabe, ''),
    '[[:space:]-]',
    '',
    'g'
  );
  v_account_normalized text := regexp_replace(
    coalesce(p_provider.cuenta_bancaria, ''),
    '[[:space:]-]',
    '',
    'g'
  );
  v_beneficiary text := coalesce(
    nullif(btrim(p_provider.beneficiary_name), ''),
    nullif(btrim(p_provider.nombre_completo), ''),
    nullif(btrim(p_provider.alias), '')
  );
begin
  return array_remove(array[
    case when v_beneficiary is null then 'beneficiary_name' end,
    case
      when v_beneficiary is not null
        and (
          char_length(v_beneficiary) > 180
          or v_beneficiary ~ '[[:cntrl:]]'
        )
        then 'beneficiary_name_invalid'
    end,
    case when nullif(btrim(p_provider.banco), '') is null then 'banco' end,
    case
      when nullif(btrim(p_provider.banco), '') is not null
        and (
          char_length(btrim(p_provider.banco)) > 100
          or p_provider.banco ~ '[[:cntrl:]]'
        )
        then 'banco_invalid'
    end,
    case when v_destination_type is null then 'destination_type' end,
    case
      when v_destination_type is not null
        and v_destination_type not in ('clabe', 'cuenta', 'convenio')
        then 'destination_type_invalid'
    end,
    case
      when v_destination_type = 'clabe'
        and nullif(btrim(p_provider.clabe), '') is null
        then 'clabe'
    end,
    case
      when v_destination_type = 'clabe'
        and nullif(btrim(p_provider.clabe), '') is not null
        and v_clabe_normalized !~ '^[0-9]{18}$'
        then 'clabe_invalid'
    end,
    case
      when v_destination_type = 'cuenta'
        and nullif(btrim(p_provider.cuenta_bancaria), '') is null
        then 'cuenta_bancaria'
    end,
    case
      when v_destination_type = 'cuenta'
        and nullif(btrim(p_provider.cuenta_bancaria), '') is not null
        and v_account_normalized !~ '^[0-9]{1,18}$'
        then 'cuenta_bancaria_invalid'
    end,
    case
      when v_destination_type = 'convenio'
        and nullif(btrim(p_provider.convenio_number), '') is null
        then 'convenio_number'
    end,
    case
      when v_destination_type = 'convenio'
        and nullif(btrim(p_provider.convenio_number), '') is not null
        and (
          char_length(btrim(p_provider.convenio_number)) > 30
          or p_provider.convenio_number ~ '[[:cntrl:]]'
        )
        then 'convenio_number_invalid'
    end
  ]::text[], null);
end
$$;

create function public.payment_request_layout_missing_fields(
  p_request public.payment_requests
)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company public.companies%rowtype;
  v_company_found boolean := false;
  v_company_account public.company_bank_accounts%rowtype;
  v_company_account_found boolean := false;
  v_provider public.proveedores%rowtype;
  v_provider_found boolean := false;
  v_source_normalized text;
  v_payment_concept text := coalesce(
    nullif(btrim(p_request.payment_concept), ''),
    nullif(btrim(p_request.concept), ''),
    nullif(btrim(p_request.description), '')
  );
  v_missing text[];
begin
  if p_request.company_id is not null then
    select * into v_company
    from public.companies company
    where company.id = p_request.company_id;
    v_company_found := found;
  end if;

  if p_request.company_bank_account_id is not null then
    select * into v_company_account
    from public.company_bank_accounts company_account
    where company_account.id = p_request.company_bank_account_id;
    v_company_account_found := found;
  end if;

  if p_request.proveedor_id is not null then
    select * into v_provider
    from public.proveedores provider
    where provider.id = p_request.proveedor_id;
    v_provider_found := found;
  end if;

  v_source_normalized := regexp_replace(
    coalesce(v_company_account.account_number, ''),
    '[[:space:]-]',
    '',
    'g'
  );

  v_missing := array_remove(array[
    case when p_request.scheduled_payment_date is null then 'scheduled_payment_date' end,
    case when p_request.company_id is null then 'company_id' end,
    case when p_request.company_id is not null and not v_company_found then 'company_not_found' end,
    case when v_company_found and not coalesce(v_company.active, false) then 'company_inactive' end,
    case
      when v_company_found
        and coalesce(
          nullif(btrim(v_company.legal_name), ''),
          nullif(btrim(v_company.name), '')
        ) is null
        then 'company_name'
    end,
    case when p_request.company_bank_account_id is null then 'company_bank_account_id' end,
    case
      when p_request.company_bank_account_id is not null
        and not v_company_account_found
        then 'company_bank_account_id_not_found'
    end,
    case
      when v_company_account_found
        and v_company_account.company_id is distinct from p_request.company_id
        then 'company_bank_account_company_mismatch'
    end,
    case
      when v_company_account_found
        and not coalesce(v_company_account.active, false)
        then 'company_bank_account_inactive'
    end,
    case
      when v_company_account_found
        and nullif(btrim(v_company_account.account_number), '') is null
        then 'source_account_number'
    end,
    case
      when v_company_account_found
        and nullif(btrim(v_company_account.account_number), '') is not null
        and v_source_normalized !~ '^[0-9]{1,18}$'
        then 'source_account_number_invalid'
    end,
    case when p_request.proveedor_id is null then 'proveedor_id' end,
    case
      when p_request.proveedor_id is not null and not v_provider_found
        then 'proveedor_not_found'
    end,
    case
      when v_provider_found and not coalesce(v_provider.activo, false)
        then 'proveedor_inactive'
    end,
    case
      when nullif(btrim(p_request.payment_reference), '') is null
        then 'payment_reference'
    end,
    case
      when nullif(btrim(p_request.payment_reference), '') is not null
        and btrim(p_request.payment_reference) !~ '^[0-9]{1,5}$'
        then 'payment_reference_invalid'
    end,
    case when v_payment_concept is null then 'payment_concept' end,
    case
      when v_payment_concept is not null
        and (
          char_length(v_payment_concept) > 120
          or v_payment_concept ~ '[[:cntrl:]]'
        )
        then 'payment_concept_invalid'
    end,
    case
      when coalesce(nullif(upper(btrim(p_request.currency)), ''), 'MXN') <> 'MXN'
        then 'unsupported_layout_currency'
    end,
    case when coalesce(p_request.amount_requested, 0) <= 0 then 'invalid_amount' end
  ]::text[], null);

  if v_provider_found then
    v_missing := v_missing || public.provider_payment_execution_missing_fields(v_provider);
  end if;

  select coalesce(
    array_agg(distinct missing_field.field_name order by missing_field.field_name),
    array[]::text[]
  )
  into v_missing
  from unnest(v_missing) as missing_field(field_name);

  return v_missing;
end
$$;

revoke all on function public.provider_payment_execution_missing_fields(public.proveedores)
  from public, anon, authenticated;
revoke all on function public.payment_request_layout_missing_fields(public.payment_requests)
  from public, anon, authenticated;

do $postcheck$
begin
  if to_regprocedure('public.provider_payment_execution_missing_fields(public.proveedores)') is null
     or to_regprocedure('public.payment_request_layout_missing_fields(public.payment_requests)') is null then
    raise exception '01c_layout_prerequisite: helper creation failed';
  end if;
  if has_function_privilege('authenticated','public.provider_payment_execution_missing_fields(public.proveedores)','EXECUTE')
     or has_function_privilege('authenticated','public.payment_request_layout_missing_fields(public.payment_requests)','EXECUTE')
     or has_function_privilege('anon','public.provider_payment_execution_missing_fields(public.proveedores)','EXECUTE')
     or has_function_privilege('anon','public.payment_request_layout_missing_fields(public.payment_requests)','EXECUTE') then
    raise exception '01c_layout_prerequisite: unexpected helper grants';
  end if;
end
$postcheck$;

commit;
