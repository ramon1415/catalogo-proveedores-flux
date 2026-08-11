-- Flux Operadora - Migracion 003f
-- Funciones: generate_maintenance_fees_for_period, register_maintenance_fee_payment, create_incident_charge, resolve_invoice_receiver, create_invoice_record, mark_invoice_paid, close_incident_charge

CREATE OR REPLACE FUNCTION public.generate_maintenance_fees_for_period(p_billing_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_period public.billing_periods%rowtype;

  v_active_members integer;

  v_factor_sum numeric;

  v_generated integer := 0;

begin

  if p_billing_period_id is null then

    raise exception 'billing_period_required';

  end if;



  select *

  into v_period

  from public.billing_periods

  where id = p_billing_period_id;



  if not found then

    raise exception 'billing_period_not_found';

  end if;



  if v_period.status <> 'open' then

    raise exception 'billing_period_not_open';

  end if;



  if v_period.total_budget is null then

    raise exception 'billing_period_total_budget_required';

  end if;



  select count(*), coalesce(sum(fee_factor), 0)

  into v_active_members, v_factor_sum

  from public.members

  where active = true;



  if v_active_members = 0 or v_factor_sum <= 0 then

    raise exception 'no_active_members';

  end if;



  with inserted as (

    insert into public.maintenance_fee_charges (

      member_id,

      billing_period_id,

      expected_amount,

      paid_amount,

      status

    )

    select

      m.id,

      v_period.id,

      round((v_period.total_budget * m.fee_factor / v_factor_sum)::numeric, 2),

      0,

      'pending'

    from public.members m

    where m.active = true

    on conflict (member_id, billing_period_id) do nothing

    returning id

  )

  select count(*)

  into v_generated

  from inserted;



  return jsonb_build_object(

    'message', 'maintenance_fees_generated',

    'billing_period_id', v_period.id,

    'period_name', v_period.name,

    'charges_generated', v_generated,

    'total_budget', v_period.total_budget,

    'active_members', v_active_members

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.register_maintenance_fee_payment(p_charge_id uuid, p_amount numeric, p_payment_date date, p_bank_reference text DEFAULT NULL::text, p_payment_method text DEFAULT 'transfer'::text, p_registered_by uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_charge public.maintenance_fee_charges%rowtype;

  v_payment_id uuid;

  v_total_paid numeric;

  v_new_status text;

begin

  if p_charge_id is null then

    raise exception 'charge_required';

  end if;



  if p_amount is null or p_amount <= 0 then

    raise exception 'invalid_payment_amount';

  end if;



  if p_payment_date is null then

    raise exception 'payment_date_required';

  end if;



  if p_payment_method is not null

     and p_payment_method not in ('transfer', 'cash', 'check', 'card', 'other') then

    raise exception 'invalid_payment_method';

  end if;



  select *

  into v_charge

  from public.maintenance_fee_charges

  where id = p_charge_id

  for update;



  if not found then

    raise exception 'charge_not_found';

  end if;



  if v_charge.status = 'cancelled' then

    raise exception 'charge_cancelled';

  end if;



  insert into public.maintenance_fee_payments (

    charge_id,

    member_id,

    billing_period_id,

    amount_paid,

    payment_date,

    bank_reference,

    payment_method,

    invoice_id,

    registered_by,

    notes

  )

  values (

    v_charge.id,

    v_charge.member_id,

    v_charge.billing_period_id,

    p_amount,

    p_payment_date,

    p_bank_reference,

    coalesce(p_payment_method, 'transfer'),

    v_charge.invoice_id,

    p_registered_by,

    p_notes

  )

  returning id into v_payment_id;



  select coalesce(sum(amount_paid), 0)

  into v_total_paid

  from public.maintenance_fee_payments

  where charge_id = v_charge.id;



  v_new_status :=

    case

      when v_total_paid >= v_charge.expected_amount then 'paid'

      when v_total_paid > 0 then 'partial'

      else 'pending'

    end;



  update public.maintenance_fee_charges

  set

    paid_amount = v_total_paid,

    status = v_new_status,

    updated_at = now()

  where id = v_charge.id;



  return jsonb_build_object(

    'message', 'maintenance_fee_payment_registered',

    'payment_id', v_payment_id,

    'charge_id', v_charge.id,

    'member_id', v_charge.member_id,

    'billing_period_id', v_charge.billing_period_id,

    'total_paid', v_total_paid,

    'expected_amount', v_charge.expected_amount,

    'pending_amount', v_charge.expected_amount - v_total_paid,

    'status', v_new_status

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.create_incident_charge(p_member_id uuid DEFAULT NULL::uuid, p_external_name text DEFAULT NULL::text, p_external_rfc text DEFAULT NULL::text, p_referred_by_member_id uuid DEFAULT NULL::uuid, p_company_id uuid DEFAULT NULL::uuid, p_cost_center_id uuid DEFAULT NULL::uuid, p_budget_category_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_incident_date date DEFAULT NULL::date, p_registered_by uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_member public.members%rowtype;

  v_referred_member public.members%rowtype;

  v_incident_id uuid;

  v_receiver_type text;

  v_receiver_name text;

begin

  if p_member_id is null and nullif(trim(coalesce(p_external_name, '')), '') is null then

    raise exception 'incident_receiver_required';

  end if;



  if p_member_id is not null and nullif(trim(coalesce(p_external_name, '')), '') is not null then

    raise exception 'incident_receiver_must_be_member_or_external';

  end if;



  if nullif(trim(coalesce(p_description, '')), '') is null then

    raise exception 'description_required';

  end if;



  if p_amount is null or p_amount <= 0 then

    raise exception 'invalid_incident_amount';

  end if;



  if p_incident_date is null then

    raise exception 'incident_date_required';

  end if;



  if p_member_id is not null then

    select *

    into v_member

    from public.members

    where id = p_member_id;



    if not found then

      raise exception 'member_not_found';

    end if;



    v_receiver_type := 'member';

    v_receiver_name := v_member.full_name;

  else

    v_receiver_type := 'external';

    v_receiver_name := trim(p_external_name);

  end if;



  if p_referred_by_member_id is not null then

    select *

    into v_referred_member

    from public.members

    where id = p_referred_by_member_id;



    if not found then

      raise exception 'referred_member_not_found';

    end if;

  end if;



  insert into public.incident_charges (

    member_id,

    external_name,

    external_rfc,

    referred_by_member_id,

    company_id,

    cost_center_id,

    budget_category_id,

    description,

    amount,

    incident_date,

    status,

    registered_by,

    notes

  )

  values (

    p_member_id,

    nullif(trim(coalesce(p_external_name, '')), ''),

    nullif(trim(coalesce(p_external_rfc, '')), ''),

    p_referred_by_member_id,

    p_company_id,

    p_cost_center_id,

    p_budget_category_id,

    trim(p_description),

    p_amount,

    p_incident_date,

    'open',

    p_registered_by,

    p_notes

  )

  returning id into v_incident_id;



  return jsonb_build_object(

    'message', 'incident_charge_created',

    'incident_charge_id', v_incident_id,

    'receiver_type', v_receiver_type,

    'receiver_name', v_receiver_name,

    'amount', p_amount,

    'status', 'open'

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.resolve_invoice_receiver(p_incident_charge_id uuid DEFAULT NULL::uuid, p_charge_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_charge public.maintenance_fee_charges%rowtype;

  v_incident public.incident_charges%rowtype;

  v_member public.members%rowtype;

begin

  if p_charge_id is null and p_incident_charge_id is null then

    raise exception 'invoice_reference_required';

  end if;



  if p_charge_id is not null and p_incident_charge_id is not null then

    raise exception 'invoice_reference_must_be_unique';

  end if;



  if p_charge_id is not null then

    select *

    into v_charge

    from public.maintenance_fee_charges

    where id = p_charge_id;



    if not found then

      raise exception 'charge_not_found';

    end if;



    select *

    into v_member

    from public.members

    where id = v_charge.member_id;



    if not found then

      raise exception 'receiver_not_found';

    end if;



    return jsonb_build_object(

      'receiver_type', 'member',

      'name', v_member.full_name,

      'rfc', v_member.rfc,

      'member_id', v_member.id,

      'external_name', null,

      'reference_type', 'maintenance_fee',

      'reference_id', v_charge.id

    );

  end if;



  select *

  into v_incident

  from public.incident_charges

  where id = p_incident_charge_id;



  if not found then

    raise exception 'incident_charge_not_found';

  end if;



  if v_incident.member_id is not null then

    select *

    into v_member

    from public.members

    where id = v_incident.member_id;



    if not found then

      raise exception 'receiver_not_found';

    end if;



    return jsonb_build_object(

      'receiver_type', 'member',

      'name', v_member.full_name,

      'rfc', v_member.rfc,

      'member_id', v_member.id,

      'external_name', null,

      'reference_type', 'incident',

      'reference_id', v_incident.id

    );

  end if;



  if nullif(trim(coalesce(v_incident.external_name, '')), '') is null then

    raise exception 'receiver_not_found';

  end if;



  return jsonb_build_object(

    'receiver_type', 'external',

    'name', v_incident.external_name,

    'rfc', v_incident.external_rfc,

    'member_id', null,

    'external_name', v_incident.external_name,

    'reference_type', 'incident',

    'reference_id', v_incident.id

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.create_invoice_record(p_invoice_type text, p_reference_id uuid, p_fiscal_uuid text DEFAULT NULL::text, p_series_folio text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric, p_issue_date date DEFAULT NULL::date, p_storage_path_xml text DEFAULT NULL::text, p_storage_path_pdf text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_receiver jsonb;

  v_charge public.maintenance_fee_charges%rowtype;

  v_incident public.incident_charges%rowtype;

  v_invoice_id uuid;

begin

  if p_invoice_type not in ('maintenance_fee', 'incident') then

    raise exception 'invalid_invoice_type';

  end if;



  if p_reference_id is null then

    raise exception 'invoice_reference_required';

  end if;



  if p_amount is null or p_amount < 0 then

    raise exception 'invalid_invoice_amount';

  end if;



  if p_issue_date is null then

    raise exception 'issue_date_required';

  end if;



  if p_invoice_type = 'maintenance_fee' then

    select *

    into v_charge

    from public.maintenance_fee_charges

    where id = p_reference_id

    for update;



    if not found then

      raise exception 'charge_not_found';

    end if;



    v_receiver := public.resolve_invoice_receiver(

      p_charge_id => v_charge.id,

      p_incident_charge_id => null

    );



    insert into public.invoices (

      invoice_type,

      member_id,

      external_name,

      receiver_rfc,

      charge_id,

      incident_charge_id,

      fiscal_uuid,

      series_folio,

      amount,

      issue_date,

      status,

      storage_path_xml,

      storage_path_pdf

    )

    values (

      'maintenance_fee',

      (v_receiver ->> 'member_id')::uuid,

      null,

      v_receiver ->> 'rfc',

      v_charge.id,

      null,

      p_fiscal_uuid,

      p_series_folio,

      p_amount,

      p_issue_date,

      'issued',

      p_storage_path_xml,

      p_storage_path_pdf

    )

    returning id into v_invoice_id;



    update public.maintenance_fee_charges

    set invoice_id = v_invoice_id,

        updated_at = now()

    where id = v_charge.id;



  else

    select *

    into v_incident

    from public.incident_charges

    where id = p_reference_id

    for update;



    if not found then

      raise exception 'incident_charge_not_found';

    end if;



    v_receiver := public.resolve_invoice_receiver(

      p_charge_id => null,

      p_incident_charge_id => v_incident.id

    );



    insert into public.invoices (

      invoice_type,

      member_id,

      external_name,

      receiver_rfc,

      charge_id,

      incident_charge_id,

      fiscal_uuid,

      series_folio,

      amount,

      issue_date,

      status,

      storage_path_xml,

      storage_path_pdf

    )

    values (

      'incident',

      nullif(v_receiver ->> 'member_id', '')::uuid,

      v_receiver ->> 'external_name',

      v_receiver ->> 'rfc',

      null,

      v_incident.id,

      p_fiscal_uuid,

      p_series_folio,

      p_amount,

      p_issue_date,

      'issued',

      p_storage_path_xml,

      p_storage_path_pdf

    )

    returning id into v_invoice_id;



    update public.incident_charges

    set invoice_id = v_invoice_id,

        status = 'invoiced',

        updated_at = now()

    where id = v_incident.id;

  end if;



  return jsonb_build_object(

    'message', 'invoice_record_created',

    'invoice_id', v_invoice_id,

    'invoice_type', p_invoice_type,

    'reference_id', p_reference_id,

    'status', 'issued',

    'amount', p_amount

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.mark_invoice_paid(p_invoice_id uuid, p_payment_date date, p_bank_reference text DEFAULT NULL::text, p_payment_method text DEFAULT 'transfer'::text, p_registered_by uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_invoice public.invoices%rowtype;

  v_payment_result jsonb;

begin

  if p_invoice_id is null then

    raise exception 'invoice_required';

  end if;



  if p_payment_date is null then

    raise exception 'payment_date_required';

  end if;



  select *

  into v_invoice

  from public.invoices

  where id = p_invoice_id

  for update;



  if not found then

    raise exception 'invoice_not_found';

  end if;



  if v_invoice.status = 'cancelled' then

    raise exception 'invoice_cancelled';

  end if;



  if v_invoice.status = 'paid' then

    raise exception 'invoice_already_paid';

  end if;



  if v_invoice.invoice_type = 'maintenance_fee' then

    if v_invoice.charge_id is null then

      raise exception 'invoice_missing_charge';

    end if;



    v_payment_result := public.register_maintenance_fee_payment(

      p_charge_id => v_invoice.charge_id,

      p_amount => v_invoice.amount,

      p_payment_date => p_payment_date,

      p_bank_reference => p_bank_reference,

      p_payment_method => p_payment_method,

      p_registered_by => p_registered_by,

      p_notes => p_notes

    );



    update public.invoices

    set status = 'paid',

        payment_date = p_payment_date,

        updated_at = now()

    where id = v_invoice.id;



    return jsonb_build_object(

      'message', 'invoice_marked_paid',

      'invoice_id', v_invoice.id,

      'invoice_type', v_invoice.invoice_type,

      'status', 'paid',

      'payment_date', p_payment_date,

      'related_payment_id', v_payment_result ->> 'payment_id',

      'incident_charge_id', null

    );

  end if;



  if v_invoice.invoice_type = 'incident' then

    if v_invoice.incident_charge_id is null then

      raise exception 'invoice_missing_incident';

    end if;



    update public.incident_charges

    set status = 'paid',

        updated_at = now()

    where id = v_invoice.incident_charge_id;



    update public.invoices

    set status = 'paid',

        payment_date = p_payment_date,

        updated_at = now()

    where id = v_invoice.id;



    return jsonb_build_object(

      'message', 'invoice_marked_paid',

      'invoice_id', v_invoice.id,

      'invoice_type', v_invoice.invoice_type,

      'status', 'paid',

      'payment_date', p_payment_date,

      'related_payment_id', null,

      'incident_charge_id', v_invoice.incident_charge_id

    );

  end if;



  raise exception 'invalid_invoice_type';

end;

$function$;

CREATE OR REPLACE FUNCTION public.close_incident_charge(p_incident_charge_id uuid, p_invoice_id uuid, p_payment_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_incident public.incident_charges%rowtype;

  v_invoice public.invoices%rowtype;

begin

  if p_incident_charge_id is null then

    raise exception 'incident_charge_required';

  end if;



  if p_invoice_id is null then

    raise exception 'invoice_required';

  end if;



  if p_payment_date is null then

    raise exception 'payment_date_required';

  end if;



  select *

  into v_incident

  from public.incident_charges

  where id = p_incident_charge_id

  for update;



  if not found then

    raise exception 'incident_charge_not_found';

  end if;



  select *

  into v_invoice

  from public.invoices

  where id = p_invoice_id

  for update;



  if not found then

    raise exception 'invoice_not_found';

  end if;



  if v_invoice.invoice_type <> 'incident' then

    raise exception 'invoice_not_incident_type';

  end if;



  if v_invoice.incident_charge_id <> v_incident.id then

    raise exception 'invoice_does_not_match_incident';

  end if;



  update public.incident_charges

  set status = 'paid',

      invoice_id = v_invoice.id,

      updated_at = now()

  where id = v_incident.id;



  update public.invoices

  set status = 'paid',

      payment_date = p_payment_date,

      updated_at = now()

  where id = v_invoice.id;



  return jsonb_build_object(

    'message', 'incident_charge_closed',

    'incident_charge_id', v_incident.id,

    'invoice_id', v_invoice.id,

    'status', 'paid'

  );

end;

$function$;
