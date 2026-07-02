-- Flux Operadora - DEV ops load for migration 007 notifications ledger
-- Source migration: supabase/migrations/007_notifications.sql
-- Scope: apply only the versioned notifications ledger DDL in Supabase DEV.
-- Safety: this file is executed by psql through scripts/supabase/run_sql_file.js.

\echo 'Applying exact versioned migration: supabase/migrations/007_notifications.sql'
\i supabase/migrations/007_notifications.sql
