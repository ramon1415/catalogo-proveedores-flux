-- Flux Operadora - Migration 031
-- Controlled matching between provider intakes and the canonical provider catalog.
-- Prepared for DEV only. This migration must not be applied without the explicit Gate 1 authorization.

begin;

do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.payment_intake') is null then
    v_missing := array_append(v_missing, 'public.payment_intake');
  end if;
  if to_regclass('public.payment_intake_events') is null then
    v_missing := array_append(v_missing, 'public.payment_intake_events');
  end if;
  if to_regclass('public.proveedores') is null then
    v_missing := array_append(v_missing, 'public.proveedores');
  end if;
  if to_regprocedure('public.provider_intake_actor_context()') is null then
    v_missing := array_append(v_missing, 'public.provider_intake_actor_context()');
  end if;
  if to_regprocedure('public.provider_intake_assert_company_access(uuid)') is null then
    v_missing := array_append(v_missing, 'public.provider_intake_assert_company_access(uuid)');
  end if;
  if to_regprocedure('public.provider_intake_mask_value(text)') is null then
    v_missing := array_append(v_missing, 'public.provider_intake_mask_value(text)');
  end if;
  if to_regprocedure(
    'public.provider_intake_action_fingerprint(integer,text,uuid,uuid,text,timestamptz,text,text)'
  ) is null then
    v_missing := array_append(v_missing, 'Migration 030 action fingerprint contract');
  end if;
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    v_missing := array_append(v_missing, 'extensions.digest(bytea,text)');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception '031_precheck: missing required objects: %',
      array_to_string(v_missing, ', ');
  end if;

  if exists (
    select 1
    from pg_attribute a
    where a.attrelid = 'public.proveedores'::regclass
      and a.attname = any (array[
        'id', 'alias', 'nombre_completo', 'rfc', 'metodo_pago', 'banco',
        'cuenta_bancaria', 'clabe', 'email', 'telefono', 'activo',
        'beneficiary_name', 'persona_tipo'
      ]::text[])
      and a.attisdropped
  ) or (
    select count(*)
    from pg_attribute a
    where a.attrelid = 'public.proveedores'::regclass
      and a.attname = any (array[
        'id', 'alias', 'nombre_completo', 'rfc', 'metodo_pago', 'banco',
        'cuenta_bancaria', 'clabe', 'email', 'telefono', 'activo',
        'beneficiary_name', 'persona_tipo'
      ]::text[])
      and not a.attisdropped
  ) <> 13 then
    raise exception '031_precheck: public.proveedores canonical columns differ from Migration 020';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.payment_intake_events'::regclass
      and c.conname = 'payment_intake_events_event_type_check'
      and pg_get_constraintdef(c.oid) like '%provider_matched%'
  ) then
    raise exception '031_precheck: provider_matched event type is unavailable';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
      and t.tgenabled <> 'D'
  ) then
    raise exception '031_precheck: append-only event trigger is missing';
  end if;

  if to_regprocedure('public.find_provider_intake_candidates(uuid,text,integer)') is not null
     or to_regprocedure('public.get_provider_intake_match_comparison(uuid,uuid)') is not null
     or to_regprocedure(
       'public.set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)'
     ) is not null then
    raise exception '031_precheck: one or more matching RPCs already exist';
  end if;
end
$$;

