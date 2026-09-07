-- Forward-only hardening after the six versions already applied in DEV.
-- New tables were empty when reviewed; any ambiguous legacy bank row aborts
-- instead of being assigned to the wrong company.
begin;

alter table public.employee_bank_accounts
  add column if not exists company_id uuid;

with sole_membership as (
  select profile_id, (array_agg(company_id order by company_id))[1] as company_id
  from public.profile_company_memberships
  where active
  group by profile_id
  having count(*) = 1
)
update public.employee_bank_accounts account
set company_id = membership.company_id
from sole_membership membership
where account.profile_id = membership.profile_id
  and account.company_id is null;

do $$
begin
  if exists (
    select 1 from public.employee_bank_accounts where company_id is null
  ) then
    raise exception 'employee_bank_accounts_company_backfill_ambiguous';
  end if;
end
$$;

alter table public.employee_bank_accounts
  alter column company_id set not null;

alter table public.employee_bank_accounts
  drop constraint if exists employee_bank_accounts_pkey;
alter table public.employee_bank_accounts
  add constraint employee_bank_accounts_pkey
  primary key (profile_id, company_id);

alter table public.employee_bank_accounts
  drop constraint if exists employee_bank_accounts_company_id_fkey;
alter table public.employee_bank_accounts
  add constraint employee_bank_accounts_company_id_fkey
  foreign key (company_id) references public.companies (id) on delete cascade;

alter table public.employee_bank_accounts
  drop constraint if exists employee_bank_accounts_membership_fkey;
alter table public.employee_bank_accounts
  add constraint employee_bank_accounts_membership_fkey
  foreign key (profile_id, company_id)
  references public.profile_company_memberships (profile_id, company_id)
  on delete cascade;

create index if not exists employee_bank_accounts_company_idx
  on public.employee_bank_accounts (company_id, profile_id);

alter table public.employee_bank_accounts enable row level security;
alter table public.employee_bank_accounts force row level security;
drop policy if exists employee_bank_accounts_select on public.employee_bank_accounts;
drop policy if exists employee_bank_accounts_write_self on public.employee_bank_accounts;
drop policy if exists employee_bank_accounts_insert on public.employee_bank_accounts;
drop policy if exists employee_bank_accounts_update on public.employee_bank_accounts;
drop policy if exists employee_bank_accounts_delete on public.employee_bank_accounts;

create policy employee_bank_accounts_select
  on public.employee_bank_accounts
  for select to authenticated
  using (
    (
      profile_id = public.current_profile_id()
      and public.has_active_company_membership(
        public.current_profile_id(), company_id
      )
    )
    or private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  );

create policy employee_bank_accounts_insert
  on public.employee_bank_accounts
  for insert to authenticated
  with check (
    (
      profile_id = public.current_profile_id()
      and public.has_active_company_membership(
        public.current_profile_id(), company_id
      )
    )
    or private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  );

create policy employee_bank_accounts_update
  on public.employee_bank_accounts
  for update to authenticated
  using (
    (
      profile_id = public.current_profile_id()
      and public.has_active_company_membership(
        public.current_profile_id(), company_id
      )
    )
    or private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  )
  with check (
    (
      profile_id = public.current_profile_id()
      and public.has_active_company_membership(
        public.current_profile_id(), company_id
      )
    )
    or private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  );

create policy employee_bank_accounts_delete
  on public.employee_bank_accounts
  for delete to authenticated
  using (
    (
      profile_id = public.current_profile_id()
      and public.has_active_company_membership(
        public.current_profile_id(), company_id
      )
    )
    or private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  );

revoke all on table public.employee_bank_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.employee_bank_accounts to authenticated;
grant select, insert, update, delete on table public.employee_bank_accounts to service_role;

alter table public.reimbursement_items
  add column if not exists company_id uuid;

update public.reimbursement_items item
set company_id = request.company_id
from public.payment_requests request
where request.id = item.payment_request_id
  and item.company_id is null;

