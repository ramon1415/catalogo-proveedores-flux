/**
 * F1-1 · Transformación de cuentas contables por empresa.
 *
 * Regla del formato (spec F0 §3): la cuenta con guiones se concatena quitando
 * los guiones, y el resultado debe medir exactamente el width de la empresa
 * (Operadora 11 dígitos, Flux Financiera 22). También se aceptan cuentas ya
 * concatenadas (solo se validan).
 *
 * Módulo puro: sin fs, sin dependencias.
 */

/** Error de transformación/validación de cuenta con mensaje accionable. */
export class CuentaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CuentaError';
  }
}

/**
 * Transforma una cuenta contable al formato CONTPAQ de la empresa: quita
 * guiones (y espacios) y valida que el resultado tenga exactamente el width
 * configurado.
 *
 * @param {string|number} cuenta - Cuenta con guiones (`102-01-100-000`) o ya
 *   concatenada (`10201100000`).
 * @param {{empresa?: string, accountFormat: {width: number}}} empresaConfig
 * @returns {string} Cuenta concatenada de `width` dígitos.
 * @throws {CuentaError} Si la cuenta está vacía, no es numérica o su width
 *   no corresponde al de la empresa.
 */
export function transformCuenta(cuenta, empresaConfig) {
  const width = empresaConfig?.accountFormat?.width;
  if (!Number.isInteger(width) || width <= 0) {
    throw new CuentaError(
      `empresaConfig.accountFormat.width inválido: ${JSON.stringify(width)}`
    );
  }

  const cruda = cuenta === undefined || cuenta === null ? '' : String(cuenta).trim();
  if (cruda === '') {
    throw new CuentaError(`Cuenta vacía (empresa ${empresaConfig.empresa ?? '?'}).`);
  }

  const concatenada = cruda.replace(/[-\s]/g, '');
  if (!/^\d+$/.test(concatenada)) {
    throw new CuentaError(
      `Cuenta "${cruda}" contiene caracteres no numéricos tras quitar guiones ` +
        `("${concatenada}").`
    );
  }

  if (concatenada.length !== width) {
    throw new CuentaError(
      `Cuenta "${cruda}" → "${concatenada}" mide ${concatenada.length} dígitos; ` +
        `${empresaConfig.empresa ?? 'la empresa'} requiere exactamente ${width}.`
    );
  }

  return concatenada;
}
