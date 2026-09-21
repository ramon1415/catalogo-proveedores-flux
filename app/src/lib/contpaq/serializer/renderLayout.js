/**
 * F1-6 · Render del archivo Layout completo: leyenda de la empresa + filas
 * de datos de las pólizas construidas, como matriz de filas (arrays de
 * celdas) lista para escribirse a Excel (XLSX.utils.aoa_to_sheet) o a
 * celdas de UI.
 *
 * La leyenda viene de `empresaConfig.leyenda` (plantilla extraída del
 * archivo real de cada empresa) y su longitud NO se asume fija — se emite
 * tal cual venga en la config (los fixtures de junio traen 22 filas en
 * ambas empresas).
 *
 * Módulo puro: sin fs, sin dependencias.
 */

/**
 * Genera la matriz de filas del archivo Layout: leyenda + (P + M1[]) por
 * cada póliza construida, en orden.
 *
 * @param {Array<{header: Array<*>, registros: Array<Array<*>>}>}
 *   polizasConstruidas - Salidas de buildPoliza, en el orden del archivo.
 * @param {{leyenda: Array<Array<*>>}} empresaConfig - Config con la
 *   plantilla de leyenda de la empresa.
 * @returns {Array<Array<*>>} Filas del sheet "Datos" (leyenda + datos).
 *   Las filas se copian (slice) para que mutar el resultado no toque ni la
 *   config ni las pólizas construidas.
 */
export function renderLayout(polizasConstruidas, empresaConfig) {
  const leyenda = empresaConfig?.leyenda;
  if (!Array.isArray(leyenda) || leyenda.length === 0) {
    throw new Error(
      `empresaConfig.leyenda faltante o vacía (empresa ${empresaConfig?.empresa ?? '?'}); ` +
        'debe ser la plantilla de leyenda extraída del archivo real.'
    );
  }

  const filas = leyenda.map((fila) => fila.slice());
  for (const p of polizasConstruidas ?? []) {
    filas.push(p.header.slice());
    for (const registro of p.registros) {
      filas.push(registro.slice());
    }
  }
  return filas;
}
