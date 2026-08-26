-- Remove only the legacy per-edge review-resolution rule before moving Finance
-- review authority to budget_mapping_reviews. Account eligibility, access,
-- evidence immutability and server audit stamping remain enforced.

create or replace function public.assert_budget_account_mapping_eligible()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_account public.contpaq_accounts%rowtype;
  v_actor uuid;
  v_privileged boolean := current_user in ('postgres', 'service_role', 'supabase_admin');
begin
  if not v_privileged
     and not public.contpaq_mapper_company_access(new.company_id) then
    raise exception using errcode = '42501', message = 'contpaq_mapper_company_access_denied';
  end if;

  if not v_privileged then
    if tg_op = 'INSERT' and new.mapping_evidence is not null then
      raise exception using errcode = '42501', message = 'contpaq_mapping_evidence_server_managed';
    end if;
    if tg_op = 'UPDATE' and new.mapping_evidence is distinct from old.mapping_evidence then
      raise exception using errcode = '42501', message = 'contpaq_mapping_evidence_server_managed';
    end if;
  end if;

  select * into v_account
  from public.contpaq_accounts
  where company_id = new.company_id
    and code = new.contpaq_account_code;

  if not found then
    raise exception using errcode = '23503', message = 'contpaq_mapping_account_not_found';
  end if;

  if v_account.sincronizado_el is null
     or v_account.cta_mayor is null
     or v_account.tipo is null then
    raise exception using errcode = '23514', message = 'contpaq_catalog_tree_metadata_incomplete';
  end if;

  if not v_account.activo then
    raise exception using errcode = '23514', message = 'contpaq_mapping_account_inactive';
  end if;

  if v_account.cta_mayor <> 2 or not v_account.is_detail then
    raise exception using errcode = '23514', message = 'contpaq_mapping_account_not_detail';
  end if;

  if upper(v_account.tipo) <> 'G' then
    raise exception using errcode = '23514', message = 'contpaq_mapping_account_not_expense';
  end if;

  if exists (
    select 1
    from public.contpaq_accounts child
    where child.company_id = new.company_id
      and child.cta_sup = new.contpaq_account_code
  ) then
    raise exception using errcode = '23514', message = 'contpaq_mapping_account_has_children';
  end if;

  if new.mapping_method = 'judgment' or new.needs_review then
    if coalesce(char_length(btrim(new.mapping_reason)), 0) < 8
       and coalesce(char_length(btrim(new.mapping_evidence)), 0) < 8 then
      raise exception using errcode = '23514', message = 'contpaq_mapping_evidence_required';
    end if;
  end if;

  v_actor := public.current_profile_id();
  if v_actor is not null then
    new.updated_by := v_actor;
  end if;
  new.updated_at := now();

  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;

  return new;
end;
$$;

revoke all on function public.assert_budget_account_mapping_eligible() from public;
grant execute on function public.assert_budget_account_mapping_eligible() to authenticated, service_role;
