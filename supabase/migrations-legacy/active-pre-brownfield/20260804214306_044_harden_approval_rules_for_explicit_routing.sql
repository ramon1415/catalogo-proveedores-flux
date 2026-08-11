-- Flux Operadora — administrative migration ledger convergence marker.
-- Migration 044 was already applied successfully through Supabase MCP at
-- remote version 20260804214306. The canonical 044 migration remains present
-- separately. This marker intentionally performs no schema or data mutation.

begin;
commit;
