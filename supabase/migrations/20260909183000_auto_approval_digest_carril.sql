-- Carril de aprobación automática — REBANADA 3a (capa de datos del digest).
-- Depende de 20260909171500 (sombra) y 20260909180000 (live).
--
-- Diseño (86bau3rgw, decisiones Carlos 9-sep):
--  - César recibe UN COMPENDIO (no correos individuales) de lo auto-aprobado.
--  - Cadencia: al cierre del corte + 2 crones/día los días sin corte (eso lo
--    dispara la rebanada 3b llamando a enqueue_auto_approval_digest).
--  - César recibe AMBAS empresas (Soporte Fersana y Operadora Tlacatecpan).
--
-- Esta rebanada es solo la CAPA DE DATOS (config + compose + enqueue), toda SQL
-- y verificable. NO manda correos: encola un notification_events tipo
-- 'auto_approval.digest' que la rebanada 3b (dispatcher + cron, con Ramón)
-- convierte en el correo real. Nada se dispara desde aquí (no hay trigger/cron):
-- la 3b es quien llama a enqueue_auto_approval_digest.

-- 0) recipient_type nuevo para el compendio de finanzas (César): el CHECK actual
--    no tiene un rol que lo describa. Cambio aditivo (solo agrega un valor).
alter table public.notification_events
  drop constraint if exists notification_events_recipient_type_check;
alter table public.notification_events
  add constraint notification_events_recipient_type_check
  check (recipient_type = any (array[
    'usuario_solicitante', 'administrador_sistema', 'external_provider',
    'proveedor', 'finanzas_supervisor']));

-- 1) Config por empresa: a quién va el compendio y hasta cuándo ya se envió.
create table if not exists public.auto_approval_digest_settings (
  company_id uuid primary key,
  recipient_profile_id uuid,
  active boolean not null default true,
  last_digest_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.auto_approval_digest_settings enable row level security;
revoke all on public.auto_approval_digest_settings from public, anon, authenticated;
grant select, insert, update on public.auto_approval_digest_settings to service_role;

-- Setter para fijar/actualizar el destinatario del compendio por empresa.
create or replace function public.set_auto_approval_digest_recipient(
  p_company_id uuid, p_recipient_profile_id uuid, p_active boolean default true)
returns void
language sql
security definer
set search_path to ''
as $function$
  insert into public.auto_approval_digest_settings(company_id, recipient_profile_id, active, updated_at)
  values (p_company_id, p_recipient_profile_id, coalesce(p_active, true), now())
  on conflict (company_id) do update
    set recipient_profile_id = excluded.recipient_profile_id,
        active = excluded.active,
        updated_at = now();
$function$;
revoke all on function public.set_auto_approval_digest_recipient(uuid, uuid, boolean) from public, anon, authenticated;

-- Seed: César en ambas empresas. Por NOMBRE de empresa + email (estable entre
-- ambientes; los ids difieren prod/dev). Si el perfil o la empresa no existen en
-- el ambiente, no inserta nada (guardado).
insert into public.auto_approval_digest_settings(company_id, recipient_profile_id)
select c.id, p.id
from public.companies c
cross join lateral (
  select id from public.profiles where lower(email) = 'cesar@quantta.mx' limit 1
) p
where c.name in ('Soporte Fersana', 'Operadora Tlacatecpan')
on conflict (company_id) do update set recipient_profile_id = excluded.recipient_profile_id;

-- 2) Compone el contenido del compendio desde la bitácora de auto-aprobación.
--    Solo agregados/folios de solicitudes normales (no nómina, no PII de sueldos).
create or replace function private.compose_auto_approval_digest(
  p_company_id uuid, p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with rows as (
    select l.payment_request_id, l.request_number, l.over_budget, l.created_at,
           pr.amount_requested, pr.currency
    from public.auto_approval_shadow_log l
    left join public.payment_requests pr on pr.id = l.payment_request_id
    where l.company_id = p_company_id
      and l.applied
      and l.created_at > p_since
    order by l.created_at
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'since', p_since,
    'generated_at', now(),
    'count', (select count(*) from rows),
    'over_budget_count', (select count(*) from rows where over_budget),
    'total_amount', coalesce((select sum(amount_requested) from rows), 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'request_number', request_number,
        'amount', amount_requested,
        'currency', currency,
        'over_budget', over_budget,
        'auto_approved_at', created_at)) from rows), '[]'::jsonb)
  );
$function$;
revoke all on function private.compose_auto_approval_digest(uuid, timestamptz) from public, anon, authenticated;

-- 3) Encola UN compendio para la empresa (desde last_digest_at) y avanza el
--    marcador. No-op si la empresa no está activa o no hay nada nuevo. La
--    rebanada 3b la llama al cierre del corte y en el cron 2×/día.
create or replace function private.enqueue_auto_approval_digest(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  s public.auto_approval_digest_settings%rowtype;
  v_digest jsonb;
  v_count int;
begin
  select * into s from public.auto_approval_digest_settings where company_id = p_company_id;
  if not found or not s.active or s.recipient_profile_id is null then
    return jsonb_build_object('enqueued', false, 'reason', 'no_active_recipient');
  end if;

  v_digest := private.compose_auto_approval_digest(p_company_id, s.last_digest_at);
  v_count := coalesce((v_digest ->> 'count')::int, 0);
  if v_count = 0 then
    return jsonb_build_object('enqueued', false, 'reason', 'nothing_new');
  end if;

  insert into public.notification_events(
    event_type, source_table, source_id, recipient_type, recipient_profile_id,
    subject, payload, idempotency_key)
  values (
    'auto_approval.digest',
    'auto_approval_digest_settings',
    p_company_id,
    'finanzas_supervisor',
    s.recipient_profile_id,
    'Resumen de solicitudes auto-aprobadas',
    v_digest,
    'auto_approval_digest:' || p_company_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISSMS')
  );

  update public.auto_approval_digest_settings
     set last_digest_at = now(), updated_at = now()
   where company_id = p_company_id;

  return jsonb_build_object('enqueued', true, 'count', v_count);
end;
$function$;
revoke all on function private.enqueue_auto_approval_digest(uuid) from public, anon, authenticated;
