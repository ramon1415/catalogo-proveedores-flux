;(function fluxFase2RequestSuccessPatch() {
  if (window.__fluxFase2RequestSuccessPatchLoaded) return
  window.__fluxFase2RequestSuccessPatchLoaded = true

  // Compatibility shim only: the request creation and success screen now live in
  // fase2_request_payment_method_extension.js, the same flow that calls
  // create_payment_request. This file intentionally does not bind submit events
  // so it cannot compete with the real creation handler.
})()
