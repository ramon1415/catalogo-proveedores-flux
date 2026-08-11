# Flux DEV authoritative brownfield baseline

## Product outcome

Establish a reproducible baseline derived from the current working Supabase DEV state so PR #283 can proceed without replaying the historical chain.

## Baseline

- Active baseline: 20260811035345_flux_dev_authoritative_brownfield_baseline_v2.sql
- Baseline SHA-256: a520701380831df138a6e37ee0327b89fc9743cc1a40b2f2e9a839c226ce1d9a
- Historical active migrations preserved under supabase/migrations-legacy/active-pre-brownfield/: 86
- DEV schema/history/data writes during capture: 0
- Required extension bootstrap is emitted before every schema consumer and uses the schema discovered from DEV.

## Material allowlist

- public.payment_matching_policy_versions: 3 deterministic non-PII configuration rows.
- storage.buckets: 7 deterministic non-PII configuration rows.

## History transition

This PR does not repair DEV history. A separate approved gate must mark the baseline as already materialized and retire legacy history rows without executing baseline SQL against DEV.

## PR #283

After this baseline is approved and merged, rename only the migration version prefix to 20260811035346_043_provider_intake_payment_draft.sql while preserving the 043 SQL bytes.

## Known debt

The 16 pre-existing public tables without RLS are carried forward exactly. Remediation belongs to a separate Product/Security Unblocker.
