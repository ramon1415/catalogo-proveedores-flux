# Provider Portal â€” SYSADMIN-only PROD pilot UI candidate

- Build base: `18cd2b1265038cfcd143814012bdc26746cc5ff7`.
- Selective product source: DEV `c91faf703a79c02d6e9ef21a7b07ea9a0af76a91`.
- Backend foundation: PR A #368 is already merged in this `main` baseline; activation remains a separate gate.
- Internal access is resolved by `get_provider_intake_module_access`; unknown/error hides and denies.
- The public provider route needs no Flux login and accepts the token only from `#token=`.
- Notification release delta: **0**.

## Production configuration certified before this PR

- `FLUX_TURNSTILE_SITE_KEY=0x4AAAAAAEUm5Sw-pHWw-HQS`; test keys fail closed.
- `INTAKE_PRIVACY_NOTICE_URL=https://flux.quantta.mx/aviso-privacidad-proveedores.html`.
- Edge variables and secrets listed in PR A's runtime manifest.

## Stop state

The product release remains fail-closed while `PROVIDER_INTAKE_MODE=disabled`. Merge and automatic Vercel deployment do not authorize an environment/secret write, mode change, link creation, intake creation, submit, conversion, payment, batch, or layout action.
