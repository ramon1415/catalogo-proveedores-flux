-- Payroll receipt date: request creation day (Mexico City) onward, no future cap.
-- Prepared for a single, explicitly scoped migration. No business data changes.
-- Existing function bodies, security attributes and ACLs are preserved.
begin;
do $migration$
declare
  source text;
  old_guard constant text := 'if p_payment_date is null or p_payment_date>current_date+1 then raise exception ''PAYROLL_RECONCILIATION_PAYMENT_DATE_INVALID''; end if;';
  new_guard constant text := $guard$if p_payment_date is null or not isfinite(p_payment_date) then
    raise exception 'PAYROLL_RECONCILIATION_PAYMENT_DATE_INVALID';
  end if;
  if p_payment_date < (v_request.created_at AT TIME ZONE 'America/Mexico_City')::date then
    raise exception 'PAYROLL_RECONCILIATION_PAYMENT_DATE_BEFORE_REQUEST'
      using detail = 'La fecha de pago no puede ser anterior al ' ||
        to_char(v_request.created_at AT TIME ZONE 'America/Mexico_City', 'DD/MM/YYYY') ||
        ', fecha de creación de la solicitud.';
  end if;$guard$;
  summary_old constant text := '''request_status'',v_request.status::text';
  summary_new constant text := '''request_created_date'',(v_request.created_at AT TIME ZONE ''America/Mexico_City'')::date,''request_status'',v_request.status::text';
begin
  source := pg_get_functiondef('private.reconcile_payroll_channel(uuid,uuid,uuid,numeric,date,text)'::regprocedure);
  if strpos(source, old_guard) > 0 then
    execute replace(source, old_guard, new_guard);
  elsif strpos(source, new_guard) = 0 then
    raise exception 'PAYROLL_RECEIPT_DATE_MIGRATION_SOURCE_MISMATCH';
  end if;

  source := pg_get_functiondef('public.get_payroll_reconciliation_summary(uuid)'::regprocedure);
  if strpos(source, summary_new) > 0 then
    null;
  elsif strpos(source, summary_old) > 0 and strpos(source, 'request_created_date') = 0 then
    execute replace(source, summary_old, summary_new);
  else
    raise exception 'PAYROLL_RECEIPT_DATE_SUMMARY_SOURCE_MISMATCH';
  end if;
end;
$migration$;
commit;
