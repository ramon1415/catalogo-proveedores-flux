-- Authorized DEV-only permission alignment. PROD snapshot 2026-09-17.
-- Match people by email and companies by RFC. No new users or business records.
-- QA-only profiles and QA companies are outside scope.
begin;
create temporary table parity_target(data jsonb) on commit drop;
insert into parity_target values ($target${
  "profiles": [
    {
      "email": "afajardo@soportef.com",
      "active": true,
      "roles": [
        "finance"
      ]
    },
    {
      "email": "agalvan@fluxfinanciera.com",
      "active": true,
      "roles": []
    },
    {
      "email": "carlos.arceo.fm@gmail.com",
      "active": true,
      "roles": []
    },
    {
      "email": "carlos@quantta.mx",
      "active": true,
      "roles": [
        "admin"
      ]
    },
    {
      "email": "cesar@quantta.mx",
      "active": true,
      "roles": [
        "approver_2"
      ]
    },
    {
      "email": "contabilidad2@soportef.com",
      "active": true,
      "roles": []
    },
    {
      "email": "denise@quantta.mx",
      "active": true,
      "roles": []
    },
    {
      "email": "lisette@dezdez.earth",
      "active": true,
      "roles": []
    },
    {
      "email": "ramon.hipo1@gmail.com",
      "active": true,
      "roles": [
        "approver_2"
      ]
    },
    {
      "email": "ramon@quantta.mx",
      "active": true,
      "roles": [
        "admin",
        "approver_2",
        "aprobador_2",
        "finance",
        "finanzas",
        "operator",
        "solicitante",
        "sysadmin",
        "system_admin"
      ]
    },
    {
      "email": "ychavez@fluxfinanciera.com",
      "active": true,
      "roles": []
    },
    {
      "email": "ynavarrete@soportef.com",
      "active": true,
      "roles": [
        "admin"
      ]
    }
  ],
  "companies": [
    {
      "rfc": "SFE100825TM9",
      "dev_id": "68b61801-74c0-44ea-a33b-f20e4bf53aa7"
    },
    {
      "rfc": "AFE190704UE0",
      "dev_id": "9680353c-9b86-4730-82e1-fce664f048a2"
    }
  ],
  "memberships": [
    {
      "email": "carlos.arceo.fm@gmail.com",
      "rfc": "AFE190704UE0",
      "role_key": null,
      "active": true
    },
    {
      "email": "denise@quantta.mx",
      "rfc": "AFE190704UE0",
      "role_key": "finance",
      "active": true
    },
    {
      "email": "lisette@dezdez.earth",
      "rfc": "AFE190704UE0",
      "role_key": "director",
      "active": true
    },
    {
      "email": "contabilidad2@soportef.com",
      "rfc": "AFE190704UE0",
      "role_key": "finance",
      "active": true
    },
    {
      "email": "cesar@quantta.mx",
      "rfc": "AFE190704UE0",
      "role_key": "director",
      "active": true
    },
    {
      "email": "ynavarrete@soportef.com",
      "rfc": "AFE190704UE0",
      "role_key": "finance",
      "active": true
    },
    {
      "email": "afajardo@soportef.com",
      "rfc": "AFE190704UE0",
      "role_key": "finance",
      "active": true
    },
    {
      "email": "carlos@quantta.mx",
      "rfc": "AFE190704UE0",
      "role_key": "sysadmin",
      "active": true
    },
    {
      "email": "ramon@quantta.mx",
      "rfc": "AFE190704UE0",
      "role_key": "sysadmin",
      "active": true
    },
    {
      "email": "denise@quantta.mx",
      "rfc": "SFE100825TM9",
      "role_key": "finance",
      "active": true
    },
    {
      "email": "lisette@dezdez.earth",
      "rfc": "SFE100825TM9",
      "role_key": "director",
      "active": true
    },
    {
      "email": "cesar@quantta.mx",
      "rfc": "SFE100825TM9",
      "role_key": "director",
      "active": true
    },
    {
      "email": "afajardo@soportef.com",
      "rfc": "SFE100825TM9",
      "role_key": "finance",
      "active": true
    },
    {
      "email": "carlos@quantta.mx",
      "rfc": "SFE100825TM9",
      "role_key": "sysadmin",
      "active": true
    },
    {
      "email": "ramon@quantta.mx",
      "rfc": "SFE100825TM9",
      "role_key": "sysadmin",
      "active": true
    },
    {
      "email": "contabilidad2@soportef.com",
      "rfc": "SFE100825TM9",
      "role_key": "finance",
      "active": true
    },
    {
      "email": "ychavez@fluxfinanciera.com",
      "rfc": "SFE100825TM9",
      "role_key": "operator",
      "active": true
    },
    {
      "email": "ychavez@fluxfinanciera.com",
      "rfc": "AFE190704UE0",
      "role_key": "operator",
      "active": false
    },
    {
      "email": "agalvan@fluxfinanciera.com",
      "rfc": "AFE190704UE0",
      "role_key": "finance",
      "active": true
    },
    {
      "email": "agalvan@fluxfinanciera.com",
      "rfc": "SFE100825TM9",
      "role_key": "finance",
      "active": true
    },
    {
      "email": "ynavarrete@soportef.com",
      "rfc": "SFE100825TM9",
      "role_key": "finance",
      "active": true
    },
    {
      "email": "ramon.hipo1@gmail.com",
      "rfc": "AFE190704UE0",
      "role_key": "finance",
      "active": true
    },
    {
      "email": "ramon.hipo1@gmail.com",
      "rfc": "SFE100825TM9",
      "role_key": "finance",
      "active": true
    }
  ],
  "approvers": [
    {
      "requester": "ramon@quantta.mx",
      "approver": "ramon.hipo1@gmail.com",
      "rfc": "AFE190704UE0",
      "active": true
    },
    {
      "requester": "afajardo@soportef.com",
      "approver": "ynavarrete@soportef.com",
      "rfc": "AFE190704UE0",
      "active": false
    },
    {
      "requester": "contabilidad2@soportef.com",
      "approver": "cesar@quantta.mx",
      "rfc": "AFE190704UE0",
      "active": true
    },
    {
      "requester": "denise@quantta.mx",
      "approver": "cesar@quantta.mx",
      "rfc": "AFE190704UE0",
      "active": true
    },
    {
      "requester": "ynavarrete@soportef.com",
      "approver": "cesar@quantta.mx",
      "rfc": "AFE190704UE0",
      "active": true
    },
    {
      "requester": "afajardo@soportef.com",
      "approver": "cesar@quantta.mx",
      "rfc": "AFE190704UE0",
      "active": true
    },
    {
      "requester": "agalvan@fluxfinanciera.com",
      "approver": "cesar@quantta.mx",
      "rfc": "SFE100825TM9",
      "active": true
    },
    {
      "requester": "ychavez@fluxfinanciera.com",
      "approver": "cesar@quantta.mx",
      "rfc": "SFE100825TM9",
      "active": true
    },
    {
      "requester": "denise@quantta.mx",
      "approver": "cesar@quantta.mx",
      "rfc": "SFE100825TM9",
      "active": true
    },
    {
      "requester": "ynavarrete@soportef.com",
      "approver": "cesar@quantta.mx",
      "rfc": "SFE100825TM9",
      "active": true
    },
    {
      "requester": "afajardo@soportef.com",
      "approver": "cesar@quantta.mx",
      "rfc": "SFE100825TM9",
      "active": true
    },
    {
      "requester": "contabilidad2@soportef.com",
      "approver": "cesar@quantta.mx",
      "rfc": "SFE100825TM9",
      "active": true
    },
    {
      "requester": "ychavez@fluxfinanciera.com",
      "approver": "cesar@quantta.mx",
      "rfc": "AFE190704UE0",
      "active": false
    },
    {
      "requester": "ramon.hipo1@gmail.com",
      "approver": "ramon@quantta.mx",
      "rfc": "AFE190704UE0",
      "active": false
    },
    {
      "requester": "agalvan@fluxfinanciera.com",
      "approver": "cesar@quantta.mx",
      "rfc": "AFE190704UE0",
      "active": true
    },
    {
      "requester": "agalvan@fluxfinanciera.com",
      "approver": "afajardo@soportef.com",
      "rfc": "SFE100825TM9",
      "active": true
    },
    {
      "requester": "agalvan@fluxfinanciera.com",
      "approver": "ynavarrete@soportef.com",
      "rfc": "AFE190704UE0",
      "active": true
    },
    {
      "requester": "agalvan@fluxfinanciera.com",
      "approver": "ynavarrete@soportef.com",
      "rfc": "SFE100825TM9",
      "active": true
    }
  ]
}$target$::jsonb);
do $guard$
declare got text;
begin
  if (select count(*) from jsonb_to_recordset((select data->'companies' from parity_target)) as t(rfc text,dev_id uuid) join public.companies c on c.id=t.dev_id and c.rfc=t.rfc) <> 2 then raise exception 'DEV identity guard failed'; end if;
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) into got from public.profiles x;
  if got <> 'b24bcaf8ae73cceebc07d450ffc90268' then raise exception 'Preflight changed: profiles'; end if;
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) into got from public.user_roles x;
  if got <> '0d84b8c2ca78e06359ddc7ec91a92196' then raise exception 'Preflight changed: user_roles'; end if;
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) into got from public.profile_company_memberships x;
  if got <> '5186d28ac221243e9c60d826dc859769' then raise exception 'Preflight changed: profile_company_memberships'; end if;
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) into got from public.approver_assignments x;
  if got <> 'd2083706f16d06196bb8c25cc1fc2e00' then raise exception 'Preflight changed: approver_assignments'; end if;
