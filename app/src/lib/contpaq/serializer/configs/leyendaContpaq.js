/**
 * F1-8 · Plantilla de LEYENDA del layout CONTPAQi (filas iniciales del sheet
 * "Datos" que describen cada tipo de registro).
 *
 * Extraída de los archivos reales de junio 2026. HALLAZGO: contra lo que
 * decía el spec (OPT 12 filas / Flux Financiera 22), AMBOS fixtures traen la
 * MISMA leyenda de 22 filas, byte por byte. Por eso vive en un solo archivo
 * y cada empresaConfig la referencia; si en el futuro un export de CONTPAQ
 * trae otra leyenda, basta con darle a esa empresa su propia plantilla en su
 * config (el código NO asume longitud fija — ver renderLayout).
 *
 * Las celdas `undefined` reproducen huecos reales del archivo original
 * (columnas sin etiqueta en la leyenda).
 */

/** @type {Array<Array<string|undefined>>} Filas de leyenda tal cual el archivo real. */
export const LEYENDA_CONTPAQ_22 = [
  ["Egreso(EG)", "IdDocumentoDe", "TipoDocumento", "Folio", "Fecha", "FechaAplicacion", "CodigoPersona", "BeneficiarioPagador", "IdCuentaCheques", "CodigoMoneda", "Total", "Referencia", "Origen", "BancoDestino", "CuentaDestino", "OtroMetodoDePago", "Guid", undefined, undefined, "TipoCambio", "UUIDRep", "NodoPago", "CodigoMonedaTipoCambio", "NumAsoc"],
  ["deposito.1(DE)", "IdDocumentoDe", "TipoDocumento", "Folio", "Fecha", "Ejercicio", "Periodo", "FechaAplicacion", "EjercicioAp", "PeriodoAp", "IdCuentaCheques", "NatBancaria", "Naturaleza", "Total", "Referencia", "Concepto", "EsConciliado", "IdMovEdoCta", "EjercicioPol", "PeriodoPol", "TipoPol", "NumPol", "FormaDeposito", "IdPoliza", "Origen", "IdDocumento", "PolizaAgrupada", "UsuarioCrea", "UsuarioModifica", "tieneCFD", "Guid"],
  ["ingreso.1(IN)", "IdDocumentoDe", "TipoDocumento", "Folio", "Fecha", "FechaAplicacion", "CodigoPersona", "BeneficiarioPagador", "IdCuentaCheques", "CodigoMoneda", "Total", "Referencia", "Origen", "BancoOrigen", "CuentaOrigen", "OtroMetodoDePago", "Guid", undefined, undefined, "TipoCambio", "NumeroCheque", "UUIDRep", "NodoPago", "CodigoMonedaTipoCambio", "NumAsoc"],
  ["Datos para CONTPAQi Factura Electrónica®(FE)", "RutaAnexo", "ArchivoAnexo"],
  ["Movimiento de póliza(M1)", "IdCuenta", "Referencia", "TipoMovto", "Importe", "IdDiario", "ImporteME", "Concepto", "IdSegNeg", "Guid", "FechaAplicacion"],
  ["Devolución de IVA (IETU)(W)", "IETUDeducible", "IETUModificado"],
  ["Devolución de IVA(V)", "IdProveedor", "ImpTotal", "PorIVA", "ImpBase", "ImpIVA", "CausaIVA", "ExentoIVA", "Serie", "Folio", "Referencia", "OtrosImptos", "ImpSinRet", "IVARetenido", "ISRRetenido", "GranTotal", "EjercicioAsignado", "PeriodoAsignado", "IdCuenta", "IVAPagNoAcred", "UUID", undefined, "IEPS"],
  ["Asociación de nodo de pago(AP)", "UUIDRep", "NumNodoPago", "GuidReferencia", "AplicationType"],
  ["Periodo de causación de IVA(R)", "EjercicioAsignado", "PeriodoAsignado"],
  ["Póliza(P)", "Fecha", "TipoPol", "Folio", "Clase", "IdDiario", "Concepto", "SistOrig", "Impresa", "Ajuste", "Guid"],
  ["Asociación movimiento(AM)", "UUID"],
  ["Comprobantes(MC)", "IdCuentaFlujoEfectivo", "IdSegmentoNegCtaFlujo", "Fecha", "Serie", "Folio", "UUID", "ClaveRastreo", "Referencia", "IdProveedor", "CodigoConceptoIETU", "ImpNeto", "ImpNetoME", "IdCuentaNeto", "IdSegmentoNegNeto", "PorIVA", "ImporteIVA", "ImporteIVAME", "IVATasaExcenta", "IdCuentaIVA", "IdSegmentoNegIVA", "NombreImpuesto", "ImpImpuesto", "ImpImpuestoME", "IdCuentaImpuesto", "IdSegmentoNegImp", "ImpOtrosGastos", "ImpOtrosGastosME", "IdCuentaOtrosGastos", "IdSegmentoNegOtrosGastos", "IVARetenido", "IVARetenidoME", "IdCuentaRetIVA", "IdSegmentoNegRetIVA", "ISRRetenido", "ISRRetenidoME", "IdCuentaRetISR", "IdSegmentoNegRetISR", "NombreOtrasRetenciones", "ImpOtrasRetenciones", "ImpOtrasRetencionesME", "IdCuentaOtrasRetenciones", "IdSegmentoNegOtrasRet", "BaseIVADIOT", "BaseIETU", "IVANoAcreditable", "ImpTotalErogacion", "IVAAcreditable", "ImpExtra1", "ImpExtra2", "IdCategoria", "IdSubCategoria", "TipoCambio", "IdDocGastos", "EsCapturaCompleta", "FolioStr"],
  ["Movimiento de póliza(M)", "IdCuenta", "Referencia", "TipoMovto", "Importe", "IdDiario", "ImporteME", "Concepto", "IdSegNeg"],
  ["Dispersiones de pago(DP)", "UUID", "UUIDRep", "GuidRef", "NumNodoPago", "FechaPago", "TotalPago", "TipoCambio", "TotalPagoComprobante"],
  ["Devolución de IVA (IETU)(W2)", "IETUDeducible", "IETUAcreditable", "IETUModificado", "IdConceptoIETU"],
  ["Movimientos de impuestos(I)", "IdPersona", "EjercicioAsignado", "PeriodoAsignado", "IdCuenta", "AplicaImpuesto", "Serie", "Folio", "Referencia", "UUID", "Origen", "Computable", "TipoMovimiento", "TipoFactor", "Impuesto", "ObjetoImpuesto", "NombreImpLocal", "TasaOCuota", "ImpBase", "ImpImpuesto", "ImpTotal", "Desglosado", "IVANoAcred", "AcumulaIETU", "IdConceptoIETU", "IETUDeducible", "IETUModificado", "IETUAcreditable", "GuidMov", "GuidMovPadre", "Migrado", "ConceptoIVA", "SubconceptoIVA", "ClasificadorIVA", "ProporcionDIOT", "DeducibleDIOT", "SubConceptoDIOT"],
  ["Asociación documento(AD)", "UUID"],
  ["Cheque(CH)", "IdDocumentoDe", "TipoDocumento", "Folio", "Fecha", "FechaAplicacion", "CodigoPersona", "BeneficiarioPagador", "IdCuentaCheques", "CodigoMoneda", "Total", "Referencia", "Origen", "CuentaDestino", "BancoDestino", "Guid", undefined, "OtroMetodoDePago", "TipoCambio", "UUIDRep", "NodoPago", "CodigoMonedaTipoCambio", "NumAsoc"],
  ["IngresosNoDepositados.1(DI)", "IdDocumentoDe", "TipoDocumento", "Folio", "Fecha", "Ejercicio", "Periodo", "FechaAplicacion", "EjercicioAp", "PeriodoAp", "CodigoPersona", "BeneficiarioPagador", "NatBancaria", "Naturaleza", "CodigoMoneda", "CodigoMonedaTipoCambio", "TipoCambio", "Total", "Referencia", "Concepto", "EsAsociado", "UsuAutorizaPresupuesto", "PosibilidadPago", "EsProyectado", "Origen", "IdChequeOrigen", "TipoCambioDeposito", "IdDocumento", "EsAnticipo", "EsTraspasado", "UsuarioCrea", "UsuarioModifica", "tieneCFD", "Guid", "CuentaOrigen", "BancoOrigen", "OtroMetodoDePago", "NumeroCheque", "NumAsoc"],
  ["Causación de IVA (Concepto de IETU)(E)", "IdConceptoIETU"],
  ["Causación de IVA (IETU)(D)", "IVATasa15NoAcred", "IVATasa10NoAcred", "IETU", "Modificado", "Origen", "TotTasa16", "BaseTasa16", "IVATasa16", "IVATasa16NoAcred", "TotTasa11", "BaseTasa11", "IVATasa11", "IVATasa11NoAcred", "TotTasa8", "BaseTasa8", "IVATasa8", "IVATasa8NoAcred"],
  ["Causación de IVA(C)", "Tipo", "TotTasa15", "BaseTasa15", "IVATasa15", "TotTasa10", "BaseTasa10", "IVATasa10", "TotTasa0", "BaseTasa0", "TotTasaExento", "BaseTasaExento", "TotOtraTasa", "BaseOtraTasa", "IVAOtraTasa", "ISRRetenido", "TotOtros", "IVARetenido", "Captado", "NoCausar", "IEPS"],
];
