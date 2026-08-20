\set ON_ERROR_STOP on

create role anon noinherit;
create role authenticated noinherit;
create role service_role noinherit bypassrls;

create sequence public.payment_request_number_seq;

create function public.generate_payment_request_number(
  p_year integer default extract(year from now())::integer
)
returns text
language plpgsql
as $function$
declare
  v_next bigint;
begin
  v_next := nextval('public.payment_request_number_seq');
  return 'SOL-' || p_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$function$;

create table public.payment_requests (
  id bigint generated always as identity primary key,
  request_number text
);

insert into public.payment_requests (request_number)
values ('SOL-2099-0001'), ('SOL-2099-0002'), (null);

create table public.zzbackup_proveedores_20260709 (
  id bigint generated always as identity primary key,
  provider_name text,
  bank_account text
);

insert into public.zzbackup_proveedores_20260709 (provider_name, bank_account)
values ('Synthetic Provider A', 'synthetic-account-a'),
       ('Synthetic Provider B', 'synthetic-account-b');

grant all privileges on table public.zzbackup_proveedores_20260709 to anon, authenticated, service_role;

create table public.notification_events (
  id bigint generated always as identity primary key,
  status text not null
);

insert into public.notification_events (status) values ('synthetic-baseline');
