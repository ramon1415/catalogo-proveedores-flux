-- 046 · Provider-aware intake links and explicit bank-data confirmation.
-- Forward-only, DEV-first. Legacy links remain generic (proveedor_id IS NULL).

do $$
begin
  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260811230137'
  ) then
    raise exception 'provider_intake_045_required';
  end if;
end
$$;

alter table public.intake_links
  add column proveedor_id uuid null;

alter table public.intake_links
  add constraint intake_links_proveedor_id_fkey
  foreign key (proveedor_id) references public.proveedores(id) on delete restrict;

alter table public.payment_intake
  add column link_target_proveedor_id uuid null,
  add column bank_data_confirmation text null;

alter table public.payment_intake
  add constraint payment_intake_link_target_proveedor_id_fkey
  foreign key (link_target_proveedor_id) references public.proveedores(id) on delete restrict,
  add constraint payment_intake_bank_data_confirmation_check
  check (
    bank_data_confirmation is null
    or bank_data_confirmation in ('MASTER_CONFIRMED', 'CHANGE_DECLARED')
  );

drop index public.intake_links_one_active_per_company_uidx;

create unique index intake_links_one_active_generic_per_company_uidx
  on public.intake_links(company_id)
  where status = 'active' and proveedor_id is null;

create unique index intake_links_one_active_per_company_provider_uidx
  on public.intake_links(company_id, proveedor_id)
  where status = 'active' and proveedor_id is not null;

create index intake_links_proveedor_id_idx
  on public.intake_links(proveedor_id)
  where proveedor_id is not null;

create index payment_intake_link_target_proveedor_id_idx
  on public.payment_intake(link_target_proveedor_id)
  where link_target_proveedor_id is not null;

create or replace function public.get_provider_intake_link_management_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := public.current_profile_id();
begin
  if v_profile_id is null then
    raise exception 'provider_intake_link_auth_required';
  end if;

  return jsonb_build_object(
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', company.id,
        'name', coalesce(nullif(btrim(company.legal_name), ''), company.name),
        'active_provider_count', (
          select count(*) from public.proveedores provider
          where coalesce(provider.activo, true)
        ),
        'active_provider_link_count', (
          select count(*) from public.intake_links provider_link
          where provider_link.company_id = company.id
            and provider_link.proveedor_id is not null
            and provider_link.status = 'active'
            and (provider_link.expires_at is null or provider_link.expires_at > now())
        ),
        'active_generic_link', case when generic_link.id is null then null else jsonb_build_object(
          'id', generic_link.id,
          'label', generic_link.label,
          'status', case when generic_link.expires_at <= now() then 'expired' else generic_link.status end,
          'token_prefix', generic_link.token_prefix,
          'created_at', generic_link.created_at,
          'expires_at', generic_link.expires_at,
          'max_submissions_per_day', generic_link.max_submissions_per_day,
          'allowed_file_types', to_jsonb(generic_link.allowed_file_types),
          'max_file_mb', generic_link.max_file_mb,
          'current_intakes', (
            select count(*) from public.payment_intake intake
            where intake.intake_link_id = generic_link.id
          )
        ) end
      ) order by coalesce(nullif(btrim(company.legal_name), ''), company.name), company.id)
      from public.companies company
      left join lateral (
        select intake_link.*
        from public.intake_links intake_link
        where intake_link.company_id = company.id
          and intake_link.proveedor_id is null
          and intake_link.status = 'active'
        order by intake_link.created_at desc, intake_link.id desc
        limit 1
      ) generic_link on true
      where coalesce(company.active, true)
        and public.provider_intake_link_actor_authorized(v_profile_id, company.id)
    ), '[]'::jsonb),
    'defaults', jsonb_build_object(
      'duration_hours', 72,
      'minimum_duration_hours', 4,
      'maximum_duration_hours', 168,
      'max_submissions_per_day', 20,
      'max_file_mb', 10,
      'max_files', 3,
      'max_total_mb', 12,
      'allowed_file_types', jsonb_build_array(
        'application/pdf', 'application/xml', 'text/xml',
        'image/jpeg', 'image/png', 'image/webp'
      )
    ),
    'raw_token_retrievable', false,
    'one_active_link_per_scope', true,
    'provider_catalog_publicly_searchable', false
  );