end;
$guard$;

create temporary table parity_people on commit drop as
select p.id, t.email, t.active, t.roles
from jsonb_to_recordset((select data->'profiles' from parity_target)) t(email text,active boolean,roles jsonb)
join public.profiles p on lower(p.email)=t.email;
create temporary table parity_companies on commit drop as
select c.id,t.rfc from jsonb_to_recordset((select data->'companies' from parity_target)) t(rfc text,dev_id uuid)
join public.companies c on c.id=t.dev_id;
create temporary table parity_memberships on commit drop as
select p.id profile_id,c.id company_id,t.role_key,t.active
from jsonb_to_recordset((select data->'memberships' from parity_target)) t(email text,rfc text,role_key text,active boolean)
join parity_people p on p.email=t.email join parity_companies c on c.rfc=t.rfc;
create temporary table parity_approvers on commit drop as
select requester.id requester_id,approver.id approver_id,c.id company_id,t.active
from jsonb_to_recordset((select data->'approvers' from parity_target)) t(requester text,approver text,rfc text,active boolean)
join parity_people requester on requester.email=t.requester
join parity_people approver on approver.email=t.approver
join parity_companies c on c.rfc=t.rfc;
create temporary table parity_untouched on commit drop as
select 'payment_requests' kind,md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) fingerprint from payment_requests x
union all select 'reimbursement_items',md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from reimbursement_items x
union all select 'qa_profiles',md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from profiles x where not exists(select 1 from parity_people p where p.id=x.id)
union all select 'qa_roles',md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from user_roles x where not exists(select 1 from parity_people p where p.id=x.profile_id)
union all select 'qa_memberships',md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from profile_company_memberships x where not exists(select 1 from parity_people p,parity_companies c where p.id=x.profile_id and c.id=x.company_id)
union all select 'qa_approvers',md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from approver_assignments x where not exists(select 1 from parity_people p,parity_companies c where p.id=x.requester_id and c.id=x.company_id);

