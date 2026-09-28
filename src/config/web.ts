import { strFromEnv } from "./env";

/**
 * The public web app's origin, for links printed on documents (`WEB_BASE_URL`).
 *
 * Read through `strFromEnv` so a blank value counts as missing: the ID card used
 * `process.env.WEB_BASE_URL ?? ""`, and `??` does not fire on "" — a blank variable
 * produced a QR code pointing at a bare relative path.
 */
export function webBaseUrl(): string | null {
  const raw = strFromEnv("WEB_BASE_URL", "").replace(/\/+$/, "");
  return /^https?:\/\//.test(raw) ? raw : null;
}

/**
 * Where a printed serial can be checked. Every PDF used to say "Verify: bcskr.org", the old
 * Google Sites domain, which has no verification page (404). Null when the origin is unknown.
 */
export function verifyUrl(serial: string): string | null {
  const base = webBaseUrl();
  return base ? `${base}/verify/${encodeURIComponent(serial)}` : null;
}
