# Notification dispatcher presentation-only deploy

Use this path only when the database contract is already live and the change is limited to the checked-in `notification-dispatcher` renderer. The certified source for the branded receipt card is Git blob `a45a3c099cf267575b587a195e1747ce12492323`.

## Release order

1. Deploy and verify DEV first (`scsirgbuqjcwoaxfacth`). The live source must match the certified blob, keep `verify_jwt=false`, contain the branded receipt markers, and omit the former minimal receipt fragment.
2. Run the receipt template contract tests from the exact commit to be promoted.
3. Merge the deploy-only workflow to `main` without changing the dispatcher source.
4. Dispatch `Supabase PROD Notification Dispatcher Deploy Only` from the current `main` head, supplying that exact SHA and the PROD project ref `ucantptjhwttexzmslvm`.
5. Read the active PROD function back through the Supabase management surface. Require the certified source, `verify_jwt=false`, a new active version, and no change to any other function.

## Hard stop conditions

- Do not run the historical `Supabase PROD Receipt Linked Phase A` workflow for a presentation-only deployment. It also controls migrations, send mode, wake-up, and scheduler state.
- Do not invoke the dispatcher in PROD as a health check. An invocation can claim live queued work.
- Do not requeue an already `sent` notification to inspect the new presentation. Previously delivered mail is immutable evidence.
- Do not change database migrations, Vault/runtime secrets, scheduler configuration, notification rows, delivery attempts, receipt links, or stored PDFs in this release.
- Stop if the branch head, project ref, function name, source blob, or `verify_jwt` contract differs from the expected value.

## Evidence

Retain the workflow run URL, immutable Git SHA, source blob, Supabase project ref, function version before and after, and readback result. For an existing sent event, compare only ledger counts and identifiers; never replay it and never record secret values or attachment contents.

## Rollback

Rollback requires a reviewed forward commit that restores a previously certified dispatcher source, followed by the same DEV-first sequence and the deploy-only PROD workflow. Do not deploy an arbitrary local file or reuse Phase A.
