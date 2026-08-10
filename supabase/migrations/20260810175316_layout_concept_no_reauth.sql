begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.payment_requests in share row exclusive mode;

do $install_layout_concept_no_reauth$
declare
  v_source text;
  v_source_hash text;
  v_security_definer boolean;
  v_settings text[];
  v_trigger_count integer;
  v_mode text;
begin
  if to_regprocedure(
    'public.mark_payment_request_material_change()'
  ) is null then
    raise exception
      'layout_concept_no_reauth: material-change function is missing';
  end if;

  select
    lower(function_info.prosrc),
    encode(digest(function_info.prosrc, 'sha256'), 'hex'),
    function_info.prosecdef,
    function_info.proconfig
    into
      v_source,
      v_source_hash,
      v_security_definer,
      v_settings
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
      'layout_concept_no_reauth: unexpected function security attributes';
  end if;

  select count(*)
    into v_trigger_count
  from pg_trigger trigger_info
  where trigger_info.tgrelid = 'public.payment_requests'::regclass
    and trigger_info.tgname = 'mark_payment_request_material_change'
    and trigger_info.tgfoid =
      'public.mark_payment_request_material_change()'::regprocedure
    and not trigger_info.tgisinternal
    and trigger_info.tgenabled = 'O';

  if v_trigger_count <> 1 then
    raise exception
      'layout_concept_no_reauth: expected one enabled material-change trigger, found %',
      v_trigger_count;
  end if;

  if v_source_hash =
       'f7e00297d9231902de5fe07d0aed312e78bf8995c4082851a88251523b7cd677'
  then
    v_mode := 'dev';
  elsif v_source_hash =
       '8837b98b29bc299b507837c9c3909aa2efb5181ef76033bcdf9667aa9ad00ce8'
  then
    v_mode := 'prod';
  elsif position('old.payment_concept' in v_source) = 0
        and position('old.concept' in v_source) = 0
        and position('old.description' in v_source) = 0
        and position('old.amount_requested' in v_source) > 0
        and position('old.currency' in v_source) > 0
        and position('old.payment_method' in v_source) > 0 then
    v_mode := 'already_installed';
  else
    raise exception
      'layout_concept_no_reauth: unexpected material-change baseline %',
      v_source_hash;
  end if;

  if v_mode = 'dev' then
    execute $dev_function$
      create or replace function public.mark_payment_request_material_change()
      returns trigger
      language plpgsql
      set search_path = public, pg_temp
      as $function_body$
      begin
        if tg_op = 'INSERT' then
          new.approval_material_updated_at := clock_timestamp();
          return new;
        end if;

        if row(
          old.company_id,
          old.requested_by,
          old.proveedor_id,
          old.provider_id,
          old.cost_center_id,
          old.budget_category_id,
          old.budget_month,
          old.amount_requested,
          old.currency,
          old.exchange_rate,
          old.request_type,
          old.payment_method,
          old.is_extraordinary_adjustment
        ) is distinct from row(
          new.company_id,
          new.requested_by,
          new.proveedor_id,
          new.provider_id,
          new.cost_center_id,
          new.budget_category_id,
          new.budget_month,
          new.amount_requested,
          new.currency,
          new.exchange_rate,
          new.request_type,
          new.payment_method,
          new.is_extraordinary_adjustment
        ) then
          new.approval_material_updated_at := clock_timestamp();
        else
          new.approval_material_updated_at :=
            old.approval_material_updated_at;
        end if;

        return new;
      end
      $function_body$
    $dev_function$;
  elsif v_mode = 'prod' then
    execute $prod_function$
      create or replace function public.mark_payment_request_material_change()
      returns trigger
      language plpgsql
      set search_path = public, pg_temp
      as $function_body$
      begin
        if tg_op = 'INSERT' then
          new.approval_material_updated_at := clock_timestamp();
          return new;
        end if;

        if pg_trigger_depth() > 1
           and new.approval_material_updated_at is distinct from
               old.approval_material_updated_at then
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
          old.payment_method
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
          new.payment_method
        ) then
          new.approval_material_updated_at := clock_timestamp();
        else
          new.approval_material_updated_at :=
            old.approval_material_updated_at;
        end if;

        return new;
      end
      $function_body$
    $prod_function$;
  end if;
