alter table public.proveedores
  add column if not exists csf_file_path text,
  add column if not exists csf_uploaded_at timestamptz,
  add column if not exists csf_uploaded_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'proveedores_csf_uploaded_by_fkey'
  ) then
    alter table public.proveedores
      add constraint proveedores_csf_uploaded_by_fkey
      foreign key (csf_uploaded_by)
      references public.profiles(id);
  end if;
end $$;

create index if not exists proveedores_csf_uploaded_by_idx
  on public.proveedores(csf_uploaded_by);
