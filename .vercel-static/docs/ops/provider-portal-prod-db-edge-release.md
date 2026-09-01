# Provider Portal ? PROD DB/Edge release candidate

- Build base: `70fd10bacea6a9f7b32a36b67906c598f96f39e0`.
- Provider source reference: `c91faf703a79c02d6e9ef21a7b07ea9a0af76a91`.
- Target: Supabase PROD `ucantptjhwttexzmslvm`; captured migration head `20260817230000`.
- Default mode: `disabled`; pilot mode after a separate approval: `sysadmin_only`.
- Public valid-link traffic is anonymous and token-authorized only; disabled mode denies it.
- Notification delta: **0**. No #286/#282 producer or dispatcher is present.

## Forward-only apply plan (not executed by this PR)

1. Re-run the read-only preflight and verify the target/head have not moved.
2. Review and merge this PR only with Ram?n's explicit authorization.
3. Apply T1 ? T2 ? T3 ? T4 exactly once while the runtime remains `disabled`.
4. Confirm schema, grants, RLS, row counts, bucket material contract, and migration ledger.
5. Configure approved production-only Edge secrets without reading them back.
6. Deploy `provider-intake` with `verify_jwt=false`; the function enforces token auth and strict origin/CAPTCHA itself.
7. Keep mode `disabled` until the Product PR, approved privacy notice, production Turnstile site/secret, and deployment checks are complete.

## P0 release blockers intentionally left open

- Production Turnstile secret/site key are not configured by this candidate.
- Provider-intake-specific legal notice is not approved or published.
- No migration, Edge deployment, mode change, link, intake, or submit has been executed.
