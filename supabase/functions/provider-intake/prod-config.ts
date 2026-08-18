export const PROVIDER_INTAKE_PROD_CONTRACT = Object.freeze({
  captchaProvider: "turnstile",
  hostname: "flux.quantta.mx",
  action: "provider_intake_submit",
  allowedOrigin: "https://flux.quantta.mx",
});

const TURNSTILE_TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

type EnvReader = (name: string) => string | undefined;

function required(reader: EnvReader, name: string): string {
  const value = reader(name)?.trim() || "";
  if (!value) throw new Error("missing_required_secret:" + name);
  return value;
}

export function readProviderIntakeProdSecurityConfig(reader: EnvReader) {
  const captchaProvider = required(reader, "CAPTCHA_PROVIDER").toLowerCase();
  const captchaSecret = required(reader, "CAPTCHA_SECRET");
  const expectedHostname = required(reader, "CAPTCHA_EXPECTED_HOSTNAME").toLowerCase();
  const expectedAction = required(reader, "CAPTCHA_EXPECTED_ACTION");
  const allowedOrigins = required(reader, "INTAKE_ALLOWED_ORIGINS");
  const privacyNoticeUrl = required(reader, "INTAKE_PRIVACY_NOTICE_URL");
  const allowNoOrigin = (reader("INTAKE_ALLOW_NO_ORIGIN") || "false").trim().toLowerCase();
  const allowQueryToken = (reader("INTAKE_ALLOW_QUERY_TOKEN") || "false").trim().toLowerCase();

  if (captchaProvider !== PROVIDER_INTAKE_PROD_CONTRACT.captchaProvider) throw new Error("invalid_configuration:CAPTCHA_PROVIDER");
  if (TURNSTILE_TEST_SECRETS.has(captchaSecret)) throw new Error("invalid_configuration:CAPTCHA_SECRET_test_key_forbidden");
  if (expectedHostname !== PROVIDER_INTAKE_PROD_CONTRACT.hostname) throw new Error("invalid_configuration:CAPTCHA_EXPECTED_HOSTNAME");
  if (expectedAction !== PROVIDER_INTAKE_PROD_CONTRACT.action) throw new Error("invalid_configuration:CAPTCHA_EXPECTED_ACTION");
  if (allowedOrigins !== PROVIDER_INTAKE_PROD_CONTRACT.allowedOrigin) throw new Error("invalid_configuration:INTAKE_ALLOWED_ORIGINS");
  if (allowNoOrigin !== "false") throw new Error("invalid_configuration:INTAKE_ALLOW_NO_ORIGIN");
  if (allowQueryToken !== "false") throw new Error("invalid_configuration:INTAKE_ALLOW_QUERY_TOKEN");

  let privacyUrl: URL;
  try { privacyUrl = new URL(privacyNoticeUrl); } catch { throw new Error("invalid_configuration:INTAKE_PRIVACY_NOTICE_URL"); }
  if (privacyUrl.protocol !== "https:" || privacyUrl.username || privacyUrl.password) {
    throw new Error("invalid_configuration:INTAKE_PRIVACY_NOTICE_URL");
  }
  return { captchaProvider, captchaSecret, expectedHostname, expectedAction, privacyNoticeUrl: privacyUrl.href };
}
