-- Flux Operadora - Migracion 003e
-- Funciones: verify_cash_block, create_cash_fund, create_cash_reconciliation, submit_cash_reconciliation, review_cash_reconciliation

CREATE OR REPLACE FUNCTION public.verify_cash_block(p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_overdue_count integer := 0;

  v_total_pending numeric := 0;

  v_funds jsonb := '[]'::jsonb;

begin

  if p_profile_id is null then

    raise exception 'profile_required';

  end if;



  if not exists (

    select 1

    from public.profiles

    where id = p_profile_id

      and coalesce(active, true) = true

  ) then

    raise exception 'profile_not_found';

  end if;



  -- Marcar como blocked los fondos vencidos con saldo pendiente

  update public.cash_funds

  set status = 'blocked'

  where responsible_profile_id = p_profile_id

    and status in ('active', 'pending_receipt')

    and pending_amount > 0

    and due_date < current_date;



  select

    count(*),

    coalesce(sum(pending_amount), 0)

  into

    v_overdue_count,

    v_total_pending

  from public.cash_funds

  where responsible_profile_id = p_profile_id

    and status in ('active', 'pending_receipt', 'blocked', 'receipt_review')

    and pending_amount > 0

    and due_date < current_date;



  select coalesce(

    jsonb_agg(

      jsonb_build_object(

        'cash_fund_id', cf.id,

        'payment_request_id', cf.payment_request_id,

        'assigned_amount', cf.assigned_amount,

        'verified_amount', cf.verified_amount,

        'pending_amount', cf.pending_amount,

        'due_date', cf.due_date,

        'status', cf.status

      )

      order by cf.due_date asc

    ),

    '[]'::jsonb

  )

  into v_funds

  from public.cash_funds cf

  where cf.responsible_profile_id = p_profile_id

    and cf.status in ('active', 'pending_receipt', 'blocked', 'receipt_review')

    and cf.pending_amount > 0

    and cf.due_date < current_date;



  return jsonb_build_object(

    'blocked', v_overdue_count > 0,

    'overdue_count', v_overdue_count,

    'total_pending', v_total_pending,

    'funds', v_funds

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.create_cash_fund(p_payment_request_id uuid, p_responsible_profile_id uuid, p_due_date date, p_delivery_method text, p_delivered_by uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_request public.payment_requests%rowtype;

  v_fund_id uuid;

  v_delivery_method text;

begin

  if p_payment_request_id is null then

    raise exception 'payment_request_required';

  end if;



  if p_responsible_profile_id is null then

    raise exception 'responsible_profile_required';

  end if;



  if p_due_date is null then

    raise exception 'due_date_required';

  end if;



  v_delivery_method := lower(nullif(btrim(coalesce(p_delivery_method, '')), ''));



  if v_delivery_method not in ('cash', 'check') then

    raise exception 'invalid_delivery_method';

  end if;



  select *

  into v_request

  from public.payment_requests

  where id = p_payment_request_id

  for update;



  if not found then

    raise exception 'payment_request_not_found';

  end if;



  if v_request.status::text <> 'approved' then

    raise exception 'payment_request_must_be_approved';

  end if;



  if v_request.request_type::text not in ('cash', 'check', 'efectivo', 'cheque') then

    raise exception 'payment_request_must_be_cash_or_check';

  end if;



  if coalesce(v_request.amount_requested, 0) <= 0 then

    raise exception 'invalid_request_amount';

  end if;



  if not exists (

    select 1

    from public.profiles

    where id = p_responsible_profile_id

      and coalesce(active, true) = true

  ) then

    raise exception 'responsible_profile_not_found';

  end if;



  if p_delivered_by is not null and not exists (

    select 1

    from public.profiles

    where id = p_delivered_by

      and coalesce(active, true) = true

  ) then

    raise exception 'delivered_by_profile_not_found';

  end if;



  if exists (

    select 1

    from public.cash_funds

    where payment_request_id = p_payment_request_id

  ) then

    raise exception 'cash_fund_already_exists';

  end if;



  insert into public.cash_funds (

    company_id,

    payment_request_id,

    responsible_profile_id,

    assigned_amount,

    verified_amount,

    assignment_date,

    due_date,

    status,

    delivery_method,

    delivered_by,

    delivered_at,

    notes

  )

  values (

    v_request.company_id,

    p_payment_request_id,

    p_responsible_profile_id,

    v_request.amount_requested,

    0,

    current_date,

    p_due_date,

    'pending_receipt',

    v_delivery_method,

    p_delivered_by,

    case when p_delivered_by is not null then now() else null end,

    p_notes

  )

  returning id into v_fund_id;



  -- No marcar paid. El dinero saliÃ³, pero aÃºn falta comprobaciÃ³n.

  update public.payment_requests

  set

    operational_comments = concat_ws(

      E'\n',

      nullif(operational_comments, ''),

      'Fondo de ' || v_delivery_method || ' creado. Pendiente de comprobaciÃ³n.'

    ),

    updated_at = now()

  where id = p_payment_request_id;



  return jsonb_build_object(

    'message', 'cash_fund_created',

    'cash_fund_id', v_fund_id,

    'payment_request_id', p_payment_request_id,

    'responsible_profile_id', p_responsible_profile_id,

    'assigned_amount', v_request.amount_requested,

    'due_date', p_due_date,

    'delivery_method', v_delivery_method,

    'status', 'pending_receipt'

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.create_cash_reconciliation(p_cash_fund_id uuid, p_submitted_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_fund public.cash_funds%rowtype;

  v_reconciliation_id uuid;

begin

  if p_cash_fund_id is null then

    raise exception 'cash_fund_required';

  end if;



  if p_submitted_by is null then

    raise exception 'submitted_by_required';

  end if;



  select *

  into v_fund

  from public.cash_funds

  where id = p_cash_fund_id

  for update;



  if not found then

    raise exception 'cash_fund_not_found';

  end if;



  if v_fund.status in ('closed', 'cancelled', 'verified') then

    raise exception 'cash_fund_not_open_for_reconciliation';

  end if;



  if not exists (

    select 1

    from public.profiles

    where id = p_submitted_by

      and coalesce(active, true) = true

  ) then

    raise exception 'submitted_by_profile_not_found';

  end if;



  if p_submitted_by <> v_fund.responsible_profile_id

     and not public.current_user_has_role(array[

       'admin',

       'finance',

       'finanzas',

       'approver_2',

       'aprobador_2'

     ])

  then

    raise exception 'not_allowed_to_create_reconciliation';

  end if;



  if exists (

    select 1

    from public.cash_reconciliations

    where cash_fund_id = p_cash_fund_id

      and status in ('draft', 'submitted', 'correction_requested')

  ) then

    raise exception 'open_reconciliation_already_exists';

  end if;



  insert into public.cash_reconciliations (

    cash_fund_id,

    submitted_by,

    status

  )

  values (

    p_cash_fund_id,

    p_submitted_by,

    'draft'

  )

  returning id into v_reconciliation_id;



  return jsonb_build_object(

    'message', 'cash_reconciliation_created',

    'reconciliation_id', v_reconciliation_id,

    'cash_fund_id', p_cash_fund_id,

    'status', 'draft'

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.submit_cash_reconciliation(p_reconciliation_id uuid, p_returned_amount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_reconciliation public.cash_reconciliations%rowtype;

  v_fund public.cash_funds%rowtype;

  v_total_tickets numeric := 0;

  v_returned_amount numeric := 0;

  v_accounted_amount numeric := 0;

  v_difference numeric := 0;

begin

  if p_reconciliation_id is null then

    raise exception 'reconciliation_required';

  end if;



  v_returned_amount := coalesce(p_returned_amount, 0);



  if v_returned_amount < 0 then

    raise exception 'returned_amount_cannot_be_negative';

  end if;



  select *

  into v_reconciliation

  from public.cash_reconciliations

  where id = p_reconciliation_id

  for update;



  if not found then

    raise exception 'reconciliation_not_found';

  end if;



  if v_reconciliation.status not in ('draft', 'correction_requested') then

    raise exception 'only_draft_or_correction_can_be_submitted';

  end if;



  select *

  into v_fund

  from public.cash_funds

  where id = v_reconciliation.cash_fund_id

  for update;



  if not found then

    raise exception 'cash_fund_not_found';

  end if;



  select coalesce(sum(amount), 0)

  into v_total_tickets

  from public.cash_reconciliation_items

  where reconciliation_id = p_reconciliation_id

    and status = 'valid';



  v_accounted_amount := v_total_tickets + v_returned_amount;

  v_difference := v_fund.assigned_amount - v_accounted_amount;



  if v_total_tickets <= 0 and v_returned_amount <= 0 then

    raise exception 'reconciliation_has_no_amounts';

  end if;



  if v_accounted_amount > v_fund.assigned_amount then

    raise exception 'reconciliation_exceeds_assigned_amount';

  end if;



  update public.cash_reconciliations

  set

    total_tickets = v_total_tickets,

    returned_amount = v_returned_amount,

    difference_amount = v_difference,

    status = 'submitted'

  where id = p_reconciliation_id;



  update public.cash_funds

  set

    status = 'receipt_review'

  where id = v_fund.id;



  return jsonb_build_object(

    'message', 'cash_reconciliation_submitted',

    'reconciliation_id', p_reconciliation_id,

    'cash_fund_id', v_fund.id,

    'total_tickets', v_total_tickets,

    'returned_amount', v_returned_amount,

    'difference_amount', v_difference,

    'status', 'submitted'

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.review_cash_reconciliation(p_reconciliation_id uuid, p_reviewer_profile_id uuid, p_action text, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_reconciliation public.cash_reconciliations%rowtype;

  v_fund public.cash_funds%rowtype;

  v_action text;

  v_accounted_amount numeric := 0;

  v_new_fund_status text;

  v_can_review boolean := false;

begin

  if p_reconciliation_id is null then

    raise exception 'reconciliation_required';

  end if;



  if p_reviewer_profile_id is null then

    raise exception 'reviewer_profile_required';

  end if;



  v_action := lower(nullif(btrim(coalesce(p_action, '')), ''));



  if v_action not in ('approved', 'rejected', 'correction_requested') then

    raise exception 'invalid_review_action';

  end if;



  if v_action in ('rejected', 'correction_requested')

     and nullif(btrim(coalesce(p_comment, '')), '') is null

  then

    raise exception 'review_comment_required';

  end if;



  if not exists (

    select 1

    from public.profiles

    where id = p_reviewer_profile_id

      and coalesce(active, true) = true

  ) then

    raise exception 'reviewer_profile_not_found';

  end if;



  -- ValidaciÃ³n por profile_id recibido.

  -- Esto permite probar desde SQL Editor, donde auth.uid() suele ser NULL.

  select exists (

    select 1

    from public.user_roles ur

    join public.roles r on r.id = ur.role_id

    where ur.profile_id = p_reviewer_profile_id

      and lower(trim(r.name)) in (

        'admin',

        'finance',

        'finanzas',

        'approver_2',

        'aprobador_2'

      )

  )

  into v_can_review;



  if not v_can_review then

    raise exception 'not_allowed_to_review_reconciliation';

  end if;



  select *

  into v_reconciliation

  from public.cash_reconciliations

  where id = p_reconciliation_id

  for update;



  if not found then

    raise exception 'reconciliation_not_found';

  end if;



  if v_reconciliation.status <> 'submitted' then

    raise exception 'only_submitted_reconciliations_can_be_reviewed';

  end if;



  select *

  into v_fund

  from public.cash_funds

  where id = v_reconciliation.cash_fund_id

  for update;



  if not found then

    raise exception 'cash_fund_not_found';

  end if;



  update public.cash_reconciliations

  set

    status = v_action,

    reviewer_profile_id = p_reviewer_profile_id,

    reviewer_comment = p_comment,

    reviewed_at = now()

  where id = p_reconciliation_id;



  if v_action = 'approved' then

    v_accounted_amount := v_reconciliation.total_tickets + v_reconciliation.returned_amount;



    v_new_fund_status := case

      when v_accounted_amount >= v_fund.assigned_amount then 'closed'

      else 'pending_receipt'

    end;



    update public.cash_funds

    set

      verified_amount = least(v_accounted_amount, assigned_amount),

      status = v_new_fund_status

    where id = v_fund.id;



    update public.payment_requests

    set

      operational_comments = concat_ws(

        E'\n',

        nullif(operational_comments, ''),

        'ComprobaciÃ³n de efectivo aprobada. Fondo: ' || v_fund.id::text

      ),

      updated_at = now()

    where id = v_fund.payment_request_id;



    return jsonb_build_object(

      'message', 'cash_reconciliation_approved',

      'reconciliation_id', p_reconciliation_id,

      'cash_fund_id', v_fund.id,

      'fund_status', v_new_fund_status,

      'accounted_amount', v_accounted_amount,

      'pending_amount', greatest(v_fund.assigned_amount - v_accounted_amount, 0)

    );

  end if;



  if v_action in ('rejected', 'correction_requested') then

    update public.cash_funds

    set status = 'pending_receipt'

    where id = v_fund.id;



    update public.payment_requests

    set

      operational_comments = concat_ws(

        E'\n',

        nullif(operational_comments, ''),

        'ComprobaciÃ³n de efectivo requiere atenciÃ³n: ' || coalesce(p_comment, '')

      ),

      updated_at = now()

    where id = v_fund.payment_request_id;



    return jsonb_build_object(

      'message', case

        when v_action = 'rejected' then 'cash_reconciliation_rejected'

        else 'cash_reconciliation_correction_requested'

      end,

      'reconciliation_id', p_reconciliation_id,

      'cash_fund_id', v_fund.id,

      'fund_status', 'pending_receipt',

      'comment', p_comment

    );

  end if;



  raise exception 'unexpected_review_action';

end;

$function$;