-- Deactivate obsolete routes before deactivating their memberships; keep history and IDs.
update public.approver_assignments a set active=false,updated_at=now()
where a.active and exists(select 1 from parity_people p,parity_companies c where p.id=a.requester_id and c.id=a.company_id)
and not exists(select 1 from parity_approvers t where t.requester_id=a.requester_id and t.approver_id=a.approver_id and t.company_id=a.company_id and t.active);
update public.profile_company_memberships m set active=false
where m.active and exists(select 1 from parity_people p,parity_companies c where p.id=m.profile_id and c.id=m.company_id)
and not exists(select 1 from parity_memberships t where t.profile_id=m.profile_id and t.company_id=m.company_id and t.active);
update public.profiles p set active=t.active from parity_people t where p.id=t.id and p.active is distinct from t.active;
insert into public.roles(name)
select distinct role_name from parity_people p cross join lateral jsonb_array_elements_text(p.roles) r(role_name)
on conflict(name) do nothing;
delete from public.user_roles u using parity_people p
where u.profile_id=p.id and not exists(select 1 from roles r where r.id=u.role_id and p.roles ? r.name);
insert into public.user_roles(profile_id,role_id)
select p.id,r.id from parity_people p join public.roles r on p.roles ? r.name
on conflict(profile_id,role_id) do nothing;
insert into public.profile_company_memberships(profile_id,company_id,role_key,active)
select profile_id,company_id,role_key,active from parity_memberships
on conflict(profile_id,company_id) do update set role_key=excluded.role_key,active=excluded.active
where profile_company_memberships.role_key is distinct from excluded.role_key or profile_company_memberships.active is distinct from excluded.active;
insert into public.approver_assignments(company_id,requester_id,approver_id,active)
select company_id,requester_id,approver_id,active from parity_approvers
on conflict(company_id,requester_id,approver_id) do update set active=excluded.active,updated_at=now()
where approver_assignments.active is distinct from excluded.active;

