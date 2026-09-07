/**
 * F1-8 · empresaConfig de Operadora (OPT).
 *
 * Valores OBSERVADOS en el archivo real "OPT - Polizas Junio 2026 formato
 * Layout.xls" (78 pólizas):
 * - Cuentas de 11 dígitos (ej. `102-01-100-000` → `10201100000`).
 * - TipoPol observados: 1 (ingreso, 13 pólizas), 2 (egreso, 49) y 3 (diario,
 *   16). HALLAZGO: el spec F1 mencionaba solo 1 y 2 para OPT, pero el archivo
 *   real también trae diarios con TipoPol 3.
 * - Clase=1, IdDiario="0" (string en el archivo), SistOrig=11, Impresa=0,
 *   Ajuste=0 en todas las pólizas.
 */

import { LEYENDA_CONTPAQ_22 } from './leyendaContpaq.js';

/** Config de serialización CONTPAQ para Operadora (OPT). */
export const operadoraConfig = {
  empresa: 'Operadora (OPT)',
  accountFormat: {
    transform: 'quitar-guiones',
    width: 11,
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
