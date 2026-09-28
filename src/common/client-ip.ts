import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

/**
 * The visitor's IP, for rate limiting.
 *
 * Almost every request reaches this API from the Next.js server, not from the visitor, so
 * `x-forwarded-for` and `req.ip` name the web server — and every applicant on the site used
 * to share one rate-limit bucket (five applications an hour, site-wide).
 *
 * The web server therefore forwards the visitor's address in `x-bcsk-client-ip`. That header
 * is trusted **only** when it arrives with `x-bcsk-proxy-key` matching `TRUSTED_PROXY_KEY`:
 * anyone can call this API directly and set any header they like, and an unauthenticated
 * header would let them pick a fresh "IP" per request and walk straight past the limits.
 * With no key configured, behaviour is exactly what it was before.
 */
const PROXY_KEY_HEADER = "x-bcsk-proxy-key";
const CLIENT_IP_HEADER = "x-bcsk-client-ip";

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
}

function trustedProxy(req: Request): boolean {
  const expected = process.env.TRUSTED_PROXY_KEY?.trim();
  if (!expected || expected.length < 32) return false;
  const given = header(req, PROXY_KEY_HEADER);
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Accept only something shaped like an IPv4/IPv6 address, so a header cannot mint buckets. */
const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

export function clientIp(req: Request): string {
  if (trustedProxy(req)) {
    const forwarded = header(req, CLIENT_IP_HEADER);
    if (forwarded && IP_SHAPE.test(forwarded)) return forwarded;
  }
  const fwd = header(req, "x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.ip ?? "unknown";
}
