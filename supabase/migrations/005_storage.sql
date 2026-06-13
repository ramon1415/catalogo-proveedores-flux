-- Tanda 0C - 005_storage.sql
-- Flux Operadora - Storage buckets y policies
-- Estado: PENDIENTE DE CONFIRMACION EN SUPABASE DEV.
-- No ejecutar en produccion hasta que haya revision humana.

-- Debe incluir:
-- - Buckets usados por comprobantes y documentos.
-- - Policies de lectura/escritura para storage.objects.
-- - Reglas por rol/responsable si aplican.

-- Bucket esperado por funcionalidades actuales:
-- - payment-receipts, si esta confirmado en Supabase dev.

-- Usos posibles:
-- - Comprobantes de pago.
-- - Tickets de efectivo.
-- - Cobros de cuota.
-- - Facturas de ingresos.

-- Validacion manual requerida:
-- 1. Entrar a Supabase dev > Storage.
-- 2. Confirmar nombres exactos de buckets.
-- 3. Confirmar si son publicos o privados.
-- 4. Exportar policies de storage.objects.
-- 5. Replicar solo lo necesario para prod.

-- Ejemplo orientativo NO EJECUTABLE hasta confirmar bucket/policies reales:
-- insert into storage.buckets (id, name, public)
-- values ('payment-receipts', 'payment-receipts', false)
-- on conflict (id) do nothing;

-- Validaciones sugeridas despues de llenar:
-- select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by name;
-- select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'storage' order by tablename, policyname;

-- Seguridad:
-- - No usar buckets publicos salvo decision explicita.
-- - No exponer archivos sensibles por URL publica si no es requerido.
-- - No incluir service_role.
