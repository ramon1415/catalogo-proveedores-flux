/**
 * empresaConfig de Soporte Fersana (SF).
 *
 * Valores OBSERVADOS en el archivo real "SF - Polizas Julio 2026 formato
 * Layout.xls" (101 pólizas, 503 movimientos):
 * - Cuentas de 7 dígitos (ej. `102-0003` → `1020003`; formato 3-4).
 * - TipoPol observados: 1 (ingreso, 25), 2 (egreso, 44), 3 (diario, 32).
 * - Clase=1, IdDiario="0", SistOrig=11, Impresa=0, Ajuste=0 — idéntico a
 *   Operadora; solo cambia la anchura de cuenta.
 */

import { LEYENDA_CONTPAQ_22 } from './leyendaContpaq.js';

/** Config de serialización CONTPAQ para Soporte Fersana (SF). */
export const soporteFersanaConfig = {
  empresa: 'Soporte Fersana (SF)',
  accountFormat: {
    transform: 'quitar-guiones',
    width: 7,
  },
  poliza: {
    sistOrig: 11,
    impresa: 0,
    ajuste: 0,
    tiposPol: {
      ingreso: { tipoPol: 1, clase: 1, idDiario: '0' },
      egreso: { tipoPol: 2, clase: 1, idDiario: '0' },
      diario: { tipoPol: 3, clase: 1, idDiario: '0' },
    },
  },
  leyenda: LEYENDA_CONTPAQ_22,
};
