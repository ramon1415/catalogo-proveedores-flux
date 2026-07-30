BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL default_transaction_read_only = on;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '45s';

SELECT CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 0 ELSE 1 END AS has_migrations \gset
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = 'supabase_migrations'
    AND table_name = 'schema_migrations'
    AND column_name = 'name'
) THEN 1 ELSE 0 END AS has_migration_name \gset
SELECT CASE WHEN to_regclass('public.notification_events') IS NULL THEN 0 ELSE 1 END AS has_notification_events \gset
SELECT CASE WHEN to_regclass('public.notification_delivery_attempts') IS NULL THEN 0 ELSE 1 END AS has_delivery_attempts \gset
SELECT CASE WHEN to_regclass('public.payment_intake') IS NULL THEN 0 ELSE 1 END AS has_payment_intake \gset
SELECT CASE WHEN to_regclass('public.proveedores') IS NULL THEN 0 ELSE 1 END AS has_proveedores \gset
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'proveedores'
    AND column_name = 'email'
) THEN 1 ELSE 0 END AS has_proveedores_email \gset
SELECT CASE WHEN to_regclass('public.payment_request_receipt_links') IS NULL THEN 0 ELSE 1 END AS has_receipt_links \gset
SELECT CASE WHEN to_regclass('public.payment_operation_evidence') IS NULL THEN 0 ELSE 1 END AS has_payment_evidence \gset
SELECT CASE WHEN to_regclass('public.financial_outbox_events') IS NULL THEN 0 ELSE 1 END AS has_financial_outbox \gset
SELECT CASE WHEN to_regclass('public.payment_requests') IS NULL THEN 0 ELSE 1 END AS has_payment_requests \gset
SELECT CASE WHEN to_regclass('storage.buckets') IS NULL THEN 0 ELSE 1 END AS has_storage_buckets \gset

\if :has_migrations
  \if :has_migration_name
    WITH required(version) AS (
      VALUES ('007'), ('010'), ('011'), ('025'), ('027'),
             ('029'), ('030'), ('032'), ('033'), ('034')
    ), entries AS (
      SELECT version::text AS version, name::text AS name
      FROM supabase_migrations.schema_migrations
    )
    SELECT jsonb_build_object(
      'section', 'migrations',
      'data', jsonb_build_object(
        'available', true,
        'entries', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('version', version, 'name', name)
            ORDER BY version, name
          )
          FROM entries
        ), '[]'::jsonb),
        'duplicates', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('version', version, 'count', entry_count)
            ORDER BY version
          )
          FROM (
            SELECT version, count(*)::integer AS entry_count
            FROM entries
            GROUP BY version
            HAVING count(*) > 1
          ) duplicate_rows
        ), '[]'::jsonb),
        'required_versions', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'version', required.version,
              'present', EXISTS (
                SELECT 1 FROM entries WHERE entries.version = required.version
              )
            )
            ORDER BY required.version
          )
          FROM required
        ), '[]'::jsonb)
      )
    )::text;
  \else
    WITH required(version) AS (
      VALUES ('007'), ('010'), ('011'), ('025'), ('027'),
             ('029'), ('030'), ('032'), ('033'), ('034')
    ), entries AS (
      SELECT version::text AS version
      FROM supabase_migrations.schema_migrations
    )
    SELECT jsonb_build_object(
      'section', 'migrations',
      'data', jsonb_build_object(
        'available', true,
        'entries', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('version', version, 'name', null)
            ORDER BY version
          )
          FROM entries
        ), '[]'::jsonb),
        'duplicates', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('version', version, 'count', entry_count)
            ORDER BY version
          )
          FROM (
            SELECT version, count(*)::integer AS entry_count
            FROM entries
            GROUP BY version
            HAVING count(*) > 1
          ) duplicate_rows
        ), '[]'::jsonb),
        'required_versions', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'version', required.version,
              'present', EXISTS (
                SELECT 1 FROM entries WHERE entries.version = required.version
              )
            )
            ORDER BY required.version
          )
          FROM required
        ), '[]'::jsonb)
      )
    )::text;
  \endif