do $$
begin
  if exists (
    select 1 from public.reimbursement_items where company_id is null
  ) then
    raise exception 'reimbursement_items_company_backfill_failed';
  end if;
end
$$;

alter table public.reimbursement_items
  alter column company_id set not null;

create unique index if not exists payment_requests_company_id_id_uq
  on public.payment_requests (company_id, id);

alter table public.reimbursement_items
  drop constraint if exists reimbursement_items_payment_request_id_fkey;
alter table public.reimbursement_items
  drop constraint if exists reimbursement_items_request_company_fkey;
alter table public.reimbursement_items
  add constraint reimbursement_items_request_company_fkey
  foreign key (company_id, payment_request_id)
  references public.payment_requests (company_id, id)
  on delete cascade;

drop index if exists public.reimbursement_items_uuid_unique;
create unique index reimbursement_items_company_uuid_unique
  on public.reimbursement_items (company_id, upper(invoice_uuid))
  where invoice_uuid is not null;

create index if not exists reimbursement_items_company_request_idx
  on public.reimbursement_items (company_id, payment_request_id);

alter table public.reimbursement_items enable row level security;
alter table public.reimbursement_items force row level security;
drop policy if exists reimbursement_items_all on public.reimbursement_items;
drop policy if exists reimbursement_items_select on public.reimbursement_items;
drop policy if exists reimbursement_items_insert on public.reimbursement_items;
drop policy if exists reimbursement_items_update on public.reimbursement_items;
drop policy if exists reimbursement_items_delete on public.reimbursement_items;

create policy reimbursement_items_select
  on public.reimbursement_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.payment_requests request
      where request.id = reimbursement_items.payment_request_id
        and request.company_id = reimbursement_items.company_id
    )
  );

create policy reimbursement_items_insert
  on public.reimbursement_items
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.payment_requests request
      where request.id = reimbursement_items.payment_request_id
        and request.company_id = reimbursement_items.company_id
        and (
          request.requested_by = public.current_profile_id()
          or private.current_profile_has_company_role(
            reimbursement_items.company_id, array['finance','sysadmin']::text[]
          )
        )
    )
  );

