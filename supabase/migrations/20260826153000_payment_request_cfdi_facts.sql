-- FB-2 · Hechos CFDI asociados a Solicitudes de pago.
-- DEV-first. No contiene Tax Resolver, cuentas CONTPAQ ni exportación de pólizas.
-- Seguridad: el parseo ocurre en navegador; estos hechos son PREVIEW no autoritativo.

create table if not exists public.payment_request_cfdi_facts (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  storage_path text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  parser_version text not null,
  parse_status text not null check (parse_status in ('parsed', 'review_required', 'invalid')),
  verification_status text not null default 'client_unverified'
    check (verification_status = 'client_unverified'),
  cfdi_version text,
  cfdi_uuid text,
  -- CFDI Fecha no incluye zona horaria; conservarla como timestamp local SAT.
  issued_at timestamp without time zone,
  currency text,
  subtotal numeric,
  total numeric,
  emitter_rfc text,
  receiver_rfc text,
  normalized_facts jsonb not null default '{}'::jsonb,
  validation_result jsonb not null default '{}'::jsonb,
  parse_error text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint payment_request_cfdi_facts_request_hash_key unique (payment_request_id, source_sha256),
  constraint payment_request_cfdi_facts_storage_scope_check check (
    storage_path like ('solicitudes/' || payment_request_id::text || '/%')
  ),
  constraint payment_request_cfdi_facts_invalid_error_check check (
    (parse_status = 'invalid' and parse_error is not null)
    or (parse_status <> 'invalid' and parse_error is null)
  )
);

create index if not exists payment_request_cfdi_facts_company_uuid_idx
  on public.payment_request_cfdi_facts(company_id, cfdi_uuid)
  where cfdi_uuid is not null;

create index if not exists payment_request_cfdi_facts_request_created_idx
  on public.payment_request_cfdi_facts(payment_request_id, created_at desc);

alter table public.payment_request_cfdi_facts enable row level security;
alter table public.payment_request_cfdi_facts force row level security;

revoke all on table public.payment_request_cfdi_facts from anon;
revoke all on table public.payment_request_cfdi_facts from authenticated;
grant select, insert on table public.payment_request_cfdi_facts to authenticated;

-- Lectura: hereda la visibilidad real de la solicitud padre y exige mismo company_id.
drop policy if exists payment_request_cfdi_facts_select on public.payment_request_cfdi_facts;
create policy payment_request_cfdi_facts_select
on public.payment_request_cfdi_facts
for select
to authenticated
using (
  exists (
    select 1
    from public.payment_requests pr
    where pr.id = payment_request_cfdi_facts.payment_request_id
      and pr.company_id = payment_request_cfdi_facts.company_id
      and (
        pr.requested_by = public.current_profile_id()
        or pr.approver_id = public.current_profile_id()
        or public.current_user_has_role(public.flux_sysadmin_roles())
        or (
          public.current_user_has_role(public.flux_approver_roles())
          and public.has_active_company_membership(public.current_profile_id(), pr.company_id)
        )
      )
  )
);

-- Inserción: solo actores que hoy pueden trabajar sobre la solicitud padre.
-- No se concede UPDATE/DELETE al cliente: cada ingestión queda inmutable.
drop policy if exists payment_request_cfdi_facts_insert on public.payment_request_cfdi_facts;
create policy payment_request_cfdi_facts_insert
on public.payment_request_cfdi_facts
for insert
to authenticated
with check (
  verification_status = 'client_unverified'
  and exists (
    select 1
    from public.payment_requests pr
    where pr.id = payment_request_cfdi_facts.payment_request_id
      and pr.company_id = payment_request_cfdi_facts.company_id
      and (
        pr.requested_by = public.current_profile_id()
        or public.current_user_has_role(public.flux_sysadmin_roles())
        or (
          public.current_user_has_role(public.flux_approver_roles())
          and public.has_active_company_membership(public.current_profile_id(), pr.company_id)
        )
      )
  )
);

comment on table public.payment_request_cfdi_facts is
  'FB-2: preview fiscal CLIENT_UNVERIFIED del CFDI adjunto. No es fuente autoritativa para FB-7/contabilidad hasta revalidación server-side.';
comment on column public.payment_request_cfdi_facts.verification_status is
  'FB-2 solo permite client_unverified. Una fase futura server-side deberá crear/promover evidencia autoritativa antes de exportar.';