\else
  SELECT jsonb_build_object(
    'section', 'migrations',
    'data', jsonb_build_object(
      'available', false,
      'entries', '[]'::jsonb,
      'duplicates', '[]'::jsonb,
      'required_versions', '[]'::jsonb
    )
  )::text;
\endif

WITH target_tables(schema_name, table_name) AS (
  VALUES
    ('public', 'notification_events'),
    ('public', 'notification_delivery_attempts'),
    ('public', 'payment_intake'),
    ('public', 'payment_intake_events'),
    ('public', 'intake_links'),
    ('public', 'payment_requests'),
    ('public', 'proveedores'),
    ('public', 'financial_outbox_events'),
    ('public', 'payment_request_receipt_links'),
    ('public', 'payment_operation_evidence'),
    ('public', 'external_resource_links'),
    ('public', 'external_access_grants'),
    ('storage', 'buckets')
), relations AS (
  SELECT
    target.schema_name,
    target.table_name,
    relation.oid,
    COALESCE(relation.relrowsecurity, false) AS rls_enabled
  FROM target_tables target
  LEFT JOIN pg_catalog.pg_namespace namespace_info
    ON namespace_info.nspname = target.schema_name
  LEFT JOIN pg_catalog.pg_class relation
    ON relation.relnamespace = namespace_info.oid
   AND relation.relname = target.table_name
   AND relation.relkind IN ('r', 'p', 'v', 'm')
)
SELECT jsonb_build_object(
  'section', 'database',
  'data', jsonb_build_object(
    'entities', COALESCE(jsonb_agg(
      jsonb_build_object(
        'name', relations.schema_name || '.' || relations.table_name,
        'exists', relations.oid IS NOT NULL,
        'rls_enabled', CASE WHEN relations.oid IS NULL THEN null ELSE relations.rls_enabled END,
        'columns', CASE WHEN relations.oid IS NULL THEN '[]'::jsonb ELSE COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', attribute_info.attname,
              'type', pg_catalog.format_type(attribute_info.atttypid, attribute_info.atttypmod),
              'nullable', NOT attribute_info.attnotnull,
              'default_present', default_info.adbin IS NOT NULL,
              'classification', CASE
                WHEN attribute_info.attname ILIKE '%n8n%' THEN 'LEGACY_SCHEMA_ONLY'
                ELSE 'ACTIVE_SCHEMA'
              END
            )
            ORDER BY attribute_info.attnum
          )
          FROM pg_catalog.pg_attribute attribute_info
          LEFT JOIN pg_catalog.pg_attrdef default_info
            ON default_info.adrelid = attribute_info.attrelid
           AND default_info.adnum = attribute_info.attnum
          WHERE attribute_info.attrelid = relations.oid
            AND attribute_info.attnum > 0
            AND NOT attribute_info.attisdropped
        ), '[]'::jsonb) END,
        'constraints', CASE WHEN relations.oid IS NULL THEN '[]'::jsonb ELSE COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', constraint_info.conname,
              'type', CASE constraint_info.contype
                WHEN 'p' THEN 'primary_key'
                WHEN 'f' THEN 'foreign_key'
                WHEN 'u' THEN 'unique'
                WHEN 'c' THEN 'check'
                WHEN 'x' THEN 'exclusion'
                ELSE 'other'
              END,
              'validated', constraint_info.convalidated,
              'classification', CASE
                WHEN constraint_info.conname ILIKE '%n8n%' THEN 'LEGACY_SCHEMA_ONLY'
                ELSE 'ACTIVE_SCHEMA'
              END
            )
            ORDER BY constraint_info.conname
          )
          FROM pg_catalog.pg_constraint constraint_info
          WHERE constraint_info.conrelid = relations.oid
        ), '[]'::jsonb) END,
        'indexes', CASE WHEN relations.oid IS NULL THEN '[]'::jsonb ELSE COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', index_relation.relname,
              'unique', index_info.indisunique,
              'primary', index_info.indisprimary,
              'valid', index_info.indisvalid,
              'classification', CASE
                WHEN index_relation.relname ILIKE '%n8n%' THEN 'LEGACY_SCHEMA_ONLY'
                ELSE 'ACTIVE_SCHEMA'
              END
            )
            ORDER BY index_relation.relname
          )
          FROM pg_catalog.pg_index index_info
          JOIN pg_catalog.pg_class index_relation
            ON index_relation.oid = index_info.indexrelid
          WHERE index_info.indrelid = relations.oid
        ), '[]'::jsonb) END,
        'policies', CASE WHEN relations.oid IS NULL THEN '[]'::jsonb ELSE COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', policy_info.policyname,
              'command', policy_info.cmd,
              'permissive', policy_info.permissive,
              'roles', to_jsonb(policy_info.roles)
            )
            ORDER BY policy_info.policyname
          )
          FROM pg_catalog.pg_policies policy_info
          WHERE policy_info.schemaname = relations.schema_name
            AND policy_info.tablename = relations.table_name
        ), '[]'::jsonb) END,
        'grants', CASE WHEN relations.oid IS NULL THEN '[]'::jsonb ELSE COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'grantee', grant_info.grantee,
              'privilege', grant_info.privilege_type
            )
            ORDER BY grant_info.grantee, grant_info.privilege_type
          )
          FROM information_schema.role_table_grants grant_info
          WHERE grant_info.table_schema = relations.schema_name
            AND grant_info.table_name = relations.table_name
        ), '[]'::jsonb) END,
        'triggers', CASE WHEN relations.oid IS NULL THEN '[]'::jsonb ELSE COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', trigger_info.tgname,
              'enabled', trigger_info.tgenabled::text,
              'function_name', trigger_function.proname
            )
            ORDER BY trigger_info.tgname
          )
          FROM pg_catalog.pg_trigger trigger_info
          JOIN pg_catalog.pg_proc trigger_function
            ON trigger_function.oid = trigger_info.tgfoid
          WHERE trigger_info.tgrelid = relations.oid
            AND NOT trigger_info.tgisinternal
        ), '[]'::jsonb) END
      )
      ORDER BY relations.schema_name, relations.table_name
    ), '[]'::jsonb),
    'functions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', function_info.proname,
          'identity_arguments', pg_catalog.pg_get_function_identity_arguments(function_info.oid),
          'security_definer', function_info.prosecdef,
          'volatility', function_info.provolatile::text
        )
        ORDER BY function_info.proname,
                 pg_catalog.pg_get_function_identity_arguments(function_info.oid)
      )
      FROM pg_catalog.pg_proc function_info
      JOIN pg_catalog.pg_namespace function_namespace
        ON function_namespace.oid = function_info.pronamespace
      WHERE function_namespace.nspname = 'public'
        AND function_info.proname ~ '^(notification_|claim_notification|mark_notification|enqueue_|provider_intake|transition_provider_intake|payment_receipt|link_payment_receipt|get_payment_.*receipt|external_)'
    ), '[]'::jsonb),
    'enum_types', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', type_info.typname,
          'labels', (
            SELECT jsonb_agg(enum_info.enumlabel ORDER BY enum_info.enumsortorder)
            FROM pg_catalog.pg_enum enum_info
            WHERE enum_info.enumtypid = type_info.oid
          )
        )
        ORDER BY type_info.typname
      )
      FROM pg_catalog.pg_type type_info
      JOIN pg_catalog.pg_namespace type_namespace
        ON type_namespace.oid = type_info.typnamespace
      WHERE type_namespace.nspname = 'public'
        AND type_info.typtype = 'e'
        AND type_info.typname IN (
          'payment_request_status',
          'payment_request_type',
          'payment_flow'
        )
    ), '[]'::jsonb)
  )
)::text
FROM relations;

