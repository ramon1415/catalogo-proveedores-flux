-- Flux Operadora - Migracion 001j
-- Secuencias numericas usadas por RPCs de solicitudes y layouts.
-- Idempotente para rebuild limpio y para bases donde ya existen manualmente.

CREATE SEQUENCE IF NOT EXISTS public.payment_request_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.payment_layout_number_seq;
