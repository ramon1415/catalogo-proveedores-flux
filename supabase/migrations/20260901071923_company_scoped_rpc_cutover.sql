-- Company-scoped authorization cutover, RPC wave.
--
-- Rewrites only the authorization predicates inside the authoritative live
-- definitions. Each replacement is count-checked before execution so schema
-- drift fails the migration instead of silently leaving a global role gate.

begin;

do $cutover$
declare
  v_target regprocedure;
  v_definition text;
  v_rewritten text;
  v_old text;
  v_new text;
  v_count integer;
  v_item record;
begin
  for v_item in
    select *
    from (values
      (
        'public.contpaq_mapper_save_mapping(uuid,uuid,text,text,text,boolean)',
        'public.contpaq_mapper_company_access(p_company_id)',
        1
      ),
      (
        'public.contpaq_mapper_set_review(uuid,uuid,text,text)',
        'public.contpaq_mapper_company_access(p_company_id)',
        1
      ),
      (
        'public.get_approval_batch_detail(uuid)',
        'private.current_profile_has_company_role(v_batch.company_id, array[''finance'']::text[])',
        2
      ),
      (
        'public.get_payment_request_execution_readiness(uuid)',
        'private.current_profile_has_company_role(v_request.company_id, array[''finance'']::text[])',
        1
      ),
      (
        'public.payment_reconciliation_require_finance(uuid)',
        'private.current_profile_has_company_role(p_company_id, array[''finance'']::text[])',
        1
      ),
      (
        'public.payment_reconciliation_storage_path_allowed(text,boolean)',
        'private.current_profile_has_company_role(document.company_id, array[''finance'']::text[])',
        1
      ),
      (
        'public.payment_receipt_evidence_storage_path_allowed(text,boolean)',
        'private.current_profile_has_company_role(evidence.company_id, array[''finance'']::text[])',
        1
      )
    ) as replacements(signature, replacement, expected_count)
  loop
    v_target := to_regprocedure(v_item.signature);
    if v_target is null then
      raise exception 'company_role_rpc_missing: %', v_item.signature;
    end if;

    v_definition := pg_get_functiondef(v_target);
    v_old := 'public.current_user_has_role(public.flux_finance_roles())';
    v_new := v_item.replacement;
    v_count := (
      char_length(v_definition) - char_length(replace(v_definition, v_old, ''))
    ) / char_length(v_old);

    if v_count <> v_item.expected_count then
      raise exception
        'company_role_rpc_finance_predicate_drift: % expected %, found %',
        v_item.signature, v_item.expected_count, v_count;
    end if;

    v_rewritten := replace(v_definition, v_old, v_new);
    execute v_rewritten;
  end loop;

  -- Approver visibility becomes Finance/Director in the request's company.
  v_target := to_regprocedure(
    'public.get_payment_request_approver_details(uuid)'
  );
  if v_target is null then
    raise exception 'company_role_rpc_missing: get_payment_request_approver_details';
  end if;
  v_definition := pg_get_functiondef(v_target);
  v_old := 'public.current_user_has_role(public.flux_approver_roles())';
  v_new := 'private.current_profile_has_company_role(v_request.company_id, array[''finance'',''director'']::text[])';
  v_count := (
    char_length(v_definition) - char_length(replace(v_definition, v_old, ''))
  ) / char_length(v_old);
  if v_count <> 1 then
    raise exception
      'company_role_rpc_approver_predicate_drift: expected 1, found %',
      v_count;
  end if;
  execute replace(v_definition, v_old, v_new);

  -- An unfiltered Finance check cannot authorize a cross-company list. Remove
  -- it at entry and filter every returned batch through the exact company role.
  v_target := to_regprocedure(
    'public.list_payment_ingestion_batches(uuid,text,integer)'
  );
  if v_target is null then
    raise exception 'company_role_rpc_missing: list_payment_ingestion_batches';
  end if;
  v_definition := pg_get_functiondef(v_target);

  v_old := 'if v_actor is null or not public.current_user_has_role(public.flux_finance_roles()) then';
  v_new := 'if v_actor is null then';
  v_count := (
    char_length(v_definition) - char_length(replace(v_definition, v_old, ''))
  ) / char_length(v_old);
  if v_count <> 1 then
    raise exception
      'company_role_rpc_ingestion_entry_drift: expected 1, found %',
      v_count;
  end if;
  v_rewritten := replace(v_definition, v_old, v_new);

  v_old := '(v_is_sysadmin or public.has_active_company_membership(v_actor, batch.company_id))';
  v_new := 'private.current_profile_has_company_role(batch.company_id, array[''finance'']::text[])';
  v_count := (
    char_length(v_rewritten) - char_length(replace(v_rewritten, v_old, ''))
  ) / char_length(v_old);
  if v_count <> 1 then
    raise exception
      'company_role_rpc_ingestion_row_scope_drift: expected 1, found %',
      v_count;
  end if;
  execute replace(v_rewritten, v_old, v_new);
end
$cutover$;

-- Batch context is a cross-company directory. Access is true only when the
-- caller has Finance in at least one active company, and the returned list is
-- filtered through that same exact-company predicate.
create or replace function public.get_payment_batch_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := public.current_profile_id();
  v_can_access boolean;
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;

  select exists (
    select 1
    from public.companies company
    where coalesce(company.active, true)
      and private.current_profile_has_company_role(
        company.id,
        array['finance']::text[]
      )
  ) into v_can_access;

  return jsonb_build_object(
    'actor_profile_id', v_actor,
    'can_access', v_can_access,
    'capabilities', jsonb_build_object(
      'can_ingest', v_can_access,
      'can_review', v_can_access,
      'can_match', v_can_access,
      'can_link', v_can_access,
      'can_propose', false,
      'can_reserve', false,
      'can_confirm', false,
      'can_reverse', false
    ),
    'companies', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', company.id, 'name', company.name)
        order by company.name
      )
      from public.companies company
      where coalesce(company.active, true)
        and private.current_profile_has_company_role(
          company.id,
          array['finance']::text[]
        )
    ), '[]'::jsonb),
    'upload_policy', jsonb_build_object(
      'allowed_mime_types', jsonb_build_array('application/pdf'),
      'max_file_bytes', 26214400,
      'max_pages', 500
    ),
    'matching_model', 'one_receipt_to_one_approved_request',
    'amount_source', 'accepted_bank_extraction'
  );
end
$function$;

revoke all on function public.get_payment_batch_context() from public, anon;
grant execute on function public.get_payment_batch_context()
  to authenticated, service_role;

-- Final function gate: sysadmin-only checks are intentional global platform
-- controls. Business-role checks must all use the company helper.
do $postcheck$
declare
  v_blockers text;
begin
  select string_agg(
    format('%I.%I(%s)', n.nspname, p.proname,
      pg_get_function_identity_arguments(p.oid)),
    ', ' order by p.proname
  )
  into v_blockers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and pg_get_functiondef(p.oid) ilike '%company_id%'
    and (
      pg_get_functiondef(p.oid) ~*
        'current_user_has_role\s*\(\s*(public\.)?(flux_(finance|approver|member)_roles|approval_batch_direction_roles)\s*\('
      or pg_get_functiondef(p.oid) ~*
        'current_user_has_role\s*\(\s*array\s*\[[^]]*''(finance|finanzas|treasury|tesoreria|administracion|director|direccion|approver_2|aprobador_2|solicitante|operator)'''
    );

  if v_blockers is not null then
    raise exception 'company_role_rpc_postcheck_failed: %', v_blockers;
  end if;
end
$postcheck$;

commit;
