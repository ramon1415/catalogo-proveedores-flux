-- Flux Operadora - Migracion 003c
-- Funciones: generate_payment_request_number, create_payment_request, decide_payment_request

CREATE OR REPLACE FUNCTION public.generate_payment_request_number(p_year integer DEFAULT (EXTRACT(year FROM now()))::integer)
 RETURNS text
 LANGUAGE plpgsql
AS $function$

declare

  v_next bigint;

begin

  v_next := nextval('public.payment_request_number_seq');



  return 'SOL-' || p_year::text || '-' || lpad(v_next::text, 4, '0');

end;

$function$;

CREATE OR REPLACE FUNCTION public.create_payment_request(p_proveedor_id uuid, p_company_id uuid, p_cost_center_id uuid, p_budget_category_id uuid, p_budget_month date, p_amount_requested numeric, p_currency text DEFAULT 'MXN'::text, p_exchange_rate numeric DEFAULT 1, p_description text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_requested_by uuid DEFAULT NULL::uuid, p_is_extraordinary_adjustment boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$

declare

  v_budget_month date;

  v_currency text;

  v_exchange_rate numeric;

  v_budget_amount numeric;

  v_budget_result jsonb;

  v_budget_decision text;

  v_budget_block_reason text;

  v_available_before numeric;

  v_available_after numeric;

  v_shortfall numeric;

  v_request_number text;

  v_payment_request_id uuid;

  v_year integer;

  v_concept text;

begin

  if p_proveedor_id is null then

    raise exception 'proveedor_id es obligatorio';

  end if;



  if not exists (select 1 from public.proveedores where id = p_proveedor_id) then

    raise exception 'El proveedor indicado no existe en public.proveedores';

  end if;



  if p_company_id is null or not exists (select 1 from public.companies where id = p_company_id) then

    raise exception 'La empresa indicada no existe';

  end if;



  if p_cost_center_id is null or not exists (select 1 from public.cost_centers where id = p_cost_center_id) then

    raise exception 'El centro de costo indicado no existe';

  end if;



  if p_budget_category_id is null or not exists (select 1 from public.budget_categories where id = p_budget_category_id) then

    raise exception 'La partida presupuestal indicada no existe';

  end if;



  if p_budget_month is null then

    raise exception 'budget_month es obligatorio';

  end if;



  if p_amount_requested is null or p_amount_requested <= 0 then

    raise exception 'amount_requested debe ser mayor a 0';

  end if;



  v_currency := upper(coalesce(nullif(trim(p_currency), ''), 'MXN'));

  v_exchange_rate := coalesce(p_exchange_rate, 1);



  if v_exchange_rate <= 0 then

    raise exception 'exchange_rate debe ser mayor a 0';

  end if;



  if p_requested_by is not null

     and not exists (select 1 from public.profiles where id = p_requested_by) then

    raise exception 'requested_by no existe en public.profiles';

  end if;



  v_budget_month := date_trunc('month', p_budget_month)::date;

  v_budget_amount := round(p_amount_requested * v_exchange_rate, 2);

  v_year := extract(year from v_budget_month)::integer;

  v_concept := coalesce(nullif(trim(p_description), ''), 'Solicitud de pago');



  v_budget_result := public.verify_budget_availability(

    p_company_id,

    p_cost_center_id,

    p_budget_category_id,

    v_budget_month,

    v_budget_amount,

    coalesce(p_is_extraordinary_adjustment, false)

  );



  v_budget_decision := coalesce(v_budget_result ->> 'status', 'bloqueado');



  if v_budget_decision not in ('aprobable', 'bloqueado') then

    v_budget_decision := 'bloqueado';

  end if;



  v_budget_block_reason := v_budget_result ->> 'motivo';

  v_available_before := nullif(v_budget_result ->> 'disponible_actual', '')::numeric;

  v_available_after := nullif(v_budget_result ->> 'disponible_despues', '')::numeric;

  v_shortfall := nullif(v_budget_result ->> 'faltante', '')::numeric;



  v_request_number := public.generate_payment_request_number(v_year);



  insert into public.payment_requests (

    provider_id,

    proveedor_id,

    company_id,

    cost_center_id,

    budget_category_id,

    budget_month,

    request_type,

    requested_by,

    amount_requested,

    currency,

    exchange_rate,

    requires_invoice,

    invoice_received,

    status,

    concept,

    description,

    notes,

    submitted_at,

    request_number,

    budget_decision,

    budget_block_reason,

    budget_available_before,

    budget_available_after,

    budget_shortfall,

    budget_checked_at,

    budget_result,

    is_extraordinary_adjustment,

    created_at,

    updated_at

  )

  values (

    null,

    p_proveedor_id,

    p_company_id,

    p_cost_center_id,

    p_budget_category_id,

    v_budget_month,

    'provider_payment'::payment_request_type,

    p_requested_by,

    p_amount_requested,

    v_currency,

    v_exchange_rate,

    false,

    false,

    'submitted'::payment_request_status,

    v_concept,

    p_description,

    p_notes,

    now(),

    v_request_number,

    v_budget_decision,

    v_budget_block_reason,

    v_available_before,

    v_available_after,

    v_shortfall,

    now(),

    v_budget_result,

    coalesce(p_is_extraordinary_adjustment, false),

    now(),

    now()

  )

  returning id into v_payment_request_id;



  return jsonb_build_object(

    'payment_request_id', v_payment_request_id,

    'request_number', v_request_number,

    'status', 'submitted',

    'budget_decision', v_budget_decision,

    'budget_block_reason', v_budget_block_reason,

    'budget_result', v_budget_result

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.decide_payment_request(p_payment_request_id uuid, p_actor_profile_id uuid, p_action text, p_comments text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_request public.payment_requests%rowtype;

  v_previous_status text;

  v_new_status text;

  v_role_id uuid;

  v_rule_id uuid;

  v_approval_level integer;

  v_is_exception boolean;

  v_clean_comments text;

begin

  v_clean_comments := nullif(btrim(coalesce(p_comments, '')), '');



  select *

  into v_request

  from public.payment_requests

  where id = p_payment_request_id

  for update;



  if not found then

    raise exception 'payment_request_not_found';

  end if;



  if not exists (

    select 1

    from public.profiles p

    where p.id = p_actor_profile_id

      and coalesce(p.active, true) = true

  ) then

    raise exception 'actor_profile_not_found';

  end if;



  if p_action not in (

    'approved',

    'rejected',

    'changes_requested',

    'exception_approved',

    'exception_rejected',

    'amount_change_requested',

    'category_change_requested',

    'budget_adjustment_requested'

  ) then

    raise exception 'invalid_action';

  end if;



  v_is_exception := (

    v_request.budget_decision = 'bloqueado'

    or coalesce(v_request.is_extraordinary_adjustment, false) = true

  );



  if p_action in (

    'exception_approved',

    'exception_rejected',

    'amount_change_requested',

    'category_change_requested',

    'budget_adjustment_requested'

  ) and v_clean_comments is null then

    raise exception 'comments_required_for_exception_action';

  end if;



  if p_action = 'changes_requested' and v_clean_comments is null then

    raise exception 'comments_required_for_changes_requested';

  end if;



  if not v_is_exception and p_action not in (

    'approved',

    'rejected',

    'changes_requested'

  ) then

    raise exception 'exception_action_not_allowed_for_approvable_request';

  end if;



  if v_is_exception and p_action = 'approved' then

    raise exception 'normal_approval_not_allowed_for_budget_exception';

  end if;



  if v_is_exception and p_action not in (

    'exception_approved',

    'exception_rejected',

    'amount_change_requested',

    'category_change_requested',

    'budget_adjustment_requested'

  ) then

    raise exception 'invalid_exception_action';

  end if;



  if not exists (

    select 1

    from public.user_roles ur

    where ur.profile_id = p_actor_profile_id

  ) then

    raise exception 'actor_has_no_role';

  end if;



  select

    ar.id,

    ar.role_id,

    ar.approval_level

  into

    v_rule_id,

    v_role_id,

    v_approval_level

  from public.approval_rules ar

  join public.user_roles ur

    on ur.role_id = ar.role_id

   and ur.profile_id = p_actor_profile_id

  where ar.active = true

    and (ar.company_id is null or ar.company_id = v_request.company_id)

    and (ar.cost_center_id is null or ar.cost_center_id = v_request.cost_center_id)

    and coalesce(v_request.amount_requested, 0) >= ar.amount_min

    and (ar.amount_max is null or coalesce(v_request.amount_requested, 0) <= ar.amount_max)

    and (

      (p_action in ('approved') and ar.can_approve = true)

      or (p_action in ('exception_approved') and ar.can_approve = true and ar.can_approve_exception = true)

      or (p_action in ('rejected', 'exception_rejected') and ar.can_reject = true)

      or (p_action in ('changes_requested', 'amount_change_requested', 'category_change_requested') and ar.can_request_changes = true)

      or (p_action = 'budget_adjustment_requested' and ar.can_request_budget_adjustment = true)

    )

  order by

    case when ar.company_id is not null then 0 else 1 end,

    case when ar.cost_center_id is not null then 0 else 1 end,

    ar.approval_level asc

  limit 1;



  if v_rule_id is null then

    if p_action = 'exception_approved' then

      raise exception 'actor_cannot_approve_exception';

    elsif p_action in ('approved') then

      raise exception 'actor_cannot_approve';

    elsif p_action in ('rejected', 'exception_rejected') then

      raise exception 'actor_cannot_reject';

    elsif p_action in ('changes_requested', 'amount_change_requested', 'category_change_requested') then

      raise exception 'actor_cannot_request_changes';

    elsif p_action = 'budget_adjustment_requested' then

      raise exception 'actor_cannot_request_budget_adjustment';

    else

      raise exception 'approval_rule_not_found';

    end if;

  end if;



  v_previous_status := v_request.status::text;



  v_new_status := case p_action

    when 'approved' then 'approved'

    when 'rejected' then 'rejected'

    when 'changes_requested' then 'changes_requested'

    when 'exception_approved' then 'approved'

    when 'exception_rejected' then 'rejected'

    when 'amount_change_requested' then 'changes_requested'

    when 'category_change_requested' then 'changes_requested'

    when 'budget_adjustment_requested' then 'changes_requested'

  end;



  insert into public.payment_request_approvals (

    payment_request_id,

    actor_profile_id,

    role_id,

    action,

    from_status,

    to_status,

    comments,

    approval_level,

    budget_decision_snapshot,

    budget_block_reason_snapshot,

    budget_result_snapshot

  )

  values (

    p_payment_request_id,

    p_actor_profile_id,

    v_role_id,

    p_action,

    v_previous_status,

    v_new_status,

    v_clean_comments,

    v_approval_level,

    v_request.budget_decision,

    v_request.budget_block_reason,

    v_request.budget_result

  );



  update public.payment_requests

  set

    status = v_new_status::public.payment_request_status,

    exception_status = case

      when p_action = 'exception_approved' then 'approved'

      when p_action = 'exception_rejected' then 'rejected'

      when p_action in (

        'amount_change_requested',

        'category_change_requested',

        'budget_adjustment_requested'

      ) then 'changes_requested'

      else exception_status

    end,

    exception_action = case

      when v_is_exception then p_action

      else exception_action

    end,

    exception_reason = case

      when v_is_exception then v_clean_comments

      else exception_reason

    end,

    exception_approved_by = case

      when p_action = 'exception_approved' then p_actor_profile_id

      else exception_approved_by

    end,

    exception_approved_at = case

      when p_action = 'exception_approved' then now()

      else exception_approved_at

    end,

    requires_budget_adjustment = case

      when p_action = 'budget_adjustment_requested' then true

      else requires_budget_adjustment

    end,

    operational_comments = coalesce(v_clean_comments, operational_comments),

    updated_at = now()

  where id = p_payment_request_id;



  return jsonb_build_object(

    'payment_request_id', p_payment_request_id,

    'previous_status', v_previous_status,

    'new_status', v_new_status,

    'action', p_action,

    'actor_profile_id', p_actor_profile_id,

    'budget_decision', v_request.budget_decision,

    'is_exception', v_is_exception,

    'message', 'decision_registered'

  );

end;

$function$;
