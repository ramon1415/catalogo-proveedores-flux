begin;

do $precheck$
declare
  v_source text;
begin
  if to_regprocedure(
    'public.mark_payment_request_material_change()'
  ) is null then
    raise exception
      'layout_source_account_precheck: material-change function is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_info
    join pg_class relation_info
      on relation_info.oid = trigger_info.tgrelid
    where relation_info.oid = 'public.payment_requests'::regclass
      and trigger_info.tgname = 'mark_payment_request_material_change'
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled <> 'D'
  ) then
    raise exception
      'layout_source_account_precheck: material-change trigger is missing or disabled';
  end if;

  select lower(function_info.prosrc)
    into v_source
  from pg_proc function_info
  where function_info.oid =
    'public.mark_payment_request_material_change()'::regprocedure;

  if position('old.company_bank_account_id' in v_source) = 0
     or position('old.amount_requested' in v_source) = 0
     or position('old.payment_reference' in v_source) = 0 then
    raise exception
      'layout_source_account_precheck: unexpected material-change baseline';
  end if;
end
$precheck$;

create or replace function public.mark_payment_request_material_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.approval_material_updated_at := clock_timestamp();
    return new;
  end if;

  if pg_trigger_depth() > 1
     and new.approval_material_updated_at is distinct from old.approval_material_updated_at then
    return new;
  end if;

  if row(
    old.provider_id,
    old.provider_bank_account_id,
    old.proveedor_id,
    old.company_id,
    old.cost_center_id,
    old.budget_category_id,
    old.amount_requested,
    old.currency,
    old.exchange_rate,
    old.request_type,
    old.payment_method,
    old.due_date,
    old.scheduled_payment_date,
    old.payment_reference,
    old.payment_concept
  ) is distinct from row(
    new.provider_id,
    new.provider_bank_account_id,
    new.proveedor_id,
    new.company_id,
    new.cost_center_id,
    new.budget_category_id,
    new.amount_requested,
    new.currency,
    new.exchange_rate,
    new.request_type,
    new.payment_method,
    new.due_date,
    new.scheduled_payment_date,
    new.payment_reference,
    new.payment_concept
  ) then
    new.approval_material_updated_at := clock_timestamp();
  else
    new.approval_material_updated_at := old.approval_material_updated_at;
  end if;

  return new;
end
$$;

comment on function public.mark_payment_request_material_change() is
  'Advances approval materiality for the existing approval fields except company_bank_account_id, which is Layout execution data and preserves the current Direction approval.';

do $postcheck$
declare
  v_source text;
  v_security_definer boolean;
  v_settings text[];
begin
  select
    lower(function_info.prosrc),
    function_info.prosecdef,
    function_info.proconfig
    into v_source, v_security_definer, v_settings
  from pg_proc function_info
  where function_info.oid =
    'public.mark_payment_request_material_change()'::regprocedure;

  if v_security_definer
     or not exists (
       select 1
       from unnest(coalesce(v_settings, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     ) then
    raise exception
      'layout_source_account_postcheck: function security attributes changed';
  end if;

  if position('company_bank_account_id' in v_source) > 0 then
    raise exception
      'layout_source_account_postcheck: source account is still material';
  end if;

  if position('old.provider_bank_account_id' in v_source) = 0
     or position('old.due_date' in v_source) = 0
     or position('old.scheduled_payment_date' in v_source) = 0
     or position('old.payment_reference' in v_source) = 0
     or position('old.payment_concept' in v_source) = 0
     or position('old.amount_requested' in v_source) = 0
     or position(
       'new.approval_material_updated_at := old.approval_material_updated_at'
       in v_source
     ) = 0 then
    raise exception
      'layout_source_account_postcheck: unrelated materiality behavior changed';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_info
    join pg_class relation_info
      on relation_info.oid = trigger_info.tgrelid
    where relation_info.oid = 'public.payment_requests'::regclass
      and trigger_info.tgname = 'mark_payment_request_material_change'
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled <> 'D'
  ) then
    raise exception
      'layout_source_account_postcheck: material-change trigger is missing or disabled';
  end if;
end
$postcheck$;

commit;