do $verify$
begin
  if (select count(*) from parity_people)<>12 or (select count(*) from parity_memberships)<>23 or (select count(*) from parity_approvers)<>18 then
    raise exception 'DEV parity identity mapping is incomplete';
  end if;
  if exists(select 1 from parity_people t join profiles p on p.id=t.id where p.active is distinct from t.active
    or coalesce((select jsonb_agg(r.name order by r.name) from user_roles u join roles r on r.id=u.role_id where u.profile_id=p.id),'[]'::jsonb)<>t.roles) then
    raise exception 'DEV profile or global role parity failed';
  end if;
  if exists(select 1 from parity_memberships t left join profile_company_memberships m on m.profile_id=t.profile_id and m.company_id=t.company_id
    where m.id is null or m.active is distinct from t.active or m.role_key is distinct from t.role_key) then raise exception 'DEV membership parity failed'; end if;
  if exists(select 1 from profile_company_memberships m join parity_people p on p.id=m.profile_id join parity_companies c on c.id=m.company_id
    where m.active and not exists(select 1 from parity_memberships t where t.profile_id=m.profile_id and t.company_id=m.company_id and t.active)) then raise exception 'DEV extra active membership'; end if;
  if exists(select 1 from parity_approvers t left join approver_assignments a on a.requester_id=t.requester_id and a.approver_id=t.approver_id and a.company_id=t.company_id
    where a.id is null or a.active is distinct from t.active) then raise exception 'DEV approver parity failed'; end if;
  if exists(select 1 from approver_assignments a join parity_people p on p.id=a.requester_id join parity_companies c on c.id=a.company_id
    where a.active and not exists(select 1 from parity_approvers t where t.requester_id=a.requester_id and t.approver_id=a.approver_id and t.company_id=a.company_id and t.active)) then raise exception 'DEV extra active approver'; end if;
  if exists(select 1 from parity_memberships m where m.active and m.role_key in ('finance','director') and not public.is_payment_request_approver_for_company(m.profile_id,m.company_id)) then
    raise exception 'DEV company approver role not recognized';
  end if;
  if exists(select 1 from parity_untouched old join (
    select 'payment_requests' kind,md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) fingerprint from payment_requests x
    union all select 'reimbursement_items',md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from reimbursement_items x
    union all select 'qa_profiles',md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from profiles x where not exists(select 1 from parity_people p where p.id=x.id)
    union all select 'qa_roles',md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from user_roles x where not exists(select 1 from parity_people p where p.id=x.profile_id)
    union all select 'qa_memberships',md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from profile_company_memberships x where not exists(select 1 from parity_people p,parity_companies c where p.id=x.profile_id and c.id=x.company_id)
    union all select 'qa_approvers',md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from approver_assignments x where not exists(select 1 from parity_people p,parity_companies c where p.id=x.requester_id and c.id=x.company_id)
  ) new using(kind) where old.fingerprint<>new.fingerprint) then raise exception 'Unrelated records changed; rolling back'; end if;
end;
$verify$;
select 'DEV permissions aligned' result,(select count(*) from parity_people) users,(select count(*) from parity_memberships) memberships,(select count(*) from parity_approvers) routing_records;
commit;
