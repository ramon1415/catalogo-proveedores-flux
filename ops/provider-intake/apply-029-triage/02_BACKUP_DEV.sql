-- DEV backup and reconciliation step. Requires explicit rollout authorization.
-- First execution creates all three copies atomically. Resume reuses all three.
-- A partial backup set stops without creating, deleting, or restoring anything.

begin;

do $backup_state$
declare
  v_existing_count integer;
begin
  select count(*)
    into v_existing_count
  from (
    values
      ('_backup_029_payment_intake'),
      ('_backup_029_payment_intake_files'),
      ('_backup_029_payment_intake_events')
  ) expected(table_name)
  where to_regclass('public.' || expected.table_name) is not null;

  if v_existing_count = 0 then
    execute 'create table public._backup_029_payment_intake '
      || 'as table public.payment_intake with data';
    execute 'create table public._backup_029_payment_intake_files '
      || 'as table public.payment_intake_files with data';
    execute 'create table public._backup_029_payment_intake_events '
      || 'as table public.payment_intake_events with data';
  elsif v_existing_count <> 3 then
    raise exception
      '029_backup_partial_state: expected zero or three backup tables, found %',
      v_existing_count;
  end if;
end
$backup_state$;

revoke all privileges on table
  public._backup_029_payment_intake,
  public._backup_029_payment_intake_files,
  public._backup_029_payment_intake_events
from public, anon, authenticated, service_role;

alter table public._backup_029_payment_intake enable row level security;
alter table public._backup_029_payment_intake_files enable row level security;
alter table public._backup_029_payment_intake_events enable row level security;

do $backup_validation$
declare
  v_intake_live bigint;
  v_intake_backup bigint;
  v_files_live bigint;
  v_files_backup bigint;
  v_events_live bigint;
  v_events_backup bigint;
  v_intake_mismatch bigint;
  v_files_mismatch bigint;
  v_events_mismatch bigint;
  v_policy_count bigint;
begin
  select count(*) into v_intake_live from public.payment_intake;
  select count(*) into v_intake_backup from public._backup_029_payment_intake;
  select count(*) into v_files_live from public.payment_intake_files;
  select count(*) into v_files_backup from public._backup_029_payment_intake_files;
  select count(*) into v_events_live from public.payment_intake_events;
  select count(*) into v_events_backup from public._backup_029_payment_intake_events;

  if (v_intake_live, v_intake_backup, v_files_live, v_files_backup, v_events_live, v_events_backup)
    is distinct from (13::bigint, 13::bigint, 6::bigint, 6::bigint, 20::bigint, 20::bigint)
  then
    raise exception
      '029_backup_count_mismatch: intake %/%, files %/%, events %/%',
      v_intake_live,
      v_intake_backup,
      v_files_live,
      v_files_backup,
      v_events_live,
      v_events_backup;
  end if;

  select count(*)
    into v_intake_mismatch
  from (
    (
      select to_jsonb(live_row) as row_value
      from public.payment_intake live_row
      except all
      select to_jsonb(backup_row)
      from public._backup_029_payment_intake backup_row
    )
    union all
    (
      select to_jsonb(backup_row)
      from public._backup_029_payment_intake backup_row
      except all
      select to_jsonb(live_row)
      from public.payment_intake live_row
    )
  ) differences;

  select count(*)
    into v_files_mismatch
  from (
    (
      select to_jsonb(live_row) as row_value
      from public.payment_intake_files live_row
      except all
      select to_jsonb(backup_row)
      from public._backup_029_payment_intake_files backup_row
    )
    union all
    (
      select to_jsonb(backup_row)
      from public._backup_029_payment_intake_files backup_row
      except all
      select to_jsonb(live_row)
      from public.payment_intake_files live_row
    )
  ) differences;

  select count(*)
    into v_events_mismatch
  from (
    (
      select to_jsonb(live_row) as row_value
      from public.payment_intake_events live_row
      except all
      select to_jsonb(backup_row)
      from public._backup_029_payment_intake_events backup_row
    )
    union all
    (
      select to_jsonb(backup_row)
      from public._backup_029_payment_intake_events backup_row
      except all
      select to_jsonb(live_row)
      from public.payment_intake_events live_row
    )
  ) differences;

  if v_intake_mismatch <> 0 or v_files_mismatch <> 0 or v_events_mismatch <> 0 then
    raise exception
      '029_backup_integrity_mismatch: intake %, files %, events %',
      v_intake_mismatch,
      v_files_mismatch,
      v_events_mismatch;
  end if;

  select count(*)
    into v_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      '_backup_029_payment_intake',
      '_backup_029_payment_intake_files',
      '_backup_029_payment_intake_events'
    );

  if v_policy_count <> 0 then
    raise exception '029_backup_policy_mismatch: expected zero policies, found %', v_policy_count;
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        '_backup_029_payment_intake',
        '_backup_029_payment_intake_files',
        '_backup_029_payment_intake_events'
      )
      and not c.relrowsecurity
  ) then
    raise exception '029_backup_rls_mismatch: RLS must be enabled on all backup tables';
  end if;

  if exists (
    select 1
    from (
      values
        ('anon'),
        ('authenticated'),
        ('service_role')
    ) application_role(role_name)
    cross join (
      values
        ('public._backup_029_payment_intake'),
        ('public._backup_029_payment_intake_files'),
        ('public._backup_029_payment_intake_events')
    ) backup_table(table_name)
    where has_table_privilege(
      application_role.role_name,
      backup_table.table_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ) then
    raise exception '029_backup_grant_mismatch: an application role retains backup privileges';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(
      coalesce(c.relacl, acldefault('r', c.relowner))
    ) privilege
    where n.nspname = 'public'
      and c.relname in (
        '_backup_029_payment_intake',
        '_backup_029_payment_intake_files',
        '_backup_029_payment_intake_events'
      )
      and privilege.grantee = 0
  ) then
    raise exception '029_backup_grant_mismatch: PUBLIC retains backup privileges';
  end if;
