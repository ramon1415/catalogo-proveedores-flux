-- Carril de aprobación automática — REBANADA 2 (LIVE, detrás de bandera apagada).
-- Depende de 20260909171500 (rebanada 1 / sombra).
--
-- Diseño confirmado con Carlos (86bau3rgw):
--  - Opción 1A: la auto-aprobación NO inserta fila humana en payment_request_approvals
--    (no falsea un aprobador y NO dispara el correo per-solicitud). Marca approved_at
--    y deja la bitácora en auto_approval_shadow_log (applied=true). El "quién" es
--    "sistema (auto-aprobación)". approved_by queda NULL: no existe un perfil sistema;
--    si más adelante se quiere poblarlo, se crea ese perfil (follow-up).
--  - Punto 2: se elimina la aprobación PER-SOLICITUD para finanzas dentro (u opción A,
--    fuera) de presupuesto: la solicitud pasa sola a 'approved' y sigue al CORTE igual
--    que hoy. La aprobación del corte (Dirección) se conserva intacta.
--  - Se activa por empresa con approval_batch_company_settings.auto_approve_enabled
--    (default false). Nada corre hasta que Carlos la encienda (Fersana primero).
--
-- Notificación: al no insertar payment_request_approvals, NO se manda correo
-- per-solicitud. El aviso a César es el DIGEST consolidado de la rebanada 3.

-- Aplica la auto-aprobación a UNA solicitud, si procede. Idempotente y defensiva.
create or replace function private.apply_auto_approval(p_payment_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r public.payment_requests%rowtype;
  v_flag boolean;
  v_eval jsonb;
begin
  select * into r from public.payment_requests where id = p_payment_request_id for update;
  if not found then return false; end if;
  -- Solo solicitudes normales recién enviadas; nómina y estados posteriores fuera.
  if r.request_type::text = 'nomina' or r.status::text <> 'submitted' then
    return false;
  end if;

  select coalesce(auto_approve_enabled, false) into v_flag
  from public.approval_batch_company_settings
  where company_id = r.company_id;
  if not coalesce(v_flag, false) then return false; end if;

  v_eval := private.evaluate_auto_approval(p_payment_request_id);
  if not coalesce((v_eval ->> 'would_auto_approve')::boolean, false) then
    return false;
  end if;

  -- 1A: solo status + approved_at; sin fila en payment_request_approvals (no correo,
  -- no aprobador humano falso). La solicitud sigue al corte como cualquier 'approved'.
  update public.payment_requests
     set status = 'approved'::public.payment_request_status,
         approved_at = now()
   where id = p_payment_request_id
     and status = 'submitted';

  return found;
end;
$function$;

revoke all on function private.apply_auto_approval(uuid) from public, anon, authenticated;

-- Se re-define el trigger de la rebanada 1 para que, además de registrar la sombra,
-- aplique la auto-aprobación cuando la bandera de la empresa esté encendida. Con la
-- bandera apagada el comportamiento es idéntico al de la rebanada 1 (solo sombra).
create or replace function private.auto_approval_shadow_capture()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_eval jsonb;
  v_flag boolean;
  v_would boolean;
  v_applied boolean := false;
  v_reason text;
begin
  -- Solo la TRANSICIÓN a 'submitted'.
  if tg_op = 'UPDATE' and old.status::text = 'submitted' then
    return new;
  end if;
  begin
    v_eval := private.evaluate_auto_approval(new.id);
    v_would := coalesce((v_eval ->> 'would_auto_approve')::boolean, false);
    v_reason := v_eval ->> 'reason';

    select coalesce(auto_approve_enabled, false) into v_flag
    from public.approval_batch_company_settings
    where company_id = new.company_id;
    v_flag := coalesce(v_flag, false);

    -- Bandera encendida + elegible → auto-aprobar. Si el apply falla, se degrada a
    -- no-aplicado (la solicitud queda 'submitted' para el camino humano); nunca rompe.
    if v_flag and v_would then
      begin
        v_applied := private.apply_auto_approval(new.id);
      exception when others then
        v_applied := false;
        v_reason := 'apply_failed';
      end;
    end if;

    insert into public.auto_approval_shadow_log(
      company_id, payment_request_id, request_number, requester_id,
      requester_is_finance, budget_decision, over_budget, would_auto_approve, applied, reason)
    values (
      new.company_id, new.id, new.request_number, new.requested_by,
      coalesce((v_eval ->> 'requester_is_finance')::boolean, false),
      v_eval ->> 'budget_decision',
      coalesce((v_eval ->> 'over_budget')::boolean, false),
      v_would, v_applied, v_reason
    );
  exception when others then
    null; -- la medición/auto-aprobación nunca bloquea el alta de la solicitud
  end;
  return new;
end;
$function$;

revoke all on function private.auto_approval_shadow_capture() from public, anon, authenticated;
