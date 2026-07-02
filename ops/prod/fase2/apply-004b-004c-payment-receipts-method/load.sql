-- Flux Operadora - PROD apply 004b + 004c load
-- Applies, in order:
-- 1. supabase/migrations/004b_payment_receipts_policies.sql
-- 2. supabase/migrations/004c_fase2_payment_method_closure.sql
-- Do not run without explicit Carlos/Ramon authorization and a coordinated PROD release window.

-- BEGIN 004b_payment_receipts_policies.sql
-- Flux Operadora - Migracion 004b
-- Policies para registrar comprobantes de transferencia en public.payment_receipts.
-- Motivo: payment_receipts tenia RLS activo pero no policy de escritura versionada.

alter table public."payment_receipts" enable row level security;

drop policy if exists "payment_receipts_select" on public."payment_receipts";
create policy "payment_receipts_select"
  on public."payment_receipts"
  as permissive
  for select
  to authenticated
  using (current_user_has_role(flux_member_roles()));

drop policy if exists "payment_receipts_write_authorized" on public."payment_receipts";
create policy "payment_receipts_write_authorized"
  on public."payment_receipts"
  as permissive
  for all
  to authenticated
  using (current_user_has_role(flux_approver_roles()))
  with check (current_user_has_role(flux_approver_roles()));

grant select, insert, update, delete on table public."payment_receipts" to authenticated;
-- END 004b_payment_receipts_policies.sql

-- BEGIN 004c_fase2_payment_method_closure.sql
-- Flux Operadora - Migracion 004c
-- Cierre Fase 2: tipo de solicitud separado de metodo de pago.
-- Seguridad: no copia datos operativos y no toca produccion. Debe aplicarse solo con autorizacion separada.

alter type public."payment_request_type" add value if not exists 'online_purchase';

alter table public."payment_requests"
  add column if not exists payment_method text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payment_requests_payment_method_check'
      and conrelid = 'public.payment_requests'::regclass
  ) then
    alter table public."payment_requests"
      add constraint payment_requests_payment_method_check
      check (payment_method is null or payment_method in ('transfer', 'cash', 'check', 'other'))
      not valid;
  end if;
end $$;

alter table public."payment_requests"
  validate constraint payment_requests_payment_method_check;

create index if not exists idx_payment_requests_payment_method
  on public."payment_requests" (payment_method);

comment on column public."payment_requests".payment_method is
  'Fase 2: metodo operativo de pago separado del tipo de solicitud. Valores: transfer, cash, check, other.';

create or replace function public.create_payment_layout(
  p_period_start date,
  p_period_end date,
  p_generated_by uuid,
  p_name text default null::text,
  p_company_id uuid default null::uuid,
  p_company_bank_account_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
            when nullif(p.convenio_number, '') is not null then 'CONVENIO ' || btrim(p.convenio_number)
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
      and coalesce(nullif(pr.payment_method, ''), case when pr.request_type::text in ('cash', 'check') then pr.request_type::text else 'transfer' end) = 'transfer'
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
      'message', 'no_valid_transfer_payment_requests'
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
    'message', 'layout_created_transfer_only'
  );
end;
$function$;

select
  'FASE2_PAYMENT_METHOD_CLOSURE_READY' as result,
  'payment_method versioned and create_payment_layout now includes only transfer payment requests.' as detail;
-- END 004c_fase2_payment_method_closure.sql

select
  'PROD_004B_004C_LOAD_COMPLETE' as result,
  '004b and 004c applied in order. Run postcheck.sql next.' as detail;
