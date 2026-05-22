-- Tanda 8D - Validacion financiera / confirmacion de pago
-- Proyecto Flux / Sistema Operadora
-- Ejecutar manualmente en Supabase SQL Editor.

-- =========================================================
-- 1) Diagnostico previo, solo lectura
-- =========================================================

-- Columnas de payment_layouts
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payment_layouts'
  and column_name in ('status', 'updated_at', 'storage_path', 'file_name')
order by ordinal_position;

-- Columnas de payment_layout_lines
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payment_layout_lines'
  and column_name in ('status', 'bank_rejection_reason', 'updated_at')
order by ordinal_position;

-- Columnas de payment_receipts
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payment_receipts'
order by ordinal_position;

-- Columnas relevantes de payment_requests
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payment_requests'
  and column_name in ('status', 'paid_by', 'paid_at', 'updated_at', 'operational_comments')
order by ordinal_position;

-- Valores del enum payment_request_status
select
  t.typname as enum_name,
  e.enumlabel as enum_value
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname = 'payment_request_status'
order by e.enumsortorder;

-- Layouts candidatos para validacion financiera
select
  id,
  layout_number,
  name,
  status,
  payment_count,
  total_amount,
  created_at,
  updated_at
from public.payment_layouts
where status in ('generated', 'uploaded')
order by created_at desc;

-- Lineas incluidas por layout
select
  layout_id,
  status,
  count(*) as line_count,
  coalesce(sum(amount), 0) as total_amount
from public.payment_layout_lines
group by layout_id, status
order by layout_id, status;

-- =========================================================
-- 2) Ajustes estructurales seguros
-- =========================================================

alter table public.payment_requests
  add column if not exists paid_by uuid null references public.profiles(id);

alter table public.payment_requests
  add column if not exists paid_at timestamptz null;

create index if not exists idx_payment_layout_lines_layout_status
  on public.payment_layout_lines(layout_id, status);

create index if not exists idx_payment_receipts_layout_id
  on public.payment_receipts(layout_id);

create index if not exists idx_payment_receipts_payment_request_id
  on public.payment_receipts(payment_request_id);

-- =========================================================
-- 3) Funcion: marcar layout como subido al banco
-- =========================================================

create or replace function public.mark_payment_layout_uploaded(
  p_layout_id uuid,
  p_actor_profile_id uuid,
  p_comments text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layout record;
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
      and coalesce(p.active, true) = true
  ) then
    raise exception 'actor_profile_not_found';
  end if;

  select *
  into v_layout
  from public.payment_layouts
  where id = p_layout_id
  for update;

  if not found then
    raise exception 'layout_not_found';
  end if;

  if v_layout.status = 'draft' then
    raise exception 'layout_must_be_generated_first';
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
    'previous_status', v_layout.status,
    'new_status', 'uploaded',
    'message', 'layout_uploaded'
  );
end;
$$;

-- =========================================================
-- 4) Funcion: confirmar pago de layout
-- Nota: p_registered_by va antes de parametros opcionales porque
-- PostgreSQL requiere que los parametros con default queden al final.
-- En Supabase RPC se llama por nombre, no por posicion.
-- =========================================================

create or replace function public.confirm_payment_layout(
  p_layout_id uuid,
  p_payment_date date,
  p_registered_by uuid,
  p_bank_reference text default null,
  p_storage_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layout record;
  v_paid_count integer := 0;
  v_total_paid numeric := 0;
begin
  if p_payment_date is null then
    raise exception 'payment_date_required';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_registered_by
      and coalesce(p.active, true) = true
  ) then
    raise exception 'registered_by_profile_not_found';
  end if;

  select *
  into v_layout
  from public.payment_layouts
  where id = p_layout_id
  for update;

  if not found then
    raise exception 'layout_not_found';
  end if;

  if v_layout.status in ('confirmed', 'cancelled') then
    raise exception 'invalid_layout_status_for_confirmation';
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
    pll.layout_id,
    p_payment_date,
    pll.amount,
    p_bank_reference,
    p_storage_path,
    p_registered_by
  from public.payment_layout_lines pll
  where pll.layout_id = p_layout_id
    and pll.status = 'included';

  update public.payment_layout_lines
  set
    status = 'paid',
    updated_at = now()
  where layout_id = p_layout_id
    and status = 'included';

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

  update public.payment_layouts
  set
    status = 'confirmed',
    updated_at = now()
  where id = p_layout_id;

  return jsonb_build_object(
    'layout_id', p_layout_id,
    'previous_status', v_layout.status,
    'new_status', 'confirmed',
    'paid_count', v_paid_count,
    'total_paid', v_total_paid,
    'payment_date', p_payment_date,
    'message', 'layout_payment_confirmed'
  );
end;
$$;

