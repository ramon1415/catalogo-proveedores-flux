-- Carril de aprobación automática por presupuesto saludable — REBANADA 1 (SOMBRA).
-- No cambia NINGÚN comportamiento en vivo: solo registra qué solicitudes SE
-- HABRÍAN auto-aprobado, para medir "cuánto le quitamos a Lis" antes de encender.
-- Diseño (ClickUp 86bau3rgw): el disparador es el ROL del solicitante.
--   - Solicita finanzas + no extraordinario + sin excepción  → se auto-aprobaría.
--     within-budget o over-budget da igual (Opción A: finanzas nunca se bloquea);
--     over_budget solo se marca para el aviso a César.
--   - La activación real (rebanada 2) va detrás de auto_approve_enabled por empresa,
--     apagado por default, y se enciende con decisión explícita (Fersana primero).
-- Todo aquí es aditivo y defensivo; el fallo del log nunca bloquea la solicitud.

-- 1) Bandera por empresa (apagada por default). La rebanada 2 la usará; aquí solo
--    se declara para no volver a migrar el settings después.
alter table public.approval_batch_company_settings
  add column if not exists auto_approve_enabled boolean not null default false;

-- 2) Bitácora de sombra. Solo service_role escribe/lee (medición interna, sin
--    exponer nada a la app todavía; sin PII de montos por persona).
create table if not exists public.auto_approval_shadow_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  payment_request_id uuid not null,
  request_number text,
  requester_id uuid,
  requester_is_finance boolean not null default false,
  budget_decision text,
  over_budget boolean not null default false,
  would_auto_approve boolean not null default false,
  applied boolean not null default false, -- rebanada 2 lo pondrá true al auto-aprobar de verdad
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists auto_approval_shadow_log_company_idx
  on public.auto_approval_shadow_log (company_id, created_at desc);
create index if not exists auto_approval_shadow_log_request_idx
  on public.auto_approval_shadow_log (payment_request_id);

alter table public.auto_approval_shadow_log enable row level security;
revoke all on public.auto_approval_shadow_log from public, anon, authenticated;
grant select, insert on public.auto_approval_shadow_log to service_role;

-- 3) Evaluación pura: ¿esta solicitud se auto-aprobaría? Devuelve el desglose.
create or replace function private.evaluate_auto_approval(p_payment_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  r public.payment_requests%rowtype;
  v_is_finance boolean := false;
  v_over_budget boolean := false;
  v_eligible boolean := false;
  v_reason text;
begin
  select * into r from public.payment_requests where id = p_payment_request_id;
  if not found then
    return jsonb_build_object('would_auto_approve', false, 'reason', 'request_not_found');
  end if;

  -- Nómina tiene su propio flujo; fuera de este carril.
  if r.request_type::text = 'nomina' then
    return jsonb_build_object('would_auto_approve', false, 'reason', 'nomina_out_of_scope');
  end if;

  v_is_finance := (r.requested_by is not null and r.company_id is not null
    and private.profile_has_company_role(r.requested_by, r.company_id, array['finance']::text[]));
  v_over_budget := (r.budget_decision = 'bloqueado');

  -- Elegible = lo pide finanzas, no es ajuste extraordinario y no trae excepción.
  v_eligible := v_is_finance
    and not coalesce(r.is_extraordinary_adjustment, false)
    and r.exception_status is null;

  v_reason := case
    when not v_is_finance then 'requester_not_finance'
    when coalesce(r.is_extraordinary_adjustment, false) then 'extraordinary_adjustment'
    when r.exception_status is not null then 'has_exception'
    when v_over_budget then 'finance_over_budget_auto_with_notice' -- Opción A: se aprueba y se marca
    else 'finance_within_budget_auto'
  end;

  return jsonb_build_object(
    'would_auto_approve', v_eligible,
    'requester_is_finance', v_is_finance,
    'budget_decision', r.budget_decision,
    'over_budget', v_over_budget,
    'request_number', r.request_number,
    'requester_id', r.requested_by,
    'company_id', r.company_id,
    'reason', v_reason
  );
end;
$function$;

revoke all on function private.evaluate_auto_approval(uuid) from public, anon, authenticated;

-- 4) Trigger de sombra: al entrar la solicitud a 'submitted', registra la
--    evaluación. Defensivo: cualquier error del log se traga (no bloquea el
--    alta/actualización de la solicitud).
create or replace function private.auto_approval_shadow_capture()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_eval jsonb;
begin
  -- Solo la TRANSICIÓN a 'submitted' (no cada update ya estando submitted).
  -- OLD/TG_OP no se pueden usar en el WHEN del trigger INSERT+UPDATE, así que
  -- el guard vive aquí.
  if tg_op = 'UPDATE' and old.status::text = 'submitted' then
    return new;
  end if;
  begin
    v_eval := private.evaluate_auto_approval(new.id);
    insert into public.auto_approval_shadow_log(
      company_id, payment_request_id, request_number, requester_id,
      requester_is_finance, budget_decision, over_budget, would_auto_approve, applied, reason)
    values (
      new.company_id, new.id, new.request_number, new.requested_by,
      coalesce((v_eval ->> 'requester_is_finance')::boolean, false),
      v_eval ->> 'budget_decision',
      coalesce((v_eval ->> 'over_budget')::boolean, false),
      coalesce((v_eval ->> 'would_auto_approve')::boolean, false),
      false,
      v_eval ->> 'reason'
    );
  exception when others then
    -- Nunca romper el flujo de la solicitud por un fallo de medición.
    null;
  end;
  return new;
end;
$function$;

revoke all on function private.auto_approval_shadow_capture() from public, anon, authenticated;

drop trigger if exists auto_approval_shadow_capture_trg on public.payment_requests;
create trigger auto_approval_shadow_capture_trg
  after insert or update of status on public.payment_requests
  for each row
  when (new.status::text = 'submitted')
  execute function private.auto_approval_shadow_capture();
