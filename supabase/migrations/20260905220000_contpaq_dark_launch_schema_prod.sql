begin;

-- CONTPAQ dark launch PROD. ADITIVO: no reemplaza RPCs de pagos,
-- reembolsos, layouts, presupuestos ni notificaciones existentes.
do $pre$
begin
  if to_regclass('public.companies') is null
     or to_regclass('public.budget_categories') is null
     or to_regclass('public.company_cost_center_budget_categories') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.proveedores') is null
     or to_regclass('public.company_bank_accounts') is null
     or to_regclass('public.payment_requests') is null then
    raise exception 'contpaq_dark_launch_core_prerequisite_missing';
  end if;
  if to_regclass('public.contpaq_accounts') is not null
     or to_regclass('public.budget_account_mappings') is not null
     or to_regclass('public.accounting_exports') is not null then
    raise exception 'contpaq_dark_launch_target_already_exists';
  end if;
end
$pre$;

create or replace function public.contpaq_dark_launch_access(p_company_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select public.current_user_has_role(public.flux_sysadmin_roles());
$$;
revoke all on function public.contpaq_dark_launch_access(uuid) from public, anon;
grant execute on function public.contpaq_dark_launch_access(uuid) to authenticated, service_role;

create table public.contpaq_accounts (
  company_id uuid not null references public.companies(id),
  code text not null,
  name text not null,
  is_detail boolean not null default false,
  sat_group text,
  cta_sup text,
  cta_mayor smallint,
  tipo text,
  rubro_nif text,
  activo boolean not null default true,
  sincronizado_el timestamptz default now(),
  created_at timestamptz not null default now(),
  primary key (company_id, code),
  constraint contpaq_accounts_code_normalized_check check (code ~ '^[0-9A-Za-z]+$'),
  constraint contpaq_accounts_cta_sup_normalized_check check (cta_sup is null or cta_sup ~ '^[0-9A-Za-z]+$'),
  constraint contpaq_accounts_cta_mayor_check check (cta_mayor is null or cta_mayor between 1 and 4),
  constraint contpaq_accounts_tipo_check check (tipo is null or upper(tipo) = any(array['A','B','D','E','F','G','H','K','L']::text[]))
);
create index contpaq_accounts_parent_idx on public.contpaq_accounts(company_id,cta_sup);
create index contpaq_accounts_mapper_idx on public.contpaq_accounts(company_id,activo,tipo,cta_mayor);

create table public.budget_account_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  budget_category_id uuid not null references public.budget_categories(id),
  contpaq_account_code text not null,
  needs_review boolean not null default false,
  mapping_method text not null default 'manual' check (mapping_method = any(array['exact_name','judgment','manual','imported']::text[])),
  mapping_reason text,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (company_id,budget_category_id),
  constraint budget_account_mappings_company_account_fkey
    foreign key (company_id,contpaq_account_code)
    references public.contpaq_accounts(company_id,code)
);
create index budget_account_mappings_account_idx on public.budget_account_mappings(company_id,contpaq_account_code);
create index budget_account_mappings_review_idx on public.budget_account_mappings(company_id,needs_review) where needs_review;

create or replace view public.contpaq_account_mapper_candidates
with (security_invoker=true)
as
select a.company_id,a.code,a.name,a.is_detail,a.sat_group,a.cta_sup,a.cta_mayor,a.tipo,a.rubro_nif,a.activo,a.sincronizado_el,
       not exists(select 1 from public.contpaq_accounts ch where ch.company_id=a.company_id and ch.cta_sup=a.code) as es_hoja,
       (a.activo and a.sincronizado_el is not null and a.cta_mayor=2 and upper(a.tipo)='G'
         and not exists(select 1 from public.contpaq_accounts ch where ch.company_id=a.company_id and ch.cta_sup=a.code)) as elegible_mapper
from public.contpaq_accounts a;

create or replace function public.assert_budget_account_mapping_eligible()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare v_account public.contpaq_accounts%rowtype;
begin
  if not public.contpaq_dark_launch_access(new.company_id) and current_user not in ('postgres','service_role','supabase_admin') then
    raise exception using errcode='42501',message='contpaq_dark_launch_sysadmin_required';
  end if;
  if not exists (
    select 1 from public.company_cost_center_budget_categories ccb
    where ccb.company_id=new.company_id and ccb.budget_category_id=new.budget_category_id and coalesce(ccb.active,true)
  ) then
    raise exception using errcode='23503',message='contpaq_budget_category_not_enabled_for_company';
  end if;
  select * into v_account from public.contpaq_accounts
    where company_id=new.company_id and code=new.contpaq_account_code;
  if not found then raise exception using errcode='23503',message='contpaq_mapping_account_not_found'; end if;
  if not v_account.activo or v_account.sincronizado_el is null then raise exception using errcode='23514',message='contpaq_mapping_account_inactive'; end if;
  if not v_account.is_detail or v_account.cta_mayor<>2 then raise exception using errcode='23514',message='contpaq_mapping_account_not_detail'; end if;
  if upper(v_account.tipo)<>'G' then raise exception using errcode='23514',message='contpaq_mapping_account_not_expense'; end if;
  if exists(select 1 from public.contpaq_accounts ch where ch.company_id=new.company_id and ch.cta_sup=new.contpaq_account_code) then
    raise exception using errcode='23514',message='contpaq_mapping_account_has_children';
  end if;
  new.updated_at:=now();
  if tg_op='UPDATE' then new.created_at:=old.created_at; end if;
  return new;