-- =========================================================
-- 5) Funcion: rechazar linea bancaria
-- =========================================================

create or replace function public.reject_payment_layout_line(
  p_line_id uuid,
  p_reason text,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_request_number text;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'rejection_reason_required';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
      and coalesce(p.active, true) = true
  ) then
    raise exception 'actor_profile_not_found';
  end if;

  select *
  into v_line
  from public.payment_layout_lines
  where id = p_line_id
  for update;

  if not found then
    raise exception 'line_not_found';
  end if;

  if v_line.status = 'paid' then
    raise exception 'line_already_paid';
  end if;

  update public.payment_layout_lines
  set
    status = 'bank_rejected',
    bank_rejection_reason = p_reason,
    updated_at = now()
  where id = p_line_id;

  update public.payment_requests pr
  set
    status = 'approved'::public.payment_request_status,
    operational_comments = concat_ws(
      E'\n',
      nullif(pr.operational_comments, ''),
      concat('Rechazo bancario: ', p_reason)
    ),
    updated_at = now()
  where pr.id = v_line.payment_request_id
  returning pr.request_number
  into v_request_number;

  return jsonb_build_object(
    'line_id', p_line_id,
    'payment_request_id', v_line.payment_request_id,
    'request_number', v_request_number,
    'new_line_status', 'bank_rejected',
    'new_request_status', 'approved',
    'message', 'layout_line_bank_rejected'
  );
end;
$$;

-- =========================================================
-- 6) Grants de ejecucion para RPC
-- =========================================================

grant execute on function public.mark_payment_layout_uploaded(uuid, uuid, text) to authenticated;
grant execute on function public.confirm_payment_layout(uuid, date, uuid, text, text) to authenticated;
grant execute on function public.reject_payment_layout_line(uuid, text, uuid) to authenticated;

-- =========================================================
-- 7) Validacion posterior
-- =========================================================

select
  routine_name,
  routine_type,
  data_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'mark_payment_layout_uploaded',
    'confirm_payment_layout',
    'reject_payment_layout_line'
  )
order by routine_name;

select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payment_requests'
  and column_name in ('paid_by', 'paid_at', 'status', 'updated_at', 'operational_comments')
order by ordinal_position;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_payment_layout_lines_layout_status',
    'idx_payment_receipts_layout_id',
    'idx_payment_receipts_payment_request_id'
  )
order by indexname;

-- =========================================================
-- 8) Pruebas controladas, ajustar IDs antes de ejecutar
-- =========================================================

-- Seleccionar actor valido
select p.id as actor_profile_id, p.full_name, p.email
from public.profiles p
where coalesce(p.active, true) = true
order by p.full_name nulls last, p.email nulls last
limit 5;

-- Seleccionar layouts candidatos
select id, layout_number, status, payment_count, total_amount
from public.payment_layouts
where status in ('generated', 'uploaded')
order by created_at desc;

-- Marcar como subido:
-- select public.mark_payment_layout_uploaded(
--   '<layout_id>'::uuid,
--   '<actor_profile_id>'::uuid,
--   null
-- );

-- Confirmar pago:
-- select public.confirm_payment_layout(
--   '<layout_id>'::uuid,
--   current_date,
--   '<actor_profile_id>'::uuid,
--   'REFERENCIA-PRUEBA',
--   null
-- );

-- Seleccionar linea incluida para rechazo:
select
  pll.id as line_id,
  pll.layout_id,
  pll.request_number,
  pll.status,
  pll.amount
from public.payment_layout_lines pll
join public.payment_layouts pl on pl.id = pll.layout_id
where pll.status = 'included'
order by pll.created_at desc
limit 10;

-- Rechazar linea:
-- select public.reject_payment_layout_line(
--   '<line_id>'::uuid,
--   'Motivo de prueba',
--   '<actor_profile_id>'::uuid
-- );

-- =========================================================
-- 9) Limpieza de pruebas, usar solo con IDs de prueba
-- =========================================================

-- Revertir confirmacion de un layout de prueba:
-- update public.payment_requests pr
-- set status = 'finance_validation'::public.payment_request_status,
--     paid_at = null,
--     paid_by = null,
--     updated_at = now()
-- where pr.id in (
--   select pll.payment_request_id
--   from public.payment_layout_lines pll
--   where pll.layout_id = '<layout_id>'::uuid
-- );
--
-- delete from public.payment_receipts
-- where layout_id = '<layout_id>'::uuid;
--
-- update public.payment_layout_lines
-- set status = 'included',
--     updated_at = now()
-- where layout_id = '<layout_id>'::uuid
--   and status = 'paid';
--
-- update public.payment_layouts
-- set status = 'generated',
--     updated_at = now()
-- where id = '<layout_id>'::uuid;
