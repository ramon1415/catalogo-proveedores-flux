-- CONTPAQ mapper: separate reproducible technical evidence from formal finance rationale.
-- DEV-first. This migration is idempotent and does not seed data.

alter table public.budget_account_mappings
  add column if not exists mapping_evidence text,
  add column if not exists mapping_source text not null default 'manual',
  add column if not exists formal_reason_status text not null default 'not_required';

comment on column public.budget_account_mappings.mapping_evidence is
  'Reproducible observation derived from source data (for example shared normalized tokens). It is not a formal accounting rationale.';
comment on column public.budget_account_mappings.mapping_reason is
  'Formal human-authored accounting rationale. Never generated from mapping_evidence.';
comment on column public.budget_account_mappings.mapping_source is
  'Origin of the mapping decision: manual or seed_reproducible.';
comment on column public.budget_account_mappings.formal_reason_status is
  'Status of the formal finance rationale: not_required, pending_finance, or validated.';

alter table public.budget_account_mappings
  drop constraint if exists budget_account_mappings_reason_required,
  drop constraint if exists budget_account_mappings_mapping_reason_required,
  drop constraint if exists budget_account_mappings_evidence_semantics_check,
  drop constraint if exists budget_account_mappings_source_check,
  drop constraint if exists budget_account_mappings_formal_reason_status_check,
  drop constraint if exists budget_account_mappings_review_status_check,
  drop constraint if exists budget_account_mappings_validated_reason_check;

alter table public.budget_account_mappings
  add constraint budget_account_mappings_source_check
    check (mapping_source in ('manual','seed_reproducible')),
  add constraint budget_account_mappings_formal_reason_status_check
    check (formal_reason_status in ('not_required','pending_finance','validated')),
  add constraint budget_account_mappings_evidence_semantics_check
    check (
      case
        when mapping_source = 'seed_reproducible'
          and mapping_method = 'judgment'
          then nullif(btrim(mapping_evidence), '') is not null
        when mapping_source = 'manual'
          and (mapping_method = 'judgment' or needs_review)
          then nullif(btrim(mapping_reason), '') is not null
        else true
      end
    ) not valid,
  add constraint budget_account_mappings_review_status_check
    check (
      (needs_review and formal_reason_status in ('pending_finance','validated'))
      or (not needs_review and formal_reason_status = 'not_required')
    ) not valid,
  add constraint budget_account_mappings_validated_reason_check
    check (
      formal_reason_status <> 'validated'
      or nullif(btrim(mapping_reason), '') is not null
    ) not valid;