\if :has_notification_events
  \if :has_delivery_attempts
    SELECT jsonb_build_object(
      'section', 'notification_aggregates',
      'data', jsonb_build_object(
        'available', true,
        'total', (SELECT count(*)::integer FROM public.notification_events),
        'by_status', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('status', status, 'count', item_count) ORDER BY status)
          FROM (
            SELECT status, count(*)::integer AS item_count
            FROM public.notification_events
            GROUP BY status
          ) grouped
        ), '[]'::jsonb),
        'by_event_type', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('event_type', event_type, 'count', item_count) ORDER BY event_type)
          FROM (
            SELECT event_type, count(*)::integer AS item_count
            FROM public.notification_events
            GROUP BY event_type
          ) grouped
        ), '[]'::jsonb),
        'by_status_event_type', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('status', status, 'event_type', event_type, 'count', item_count)
            ORDER BY status, event_type
          )
          FROM (
            SELECT status, event_type, count(*)::integer AS item_count
            FROM public.notification_events
            GROUP BY status, event_type
          ) grouped
        ), '[]'::jsonb),
        'recipient_present', (SELECT count(*)::integer FROM public.notification_events WHERE nullif(btrim(coalesce(recipient_email, '')), '') IS NOT NULL),
        'recipient_absent', (SELECT count(*)::integer FROM public.notification_events WHERE nullif(btrim(coalesce(recipient_email, '')), '') IS NULL),
        'processing_total', (SELECT count(*)::integer FROM public.notification_events WHERE status = 'processing'),
        'max_processing_age_seconds', (
          SELECT CASE WHEN count(*) = 0 THEN null ELSE floor(max(extract(epoch FROM (now() - locked_at))))::bigint END
          FROM public.notification_events
          WHERE status = 'processing' AND locked_at IS NOT NULL
        ),
        'failed', (SELECT count(*)::integer FROM public.notification_events WHERE status = 'failed'),
        'dead_letter', (SELECT count(*)::integer FROM public.notification_events WHERE status = 'dead_letter'),
        'cancelled', (SELECT count(*)::integer FROM public.notification_events WHERE status = 'cancelled'),
        'events_without_attempts', (
          SELECT count(*)::integer
          FROM public.notification_events event_info
          WHERE NOT EXISTS (
            SELECT 1
            FROM public.notification_delivery_attempts attempt_info
            WHERE attempt_info.notification_event_id = event_info.id
          )
        ),
        'events_with_multiple_attempts', (
          SELECT count(*)::integer
          FROM (
            SELECT notification_event_id
            FROM public.notification_delivery_attempts
            GROUP BY notification_event_id
            HAVING count(*) > 1
          ) grouped_attempts
        ),
        'attempts_available', true,
        'attempts_by_status', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('status', status, 'count', item_count) ORDER BY status)
          FROM (
            SELECT status, count(*)::integer AS item_count
            FROM public.notification_delivery_attempts
            GROUP BY status
          ) grouped
        ), '[]'::jsonb),
        'max_attempt_number', (SELECT max(attempt_number)::integer FROM public.notification_delivery_attempts)
      )
    )::text;
  \else
    SELECT jsonb_build_object(
      'section', 'notification_aggregates',
      'data', jsonb_build_object(
        'available', true,
        'total', (SELECT count(*)::integer FROM public.notification_events),
        'by_status', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('status', status, 'count', item_count) ORDER BY status)
          FROM (SELECT status, count(*)::integer AS item_count FROM public.notification_events GROUP BY status) grouped
        ), '[]'::jsonb),
        'by_event_type', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('event_type', event_type, 'count', item_count) ORDER BY event_type)
          FROM (SELECT event_type, count(*)::integer AS item_count FROM public.notification_events GROUP BY event_type) grouped
        ), '[]'::jsonb),
        'by_status_event_type', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('status', status, 'event_type', event_type, 'count', item_count) ORDER BY status, event_type)
          FROM (SELECT status, event_type, count(*)::integer AS item_count FROM public.notification_events GROUP BY status, event_type) grouped
        ), '[]'::jsonb),
        'recipient_present', (SELECT count(*)::integer FROM public.notification_events WHERE nullif(btrim(coalesce(recipient_email, '')), '') IS NOT NULL),
        'recipient_absent', (SELECT count(*)::integer FROM public.notification_events WHERE nullif(btrim(coalesce(recipient_email, '')), '') IS NULL),
        'processing_total', (SELECT count(*)::integer FROM public.notification_events WHERE status = 'processing'),
        'max_processing_age_seconds', (
          SELECT CASE WHEN count(*) = 0 THEN null ELSE floor(max(extract(epoch FROM (now() - locked_at))))::bigint END
          FROM public.notification_events
          WHERE status = 'processing' AND locked_at IS NOT NULL
        ),
        'failed', (SELECT count(*)::integer FROM public.notification_events WHERE status = 'failed'),
        'dead_letter', (SELECT count(*)::integer FROM public.notification_events WHERE status = 'dead_letter'),
        'cancelled', (SELECT count(*)::integer FROM public.notification_events WHERE status = 'cancelled'),
        'events_without_attempts', null,
        'events_with_multiple_attempts', null,
        'attempts_available', false,
        'attempts_by_status', '[]'::jsonb,
        'max_attempt_number', null
      )
    )::text;
  \endif
