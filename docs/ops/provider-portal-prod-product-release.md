# Provider Portal â€” SYSADMIN-only PROD pilot UI candidate

- Build base: `da196b3e28a445ef00941563b07e6d67c25a54ff`.
- Selective product source: DEV `c91faf703a79c02d6e9ef21a7b07ea9a0af76a91`.
- Backend foundation: PR A #368 is already merged in this `main` baseline; activation remains a separate gate.
- Internal access is resolved by `get_provider_intake_module_access`; unknown/error hides and denies.
- The public provider route needs no Flux login and accepts the token only from `#token=`.
- Notification release delta: **0**.

## Production configuration still required (not written by this PR)

- `FLUX_TURNSTILE_SITE_KEY`: production Turnstile site key; test keys fail closed.
- `INTAKE_PRIVACY_NOTICE_URL`: approved HTTPS provider-intake-specific notice.
- Edge variables and secrets listed in PR A's runtime manifest.

## Stop state

This Draft performs no merge, PROD deploy, env/secret write, mode change, link creation, intake creation, submit, conversion, payment, batch, or layout action.
