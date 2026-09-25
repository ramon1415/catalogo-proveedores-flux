begin;

-- FASE 1 (backbone) · solicitud multi-partida.
--
-- Tabla ADITIVA que permite repartir una solicitud de pago en N líneas de
-- distribución (partida presupuestal + centro de costos + importe base). El
-- motor de export (resolverAsientos / planProvisionYPago) ya recorre
-- contrato.distribucion como arreglo, así que basta con alimentar estas líneas.
--
-- Retrocompatibilidad: la AUSENCIA de filas = comportamiento actual (una sola
-- partida derivada de payment_requests.budget_category_id). NO se hace backfill
-- de las solicitudes existentes.
create table if not exists public.payment_request_distributions (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests(id) on delete cascade,
  budget_category_id uuid not null,
  cost_center_id uuid,
  amount numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists payment_request_distributions_request_idx
  on public.payment_request_distributions(payment_request_id);

alter table public.payment_request_distributions enable row level security;

revoke all on table public.payment_request_distributions from public, anon;
grant select, insert, update, delete on table public.payment_request_distributions to authenticated;

-- RLS: se delega en el acceso del payment_request padre, replicando la misma
-- política de tenant/rol que payment_requests_* (operador dueño, o finanzas /
-- dirección de la empresa). No se deja abierta.
drop policy if exists payment_request_distributions_select on public.payment_request_distributions;
create policy payment_request_distributions_select
  on public.payment_request_distributions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.payment_requests pr
      where pr.id = payment_request_distributions.payment_request_id
        and (
          (
            pr.requested_by = (select public.current_profile_id())
            and (select private.current_profile_has_company_role(pr.company_id, array['operator', 'finance', 'director']))
          )
          or (select private.current_profile_has_company_role(pr.company_id, array['finance', 'director']))
        )
    )
  );

drop policy if exists payment_request_distributions_insert on public.payment_request_distributions;
create policy payment_request_distributions_insert
  on public.payment_request_distributions
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.payment_requests pr
      where pr.id = payment_request_distributions.payment_request_id
        and (
          (
            pr.requested_by = (select public.current_profile_id())
            and (select private.current_profile_has_company_role(pr.company_id, array['operator', 'finance', 'director']))
          )
          or (select private.current_profile_has_company_role(pr.company_id, array['finance', 'director']))
        )
    )
  );

drop policy if exists payment_request_distributions_update on public.payment_request_distributions;
create policy payment_request_distributions_update
  on public.payment_request_distributions
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.payment_requests pr
      where pr.id = payment_request_distributions.payment_request_id
        and (
          (
            pr.requested_by = (select public.current_profile_id())
            and (select private.current_profile_has_company_role(pr.company_id, array['operator', 'finance', 'director']))
          )
          or (select private.current_profile_has_company_role(pr.company_id, array['finance', 'director']))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.payment_requests pr
      where pr.id = payment_request_distributions.payment_request_id
        and (
          (
            pr.requested_by = (select public.current_profile_id())
            and (select private.current_profile_has_company_role(pr.company_id, array['operator', 'finance', 'director']))
          )
          or (select private.current_profile_has_company_role(pr.company_id, array['finance', 'director']))
        )
    )
  );

drop policy if exists payment_request_distributions_delete on public.payment_request_distributions;
create policy payment_request_distributions_delete
  on public.payment_request_distributions
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.payment_requests pr
      where pr.id = payment_request_distributions.payment_request_id
        and (
          (
            pr.requested_by = (select public.current_profile_id())
            and (select private.current_profile_has_company_role(pr.company_id, array['operator', 'finance', 'director']))
          )
          or (select private.current_profile_has_company_role(pr.company_id, array['finance', 'director']))
        )
    )
  );

commit;
