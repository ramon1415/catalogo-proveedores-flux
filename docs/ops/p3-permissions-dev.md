# P3 permissions hardening — DEV

## Scope

P3 removes unscoped financial approval authority and prepares explicit,
company-scoped requester-to-approver routing in Supabase DEV.

The gate must not reapply migrations 018 or 019. Their material objects are
verified before any DEV mutation.

## Forward-only migration

`supabase/migrations/044_harden_approval_rules_for_explicit_routing.sql`
disables active catch-all rules only when all of the following are true:

- the normalized role is `administracion`, `finance`, `finanzas`,
  `tesoreria` or `treasury`;
- `company_id` is null;
- `cost_center_id` is null;
- the range starts at zero and has no upper bound.

Specific company, cost-center or bounded rules remain untouched. Roles are
preserved. Privileged roles are outside this migration.

## DEV operational seed

The controlled DEV transaction, executed separately from the migration, must
resolve real profiles and the canonical live company without publishing UUIDs
or complete email addresses.

The intended routing is:

- FRANCISCO → ALFREDO
- ALFREDO → YANIN
- FELIPE → no profile, role, membership or assignment created by this gate

ADMIN_TEMPORAL loses only `sysadmin`. The Auth user and profile remain, and no
replacement role is invented.

## Directors and future changes

CÉSAR is the only currently designated cut director. This is an operational
snapshot, not a permanent product constraint.

P3 does not write `company_directors`. Director configuration belongs to
Cortes/P4 and must remain data-driven:

- no person name or identifier may be hardcoded;
- zero, one or multiple active directors must be representable according to the
  live business decision;
- adding, deactivating or replacing a director in DEV or PROD must be a
  controlled data/configuration change with auditability;
- the application must derive active directors from `company_directors`, not
  from a fixed assumption that César is always the only director.

The existing migration
`034_support_multiple_active_company_directors.sql` is preserved. P3 neither
applies migration 021/034 nor materializes César.

## Required execution order

1. Capture sanitized counts and alias state from DEV.
2. Run the full P3 transaction as a dry-run and roll it back.
3. Confirm no business-data deltas.
4. Apply migration 044 and the approved operational seed once.
5. Execute authenticated DEV UAT with real sessions.
6. Clean synthetic QA records while preserving mandatory audit evidence.
7. Stop for Ramón review before any PROD action.

## Current state

- migration 044: VERSIONED / NOT_APPLIED
- DEV seed: NOT_APPLIED
- authenticated UAT: NOT_EXECUTED
- PROD changes: 0
- P4/Cortes: NOT_STARTED
