-- FB-Integración tanda 2 (FB-3): las tres capas de mapeo que le faltan al
-- Account Mapper para que resolverAsientos() del módulo tenga su mapeoEmpresa
-- completo: impuesto{...}, proveedor{...}, banco{...}. Las llaves de impuestos
-- son EXACTAMENTE las del contrato del resolver (src/mapeo/resolver.js) + las
-- de F3/cuentasEspeciales. Todo con la misma RLS del mapper.

-- 1) Impuesto → cuenta (llaves fijas del contrato) -------------------------
create table if not exists public.tax_account_mappings (
  company_id uuid not null references public.companies (id),
  tax_key text not null check (tax_key in (
    'ivaAcreditablePagado',   -- cargo IVA neto tras retención (118-011 en OPT)
    'ivaRetenidoAcreditable', -- cargo IVA retenido (118-012)
    'retIvaPasivo',           -- abono retención IVA (213-08 real vs 216-10 del doc: confirmar con contabilidad)
    'retIsrPasivo',           -- abono retención ISR (213-09 vs 216-04)
    'ivaPendiente',           -- F3 dos-pólizas: IVA por acreditar en provisión
    'ajusteRedondeo',         -- cuentasEspeciales
    'noDeducibles'            -- cuentasEspeciales
  )),
  contpaq_account_code text not null,
  needs_review boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (company_id, tax_key)
);

alter table public.tax_account_mappings enable row level security;
create policy tax_account_mappings_all_mapper on public.tax_account_mappings
  for all using (public.contpaq_mapper_company_access(company_id))
  with check (public.contpaq_mapper_company_access(company_id));

-- 2) Proveedor Flux → cuenta CONTPAQ + IdProveedor (tercero DIOT) ----------
create table if not exists public.provider_account_mappings (
  company_id uuid not null references public.companies (id),
  proveedor_id uuid not null references public.proveedores (id),
  contpaq_account_code text not null,
  contpaq_provider_id text, -- IdProveedor del padrón de terceros (para V/DIOT)
  updated_at timestamptz not null default now(),
  primary key (company_id, proveedor_id)
);

alter table public.provider_account_mappings enable row level security;
create policy provider_account_mappings_all_mapper on public.provider_account_mappings
  for all using (public.contpaq_mapper_company_access(company_id))
  with check (public.contpaq_mapper_company_access(company_id));

-- 3) Cuenta bancaria Flux → cuenta CONTPAQ ---------------------------------
create table if not exists public.bank_account_mappings (
  company_id uuid not null references public.companies (id),
  company_bank_account_id uuid not null references public.company_bank_accounts (id),
  contpaq_account_code text not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, company_bank_account_id)
);

alter table public.bank_account_mappings enable row level security;
create policy bank_account_mappings_all_mapper on public.bank_account_mappings
  for all using (public.contpaq_mapper_company_access(company_id))
  with check (public.contpaq_mapper_company_access(company_id));

-- 4) Padrón de terceros de CONTPAQ (referencia para el picker de proveedor).
--    Fuente: Control de IVA → Bajar (169 prov + 20 clientes en OPT; 312+24 SF).
--    El padrón da identidad fiscal (IdProveedor + RFC), NO la cuenta contable.
create table if not exists public.contpaq_terceros (
  company_id uuid not null references public.companies (id),
  id_contpaq text not null,
  nombre text not null,
  rfc text,
  tipo_tercero text, -- proveedor | cliente
  sincronizado_el timestamptz not null default now(),
  primary key (company_id, id_contpaq)
);

alter table public.contpaq_terceros enable row level security;
create policy contpaq_terceros_all_mapper on public.contpaq_terceros
  for all using (public.contpaq_mapper_company_access(company_id))
  with check (public.contpaq_mapper_company_access(company_id));

-- 5) Seed de impuestos de Operadora (config validada por los golden del
--    módulo; el par de retenciones queda needs_review por la discrepancia
--    213-08/09 del layout real vs 216-04/10 de "Información solicitada").
insert into public.tax_account_mappings (company_id, tax_key, contpaq_account_code, needs_review) values
  ('9680353c-9b86-4730-82e1-fce664f048a2', 'ivaAcreditablePagado', '11801100000', false),
  ('9680353c-9b86-4730-82e1-fce664f048a2', 'ivaRetenidoAcreditable', '11801200000', false),
  ('9680353c-9b86-4730-82e1-fce664f048a2', 'retIvaPasivo', '21308000000', true),
  ('9680353c-9b86-4730-82e1-fce664f048a2', 'retIsrPasivo', '21309000000', true),
  ('9680353c-9b86-4730-82e1-fce664f048a2', 'ajusteRedondeo', '66001060300', false),
  ('9680353c-9b86-4730-82e1-fce664f048a2', 'noDeducibles', '66001060300', false)
on conflict (company_id, tax_key) do nothing;