create function public.normalize_provider_match_text(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select nullif(
    regexp_replace(
      regexp_replace(upper(btrim(coalesce(p_value, ''))), '[^[:alnum:]&Ñ]+', ' ', 'g'),
      '[[:space:]]+',
      ' ',
      'g'
    ),
    ''
  );
$$;

create function public.normalize_provider_match_digits(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select nullif(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g'), '');
$$;

create function public.provider_intake_match_fingerprint(
  p_contract_version integer,
  p_action_kind text,
  p_payment_intake_id uuid,
  p_actor_profile_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_expected_current_match uuid,
  p_new_match uuid,
  p_reason_code text,
  p_reason text
)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        jsonb_build_object(
          'actor_profile_id', p_actor_profile_id::text,
          'contract_version', p_contract_version,
          'expected_current_match', p_expected_current_match::text,
          'expected_status', p_expected_status,
          'expected_updated_at', case
            when p_expected_updated_at is null then null
            else pg_catalog.to_char(
              p_expected_updated_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            )
          end,
          'new_match', p_new_match::text,
          'operation', p_action_kind,
          'payment_intake_id', p_payment_intake_id::text,
          'reason', p_reason,
          'reason_code', p_reason_code
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create function public.find_provider_intake_candidates(
  p_payment_intake_id uuid,
  p_search text default null,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_intake public.payment_intake%rowtype;
  v_search text;
  v_limit integer;
  v_result jsonb;
begin
  if p_payment_intake_id is null then
    raise exception 'provider_intake_id_required';
  end if;

  perform public.provider_intake_actor_context();

  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  v_search := public.normalize_provider_match_text(p_search);
  if v_search is not null and length(v_search) < 2 then
    raise exception 'provider_intake_search_too_short';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 12), 1), 25);

  with
  intake_values as (
    select
      public.normalize_provider_match_text(v_intake.provider_name) as provider_name,
      nullif(upper(regexp_replace(coalesce(v_intake.provider_rfc, ''), '[[:space:]-]+', '', 'g')), '') as rfc,
      public.normalize_provider_match_text(v_intake.bank_name) as bank_name,
      public.normalize_provider_match_digits(v_intake.bank_account) as bank_account,
      public.normalize_provider_match_digits(v_intake.bank_clabe) as bank_clabe,
      lower(nullif(btrim(coalesce(v_intake.provider_email, '')), '')) as email,
      public.normalize_provider_match_digits(v_intake.provider_phone) as phone
  ),
  provider_values as (
    select
      p.*,
      public.normalize_provider_match_text(p.nombre_completo) as legal_name,
      public.normalize_provider_match_text(p.alias) as alias_name,
      nullif(upper(regexp_replace(coalesce(p.rfc, ''), '[[:space:]-]+', '', 'g')), '') as normalized_rfc,
      public.normalize_provider_match_text(p.banco) as normalized_bank,
      public.normalize_provider_match_digits(p.cuenta_bancaria) as normalized_account,
      public.normalize_provider_match_digits(p.clabe) as normalized_clabe,
      lower(nullif(btrim(coalesce(p.email, '')), '')) as normalized_email,
      public.normalize_provider_match_digits(p.telefono) as normalized_phone
    from public.proveedores p
  ),
  signals as (
    select
      pv.*,
      iv.provider_name as intake_provider_name,
      iv.rfc as intake_rfc,
      iv.bank_name as intake_bank_name,
      iv.bank_account as intake_bank_account,
      iv.bank_clabe as intake_bank_clabe,
      iv.email as intake_email,
      iv.phone as intake_phone,
      (iv.rfc is not null and pv.normalized_rfc = iv.rfc) as rfc_exact,
      (iv.bank_clabe is not null and pv.normalized_clabe = iv.bank_clabe) as clabe_exact,
      (
        iv.bank_account is not null
        and pv.normalized_account = iv.bank_account
        and (
          iv.bank_name is null
          or pv.normalized_bank is null
          or pv.normalized_bank = iv.bank_name
        )
      ) as account_exact,
      (
        iv.provider_name is not null
        and pv.legal_name = iv.provider_name
      ) as legal_exact,
      (
        iv.provider_name is not null
        and length(iv.provider_name) >= 4
        and pv.legal_name is not null
        and (
          pv.legal_name like iv.provider_name || '%'
          or iv.provider_name like pv.legal_name || '%'
        )
      ) as legal_prefix,
      (
        iv.provider_name is not null
        and pv.alias_name = iv.provider_name
      ) as alias_exact,
      (
        iv.provider_name is not null
        and length(iv.provider_name) >= 4
        and pv.alias_name is not null
        and (
          pv.alias_name like iv.provider_name || '%'
          or iv.provider_name like pv.alias_name || '%'
        )
      ) as alias_prefix,
      (
        iv.email is not null
        and pv.normalized_email = iv.email
      ) as email_exact,
      (
        iv.phone is not null
        and length(iv.phone) >= 7
        and pv.normalized_phone = iv.phone
      ) as phone_exact,
      (
        v_search is not null
        and (
          pv.legal_name like v_search || '%'
          or pv.alias_name like v_search || '%'
          or pv.normalized_rfc like replace(v_search, ' ', '') || '%'
        )
      ) as manual_search_match
    from provider_values pv
    cross join intake_values iv
  ),
  scored as (
    select
      s.*,
      least(
        100,
        (case when rfc_exact then 70 else 0 end)
        + (case when clabe_exact then 45 else 0 end)
        + (case when account_exact then 30 else 0 end)
        + (case when legal_exact then 25 when legal_prefix then 12 else 0 end)
        + (case when alias_exact then 15 when alias_prefix then 8 else 0 end)
        + (case when email_exact then 5 else 0 end)
        + (case when phone_exact then 5 else 0 end)
      )::integer as score
    from signals s
    where
      rfc_exact or clabe_exact or account_exact or legal_exact or legal_prefix
      or alias_exact or alias_prefix or email_exact or phone_exact or manual_search_match
  ),
  eligible_candidates as (
    select *
    from scored
    where coalesce(activo, true)
       or rfc_exact
       or clabe_exact
       or account_exact
    order by coalesce(activo, true) desc, score desc, alias, id
    limit v_limit
  )
  select jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'status', v_intake.status,
    'updated_at', v_intake.updated_at,
    'eligible', (
      v_intake.status = 'in_review'
      and v_intake.created_payment_request_id is null
    ),
    'current_match', (
      select case when p.id is null then null else jsonb_build_object(
        'proveedor_id', p.id,
        'alias', p.alias,
        'legal_name', coalesce(p.nombre_completo, p.beneficiary_name),
        'rfc', p.rfc,
        'payment_method', p.metodo_pago::text,
        'bank', p.banco,
        'account_masked', public.provider_intake_mask_value(p.cuenta_bancaria),
        'clabe_masked', public.provider_intake_mask_value(p.clabe),
        'active', coalesce(p.activo, true)
      ) end
      from (select 1) seed
      left join public.proveedores p on p.id = v_intake.matched_proveedor_id
    ),
    'duplicate_rfc_count', (
      select count(*)
      from public.proveedores p
      cross join intake_values iv
      where iv.rfc is not null
        and nullif(upper(regexp_replace(coalesce(p.rfc, ''), '[[:space:]-]+', '', 'g')), '') = iv.rfc
    ),
    'candidates', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'proveedor_id', c.id,
          'alias', c.alias,
          'legal_name', coalesce(c.nombre_completo, c.beneficiary_name),
          'rfc', c.rfc,
          'payment_method', c.metodo_pago::text,
          'bank', c.banco,
          'account_masked', public.provider_intake_mask_value(c.cuenta_bancaria),
          'clabe_masked', public.provider_intake_mask_value(c.clabe),
          'active', coalesce(c.activo, true),
          'selectable', coalesce(c.activo, true),
          'score', c.score,
          'confidence', case
            when c.score >= 70 then 'high'
            when c.score >= 40 then 'medium'
            else 'low'
          end,
          'reasons', to_jsonb(array_remove(array[
            case when c.rfc_exact then 'RFC exacto' end,
            case when c.clabe_exact then 'CLABE exacta' end,
            case when c.account_exact then 'Cuenta bancaria exacta' end,
            case when c.legal_exact then 'Razón social exacta'
                 when c.legal_prefix then 'Prefijo de razón social' end,
            case when c.alias_exact then 'Alias exacto'
                 when c.alias_prefix then 'Prefijo de alias' end,
            case when c.email_exact then 'Correo coincide' end,
            case when c.phone_exact then 'Teléfono coincide' end,
            case when c.manual_search_match
                      and not (
                        c.rfc_exact or c.clabe_exact or c.account_exact or c.legal_exact
                        or c.legal_prefix or c.alias_exact or c.alias_prefix
                        or c.email_exact or c.phone_exact
                      )
                 then 'Coincide con la búsqueda manual' end
          ]::text[], null)),
          'differences', to_jsonb(array_remove(array[
            case when c.intake_provider_name is not null and c.legal_name is not null
                       and c.intake_provider_name <> c.legal_name
                 then 'Razón social distinta' end,
            case when c.intake_rfc is not null and c.normalized_rfc is not null
                       and c.intake_rfc <> c.normalized_rfc
                 then 'RFC distinto' end,
            case when c.intake_bank_name is not null and c.normalized_bank is not null
                       and c.intake_bank_name <> c.normalized_bank
                 then 'Banco distinto' end,
            case when c.intake_email is not null and c.normalized_email is not null
                       and c.intake_email <> c.normalized_email
                 then 'Correo distinto' end,
            case when c.intake_phone is not null and c.normalized_phone is not null
                       and c.intake_phone <> c.normalized_phone
                 then 'Teléfono distinto' end
          ]::text[], null))
        )
        order by coalesce(c.activo, true) desc, c.score desc, c.alias, c.id
      )
      from eligible_candidates c
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'event_id', pie.id,
          'action_kind', pie.metadata ->> 'action_kind',
          'previous_provider', previous_provider.alias,
          'new_provider', new_provider.alias,
          'match_confidence', pie.metadata ->> 'match_confidence',
          'reason_code', pie.metadata ->> 'reason_code',
          'reason', pie.notes,
          'actor_type', pie.actor_type,
          'created_at', pie.created_at
        )
        order by pie.created_at desc, pie.id desc
      )
      from public.payment_intake_events pie
      left join public.proveedores previous_provider
        on previous_provider.id = nullif(pie.metadata ->> 'previous_proveedor_id', '')::uuid
      left join public.proveedores new_provider
        on new_provider.id = nullif(pie.metadata ->> 'new_proveedor_id', '')::uuid
      where pie.payment_intake_id = v_intake.id
        and pie.event_type = 'provider_matched'
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end
$$;

