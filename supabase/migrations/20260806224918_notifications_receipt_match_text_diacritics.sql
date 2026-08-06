begin;

do $$
declare
  v_function regprocedure := to_regprocedure(
    'public.payment_receipt_normalize_match_text(text)'
  );
begin
  if v_function is null then
    raise exception
      'payment_receipt_normalize_match_text(text) prerequisite is missing';
  end if;

  if pg_get_function_result(v_function) <> 'text'
     or pg_get_function_arguments(v_function) <> 'p_value text'
     or not exists (
       select 1
       from pg_proc p
       where p.oid = v_function
         and p.provolatile = 'i'
         and not p.prosecdef
     ) then
    raise exception
      'payment receipt match normalizer contract drifted before accent-folding fix';
  end if;

  if public.payment_receipt_normalize_match_text('Demostración')
     = public.payment_receipt_normalize_match_text('Demostracion') then
    raise exception
      'payment receipt match normalizer no longer has the demonstrated accent mismatch';
  end if;
end
$$;

create or replace function public.payment_receipt_normalize_match_text(
  p_value text
)
returns text
language sql
immutable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  select regexp_replace(
    translate(
      lower(coalesce(p_value, '')),
      'áàäâãåéèëêíìïîóòöôõúùüûñç',
      'aaaaaaeeeeiiiiooooouuuunc'
    ),
    '[^[:alnum:]]',
    '',
    'g'
  )
$function$;

alter function public.payment_receipt_normalize_match_text(text)
  owner to postgres;

revoke all on function public.payment_receipt_normalize_match_text(text)
  from public, anon, authenticated;
grant execute on function public.payment_receipt_normalize_match_text(text)
  to service_role;

comment on function public.payment_receipt_normalize_match_text(text) is
  'Normalizes payment-receipt match text with deterministic Latin diacritic folding.';

do $$
declare
  v_function regprocedure :=
    'public.payment_receipt_normalize_match_text(text)'::regprocedure;
begin
  if public.payment_receipt_normalize_match_text(' Servicios Demostración Flux ')
     <> public.payment_receipt_normalize_match_text('SERVICIOS-DEMOstracion.FLUX') then
    raise exception
      'payment receipt match normalizer did not fold case, separators, and accents';
  end if;

  if public.payment_receipt_normalize_match_text(' Servicios Demostración Flux ')
     <> 'serviciosdemostracionflux' then
    raise exception
      'payment receipt match normalizer produced an unexpected canonical value';
  end if;

  if pg_get_function_result(v_function) <> 'text'
     or pg_get_function_arguments(v_function) <> 'p_value text'
     or not exists (
       select 1
       from pg_proc p
       where p.oid = v_function
         and p.provolatile = 'i'
         and not p.prosecdef
         and p.proowner = 'postgres'::regrole
         and p.proconfig = array['search_path=public, pg_temp']
     ) then
    raise exception
      'payment receipt match normalizer contract changed unexpectedly';
  end if;

  if has_function_privilege(
       'public',
       'public.payment_receipt_normalize_match_text(text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.payment_receipt_normalize_match_text(text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.payment_receipt_normalize_match_text(text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.payment_receipt_normalize_match_text(text)',
       'EXECUTE'
     ) then
    raise exception
      'payment receipt match normalizer privileges changed unexpectedly';
  end if;
end
$$;

commit;
