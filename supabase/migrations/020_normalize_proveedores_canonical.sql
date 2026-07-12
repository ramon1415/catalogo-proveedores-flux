-- Normaliza public.proveedores sin migrar ni sincronizar datos con public.providers.
-- La migracion aborta completa ante datos ambiguos o duplicados.

begin;

do $$
begin
  if to_regclass('public.proveedores') is null then
    raise exception '020_precheck: public.proveedores no existe';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'proveedores'
      and policyname not in (
        'Autenticados pueden leer proveedores',
        'Usuarios autenticados pueden crear proveedores',
        'Usuarios autenticados pueden editar proveedores',
        'proveedores_select_members',
        'proveedores_insert_members',
        'proveedores_update_managers'
      )
  ) then
    raise exception '020_precheck: existen policies no reconocidas en public.proveedores; revisar antes de reemplazar RLS';
  end if;
end
$$;

alter table public.proveedores
  add column if not exists persona_tipo text;

do $$
declare
  v_details text;
begin
  select string_agg(format('id=%s alias=%L', id, alias), '; ' order by id)
    into v_details
  from (
    select id, alias
    from public.proveedores
    where nullif(btrim(alias), '') is null
    order by id
    limit 25
  ) invalid_aliases;

  if v_details is not null then
    raise exception '020_precheck: existen aliases vacios; corregirlos antes de aplicar'
      using detail = v_details;
  end if;

  select string_agg(format('alias=%L count=%s', alias_key, duplicate_count), '; ' order by alias_key)
    into v_details
  from (
    select
      lower(regexp_replace(btrim(alias), '[[:space:]]+', ' ', 'g')) as alias_key,
      count(*) as duplicate_count
    from public.proveedores
    group by lower(regexp_replace(btrim(alias), '[[:space:]]+', ' ', 'g'))
    having count(*) > 1
    order by alias_key
    limit 25
  ) duplicate_aliases;

  if v_details is not null then
    raise exception '020_precheck: existen aliases duplicados despues de trim/casefold; no se modificaran automaticamente'
      using detail = v_details;
  end if;

  select string_agg(format('id=%s rfc=%L', id, rfc), '; ' order by id)
    into v_details
  from (
    select id, rfc
    from public.proveedores
    where nullif(btrim(rfc), '') is not null
      and upper(btrim(rfc)) !~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'
    order by id
    limit 25
  ) invalid_rfcs;

  if v_details is not null then
    raise exception '020_precheck: existen RFC con formato invalido'
      using detail = v_details,
            hint = 'Formato aceptado: 3 o 4 letras iniciales (incluye & y Ñ), 6 digitos de fecha y 3 caracteres de homoclave.';
  end if;

  select string_agg(format('rfc=%s count=%s', rfc_key, duplicate_count), '; ' order by rfc_key)
    into v_details
  from (
    select upper(btrim(rfc)) as rfc_key, count(*) as duplicate_count
    from public.proveedores
    where nullif(btrim(rfc), '') is not null
    group by upper(btrim(rfc))
    having count(*) > 1
    order by rfc_key
    limit 25
  ) duplicate_rfcs;

  if v_details is not null then
    raise exception '020_precheck: existen RFC duplicados despues de upper(trim(...)); no se fusionaran automaticamente'
      using detail = v_details;
  end if;

  select string_agg(format('id=%s clabe=%L', id, clabe), '; ' order by id)
    into v_details
  from (
    select id, clabe
    from public.proveedores
    where nullif(btrim(clabe), '') is not null
      and (
        clabe !~ '^[0-9[:space:]-]+$'
        or char_length(regexp_replace(clabe, '[[:space:]-]', '', 'g')) <> 18
      )
    order by id
    limit 25
  ) invalid_clabes;

  if v_details is not null then
    raise exception '020_precheck: existen CLABE ambiguas o invalidas; solo se permiten 18 digitos con espacios o guiones como separadores'
      using detail = v_details;
  end if;

  select string_agg(format('clabe=%s count=%s', clabe_key, duplicate_count), '; ' order by clabe_key)
    into v_details
  from (
    select
      regexp_replace(clabe, '[[:space:]-]', '', 'g') as clabe_key,
      count(*) as duplicate_count
    from public.proveedores
    where nullif(btrim(clabe), '') is not null
    group by regexp_replace(clabe, '[[:space:]-]', '', 'g')
    having count(*) > 1
    order by clabe_key
    limit 25
  ) duplicate_clabes;

  if v_details is not null then
    raise exception '020_precheck: existen CLABE duplicadas despues de normalizar separadores; no se corregiran automaticamente'
      using detail = v_details;
  end if;

  select string_agg(
           format('banco=%L cuenta=%L count=%s', bank_key, account_key, duplicate_count),
           '; ' order by bank_key, account_key
         )
    into v_details
  from (
    select
      lower(regexp_replace(btrim(banco), '[[:space:]]+', ' ', 'g')) as bank_key,
      lower(regexp_replace(btrim(cuenta_bancaria), '[[:space:]]+', ' ', 'g')) as account_key,
      count(*) as duplicate_count
    from public.proveedores
    where nullif(regexp_replace(coalesce(clabe, ''), '[[:space:]-]', '', 'g'), '') is null
      and nullif(btrim(banco), '') is not null
      and nullif(btrim(cuenta_bancaria), '') is not null
    group by
      lower(regexp_replace(btrim(banco), '[[:space:]]+', ' ', 'g')),
      lower(regexp_replace(btrim(cuenta_bancaria), '[[:space:]]+', ' ', 'g'))
    having count(*) > 1
    order by bank_key, account_key
    limit 25
  ) duplicate_accounts;

  if v_details is not null then
    raise exception '020_precheck: existen duplicados banco+cuenta sin CLABE; no se corregiran automaticamente'
      using detail = v_details;
  end if;

  select string_agg(format('id=%s persona_tipo=%L', id, persona_tipo), '; ' order by id)
    into v_details
  from (
    select id, persona_tipo
    from public.proveedores
    where nullif(btrim(persona_tipo), '') is not null
      and lower(regexp_replace(btrim(persona_tipo), '[[:space:]]+', ' ', 'g')) not in (
        'fisica', 'física', 'persona fisica', 'persona física', 'pf',
        'moral', 'persona moral', 'pm'
      )
    order by id
    limit 25
  ) invalid_person_types;

  if v_details is not null then
    raise exception '020_precheck: existen valores de persona_tipo que no pueden normalizarse de forma segura'
      using detail = v_details;
  end if;
