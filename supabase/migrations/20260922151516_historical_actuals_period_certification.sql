begin;

-- Certificación explícita de completitud para historical_actuals.
-- Fail-closed: una fila nueva nace "partial"; certificar requiere status,
-- timestamp y una referencia de origen explícitos.
create table if not exists public.historical_actuals_periods (
  company_id uuid not null references public.companies(id),
  period_month date not null,
  status text not null default 'partial'
    check (status in ('certified','partial')),
  certified_at timestamptz,
  certified_by uuid references auth.users(id) on delete set null,
  source_ref text,
  note text,
  primary key (company_id, period_month),
  constraint historical_actuals_periods_first_day_check
    check (period_month = date_trunc('month', period_month)::date),
  constraint historical_actuals_periods_certification_evidence_check
    check (
      status <> 'certified'
      or (
        certified_at is not null
        and nullif(btrim(source_ref), '') is not null
      )
    )
);

comment on table public.historical_actuals_periods is
'Certificación explícita por empresa+mes para historical_actuals. Solo status=certified autoriza reemplazar la capa operativa de gasto del dashboard. No se infiere completitud por existencia de filas.';

comment on column public.historical_actuals_periods.source_ref is
'Referencia trazable al import/cierre que certifica el periodo; obligatoria cuando status=certified.';

alter table public.historical_actuals_periods enable row level security;
alter table public.historical_actuals_periods force row level security;

-- Tabla administrativa: no se expone al navegador. La lectura del dashboard
-- ocurre dentro del RPC privado con sus propios controles de acceso.
revoke all on table public.historical_actuals_periods from public, anon, authenticated;
grant select, insert, update, delete on table public.historical_actuals_periods to service_role;

commit;
