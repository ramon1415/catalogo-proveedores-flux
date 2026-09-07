-- El check contpaq_accounts_detail_implies_cta_mayor_check (detalle ⇒ mayor=2)
-- codifica un supuesto que SOLO se cumple en Operadora. En el catálogo real de
-- Soporte Fersana (export oficial de CONTPAQ, fixture con sha256 en el
-- MANIFEST del módulo flux-contpaq-export) existen cuentas de detalle con
-- cta_mayor=1: en SF una hoja puede ser a la vez el renglón del estado
-- financiero (62 renglones / 694 cuentas; p. ej. 1210000 'Depreciación
-- Acumulada de Mob y Eq. oficina'). La regla portable entre las 3 empresas
-- es: la jerarquía la declara CtaSup y el rol lo declara CtaMayor — no hay
-- invariante cruzada entre is_detail y cta_mayor.
alter table public.contpaq_accounts
  drop constraint if exists contpaq_accounts_detail_implies_cta_mayor_check;