end
$$;

update public.proveedores
set
  rfc = nullif(upper(btrim(coalesce(rfc, ''))), ''),
  clabe = nullif(regexp_replace(coalesce(clabe, ''), '[[:space:]-]', '', 'g'), ''),
  banco = nullif(regexp_replace(btrim(coalesce(banco, '')), '[[:space:]]+', ' ', 'g'), ''),
  cuenta_bancaria = nullif(regexp_replace(btrim(coalesce(cuenta_bancaria, '')), '[[:space:]]+', ' ', 'g'), ''),
  persona_tipo = case
    when nullif(btrim(persona_tipo), '') is null then null
    when lower(regexp_replace(btrim(persona_tipo), '[[:space:]]+', ' ', 'g')) in
      ('fisica', 'física', 'persona fisica', 'persona física', 'pf') then 'fisica'
    when lower(regexp_replace(btrim(persona_tipo), '[[:space:]]+', ' ', 'g')) in
      ('moral', 'persona moral', 'pm') then 'moral'
  end
where
  rfc is distinct from nullif(upper(btrim(coalesce(rfc, ''))), '')
  or clabe is distinct from nullif(regexp_replace(coalesce(clabe, ''), '[[:space:]-]', '', 'g'), '')
  or banco is distinct from nullif(regexp_replace(btrim(coalesce(banco, '')), '[[:space:]]+', ' ', 'g'), '')
  or cuenta_bancaria is distinct from nullif(regexp_replace(btrim(coalesce(cuenta_bancaria, '')), '[[:space:]]+', ' ', 'g'), '')
  or persona_tipo is distinct from case
    when nullif(btrim(persona_tipo), '') is null then null
    when lower(regexp_replace(btrim(persona_tipo), '[[:space:]]+', ' ', 'g')) in
      ('fisica', 'física', 'persona fisica', 'persona física', 'pf') then 'fisica'
    when lower(regexp_replace(btrim(persona_tipo), '[[:space:]]+', ' ', 'g')) in
      ('moral', 'persona moral', 'pm') then 'moral'
  end;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.proveedores'::regclass
      and conname = 'proveedores_rfc_format_check'
  ) then
    alter table public.proveedores
      add constraint proveedores_rfc_format_check
      check (rfc is null or rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.proveedores'::regclass
      and conname = 'proveedores_clabe_format_check'
  ) then
    alter table public.proveedores
      add constraint proveedores_clabe_format_check
      check (clabe is null or clabe ~ '^[0-9]{18}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.proveedores'::regclass
      and conname = 'proveedores_persona_tipo_check'
  ) then
    alter table public.proveedores
      add constraint proveedores_persona_tipo_check
      check (persona_tipo is null or persona_tipo in ('fisica', 'moral'));
  end if;