end
$$;

create function public.find_provider_intake_link_providers(
  p_company_id uuid,
  p_search text,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := nullif(regexp_replace(btrim(coalesce(p_search, '')), '[[:space:]]+', ' ', 'g'), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 12), 20));
begin
  perform public.provider_intake_link_require_company_access(p_company_id);
  if v_query is null or char_length(v_query) < 2 or char_length(v_query) > 120
     or v_query ~ '[[:cntrl:]]' then
    raise exception 'provider_intake_link_provider_search_invalid';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'proveedor_id', result.id,
      'alias', result.alias,
      'legal_name', result.nombre_completo,
      'rfc_masked', case
        when nullif(btrim(result.rfc), '') is null then null
        when char_length(btrim(result.rfc)) <= 6 then public.provider_intake_mask_text(result.rfc)
        else left(btrim(result.rfc), 3) || repeat('•', char_length(btrim(result.rfc)) - 6) || right(btrim(result.rfc), 3)
      end,
      'active', true,
      'bank', public.provider_intake_mask_text(result.banco),
      'account_masked', public.provider_intake_mask_value(result.cuenta_bancaria),
      'clabe_masked', public.provider_intake_mask_value(result.clabe)
    ) order by result.rank, result.alias nulls last, result.nombre_completo, result.id)
    from (
      select provider.*,
        case
          when upper(coalesce(provider.rfc, '')) = upper(replace(replace(v_query, ' ', ''), '-', '')) then 0
          when public.normalize_provider_match_text(provider.alias) = public.normalize_provider_match_text(v_query) then 1
          when public.normalize_provider_match_text(provider.nombre_completo) = public.normalize_provider_match_text(v_query) then 2
          else 3
        end as rank
      from public.proveedores provider
      where coalesce(provider.activo, true)
        and (
          public.normalize_provider_match_text(provider.alias) like public.normalize_provider_match_text(v_query) || '%'
          or public.normalize_provider_match_text(provider.nombre_completo) like public.normalize_provider_match_text(v_query) || '%'
          or upper(coalesce(provider.rfc, '')) like upper(replace(replace(v_query, ' ', ''), '-', '')) || '%'
        )
      order by rank, provider.alias nulls last, provider.nombre_completo, provider.id
      limit v_limit
    ) result
  ), '[]'::jsonb);
end
$$;