\else
  SELECT jsonb_build_object(
    'section', 'notification_aggregates',
    'data', jsonb_build_object(
      'available', false,
      'total', null,
      'by_status', '[]'::jsonb,
      'by_event_type', '[]'::jsonb,
      'by_status_event_type', '[]'::jsonb,
      'recipient_present', null,
      'recipient_absent', null,
      'processing_total', null,
      'max_processing_age_seconds', null,
      'failed', null,
      'dead_letter', null,
      'cancelled', null,
      'events_without_attempts', null,
      'events_with_multiple_attempts', null,
      'attempts_available', false,
      'attempts_by_status', '[]'::jsonb,
      'max_attempt_number', null
    )
  )::text;
\endif

\if :has_payment_intake
  SELECT jsonb_build_object(
    'section', 'intake_aggregates',
    'data', jsonb_build_object(
      'available', true,
      'total', (SELECT count(*)::integer FROM public.payment_intake),
      'by_status', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('status', status, 'count', item_count) ORDER BY status)
        FROM (
          SELECT status, count(*)::integer AS item_count
          FROM public.payment_intake
          GROUP BY status
        ) grouped
      ), '[]'::jsonb)
    )
  )::text;
\else
  SELECT jsonb_build_object(
    'section', 'intake_aggregates',
    'data', jsonb_build_object('available', false, 'total', null, 'by_status', '[]'::jsonb)
  )::text;
