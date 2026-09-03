-- Pagos de terceros retenidos (FONACOT): la empresa dispersa dinero que ya
-- retuvo al trabajador, por lo que la solicitud sigue el flujo normal de
-- autorización/pago pero no consume una línea de presupuesto.

-- El flag del catálogo gobierna solicitudes nuevas. La copia en la solicitud
-- es un snapshot inmutable para que un cambio posterior de catálogo no altere
-- compromisos históricos ni una revalidación de aprobación.
alter table public.budget_categories
  add column if not exists no_presupuestal boolean not null default false;

alter table public.payment_requests
  add column if not exists no_presupuestal boolean not null default false;

comment on column public.budget_categories.no_presupuestal is
  'La partida es pass-through: requiere autorización, pero no una línea ni disponibilidad presupuestal.';
comment on column public.payment_requests.no_presupuestal is
  'Snapshot de la modalidad no presupuestal al crear o cambiar la partida de la solicitud.';

-- Núcleo con modalidad explícita. La asignación empresa + centro + partida se
-- valida antes del bypass: no_presupuestal nunca abre una partida global.
create or replace function public.verify_budget_availability(
  p_company_id uuid,
  p_cost_center_id uuid,
  p_budget_category_id uuid,
  p_budget_month date,
  p_amount numeric,
  p_is_extraordinary_adjustment boolean,
  p_no_presupuestal boolean
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
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
      'faltante', coalesce(p_amount, 0),
      'no_presupuestal', coalesce(p_no_presupuestal, false)
    );
  end if;

  if p_is_extraordinary_adjustment then
    return jsonb_build_object(
      'status', 'bloqueado',
      'motivo', 'ajuste_extraordinario',
      'disponible_actual', 0,
      'disponible_despues', null,
      'faltante', p_amount,
      'no_presupuestal', coalesce(p_no_presupuestal, false)
    );
  end if;

  select exists (
    select 1
    from public.company_cost_center_budget_categories relation
    where relation.active
      and relation.company_id = p_company_id
      and relation.cost_center_id = p_cost_center_id
      and relation.budget_category_id = p_budget_category_id
  ) into v_match;

  if not v_match then
    return jsonb_build_object(
      'status', 'bloqueado',
      'motivo', 'sin_match_presupuesto',
      'disponible_actual', 0,
      'disponible_despues', null,
      'faltante', p_amount,
      'no_presupuestal', coalesce(p_no_presupuestal, false)
    );
  end if;

  if coalesce(p_no_presupuestal, false) then
    return jsonb_build_object(
      'status', 'aprobable',
      'motivo', 'no_presupuestal',
      'disponible_actual', null,
      'disponible_despues', null,
      'faltante', 0,
      'no_presupuestal', true
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
      'faltante', p_amount,
      'no_presupuestal', false
    );
  end if;

  if v_available >= p_amount then
    return jsonb_build_object(
      'status', 'aprobable',
      'motivo', null,
      'disponible_actual', v_available,
      'disponible_despues', v_available - p_amount,
      'faltante', 0,
      'no_presupuestal', false
    );
  end if;

  return jsonb_build_object(
    'status', 'bloqueado',
    'motivo', 'sin_disponible',
    'disponible_actual', v_available,
    'disponible_despues', v_available - p_amount,
    'faltante', p_amount - v_available,
    'no_presupuestal', false
  );
end;
$function$;

