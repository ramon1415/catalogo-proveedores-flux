-- FB-2 · Índice de soporte para FK created_by en hechos CFDI.
-- Sigue siendo DEV-only y no cambia la frontera client_unverified.

create index if not exists payment_request_cfdi_facts_created_by_idx
  on public.payment_request_cfdi_facts(created_by);
