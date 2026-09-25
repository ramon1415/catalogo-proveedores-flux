begin;

-- FASE 3 (validación por partida) · solicitud multi-partida.  [PENDIENTE DE APLICAR]
--
-- Contexto: hoy create_payment_request valida el presupuesto de UNA sola partida
-- (payment_requests.budget_category_id) contra el monto/subtotal completo. Con
-- multi-partida (payment_request_distributions, FASE 1), esa validación queda
-- corta: valida la partida DOMINANTE contra el total, no cada línea contra el
-- disponible de SU partida. La captura y la detección client-side ya operan
-- (app/src/features/solicitudes/multipartida.ts + RequestModal), pero la
-- validación DURA correcta por línea debe vivir en el servidor.
--
-- Esta migración es ADITIVA y NO modifica create_payment_request: agrega una
-- función que valida el presupuesto de cada línea de distribución de una
-- solicitud, reutilizando verify_budget_availability (misma medición por
-- subtotal/mes que el resto del flujo). Deja el resultado listo para:
--   (a) que la app la llame post-creación como validación server-side confiable, o
--   (b) que un cambio posterior la invoque desde create_payment_request /
--       approval_batch_budget_validation para fijar budget_decision por reparto.
--
-- Retrocompatibilidad: una solicitud sin líneas devuelve status 'sin_distribucion'
-- (el caller sigue usando la validación de una sola partida vigente).

create or replace function public.verify_payment_request_distribution_budget(
  p_payment_request_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_request public.payment_requests%rowtype;
  v_line record;
  v_line_result jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_overall text := 'aprobable';
  v_count int := 0;
begin
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id;

  if not found then
    return jsonb_build_object('status', 'bloqueado', 'motivo', 'payment_request_not_found');
  end if;

  if v_request.company_id is null
     or v_request.cost_center_id is null
     or v_request.budget_month is null then
    return jsonb_build_object('status', 'bloqueado', 'motivo', 'budget_validation_data_missing');
  end if;

  for v_line in
    select id, budget_category_id, coalesce(cost_center_id, v_request.cost_center_id) as cost_center_id, amount
    from public.payment_request_distributions
    where payment_request_id = p_payment_request_id
    order by created_at asc
  loop
    v_count := v_count + 1;
    -- Cada línea valida su BASE (amount) contra el disponible de SU partida.
    v_line_result := public.verify_budget_availability(
      v_request.company_id,
      v_line.cost_center_id,
      v_line.budget_category_id,
      v_request.budget_month,
      v_line.amount,
      coalesce(v_request.is_extraordinary_adjustment, false)
    );
    if coalesce(v_line_result->>'status', 'bloqueado') = 'bloqueado' then
      v_overall := 'bloqueado';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'distribution_id', v_line.id,
      'budget_category_id', v_line.budget_category_id,
      'cost_center_id', v_line.cost_center_id,
      'amount', v_line.amount,
      'result', v_line_result
    ));
  end loop;

  if v_count = 0 then
    -- Sin líneas: retrocompat. El caller usa la validación de una sola partida.
    return jsonb_build_object('status', 'sin_distribucion', 'lineas', v_lines);
  end if;

  return jsonb_build_object('status', v_overall, 'lineas', v_lines);
end;
$function$;

revoke all on function public.verify_payment_request_distribution_budget(uuid) from public, anon;
grant execute on function public.verify_payment_request_distribution_budget(uuid) to authenticated;

commit;
