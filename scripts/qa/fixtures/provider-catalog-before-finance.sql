CREATE OR REPLACE FUNCTION public.guard_provider_payment_execution_data_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_missing text[];
begin
  if nullif(btrim(coalesce(new.destination_type, '')), '') is null
     and nullif(btrim(coalesce(new.clabe, '')), '') is null
     and nullif(btrim(coalesce(new.cuenta_bancaria, '')), '') is null
     and nullif(btrim(coalesce(new.convenio_number, '')), '') is null
     and nullif(btrim(coalesce(new.beneficiary_name, '')), '') is null
     and nullif(btrim(coalesce(new.banco, '')), '') is null then
    return new;
  end if;

  perform public.approval_batch_require_finance();

  if current_setting('flux.provider_payment_execution_rpc', true)
       is distinct from new.id::text then
    raise exception 'provider_payment_execution_rpc_required';
  end if;

  v_missing := public.provider_payment_execution_missing_fields(new);
  if v_missing && array[
    'beneficiary_name_invalid',
    'banco_invalid',
    'destination_type_invalid',
    'clabe_invalid',
    'cuenta_bancaria_invalid',
    'convenio_number_invalid'
  ]::text[] then
    raise exception 'provider_payment_execution_data_invalid';
  end if;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.mark_provider_payment_material_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid;
  v_changed_fields text[];
  v_completed_fields text[];
  v_missing_before text[];
  v_missing_after text[];
  v_now timestamptz := clock_timestamp();
