# P3 permissions hardening — DEV

## Scope

P3 removes unscoped financial approval authority and preserves explicit,
scoped requester-to-approver routing. Migrations 018 and 019 are not reapplied.

## Migration 044

`supabase/migrations/044_harden_approval_rules_for_explicit_routing.sql`
was applied exactly once to Supabase DEV. It disables active catch-all rules
only when all of the following are true:

- the normalized role is `administracion`, `finance`, `finanzas`,
  `tesoreria` or `treasury`;
- `company_id` is null;
- `cost_center_id` is null;
- the range starts at zero and has no upper bound.

Specific company, cost-center or bounded rules remain untouched. Roles are
preserved. Privileged roles are outside this migration.

## Release-specific identity decision

Por decisión operativa de este release, los usuarios nominales no se crearán
en DEV. La validación funcional fue realizada con usuarios equivalentes. Los
usuarios reales y sus configuraciones serán dados de alta por Ramón
directamente en PROD mediante el módulo web de Permisos y Asignación de
Roles.

This is a release-specific operational decision. It is not a general security
policy prohibiting named users in DEV.

### DEV

- Migration 044 was applied once.
- The active financial catch-all count is zero.
- Manual UAT passed with equivalent existing users.
- Named users are not required for this release.
- No nominal configuration remains pending in DEV.
- No identity SQL seed is executed.
- No nominal memberships are created.
- No nominal approval routing is configured.

### PROD

- Ramón will create or enable the real users through the web platform.
- Ramón will assign company, roles, permissions and assignments through the
  web platform.
- Ramón will configure the correct approval routes through the platform.
- No SQL identity seed will be used.
- No UUID, email address or person will be hardcoded.
- PROD remains unchanged until a separately authorized release gate.

## Directors and future changes

P3 does not write `company_directors`. Director configuration belongs to
Cortes/P4 and remains data-driven:

- no person name or identifier is hardcoded;
- zero, one or multiple active directors are representable;
- future additions, deactivations or replacements are controlled,
  auditable configuration changes;
- the application derives active directors from `company_directors`.

The existing migration
`034_support_multiple_active_company_directors.sql` is preserved. P3 does
not apply migration 021/034 or materialize a director identity.

## Final state

- `M044=APPLIED_ONCE`
- `M044_HISTORY_VERSION=20260804210918`
- `FINANCIAL_CATCH_ALL_ACTIVE=0`
- `MANUAL_DEV_UAT=PASS`
- `UAT_MODE=EQUIVALENT_EXISTING_USERS`
- `DEV_NAMED_USER_CONFIGURATION=NOT_REQUIRED`
- `PROD_NAMED_USER_CONFIGURATION=PENDING_RAMON`
- `PROD_MUTATIONS=0`
- `P4_CORTES=NOT_STARTED`

## Boundaries

No migration is reapplied by this documentation gate. No user, profile,
membership, role, permission, assignment, routing or director record is
created or modified. P3 remains stopped for Ramón's decision before any PROD
action.
