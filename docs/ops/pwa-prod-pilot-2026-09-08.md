# PWA pilot in production

Authorized by Ramón on 2026-09-08 for these existing active accounts only:

| Account | Profile ID |
| --- | --- |
| ramon@quantta.mx | e514902e-aa2c-4430-aa88-515934c3d13b |
| carlos@quantta.mx | 843c1a09-0293-40d8-a764-cbc0878fc620 |
| denise@quantta.mx | b014d1fb-903b-433c-ab51-0e8f5b5d91e1 |
| cesar@quantta.mx | 6f925d1c-1358-41bf-9d5c-06671cb8404a |

Sign in at https://flux.quantta.mx and select **Instalar Flux** in the top bar (download icon on narrow screens). Supported native prompts are used once; otherwise instructions explain the browser's installation menu, including Safari on iOS.

The server checks the production deployment, canonical hostname, production Supabase project, verified Auth user and matching active profile. No additional environment variables, migration, user role changes or DEV release are needed. Existing FLUX_SUPABASE_URL and FLUX_SUPABASE_ANON_KEY are used with the caller's JWT; no service role.

Only authorized sessions receive installation metadata. The manifest requires a Secure/HttpOnly/SameSite cookie limited to /api/pwa, renewed when the session changes; each manifest request validates the session and profile again. All responses prohibit caching. Login/logout/account changes remove metadata, serialize cookie updates and recheck access. An installed standalone window also verifies account eligibility before opening the authenticated application.

This ports the installation UI and production icons from #550 without the public manifest or unrelated DEV changes. No service worker/offline cache is introduced. Application permissions and company isolation continue to apply. Browsers can independently create bookmarks or offer installation for arbitrary websites; this pilot controls Flux's advertised installation and standalone account access, not browser bookmark features.

Verification: API tests for all four accounts, other users, mismatched/inactive profiles, invalid sessions, wrong environments, origin checks, logout and unavailable upstreams. React tests cover eligibility, metadata cleanup, account changes, late responses, manual guidance, native prompt lifecycle and standalone gating. Build verifies TypeScript/Vite and static packaging. Physical Android/iOS/desktop installation remains a device smoke check; automated tests do not claim it.

Rollback: revert this scoped release. No database rollback required. Existing device shortcuts must be removed by their owners.
