-- Feature: predicción de partida
-- Tabla de sugerencias históricas proveedor(RFC) -> partida (budget_category),
-- derivadas offline de pólizas CONTPAQ 2024-2026.
-- Solo lectura para miembros de la company; se seedea vía migración/servicio (sin INSERT/UPDATE/DELETE policies).

create table if not exists public.partida_predictions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  rfc_emisor text not null,
  cuenta_gasto_dominante text not null,
  share_dominante numeric not null,
  n_cfdis int not null,
  partida_candidates jsonb not null,
  is_confident boolean not null,
  source text not null default 'contpaq_historical_2024_2026',
  created_at timestamptz not null default now(),
  unique (company_id, rfc_emisor)
);

create index if not exists partida_predictions_company_rfc_idx
  on public.partida_predictions (company_id, rfc_emisor);

alter table public.partida_predictions enable row level security;

-- Lectura por membresía activa en la company (mismo patrón que projects_select_members).
drop policy if exists partida_predictions_select_members on public.partida_predictions;
create policy partida_predictions_select_members
  on public.partida_predictions
  for select
  using (has_active_company_membership(current_profile_id(), company_id));
