import { describe, it, expect, afterEach } from "vitest";
import type { Request } from "express";
import { activationBlockedReason } from "../src/modules/payment/payment.service";
import { randomCode, isRandomSerial } from "../src/modules/document/document.service";
import { clientIp } from "../src/common/client-ip";
import { verifyUrl } from "../src/config/web";

/**
 * The admission-to-certificate walkthrough of 29 Sep 2026 found these by running the flow end
 * to end. Each was silent: a rejected family admitted, a child's name one guess away.
 */

describe("a verified payment is not an admission decision", () => {
  it("blocks activation for a rejected application", () => {
    expect(activationBlockedReason("REJECTED")).toMatch(/rejected/i);
  });
  it("blocks activation while corrections are outstanding", () => {
    expect(activationBlockedReason("CORRECTIONS_REQUESTED")).toMatch(/corrections/i);
  });
  it("allows activation on the normal paths", () => {
    for (const s of ["PENDING_PAYMENT", "PENDING_VERIFICATION", "PAID", "APPROVED"]) {
      expect(activationBlockedReason(s)).toBeNull();
    }
  });
});

describe("document serials cannot be enumerated", () => {
  it("issues ten characters of Crockford base32", () => {
    const code = randomCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
  });
  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 2000 }, randomCode));
    expect(seen.size).toBe(2000);
  });
  it("recognises only the new format, so a legacy guessable serial is never reissued", () => {
    expect(isRandomSerial(`BCSK-CERT-2026-${randomCode()}`, "BCSK-CERT-2026-")).toBe(true);
    expect(isRandomSerial("BCSK-CERT-2026-0013", "BCSK-CERT-2026-")).toBe(false);
    expect(isRandomSerial("BCSK-CERT-2026-ILOU012345", "BCSK-CERT-2026-")).toBe(false);
  });
});

describe("rate limits key on the visitor, and the visitor cannot pick their own key", () => {
  const KEY = "k".repeat(40);
  const req = (headers: Record<string, string>, ip = "10.0.0.1") => ({ headers, ip }) as unknown as Request;
  afterEach(() => { delete process.env.TRUSTED_PROXY_KEY; });

  it("uses the forwarded client IP when the proxy key matches", () => {
    process.env.TRUSTED_PROXY_KEY = KEY;
    expect(clientIp(req({ "x-bcsk-proxy-key": KEY, "x-bcsk-client-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
  });
  it("ignores the client-IP header without the key — otherwise any caller mints fresh buckets", () => {
    process.env.TRUSTED_PROXY_KEY = KEY;
    expect(clientIp(req({ "x-bcsk-client-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("198.51.100.1");
    expect(clientIp(req({ "x-bcsk-proxy-key": "wrong", "x-bcsk-client-ip": "203.0.113.7" }))).toBe("10.0.0.1");
  });
  it("ignores it entirely when no key is configured (the pre-fix behaviour)", () => {
    expect(clientIp(req({ "x-bcsk-proxy-key": KEY, "x-bcsk-client-ip": "203.0.113.7" }))).toBe("10.0.0.1");
  });
  it("refuses a forwarded value that is not shaped like an IP", () => {
    process.env.TRUSTED_PROXY_KEY = KEY;
    expect(clientIp(req({ "x-bcsk-proxy-key": KEY, "x-bcsk-client-ip": "not an ip; drop table" }))).toBe("10.0.0.1");
  });
});

describe("printed documents point at a page that exists", () => {
  afterEach(() => { delete process.env.WEB_BASE_URL; });
  it("builds the verify link from WEB_BASE_URL", () => {
    process.env.WEB_BASE_URL = "https://bcskfrontend.vercel.app/";
    expect(verifyUrl("BCSK-CERT-2026-ABCDEFGHJK")).toBe("https://bcskfrontend.vercel.app/verify/BCSK-CERT-2026-ABCDEFGHJK");
  });
  it("treats a blank WEB_BASE_URL as missing rather than printing a relative link", () => {
    process.env.WEB_BASE_URL = "  ";
    expect(verifyUrl("X")).toBeNull();
  });
});