revoke all on function public.verify_budget_availability(
  uuid, uuid, uuid, date, numeric, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.verify_budget_availability(
  uuid, uuid, uuid, date, numeric, boolean, boolean
) to anon, authenticated, service_role;

-- Firma histórica: conserva todos los callers actuales y resuelve el modo con
-- el catálogo. Los procesos que revalidan una solicitud usan la firma de siete
-- argumentos y pasan el snapshot de payment_requests.
create or replace function public.verify_budget_availability(
  p_company_id uuid,
  p_cost_center_id uuid,
  p_budget_category_id uuid,
  p_budget_month date,
  p_amount numeric,
  p_is_extraordinary_adjustment boolean default false
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_no_presupuestal boolean := false;
begin
  select category.no_presupuestal
    into v_no_presupuestal
  from public.budget_categories category
  where category.id = p_budget_category_id;

  return public.verify_budget_availability(
    p_company_id,
    p_cost_center_id,
    p_budget_category_id,
    p_budget_month,
    p_amount,
    p_is_extraordinary_adjustment,
    coalesce(v_no_presupuestal, false)
  );
end;
$function$;

-- Garantiza el snapshot también para inserciones/ediciones que no pasan por
-- create_payment_request. Una vez elegido, sólo cambia si cambia la partida.
create or replace function public.set_payment_request_no_presupuestal_snapshot()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_no_presupuestal boolean;
begin
  if tg_op = 'UPDATE'
     and new.budget_category_id is not distinct from old.budget_category_id then
    if new.no_presupuestal is distinct from old.no_presupuestal then
      raise exception 'no_presupuestal_snapshot_immutable';
    end if;
    return new;
  end if;

  select coalesce(category.no_presupuestal, false)
    into v_no_presupuestal
  from public.budget_categories category
  where category.id = new.budget_category_id;

  new.no_presupuestal := coalesce(v_no_presupuestal, false);
  if new.no_presupuestal then
    new.budget_decision := 'aprobable';
    new.budget_block_reason := 'no_presupuestal';
    new.budget_available_before := null;
    new.budget_available_after := null;
    new.budget_shortfall := 0;
    new.budget_checked_at := now();
    new.budget_result := jsonb_build_object(
      'status', 'aprobable',
      'motivo', 'no_presupuestal',
      'disponible_actual', null,
      'disponible_despues', null,
      'faltante', 0,
      'no_presupuestal', true
    );
  end if;
  return new;
end;
$function$;

revoke all on function public.set_payment_request_no_presupuestal_snapshot()
  from public, anon, authenticated;
grant execute on function public.set_payment_request_no_presupuestal_snapshot()
  to service_role;

drop trigger if exists zz_payment_request_no_presupuestal_snapshot
  on public.payment_requests;
create trigger zz_payment_request_no_presupuestal_snapshot
before insert or update of budget_category_id, no_presupuestal
on public.payment_requests
for each row
execute function public.set_payment_request_no_presupuestal_snapshot();

-- Las solicitudes pass-through no forman parte de committed/executed. La vista
-- mantiene security_invoker para que se apliquen las políticas RLS del caller.
create or replace view public.budget_availability as
select
  bl.company_id,
  bl.cost_center_id,
  bl.budget_category_id,
  bl.budget_month,
  bl.amount as budgeted,
  coalesce(sum((coalesce(pr.subtotal_amount, pr.amount_requested) * coalesce(pr.exchange_rate, 1::numeric)))
    filter (where ((pr.status)::text = any (array['submitted'::text, 'pending_approval'::text, 'approved'::text, 'finance_validation'::text, 'scheduled'::text, 'paid'::text]))
      and pr.budget_decision = 'aprobable'::text), 0::numeric) as committed,
  coalesce(sum((coalesce(pr.subtotal_amount, pr.amount_requested) * coalesce(pr.exchange_rate, 1::numeric)))
    filter (where ((pr.status)::text = 'paid'::text)
      and pr.budget_decision = 'aprobable'::text), 0::numeric) as executed,
  (bl.amount - coalesce(sum((coalesce(pr.subtotal_amount, pr.amount_requested) * coalesce(pr.exchange_rate, 1::numeric)))
    filter (where ((pr.status)::text = any (array['submitted'::text, 'pending_approval'::text, 'approved'::text, 'finance_validation'::text, 'scheduled'::text, 'paid'::text]))
      and pr.budget_decision = 'aprobable'::text), 0::numeric)) as available
from public.budget_lines bl
join public.budget_versions bv on bv.id = bl.budget_version_id and bv.active = true
left join public.payment_requests pr
  on pr.company_id = bl.company_id
  and pr.cost_center_id = bl.cost_center_id
  and pr.budget_category_id = bl.budget_category_id
  and pr.budget_month = bl.budget_month
  and not pr.no_presupuestal
  and (pr.status)::text <> all (array['rejected'::text, 'cancelled'::text])
group by bl.company_id, bl.cost_center_id, bl.budget_category_id, bl.budget_month, bl.amount;

alter view public.budget_availability set (security_invoker = true);

-- La revalidación del lote usa el snapshot. También conserva la medición por
-- subtotal introducida en #480, en vez de volver al total con impuestos.
create or replace function public.approval_batch_budget_validation(
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
  v_amount numeric;
  v_result jsonb;
  v_available numeric;
  v_adjusted_available numeric;
begin
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id;
  if not found then
    return jsonb_build_object('status', 'bloqueado', 'motivo', 'payment_request_not_found');
  end if;

  if v_request.company_id is null
     or v_request.cost_center_id is null
     or v_request.budget_category_id is null
     or v_request.budget_month is null then
    return jsonb_build_object(
      'status', 'bloqueado',
      'motivo', 'budget_validation_data_missing',
      'disponible_actual', 0,
      'disponible_despues', null,
      'faltante', coalesce(v_request.subtotal_amount, v_request.amount_requested, 0)
    );
  end if;

  v_amount := round(
    coalesce(v_request.subtotal_amount, v_request.amount_requested, 0)
      * coalesce(v_request.exchange_rate, 1),
    2
  );
  v_result := public.verify_budget_availability(
    v_request.company_id,
    v_request.cost_center_id,
    v_request.budget_category_id,
    v_request.budget_month,
    v_amount,
    coalesce(v_request.is_extraordinary_adjustment, false),
    v_request.no_presupuestal
  );

  if coalesce(v_result ->> 'status', 'bloqueado') = 'aprobable' then
    return v_result || jsonb_build_object(
      'validation_source',
      case
        when v_request.no_presupuestal then 'no_presupuestal_snapshot'
        else 'canonical_live'
      end
    );
  end if;

  -- La vista ya cuenta esta solicitud activa. Se suma sólo su compromiso para
  -- revalidarla sin eliminar los compromisos de las demás solicitudes.
  if v_result ->> 'motivo' = 'sin_disponible'
     and v_request.budget_decision = 'aprobable'
     and v_request.status::text in (
       'submitted', 'pending_approval', 'approved', 'finance_validation', 'scheduled', 'paid'
     ) then
    v_available := coalesce(nullif(v_result ->> 'disponible_actual', '')::numeric, 0);
    v_adjusted_available := v_available + v_amount;
    if v_adjusted_available >= v_amount then
      return jsonb_build_object(
        'status', 'aprobable',
        'motivo', null,
        'disponible_actual', v_adjusted_available,
        'disponible_despues', v_adjusted_available - v_amount,
        'faltante', 0,
        'no_presupuestal', false,
        'validation_source', 'canonical_live_excluding_current_request'
      );
    end if;
  end if;

  return v_result || jsonb_build_object('validation_source', 'canonical_live');
end;
$function$;

revoke all on function public.approval_batch_budget_validation(uuid)
  from public, anon, authenticated;
grant execute on function public.approval_batch_budget_validation(uuid)
  to service_role;

-- Catálogo inicial: sólo FONACOT. IMSS/INFONAVIT/AFORES e ISN siguen siendo
-- presupuestales hasta que Finanzas confirme explícitamente otra política.
insert into public.budget_categories (
  code, name, category, budget_type, active, no_presupuestal
)
values (
  'FONACOT', 'FONACOT', 'Recursos Humanos', null, true, true
)
on conflict (code) do update
set name = excluded.name,
    category = excluded.category,
    active = true,
    no_presupuestal = true,
    updated_at = now();

do $function$
declare
  v_company_id uuid;
  v_cost_center_id uuid;
  v_budget_category_id uuid;
begin
  select company.id, cost_center.id, category.id
    into strict v_company_id, v_cost_center_id, v_budget_category_id
  from public.companies company
  join public.company_cost_centers company_cost_center
    on company_cost_center.company_id = company.id
   and company_cost_center.active
  join public.cost_centers cost_center
    on cost_center.id = company_cost_center.cost_center_id
  cross join public.budget_categories category
  where company.active
    and cost_center.active
    and lower(btrim(company.name)) = 'operadora tlacatecpan'
    and lower(btrim(cost_center.name)) = 'rancho san juan tlacatecpan'
    and category.code = 'FONACOT';

  insert into public.company_cost_center_budget_categories (
    company_id, cost_center_id, budget_category_id, active
  ) values (
    v_company_id, v_cost_center_id, v_budget_category_id, true
  )
  on conflict (company_id, cost_center_id, budget_category_id)
  do update set active = true;
end;
$function$;
