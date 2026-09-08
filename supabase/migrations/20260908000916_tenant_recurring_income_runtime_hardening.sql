-- Forward hardening for the DEV runtime observed on 2026-09-07.
-- The original repo migration contains these protections, but the SQL recorded
-- in DEV as 20260831194350 does not. Apply explicitly; do not mark the old
-- version as equivalent without checking the actual constraints and privileges.
-- Scope: two income tables and one generator RPC. No data/backups are deleted.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Adding the FK validates existing data. A cross-company reference aborts the
-- whole transaction; this migration does not reassign or delete invalid rows.
create unique index if not exists recurring_income_templates_company_id_id_uidx
  on public.recurring_income_templates(company_id, id);

alter table public.tenant_income_entries
  drop constraint if exists tenant_income_entries_template_id_fkey;
alter table public.tenant_income_entries
  drop constraint if exists tenant_income_entries_company_template_fk;
alter table public.tenant_income_entries
  add constraint tenant_income_entries_company_template_fk
  foreign key (company_id, template_id)
  references public.recurring_income_templates(company_id, id)
  on delete set null (template_id);

create index if not exists tenant_income_entries_company_template_idx
  on public.tenant_income_entries(company_id, template_id);

-- RLS does not restrict TRUNCATE. Keep only CRUD for authenticated/service_role.
revoke all privileges on table
  public.recurring_income_templates,
  public.tenant_income_entries
from public, anon, authenticated, service_role;
grant select, insert, update, delete on table
  public.recurring_income_templates,
  public.tenant_income_entries
to authenticated, service_role;

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
