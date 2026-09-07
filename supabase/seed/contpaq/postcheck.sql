-- Postcheck de la semilla FB-Integración. Corre después de apply.sh (o de
-- una SEGUNDA corrida: los conteos deben ser idénticos — no hay duplicados
-- posibles por las llaves primarias, pero esto lo demuestra).
-- Sin datos sensibles: solo conteos por empresa.
with c as (
  select id, name from companies
   where id in ('9680353c-9b86-4730-82e1-fce664f048a2', '68b61801-74c0-44ea-a33b-f20e4bf53aa7')
)
select 'contpaq_accounts' tabla, c.name empresa, count(a.*) n,
       case c.id when '9680353c-9b86-4730-82e1-fce664f048a2' then 1646 else 694 end esperado
  from c left join contpaq_accounts a on a.company_id = c.id group by c.id, c.name
union all
select 'account_report_lines', c.name, count(r.*),
       case c.id when '9680353c-9b86-4730-82e1-fce664f048a2' then 95 else 396 end
  from c left join account_report_lines r on r.company_id = c.id group by c.id, c.name
union all
select 'contpaq_terceros', c.name, count(t.*),
       case c.id when '9680353c-9b86-4730-82e1-fce664f048a2' then 187 else 0 end
  from c left join contpaq_terceros t on t.company_id = c.id group by c.id, c.name
union all
select 'budget_account_mappings (SF)', 'Soporte Fersana', count(*), 60
  from budget_account_mappings where company_id = '68b61801-74c0-44ea-a33b-f20e4bf53aa7'
union all
select 'budget_account_mappings (SF) needs_review', 'Soporte Fersana', count(*), 18
  from budget_account_mappings where company_id = '68b61801-74c0-44ea-a33b-f20e4bf53aa7' and needs_review
union all
select 'partidas SF-2026 sin mapeo', 'Soporte Fersana', count(*), 0
  from budget_categories bc
 where bc.code like 'SF-2026-%'
   and not exists (select 1 from budget_account_mappings m
                    where m.company_id = '68b61801-74c0-44ea-a33b-f20e4bf53aa7' and m.budget_category_id = bc.id)
union all
select 'cuentas mapeadas SF inexistentes en catálogo', 'Soporte Fersana', count(*), 0
  from budget_account_mappings m
 where m.company_id = '68b61801-74c0-44ea-a33b-f20e4bf53aa7'
   and not exists (select 1 from contpaq_accounts a where a.company_id = m.company_id and a.code = m.contpaq_account_code)
order by 1, 2;