end
$$;

create unique index if not exists proveedores_alias_normalized_uidx
  on public.proveedores (
    lower(regexp_replace(btrim(alias), '[[:space:]]+', ' ', 'g'))
  );

create unique index if not exists proveedores_rfc_normalized_uidx
  on public.proveedores (upper(btrim(rfc)))
  where rfc is not null;

create unique index if not exists proveedores_clabe_normalized_uidx
  on public.proveedores (regexp_replace(clabe, '[[:space:]-]', '', 'g'))
  where clabe is not null;

create unique index if not exists proveedores_bank_account_normalized_uidx
  on public.proveedores (
    lower(regexp_replace(btrim(banco), '[[:space:]]+', ' ', 'g')),
    lower(regexp_replace(btrim(cuenta_bancaria), '[[:space:]]+', ' ', 'g'))
  )
  where clabe is null
    and nullif(btrim(banco), '') is not null
    and nullif(btrim(cuenta_bancaria), '') is not null;

create or replace function public.normalize_proveedores_canonical()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_alias_base text;
  v_alias_candidate text;
  v_alias_suffix text;
  v_persona_tipo text;
begin
  new.id := coalesce(new.id, gen_random_uuid());

  new.rfc := nullif(upper(btrim(coalesce(new.rfc, ''))), '');
  if new.rfc is not null
     and new.rfc !~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$' then
    raise exception 'rfc_invalido: use un RFC mexicano de 12 o 13 caracteres sin espacios ni guiones';
  end if;

  if nullif(btrim(coalesce(new.clabe, '')), '') is null then
    new.clabe := null;
  else
    if new.clabe !~ '^[0-9[:space:]-]+$' then
      raise exception 'clabe_invalida: solo se permiten digitos, espacios y guiones';
    end if;
    new.clabe := regexp_replace(new.clabe, '[[:space:]-]', '', 'g');
    if char_length(new.clabe) <> 18 then
      raise exception 'clabe_invalida: se requieren exactamente 18 digitos';
    end if;
  end if;

  new.banco := nullif(regexp_replace(btrim(coalesce(new.banco, '')), '[[:space:]]+', ' ', 'g'), '');
  new.cuenta_bancaria := nullif(
    regexp_replace(btrim(coalesce(new.cuenta_bancaria, '')), '[[:space:]]+', ' ', 'g'),
    ''
  );

  v_persona_tipo := lower(
    regexp_replace(btrim(coalesce(new.persona_tipo, '')), '[[:space:]]+', ' ', 'g')
  );
  new.persona_tipo := case
    when v_persona_tipo = '' then null
    when v_persona_tipo in ('fisica', 'física', 'persona fisica', 'persona física', 'pf') then 'fisica'
    when v_persona_tipo in ('moral', 'persona moral', 'pm') then 'moral'
    else null
  end;
  if v_persona_tipo <> '' and new.persona_tipo is null then
    raise exception 'persona_tipo_invalido: use fisica, moral o NULL';
  end if;

  if nullif(btrim(coalesce(new.alias, '')), '') is null then
    v_alias_base := coalesce(
      nullif(regexp_replace(btrim(coalesce(new.nombre_completo, '')), '[[:space:]]+', ' ', 'g'), ''),
      nullif(regexp_replace(btrim(coalesce(new.beneficiary_name, '')), '[[:space:]]+', ' ', 'g'), ''),
      'PROVEEDOR'
    );
    v_alias_candidate := left(v_alias_base, 120);

    if exists (
      select 1
      from public.proveedores p
      where lower(regexp_replace(btrim(p.alias), '[[:space:]]+', ' ', 'g')) =
            lower(regexp_replace(btrim(v_alias_candidate), '[[:space:]]+', ' ', 'g'))
        and p.id is distinct from new.id
    ) then
      v_alias_suffix := '-' || left(replace(new.id::text, '-', ''), 8);
      v_alias_candidate := left(v_alias_base, 120 - char_length(v_alias_suffix)) || v_alias_suffix;
    end if;

    new.alias := v_alias_candidate;
  else
    new.alias := regexp_replace(btrim(new.alias), '[[:space:]]+', ' ', 'g');
    if exists (
      select 1
      from public.proveedores p
      where lower(regexp_replace(btrim(p.alias), '[[:space:]]+', ' ', 'g')) =
            lower(regexp_replace(btrim(new.alias), '[[:space:]]+', ' ', 'g'))
        and p.id is distinct from new.id
    ) then
      raise exception 'alias_duplicado: el alias % ya pertenece a otro proveedor', new.alias
        using errcode = '23505';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.normalize_proveedores_canonical() from public, anon, authenticated;

