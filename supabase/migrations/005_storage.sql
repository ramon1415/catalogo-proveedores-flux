-- Flux Operadora - Migracion 005
-- Storage buckets y policies generadas desde exports reales de Supabase dev.
-- Ejecutar en un proyecto Supabase donde el esquema storage ya exista.

-- Buckets de Storage.
insert into storage.buckets (id, name, "public", file_size_limit, allowed_mime_types) values ('celebration-contracts', 'celebration-contracts', false, null, null) on conflict (id) do update set name = excluded.name, "public" = excluded."public", file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, "public", file_size_limit, allowed_mime_types) values ('company-receipts', 'company-receipts', false, null, null) on conflict (id) do update set name = excluded.name, "public" = excluded."public", file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, "public", file_size_limit, allowed_mime_types) values ('payment-receipts', 'payment-receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]) on conflict (id) do update set name = excluded.name, "public" = excluded."public", file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Policies de Storage exportadas. Revisar especialmente las policies anon temporales antes de prod.
drop policy if exists "Anon can read payment receipts temporarily" on storage."objects";
create policy "Anon can read payment receipts temporarily" on storage."objects" as permissive for select to anon using ((bucket_id = 'payment-receipts'::text));
drop policy if exists "Anon can upload payment receipts temporarily" on storage."objects";
create policy "Anon can upload payment receipts temporarily" on storage."objects" as permissive for insert to anon with check ((bucket_id = 'payment-receipts'::text));