\endif

\if :has_proveedores
  \if :has_proveedores_email
    SELECT jsonb_build_object(
      'section', 'provider_aggregates',
      'data', jsonb_build_object(
        'available', true,
        'email_column_present', true,
        'with_email', (SELECT count(*)::integer FROM public.proveedores WHERE nullif(btrim(coalesce(email, '')), '') IS NOT NULL),
        'without_email', (SELECT count(*)::integer FROM public.proveedores WHERE nullif(btrim(coalesce(email, '')), '') IS NULL)
      )
    )::text;
  \else
    SELECT jsonb_build_object(
      'section', 'provider_aggregates',
      'data', jsonb_build_object(
        'available', true,
        'email_column_present', false,
        'with_email', null,
        'without_email', null
      )
    )::text;
  \endif
\else
  SELECT jsonb_build_object(
    'section', 'provider_aggregates',
    'data', jsonb_build_object(
      'available', false,
      'email_column_present', false,
      'with_email', null,
      'without_email', null
    )
  )::text;
\endif

\if :has_receipt_links
  SELECT jsonb_build_object(
    'section', 'receipt_link_aggregates',
    'data', jsonb_build_object(
      'available', true,
      'total', (SELECT count(*)::integer FROM public.payment_request_receipt_links),
      'distinct_requests', (SELECT count(DISTINCT payment_request_id)::integer FROM public.payment_request_receipt_links),
      'distinct_evidences', (SELECT count(DISTINCT evidence_id)::integer FROM public.payment_request_receipt_links),
      'duplicate_requests', (
        SELECT count(*)::integer
        FROM (
          SELECT payment_request_id
          FROM public.payment_request_receipt_links
          GROUP BY payment_request_id
          HAVING count(*) > 1
        ) grouped
      ),
      'duplicate_evidences', (
        SELECT count(*)::integer
        FROM (
          SELECT evidence_id
          FROM public.payment_request_receipt_links
          GROUP BY evidence_id
          HAVING count(*) > 1
        ) grouped
      )
    )
  )::text;