create function public.get_provider_intake_match_comparison(
  p_payment_intake_id uuid,
  p_proveedor_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_intake public.payment_intake%rowtype;
  v_provider public.proveedores%rowtype;
begin
  if p_payment_intake_id is null or p_proveedor_id is null then
    raise exception 'provider_intake_comparison_fields_required';
  end if;

  perform public.provider_intake_actor_context();

  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  select *
    into v_provider
  from public.proveedores
  where id = p_proveedor_id;

  if not found then
    raise exception 'provider_intake_provider_not_found';
  end if;

  return jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'status', v_intake.status,
    'updated_at', v_intake.updated_at,
    'eligible', (
      v_intake.status = 'in_review'
      and v_intake.created_payment_request_id is null
      and coalesce(v_provider.activo, true)
    ),
    'proveedor_id', v_provider.id,
    'provider_alias', v_provider.alias,
    'provider_active', coalesce(v_provider.activo, true),
    'rows', jsonb_build_array(
      jsonb_build_object(
        'field', 'Razón social',
        'declared', v_intake.provider_name,
        'master', coalesce(v_provider.nombre_completo, v_provider.beneficiary_name, v_provider.alias),
        'result', case
          when nullif(btrim(v_intake.provider_name), '') is null
            or nullif(btrim(coalesce(v_provider.nombre_completo, v_provider.beneficiary_name, v_provider.alias)), '') is null
            then 'not_reported'
          when public.normalize_provider_match_text(v_intake.provider_name)
            = public.normalize_provider_match_text(coalesce(v_provider.nombre_completo, v_provider.beneficiary_name, v_provider.alias))
            then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'RFC',
        'declared', v_intake.provider_rfc,
        'master', v_provider.rfc,
        'result', case
          when v_intake.provider_rfc is null or v_provider.rfc is null then 'not_reported'
          when upper(regexp_replace(v_intake.provider_rfc, '[[:space:]-]+', '', 'g'))
            = upper(regexp_replace(v_provider.rfc, '[[:space:]-]+', '', 'g')) then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'Banco',
        'declared', v_intake.bank_name,
        'master', v_provider.banco,
        'result', case
          when v_intake.bank_name is null or v_provider.banco is null then 'not_reported'
          when public.normalize_provider_match_text(v_intake.bank_name)
            = public.normalize_provider_match_text(v_provider.banco) then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'Cuenta',
        'declared', public.provider_intake_mask_value(v_intake.bank_account),
        'master', public.provider_intake_mask_value(v_provider.cuenta_bancaria),
        'result', case
          when v_intake.bank_account is null or v_provider.cuenta_bancaria is null then 'not_reported'
          when public.normalize_provider_match_digits(v_intake.bank_account)
            = public.normalize_provider_match_digits(v_provider.cuenta_bancaria) then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'CLABE',
        'declared', public.provider_intake_mask_value(v_intake.bank_clabe),
        'master', public.provider_intake_mask_value(v_provider.clabe),
        'result', case
          when v_intake.bank_clabe is null or v_provider.clabe is null then 'not_reported'
          when public.normalize_provider_match_digits(v_intake.bank_clabe)
            = public.normalize_provider_match_digits(v_provider.clabe) then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'Beneficiario',
        'declared', v_intake.beneficiary_name,
        'master', v_provider.beneficiary_name,
        'result', case
          when v_intake.beneficiary_name is null or v_provider.beneficiary_name is null then 'not_reported'
          when public.normalize_provider_match_text(v_intake.beneficiary_name)
            = public.normalize_provider_match_text(v_provider.beneficiary_name) then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'Correo',
        'declared', v_intake.provider_email,
        'master', v_provider.email,
        'result', case
          when v_intake.provider_email is null or v_provider.email is null then 'not_reported'
          when lower(btrim(v_intake.provider_email)) = lower(btrim(v_provider.email)) then 'match'
          else 'different'
        end
      ),
      jsonb_build_object(
        'field', 'Teléfono',
        'declared', v_intake.provider_phone,
        'master', v_provider.telefono,
        'result', case
          when v_intake.provider_phone is null or v_provider.telefono is null then 'not_reported'
          when public.normalize_provider_match_digits(v_intake.provider_phone)
            = public.normalize_provider_match_digits(v_provider.telefono) then 'match'
          else 'different'
        end
      )
    )
  );
