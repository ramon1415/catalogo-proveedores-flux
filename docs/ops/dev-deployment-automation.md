# DEV deployment automation - superseded

This document is kept only as a pointer for historical context.

The previous DEV automation based on manual GitHub Actions, custom `precheck.sql` / `load.sql` / `postcheck.sql` packages, `scripts/supabase/run_sql_file.js`, and `.ops-evidence` artifacts is deprecated.

Current strategy:

- Keep `supabase/migrations/` as the source of truth.
- Apply future schema changes with Supabase CLI.
- Use `supabase db push --dry-run` before applying.
- Review `supabase_migrations.schema_migrations` before DEV or PROD migration work.
- Use production backups and explicit authorization before PROD.

See:

```text
docs/ops/supabase-cli-migrations.md
```

Do not recreate per-migration ops packages unless Carlos/Ramon explicitly authorize a new operating model.