create policy reimbursement_items_update
  on public.reimbursement_items
  for update to authenticated
  using (
    exists (
      select 1
      from public.payment_requests request
      where request.id = reimbursement_items.payment_request_id
        and request.company_id = reimbursement_items.company_id
        and (
          request.requested_by = public.current_profile_id()
          or private.current_profile_has_company_role(
            reimbursement_items.company_id, array['finance','sysadmin']::text[]
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.payment_requests request
      where request.id = reimbursement_items.payment_request_id
        and request.company_id = reimbursement_items.company_id
        and (
          request.requested_by = public.current_profile_id()
          or private.current_profile_has_company_role(
            reimbursement_items.company_id, array['finance','sysadmin']::text[]
          )
        )
    )
  );

create policy reimbursement_items_delete
  on public.reimbursement_items
  for delete to authenticated
  using (
    exists (
      select 1
      from public.payment_requests request
      where request.id = reimbursement_items.payment_request_id
        and request.company_id = reimbursement_items.company_id
        and (
          request.requested_by = public.current_profile_id()
          or private.current_profile_has_company_role(
            reimbursement_items.company_id, array['finance','sysadmin']::text[]
          )
        )
    )
  );

revoke all on table public.reimbursement_items from public, anon, authenticated;
grant select, insert, update, delete on table public.reimbursement_items to authenticated;
grant select, insert, update, delete on table public.reimbursement_items to service_role;

create unique index if not exists projects_company_id_id_uq
  on public.projects (company_id, id);

alter table public.payment_requests
  drop constraint if exists payment_requests_project_id_fkey;
alter table public.payment_requests
  drop constraint if exists payment_requests_project_company_fkey;
alter table public.payment_requests
  add constraint payment_requests_project_company_fkey
  foreign key (company_id, project_id)
  references public.projects (company_id, id);

drop index if exists public.payment_requests_project_idx;
create index if not exists payment_requests_company_project_idx
  on public.payment_requests (company_id, project_id)
  where project_id is not null;

alter table public.projects enable row level security;
alter table public.projects force row level security;
drop policy if exists projects_select_members on public.projects;
drop policy if exists projects_write_finance on public.projects;
drop policy if exists projects_insert_finance on public.projects;
drop policy if exists projects_update_finance on public.projects;
drop policy if exists projects_delete_finance on public.projects;

create policy projects_select_members
  on public.projects
  for select to authenticated
  using (
    public.has_active_company_membership(
      public.current_profile_id(), company_id
    )
    or private.current_profile_has_company_role(
      company_id, array['sysadmin']::text[]
    )
  );

create policy projects_insert_finance
  on public.projects
  for insert to authenticated
  with check (
    private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  );

create policy projects_update_finance
  on public.projects
  for update to authenticated
  using (
    private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  )
  with check (
    private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  );

create policy projects_delete_finance
  on public.projects
  for delete to authenticated
  using (
    private.current_profile_has_company_role(
      company_id, array['finance','sysadmin']::text[]
    )
  );

revoke all on table public.projects from public, anon, authenticated;
grant select, insert, update, delete on table public.projects to authenticated;
grant select, insert, update, delete on table public.projects to service_role;

create or replace function private.enforce_payment_request_tenant_references()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.beneficiary_profile_id is not null
     and (
       new.company_id is null
       or not exists (
         select 1
         from public.profile_company_memberships membership
         where membership.profile_id = new.beneficiary_profile_id
           and membership.company_id = new.company_id
           and membership.active
       )
     ) then
    raise exception 'beneficiary_company_membership_required';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_payment_request_tenant_references()
  from public, anon, authenticated;

drop trigger if exists payment_requests_tenant_references_guard
  on public.payment_requests;
create trigger payment_requests_tenant_references_guard
before insert or update of company_id, beneficiary_profile_id, project_id
on public.payment_requests
for each row execute function private.enforce_payment_request_tenant_references();

create or replace function public.list_reimbursement_beneficiaries(
  p_company_id uuid
)
returns table (
  id uuid,
  full_name text,
  email text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := public.current_profile_id();
  v_can_choose boolean;
begin
  if auth.uid() is null or v_actor is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_active_company_membership(v_actor, p_company_id)
     and not private.current_profile_has_company_role(
       p_company_id, array['sysadmin']::text[]
     ) then
    raise exception 'company_membership_required';
  end if;

  v_can_choose := private.current_profile_has_company_role(
    p_company_id, array['finance','sysadmin']::text[]
  );

  return query
  select profile.id, profile.full_name, profile.email
  from public.profile_company_memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.company_id = p_company_id
    and membership.active
    and coalesce(profile.active, true)
    and (v_can_choose or profile.id = v_actor)
  order by profile.full_name nulls last, profile.email nulls last;
end;
$function$;

revoke all on function public.list_reimbursement_beneficiaries(uuid)
  from public, anon;
grant execute on function public.list_reimbursement_beneficiaries(uuid)
  to authenticated, service_role;

-- 2) Validador de layout: en reembolso se valida al EMPLEADO ------------------
-- Antes exigía proveedor y sus datos bancarios siempre, así que un reembolso
-- nunca podía completar su línea. Ahora la rama de reembolso valida contra
-- employee_bank_accounts (que es de donde saldrá la CLABE de la dispersión).
create or replace function public.payment_request_layout_missing_fields(p_request payment_requests)
 returns text[]
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company public.companies%rowtype;
  v_company_found boolean := false;
  v_company_account public.company_bank_accounts%rowtype;
  v_company_account_found boolean := false;
  v_provider public.proveedores%rowtype;
  v_provider_found boolean := false;
  v_is_reimbursement boolean := p_request.request_type = 'reimbursement'::public.payment_request_type;
  v_beneficiary public.employee_bank_accounts%rowtype;
  v_beneficiary_found boolean := false;
  v_clabe text;
  v_cuenta text;
  v_source_normalized text;
  v_payment_concept text := coalesce(
    nullif(btrim(p_request.payment_concept), ''),
    nullif(btrim(p_request.concept), ''),
    nullif(btrim(p_request.description), '')
  );
  v_missing text[];
begin
  if p_request.company_id is not null then
    select * into v_company from public.companies company where company.id = p_request.company_id;
    v_company_found := found;
  end if;

  if p_request.company_bank_account_id is not null then
    select * into v_company_account from public.company_bank_accounts company_account
    where company_account.id = p_request.company_bank_account_id;
    v_company_account_found := found;
  end if;

  if p_request.proveedor_id is not null then
    select * into v_provider from public.proveedores provider where provider.id = p_request.proveedor_id;
    v_provider_found := found;
  end if;

  if v_is_reimbursement and p_request.beneficiary_profile_id is not null then
    select * into v_beneficiary from public.employee_bank_accounts eba
    where eba.profile_id = p_request.beneficiary_profile_id
      and eba.company_id = p_request.company_id;
    v_beneficiary_found := found;
  end if;

  v_clabe := regexp_replace(coalesce(v_beneficiary.clabe, ''), '[[:space:]-]', '', 'g');
  v_cuenta := regexp_replace(coalesce(v_beneficiary.cuenta, ''), '[[:space:]-]', '', 'g');

  v_source_normalized := regexp_replace(
    coalesce(v_company_account.account_number, ''), '[[:space:]-]', '', 'g'
  );

  v_missing := array_remove(array[
    case when p_request.scheduled_payment_date is null then 'scheduled_payment_date' end,
    case when p_request.company_id is null then 'company_id' end,
    case when p_request.company_id is not null and not v_company_found then 'company_not_found' end,
    case when v_company_found and not coalesce(v_company.active, false) then 'company_inactive' end,
    case
      when v_company_found
        and coalesce(nullif(btrim(v_company.legal_name), ''), nullif(btrim(v_company.name), '')) is null
        then 'company_name'
    end,
    case when p_request.company_bank_account_id is null then 'company_bank_account_id' end,
    case
      when p_request.company_bank_account_id is not null and not v_company_account_found
        then 'company_bank_account_id_not_found'
    end,
    case
      when v_company_account_found and v_company_account.company_id is distinct from p_request.company_id
        then 'company_bank_account_company_mismatch'
    end,
    case
      when v_company_account_found and not coalesce(v_company_account.active, false)
        then 'company_bank_account_inactive'
    end,
    case
      when v_company_account_found and nullif(btrim(v_company_account.account_number), '') is null
        then 'source_account_number'
    end,
    case
      when v_company_account_found
        and nullif(btrim(v_company_account.account_number), '') is not null
        and v_source_normalized !~ '^[0-9]{1,18}$'
        then 'source_account_number_invalid'
    end,
    -- Destinatario: proveedor en el flujo normal, empleado en reembolso.
    case when not v_is_reimbursement and p_request.proveedor_id is null then 'proveedor_id' end,
    case
      when p_request.proveedor_id is not null and not v_provider_found then 'proveedor_not_found'
    end,
    case
      when not v_is_reimbursement and v_provider_found and not coalesce(v_provider.activo, false)
        then 'proveedor_inactive'
    end,
    case when v_is_reimbursement and p_request.beneficiary_profile_id is null then 'beneficiary_profile_id' end,
    case
      when v_is_reimbursement and p_request.beneficiary_profile_id is not null and not v_beneficiary_found
        then 'beneficiary_bank_account_missing'
    end,
    case
      when v_is_reimbursement and v_beneficiary_found
        and nullif(btrim(v_beneficiary.beneficiary_name), '') is null
        then 'beneficiary_name'
    end,
    case
      when v_is_reimbursement and v_beneficiary_found and nullif(btrim(v_beneficiary.banco), '') is null
        then 'beneficiary_bank'
    end,
    case
      when v_is_reimbursement and v_beneficiary_found
        and v_clabe = '' and v_cuenta = ''
        then 'beneficiary_destination'
    end,
    case
      when v_is_reimbursement and v_clabe <> '' and v_clabe !~ '^[0-9]{18}$'
        then 'beneficiary_clabe_invalid'
    end,
    case
      when nullif(btrim(p_request.payment_reference), '') is null then 'payment_reference'
    end,
    case
      when nullif(btrim(p_request.payment_reference), '') is not null
        and btrim(p_request.payment_reference) !~ '^[0-9]{1,5}$'
        then 'payment_reference_invalid'
    end,
    case when v_payment_concept is null then 'payment_concept' end,
    case
      when v_payment_concept is not null
        and (char_length(v_payment_concept) > 120 or v_payment_concept ~ '[[:cntrl:]]')
        then 'payment_concept_invalid'
    end,
    case
      when coalesce(nullif(upper(btrim(p_request.currency)), ''), 'MXN') <> 'MXN'
        then 'unsupported_layout_currency'
    end,
    case when coalesce(p_request.amount_requested, 0) <= 0 then 'invalid_amount' end
  ]::text[], null);

  -- Los requisitos bancarios del proveedor solo aplican cuando ÉL cobra.
  if v_provider_found and not v_is_reimbursement then
    v_missing := v_missing || public.provider_payment_execution_missing_fields(v_provider);
  end if;

  select coalesce(
    array_agg(distinct missing_field.field_name order by missing_field.field_name),
    array[]::text[]
  ) into v_missing
  from unnest(v_missing) as missing_field(field_name);

  return v_missing;
end
$function$;


-- El wrapper conserva intacta la función base pre_037 y sustituye el destino
-- por la cuenta bancaria del empleado cuando la solicitud es un reembolso.
create or replace function public.approval_batch_payment_layout_candidates(
  p_period_start date,
  p_period_end date,
  p_company_id uuid default null::uuid,
  p_company_bank_account_id uuid default null::uuid
)
 returns table(classification text, classification_reason text, payment_request_id uuid, request_number text, request_status text, company_id uuid, company_name text, proveedor_id uuid, provider_name text, company_bank_account_id uuid, source_account_number text, destination_type text, destination_value text, beneficiary_name text, amount numeric, currency text, payment_reference text, payment_concept text, scheduled_payment_date date, missing_fields text[], finance_approval_current boolean, direction_approval_current boolean, direction_decided_at timestamp with time zone, enforcement_required boolean, source_item_id uuid, source_batch_id uuid, source_batch_label text, source_batch_status text, director_status text, reject_reason text, rejected_by uuid, rejected_by_name text, rejected_at timestamp with time zone, rebatch_status text, latest_correction_note text, extraordinary_authorization_id uuid, extraordinary_category text, extraordinary_reason text, extraordinary_authorized_by uuid, extraordinary_authorized_by_name text, extraordinary_authorized_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select
    case
      when candidate.classification = 'ready_extraordinary'
        and not public.extraordinary_authorization_is_ready(
          candidate.extraordinary_authorization_id
        )
      then 'invalid_data'
      else candidate.classification
    end,
    case
      when candidate.classification = 'ready_extraordinary'
        and not public.extraordinary_authorization_is_ready(
          candidate.extraordinary_authorization_id
        )
      then 'extraordinary_not_ready_secure_contract'
      else candidate.classification_reason
    end,
    candidate.payment_request_id,
    candidate.request_number,
    candidate.request_status,
    candidate.company_id,
    candidate.company_name,
    candidate.proveedor_id,
    case
      when reimb.beneficiary_profile_id is not null
        then coalesce(nullif(btrim(beneficiary_bank.beneficiary_name), ''), beneficiary_profile.full_name, candidate.provider_name)
      else candidate.provider_name
    end,
    candidate.company_bank_account_id,
    candidate.source_account_number,
    case
      when reimb.beneficiary_profile_id is not null then
        case
          when regexp_replace(coalesce(beneficiary_bank.clabe, ''), '[[:space:]-]', '', 'g') <> '' then 'clabe'
          when regexp_replace(coalesce(beneficiary_bank.cuenta, ''), '[[:space:]-]', '', 'g') <> '' then 'cuenta'
          else candidate.destination_type
        end
      else candidate.destination_type
    end,
    case
      when reimb.beneficiary_profile_id is not null then
        coalesce(
          nullif(regexp_replace(coalesce(beneficiary_bank.clabe, ''), '[[:space:]-]', '', 'g'), ''),
          nullif(regexp_replace(coalesce(beneficiary_bank.cuenta, ''), '[[:space:]-]', '', 'g'), ''),
          candidate.destination_value
        )
      else candidate.destination_value
    end,
    case
      when reimb.beneficiary_profile_id is not null
        then coalesce(nullif(btrim(beneficiary_bank.beneficiary_name), ''), beneficiary_profile.full_name, candidate.beneficiary_name)
      else candidate.beneficiary_name
    end,
    candidate.amount,
    candidate.currency,
    candidate.payment_reference,
    candidate.payment_concept,
    candidate.scheduled_payment_date,
    candidate.missing_fields,
    candidate.finance_approval_current,
    candidate.direction_approval_current,
    candidate.direction_decided_at,
    candidate.enforcement_required,
    candidate.source_item_id,
    candidate.source_batch_id,
    candidate.source_batch_label,
    candidate.source_batch_status,
    candidate.director_status,
    candidate.reject_reason,
    candidate.rejected_by,
    candidate.rejected_by_name,
    candidate.rejected_at,
    candidate.rebatch_status,
    candidate.latest_correction_note,
    candidate.extraordinary_authorization_id,
    candidate.extraordinary_category,
    candidate.extraordinary_reason,
    candidate.extraordinary_authorized_by,
    candidate.extraordinary_authorized_by_name,
    candidate.extraordinary_authorized_at
  from public.approval_batch_payment_layout_candidates_pre_037(
    p_period_start,
    p_period_end,
    p_company_id,
    p_company_bank_account_id
  ) candidate
  left join public.payment_requests reimb
    on reimb.id = candidate.payment_request_id
   and reimb.request_type::text = 'reimbursement'
  left join public.employee_bank_accounts beneficiary_bank
    on beneficiary_bank.profile_id = reimb.beneficiary_profile_id
   and beneficiary_bank.company_id = candidate.company_id
  left join public.profiles beneficiary_profile
    on beneficiary_profile.id = reimb.beneficiary_profile_id
  where not exists (
    select 1
    from public.payment_requests request
    where request.id = candidate.payment_request_id
      and request.request_type::text = 'nomina'
  );
$function$;


revoke all on function public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid,
  boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text
) from public, anon;
grant execute on function public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid,
  boolean, uuid, uuid, numeric, numeric, numeric, text, uuid, text
) to authenticated, service_role;

revoke all on function public.payment_request_layout_missing_fields(public.payment_requests)
  from public, anon;
grant execute on function public.payment_request_layout_missing_fields(public.payment_requests)
  to authenticated, service_role;

revoke all on function public.approval_batch_payment_layout_candidates(date, date, uuid, uuid)
  from public, anon;
grant execute on function public.approval_batch_payment_layout_candidates(date, date, uuid, uuid)
  to authenticated, service_role;

commit;
