-- Flux Operadora - Migration 026
-- Align create_cash_fund with the canonical payment_method while retaining legacy request_type fallback.

begin;

do $$
declare
  v_missing text[] := array[]::text[];
  v_column text;
  v_function record;
  v_source text;
  v_trigger_definition text;
begin
  foreach v_column in array array[
    'public.payment_requests',
    'public.cash_funds',
    'public.profiles',
    'public.approval_batches',
    'public.approval_batch_items',
    'public.approval_batch_company_settings',
    'public.payment_request_extraordinary_authorizations'
  ] loop
    if to_regclass(v_column) is null then
      v_missing := array_append(v_missing, v_column);
    end if;
  end loop;

  foreach v_column in array array[
    'request_type',
    'payment_method',
    'status',
    'amount_requested',
    'company_id',
    'operational_comments',
    'updated_at'
  ] loop
    if not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'payment_requests'
        and c.column_name = v_column
    ) then
      v_missing := array_append(v_missing, 'public.payment_requests.' || v_column);
    end if;
  end loop;

  foreach v_column in array array[
    'payment_request_id',
    'company_id',
    'responsible_profile_id',
    'assigned_amount',
    'verified_amount',
    'assignment_date',
    'due_date',
    'status',
    'delivery_method',
    'delivered_by',
    'delivered_at',
    'notes'
  ] loop
    if not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'cash_funds'
        and c.column_name = v_column
    ) then
      v_missing := array_append(v_missing, 'public.cash_funds.' || v_column);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception '026_precheck: missing required objects or columns: %', array_to_string(v_missing, ', ');
  end if;

  if to_regclass('public.intake_links') is null
     or to_regclass('public.payment_intake') is null
     or to_regclass('public.payment_intake_files') is null
     or to_regclass('public.payment_intake_events') is null
     or to_regclass('public.payment_intake_public_folio_seq') is null
     or to_regprocedure('public.next_payment_intake_public_folio()') is null then
    raise exception '026_precheck: migration 025 semantic contract is not installed';
  end if;

  if to_regprocedure('public.approval_batch_require_finance()') is null
     or to_regprocedure('public.approval_batch_request_has_current_direction_approval(uuid)') is null
     or to_regprocedure('public.approval_batch_assert_execution_authorized()') is null then
    raise exception '026_precheck: batch execution contract from migrations 021-023 is incomplete';
  end if;

  if to_regprocedure(
    'public.create_cash_fund(uuid,uuid,date,text,uuid,text)'
  ) is null then
    raise exception '026_precheck: create_cash_fund signature is missing';
  end if;

  select
    p.oid,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_function_result(p.oid) as result_type,
    l.lanname as language_name,
    p.prosecdef as security_definer,
    p.proconfig as function_settings,
    p.prosrc as function_source,
    p.pronargdefaults as default_argument_count
  into v_function
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.oid = 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)'::regprocedure;

  if v_function.identity_arguments <>
       'p_payment_request_id uuid, p_responsible_profile_id uuid, p_due_date date, p_delivery_method text, p_delivered_by uuid, p_notes text'
     or v_function.result_type <> 'jsonb'
     or v_function.language_name <> 'plpgsql'
     or not v_function.security_definer
     or v_function.default_argument_count <> 2 then
    raise exception '026_precheck: create_cash_fund contract differs from the inspected baseline';
  end if;

  v_source := lower(v_function.function_source);
  if position('v_request.request_type::text not in' in v_source) = 0
     or position('payment_request_must_be_cash_or_check' in v_source) = 0
     or position('for update' in v_source) = 0
     or position('payment_request_must_be_approved' in v_source) = 0
     or position('responsible_profile_not_found' in v_source) = 0
     or position('cash_fund_already_exists' in v_source) = 0
     or position('insert into public.cash_funds' in v_source) = 0
     or position('update public.payment_requests' in v_source) = 0 then
    raise exception '026_precheck: create_cash_fund body no longer matches the inspected legacy contract';
  end if;

  if position('v_request.payment_method' in v_source) > 0 then
    raise exception '026_precheck: canonical payment_method gate already exists; stop and reconcile migration history';
  end if;

  select pg_get_triggerdef(t.oid, true)
    into v_trigger_definition
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public'
    and c.relname = 'cash_funds'
    and t.tgname = 'require_batch_for_cash_fund'
    and p.proname = 'approval_batch_assert_execution_authorized'
    and not t.tgisinternal
    and t.tgenabled <> 'D';

  if v_trigger_definition is null
     or position('BEFORE INSERT OR UPDATE OF payment_request_id' in v_trigger_definition) = 0 then
    raise exception '026_precheck: cash_funds batch authorization trigger is missing or incompatible';
  end if;

  if not exists (
    select 1
    from pg_constraint pc
    join pg_class c on c.oid = pc.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'cash_funds'
      and pc.contype = 'u'
      and pg_get_constraintdef(pc.oid) = 'UNIQUE (payment_request_id)'
  ) then
    raise exception '026_precheck: cash_funds payment_request_id uniqueness gate is missing';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception '026_precheck: required Supabase roles are missing';
  end if;
end
$$;

