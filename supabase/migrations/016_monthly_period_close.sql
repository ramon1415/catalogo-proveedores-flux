-- 016_monthly_period_close.sql
-- Cierre de periodo real (snapshot mensual inmutable).
-- Agrega la columna snapshot a monthly_closures y dos RPC:
--   close_monthly_period  -> congela el payload del dashboard y marca el periodo cerrado
--   reopen_monthly_period -> reabre un periodo cerrado (solo sysadmin, motivo obligatorio)
-- No copia datos operativos ni activa n8n. Aplicar primero en DEV, luego en PROD con autorizacion.

-- 1) Columna de snapshot congelado (el dashboard_export_payload al momento del cierre)
alter table public.monthly_closures
  add column if not exists snapshot jsonb;

-- 2) Cerrar periodo: valida bloqueos, congela el payload, escribe el cierre. Idempotente.
create or replace function public.close_monthly_period(p_period_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_period_key text := public.dashboard_period_key(p_period_key);
  v_year integer;
  v_month integer;
  v_checklist jsonb;
  v_payload jsonb;
  v_id uuid;
begin
  -- Permiso: finanzas / direccion (mismo tier que aprueba)
  if not public.current_user_has_role(public.flux_approver_roles()) then
    raise exception 'not_allowed_to_close_period';
  end if;

  if v_period_key is null or trim(v_period_key) = '' then
    raise exception 'period_key_required';
  end if;

  v_year  := split_part(v_period_key, '-', 1)::integer;
  v_month := split_part(v_period_key, '-', 2)::integer;

  -- Idempotencia: no re-cerrar un periodo ya cerrado
  if exists (
    select 1 from public.monthly_closures
    where period_key = v_period_key and status = 'closed'
  ) then
    raise exception 'period_already_closed';
  end if;

  -- Validar que no haya bloqueos en el checklist
  v_checklist := public.dashboard_closure_checklist(v_period_key);
  if not coalesce((v_checklist->>'can_close')::boolean, false) then
    raise exception 'closure_blocked';
  end if;

  -- Congelar el estado real del periodo
  v_payload := public.dashboard_export_payload(v_period_key);

  insert into public.monthly_closures
    (period_key, year, month, status, closed_by, closed_at,
     checklist, snapshot, created_by, created_at, updated_at)
  values
    (v_period_key, v_year, v_month, 'closed', auth.uid(), now(),
     v_checklist, v_payload, auth.uid(), now(), now())
  on conflict (period_key) do update
    set status    = 'closed',
        closed_by = auth.uid(),
        closed_at = now(),
        checklist = excluded.checklist,
        snapshot  = excluded.snapshot,
        updated_at = now()
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'period_key', v_period_key,
    'status', 'closed',
    'closed_at', now()
  );
end;
$fn$;

-- 3) Reabrir periodo: solo sysadmin, con motivo. Descongela (snapshot -> null) y vuelve a calculo en vivo.
create or replace function public.reopen_monthly_period(p_period_key text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_period_key text := public.dashboard_period_key(p_period_key);
  v_id uuid;
begin
  -- Permiso mas estricto que cerrar
  if not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'not_allowed_to_reopen_period';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'reason_required';
  end if;

  update public.monthly_closures
    set status   = 'reopened',
        snapshot = null,
        notes    = trim(both E'\n' from
                     coalesce(notes, '') || E'\n' ||
                     to_char(now(), 'YYYY-MM-DD HH24:MI') || ' reabierto: ' || p_reason),
        updated_at = now()
  where period_key = v_period_key
    and status = 'closed'
  returning id into v_id;

  if v_id is null then
    raise exception 'period_not_closed';
  end if;

  return jsonb_build_object(
    'id', v_id,
    'period_key', v_period_key,
    'status', 'reopened'
  );
end;
$fn$;

grant execute on function public.close_monthly_period(text)         to authenticated;
grant execute on function public.reopen_monthly_period(text, text)  to authenticated;
