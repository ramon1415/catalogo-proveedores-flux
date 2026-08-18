-- apply load
-- N3A: server-verified payroll materialization. Draft only: do not apply in this gate.
-- Browser attestations remain diagnostic. Only the service-role Edge Function may
-- call the internal transaction after downloading, hashing, parsing and validating.
' + ((Get-Content supabase/migrations/20260818110000_payroll_n3a_server_materialization.sql -Raw) ) + "`n" | Set-Content ops/n3a-deploy-check/load.sql -Encoding UTF8; @' 
-- postcheck
\set ON_ERROR_STOP on
\echo 'N3A_POSTCHECK_BEGIN'
select to_regproc('public.set_payroll_capture_accounting_context') is not null as fn_accounting_exists,
       to_regproc('public.get_payroll_materialization_context_internal') is not null as fn_materialization_context_exists,
       to_regproc('public.materialize_payroll_capture_internal') is not null as fn_materialize_exists,
       to_regproc('public.payroll_validate_materialized_capture_file') is not null as fn_validate_exists;
select to_regclass('public.payroll_capture_sessions') is not null as sessions_table,
       to_regclass('public.payroll_capture_files') is not null as files_table,
       to_regclass('public.payroll_channels') is not null as channels_table;
\echo 'N3A_POSTCHECK_DONE'
