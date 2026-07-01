-- Flux Operadora - DB ledger reconciliation 007 postcheck
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: solo SELECT. No modifica datos ni esquema.

with presence as (
  select
    to_regclass('public.payment_request_number_seq') is not null as has_payment_request_number_seq,
    to_regclass('public.payment_layout_number_seq') is not null as has_payment_layout_number_seq,
    to_regclass('public.notification_events') is not null as has_notification_events,
    to_regclass('public.notification_delivery_attempts') is not null as has_notification_delivery_attempts,
    to_regclass('public.historical_actuals') is not null as has_historical_actuals,
    to_regclass('public.payment_receipts') is not null as has_payment_receipts,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'payment_receipts'
        and column_name = 'notes'
    ) as payment_receipts_has_notes
)
select
  'DB_LEDGER_RECONCILIATION_007_READ_ONLY_AUDIT_READY' as result,
  has_payment_request_number_seq,
  has_payment_layout_number_seq,
  case
    when has_notification_events and has_notification_delivery_attempts
      then 'NOTIFICATIONS_BLOCKED_NEEDS_DB_INTROSPECTION'
    else 'NOTIFICATIONS_NOT_FOUND_OR_INCOMPLETE_IN_TARGET'
  end as notifications_result,
  case
    when has_historical_actuals
      then 'HISTORICAL_ACTUALS_BLOCKED_NEEDS_SCHEMA_EXPORT'
    else 'HISTORICAL_ACTUALS_NOT_FOUND_IN_TARGET'
  end as historical_actuals_result,
  has_payment_receipts,
  case
    when payment_receipts_has_notes
      then 'PR_134_PAYMENT_RECEIPTS_NOTES_COLUMN_EXISTS_IN_TARGET'
    else 'PR_134_PAYMENT_RECEIPTS_REVIEWED_NO_NOTES_COLUMN_FOUND_IN_TARGET'
  end as pr_134_payment_receipts_result
from presence;
