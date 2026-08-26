# Aprobaciones (Cola de aprobación) — migration notes

Faithful 1:1 port of `aprobaciones.html` + `aprobaciones.js` (vanilla) to React.

- **Route path:** `/aprobaciones`
- **Default export:** `AprobacionesPage` in `AprobacionesPage.tsx`

## Files
- `types.ts` — DB row types + view enums (`MainTab`, `ColumnKey`, `SubFilter`, `DecisionAction`).
- `logic.ts` — pure logic: classification (`isPending/isChanges/isException/columnKey`), `approvalRows` (100-day history window), NFD `matchSearch`, badges, labels, `formatMonth`, `formatCurrency` (currency-aware), approver-detail label, `decisionActionsFor`, error maps.
- `api.ts` — Supabase reads + RPCs.
- `DecisionModal.tsx` — detail + decision (comment, error, action buttons, approver RPC).
- `AprobacionesPage.tsx` — tabs, sub-tabs, kanban, quick actions.
- `Aprobaciones.module.css` — ported page styles (main-tabs, sub-tabs, kanban, cards, decision buttons).

## Tables read (all via `loadApprovalData`, parallel)
- `payment_requests` (`*`, order created_at desc) — **primary**; any of the 7 core queries failing throws.
- `proveedores` (`id,alias,nombre_completo,rfc`)
- `companies` (`id,name,legal_name`)
- `cost_centers` (`id,code,name`)
- `budget_categories` (`id,code,name,category`)
- `payment_layout_lines` (`id,payment_request_id,layout_id,status`)
- `cash_funds` (`id,payment_request_id,status,pending_amount`)
- `payment_request_approvals` (bitácora) — loaded after; **degrades to `[]`** on error (console.warn only), matching vanilla. Filtered `action in (approved, exception_approved, rejected, exception_rejected)`, order created_at desc; first event per request → `__approvalEvent`.

## RPCs
- `get_payment_request_approver_details({ p_payment_request_id })` — approver line in the detail modal. Returns array or single row; error → "No disponible", no `profile_id` → "Sin revisor asignado".
- `decide_payment_request({ p_payment_request_id, p_actor_profile_id, p_action, p_comments })` — records a decision. `p_comments` is `comments || null`.

## Storage
- None. (No uploads/downloads in this section.)

## Role gates
- Section-level `canApprove` = `perms.canApprove(group)` = group ∈ {SYSADMIN, ADMIN, DIRECTION} (mirrors `config.js` `canApprove` and `lib/roles`). No lib files modified.
- Permission notice shown when `!canApprove`.
- Per-card quick actions (`canAct`): `canApprove && column==='pending' && (!approver_id || approver_id === profile.id)`.
- Modal decision actions: message when no permission, "Asignada a otro aprobador" when `approver_id` differs, "ya tiene una decision registrada" for terminal non-exception statuses; exception vs. normal action sets.
- `requiresComment(action)` = `action !== 'approved'` (comment mandatory for reject/changes/exception actions; enforced client-side + server error map).

## Deep-link query params
- None. The vanilla page reads no URL params (no deep-link behavior to preserve).

## Parity risks / uncertainties
- **Badge `violet`**: shared `Badge` has no `violet` variant. The budget "Excepcion" badge is rendered with a local `.violet` class in the module (same look). Sub-tab/decision `violet` also local.
- **Currency**: local `formatCurrency(value, currency)` preserves `request.currency` (the shared `lib/format.formatCurrency` hardcodes MXN), matching vanilla.
- **100-day cutoff** in `approvalRows` is `Date.now()`-relative (time-dependent), ported verbatim.
- **Quick-approve failure**: when a quick decision fails without the modal open, the error surfaces via toast only (the vanilla also wrote to a hidden, non-visible `#decisionError`, so no visible regression).
- **CSS variables**: `--emerald`, `--violet`, `--amber-dim`, `--ruby-dim`, `--violet-dim`, `--emerald-dim`, `--accent-dim` may not all be defined in the React app palette; every use has a `color-mix`/hex fallback so styling is safe if a var is missing.
- **Toast variant**: vanilla mapped `error→danger`; the React `useToast` uses `'error'` directly (same visual).
