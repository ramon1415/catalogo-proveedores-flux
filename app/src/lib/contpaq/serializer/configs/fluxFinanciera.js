/**
 * F1-8 · empresaConfig de Flux Financiera.
 *
 * Valores OBSERVADOS en el archivo real "pólizas 1q.xls" (provisión de
 * nómina 1a quincena junio 2026, 1 póliza / 29 M1):
 * - Cuentas de 22 dígitos (ej. `660-12-17-00-...` → `6601217000000000000000`).
 * - TipoPol=3 (diario), Clase=1, IdDiario="0" (string), SistOrig=11,
 *   Impresa=1 (a diferencia de OPT, que trae 0), Ajuste=0.
 * - Solo se ha observado el tipo `diario`; ingreso/egreso se agregarán a este
 *   config cuando haya un archivo real que confirme sus parámetros.
 */

import { LEYENDA_CONTPAQ_22 } from './leyendaContpaq.js';

/** Config de serialización CONTPAQ para Flux Financiera. */
export const fluxFinancieraConfig = {
  empresa: 'Flux Financiera',
  accountFormat: {
    transform: 'quitar-guiones',
    width: 22,
  },
  poliza: {
    sistOrig: 11,
    impresa: 1,
    ajuste: 0,
    tiposPol: {
      diario: { tipoPol: 3, clase: 1, idDiario: '0' },
    },
  },
  leyenda: LEYENDA_CONTPAQ_22,
};
