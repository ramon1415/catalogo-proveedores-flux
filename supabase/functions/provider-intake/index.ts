import { TurnstileVerifier } from "./captcha.ts";
import { createProviderIntakeHandler } from "./handler.ts";
import { SupabaseIntakeRepository } from "./repository.ts";
import { readIntakeConfig } from "./validation.ts";
import { readProviderIntakeProdSecurityConfig } from "./prod-config.ts";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_required_secret:${name}`);
  return value;
}


const prodSecurity = readProviderIntakeProdSecurityConfig((name) => Deno.env.get(name));

const repository = new SupabaseIntakeRepository({
  supabaseUrl: requiredEnv("SUPABASE_URL"),
  serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
});

const captcha = new TurnstileVerifier({
  secret: prodSecurity.captchaSecret,
  expectedHostname: prodSecurity.expectedHostname,
  expectedAction: prodSecurity.expectedAction,
});

const handler = createProviderIntakeHandler({
  config: readIntakeConfig((name) => Deno.env.get(name)),
  repository,
  captcha,
  hashPepper: requiredEnv("INTAKE_HASH_PEPPER"),
});

Deno.serve(handler);
