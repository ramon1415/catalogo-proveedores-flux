-- Flux Operadora - Migracion 003b
-- Funciones: verify_budget_availability

CREATE OR REPLACE FUNCTION public.verify_budget_availability(p_company_id uuid, p_cost_center_id uuid, p_budget_category_id uuid, p_budget_month date, p_amount numeric, p_is_extraordinary_adjustment boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$

declare

  v_budgeted numeric;

  v_available numeric;

  v_match boolean;

begin

  if p_amount is null or p_amount <= 0 then

    return jsonb_build_object(

      'status', 'bloqueado',

      'motivo', 'monto_invalido',

      'disponible_actual', 0,

      'disponible_despues', null,

      'faltante', coalesce(p_amount, 0)

    );

  end if;



  if p_is_extraordinary_adjustment then

    return jsonb_build_object(

      'status', 'bloqueado',

      'motivo', 'ajuste_extraordinario',

      'disponible_actual', 0,

      'disponible_despues', null,

      'faltante', p_amount

    );

  end if;



  select exists (

    select 1

    from public.company_cost_center_budget_categories rel

    where rel.active = true

      and rel.company_id = p_company_id

      and rel.cost_center_id = p_cost_center_id

      and rel.budget_category_id = p_budget_category_id

  ) into v_match;



  if not v_match then

    return jsonb_build_object(

      'status', 'bloqueado',

      'motivo', 'sin_match_presupuesto',

      'disponible_actual', 0,

      'disponible_despues', null,

      'faltante', p_amount

    );

  end if;



  select budgeted, available

  into v_budgeted, v_available

  from public.budget_availability

  where company_id = p_company_id

    and cost_center_id = p_cost_center_id

    and budget_category_id = p_budget_category_id

    and budget_month = date_trunc('month', p_budget_month)::date;



  if v_budgeted is null then

    return jsonb_build_object(

      'status', 'bloqueado',

      'motivo', 'partida_no_presupuestada',

      'disponible_actual', 0,

      'disponible_despues', null,

      'faltante', p_amount

    );

  end if;



  if v_available >= p_amount then

    return jsonb_build_object(

      'status', 'aprobable',

      'motivo', null,

      'disponible_actual', v_available,

      'disponible_despues', v_available - p_amount,

      'faltante', 0

    );

  end if;



  return jsonb_build_object(

    'status', 'bloqueado',

    'motivo', 'sin_disponible',

    'disponible_actual', v_available,

    'disponible_despues', v_available - p_amount,

    'faltante', p_amount - v_available

  );

end;

$function$;
