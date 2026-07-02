# Notifications ledger export - DEV read-only

This package exports catalog metadata for the notification objects that Carlos reported as ad-hoc in DEV.

It exists because the repository currently references notification runtime tables but does not contain the exact DDL needed to create `supabase/migrations/007_notifications.sql` safely.

## Why this package exists

Static repo audit found references to:

- `public.notification_events`
- `public.notification_delivery_attempts`

But no migration in `supabase/migrations/` creates those tables, functions, triggers, RLS policies, or grants.

Carlos reported that DEV has notification objects outside the ledger:

- 2 tables
- 8 functions
- 1 trigger
- RLS / policies

Because the exact definitions are not present in the repo, we should not invent `007_notifications.sql` yet.

## Safety

- `precheck.sql`, `load.sql`, and `postcheck.sql` are read-only.
- They query PostgreSQL catalogs only.
- They do not read notification payload rows.
- They do not modify data or schema.
- They do not touch n8n.
- They do not contain secrets or service_role usage.

## Future authorized execution

After this PR is reviewed and merged to `dev`, run only with explicit DEV authorization:

```text
Actions -> Deploy Supabase DEV Manual -> Run workflow
Branch: dev
script_path: ops/schema-audit/notifications-ledger-export
confirm_dev: scsirgbuqjcwoaxfacth
```

Do not run this package in PROD.

## Expected result

The desired result is:

```text
NOTIFICATIONS_LEDGER_EXPORT_READY_FOR_007_SOURCE
```

That means the export found the expected tables, at least 8 related functions, at least 1 trigger, RLS enabled, and policies.

If the result is:

```text
NOTIFICATIONS_LEDGER_EXPORT_INCOMPLETE_REVIEW_REQUIRED
```

then use the exported catalog evidence to determine what is missing before writing `007_notifications.sql`.

## Next step after execution

Create a separate reviewed PR for:

```text
supabase/migrations/007_notifications.sql
```

The migration must be built from the DDL exported by this package. It must be idempotent, must not activate real sends, must not touch n8n, and must not include secrets or operational data.