end
$install_layout_concept_no_reauth$;

comment on function public.mark_payment_request_material_change() is
  'Advances approval materiality for economic/request identity changes while preserving Direction approval for Layout execution data, including payment concept.';

do $postcheck_layout_concept_no_reauth$
declare
  v_source text;
  v_trigger_count integer;
begin
  select lower(function_info.prosrc)
    into v_source
  from pg_proc function_info
  where function_info.oid =
    'public.mark_payment_request_material_change()'::regprocedure;

  if v_source is null
     or position('old.payment_concept' in v_source) > 0
     or position('old.concept' in v_source) > 0
     or position('old.description' in v_source) > 0
     or position('old.amount_requested' in v_source) = 0
     or position('old.currency' in v_source) = 0
     or position('old.payment_method' in v_source) = 0
     or position('company_bank_account_id' in v_source) > 0
     or position('old.due_date' in v_source) > 0
     or position('old.scheduled_payment_date' in v_source) > 0
     or position('old.payment_reference' in v_source) > 0 then
    raise exception
      'layout_concept_no_reauth: installed materiality contract is invalid';
  end if;

  select count(*)
    into v_trigger_count
  from pg_trigger trigger_info
  where trigger_info.tgrelid = 'public.payment_requests'::regclass
    and trigger_info.tgname = 'mark_payment_request_material_change'
    and trigger_info.tgfoid =
      'public.mark_payment_request_material_change()'::regprocedure
    and not trigger_info.tgisinternal
    and trigger_info.tgenabled = 'O';

  if v_trigger_count <> 1 then
    raise exception
      'layout_concept_no_reauth: trigger postcheck failed';
  end if;
end
$postcheck_layout_concept_no_reauth$;

create temporary table layout_concept_materiality_probe
  (like public.payment_requests including defaults including generated)
  on commit drop;

create trigger mark_payment_request_material_change_probe
before insert or update on layout_concept_materiality_probe
for each row
execute function public.mark_payment_request_material_change();

insert into layout_concept_materiality_probe
select request.*
from public.payment_requests request
where request.amount_requested is not null
order by request.created_at, request.id
limit 1;

do $probe_layout_concept_no_reauth$
declare
  v_row_count integer;
  v_before timestamptz;
  v_after_concept timestamptz;
  v_after_amount timestamptz;
begin
  select count(*), min(approval_material_updated_at)
    into v_row_count, v_before
  from layout_concept_materiality_probe;

  if v_row_count <> 1 or v_before is null then
    raise exception
      'layout_concept_no_reauth: could not build the isolated trigger probe';
  end if;

  update layout_concept_materiality_probe
  set
    payment_concept = coalesce(payment_concept, '') || ' [probe]',
    concept = coalesce(concept, '') || ' [probe]',
    description = coalesce(description, '') || ' [probe]';

  select approval_material_updated_at
    into v_after_concept
  from layout_concept_materiality_probe;

  if v_after_concept is distinct from v_before then
    raise exception
      'layout_concept_no_reauth: concept-only probe advanced materiality';
  end if;

  perform pg_sleep(0.002);

  update layout_concept_materiality_probe
  set amount_requested = amount_requested + 0.01;

  select approval_material_updated_at
    into v_after_amount
  from layout_concept_materiality_probe;

  if v_after_amount is not distinct from v_after_concept then
    raise exception
      'layout_concept_no_reauth: amount probe did not advance materiality';
  end if;
end
$probe_layout_concept_no_reauth$;

drop table layout_concept_materiality_probe;

commit;
