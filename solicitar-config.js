export const PUBLIC_INTAKE_CONFIG = Object.freeze({
  environment: "DEV",
  functionBaseUrl:
    "https://scsirgbuqjcwoaxfacth.functions.supabase.co/provider-intake",
  turnstileSiteKey: "1x00000000000000000000AA",
  action: "provider_intake_submit",
  maxClientSafetyOverheadBytes: 256 * 1024,
  multipartBaseOverheadBytes: 16 * 1024,
  multipartPerFileOverheadBytes: 4 * 1024,
  maxAmount: 1_000_000_000,
  allowedCurrencies: Object.freeze(["MXN"]),
  uiContractVersion: "provider-intake-public-ui/1.0",
});
