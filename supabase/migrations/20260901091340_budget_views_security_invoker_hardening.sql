-- Backport desde prod (20260901080307). Hardening: las vistas de budget corren con
-- los permisos del usuario que consulta (respetan RLS), no del owner de la vista.
alter view public.budget_availability set (security_invoker = true);
alter view public.budget_exceptions set (security_invoker = true);
