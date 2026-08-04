-- Flux Operadora - Migracion 004a
-- Versionado formal de public.historical_actuals desde auditoria DEV read-only.
-- Evidencia fuente: Deploy Supabase DEV Manual run 28544701584.
-- No copia datos y no altera filas existentes.

create table if not exists public."historical_actuals" (
  "id" uuid not null default gen_random_uuid(),
  "company_id" uuid,
  "account_code" text not null,
  "account_name" text,
  "period_month" date not null,
  "amount" numeric not null,
  "source" text not null default 'historical'::text,
  "created_at" timestamp with time zone not null default now(),
  constraint "historical_actuals_pkey" primary key ("id"),
  constraint "historical_actuals_company_id_account_code_period_month_key" unique ("company_id", "account_code", "period_month"),
  constraint "historical_actuals_company_id_fkey" foreign key ("company_id") references public."companies"("id")
);

alter table public."historical_actuals" enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'historical_actuals'
      and policyname = 'historical_actuals_select'
  ) then
    create policy "historical_actuals_select"
      on public."historical_actuals"
      as permissive
      for select
      to authenticated
      using (current_user_has_role(flux_member_roles()));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'historical_actuals'
      and policyname = 'historical_actuals_write'
  ) then
    create policy "historical_actuals_write"
      on public."historical_actuals"
      as permissive
      for all
      to authenticated
      using (current_user_has_role(flux_finance_roles()))
      with check (current_user_has_role(flux_finance_roles()));
  end if;
end
$$;

grant select, insert, update, delete on table public."historical_actuals" to authenticated;