end;
$$;
revoke all on function public.assert_budget_account_mapping_eligible() from public,anon;
grant execute on function public.assert_budget_account_mapping_eligible() to authenticated,service_role;
create trigger budget_account_mappings_eligible_guard
  before insert or update of company_id,budget_category_id,contpaq_account_code
  on public.budget_account_mappings for each row
  execute function public.assert_budget_account_mapping_eligible();

create table public.account_report_lines (
  company_id uuid not null references public.companies(id),
  account_code text not null,
  layer text not null check(layer in ('balance','resultados','anexo')),
  line_name text not null,
  created_at timestamptz not null default now(),
  primary key(company_id,account_code,layer)
);

create table public.accounting_exports (
  id uuid primary key default gen_random_uuid(),
  source_feeder text not null,
  source_id text not null,
  source_kind text not null default 'directo' check(source_kind in ('provision','pago','directo')),
  company_id uuid not null references public.companies(id),
  tipo_pol int not null,
  folio int not null,
  periodo date not null,
  uuid_cfdi text,
  status text not null check(status in ('exported','cancelled')),
  content_hash text not null,
  exported_at timestamptz not null default now(),
  cancelled_at timestamptz,
  reversal_of uuid,
  unique(company_id,id),
  constraint accounting_exports_reversal_same_company_fkey
    foreign key(company_id,reversal_of) references public.accounting_exports(company_id,id)
);
create unique index accounting_exports_source_vigente_uq
  on public.accounting_exports(source_feeder,source_id,source_kind) where status='exported';
create index accounting_exports_source_idx on public.accounting_exports(source_feeder,source_id);
create index accounting_exports_company_periodo_idx on public.accounting_exports(company_id,periodo);
create index accounting_exports_uuid_cfdi_idx on public.accounting_exports(uuid_cfdi) where uuid_cfdi is not null;
create index accounting_exports_company_reversal_of_idx on public.accounting_exports(company_id,reversal_of) where reversal_of is not null;

create table public.tax_account_mappings (
  company_id uuid not null references public.companies(id),
  tax_key text not null check(tax_key in ('ivaAcreditablePagado','ivaRetenidoAcreditable','retIvaPasivo','retIsrPasivo','ivaPendiente','ajusteRedondeo','noDeducibles')),
  contpaq_account_code text not null,
  needs_review boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(company_id,tax_key),
  foreign key(company_id,contpaq_account_code) references public.contpaq_accounts(company_id,code)
);

create table public.provider_account_mappings (
  company_id uuid not null references public.companies(id),
  proveedor_id uuid not null references public.proveedores(id),
  contpaq_account_code text not null,
  contpaq_provider_id text,
  updated_at timestamptz not null default now(),
  primary key(company_id,proveedor_id),
  foreign key(company_id,contpaq_account_code) references public.contpaq_accounts(company_id,code)
);
create index provider_account_mappings_proveedor_id_idx on public.provider_account_mappings(proveedor_id);

create unique index if not exists company_bank_accounts_company_id_id_uq
  on public.company_bank_accounts(company_id,id);
create table public.bank_account_mappings (
  company_id uuid not null references public.companies(id),
  company_bank_account_id uuid not null,
  contpaq_account_code text not null,
  updated_at timestamptz not null default now(),
  primary key(company_id,company_bank_account_id),
  foreign key(company_id,company_bank_account_id) references public.company_bank_accounts(company_id,id),
  foreign key(company_id,contpaq_account_code) references public.contpaq_accounts(company_id,code)
);
create index bank_account_mappings_company_bank_account_id_idx on public.bank_account_mappings(company_bank_account_id);

create table public.contpaq_terceros (
  company_id uuid not null references public.companies(id),
  id_contpaq text not null,
  nombre text not null,
  rfc text,
  tipo_tercero text,
  sincronizado_el timestamptz not null default now(),
  primary key(company_id,id_contpaq)
);

alter table public.payment_requests add column if not exists cfdi_data jsonb;
comment on column public.payment_requests.cfdi_data is
  'CFDI parseado al subir la factura; snapshot opcional para el feeder CONTPAQ.';

