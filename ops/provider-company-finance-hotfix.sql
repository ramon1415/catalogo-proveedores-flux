-- Provider catalog is global; accept existing active company Finance membership.
-- Scope: catalog RPC + its banking triggers only. No global role assignments.
begin;
do $patch$
declare
  target text;
  original text;
  patched text;
  member_check constant text := $member$exists (
      select 1 from public.profile_company_memberships pcm
      join public.profiles profile on profile.id = pcm.profile_id
      join public.companies company on company.id = pcm.company_id
      where pcm.profile_id = public.current_profile_id()
        and pcm.active and profile.active and company.active
        and lower(btrim(pcm.role_key)) = 'finance'
    )$member$;
begin
  foreach target in array array[
    'public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)',
    'public.guard_provider_payment_execution_data_insert()',
    'public.mark_provider_payment_material_change()'
  ] loop
    original := replace(pg_get_functiondef(target::regprocedure), E'\r\n', E'\n');
    if position('profile_company_memberships' in original) > 0 then
      raise exception 'provider_finance_hotfix: unexpected existing membership logic in %', target;
    end if;
    patched := original;
    if target like '%save_provider_catalog%' then
      if position('if not public.current_user_has_role(public.flux_member_roles()) then' in patched) = 0
         or position('if not public.current_user_has_role(public.flux_approver_roles()) then' in patched) = 0 then
        raise exception 'provider_finance_hotfix: catalog authorization drift';
      end if;
      patched := replace(patched,
        'if not public.current_user_has_role(public.flux_member_roles()) then',
        'if not (public.current_user_has_role(public.flux_member_roles()) or ' || member_check || ') then');
      patched := replace(patched,
        'if not public.current_user_has_role(public.flux_approver_roles()) then',
        'if not (public.current_user_has_role(public.flux_approver_roles()) or ' || member_check || ') then');
    end if;
    if target like '%mark_provider_payment%' then
      if position('v_actor := public.approval_batch_require_finance();' in patched) = 0 then
        raise exception 'provider_finance_hotfix: update trigger drift';
      end if;
      patched := replace(patched,
        'v_actor := public.approval_batch_require_finance();',
        'v_actor := public.approval_batch_require_actor(); if not (' || member_check || ') then perform public.approval_batch_require_finance(); end if;');
    else
      if position('perform public.approval_batch_require_finance();' in patched) = 0 then
        raise exception 'provider_finance_hotfix: finance guard drift';
      end if;
      patched := replace(patched,
        'perform public.approval_batch_require_finance();',
        'if not (' || member_check || ') then perform public.approval_batch_require_finance(); end if;');
    end if;
    if patched = original then raise exception 'provider_finance_hotfix: no change'; end if;
    execute patched;
  end loop;
end
$patch$;
commit;

