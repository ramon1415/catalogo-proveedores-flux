-- WS7 · Ingresos tenant: recurrentes (rentas fijas interco) + sueltos (no periódicos).
-- Tenant-scoped por company_id. Aislado del subsistema de ingresos de Operadora
-- (income_payments/billing_periods), que es single-tenant y específico de socios/eventos.

begin;

create table if not exists public.recurring_income_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payer_name text not null,
  concept text not null,
  amount numeric not null check (amount >= 0),
  currency text not null default 'MXN',
  cadence text not null default 'monthly' check (cadence in ('monthly')),
  active boolean not null default true,
  notes text,
  created_by uuid default public.current_profile_id() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recurring_income_templates_company_idx
  on public.recurring_income_templates(company_id);
create unique index if not exists recurring_income_templates_company_id_id_uidx
  on public.recurring_income_templates(company_id, id);

create table if not exists public.tenant_income_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  template_id uuid,
  period text,  -- 'YYYY-MM' para recurrentes; null para ingresos sueltos
  payer_name text not null,
  concept text not null,
  amount numeric not null check (amount >= 0),
  currency text not null default 'MXN',
  status text not null default 'pendiente' check (status in ('pendiente','cobrado','cancelado')),
  received_at date,
  source text not null default 'manual' check (source in ('manual','recurring')),
  notes text,
  created_by uuid default public.current_profile_id() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tenant_income_entries
  drop constraint if exists tenant_income_entries_template_id_fkey;
alter table public.tenant_income_entries
  drop constraint if exists tenant_income_entries_company_template_fk;
alter table public.tenant_income_entries
  add constraint tenant_income_entries_company_template_fk
  foreign key (company_id, template_id)
  references public.recurring_income_templates(company_id, id)
  on delete set null (template_id);
create index if not exists tenant_income_entries_company_period_idx
  on public.tenant_income_entries(company_id, period);
-- evita doble generación del mismo template en el mismo periodo (los sueltos, template null, no aplican)
create unique index if not exists tenant_income_entries_recurring_unique
  on public.tenant_income_entries(template_id, period)
  where template_id is not null and period is not null;

drop trigger if exists recurring_income_templates_set_updated_at
  on public.recurring_income_templates;
create trigger recurring_income_templates_set_updated_at
  before update on public.recurring_income_templates
  for each row execute function public.set_updated_at();
drop trigger if exists tenant_income_entries_set_updated_at
  on public.tenant_income_entries;
create trigger tenant_income_entries_set_updated_at
  before update on public.tenant_income_entries
  for each row execute function public.set_updated_at();

-- RLS: aislamiento por empresa (solo miembros activos de la company_id)
alter table public.recurring_income_templates enable row level security;
alter table public.tenant_income_entries enable row level security;

revoke all privileges on table
  public.recurring_income_templates,
  public.tenant_income_entries
from public, anon, authenticated, service_role;
grant select, insert, update, delete on table
  public.recurring_income_templates,
  public.tenant_income_entries
to authenticated, service_role;

drop policy if exists recurring_income_templates_rw
  on public.recurring_income_templates;
create policy recurring_income_templates_rw on public.recurring_income_templates
  for all to authenticated
  using (public.has_active_company_membership(public.current_profile_id(), company_id))
  with check (public.has_active_company_membership(public.current_profile_id(), company_id));

drop policy if exists tenant_income_entries_rw
  on public.tenant_income_entries;
create policy tenant_income_entries_rw on public.tenant_income_entries
  for all to authenticated
  using (public.has_active_company_membership(public.current_profile_id(), company_id))
  with check (public.has_active_company_membership(public.current_profile_id(), company_id));

-- Generador idempotente: crea las entradas del periodo desde los templates activos.
create or replace function public.generate_recurring_income(p_company_id uuid, p_period text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count integer := 0;
begin
  if auth.uid() is null
     or not public.has_active_company_membership(public.current_profile_id(), p_company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_period' using errcode = '22007';
  end if;
  insert into public.tenant_income_entries
    (company_id, template_id, period, payer_name, concept, amount, currency, status, source, created_by)
  select t.company_id, t.id, p_period, t.payer_name, t.concept, t.amount, t.currency,
         'pendiente', 'recurring', public.current_profile_id()
  from public.recurring_income_templates t
  where t.company_id = p_company_id and t.active
    and not exists (
      select 1 from public.tenant_income_entries e
      where e.template_id = t.id and e.period = p_period
    );
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.generate_recurring_income(uuid, text) from public, anon;
grant execute on function public.generate_recurring_income(uuid, text) to authenticated, service_role;

commit;
