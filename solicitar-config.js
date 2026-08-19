const PROD_PROJECT = "ucantptjhwttexzmslvm";
const TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF",
]);

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch (_) {
    return false;
  }
}

async function loadRuntimeContract() {
  try {
    const response = await fetch("./api/runtime-config?format=json", {
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json" },
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("runtime_config_unavailable");
    const runtime = await response.json();
    const env = String(runtime?.env || "").trim().toLowerCase();
    const supabaseUrl = new URL(String(runtime?.supabaseUrl || ""));
    const project = supabaseUrl.hostname.split(".")[0];
    const portal = runtime?.providerIntake || {};
    const siteKey = String(portal.turnstileSiteKey || "").trim();
    const privacyNoticeUrl = String(portal.privacyNoticeUrl || "").trim();
    const ready = ["prod", "production"].includes(env)
      && project === PROD_PROJECT
      && portal.ready === true
      && siteKey.length >= 20
      && !TEST_SITE_KEYS.has(siteKey)
      && isHttpsUrl(privacyNoticeUrl);
    return {
      ready,
      siteKey: ready ? siteKey : "",
      privacyNoticeUrl: ready ? privacyNoticeUrl : "",
      functionBaseUrl: ready
        ? "https://" + PROD_PROJECT + ".functions.supabase.co/provider-intake"
        : "",
      error: ready ? "" : "provider_portal_release_configuration_incomplete",
    };
  } catch (_) {
    return { ready: false, siteKey: "", privacyNoticeUrl: "", functionBaseUrl: "", error: "provider_portal_release_configuration_unavailable" };
  }
}

const runtime = await loadRuntimeContract();

export const PUBLIC_INTAKE_CONFIG = Object.freeze({
  environment: "PROD",
  releaseReady: runtime.ready,
  releaseError: runtime.error,
  functionBaseUrl: runtime.functionBaseUrl,
  turnstileSiteKey: runtime.siteKey,
  privacyNoticeUrl: runtime.privacyNoticeUrl,
  action: "provider_intake_submit",
  maxClientSafetyOverheadBytes: 256 * 1024,
  multipartBaseOverheadBytes: 16 * 1024,
  multipartPerFileOverheadBytes: 4 * 1024,
  maxAmount: 1_000_000_000,
  allowedCurrencies: Object.freeze(["MXN"]),
  uiContractVersion: "provider-intake-public-ui/prod-1.0",
});
