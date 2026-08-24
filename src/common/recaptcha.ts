import { log, errMessage } from "@/common/logger";

/**
 * Google reCAPTCHA v2 verification (4.3).
 *
 * SEC-8.1 / SEC-9 — this used to be a booby trap. Three server actions read a
 * `recaptchaToken` form field, but nothing ever rendered a widget to produce one, and
 * `RECAPTCHA_SITE_KEY` was referenced nowhere in the codebase. The check was invisible only
 * because it short-circuits to `ok` when the secret is unset; the moment anyone set
 * `RECAPTCHA_SECRET_KEY` — which the README told them to do — every application and contact
 * submission would have started failing with no way for a user to succeed.
 *
 * Now the two keys are treated as one unit:
 *
 *   both set     -> the widget renders and verification is enforced (fails closed)
 *   neither set  -> disabled, for local development
 *   only one set -> a configuration error, raised loudly rather than half-applied
 */

export type RecaptchaConfig =
  | { enabled: true; siteKey: string; secretKey: string }
  | { enabled: false };

export function recaptchaConfig(): RecaptchaConfig {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY?.trim() ?? "";
  const secretKey = process.env.RECAPTCHA_SECRET_KEY?.trim() ?? "";

  if (siteKey && secretKey) return { enabled: true, siteKey, secretKey };
  if (siteKey || secretKey) {
    // Half-configured is the dangerous state: a secret with no widget rejects every real
    // visitor, and a widget with no secret verifies nothing. Refuse to guess.
    throw new Error(
      "reCAPTCHA is half-configured. Set BOTH NEXT_PUBLIC_RECAPTCHA_SITE_KEY and " +
        "RECAPTCHA_SECRET_KEY, or neither. A secret without a site key rejects every " +
        "submission; a site key without a secret verifies nothing."
    );
  }
  return { enabled: false };
}

/**
 * Verify a submitted token. Fails **closed**: once reCAPTCHA is configured, a missing,
 * malformed, or unverifiable token is a rejection, and so is an outage at Google — a bot
 * check that lets everything through when the verifier is unreachable is not a check.
 */
export async function verifyRecaptcha(
  token: string | undefined,
  context: string
): Promise<{ ok: boolean }> {
  const config = recaptchaConfig();
  if (!config.enabled) return { ok: true }; // not configured (local development)

  if (!token) {
    log.warn("auth", "recaptcha_missing_token", { context });
    return { ok: false };
  }

  try {
    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: config.secretKey, response: token }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { success: boolean; "error-codes"?: string[] };
    if (!data.success) {
      log.warn("auth", "recaptcha_rejected", {
        context,
        errors: (data["error-codes"] ?? []).join(",") || "none",
      });
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    log.error("auth", "recaptcha_verify_failed", { context, error: errMessage(e) });
    return { ok: false };
  }
}