begin
  v_changed_fields := array_remove(array[
    case when old.destination_type is distinct from new.destination_type then 'destination_type' end,
    case when old.clabe is distinct from new.clabe then 'clabe' end,
    case when old.cuenta_bancaria is distinct from new.cuenta_bancaria then 'cuenta_bancaria' end,
    case when old.convenio_number is distinct from new.convenio_number then 'convenio_number' end,
    case when old.beneficiary_name is distinct from new.beneficiary_name then 'beneficiary_name' end,
    case when old.banco is distinct from new.banco then 'banco' end
  ]::text[], null);

  if cardinality(v_changed_fields) = 0 then
    return new;
  end if;

  v_actor := public.approval_batch_require_finance();

  if current_setting('flux.provider_payment_execution_rpc', true)
       is distinct from new.id::text then
    raise exception 'provider_payment_execution_rpc_required';
  end if;

  v_missing_before := public.provider_payment_execution_missing_fields(old);
  v_missing_after := public.provider_payment_execution_missing_fields(new);

  if 'destination_type_invalid' = any(v_missing_after)
     or 'clabe_invalid' = any(v_missing_after)
     or 'cuenta_bancaria_invalid' = any(v_missing_after)
     or 'convenio_number_invalid' = any(v_missing_after)
     or 'beneficiary_name_invalid' = any(v_missing_after)
     or 'banco_invalid' = any(v_missing_after) then
    raise exception 'provider_payment_execution_data_invalid';
  end if;

  select coalesce(
    array_agg(completed_field.field_name order by completed_field.field_name),
    array[]::text[]
  )
    into v_completed_fields
  from unnest(v_missing_before) as completed_field(field_name)
  where not (completed_field.field_name = any(v_missing_after));

  insert into public.activity_log(
    entity_type,
    entity_id,
    action,
    old_values,
    new_values,
    performed_by,
    performed_at,
    notes
  ) values (
    'proveedor',
    new.id,
    'payment_execution_data_updated',
    jsonb_build_object(
      'layout_data_complete', cardinality(v_missing_before) = 0,
      'missing_fields', to_jsonb(v_missing_before)
    ),
    jsonb_build_object(
      'changed_fields', to_jsonb(v_changed_fields),
      'completed_fields', to_jsonb(v_completed_fields),
      'layout_data_complete', cardinality(v_missing_after) = 0,
      'missing_fields', to_jsonb(v_missing_after)
    ),
    v_actor,
    v_now,
    'Provider payment-execution audit; banking values intentionally omitted.'
  );

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.provider_payment_execution_missing_fields(p_provider proveedores)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.save_provider_catalog_with_payment_execution_data(p_proveedor_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid;
  v_before public.proveedores%rowtype;
  v_after public.proveedores%rowtype;
  v_provider_id uuid;
  v_is_create boolean := p_proveedor_id is null;
  v_execution_changed boolean := false;
  v_execution_supplied boolean := false;
  v_execution_fields text[];
  v_missing_after text[];
  v_unsupported_keys text[];
  v_now timestamptz := clock_timestamp();
begin
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'provider_payload_object_required';
  end if;

  select coalesce(
    array_agg(payload_key.key_name order by payload_key.key_name),
    array[]::text[]
  )
    into v_unsupported_keys
  from jsonb_object_keys(p_payload) as payload_key(key_name)
  where not (
    payload_key.key_name = any(array[
      'alias',
      'nombre_completo',
      'metodo_pago',
      'tipo_cuenta',
      'destination_type',
      'beneficiary_name',
      'banco',
      'clabe',
      'cuenta_bancaria',
      'convenio_number',
      'rfc',
      'persona_tipo',
      'email',
      'telefono',
      'tipo_proveedor',
      'notas',
      'es_personal_eventual',
      'activo',
      'updated_at'
    ]::text[])
  );

  if cardinality(v_unsupported_keys) > 0 then
    raise exception 'provider_payload_contains_unsupported_fields'
      using detail = array_to_string(v_unsupported_keys, ', ');
  end if;

  v_actor := public.approval_batch_require_actor();
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = v_actor
      and coalesce(profile.active, false)
  ) then
    raise exception 'profile_inactive';
  end if;

  if v_is_create then
    if not public.current_user_has_role(public.flux_member_roles()) then
      raise exception 'provider_create_role_required';
    end if;

    v_provider_id := gen_random_uuid();
    perform pg_advisory_xact_lock(
      hashtextextended(v_provider_id::text, 21036)
    );
    v_after := jsonb_populate_record(
      null::public.proveedores,
      p_payload - 'updated_at'
    );
    v_after.id := v_provider_id;
    v_after.activo := coalesce(v_after.activo, true);
    v_after.es_personal_eventual :=
      coalesce(v_after.es_personal_eventual, false);
  else
    if not public.current_user_has_role(public.flux_approver_roles()) then
      raise exception 'provider_update_role_required';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(p_proveedor_id::text, 21036)
    );

    select *
      into v_before
    from public.proveedores provider
    where provider.id = p_proveedor_id
    for update;

    if not found then
      raise exception 'proveedor_not_found';
    end if;

    v_provider_id := v_before.id;
    v_after := jsonb_populate_record(
      v_before,
      p_payload - 'updated_at'
    );
  end if;

  v_after.destination_type :=
    lower(nullif(btrim(coalesce(v_after.destination_type, '')), ''));
  v_after.clabe := nullif(
    regexp_replace(
      coalesce(v_after.clabe, ''),
      '[[:space:]-]',
      '',
      'g'
    ),
    ''
  );
  v_after.cuenta_bancaria := nullif(
    regexp_replace(
      coalesce(v_after.cuenta_bancaria, ''),
      '[[:space:]-]',
      '',
      'g'
    ),
    ''
  );
  v_after.convenio_number :=
    nullif(btrim(coalesce(v_after.convenio_number, '')), '');
  v_after.beneficiary_name :=
    nullif(btrim(coalesce(v_after.beneficiary_name, '')), '');
  v_after.banco := nullif(
    regexp_replace(
      btrim(coalesce(v_after.banco, '')),
      '[[:space:]]+',
      ' ',
      'g'
    ),
    ''
  );

  if nullif(btrim(coalesce(v_after.alias, '')), '') is null
     or nullif(btrim(coalesce(v_after.nombre_completo, '')), '') is null
     or nullif(
       btrim(coalesce(v_after.metodo_pago::text, '')),
       ''
     ) is null then
    raise exception 'provider_core_fields_required';
  end if;

  v_execution_supplied :=
    v_after.destination_type is not null
    or v_after.clabe is not null
    or v_after.cuenta_bancaria is not null
    or v_after.convenio_number is not null
    or v_after.beneficiary_name is not null
    or v_after.banco is not null;

  v_execution_changed := v_is_create and v_execution_supplied;
  if not v_is_create then
    v_execution_changed := row(
      v_before.destination_type,
      v_before.clabe,
      v_before.cuenta_bancaria,
      v_before.convenio_number,
      v_before.beneficiary_name,
      v_before.banco
    ) is distinct from row(
      v_after.destination_type,
      v_after.clabe,
      v_after.cuenta_bancaria,
      v_after.convenio_number,
      v_after.beneficiary_name,
      v_after.banco
    );
  end if;

  if v_execution_changed then
    if not coalesce(v_after.activo, false) then
      raise exception 'proveedor_not_found_or_inactive';
    end if;
    perform public.approval_batch_require_finance();
    perform set_config(
      'flux.provider_payment_execution_rpc',
      v_provider_id::text,
      true
    );
  end if;

  v_missing_after :=
    public.provider_payment_execution_missing_fields(v_after);
  if v_missing_after && array[
    'beneficiary_name_invalid',
    'banco_invalid',
    'destination_type_invalid',
    'clabe_invalid',
    'cuenta_bancaria_invalid',
    'convenio_number_invalid'
  ]::text[] then
    raise exception 'provider_payment_execution_data_invalid';
  end if;

  if v_is_create then
    insert into public.proveedores(
      id,
      alias,
      nombre_completo,
      metodo_pago,
      tipo_cuenta,
      destination_type,
      beneficiary_name,
      banco,
      clabe,
      cuenta_bancaria,
      convenio_number,
      rfc,
      persona_tipo,
      email,
      telefono,
      tipo_proveedor,
      notas,
      es_personal_eventual,
      activo,
      updated_at
    ) values (
      v_after.id,
      v_after.alias,
      v_after.nombre_completo,
      v_after.metodo_pago,
      v_after.tipo_cuenta,
      v_after.destination_type,
      v_after.beneficiary_name,
      v_after.banco,
      v_after.clabe,
      v_after.cuenta_bancaria,
      v_after.convenio_number,
      v_after.rfc,
      v_after.persona_tipo,
      v_after.email,
      v_after.telefono,
      v_after.tipo_proveedor,
      v_after.notas,
      v_after.es_personal_eventual,
      v_after.activo,
      v_now
    )
    returning * into v_after;

    if v_execution_changed then
      v_execution_fields := array_remove(array[
        case
          when v_after.destination_type is not null
            then 'destination_type'
        end,
        case when v_after.clabe is not null then 'clabe' end,
        case
          when v_after.cuenta_bancaria is not null
            then 'cuenta_bancaria'
        end,
        case
          when v_after.convenio_number is not null
            then 'convenio_number'
        end,
        case
          when v_after.beneficiary_name is not null
            then 'beneficiary_name'
        end,
        case when v_after.banco is not null then 'banco' end
      ]::text[], null);

      v_missing_after :=
        public.provider_payment_execution_missing_fields(v_after);

      insert into public.activity_log(
        entity_type,
        entity_id,
        action,
        old_values,
        new_values,
        performed_by,
        performed_at,
        notes
      ) values (
        'proveedor',
        v_after.id,
        'payment_execution_data_created',
        jsonb_build_object(
          'layout_data_complete', false,
          'missing_fields', '[]'::jsonb
        ),
        jsonb_build_object(
          'changed_fields', to_jsonb(v_execution_fields),
          'completed_fields', to_jsonb(v_execution_fields),
          'layout_data_complete', cardinality(v_missing_after) = 0,
          'missing_fields', to_jsonb(v_missing_after)
        ),
        v_actor,
        v_now,
        'Provider created through the authorized catalog RPC; banking values intentionally omitted.'
      );
    end if;
  else
    update public.proveedores provider
    set alias = v_after.alias,
        nombre_completo = v_after.nombre_completo,
        metodo_pago = v_after.metodo_pago,
        tipo_cuenta = v_after.tipo_cuenta,
        destination_type = v_after.destination_type,
        beneficiary_name = v_after.beneficiary_name,
        banco = v_after.banco,
        clabe = v_after.clabe,
        cuenta_bancaria = v_after.cuenta_bancaria,
        convenio_number = v_after.convenio_number,
        rfc = v_after.rfc,
        persona_tipo = v_after.persona_tipo,
        email = v_after.email,
        telefono = v_after.telefono,
        tipo_proveedor = v_after.tipo_proveedor,
        notas = v_after.notas,
        es_personal_eventual = v_after.es_personal_eventual,
        activo = v_after.activo,
        updated_at = v_now
    where provider.id = v_provider_id
    returning * into v_after;
  end if;

  return jsonb_build_object('id', v_after.id);
end
$function$;

