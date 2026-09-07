-- Reembolsos: el dinero va al EMPLEADO, no a un proveedor del catálogo.
-- Hoy el tipo 'reimbursement' existe en el dropdown pero no cambia nada: el
-- formulario exige proveedor, así que la única salida era dar de alta a la
-- persona como proveedor (contamina el catálogo, choca con la gobernanza de
-- altas y el dedup por RFC) o poner al comercio (y el layout le dispersaría
-- al comercio). Aquí se separa el beneficiario del proveedor.

-- 1) Datos bancarios del empleado -------------------------------------------
-- NO van en `profiles`: esa tabla es legible por cualquier autenticado
-- (policy profiles_select = true). Tabla propia con RLS estricta: cada quien
-- ve/edita SOLO los suyos; Finanzas los lee para dispersar.
create table if not exists public.employee_bank_accounts (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  banco text,
  clabe text,
  cuenta text,
  beneficiary_name text,
  updated_at timestamptz not null default now()
);

alter table public.employee_bank_accounts enable row level security;

create policy employee_bank_accounts_select on public.employee_bank_accounts
  for select using (
    profile_id = public.current_profile_id()
    or public.current_user_has_role(array['finance','finanzas','treasury','tesoreria','administracion','sysadmin','system_admin','superadmin'])
  );

create policy employee_bank_accounts_write_self on public.employee_bank_accounts
  for all using (
    profile_id = public.current_profile_id()
    or public.current_user_has_role(public.flux_sysadmin_roles())
  )
  with check (
    profile_id = public.current_profile_id()
    or public.current_user_has_role(public.flux_sysadmin_roles())
  );

-- 2) Beneficiario de la solicitud -------------------------------------------
-- En un reembolso proveedor_id deja de ser el destinatario del dinero: quien
-- cobra es este perfil. El resto de tipos lo deja null y no cambia nada.
alter table public.payment_requests
  add column if not exists beneficiary_profile_id uuid references public.profiles (id);

comment on column public.payment_requests.beneficiary_profile_id is
  'Reembolsos: empleado que recibe el dinero. El proveedor de la solicitud (si lo hay) es el comercio, no el destinatario del pago.';

-- 3) Desglose del reembolso --------------------------------------------------
-- Un reembolso junta N comprobantes de emisores distintos y de partidas
-- distintas, más gastos sin comprobante (propinas) que NO son deducibles.
-- Cada renglón lleva su partida y su CFDI parseado; la suma se concilia
-- contra amount_requested en la comprobación.
create table if not exists public.reimbursement_items (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests (id) on delete cascade,
  budget_category_id uuid references public.budget_categories (id),
  descripcion text not null,
  amount numeric not null check (amount > 0),
  subtotal_amount numeric,
  tax_amount numeric,
  deducible boolean not null default true,   -- propinas y similares: false
  invoice_uuid text,                          -- folio fiscal del comprobante del renglón
  cfdi_data jsonb,                            -- CFDI del EMISOR REAL (no del empleado)
  storage_path text,
  created_at timestamptz not null default now()
);

create index if not exists reimbursement_items_request_idx
  on public.reimbursement_items (payment_request_id);

-- Un mismo folio fiscal no puede reembolsarse dos veces en la empresa.
create unique index if not exists reimbursement_items_uuid_unique
  on public.reimbursement_items (upper(invoice_uuid))
  where invoice_uuid is not null;

alter table public.reimbursement_items enable row level security;

-- Se ve/edita con la misma llave que la solicitud madre: si puedes ver la
-- solicitud (RLS de payment_requests), puedes ver su desglose.
create policy reimbursement_items_all on public.reimbursement_items
  for all using (
    exists (select 1 from public.payment_requests pr where pr.id = payment_request_id)
  )
  with check (
    exists (select 1 from public.payment_requests pr where pr.id = payment_request_id)
  );

