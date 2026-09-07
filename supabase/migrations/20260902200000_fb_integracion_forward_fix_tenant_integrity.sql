-- FB-Integración · forward-fix (revisión de PR #498, puntos C/D/E).
-- Las tres migraciones previas (20260901232529, 20260901235805, 20260902045510)
-- ya están aplicadas en DEV y NO se editan. Esta migración corrige hacia
-- adelante:
--   C) integridad por empresa: una fila de bank_account_mappings no puede
--      apuntar a una cuenta bancaria de OTRA empresa; una reversa del ledger
--      no puede apuntar a una exportación de OTRA empresa. Ambas por FK
--      compuesta (company_id, id) — lo valida Postgres, no la app.
--   D) índices de las FKs sin cobertura que reportó el advisor de DEV.
--   E) RLS: una política por operación, TO authenticated, y grants explícitos
--      (fail-closed para anon). Se retiran las políticas FOR ALL que se
--      superponían con las de SELECT (multiple_permissive_policies).
-- Precondición verificada en DEV: bank_account_mappings y accounting_exports
-- están vacías, así que las FKs compuestas no pueden fallar por datos previos.

-- C1) company_bank_accounts: llave (company_id, id) para FK compuesta -------
create unique index if not exists company_bank_accounts_company_id_id_uq
  on public.company_bank_accounts (company_id, id);

alter table public.bank_account_mappings
  drop constraint if exists bank_account_mappings_company_bank_account_id_fkey;
alter table public.bank_account_mappings
  drop constraint if exists bank_account_mappings_company_scope_fkey;
alter table public.bank_account_mappings
  add constraint bank_account_mappings_company_scope_fkey
  foreign key (company_id, company_bank_account_id)
  references public.company_bank_accounts (company_id, id);

-- C2) accounting_exports: la reversa vive en la misma empresa ---------------
create unique index if not exists accounting_exports_company_id_id_uq
  on public.accounting_exports (company_id, id);

alter table public.accounting_exports
  drop constraint if exists accounting_exports_reversal_of_fkey;
alter table public.accounting_exports
  drop constraint if exists accounting_exports_reversal_same_company_fkey;
alter table public.accounting_exports
  add constraint accounting_exports_reversal_same_company_fkey
  foreign key (company_id, reversal_of)
  references public.accounting_exports (company_id, id);
-- (MATCH SIMPLE: con reversal_of NULL la FK no aplica; con valor, exige que
--  la exportación referida tenga el MISMO company_id.)

-- D) índices de FKs ----------------------------------------------------------
create index if not exists accounting_exports_reversal_of_idx
  on public.accounting_exports (reversal_of)
  where reversal_of is not null;
create index if not exists bank_account_mappings_company_bank_account_id_idx
  on public.bank_account_mappings (company_bank_account_id);
create index if not exists provider_account_mappings_proveedor_id_idx
  on public.provider_account_mappings (proveedor_id);

-- E) RLS por operación + grants explícitos ----------------------------------
-- Contrato de escritura desde la app (features/configuracion/api.ts):
--   * tablas de mapeo y catálogos de apoyo: upsert + delete por Finanzas de
--     la empresa (contpaq_mapper_company_access).
--   * accounting_exports: insert (hecho consumado del export) y update
--     (cancelación: status/cancelled_at). Nunca delete: el ledger es histórico.
do $fix$
declare
  t text;
  tablas_mapeo text[] := array[
    'account_report_lines', 'tax_account_mappings', 'provider_account_mappings',
    'bank_account_mappings', 'contpaq_terceros'
  ];
begin
  foreach t in array tablas_mapeo loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_mapper', t);
    execute format('drop policy if exists %I on public.%I', t || '_write_mapper', t);
    execute format('drop policy if exists %I on public.%I', t || '_all_mapper', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_mapper', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_mapper', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_mapper', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (public.contpaq_mapper_company_access(company_id))$p$, t || '_select_mapper', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (public.contpaq_mapper_company_access(company_id))$p$, t || '_insert_mapper', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (public.contpaq_mapper_company_access(company_id))
      with check (public.contpaq_mapper_company_access(company_id))$p$, t || '_update_mapper', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (public.contpaq_mapper_company_access(company_id))$p$, t || '_delete_mapper', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end
$fix$;

alter table public.accounting_exports enable row level security;
alter table public.accounting_exports force row level security;
drop policy if exists accounting_exports_select_mapper on public.accounting_exports;
drop policy if exists accounting_exports_write_mapper on public.accounting_exports;
drop policy if exists accounting_exports_insert_mapper on public.accounting_exports;
drop policy if exists accounting_exports_update_mapper on public.accounting_exports;
create policy accounting_exports_select_mapper on public.accounting_exports
  for select to authenticated
  using (public.contpaq_mapper_company_access(company_id));
create policy accounting_exports_insert_mapper on public.accounting_exports
  for insert to authenticated
  with check (public.contpaq_mapper_company_access(company_id));
create policy accounting_exports_update_mapper on public.accounting_exports
  for update to authenticated
  using (public.contpaq_mapper_company_access(company_id))
  with check (public.contpaq_mapper_company_access(company_id));
-- Sin política DELETE: el ledger no se borra, se cancela.
revoke all on table public.accounting_exports from anon, authenticated;
grant select, insert, update on table public.accounting_exports to authenticated;
grant all on table public.accounting_exports to service_role;

-- Postcheck: la migración se niega a terminar si el contrato no quedó -------
do $post$
begin
  if not exists (select 1 from pg_constraint
      where conname = 'bank_account_mappings_company_scope_fkey' and contype = 'f') then
    raise exception 'fb_forward_fix: falta FK compuesta bank_account_mappings→company_bank_accounts';
  end if;
  if not exists (select 1 from pg_constraint
      where conname = 'accounting_exports_reversal_same_company_fkey' and contype = 'f') then
    raise exception 'fb_forward_fix: falta FK compuesta accounting_exports.reversal_of';
  end if;
  if exists (select 1 from pg_policies
      where tablename in ('account_report_lines','tax_account_mappings','provider_account_mappings',
                          'bank_account_mappings','contpaq_terceros','accounting_exports')
        and (cmd = 'ALL' or 'public' = any(roles::text[]))) then
    raise exception 'fb_forward_fix: quedó una política FOR ALL o sin TO authenticated';
  end if;
  if exists (select 1 from pg_policies
      where tablename = 'accounting_exports' and cmd = 'DELETE') then
    raise exception 'fb_forward_fix: accounting_exports no admite DELETE';
  end if;
  if exists (select 1 from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'
        and table_name in ('account_report_lines','tax_account_mappings','provider_account_mappings',
                           'bank_account_mappings','contpaq_terceros','accounting_exports')) then
    raise exception 'fb_forward_fix: anon conserva privilegios';
  end if;
end
$post$;
