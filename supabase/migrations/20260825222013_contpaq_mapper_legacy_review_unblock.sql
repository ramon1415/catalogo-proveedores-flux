-- Unblock normalization of the six legacy review edges before graph hardening.
-- These constraints were created NOT VALID, so the pre-existing six rows could remain
-- in a state that later UPDATE statements are not allowed to preserve.
-- Finance review authority moves to budget_mapping_reviews in the next migration.

alter table public.budget_account_mappings
  drop constraint if exists budget_account_mappings_review_status_check,
  drop constraint if exists budget_account_mappings_validated_reason_check;