\else
  SELECT jsonb_build_object(
    'section', 'receipt_link_aggregates',
    'data', jsonb_build_object(
      'available', false,
      'total', null,
      'distinct_requests', null,
      'distinct_evidences', null,
      'duplicate_requests', null,
      'duplicate_evidences', null
    )
  )::text;
\endif

\if :has_payment_evidence
  SELECT jsonb_build_object(
    'section', 'evidence_aggregates',
    'data', jsonb_build_object(
      'available', true,
      'total', (SELECT count(*)::integer FROM public.payment_operation_evidence),
      'shareable', (SELECT count(*)::integer FROM public.payment_operation_evidence WHERE status = 'shareable'),
      'one_page', (SELECT count(*)::integer FROM public.payment_operation_evidence WHERE page_count = 1),
      'single_operation_attested', (SELECT count(*)::integer FROM public.payment_operation_evidence WHERE single_operation_attested)
    )
  )::text;
\else
  SELECT jsonb_build_object(
    'section', 'evidence_aggregates',
    'data', jsonb_build_object(
      'available', false,
      'total', null,
      'shareable', null,
      'one_page', null,
      'single_operation_attested', null
    )
  )::text;
\endif

\if :has_financial_outbox
  SELECT jsonb_build_object(
    'section', 'outbox_aggregates',
    'data', jsonb_build_object(
      'available', true,
      'payment_receipt_linked_events', (
        SELECT count(*)::integer
        FROM public.financial_outbox_events
        WHERE event_type = 'payment_receipt.linked'
      )
    )
  )::text;
\else
  SELECT jsonb_build_object(
    'section', 'outbox_aggregates',
    'data', jsonb_build_object('available', false, 'payment_receipt_linked_events', null)
  )::text;
\endif

\if :has_payment_requests
  SELECT jsonb_build_object(
    'section', 'payment_request_aggregates',
    'data', jsonb_build_object(
      'available', true,
      'by_status', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('status', status_text, 'count', item_count) ORDER BY status_text)
        FROM (
          SELECT status::text AS status_text, count(*)::integer AS item_count
          FROM public.payment_requests
          GROUP BY status::text
        ) grouped
      ), '[]'::jsonb)
    )
  )::text;
\else
  SELECT jsonb_build_object(
    'section', 'payment_request_aggregates',
    'data', jsonb_build_object('available', false, 'by_status', '[]'::jsonb)
  )::text;
\endif

\if :has_storage_buckets
  SELECT jsonb_build_object(
    'section', 'storage_metadata',
    'data', jsonb_build_object(
      'available', true,
      'bucket_total', (SELECT count(*)::integer FROM storage.buckets),
      'public_bucket_total', (SELECT count(*)::integer FROM storage.buckets WHERE public),
      'private_bucket_total', (SELECT count(*)::integer FROM storage.buckets WHERE NOT public),
      'objects_policy_count', (
        SELECT count(*)::integer
        FROM pg_catalog.pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
      ),
      'objects_policies', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'name', policyname,
            'command', cmd,
            'roles', to_jsonb(roles)
          )
          ORDER BY policyname
        )
        FROM pg_catalog.pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
      ), '[]'::jsonb)
    )
  )::text;
\else
  SELECT jsonb_build_object(
    'section', 'storage_metadata',
    'data', jsonb_build_object(
      'available', false,
      'bucket_total', null,
      'public_bucket_total', null,
      'private_bucket_total', null,
      'objects_policy_count', null,
      'objects_policies', '[]'::jsonb
    )
  )::text;
\endif

COMMIT;
