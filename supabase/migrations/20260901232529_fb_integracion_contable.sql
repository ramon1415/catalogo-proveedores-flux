-- FB-Integración (módulo CONTPAQ → Flux), tanda 1: cimientos de datos.
-- 1) contpaq_accounts se enriquece con el ÁRBOL declarado del catálogo
--    (CtaSup/CtaMayor/tipo/rubro NIF) — la jerarquía viene del catálogo
--    oficial, nunca se infiere del código (en SF/FF el código no la insinúa).
-- 2) account_report_lines: capa ejecutiva cuenta→renglón (del libro de César);
--    sin FK a contpaq_accounts a propósito — una etiqueta puede existir para
--    una cuenta aún no sincronizada.
-- 3) accounting_exports: ledger de pólizas exportadas (idempotencia por
--    origen+etapa, cancelaciones/NC por reversa).
-- 4) payment_requests.cfdi_data: FB-2 — el CFDI parseado AL SUBIR (salida del
--    parser certificado del módulo) queda persistido para el feeder.

-- 1) Árbol del catálogo ------------------------------------------------------
alter table public.contpaq_accounts
  add column if not exists cta_sup text,
  add column if not exists cta_mayor smallint,
  add column if not exists tipo text,
  add column if not exists rubro_nif text,
  add column if not exists activo boolean not null default true,
  add column if not exists sincronizado_el timestamptz;

comment on column public.contpaq_accounts.cta_sup is
  'Cuenta padre declarada por CONTPAQ (jerarquía explícita; nunca inferir del código).';
comment on column public.contpaq_accounts.cta_mayor is
  'Rol en estados financieros: 3=agrupador, 1=renglón (cuenta de mayor), 2=detalle (4 en SF/FF).';

-- 2) Renglones ejecutivos ----------------------------------------------------
create table if not exists public.account_report_lines (
  company_id   uuid not null references public.companies (id),
  account_code text not null,
  layer        text not null check (layer in ('balance', 'resultados', 'anexo')),
  line_name    text not null,
  created_at   timestamptz not null default now(),
  primary key (company_id, account_code, layer)
);

alter table public.account_report_lines enable row level security;

create policy account_report_lines_select_mapper on public.account_report_lines
  for select using (public.contpaq_mapper_company_access(company_id));
create policy account_report_lines_write_mapper on public.account_report_lines
  for all using (public.contpaq_mapper_company_access(company_id))
  with check (public.contpaq_mapper_company_access(company_id));

-- 3) Ledger de exportaciones (FB-6, DDL del módulo adaptado) -----------------
create table if not exists public.accounting_exports (
  id uuid primary key default gen_random_uuid(),
  source_feeder text not null,
  source_id     text not null,
  -- Etapa del ciclo (F3): provisión/pago en modo dos-pólizas, o directo.
  source_kind text not null default 'directo'
    check (source_kind in ('provision', 'pago', 'directo')),
  company_id uuid not null references public.companies (id),
  tipo_pol int  not null,
  folio    int  not null,
  periodo  date not null,
  uuid_cfdi text,
  -- Solo hechos: la fila se inserta cuando el archivo ya se produjo.
  status text not null check (status in ('exported', 'cancelled')),
  -- Hash del contenido exportado: data cambiada tras exportar ⇒ re-export
  -- exige cancelación explícita, no sobreescritura silenciosa.
  content_hash text not null,
  exported_at  timestamptz not null default now(),
  cancelled_at timestamptz,
  reversal_of uuid references public.accounting_exports (id)
);

-- Un export VIGENTE por origen y etapa; cancelar libera el origen.
create unique index if not exists accounting_exports_source_vigente_uq
  on public.accounting_exports (source_feeder, source_id, source_kind)
  where status = 'exported';
create index if not exists accounting_exports_source_idx
  on public.accounting_exports (source_feeder, source_id);
create index if not exists accounting_exports_company_periodo_idx
  on public.accounting_exports (company_id, periodo);
create index if not exists accounting_exports_uuid_cfdi_idx
  on public.accounting_exports (uuid_cfdi)
  where uuid_cfdi is not null;

alter table public.accounting_exports enable row level security;

create policy accounting_exports_select_mapper on public.accounting_exports
  for select using (public.contpaq_mapper_company_access(company_id));
create policy accounting_exports_write_mapper on public.accounting_exports
  for all using (public.contpaq_mapper_company_access(company_id))
  with check (public.contpaq_mapper_company_access(company_id));

-- 4) FB-2: snapshot del CFDI parseado ---------------------------------------
alter table public.payment_requests
  add column if not exists cfdi_data jsonb;

comment on column public.payment_requests.cfdi_data is
  'CFDI parseado al subir la factura (salida del parser certificado del módulo CONTPAQ). Insumo del feeder para los registros fiscales V/I/AM.';
