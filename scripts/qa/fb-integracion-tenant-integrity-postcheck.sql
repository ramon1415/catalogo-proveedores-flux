-- FB-Integración · postcheck de integridad por empresa (PR #498, puntos C y E).
-- Corre completo dentro de una transacción que TERMINA EN ROLLBACK: no deja
-- rastro. Cada paso registra PASS/FAIL en qa_out; el último select los lista y
-- el DO final aborta si hay algún FAIL.
--
-- Requiere: rol con bypass de RLS para la parte de FKs (postgres/service) y
-- el auth_user_id de un usuario Finanzas de UNA sola empresa para la parte de
-- RLS. Ejecutar con psql:
--   psql "$DATABASE_URL" -v uid_finanzas_sf="'<auth_user_id>'" \
--        -v empresa_propia="'68b61801-74c0-44ea-a33b-f20e4bf53aa7'" \
--        -v empresa_ajena="'9680353c-9b86-4730-82e1-fce664f048a2'" \
--        -f scripts/qa/fb-integracion-tenant-integrity-postcheck.sql
-- Evidencia DEV 2026-09-02: 9/9 PASS (ver PR #498).
begin;
create temp table qa_out(paso text, resultado text, ok boolean) on commit drop;
grant all on qa_out to anon, authenticated; -- los pasos bajo otro rol también registran

-- C1) cuenta bancaria de otra empresa: FK compuesta -----------------------
do $t$
declare v_cba uuid; v_owner uuid; v_other uuid; r text := 'FAIL: no rechazó';
begin
  select id, company_id into v_cba, v_owner from public.company_bank_accounts where company_id is not null limit 1;
  select id into v_other from public.companies where id <> v_owner limit 1;
  begin
    insert into public.bank_account_mappings (company_id, company_bank_account_id, contpaq_account_code) values (v_other, v_cba, '10201000000');
  exception when foreign_key_violation then r := 'PASS: rechazado por FK compuesta'; end;
  insert into qa_out values ('C1 cuenta bancaria de otra empresa', r, r like 'PASS%');
  insert into public.bank_account_mappings (company_id, company_bank_account_id, contpaq_account_code) values (v_owner, v_cba, '10201000000');
  insert into qa_out values ('C1 cuenta bancaria propia', 'PASS: aceptada', true);
end $t$;

-- C2) reversa hacia otra empresa: FK compuesta -----------------------------
do $t$
declare a uuid; b uuid; e1 uuid; r text := 'FAIL: no rechazó';
begin
  select id into a from public.companies order by created_at limit 1;
  select id into b from public.companies where id <> a order by created_at limit 1;
  insert into public.accounting_exports (source_feeder, source_id, company_id, tipo_pol, folio, periodo, status, content_hash)
    values ('qa', 'c2', a, 2, 1, '2026-06-01', 'exported', 'x') returning id into e1;
  begin
    insert into public.accounting_exports (source_feeder, source_id, company_id, tipo_pol, folio, periodo, status, content_hash, reversal_of)
      values ('qa', 'c2-rev-ajena', b, 2, 2, '2026-06-01', 'exported', 'y', e1);
  exception when foreign_key_violation then r := 'PASS: rechazada por FK compuesta'; end;
  insert into qa_out values ('C2 reversa hacia otra empresa', r, r like 'PASS%');
  insert into public.accounting_exports (source_feeder, source_id, company_id, tipo_pol, folio, periodo, status, content_hash, reversal_of)
    values ('qa', 'c2-rev-propia', a, 2, 3, '2026-06-01', 'exported', 'z', e1);
  insert into qa_out values ('C2 reversa en la misma empresa', 'PASS: aceptada', true);
end $t$;

-- E) RLS por operación, como usuario Finanzas de UNA empresa ---------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :uid_finanzas_sf, 'role', 'authenticated')::text, true);
do $t$ declare n int; begin
  select count(*) into n from public.tax_account_mappings where company_id = :empresa_ajena;
  insert into qa_out values ('E lee mapeos de la empresa ajena', case when n = 0 then 'PASS: 0 filas' else 'FAIL: '||n||' filas' end, n = 0);
end $t$;
do $t$ declare r text := 'FAIL: no rechazó'; begin
  begin
    insert into public.tax_account_mappings (company_id, tax_key, contpaq_account_code) values (:empresa_ajena, 'ivaPendiente', '11801300000');
  exception when insufficient_privilege then r := 'PASS: RLS 42501'; end;
  insert into qa_out values ('E escribe mapeo en la empresa ajena', r, r like 'PASS%');
end $t$;
do $t$ begin
  insert into public.tax_account_mappings (company_id, tax_key, contpaq_account_code) values (:empresa_propia, 'ivaPendiente', '1180300');
  insert into qa_out values ('E escribe mapeo en la empresa propia', 'PASS: aceptado', true);
end $t$;
do $t$ declare r text := 'FAIL: no rechazó'; begin
  begin
    delete from public.accounting_exports where true;
  exception when insufficient_privilege then r := 'PASS: sin grant DELETE'; end;
  insert into qa_out values ('E borra el ledger', r, r like 'PASS%');
end $t$;
do $t$ declare r text := 'FAIL: no rechazó'; begin
  begin
    insert into public.accounting_exports (source_feeder, source_id, company_id, tipo_pol, folio, periodo, status, content_hash)
      values ('qa', 'e-ajena', :empresa_ajena, 2, 1, '2026-06-01', 'exported', 'h');
  exception when insufficient_privilege then r := 'PASS: RLS 42501'; end;
  insert into qa_out values ('E exporta a nombre de la empresa ajena', r, r like 'PASS%');
end $t$;
reset role;
set local role anon;
do $t$ declare r text := 'FAIL: no rechazó'; n int; begin
  begin
    select count(*) into n from public.contpaq_terceros;
  exception when insufficient_privilege then r := 'PASS: anon sin grant'; end;
  insert into qa_out values ('E anon lee terceros', r, r like 'PASS%');
end $t$;
reset role;

select paso, resultado from qa_out;
do $fin$ begin
  if exists (select 1 from qa_out where not ok) then raise exception 'fb tenant postcheck: hay FAIL'; end if;
end $fin$;
rollback;
