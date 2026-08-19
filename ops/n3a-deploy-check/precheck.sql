-- precheck probe (snapshot only)
\set ON_ERROR_STOP on
\echo 'N3A_PRECHECK_BEGIN'
\echo 'finance_active_count'
select count(*)::text as finance_active from public.user_roles ur
join public.roles r on r.id=ur.role_id
join public.profiles p on p.id=ur.profile_id
where lower(r.name) in ('finance','finanzas','treasury','tesoreria','administracion') and p.active;
\echo 'payroll_capture_sessions_count'
select count(*)::text as payroll_capture_sessions from public.payroll_capture_sessions;
\echo 'payroll_capture_files_count'
select count(*)::text as payroll_capture_files from public.payroll_capture_files;
\echo 'payroll_private_object_count'
select count(*)::text as payroll_private_object_count
from storage.objects o
where o.bucket_id = (select id from storage.buckets where name = 'payroll-private' limit 1);
\echo 'payment_requests_nomina_count'
select count(*)::text as payment_requests_nomina from public.payment_requests where request_type='nomina';
\echo 'payroll_channels_count'
select count(*)::text as payroll_channels_count from public.payroll_channels;
\echo 'payroll_run_files_count'
select count(*)::text as payroll_run_files_count from public.payroll_run_files;
\echo 'payroll_run_lines_count'
select count(*)::text as payroll_run_lines_count from public.payroll_run_lines;
\echo 'approval_items_nomina_count'
select count(*)::text as approval_items_nomina from public.approval_batch_items where payment_request_id in (select id from public.payment_requests where request_type='nomina');
\echo 'layout_lines_nomina_count'
select case
         when to_regclass('public.payment_layout_lines') is null then '0'
         else (select count(*)::text from public.payment_layout_lines where payment_request_id in (select id from public.payment_requests where request_type='nomina') )
       end as layout_lines_nomina;
\echo 'notification_events_payroll_count'
select count(*)::text as notification_events_payroll from public.notification_events where source='payment_requests' and (source_id in (select id from public.payment_requests where request_type='nomina') or payload::text like '%%"nomina"%%');
\echo 'approval_items_nomina_count2'
select count(*)::text as approval_items_nomina2 from public.payment_request_approvals where payment_request_id in (select id from public.payment_requests where request_type='nomina');
\echo 'delivery_attempts_payroll_count'
select count(*)::text as delivery_attempts_payroll from public.notification_delivery_attempts where notification_event_id in (select id from public.notification_events where source='payment_requests' and (source_id in (select id from public.payment_requests where request_type='nomina') or payload::text like '%%"nomina"%%'));
