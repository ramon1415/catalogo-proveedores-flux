\set ON_ERROR_STOP on

do $pregrant$
declare
  v_denied boolean := false;
begin
  if has_function_privilege(
       'authenticated',
       'public.extraordinary_evidence_storage_allowed(text,boolean)',
       'EXECUTE'
     ) then
    raise exception 'shadow 039 pregrant: authenticated already has EXECUTE';
  end if;

  begin
    execute 'set local role authenticated';
    perform public.extraordinary_evidence_storage_allowed(
      'not/a/valid/evidence/path',
      true
    );
  exception
    when insufficient_privilege then
      v_denied := true;
  end;
  reset role;

  if not v_denied then
    raise exception 'shadow 039 pregrant: direct helper call was not denied';
  end if;
end
$pregrant$;

select 'SHADOW_039_PREGRANT_DENIED_PASS' as result;