create or replace function public.create_cash_fund(
  p_payment_request_id uuid,
  p_responsible_profile_id uuid,
  p_due_date date,
  p_delivery_method text,
  p_delivered_by uuid default null::uuid,
  p_notes text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_fund_id uuid;
  v_delivery_method text;
  v_request_payment_method text;
begin
  perform public.approval_batch_require_finance();

  if p_payment_request_id is null then
    raise exception 'payment_request_required';
  end if;

  if p_responsible_profile_id is null then
    raise exception 'responsible_profile_required';
  end if;

  if p_due_date is null then
    raise exception 'due_date_required';
  end if;

  v_delivery_method := lower(nullif(btrim(coalesce(p_delivery_method, '')), ''));

  if v_delivery_method not in ('cash', 'check') then
    raise exception 'invalid_delivery_method';
  end if;

  select *
  into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;

  if not found then
    raise exception 'payment_request_not_found';
  end if;

  if v_request.status::text <> 'approved' then
    raise exception 'payment_request_must_be_approved';
  end if;

  v_request_payment_method := lower(
    coalesce(
      nullif(btrim(v_request.payment_method), ''),
      nullif(btrim(v_request.request_type::text), '')
    )
  );

  v_request_payment_method := case v_request_payment_method
    when 'efectivo' then 'cash'
    when 'cheque' then 'check'
    else v_request_payment_method
  end;

  if v_request_payment_method not in ('cash', 'check') then
    raise exception 'payment_request_must_be_cash_or_check';
  end if;

  if v_delivery_method <> v_request_payment_method then
    raise exception 'delivery_method_must_match_payment_request';
  end if;

  if coalesce(v_request.amount_requested, 0) <= 0 then
    raise exception 'invalid_request_amount';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_responsible_profile_id
      and coalesce(active, true) = true
  ) then
    raise exception 'responsible_profile_not_found';
  end if;

  if p_delivered_by is not null and not exists (
    select 1
    from public.profiles
    where id = p_delivered_by
      and coalesce(active, true) = true
  ) then
    raise exception 'delivered_by_profile_not_found';
  end if;

  if exists (
    select 1
    from public.cash_funds
    where payment_request_id = p_payment_request_id
  ) then
    raise exception 'cash_fund_already_exists';
  end if;

  insert into public.cash_funds (
    company_id,
    payment_request_id,
    responsible_profile_id,
    assigned_amount,
    verified_amount,
    assignment_date,
    due_date,
    status,
    delivery_method,
    delivered_by,
    delivered_at,
    notes
  ) values (
    v_request.company_id,
    p_payment_request_id,
    p_responsible_profile_id,
    v_request.amount_requested,
    0,
    current_date,
    p_due_date,
    'pending_receipt',
    v_delivery_method,
    p_delivered_by,
    case when p_delivered_by is not null then now() else null end,
    p_notes
  )
  returning id into v_fund_id;

  -- The request is not marked paid; reconciliation remains pending.
  update public.payment_requests
  set
    operational_comments = concat_ws(
      E'\n',
      nullif(operational_comments, ''),
      'Fondo de ' || v_delivery_method || ' creado. Pendiente de comprobaciÃ³n.'
    ),
    updated_at = now()
  where id = p_payment_request_id;

  return jsonb_build_object(
    'message', 'cash_fund_created',
    'cash_fund_id', v_fund_id,
    'payment_request_id', p_payment_request_id,
    'responsible_profile_id', p_responsible_profile_id,
    'assigned_amount', v_request.amount_requested,
    'due_date', p_due_date,
    'delivery_method', v_delivery_method,
    'status', 'pending_receipt'
  );
end
$$;

revoke all on function public.create_cash_fund(uuid,uuid,date,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.create_cash_fund(uuid,uuid,date,text,uuid,text)
  to authenticated;

comment on function public.create_cash_fund(uuid,uuid,date,text,uuid,text) is
  'Creates one cash/check fund after Finance and batch execution gates; payment_method is canonical with legacy request_type fallback.';

do $$
declare
  v_function record;
  v_source text;
begin
  select
    p.prosrc as function_source,
    p.prosecdef as security_definer,
    p.proconfig as function_settings
  into v_function
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid = 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)'::regprocedure;

  v_source := lower(v_function.function_source);
  if not v_function.security_definer
     or not exists (
       select 1
       from unnest(coalesce(v_function.function_settings, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     )
     or position('v_request.payment_method' in v_source) = 0
     or position('v_request.request_type::text' in v_source) = 0
     or position('approval_batch_require_finance' in v_source) = 0
     or position('delivery_method_must_match_payment_request' in v_source) = 0
     or position('payment_request_must_be_approved' in v_source) = 0
     or position('cash_fund_already_exists' in v_source) = 0 then
    raise exception '026_postcheck: corrected create_cash_fund contract is incomplete';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.create_cash_fund(uuid,uuid,date,text,uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.create_cash_fund(uuid,uuid,date,text,uuid,text)',
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where n.nspname = 'public'
         and p.oid = 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)'::regprocedure
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception '026_postcheck: create_cash_fund grants are not restricted to authenticated callers';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname = 'cash_funds'
      and t.tgname = 'require_batch_for_cash_fund'
      and p.proname = 'approval_batch_assert_execution_authorized'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception '026_postcheck: cash_funds batch execution trigger was not preserved';
  end if;
end
$$;

commit;
