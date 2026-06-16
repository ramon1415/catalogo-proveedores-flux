-- Flux Operadora - Migracion 003d
-- Funciones: create_payment_layout, mark_payment_layout_uploaded, confirm_payment_layout, reject_payment_layout_line

CREATE OR REPLACE FUNCTION public.create_payment_layout(p_period_start date, p_period_end date, p_generated_by uuid, p_name text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid, p_company_bank_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_layout_id uuid;

  v_layout_number text;

  v_layout_name text;

  v_payment_count integer := 0;

  v_company_count integer := 0;

  v_total_amount numeric := 0;

  v_invalid_count integer := 0;

  v_invalid_requests jsonb := '[]'::jsonb;

begin

  if p_period_start is null or p_period_end is null then

    raise exception 'period_dates_required';

  end if;



  if p_period_start > p_period_end then

    raise exception 'invalid_period_range';

  end if;



  if not exists (

    select 1

    from public.profiles

    where id = p_generated_by

      and coalesce(active, true) = true

  ) then

    raise exception 'generated_by_profile_not_found';

  end if;



  if p_company_id is not null and not exists (

    select 1 from public.companies where id = p_company_id

  ) then

    raise exception 'company_not_found';

  end if;



  if p_company_bank_account_id is not null and not exists (

    select 1

    from public.company_bank_accounts

    where id = p_company_bank_account_id

      and coalesce(active, true) = true

  ) then

    raise exception 'company_bank_account_not_found_or_inactive';

  end if;



  v_layout_number :=

    'LAY-' ||

    extract(year from p_period_start)::int ||

    '-' ||

    lpad(nextval('public.payment_layout_number_seq')::text, 4, '0');



  v_layout_name := coalesce(

    nullif(btrim(p_name), ''),

    'Layout BBVA - ' || p_period_start::text || ' a ' || p_period_end::text

  );



  insert into public.payment_layouts (

    layout_number,

    name,

    period_start,

    period_end,

    status,

    generated_by,

    generated_at

  )

  values (

    v_layout_number,

    v_layout_name,

    p_period_start,

    p_period_end,

    'draft',

    p_generated_by,

    now()

  )

  returning id into v_layout_id;



  drop table if exists pg_temp.tmp_payment_layout_candidates;



  create temporary table tmp_payment_layout_candidates on commit drop as

  with base as (

    select

      pr.id as payment_request_id,

      pr.request_number,

      pr.company_id,

      pr.proveedor_id,

      pr.company_bank_account_id,

      cba.account_number as source_account_number,

      coalesce(nullif(c.legal_name, ''), nullif(c.name, '')) as company_name,

      p.destination_type,

      case

        when p.destination_type = 'clabe' then nullif(p.clabe, '')

        when p.destination_type = 'cuenta' then nullif(p.cuenta_bancaria, '')

        when p.destination_type = 'convenio' then

          case

            when nullif(p.convenio_number, '') is not null

              then 'CONVENIO ' || btrim(p.convenio_number)

            else null

          end

        else null

      end as destination_value,

      coalesce(

        nullif(p.beneficiary_name, ''),

        nullif(p.nombre_completo, ''),

        nullif(p.alias, '')

      ) as beneficiary_name,

      pr.amount_requested as amount,

      nullif(pr.payment_reference, '') as payment_reference,

      nullif(pr.payment_concept, '') as payment_concept,

      array_remove(array[

        case when pr.company_bank_account_id is null then 'company_bank_account_id' end,

        case when pr.company_bank_account_id is not null and cba.id is null then 'company_bank_account_id_not_found' end,

        case when cba.id is not null and coalesce(cba.active, false) = false then 'company_bank_account_inactive' end,

        case when nullif(cba.account_number, '') is null then 'source_account_number' end,

        case when coalesce(nullif(c.legal_name, ''), nullif(c.name, '')) is null then 'company_name' end,

        case when pr.proveedor_id is null then 'proveedor_id' end,

        case when pr.proveedor_id is not null and p.id is null then 'proveedor_not_found' end,

        case when p.id is not null and coalesce(p.activo, false) = false then 'proveedor_inactive' end,

        case when coalesce(nullif(p.beneficiary_name, ''), nullif(p.nombre_completo, ''), nullif(p.alias, '')) is null then 'beneficiary_name' end,

        case when p.destination_type is null then 'destination_type' end,

        case when p.destination_type = 'clabe' and nullif(p.clabe, '') is null then 'clabe' end,

        case when p.destination_type = 'cuenta' and nullif(p.cuenta_bancaria, '') is null then 'cuenta_bancaria' end,

        case when p.destination_type = 'convenio' and nullif(p.convenio_number, '') is null then 'convenio_number' end,

        case when nullif(pr.payment_reference, '') is null then 'payment_reference' end,

        case when nullif(pr.payment_concept, '') is null then 'payment_concept' end

      ]::text[], null) as missing_fields

    from public.payment_requests pr

    left join public.companies c on c.id = pr.company_id

    left join public.company_bank_accounts cba on cba.id = pr.company_bank_account_id

    left join public.proveedores p on p.id = pr.proveedor_id

    where pr.status = 'approved'::public.payment_request_status

      and coalesce(pr.currency, 'MXN') = 'MXN'

      and coalesce(pr.amount_requested, 0) > 0

      and coalesce(pr.scheduled_payment_date, pr.updated_at::date, pr.created_at::date)

        between p_period_start and p_period_end

      and (p_company_id is null or pr.company_id = p_company_id)

      and (p_company_bank_account_id is null or pr.company_bank_account_id = p_company_bank_account_id)

      and not exists (

        select 1

        from public.payment_layout_lines pll

        join public.payment_layouts pl on pl.id = pll.layout_id

        where pll.payment_request_id = pr.id

          and pl.status <> 'cancelled'

      )

  ),

  marked as (

    select

      *,

      case

        when cardinality(missing_fields) = 0 then null

        when missing_fields && array[

          'company_bank_account_id',

          'company_bank_account_id_not_found',

          'company_bank_account_inactive',

          'source_account_number',

          'company_name'

        ]::text[] then 'missing_source_account_data'

        when missing_fields && array[

          'proveedor_id',

          'proveedor_not_found',

          'proveedor_inactive',

          'beneficiary_name',

          'destination_type',

          'clabe',

          'cuenta_bancaria',

          'convenio_number'

        ]::text[] then 'missing_provider_payment_data'

        when missing_fields && array[

          'payment_reference',

          'payment_concept'

        ]::text[] then 'missing_payment_reference_data'

        else 'incomplete_layout_data'

      end as reason

    from base

  )

  select * from marked;



  select

    count(*),

    coalesce(

      jsonb_agg(

        jsonb_build_object(

          'payment_request_id', payment_request_id,

          'request_number', request_number,

          'reason', reason,

          'missing_fields', missing_fields

        )

        order by request_number nulls last

      ),

      '[]'::jsonb

    )

  into v_invalid_count, v_invalid_requests

  from tmp_payment_layout_candidates

  where cardinality(missing_fields) > 0;



  insert into public.payment_layout_lines (

    layout_id,

    payment_request_id,

    company_id,

    proveedor_id,

    company_bank_account_id,

    source_account_number,

    company_name,

    destination_type,

    destination_value,

    beneficiary_name,

    amount,

    payment_reference,

    payment_concept,

    request_number,

    status

  )

  select

    v_layout_id,

    payment_request_id,

    company_id,

    proveedor_id,

    company_bank_account_id,

    source_account_number,

    company_name,

    destination_type,

    destination_value,

    beneficiary_name,

    amount,

    payment_reference,

    payment_concept,

    request_number,

    'included'

  from tmp_payment_layout_candidates

  where cardinality(missing_fields) = 0;



  get diagnostics v_payment_count = row_count;



  if v_payment_count = 0 then

    delete from public.payment_layouts where id = v_layout_id;



    return jsonb_build_object(

      'layout_id', null,

      'layout_number', v_layout_number,

      'status', 'not_created',

      'payment_count', 0,

      'company_count', 0,

      'total_amount', 0,

      'invalid_count', v_invalid_count,

      'invalid_requests', v_invalid_requests,

      'message', 'no_valid_payment_requests'

    );

  end if;



  select

    count(distinct company_id),

    coalesce(sum(amount), 0)

  into v_company_count, v_total_amount

  from public.payment_layout_lines

  where layout_id = v_layout_id;



  update public.payment_layouts

  set

    company_count = v_company_count,

    payment_count = v_payment_count,

    total_amount = v_total_amount,

    updated_at = now()

  where id = v_layout_id;



  update public.payment_requests pr

  set

    status = 'finance_validation'::public.payment_request_status,

    scheduled_by = p_generated_by,

    scheduled_at = now(),

    updated_at = now()

  where pr.id in (

    select payment_request_id

    from public.payment_layout_lines

    where layout_id = v_layout_id

  );



  return jsonb_build_object(

    'layout_id', v_layout_id,

    'layout_number', v_layout_number,

    'status', 'draft',

    'payment_count', v_payment_count,

    'company_count', v_company_count,

    'total_amount', v_total_amount,

    'invalid_count', v_invalid_count,

    'invalid_requests', v_invalid_requests,

    'message', 'layout_created'

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.mark_payment_layout_uploaded(p_layout_id uuid, p_actor_profile_id uuid, p_comments text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_layout public.payment_layouts%rowtype;

  v_previous_status text;

begin

  select *

  into v_layout

  from public.payment_layouts

  where id = p_layout_id

  for update;



  if not found then

    raise exception 'layout_not_found';

  end if;



  if not exists (

    select 1

    from public.profiles

    where id = p_actor_profile_id

      and coalesce(active, true) = true

  ) then

    raise exception 'profile_not_found';

  end if;



  v_previous_status := v_layout.status;



  if v_layout.status = 'draft' then

    raise exception 'layout_must_be_generated_first';

  end if;



  if v_layout.status = 'uploaded' then

    return jsonb_build_object(

      'layout_id', p_layout_id,

      'previous_status', v_previous_status,

      'new_status', 'uploaded',

      'message', 'layout_already_uploaded'

    );

  end if;



  if v_layout.status = 'confirmed' then

    raise exception 'layout_already_confirmed';

  end if;



  if v_layout.status = 'cancelled' then

    raise exception 'layout_cancelled';

  end if;



  if v_layout.status <> 'generated' then

    raise exception 'invalid_layout_status_for_upload';

  end if;



  update public.payment_layouts

  set

    status = 'uploaded',

    updated_at = now()

  where id = p_layout_id;



  return jsonb_build_object(

    'layout_id', p_layout_id,

    'previous_status', v_previous_status,

    'new_status', 'uploaded',

    'message', 'layout_marked_as_uploaded'

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.confirm_payment_layout(p_layout_id uuid, p_payment_date date, p_registered_by uuid, p_bank_reference text DEFAULT NULL::text, p_storage_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_layout public.payment_layouts%rowtype;

  v_previous_status text;

  v_paid_count integer := 0;

  v_total_paid numeric := 0;

begin

  if p_payment_date is null then

    raise exception 'payment_date_required';

  end if;



  select *

  into v_layout

  from public.payment_layouts

  where id = p_layout_id

  for update;



  if not found then

    raise exception 'layout_not_found';

  end if;



  if not exists (

    select 1

    from public.profiles

    where id = p_registered_by

      and coalesce(active, true) = true

  ) then

    raise exception 'profile_not_found';

  end if;



  v_previous_status := v_layout.status;



  if v_layout.status = 'confirmed' then

    raise exception 'layout_already_confirmed';

  end if;



  if v_layout.status = 'cancelled' then

    raise exception 'layout_cancelled';

  end if;



  if v_layout.status not in ('uploaded', 'generated') then

    raise exception 'invalid_layout_status_for_confirmation';

  end if;



  select

    count(*),

    coalesce(sum(amount), 0)

  into

    v_paid_count,

    v_total_paid

  from public.payment_layout_lines

  where layout_id = p_layout_id

    and status = 'included';



  if v_paid_count = 0 then

    raise exception 'no_included_lines_to_confirm';

  end if;



  -- Crear comprobantes por cada lÃ­nea incluida

  insert into public.payment_receipts (

    payment_request_id,

    layout_id,

    payment_date,

    amount,

    bank_reference,

    storage_path,

    registered_by

  )

  select

    pll.payment_request_id,

    p_layout_id,

    p_payment_date,

    pll.amount,

    p_bank_reference,

    p_storage_path,

    p_registered_by

  from public.payment_layout_lines pll

  where pll.layout_id = p_layout_id

    and pll.status = 'included';



  -- Marcar lÃ­neas como pagadas

  update public.payment_layout_lines

  set

    status = 'paid',

    updated_at = now()

  where layout_id = p_layout_id

    and status = 'included';



  -- Marcar solicitudes como pagadas

  update public.payment_requests pr

  set

    status = 'paid'::public.payment_request_status,

    paid_by = p_registered_by,

    paid_at = now(),

    updated_at = now()

  where pr.id in (

    select pll.payment_request_id

    from public.payment_layout_lines pll

    where pll.layout_id = p_layout_id

      and pll.status = 'paid'

  );



  -- Marcar layout como confirmado

  update public.payment_layouts

  set

    status = 'confirmed',

    updated_at = now()

  where id = p_layout_id;



  return jsonb_build_object(

    'layout_id', p_layout_id,

    'previous_status', v_previous_status,

    'new_status', 'confirmed',

    'paid_count', v_paid_count,

    'total_paid', v_total_paid,

    'payment_date', p_payment_date,

    'message', 'payment_layout_confirmed'

  );

end;

$function$;

CREATE OR REPLACE FUNCTION public.reject_payment_layout_line(p_line_id uuid, p_reason text, p_actor_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

  v_line public.payment_layout_lines%rowtype;

  v_request_number text;

  v_clean_reason text;

begin

  v_clean_reason := nullif(btrim(coalesce(p_reason, '')), '');



  if v_clean_reason is null then

    raise exception 'rejection_reason_required';

  end if;



  select *

  into v_line

  from public.payment_layout_lines

  where id = p_line_id

  for update;



  if not found then

    raise exception 'layout_line_not_found';

  end if;



  if not exists (

    select 1

    from public.profiles

    where id = p_actor_profile_id

      and coalesce(active, true) = true

  ) then

    raise exception 'profile_not_found';

  end if;



  if v_line.status = 'paid' then

    raise exception 'line_already_paid';

  end if;



  if v_line.status = 'bank_rejected' then

    raise exception 'line_already_rejected';

  end if;



  update public.payment_layout_lines

  set

    status = 'bank_rejected',

    bank_rejection_reason = v_clean_reason,

    updated_at = now()

  where id = p_line_id;



  update public.payment_requests pr

  set

    status = 'approved'::public.payment_request_status,

    operational_comments = concat_ws(

      E'\n',

      nullif(pr.operational_comments, ''),

      'Rechazo bancario: ' || v_clean_reason

    ),

    updated_at = now()

  where pr.id = v_line.payment_request_id

  returning pr.request_number into v_request_number;



  return jsonb_build_object(

    'line_id', p_line_id,

    'payment_request_id', v_line.payment_request_id,

    'request_number', v_request_number,

    'new_line_status', 'bank_rejected',

    'new_request_status', 'approved',

    'message', 'layout_line_rejected'

  );

end;

$function$;
