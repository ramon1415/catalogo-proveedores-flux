-- Additive enum prerequisite; separate commit before payroll data can use it.
begin;
set local lock_timeout='5s';
do $preflight$ begin
  if not exists(select 1 from public.companies where id='20cd72aa-f281-4985-931b-a83422404b66' and name='Soporte Fersana')
    or not exists(select 1 from public.companies where id='144042c1-e493-4256-a86c-cd088a8898ce' and name='Operadora Tlacatecpan') then
    raise exception 'PAYROLL_PROD_COMPANY_IDENTITY_MISMATCH';
  end if;
  if to_regclass('public.payroll_capture_sessions') is not null then raise exception 'PAYROLL_PROD_BASELINE_ALREADY_PRESENT'; end if;
end $preflight$;
alter type public.payment_request_type add value if not exists 'nomina';
commit;
