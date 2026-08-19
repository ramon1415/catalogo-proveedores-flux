-- postcheck
\set ON_ERROR_STOP on
\echo 'N3A_POSTCHECK_BEGIN'
\echo 'ledger_version_present'
select count(*)::text as n3a_migration_count
from supabase_migrations.schema_migrations
where version = '20260818110000_payroll_n3a_server_materialization';

\echo 'n3a_function_exists'
select to_regprocedure('public.set_payroll_capture_accounting_context(uuid,integer,uuid,uuid,date)') is not null as set_context_exists,
       to_regprocedure('public.get_payroll_materialization_context_internal(uuid,integer)') is not null as get_context_exists,
       to_regprocedure('public.materialize_payroll_capture_internal(uuid,integer,text,jsonb)') is not null as materialize_exists,
       to_regprocedure('public.payroll_validate_materialized_capture_file()') is not null as validate_exists;

\echo 'n3a_trigger_defs_present'
select
  (select pg_get_triggerdef(t.oid)
   from pg_trigger t
   where t.tgname = 'payment_request_created_notification_event'
     and t.tgrelid = 'public.payment_requests'::regclass) is not null as payment_request_created_notification_trigger_exists,
  (select pg_get_triggerdef(t.oid)
   from pg_trigger t
   where t.tgname = 'validate_payment_request_approver_scope_insert'
     and t.tgrelid = 'public.payment_requests'::regclass) is not null as validate_approver_trigger_exists;

\echo 'n3a_sessions_and_files_tables'
select to_regclass('public.payroll_capture_sessions') is not null as sessions_table,
       to_regclass('public.payroll_capture_files') is not null as files_table,
       to_regclass('public.payroll_channels') is not null as channels_table;
\echo 'N3A_POSTCHECK_DONE'