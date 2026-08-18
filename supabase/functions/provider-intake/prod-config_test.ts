import { readProviderIntakeProdSecurityConfig } from "./prod-config.ts";
import { TurnstileVerifier } from "./captcha.ts";

function assert(value: unknown, message = "assertion_failed"): asserts value { if (!value) throw new Error(message); }
function validEnv(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    CAPTCHA_PROVIDER: "turnstile",
    CAPTCHA_SECRET: "prod_candidate_secret_not_a_real_value",
    CAPTCHA_EXPECTED_HOSTNAME: "flux.quantta.mx",
    CAPTCHA_EXPECTED_ACTION: "provider_intake_submit",
    INTAKE_ALLOWED_ORIGINS: "https://flux.quantta.mx",
    INTAKE_ALLOW_NO_ORIGIN: "false",
    INTAKE_ALLOW_QUERY_TOKEN: "false",
    INTAKE_PRIVACY_NOTICE_URL: "https://privacy.quantta.mx/provider-intake",
    ...overrides,
  };
  return (name: string) => values[name];
}
function mustFail(overrides: Record<string, string>, code: string) {
  let failure = "";
  try { readProviderIntakeProdSecurityConfig(validEnv(overrides)); } catch (error) { failure = String(error); }
  assert(failure.includes(code), "expected " + code + "; got " + failure);
}

Deno.test("production Edge contract accepts only the exact public boundary", () => {
  const config = readProviderIntakeProdSecurityConfig(validEnv());
  assert(config.expectedHostname === "flux.quantta.mx");
  assert(config.expectedAction === "provider_intake_submit");
});

Deno.test("production Edge contract rejects test secret, hostname, action, origin, flags, and privacy gaps", () => {
  mustFail({ CAPTCHA_SECRET: "1x0000000000000000000000000000000AA" }, "test_key_forbidden");
  mustFail({ CAPTCHA_EXPECTED_HOSTNAME: "preview.example" }, "CAPTCHA_EXPECTED_HOSTNAME");
  mustFail({ CAPTCHA_EXPECTED_ACTION: "other_action" }, "CAPTCHA_EXPECTED_ACTION");
  mustFail({ INTAKE_ALLOWED_ORIGINS: "*" }, "INTAKE_ALLOWED_ORIGINS");
  mustFail({ INTAKE_ALLOW_NO_ORIGIN: "true" }, "INTAKE_ALLOW_NO_ORIGIN");
  mustFail({ INTAKE_ALLOW_QUERY_TOKEN: "true" }, "INTAKE_ALLOW_QUERY_TOKEN");
  mustFail({ INTAKE_PRIVACY_NOTICE_URL: "http://quantta.mx/privacy" }, "INTAKE_PRIVACY_NOTICE_URL");
  mustFail({ INTAKE_PRIVACY_NOTICE_URL: "" }, "INTAKE_PRIVACY_NOTICE_URL");
});

Deno.test("Turnstile verifier rejects wrong hostname, wrong action, invalid and replayed tokens", async () => {
  let calls = 0;
  const verifier = new TurnstileVerifier({
    secret: "prod_candidate_secret_not_a_real_value",
    expectedHostname: "flux.quantta.mx",
    expectedAction: "provider_intake_submit",
    now: () => Date.parse("2026-08-17T23:00:00Z"),
    fetchImpl: (() => {
      calls += 1;
      const payload = calls === 1
        ? { success: true, hostname: "flux.quantta.mx", action: "provider_intake_submit", challenge_ts: "2026-08-17T22:59:30Z" }
        : { success: false };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    }) as typeof fetch,
  });
  assert(await verifier.verify({ token: "first-use" }));
  assert(!(await verifier.verify({ token: "first-use" })), "replayed token must fail when Turnstile reports spent");

  for (const payload of [
    { success: true, hostname: "evil.example", action: "provider_intake_submit", challenge_ts: "2026-08-17T22:59:30Z" },
    { success: true, hostname: "flux.quantta.mx", action: "wrong", challenge_ts: "2026-08-17T22:59:30Z" },
    { success: false },
  ]) {
    const candidate = new TurnstileVerifier({
      secret: "prod_candidate_secret_not_a_real_value",
      expectedHostname: "flux.quantta.mx",
      expectedAction: "provider_intake_submit",
      now: () => Date.parse("2026-08-17T23:00:00Z"),
      fetchImpl: (() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))) as typeof fetch,
    });
    assert(!(await candidate.verify({ token: "invalid" })));
  }
});
