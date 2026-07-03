-- Flux Operadora - Migracion 004b
-- Policies para registrar comprobantes de transferencia en public.payment_receipts.
-- Motivo: payment_receipts tenia RLS activo pero no policy de escritura versionada.

alter table public."payment_receipts" enable row level security;

drop policy if exists "payment_receipts_select" on public."payment_receipts";
create policy "payment_receipts_select"
  on public."payment_receipts"
  as permissive
  for select
  to authenticated
  using (current_user_has_role(flux_member_roles()));

drop policy if exists "payment_receipts_write_authorized" on public."payment_receipts";
create policy "payment_receipts_write_authorized"
  on public."payment_receipts"
  as permissive
  for all
  to authenticated
  using (current_user_has_role(flux_approver_roles()))
  with check (current_user_has_role(flux_approver_roles()));

grant select, insert, update, delete on table public."payment_receipts" to authenticated;
