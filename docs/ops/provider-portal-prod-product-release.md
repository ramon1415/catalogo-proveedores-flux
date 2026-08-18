# Provider Portal â€” SYSADMIN-only PROD pilot UI candidate

- Build base: `70fd10bacea6a9f7b32a36b67906c598f96f39e0`.
- Selective product source: DEV `c91faf703a79c02d6e9ef21a7b07ea9a0af76a91`.
- Backend prerequisite: Draft PR A #368 and its T1â†’T4 chain.
- Internal access is resolved by `get_provider_intake_module_access`; unknown/error hides and denies.
- The public provider route needs no Flux login and accepts the token only from `#token=`.
- Notification release delta: **0**.

## Production configuration still required (not written by this PR)

- `FLUX_TURNSTILE_SITE_KEY`: production Turnstile site key; test keys fail closed.
- `INTAKE_PRIVACY_NOTICE_URL`: approved HTTPS provider-intake-specific notice.
- Edge variables and secrets listed in PR A's runtime manifest.

## Stop state

This Draft performs no merge, PROD deploy, env/secret write, mode change, link creation, intake creation, submit, conversion, payment, batch, or layout action.
