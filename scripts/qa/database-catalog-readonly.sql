BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
 'captured_at', current_timestamp,
 'project_ref', 'scsirgbuqjcwoaxfacth',
 'server_version', current_setting('server_version'),
 'read_only', current_setting('transaction_read_only'),
 'functions', (SELECT jsonb_agg(jsonb_build_object(
   'schema', n.nspname, 'name', p.proname, 'identity', pg_get_function_identity_arguments(p.oid),
   'definition', pg_get_functiondef(p.oid), 'body', p.prosrc, 'config', p.proconfig,
   'security_definer', p.prosecdef, 'volatility', p.provolatile,
   'anon_execute', has_function_privilege('anon',p.oid,'EXECUTE'),
   'authenticated_execute', has_function_privilege('authenticated',p.oid,'EXECUTE'),
   'service_execute', has_function_privilege('service_role',p.oid,'EXECUTE'),
   'public_execute', EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
 ) ORDER BY n.nspname,p.proname,p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','private') AND p.prokind='f' AND p.proname ~ '(provider_intake|provider_match|payment_reconciliation|payment_receipt|payment_operation_evidence|payment_document_extraction|extraordinary|materialize_closed_batch|create_payable_snapshot|financial_outbox|mark_payment_request_material|complete_payment_request_layout|provider_payment|save_provider_catalog|guard_payment_request_execution|company_director_for_future_batches|approval_batch|approve_entire_batch|decide_approval_batch_items|list_director_approval_batches|claim_notification_events|notification_receipt_linked|notification_payment_outcome)'),
 'recovery_jobs', (SELECT jsonb_agg(jsonb_build_object('jobname',jobname,'schedule',schedule,'active',active,'command',command)) FROM cron.job WHERE command='select public.notification_payment_outcome_recovery_wakeup_internal();'),
 'financial_catch_all_count', (SELECT count(*) FROM public.approval_rules rule JOIN public.roles role ON role.id=rule.role_id WHERE lower(btrim(role.name))=ANY(ARRAY['administracion','finance','finanzas','tesoreria','treasury']) AND rule.active AND rule.company_id IS NULL AND rule.cost_center_id IS NULL AND coalesce(rule.amount_min,0)=0 AND rule.amount_max IS NULL),
 'tables', (SELECT jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,
   'anon_select',has_table_privilege('anon',c.oid,'SELECT'),
   'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
   'authenticated_insert',has_table_privilege('authenticated',c.oid,'INSERT'),
   'authenticated_update',has_table_privilege('authenticated',c.oid,'UPDATE'),
   'authenticated_delete',has_table_privilege('authenticated',c.oid,'DELETE')
 ) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',ic.relname,'unique',i.indisunique,'valid',i.indisvalid,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY c.relname,ic.relname) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public'),
 'buckets',(SELECT jsonb_agg(jsonb_build_object('id',id,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) ORDER BY id) FROM storage.buckets WHERE id IN ('extraordinary-approval-evidence','extraordinary-authorizations','payment-batch-documents'))
) AS catalog;
COMMIT;