end
$$;

create function public.set_provider_intake_match(
  p_payment_intake_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_expected_current_match uuid,
  p_proveedor_id uuid,
  p_reason text,
  p_reason_code text,
  p_action_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb;
  v_actor_profile_id uuid;
  v_actor_type text;
  v_intake public.payment_intake%rowtype;
  v_provider public.proveedores%rowtype;
  v_reason text;
  v_reason_code text;
  v_action_kind text;
  v_action_fingerprint text;
  v_score integer := 0;
  v_confidence text := 'none';
  v_existing_event record;
begin
  if p_payment_intake_id is null
     or p_expected_status is null
     or p_expected_updated_at is null
     or p_reason_code is null
     or p_action_id is null then
    raise exception 'provider_intake_match_fields_required';
  end if;

  v_actor := public.provider_intake_actor_context();
  v_actor_profile_id := (v_actor ->> 'profile_id')::uuid;
  v_actor_type := v_actor ->> 'actor_type';
  v_reason := nullif(regexp_replace(btrim(coalesce(p_reason, '')), '[[:space:]]+', ' ', 'g'), '');
  v_reason_code := lower(btrim(p_reason_code));

  if p_expected_current_match is null and p_proveedor_id is not null then
    v_action_kind := 'match_set';
  elsif p_expected_current_match is not null and p_proveedor_id is null then
    v_action_kind := 'match_clear';
  elsif p_expected_current_match is not null
        and p_proveedor_id is not null
        and p_expected_current_match is distinct from p_proveedor_id then
    v_action_kind := 'match_replace';
  else
    raise exception 'provider_intake_match_unchanged';
  end if;

  if v_reason_code not in (
    'candidate_selected',
    'manual_search',
    'duplicate_resolution',
    'match_corrected',
    'no_longer_matches',
    'other'
  ) then
    raise exception 'provider_intake_match_reason_code_invalid';
  end if;

  if v_action_kind in ('match_replace', 'match_clear')
     and (v_reason is null or length(v_reason) < 10 or length(v_reason) > 500) then
    raise exception 'provider_intake_match_reason_required';
  end if;
  if v_reason is not null and (
    length(v_reason) > 500
    or v_reason ~ '[[:cntrl:]]'
    or v_reason ~ '<[^>]*>'
    or v_reason ~ '@'
    or v_reason ~ '[0-9]{8,}'
    or upper(v_reason) ~ '[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}'
  ) then
    raise exception 'provider_intake_match_reason_sensitive';
  end if;

  v_action_fingerprint := public.provider_intake_match_fingerprint(
    3,
    v_action_kind,
    p_payment_intake_id,
    v_actor_profile_id,
    p_expected_status,
    p_expected_updated_at,
    p_expected_current_match,
    p_proveedor_id,
    v_reason_code,
    v_reason
  );

  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id
  for update;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  select
    pie.id,
    pie.actor_profile_id,
    pie.metadata ->> 'action_fingerprint' as action_fingerprint,
    pie.metadata ->> 'action_kind' as action_kind,
    pie.metadata ->> 'contract_version' as contract_version
    into v_existing_event
  from public.payment_intake_events pie
  where pie.payment_intake_id = p_payment_intake_id
    and pie.metadata ->> 'action_id' = p_action_id::text
  limit 1;

  if found then
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
    end if;
    if v_existing_event.action_fingerprint is null
       or v_existing_event.action_kind is null
       or v_existing_event.contract_version is null then
      raise exception 'provider_intake_action_id_legacy_conflict';
    end if;
    if v_existing_event.action_kind is distinct from v_action_kind
       or v_existing_event.contract_version is distinct from '3'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_action_id_material_conflict';
    end if;
    return jsonb_build_object(
      'payment_intake_id', v_intake.id,
      'status', v_intake.status,
      'matched_proveedor_id', v_intake.matched_proveedor_id,
      'updated_at', v_intake.updated_at,
      'action_kind', v_action_kind,
      'idempotent', true
    );
  end if;

  if v_intake.status is distinct from p_expected_status
     or v_intake.updated_at is distinct from p_expected_updated_at
     or v_intake.matched_proveedor_id is distinct from p_expected_current_match then
    raise exception 'provider_intake_conflict';
  end if;

  if v_intake.status <> 'in_review' then
    raise exception 'provider_intake_match_status_invalid';
  end if;
  if v_intake.created_payment_request_id is not null then
    raise exception 'provider_intake_match_converted';
  end if;

  if p_proveedor_id is not null then
    select *
      into v_provider
    from public.proveedores
    where id = p_proveedor_id;

    if not found then
      raise exception 'provider_intake_provider_not_found';
    end if;
    if not coalesce(v_provider.activo, true) then
      raise exception 'provider_intake_provider_inactive';
    end if;

    v_score := least(
      100,
      (case when nullif(v_intake.provider_rfc, '') is not null
                   and upper(regexp_replace(v_intake.provider_rfc, '[[:space:]-]+', '', 'g'))
                     = upper(regexp_replace(coalesce(v_provider.rfc, ''), '[[:space:]-]+', '', 'g'))
             then 70 else 0 end)
      + (case when public.normalize_provider_match_digits(v_intake.bank_clabe) is not null
                   and public.normalize_provider_match_digits(v_intake.bank_clabe)
                     = public.normalize_provider_match_digits(v_provider.clabe)
              then 45 else 0 end)
      + (case when public.normalize_provider_match_digits(v_intake.bank_account) is not null
                   and public.normalize_provider_match_digits(v_intake.bank_account)
                     = public.normalize_provider_match_digits(v_provider.cuenta_bancaria)
              then 30 else 0 end)
      + (case
          when public.normalize_provider_match_text(v_intake.provider_name)
            = public.normalize_provider_match_text(v_provider.nombre_completo) then 25
          when length(public.normalize_provider_match_text(v_intake.provider_name)) >= 4
               and (
                 public.normalize_provider_match_text(v_provider.nombre_completo)
                   like public.normalize_provider_match_text(v_intake.provider_name) || '%'
                 or public.normalize_provider_match_text(v_intake.provider_name)
                   like public.normalize_provider_match_text(v_provider.nombre_completo) || '%'
               ) then 12
          else 0
        end)
      + (case
          when public.normalize_provider_match_text(v_intake.provider_name)
            = public.normalize_provider_match_text(v_provider.alias) then 15
          when length(public.normalize_provider_match_text(v_intake.provider_name)) >= 4
               and (
                 public.normalize_provider_match_text(v_provider.alias)
                   like public.normalize_provider_match_text(v_intake.provider_name) || '%'
                 or public.normalize_provider_match_text(v_intake.provider_name)
                   like public.normalize_provider_match_text(v_provider.alias) || '%'
               ) then 8
          else 0
        end)
      + (case when lower(btrim(v_intake.provider_email)) = lower(btrim(coalesce(v_provider.email, '')))
              then 5 else 0 end)
      + (case when length(public.normalize_provider_match_digits(v_intake.provider_phone)) >= 7
                   and public.normalize_provider_match_digits(v_intake.provider_phone)
                     = public.normalize_provider_match_digits(v_provider.telefono)
              then 5 else 0 end)
    );
    v_confidence := case
      when v_score >= 70 then 'high'
      when v_score >= 40 then 'medium'
      else 'low'
    end;
  end if;

  update public.payment_intake
     set matched_proveedor_id = p_proveedor_id,
         updated_at = now()
   where id = v_intake.id
     and status = p_expected_status
     and updated_at = p_expected_updated_at
     and matched_proveedor_id is not distinct from p_expected_current_match
     and created_payment_request_id is null
  returning * into v_intake;

  if not found then
    raise exception 'provider_intake_conflict';
  end if;

  insert into public.payment_intake_events (
    payment_intake_id,
    event_type,
    actor_profile_id,
    actor_type,
    from_status,
    to_status,
    notes,
    metadata
  ) values (
    v_intake.id,
    'provider_matched',
    v_actor_profile_id,
    v_actor_type,
    v_intake.status,
    v_intake.status,
    v_reason,
    jsonb_build_object(
      'action_id', p_action_id,
      'action_fingerprint', v_action_fingerprint,
      'action_kind', v_action_kind,
      'contract_version', 3,
      'previous_match_present', p_expected_current_match is not null,
      'new_match_present', p_proveedor_id is not null,
      'previous_proveedor_id', p_expected_current_match,
      'new_proveedor_id', p_proveedor_id,
      'match_confidence', v_confidence,
      'match_score', v_score,
      'reason_code', v_reason_code
    )
  );

  return jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'status', v_intake.status,
    'matched_proveedor_id', v_intake.matched_proveedor_id,
    'updated_at', v_intake.updated_at,
    'action_kind', v_action_kind,
    'match_confidence', v_confidence,
    'match_score', v_score,
    'idempotent', false
  );
