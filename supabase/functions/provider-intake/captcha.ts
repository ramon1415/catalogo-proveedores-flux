import type { CaptchaVerificationInput, CaptchaVerifier } from "./types.ts";

type TurnstileResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  challenge_ts?: string;
};

export type TurnstileOptions = {
  secret: string;
  expectedHostname?: string;
  expectedAction?: string;
  maxAgeSeconds?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export class TurnstileVerifier implements CaptchaVerifier {
  readonly provider = "turnstile";
  private readonly options: TurnstileOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(options: TurnstileOptions) {
    if (!options.secret.trim()) throw new Error("missing_required_secret:CAPTCHA_SECRET");
    this.options = options;
    this.fetchImpl = options.fetchImpl || fetch;
    this.now = options.now || Date.now;
  }

  async verify(input: CaptchaVerificationInput): Promise<boolean> {
    const body = new URLSearchParams({ secret: this.options.secret, response: input.token });
    if (input.remoteIp) body.set("remoteip", input.remoteIp);

    let response: Response;
    try {
      response = await this.fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch {
      return false;
    }
    if (!response.ok) return false;

    let result: TurnstileResponse;
    try {
      result = await response.json() as TurnstileResponse;
    } catch {
      return false;
    }
    if (result.success !== true) return false;
    if (this.options.expectedHostname && result.hostname !== this.options.expectedHostname) return false;
    if (this.options.expectedAction && result.action !== this.options.expectedAction) return false;

    if (!result.challenge_ts) return false;
    const challengedAt = Date.parse(result.challenge_ts);
    const maxAgeMs = (this.options.maxAgeSeconds || 600) * 1000;
    if (!Number.isFinite(challengedAt) || challengedAt > this.now() + 60000 || this.now() - challengedAt > maxAgeMs) {
      return false;
    }
    return true;
  }
}
