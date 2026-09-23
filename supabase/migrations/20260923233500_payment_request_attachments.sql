begin;

create table if not exists public.payment_request_attachments (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  storage_path text not null,
  original_filename text not null,
  mime_type text,
  file_size bigint check (file_size is null or (file_size >= 0 and file_size <= 10485760)),
  uploaded_by uuid not null default public.current_profile_id() references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (payment_request_id, storage_path)
);

create index if not exists payment_request_attachments_request_idx
  on public.payment_request_attachments(payment_request_id, created_at);

create index if not exists payment_request_attachments_company_idx
  on public.payment_request_attachments(company_id, created_at);

alter table public.payment_request_attachments enable row level security;

revoke all on table public.payment_request_attachments from public, anon;
grant select, insert on table public.payment_request_attachments to authenticated;

drop policy if exists payment_request_attachments_select on public.payment_request_attachments;
create policy payment_request_attachments_select
  on public.payment_request_attachments
  for select
  to authenticated
  using (
    public.current_profile_id() is not null
    and public.has_active_company_membership(public.current_profile_id(), company_id)
    and exists (
      select 1
      from public.payment_requests pr
      where pr.id = payment_request_id
        and pr.company_id = company_id
    )
  );

drop policy if exists payment_request_attachments_insert on public.payment_request_attachments;
create policy payment_request_attachments_insert
  on public.payment_request_attachments
  for insert
  to authenticated
  with check (
    uploaded_by = public.current_profile_id()
    and public.has_active_company_membership(public.current_profile_id(), company_id)
    and exists (
      select 1
      from public.payment_requests pr
      where pr.id = payment_request_id
        and pr.company_id = company_id
    )
  );

-- El bucket ya es privado. Se amplía únicamente la lista de MIME admitidos
-- para los tipos que el formulario valida explícitamente.
update storage.buckets
set allowed_mime_types = case
  when allowed_mime_types is null then null
  else (
    select array_agg(distinct mime order by mime)
    from unnest(
      allowed_mime_types || array[
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
        'text/xml',
        'application/xml',
        'text/plain'
      ]::text[]
    ) as mime
  )
end
where id = 'payment-receipts';

commit;