exception
  when unique_violation then
    select
      pie.id,
      pie.actor_profile_id,
      pie.metadata ->> 'action_fingerprint' as action_fingerprint,
      pie.metadata ->> 'action_kind' as action_kind,
      pie.metadata ->> 'contract_version' as contract_version
      into v_existing_event
    from public.payment_intake_events pie
    where pie.payment_intake_id = p_payment_intake_id
      and pie.metadata ->> 'action_id' = p_action_id::text
    limit 1;

    if not found then
      raise;
    end if;
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
    end if;
    if v_existing_event.action_fingerprint is null
       or v_existing_event.action_kind is null
       or v_existing_event.contract_version is null then
      raise exception 'provider_intake_action_id_legacy_conflict';
    end if;
    if v_existing_event.action_kind is distinct from v_action_kind
       or v_existing_event.contract_version is distinct from '3'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_action_id_material_conflict';
    end if;

    select *
      into v_intake
    from public.payment_intake
    where id = p_payment_intake_id;

    return jsonb_build_object(
      'payment_intake_id', v_intake.id,
      'status', v_intake.status,
      'matched_proveedor_id', v_intake.matched_proveedor_id,
      'updated_at', v_intake.updated_at,
      'action_kind', v_action_kind,
      'idempotent', true
    );
