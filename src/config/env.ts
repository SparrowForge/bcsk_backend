/**
 * Environment access with fail-loud semantics.
 *
 * `process.env.X ?? fallback` is unsafe for variables that exist but are blank:
 * `??` only fires on null/undefined, so an empty string passes straight through.
 * That is exactly how JWT_SECRET silently became the hard-coded "dev-secret" in
 * production (SEC-1), and how SESSION_HOURS became `Number("") === 0`, which sets
 * every session cookie to maxAge 0 and makes login impossible.
 *
 * These helpers treat blank as missing, and refuse to invent a default for a secret.
 */

const GENERATE_HINT =
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`;

/**
 * Read a required secret. Throws on import when missing, blank, or too short —
 * a failed boot is the correct outcome, because the alternative is an app that
 * runs happily while signing tokens anyone can forge.
 */
export function requiredSecret(name: string, minLength = 32): string {
  const raw = process.env[name]?.trim();
  if (!raw) {
    throw new Error(
      `${name} is not set (or is blank). Generate one with:\n  ${GENERATE_HINT}\n` +
        `then set it in .env for local development and in the hosting provider's ` +
        `environment variables for every deployed environment.`
    );
  }
  if (raw.length < minLength) {
    throw new Error(
      `${name} is only ${raw.length} characters; at least ${minLength} are required. ` +
        `Generate a strong value with:\n  ${GENERATE_HINT}`
    );
  }
  return raw;
}

/**
 * SEC-2: whether to show demo login hints on the portal sign-in screens.
 *
 * Two independent conditions, both required. `NODE_ENV === "production"` alone was not
 * enough of a guard historically — the hints were rendered unconditionally — so demo mode
 * must now be asked for explicitly *and* is refused outright in a production build.
 */
export function isDemoMode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.NEXT_PUBLIC_DEMO_MODE?.trim() === "1";
}

/**
 * Read an optional string. Blank counts as missing, so `API_PREFIX=""` falls back rather
 * than producing an empty path segment. Same rule as every other reader here.
 */
export function strFromEnv(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw ? raw : fallback;
}

/**
 * Read an optional positive integer. Blank, zero, negative, and non-numeric values
 * all fall back rather than silently becoming 0 or NaN.
 */
export function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