-- Dark launch: todas las tablas nuevas quedan detrás de SysAdmin.
do $rls$
declare t text;
begin
  foreach t in array array['contpaq_accounts','budget_account_mappings','account_report_lines','tax_account_mappings','provider_account_mappings','bank_account_mappings','contpaq_terceros','accounting_exports'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated',t);
    execute format('grant select on table public.%I to authenticated',t);
    execute format('grant all on table public.%I to service_role',t);
    execute format('create policy %I on public.%I for select to authenticated using (public.contpaq_dark_launch_access(company_id))',t||'_select_dark',t);
  end loop;
end
$rls$;
grant insert,update,delete on public.budget_account_mappings,public.tax_account_mappings,public.provider_account_mappings,public.bank_account_mappings to authenticated;
grant insert,update on public.accounting_exports to authenticated;
create policy budget_account_mappings_insert_dark on public.budget_account_mappings for insert to authenticated with check(public.contpaq_dark_launch_access(company_id));
create policy budget_account_mappings_update_dark on public.budget_account_mappings for update to authenticated using(public.contpaq_dark_launch_access(company_id)) with check(public.contpaq_dark_launch_access(company_id));
create policy budget_account_mappings_delete_dark on public.budget_account_mappings for delete to authenticated using(public.contpaq_dark_launch_access(company_id));
create policy tax_account_mappings_insert_dark on public.tax_account_mappings for insert to authenticated with check(public.contpaq_dark_launch_access(company_id));
create policy tax_account_mappings_update_dark on public.tax_account_mappings for update to authenticated using(public.contpaq_dark_launch_access(company_id)) with check(public.contpaq_dark_launch_access(company_id));
create policy tax_account_mappings_delete_dark on public.tax_account_mappings for delete to authenticated using(public.contpaq_dark_launch_access(company_id));
create policy provider_account_mappings_insert_dark on public.provider_account_mappings for insert to authenticated with check(public.contpaq_dark_launch_access(company_id));
create policy provider_account_mappings_update_dark on public.provider_account_mappings for update to authenticated using(public.contpaq_dark_launch_access(company_id)) with check(public.contpaq_dark_launch_access(company_id));
create policy provider_account_mappings_delete_dark on public.provider_account_mappings for delete to authenticated using(public.contpaq_dark_launch_access(company_id));
create policy bank_account_mappings_insert_dark on public.bank_account_mappings for insert to authenticated with check(public.contpaq_dark_launch_access(company_id));
create policy bank_account_mappings_update_dark on public.bank_account_mappings for update to authenticated using(public.contpaq_dark_launch_access(company_id)) with check(public.contpaq_dark_launch_access(company_id));
create policy bank_account_mappings_delete_dark on public.bank_account_mappings for delete to authenticated using(public.contpaq_dark_launch_access(company_id));
create policy accounting_exports_insert_dark on public.accounting_exports for insert to authenticated with check(public.contpaq_dark_launch_access(company_id));
create policy accounting_exports_update_dark on public.accounting_exports for update to authenticated using(public.contpaq_dark_launch_access(company_id)) with check(public.contpaq_dark_launch_access(company_id));

revoke all on table public.contpaq_account_mapper_candidates from public,anon;
grant select on table public.contpaq_account_mapper_candidates to authenticated,service_role;

create or replace function public.confirm_provider_account(
  p_company_id uuid,
  p_proveedor_id uuid,
  p_account_code text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_code text:=upper(regexp_replace(coalesce(p_account_code,''),'[^0-9A-Za-z]','','g'));
begin
  if not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception using errcode='42501',message='contpaq_dark_launch_sysadmin_required';
  end if;
  if p_proveedor_id is null then raise exception using errcode='23514',message='proveedor_id_required'; end if;
  if char_length(v_code)=0 then raise exception using errcode='23514',message='account_code_required'; end if;
  if not exists(select 1 from public.contpaq_accounts a where a.company_id=p_company_id and a.code=v_code and a.is_detail and a.activo) then
    raise exception using errcode='23503',message='contpaq_account_not_found_or_not_detail: '||v_code;
  end if;
  insert into public.provider_account_mappings(company_id,proveedor_id,contpaq_account_code,updated_at)
  values(p_company_id,p_proveedor_id,v_code,now())
  on conflict(company_id,proveedor_id) do update
    set contpaq_account_code=excluded.contpaq_account_code,updated_at=now();
  return jsonb_build_object('ok',true,'proveedor_id',p_proveedor_id,'contpaq_account_code',v_code);
end;
$$;
revoke all on function public.confirm_provider_account(uuid,uuid,text) from public,anon;
grant execute on function public.confirm_provider_account(uuid,uuid,text) to authenticated,service_role;

do $post$
begin
  if has_table_privilege('anon','public.contpaq_accounts','select') then raise exception 'contpaq_dark_launch_anon_leak'; end if;
  if not exists(select 1 from pg_views where schemaname='public' and viewname='contpaq_account_mapper_candidates') then raise exception 'contpaq_mapper_view_missing'; end if;
  if to_regprocedure('public.confirm_provider_account(uuid,uuid,text)') is null then raise exception 'confirm_provider_account_missing'; end if;
end
$post$;

commit;
