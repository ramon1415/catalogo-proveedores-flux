-- Cola de revisión de cuentas contables (export CONTPAQ): permite que Finanzas
-- CONFIRME la cuenta contable de un proveedor desde el paso de export, sembrando
-- la capa autoritativa provider_account_mappings.
--
-- Se usa un RPC SECURITY DEFINER en lugar de ampliar la RLS porque el confirm
-- desde el export debe fijar SOLO contpaq_account_code sin pisar el
-- contpaq_provider_id (tercero) que ya haya capturado la sección Proveedores
-- del tab Mapeo. Un upsert plano con onConflict reemplazaría toda la fila.
--
-- La RLS de provider_account_mappings ya restringe escritura al rol 'finance'
-- (via contpaq_mapper_company_access); aquí se reusa el MISMO gate para no
-- ampliar la superficie de permisos.
create or replace function public.confirm_provider_account(
  p_company_id uuid,
  p_proveedor_id uuid,
  p_account_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_account_code, ''), '[^0-9A-Za-z]', '', 'g'));
begin
  -- Mismo gate que la RLS de la tabla: solo Finanzas de la empresa.
  if not public.contpaq_mapper_company_access(p_company_id) then
    raise exception using errcode = '42501', message = 'contpaq_mapper_company_access_denied';
  end if;

  if p_proveedor_id is null then
    raise exception using errcode = '23514', message = 'proveedor_id_required';
  end if;

  if coalesce(char_length(v_code), 0) = 0 then
    raise exception using errcode = '23514', message = 'account_code_required';
  end if;

  -- La cuenta debe existir como cuenta de DETALLE en el catálogo de la empresa:
  -- confirmar una cuenta inexistente rompería el export aguas abajo.
  if not exists (
    select 1 from public.contpaq_accounts a
    where a.company_id = p_company_id
      and a.code = v_code
      and a.is_detail
  ) then
    raise exception using errcode = '23503',
      message = 'contpaq_account_not_found_or_not_detail: ' || v_code;
  end if;

  -- Upsert que fija SOLO la cuenta; preserva contpaq_provider_id existente.
  insert into public.provider_account_mappings (
    company_id, proveedor_id, contpaq_account_code, updated_at
  )
  values (p_company_id, p_proveedor_id, v_code, now())
  on conflict (company_id, proveedor_id)
  do update set
    contpaq_account_code = excluded.contpaq_account_code,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'proveedor_id', p_proveedor_id,
    'contpaq_account_code', v_code
  );
end;
$$;

revoke all on function public.confirm_provider_account(uuid, uuid, text) from public, anon;
grant execute on function public.confirm_provider_account(uuid, uuid, text) to authenticated, service_role;
