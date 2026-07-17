-- DEV backup step. DO NOT RUN before explicit rollout authorization.
-- Creates timestamp-neutral backup tables once; stop if they already exist.

begin;

create table public._backup_029_payment_intake
  as table public.payment_intake with data;

create table public._backup_029_payment_intake_files
  as table public.payment_intake_files with data;

create table public._backup_029_payment_intake_events
  as table public.payment_intake_events with data;

select 'payment_intake' as object_name, count(*) as backed_up_rows
from public._backup_029_payment_intake
union all
select 'payment_intake_files', count(*)
from public._backup_029_payment_intake_files
union all
select 'payment_intake_events', count(*)
from public._backup_029_payment_intake_events;

commit;