drop trigger if exists normalize_proveedores_canonical_before_write on public.proveedores;
create trigger normalize_proveedores_canonical_before_write
  before insert or update of alias, nombre_completo, beneficiary_name, rfc, clabe, banco, cuenta_bancaria, persona_tipo
  on public.proveedores
  for each row
  execute function public.normalize_proveedores_canonical();

drop policy if exists "Autenticados pueden leer proveedores" on public.proveedores;
drop policy if exists "Usuarios autenticados pueden crear proveedores" on public.proveedores;
drop policy if exists "Usuarios autenticados pueden editar proveedores" on public.proveedores;
drop policy if exists proveedores_select_members on public.proveedores;
drop policy if exists proveedores_insert_members on public.proveedores;
drop policy if exists proveedores_update_managers on public.proveedores;

alter table public.proveedores enable row level security;

create policy proveedores_select_members
  on public.proveedores
  for select
  to authenticated
  using (public.current_user_has_role(public.flux_member_roles()));

create policy proveedores_insert_members
  on public.proveedores
  for insert
  to authenticated
  with check (public.current_user_has_role(public.flux_member_roles()));

create policy proveedores_update_managers
  on public.proveedores
  for update
  to authenticated
  using (public.current_user_has_role(public.flux_approver_roles()))
  with check (public.current_user_has_role(public.flux_approver_roles()));

revoke all on table public.proveedores from anon;
revoke delete, truncate, references, trigger on table public.proveedores from authenticated;
grant select, insert, update on table public.proveedores to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.proveedores'::regclass
      and attname = 'persona_tipo'
      and not attisdropped
  ) then
    raise exception '020_postcheck: no se creo persona_tipo';
  end if;

  if (select count(*) from pg_indexes
      where schemaname = 'public'
        and tablename = 'proveedores'
        and indexname in (
          'proveedores_alias_normalized_uidx',
          'proveedores_rfc_normalized_uidx',
          'proveedores_clabe_normalized_uidx',
          'proveedores_bank_account_normalized_uidx'
        )) <> 4 then
    raise exception '020_postcheck: faltan indices unicos de proveedores';
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public'
        and tablename = 'proveedores') <> 3 then
    raise exception '020_postcheck: public.proveedores debe conservar exactamente tres policies RLS';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'proveedores'
      and policyname not in (
        'proveedores_select_members',
        'proveedores_insert_members',
        'proveedores_update_managers'
      )
  ) then
    raise exception '020_postcheck: permanece una policy legacy o no reconocida en public.proveedores';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.proveedores'::regclass
      and tgname = 'normalize_proveedores_canonical_before_write'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception '020_postcheck: falta trigger de normalizacion de proveedores';
  end if;
end
$$;

comment on column public.proveedores.persona_tipo is
  'Tipo de persona fiscal: fisica, moral o NULL cuando no se ha clasificado.';
comment on function public.normalize_proveedores_canonical() is
  'Normaliza RFC, CLABE, banco, cuenta, alias faltante y persona_tipo antes de escribir public.proveedores.';

commit;