end
$$;

revoke all on function public.normalize_provider_match_text(text)
  from public, anon, authenticated, service_role;
revoke all on function public.normalize_provider_match_digits(text)
  from public, anon, authenticated, service_role;
revoke all on function public.provider_intake_match_fingerprint(
  integer, text, uuid, uuid, text, timestamptz, uuid, uuid, text, text
)
  from public, anon, authenticated, service_role;
revoke all on function public.find_provider_intake_candidates(uuid, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_provider_intake_match_comparison(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.set_provider_intake_match(
  uuid, text, timestamptz, uuid, uuid, text, text, uuid
)
  from public, anon, authenticated, service_role;

grant execute on function public.find_provider_intake_candidates(uuid, text, integer)
  to authenticated;
grant execute on function public.get_provider_intake_match_comparison(uuid, uuid)
  to authenticated;
grant execute on function public.set_provider_intake_match(
  uuid, text, timestamptz, uuid, uuid, text, text, uuid
)
  to authenticated;

comment on function public.find_provider_intake_candidates(uuid, text, integer) is
  'Authorized server-side provider candidate search using deterministic exact and controlled-prefix signals; full bank identifiers never leave the database.';
comment on function public.get_provider_intake_match_comparison(uuid, uuid) is
  'Authorized field-by-field comparison between immutable intake declarations and a canonical provider, with bank identifiers masked.';
comment on function public.set_provider_intake_match(
  uuid, text, timestamptz, uuid, uuid, text, text, uuid
) is
  'Explicit set, replace, or clear of matched_proveedor_id with optimistic concurrency, material idempotency, and one append-only provider_matched event.';

do $$
declare
  v_fingerprint text;
begin
  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'find_provider_intake_candidates',
        'get_provider_intake_match_comparison',
        'set_provider_intake_match'
      )
      and p.prosecdef
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting = 'search_path=public, pg_temp'
      )
  ) <> 3 then
    raise exception '031_postcheck: public RPC security attributes are incomplete';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'find_provider_intake_candidates',
        'get_provider_intake_match_comparison',
        'set_provider_intake_match'
      )
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception '031_postcheck: public RPC grants are unsafe';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'normalize_provider_match_text',
        'normalize_provider_match_digits',
        'provider_intake_match_fingerprint'
      )
      and (
        p.prosecdef
        or has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception '031_postcheck: internal helper grants are unsafe';
  end if;

  v_fingerprint := public.provider_intake_match_fingerprint(
    3,
    'match_set',
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    'in_review',
    '2026-01-01T12:34:56.123456Z'::timestamptz,
    null,
    '33333333-3333-4333-8333-333333333333'::uuid,
    'candidate_selected',
    null
  );
  if v_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception '031_postcheck: match fingerprint is not lowercase SHA-256 hex';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
      and t.tgenabled <> 'D'
  ) then
    raise exception '031_postcheck: append-only trigger is inactive';
  end if;
end
$$;

commit;
