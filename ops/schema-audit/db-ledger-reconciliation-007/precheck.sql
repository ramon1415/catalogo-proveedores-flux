-- Flux Operadora - DB ledger reconciliation 007 precheck
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: solo SELECT. No modifica datos ni esquema.

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  now() as checked_at;

with expected_objects(object_kind, object_schema, object_name) as (
  values
    ('sequence', 'public', 'payment_request_number_seq'),
    ('sequence', 'public', 'payment_layout_number_seq'),
    ('table', 'public', 'notification_events'),
    ('table', 'public', 'notification_delivery_attempts'),
    ('table', 'public', 'historical_actuals'),
    ('table', 'public', 'payment_receipts')
)
select
  object_kind,
  object_schema,
  object_name,
  to_regclass(format('%I.%I', object_schema, object_name)) is not null as exists_in_target
from expected_objects
order by object_kind, object_schema, object_name;

select
  'DB_LEDGER_RECONCILIATION_007_PRECHECK_READ_ONLY' as result,
  'No DDL/DML executed by this precheck' as detail;