end
$backup_validation$;

with backup_metrics as (
  select
    'payment_intake'::text as object_name,
    (select count(*) from public.payment_intake) as rows_live,
    (select count(*) from public._backup_029_payment_intake) as rows_backup,
    (
      select count(*)
      from (
        (
          select to_jsonb(live_row) as row_value
          from public.payment_intake live_row
          except all
          select to_jsonb(backup_row)
          from public._backup_029_payment_intake backup_row
        )
        union all
        (
          select to_jsonb(backup_row)
          from public._backup_029_payment_intake backup_row
          except all
          select to_jsonb(live_row)
          from public.payment_intake live_row
        )
      ) differences
    ) as mismatch_count,
    (
      select md5(coalesce(string_agg(row_hash, '' order by row_hash), ''))
      from (
        select md5(to_jsonb(live_row)::text) as row_hash
        from public.payment_intake live_row
      ) live_hashes
    ) = (
      select md5(coalesce(string_agg(row_hash, '' order by row_hash), ''))
      from (
        select md5(to_jsonb(backup_row)::text) as row_hash
        from public._backup_029_payment_intake backup_row
      ) backup_hashes
    ) as digest_equal
  union all
  select
    'payment_intake_files',
    (select count(*) from public.payment_intake_files),
    (select count(*) from public._backup_029_payment_intake_files),
    (
      select count(*)
      from (
        (
          select to_jsonb(live_row) as row_value
          from public.payment_intake_files live_row
          except all
          select to_jsonb(backup_row)
          from public._backup_029_payment_intake_files backup_row
        )
        union all
        (
          select to_jsonb(backup_row)
          from public._backup_029_payment_intake_files backup_row
          except all
          select to_jsonb(live_row)
          from public.payment_intake_files live_row
        )
      ) differences
    ),
    (
      select md5(coalesce(string_agg(row_hash, '' order by row_hash), ''))
      from (
        select md5(to_jsonb(live_row)::text) as row_hash
        from public.payment_intake_files live_row
      ) live_hashes
    ) = (
      select md5(coalesce(string_agg(row_hash, '' order by row_hash), ''))
      from (
        select md5(to_jsonb(backup_row)::text) as row_hash
        from public._backup_029_payment_intake_files backup_row
      ) backup_hashes
    )
  union all
  select
    'payment_intake_events',
    (select count(*) from public.payment_intake_events),
    (select count(*) from public._backup_029_payment_intake_events),
    (
      select count(*)
      from (
        (
          select to_jsonb(live_row) as row_value
          from public.payment_intake_events live_row
          except all
          select to_jsonb(backup_row)
          from public._backup_029_payment_intake_events backup_row
        )
        union all
        (
          select to_jsonb(backup_row)
          from public._backup_029_payment_intake_events backup_row
          except all
          select to_jsonb(live_row)
          from public.payment_intake_events live_row
        )
      ) differences
    ),
    (
      select md5(coalesce(string_agg(row_hash, '' order by row_hash), ''))
      from (
        select md5(to_jsonb(live_row)::text) as row_hash
        from public.payment_intake_events live_row
      ) live_hashes
    ) = (
      select md5(coalesce(string_agg(row_hash, '' order by row_hash), ''))
      from (
        select md5(to_jsonb(backup_row)::text) as row_hash
        from public._backup_029_payment_intake_events backup_row
      ) backup_hashes
    )
)
select
  object_name,
  rows_live,
  rows_backup,
  mismatch_count,
  digest_equal
from backup_metrics
order by object_name;

select
  c.relname as backup_table,
  c.relrowsecurity as rls_enabled,
  (
    select count(*)
    from pg_policies p
    where p.schemaname = n.nspname
      and p.tablename = c.relname
  ) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    '_backup_029_payment_intake',
    '_backup_029_payment_intake_files',
    '_backup_029_payment_intake_events'
  )
order by c.relname;

commit;
