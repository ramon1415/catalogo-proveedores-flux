-- Mapeo partida→cuenta · Soporte Fersana (60 partidas SF-2026)
-- Generado por supabase/seed/contpaq/tools/generar_mapeos_fersana.py — NO editar a mano.
-- Fuente: supabase/seed/contpaq/data/mapeos_soporte_fersana.json (sha256 c4e6b54d6112c8c1b898218ba9637b1e6f3d4f2450f02aa0da7f14554dbc552c)
-- 60 mapeos · 17 exact_name · 43 judgment · 18 needs_review (quedan pendientes; la carga NO los aprueba)
-- La partida se resuelve por su código (budget_categories.code); si el código no existe la fila se omite
-- y el postcheck lo reporta. Idempotente: on conflict do nothing conserva lo que Finanzas ya haya decidido.
-- Reemplazar :company_id antes de ejecutar.

insert into budget_account_mappings (company_id, budget_category_id, contpaq_account_code, needs_review, mapping_method)
select :company_id, bc.id, v.cuenta, v.needs_review, v.method
from (values
  ('SF-2026-001', '5031900', false, 'exact_name'),
  ('SF-2026-002', '5032000', false, 'exact_name'),
  ('SF-2026-003', '5034100', false, 'exact_name'),
  ('SF-2026-004', '5035600', false, 'exact_name'),
  ('SF-2026-005', '5035800', false, 'exact_name'),
  ('SF-2026-006', '5036000', false, 'exact_name'),
  ('SF-2026-007', '5030700', false, 'judgment'),
  ('SF-2026-008', '5031500', true, 'judgment'),
  ('SF-2026-009', '5031600', false, 'judgment'),
  ('SF-2026-010', '5034600', false, 'exact_name'),
  ('SF-2026-011', '5035100', false, 'exact_name'),
  ('SF-2026-012', '5036200', false, 'exact_name'),
  ('SF-2026-013', '5036400', false, 'judgment'),
  ('SF-2026-014', '5034000', false, 'exact_name'),
  ('SF-2026-015', '5036600', false, 'judgment'),
  ('SF-2026-016', '5036600', false, 'judgment'),
  ('SF-2026-017', '5036600', false, 'judgment'),
  ('SF-2026-018', '5036600', false, 'judgment'),
  ('SF-2026-019', '5039200', true, 'judgment'),
  ('SF-2026-020', '5030800', false, 'judgment'),
  ('SF-2026-021', '5030800', false, 'judgment'),
  ('SF-2026-022', '5030800', false, 'judgment'),
  ('SF-2026-023', '5030800', false, 'judgment'),
  ('SF-2026-024', '5030200', false, 'judgment'),
  ('SF-2026-025', '5030800', true, 'judgment'),
  ('SF-2026-026', '5039200', true, 'judgment'),
  ('SF-2026-027', '5039200', true, 'judgment'),
  ('SF-2026-028', '5037000', false, 'judgment'),
  ('SF-2026-029', '5037000', false, 'judgment'),
  ('SF-2026-030', '5039200', true, 'judgment'),
  ('SF-2026-031', '5039200', true, 'judgment'),
  ('SF-2026-032', '5038000', false, 'judgment'),
  ('SF-2026-033', '5039200', true, 'judgment'),
  ('SF-2026-034', '5039200', true, 'judgment'),
  ('SF-2026-035', '5039200', true, 'judgment'),
  ('SF-2026-036', '5031000', false, 'judgment'),
  ('SF-2026-037', '5039200', true, 'judgment'),
  ('SF-2026-038', '5033900', false, 'judgment'),
  ('SF-2026-039', '5036800', false, 'judgment'),
  ('SF-2026-040', '5036800', true, 'judgment'),
  ('SF-2026-041', '5036500', false, 'exact_name'),
  ('SF-2026-042', '5036700', false, 'exact_name'),
  ('SF-2026-043', '5037100', false, 'judgment'),
  ('SF-2026-044', '5037100', false, 'judgment'),
  ('SF-2026-045', '5030400', false, 'exact_name'),
  ('SF-2026-046', '5030500', false, 'exact_name'),
  ('SF-2026-047', '5037500', false, 'exact_name'),
  ('SF-2026-048', '5037600', false, 'exact_name'),
  ('SF-2026-049', '5039100', false, 'exact_name'),
  ('SF-2026-050', '5030100', true, 'judgment'),
  ('SF-2026-051', '5030100', true, 'judgment'),
  ('SF-2026-052', '5031500', false, 'judgment'),
  ('SF-2026-053', '5030200', true, 'judgment'),
  ('SF-2026-054', '5031500', false, 'judgment'),
  ('SF-2026-055', '5038200', false, 'judgment'),
  ('SF-2026-056', '5036400', false, 'judgment'),
  ('SF-2026-057', '5031500', true, 'judgment'),
  ('SF-2026-058', '5039200', true, 'judgment'),
  ('SF-2026-059', '5036900', false, 'judgment'),
  ('SF-2026-060', '5036400', true, 'judgment')
) as v(code, cuenta, needs_review, method)
join budget_categories bc on bc.code = v.code
on conflict (company_id, budget_category_id, contpaq_account_code) do nothing;
