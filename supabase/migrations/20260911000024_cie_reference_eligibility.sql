-- Use the CIE issuer contract during eligibility, not the interbank five-digit rule.
-- Preserve the current helper, reimbursement protections and existing ACLs.
do $migration$
declare
  v_oid regprocedure := 'public.payment_request_layout_missing_fields(public.payment_requests)'::regprocedure;
  v_definition text;
  v_old text := $old$and btrim(p_request.payment_reference) !~ '^[0-9]{1,5}$'$old$;
  v_new text := $new$and case
          when not coalesce(v_is_reimbursement, false) and v_provider_found
            and lower(btrim(v_provider.destination_type)) = 'convenio'
          then private.cie_reference_error(p_request.payment_reference, v_provider.convenio_number) is not null
          else btrim(p_request.payment_reference) !~ '^[0-9]{1,5}$'
        end$new$;
begin
  if to_regprocedure('private.cie_reference_error(text,text)') is null then
    raise exception 'cie_reference_validation_prerequisite_missing';
  end if;
  v_definition := pg_get_functiondef(v_oid);
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1
    or position('private.cie_reference_error' in v_definition) > 0 then
    raise exception 'cie_reference_eligibility_definition_drift';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;
