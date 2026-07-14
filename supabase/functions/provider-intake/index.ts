import { TurnstileVerifier } from "./captcha.ts";
import { createProviderIntakeHandler } from "./handler.ts";
import { SupabaseIntakeRepository } from "./repository.ts";
import { readIntakeConfig } from "./validation.ts";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_required_secret:${name}`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  return Deno.env.get(name)?.trim() || undefined;
}

if ((Deno.env.get("INTAKE_ALLOW_QUERY_TOKEN") || "false").trim().toLowerCase() !== "false") {
  throw new Error("invalid_configuration:INTAKE_ALLOW_QUERY_TOKEN_must_be_false");
}

const captchaProvider = requiredEnv("CAPTCHA_PROVIDER").toLowerCase();
if (captchaProvider !== "turnstile") throw new Error("invalid_configuration:CAPTCHA_PROVIDER");

const repository = new SupabaseIntakeRepository({
  supabaseUrl: requiredEnv("SUPABASE_URL"),
  serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
});

const captcha = new TurnstileVerifier({
  secret: requiredEnv("CAPTCHA_SECRET"),
  expectedHostname: optionalEnv("CAPTCHA_EXPECTED_HOSTNAME"),
  expectedAction: optionalEnv("CAPTCHA_EXPECTED_ACTION"),
});

const handler = createProviderIntakeHandler({
  config: readIntakeConfig((name) => Deno.env.get(name)),
  repository,
  captcha,
  hashPepper: requiredEnv("INTAKE_HASH_PEPPER"),
});

Deno.serve(handler);