create function public.get_provider_intake_link_scope(
  p_company_id uuid,
  p_proveedor_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.intake_links%rowtype;
  v_provider public.proveedores%rowtype;
begin
  perform public.provider_intake_link_require_company_access(p_company_id);

  if p_proveedor_id is not null then
    select * into v_provider from public.proveedores
    where id = p_proveedor_id and coalesce(activo, true);
    if not found then raise exception 'provider_intake_link_provider_not_found'; end if;
  end if;

  select * into v_link
  from public.intake_links link
  where link.company_id = p_company_id
    and link.proveedor_id is not distinct from p_proveedor_id
    and link.status = 'active'
  order by link.created_at desc, link.id desc
  limit 1;

  return jsonb_build_object(
    'company_id', p_company_id,
    'proveedor_id', p_proveedor_id,
    'provider', case when p_proveedor_id is null then null else jsonb_build_object(
      'proveedor_id', v_provider.id,
      'alias', v_provider.alias,
      'legal_name', v_provider.nombre_completo,
      'rfc_masked', case
        when nullif(btrim(v_provider.rfc), '') is null then null
        when char_length(btrim(v_provider.rfc)) <= 6 then public.provider_intake_mask_text(v_provider.rfc)
        else left(btrim(v_provider.rfc), 3) || repeat('•', char_length(btrim(v_provider.rfc)) - 6) || right(btrim(v_provider.rfc), 3)
      end,
      'bank', public.provider_intake_mask_text(v_provider.banco),
      'account_masked', public.provider_intake_mask_value(v_provider.cuenta_bancaria),
      'clabe_masked', public.provider_intake_mask_value(v_provider.clabe),
      'active', coalesce(v_provider.activo, true)
    ) end,
    'active_link', case when v_link.id is null then null else jsonb_build_object(
      'id', v_link.id,
      'label', v_link.label,
      'status', case when v_link.expires_at <= now() then 'expired' else v_link.status end,
      'token_prefix', v_link.token_prefix,
      'created_at', v_link.created_at,
      'expires_at', v_link.expires_at,
      'max_submissions_per_day', v_link.max_submissions_per_day,
      'allowed_file_types', to_jsonb(v_link.allowed_file_types),
      'max_file_mb', v_link.max_file_mb,
      'current_intakes', (
        select count(*) from public.payment_intake intake where intake.intake_link_id = v_link.id
      )
    ) end
  );
end
$$;

create function public.create_provider_intake_link_v2(
  p_company_id uuid,
  p_proveedor_id uuid,
  p_label text,
  p_duration_hours integer default 72,
  p_max_submissions_per_day integer default 20,
  p_max_file_mb integer default 10
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_company public.companies%rowtype;
  v_provider public.proveedores%rowtype;
  v_label text := nullif(regexp_replace(btrim(coalesce(p_label, '')), '[[:space:]]+', ' ', 'g'), '');
  v_token text;
  v_link public.intake_links%rowtype;
begin
  if p_company_id is null then raise exception 'provider_intake_link_company_required'; end if;
  if v_label is not null and (
    char_length(v_label) not between 3 and 120
    or v_label ~ '[[:cntrl:]]' or v_label ~ '<[^>]*>'
  ) then raise exception 'provider_intake_link_label_invalid'; end if;
  if p_duration_hours not between 4 and 168 then raise exception 'provider_intake_link_duration_invalid'; end if;
  if p_max_submissions_per_day not between 1 and 100 then raise exception 'provider_intake_link_submission_limit_invalid'; end if;
  if p_max_file_mb not between 1 and 10 then raise exception 'provider_intake_link_file_limit_invalid'; end if;

  v_actor := public.provider_intake_link_require_company_access(p_company_id);
  select * into v_company from public.companies
  where id = p_company_id and coalesce(active, true)
  for update;
  if not found then raise exception 'provider_intake_link_company_not_found'; end if;

  if p_proveedor_id is not null then
    select * into v_provider from public.proveedores
    where id = p_proveedor_id and coalesce(activo, true)
    for share;
    if not found then raise exception 'provider_intake_link_provider_not_found'; end if;
  end if;

  if v_label is null then
    v_label := left(case
      when p_proveedor_id is null then
        'Proveedor nuevo · ' || coalesce(nullif(btrim(v_company.legal_name), ''), v_company.name)
      else
        coalesce(nullif(btrim(v_provider.alias), ''), nullif(btrim(v_provider.nombre_completo), ''), 'Proveedor')
        || ' · ' || coalesce(nullif(btrim(v_company.legal_name), ''), v_company.name)
    end, 120);
  end if;

  update public.intake_links
  set status = 'expired'
  where company_id = p_company_id
    and proveedor_id is not distinct from p_proveedor_id
    and status = 'active'
    and expires_at <= now();

  if exists (
    select 1 from public.intake_links
    where company_id = p_company_id
      and proveedor_id is not distinct from p_proveedor_id
      and status = 'active'
  ) then raise exception 'provider_intake_link_active_scope_exists'; end if;

  v_token := translate(trim(trailing '=' from encode(extensions.gen_random_bytes(32), 'base64')), '+/', '-_');
  insert into public.intake_links(
    company_id, proveedor_id, label, token_hash, token_prefix, status, expires_at,
    max_submissions_per_day, allowed_file_types, max_file_mb, created_by
  ) values (
    p_company_id, p_proveedor_id, v_label,
    encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
    left(v_token, 10), 'active', now() + make_interval(hours => p_duration_hours),
    p_max_submissions_per_day,
    array['application/pdf','application/xml','text/xml','image/jpeg','image/png','image/webp']::text[],
    p_max_file_mb, v_actor
  ) returning * into v_link;

  return jsonb_build_object(
    'id', v_link.id,
    'company_id', v_link.company_id,
    'company_name', coalesce(nullif(btrim(v_company.legal_name), ''), v_company.name),
    'proveedor_id', v_link.proveedor_id,
    'provider_name', case when v_link.proveedor_id is null then null else coalesce(nullif(btrim(v_provider.alias), ''), v_provider.nombre_completo) end,
    'label', v_link.label, 'status', v_link.status,
    'raw_token', v_token, 'token_prefix', v_link.token_prefix,
    'created_at', v_link.created_at, 'expires_at', v_link.expires_at,
    'max_submissions_per_day', v_link.max_submissions_per_day,
    'allowed_file_types', to_jsonb(v_link.allowed_file_types),
    'max_file_mb', v_link.max_file_mb,
    'current_intakes', 0, 'raw_token_once', true
  );
end
$$;

create function public.regenerate_provider_intake_link_v2(
  p_intake_link_id uuid,
  p_confirmed boolean,
  p_duration_hours integer default 72
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_old public.intake_links%rowtype;
  v_new public.intake_links%rowtype;
  v_company public.companies%rowtype;
  v_token text;
begin
  if p_intake_link_id is null then raise exception 'provider_intake_link_id_required'; end if;
  if p_confirmed is not true then raise exception 'provider_intake_link_confirmation_required'; end if;
  if p_duration_hours not between 4 and 168 then raise exception 'provider_intake_link_duration_invalid'; end if;

  select * into v_old from public.intake_links where id = p_intake_link_id for update;
  if not found then raise exception 'provider_intake_link_not_found'; end if;
  v_actor := public.provider_intake_link_require_company_access(v_old.company_id);
  if v_old.status <> 'active' then raise exception 'provider_intake_link_not_active'; end if;
  select * into v_company from public.companies where id = v_old.company_id for update;

  update public.intake_links
  set status = 'revoked', revoked_by = v_actor, revoked_at = now()
  where id = v_old.id;

  v_token := translate(trim(trailing '=' from encode(extensions.gen_random_bytes(32), 'base64')), '+/', '-_');
  insert into public.intake_links(
    company_id, proveedor_id, label, token_hash, token_prefix, status, expires_at,
    max_submissions_per_day, allowed_file_types, max_file_mb, created_by, regenerated_from_id
  ) values (
    v_old.company_id, v_old.proveedor_id, v_old.label,
    encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
    left(v_token, 10), 'active', now() + make_interval(hours => p_duration_hours),
    v_old.max_submissions_per_day, v_old.allowed_file_types, v_old.max_file_mb,
    v_actor, v_old.id
  ) returning * into v_new;

  return jsonb_build_object(
    'id', v_new.id, 'company_id', v_new.company_id,
    'company_name', coalesce(nullif(btrim(v_company.legal_name), ''), v_company.name),
    'proveedor_id', v_new.proveedor_id, 'label', v_new.label,
    'status', v_new.status, 'raw_token', v_token, 'token_prefix', v_new.token_prefix,
    'created_at', v_new.created_at, 'expires_at', v_new.expires_at,
    'max_submissions_per_day', v_new.max_submissions_per_day,
    'allowed_file_types', to_jsonb(v_new.allowed_file_types),
    'max_file_mb', v_new.max_file_mb, 'current_intakes', 0,
    'regenerated_from_id', v_old.id, 'raw_token_once', true
  );
end
$$;

create function public.resolve_provider_aware_intake_link_internal(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_token_hash is null or lower(btrim(p_token_hash)) !~ '^[0-9a-f]{64}$' then
    raise exception 'provider_intake_link_not_available';
  end if;

  select jsonb_build_object(
    'intake_link_id', link.id,
    'company_id', link.company_id,
    'company_display_name', coalesce(nullif(btrim(company.legal_name), ''), company.name),
    'max_file_mb', link.max_file_mb,
    'max_submissions_per_day', link.max_submissions_per_day,
    'allowed_file_types', to_jsonb(link.allowed_file_types),
    'provider_target', case when provider.id is null then null else jsonb_build_object(
      'display_name', coalesce(nullif(btrim(provider.alias), ''), provider.nombre_completo),
      'legal_name', provider.nombre_completo,
      'rfc', provider.rfc,
      'email', provider.email,
      'phone', provider.telefono,
      'bank_name', provider.banco,
      'account_masked', public.provider_intake_mask_value(provider.cuenta_bancaria),
      'clabe_masked', public.provider_intake_mask_value(provider.clabe)
    ) end
  ) into v_result
  from public.intake_links link
  join public.companies company on company.id = link.company_id
  left join public.proveedores provider
    on provider.id = link.proveedor_id and coalesce(provider.activo, true)
  where link.token_hash = lower(btrim(p_token_hash))
    and link.status = 'active'
    and (link.expires_at is null or link.expires_at > now())
    and coalesce(company.active, true)
    and (link.proveedor_id is null or provider.id is not null)
  limit 1;

  if v_result is null then raise exception 'provider_intake_link_not_available'; end if;
  return v_result;
end
$$;

create function public.create_provider_aware_intake_internal(
  p_token_hash text,
  p_submission jsonb,
  p_submission_fingerprint text,
  p_idempotency_key_hash text,
  p_client_ip_hash text default null,
  p_user_agent_hash text default null,
  p_captcha_provider text default 'turnstile',
  p_fingerprint_window_seconds integer default 86400
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.intake_links%rowtype;
  v_submission jsonb;
  v_confirmation text;
  v_result jsonb;
  v_intake_id uuid;
begin
  if p_submission is null or jsonb_typeof(p_submission) <> 'object' then
    raise exception 'provider_intake_invalid_submission';
  end if;

  select * into v_link
  from public.intake_links link
  where link.token_hash = lower(btrim(p_token_hash))
    and link.status = 'active'
    and (link.expires_at is null or link.expires_at > now())
  for update;
  if not found then raise exception 'provider_intake_link_not_available'; end if;

  v_confirmation := nullif(upper(btrim(p_submission ->> 'bank_data_confirmation')), '');
  v_submission := p_submission - 'bank_data_confirmation';

  if v_link.proveedor_id is null then
    if v_confirmation is not null then raise exception 'provider_intake_bank_confirmation_not_allowed'; end if;
  else
    if not exists (
      select 1 from public.proveedores provider
      where provider.id = v_link.proveedor_id and coalesce(provider.activo, true)
    ) then raise exception 'provider_intake_link_not_available'; end if;
    if v_confirmation not in ('MASTER_CONFIRMED', 'CHANGE_DECLARED') then
      raise exception 'provider_intake_bank_confirmation_required';
    end if;
    if v_confirmation = 'MASTER_CONFIRMED' then
      if exists (
        select 1 from unnest(array['bank_name','bank_account','bank_clabe','beneficiary_name']) field
        where nullif(btrim(v_submission ->> field), '') is not null
      ) then raise exception 'provider_intake_master_bank_values_not_allowed'; end if;
      v_submission := v_submission - array['bank_name','bank_account','bank_clabe','beneficiary_name'];
    else
      if nullif(btrim(v_submission ->> 'bank_name'), '') is null
         or nullif(btrim(v_submission ->> 'beneficiary_name'), '') is null
         or (
           nullif(btrim(v_submission ->> 'bank_account'), '') is null
           and nullif(btrim(v_submission ->> 'bank_clabe'), '') is null
         ) then raise exception 'provider_intake_bank_change_fields_required'; end if;
    end if;
  end if;

  v_result := public.create_provider_intake_internal(
    p_token_hash, v_submission, p_submission_fingerprint, p_idempotency_key_hash,
    p_client_ip_hash, p_user_agent_hash, p_captcha_provider, p_fingerprint_window_seconds
  );
  v_intake_id := (v_result ->> 'payment_intake_id')::uuid;

  update public.payment_intake intake
  set link_target_proveedor_id = v_link.proveedor_id,
      bank_data_confirmation = v_confirmation
  where intake.id = v_intake_id
    and intake.intake_link_id = v_link.id
    and (
      intake.link_target_proveedor_id is distinct from v_link.proveedor_id
      or intake.bank_data_confirmation is distinct from v_confirmation
    );

  return v_result;
end
$$;

create function public.get_provider_intake_link_target(p_payment_intake_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_intake public.payment_intake%rowtype;
  v_provider public.proveedores%rowtype;
  v_differences jsonb := '[]'::jsonb;
begin
  perform public.provider_intake_actor_context();
  select * into v_intake from public.payment_intake where id = p_payment_intake_id;
  if not found then raise exception 'provider_intake_not_found'; end if;
  perform public.provider_intake_assert_company_access(v_intake.company_id);

  if v_intake.link_target_proveedor_id is null then
    return jsonb_build_object(
      'targeted', false,
      'bank_data_confirmation', v_intake.bank_data_confirmation,
      'bank_review', 'LEGACY_OR_GENERIC'
    );
  end if;

  select * into v_provider from public.proveedores where id = v_intake.link_target_proveedor_id;
  if not found then raise exception 'provider_intake_provider_not_found'; end if;

  select coalesce(jsonb_agg(row_value order by ordinal), '[]'::jsonb)
  into v_differences
  from (values
    (1, case when public.normalize_provider_match_text(v_intake.provider_name)
      is distinct from public.normalize_provider_match_text(coalesce(nullif(v_provider.nombre_completo, ''), v_provider.alias))
      then jsonb_build_object('field','Nombre','declared',v_intake.provider_name,'master',coalesce(v_provider.nombre_completo,v_provider.alias)) end),
    (2, case when public.normalize_provider_match_text(v_intake.provider_rfc)
      is distinct from public.normalize_provider_match_text(v_provider.rfc)
      then jsonb_build_object('field','RFC','declared',public.provider_intake_mask_text(v_intake.provider_rfc),'master',public.provider_intake_mask_text(v_provider.rfc)) end),
    (3, case when lower(btrim(coalesce(v_intake.provider_email, '')))
      is distinct from lower(btrim(coalesce(v_provider.email, '')))
      then jsonb_build_object('field','Correo','declared',public.provider_intake_mask_text(v_intake.provider_email),'master',public.provider_intake_mask_text(v_provider.email)) end),
    (4, case when public.normalize_provider_match_digits(v_intake.provider_phone)
      is distinct from public.normalize_provider_match_digits(v_provider.telefono)
      then jsonb_build_object('field','Teléfono','declared',public.provider_intake_mask_value(v_intake.provider_phone),'master',public.provider_intake_mask_value(v_provider.telefono)) end)
  ) difference(ordinal, row_value)
  where row_value is not null;

  return jsonb_build_object(
    'targeted', true,
    'proveedor_id', v_provider.id,
    'alias', v_provider.alias,
    'legal_name', v_provider.nombre_completo,
    'rfc_masked', public.provider_intake_mask_text(v_provider.rfc),
    'active', coalesce(v_provider.activo, true),
    'bank', public.provider_intake_mask_text(v_provider.banco),
    'account_masked', public.provider_intake_mask_value(v_provider.cuenta_bancaria),
    'clabe_masked', public.provider_intake_mask_value(v_provider.clabe),
    'identity_differences', v_differences,
    'bank_data_confirmation', v_intake.bank_data_confirmation,
    'bank_review', case v_intake.bank_data_confirmation
      when 'MASTER_CONFIRMED' then 'NOT_REQUIRED'
      when 'CHANGE_DECLARED' then 'REQUIRED'
      else 'REQUIRED'
    end,
    'requires_explicit_match', v_intake.matched_proveedor_id is distinct from v_provider.id
  );
end
$$;

create or replace function public.provider_intake_banking_difference_state(p_payment_intake_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_intake public.payment_intake%rowtype;
  v_provider public.proveedores%rowtype;
  v_fields text[] := array[]::text[];
  v_resolution public.payment_intake_events%rowtype;
  v_resolution_valid boolean := false;
  v_provider_updated_at timestamptz;
  v_master_confirmed_for_target boolean := false;
  v_change_declared boolean := false;
begin
  select * into v_intake from public.payment_intake where id = p_payment_intake_id;
  if not found then raise exception 'provider_intake_not_found'; end if;

  if v_intake.matched_proveedor_id is null then
    return jsonb_build_object(
      'material_mismatch', false, 'difference_fields', '[]'::jsonb,
      'resolution_valid', false, 'resolution', null, 'provider_updated_at', null,
      'comparison', '[]'::jsonb, 'bank_data_confirmation', v_intake.bank_data_confirmation,
      'bank_review_required', v_intake.bank_data_confirmation = 'CHANGE_DECLARED'
    );
  end if;

  select * into v_provider from public.proveedores where id = v_intake.matched_proveedor_id;
  if not found then
    return jsonb_build_object(
      'material_mismatch', false, 'difference_fields', '[]'::jsonb,
      'resolution_valid', false, 'resolution', null, 'provider_updated_at', null,
      'comparison', '[]'::jsonb, 'bank_data_confirmation', v_intake.bank_data_confirmation,
      'bank_review_required', v_intake.bank_data_confirmation = 'CHANGE_DECLARED'
    );
  end if;

  v_provider_updated_at := coalesce(v_provider.updated_at, v_provider.created_at);
  v_master_confirmed_for_target := v_intake.bank_data_confirmation = 'MASTER_CONFIRMED'
    and v_intake.link_target_proveedor_id = v_provider.id;
  v_change_declared := v_intake.bank_data_confirmation = 'CHANGE_DECLARED';

  if not v_master_confirmed_for_target then
    if public.normalize_provider_match_text(v_intake.bank_name)
         is distinct from public.normalize_provider_match_text(v_provider.banco)
       and (nullif(btrim(v_intake.bank_name), '') is not null or nullif(btrim(v_provider.banco), '') is not null)
      then v_fields := array_append(v_fields, 'bank'); end if;
    if public.normalize_provider_match_digits(v_intake.bank_account)
         is distinct from public.normalize_provider_match_digits(v_provider.cuenta_bancaria)
       and (nullif(btrim(v_intake.bank_account), '') is not null or nullif(btrim(v_provider.cuenta_bancaria), '') is not null)
      then v_fields := array_append(v_fields, 'account'); end if;
    if public.normalize_provider_match_digits(v_intake.bank_clabe)
         is distinct from public.normalize_provider_match_digits(v_provider.clabe)
       and (nullif(btrim(v_intake.bank_clabe), '') is not null or nullif(btrim(v_provider.clabe), '') is not null)
      then v_fields := array_append(v_fields, 'clabe'); end if;
    if public.normalize_provider_match_text(v_intake.beneficiary_name)
         is distinct from public.normalize_provider_match_text(v_provider.beneficiary_name)
       and (nullif(btrim(v_intake.beneficiary_name), '') is not null or nullif(btrim(v_provider.beneficiary_name), '') is not null)
      then v_fields := array_append(v_fields, 'beneficiary'); end if;
  end if;
  if v_change_declared and cardinality(v_fields) = 0 then
    v_fields := array_append(v_fields, 'reported_change');
  end if;

  select event.* into v_resolution
  from public.payment_intake_events event
  where event.payment_intake_id = v_intake.id
    and event.event_type = 'banking_resolution'
    and event.metadata ->> 'decision' = 'use_current_master_data'
    and event.metadata ->> 'proveedor_id' = v_provider.id::text
  order by event.created_at desc, event.id desc limit 1;
  if found then
    begin
      v_resolution_valid :=
        (v_resolution.metadata ->> 'intake_updated_at')::timestamptz = v_intake.updated_at
        and (v_resolution.metadata ->> 'provider_updated_at')::timestamptz is not distinct from v_provider_updated_at;
    exception when others then v_resolution_valid := false;
    end;
  end if;

  return jsonb_build_object(
    'material_mismatch', cardinality(v_fields) > 0,
    'difference_fields', to_jsonb(v_fields),
    'resolution_valid', cardinality(v_fields) > 0 and v_resolution_valid,
    'resolution', case when not v_resolution_valid then null else jsonb_build_object(
      'decision', 'use_current_master_data',
      'actor_profile_id', v_resolution.actor_profile_id,
      'actor_type', v_resolution.actor_type,
      'created_at', v_resolution.created_at
    ) end,
    'provider_updated_at', v_provider_updated_at,
    'bank_data_confirmation', v_intake.bank_data_confirmation,
    'bank_review_required', v_change_declared or cardinality(v_fields) > 0,
    'comparison', jsonb_build_array(
      jsonb_build_object('field','Banco','code','bank','declared',case when v_master_confirmed_for_target then 'Confirmado vigente' else public.provider_intake_mask_text(v_intake.bank_name) end,'master',public.provider_intake_mask_text(v_provider.banco),'different','bank' = any(v_fields)),
      jsonb_build_object('field','Cuenta','code','account','declared',case when v_master_confirmed_for_target then 'Confirmada vigente' else public.provider_intake_mask_value(v_intake.bank_account) end,'master',public.provider_intake_mask_value(v_provider.cuenta_bancaria),'different','account' = any(v_fields)),
      jsonb_build_object('field','CLABE','code','clabe','declared',case when v_master_confirmed_for_target then 'Confirmada vigente' else public.provider_intake_mask_value(v_intake.bank_clabe) end,'master',public.provider_intake_mask_value(v_provider.clabe),'different','clabe' = any(v_fields)),
      jsonb_build_object('field','Beneficiario','code','beneficiary','declared',case when v_master_confirmed_for_target then 'Confirmado vigente' else public.provider_intake_mask_text(v_intake.beneficiary_name) end,'master',public.provider_intake_mask_text(v_provider.beneficiary_name),'different','beneficiary' = any(v_fields))
    )
  );
end
$$;

revoke all on function public.find_provider_intake_link_providers(uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.find_provider_intake_link_providers(uuid, text, integer) to authenticated;
revoke all on function public.get_provider_intake_link_scope(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_provider_intake_link_scope(uuid, uuid) to authenticated;
revoke all on function public.create_provider_intake_link_v2(uuid, uuid, text, integer, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.create_provider_intake_link_v2(uuid, uuid, text, integer, integer, integer) to authenticated;
revoke all on function public.regenerate_provider_intake_link_v2(uuid, boolean, integer) from public, anon, authenticated, service_role;
grant execute on function public.regenerate_provider_intake_link_v2(uuid, boolean, integer) to authenticated;
revoke all on function public.resolve_provider_aware_intake_link_internal(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_provider_aware_intake_link_internal(text) to service_role;
revoke all on function public.create_provider_aware_intake_internal(text, jsonb, text, text, text, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.create_provider_aware_intake_internal(text, jsonb, text, text, text, text, text, integer) to service_role;
revoke all on function public.get_provider_intake_link_target(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_provider_intake_link_target(uuid) to authenticated;
revoke all on function public.provider_intake_banking_difference_state(uuid) from public, anon, authenticated, service_role;

revoke execute on function public.create_provider_intake_link(uuid, text, integer, integer, integer) from authenticated;
revoke execute on function public.regenerate_provider_intake_link(uuid, boolean, integer) from authenticated;

comment on column public.intake_links.proveedor_id is
  'Optional server-side target provider. NULL preserves generic and legacy links.';
comment on column public.payment_intake.link_target_proveedor_id is
  'Immutable intake provenance copied from the validated link target; never an automatic master match.';
comment on column public.payment_intake.bank_data_confirmation is
  'Public provider signal: MASTER_CONFIRMED or CHANGE_DECLARED. It never copies or mutates master banking values.';
comment on function public.resolve_provider_aware_intake_link_internal(text) is
  'Service-only token resolution returning at most the snapshot for the provider bound to that exact token; bank identifiers stay masked.';
comment on function public.get_provider_intake_link_target(uuid) is
  'Authorized triage context for a directed link. The target remains only a priority candidate until Finance explicitly confirms matching.';
