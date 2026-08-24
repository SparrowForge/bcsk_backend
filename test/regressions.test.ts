import { describe, it, expect, vi, afterEach } from "vitest";
import { issuePaymentToken, assertPaymentToken, verifyPaymentToken } from "@/modules/payment/payment-token";
import { isAppError, httpStatusFor, ERROR_CODES } from "@/common/errors/app-error";
import { intFromEnv, requiredSecret } from "@/config/env";
import { roleHas, permissionsFor, PERMISSIONS } from "@/common/permissions";
import type { Role } from "@/common/constants";

/**
 * Regressions found during the split, encoded so they cannot return.
 *
 * Each of these was a *silent* failure — nothing crashed, the system just quietly did the
 * wrong thing — which is exactly the class of bug a test is worth writing for.
 */

describe("payment token rejection is classified, not crashed", () => {
  /**
   * Found in Phase B: `assertPaymentToken` threw a bare `Error`, which the exception filter
   * could not classify, so a refused payment link returned **500** instead of 401. A caller
   * cannot distinguish "your link expired" from "the server broke", and a 500 on a payment
   * path is exactly the wrong signal to send.
   */
  it("throws an AppError the filter can map to 401", async () => {
    await expect(assertPaymentToken("not-a-token", 1)).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === ERROR_CODES.UNAUTHENTICATED,
    );
  });

  it("maps that code to 401, never 500", () => {
    expect(httpStatusFor(ERROR_CODES.UNAUTHENTICATED)).toBe(401);
  });

  it("accepts a token for its own application and rejects it for another", async () => {
    const token = await issuePaymentToken(42);
    expect(await verifyPaymentToken(token, 42)).toBe(true);
    expect(await verifyPaymentToken(token, 43)).toBe(false);
  });

  it("resolves without throwing on a valid token", async () => {
    await expect(assertPaymentToken(await issuePaymentToken(7), 7)).resolves.toBeUndefined();
  });
});

describe("PORT resolution — the empty-string precedence trap", () => {
  afterEach(() => vi.unstubAllEnvs());

  /**
   * Found in Phase B: `Number(process.env.PORT ?? 4000)` was written into new code after a
   * whole session spent fixing this exact defect elsewhere. `??` only fires on null and
   * undefined, so a blank PORT becomes `Number("")` — zero — and the server binds to a
   * random free port instead of failing or defaulting.
   */
  it.each([
    ["", 4000],
    ["   ", 4000],
    ["not-a-port", 4000],
    ["0", 4000],
    ["-1", 4000],
    ["4000", 4000],
    ["8080", 8080],
  ])("intFromEnv(PORT=%o) -> %i", (raw, expected) => {
    vi.stubEnv("PORT", raw as string);
    expect(intFromEnv("PORT", 4000)).toBe(expected);
  });

  it("demonstrates the defect being guarded against", () => {
    // The old expression, for contrast: a blank value binds to port 0.
    const blank: string | undefined = "";
    expect(Number(blank ?? 4000)).toBe(0);
  });
});

describe("environment secrets fail loud (SEC-1, carried across the split)", () => {
  it("throws rather than inventing a default", () => {
    delete process.env.__T;
    expect(() => requiredSecret("__T")).toThrow(/not set/i);
  });

  it("treats blank as missing", () => {
    process.env.__T = "   ";
    expect(() => requiredSecret("__T")).toThrow(/not set/i);
  });

  it("rejects a secret too short to matter", () => {
    process.env.__T = "short";
    expect(() => requiredSecret("__T")).toThrow(/at least 32/i);
  });
});

describe("permission model survived the port to NestJS (risk R1)", () => {
  it.each(["payments:verify", "payments:refund", "admissions:decide", "content:manage"] as const)(
    "IT_SUPPORT is denied %s",
    (p) => expect(roleHas("IT_SUPPORT", p)).toBe(false),
  );

  it.each(["users:manage", "settings:manage", "audit:read"] as const)(
    "ADMIN_SUPPORT is denied %s",
    (p) => expect(roleHas("ADMIN_SUPPORT", p)).toBe(false),
  );

  it("gives SUPER_ADMIN everything and non-staff nothing", () => {
    expect(permissionsFor("SUPER_ADMIN")).toHaveLength(PERMISSIONS.length);
    for (const role of ["TEACHER", "STUDENT"] as Role[]) {
      expect(permissionsFor(role)).toHaveLength(0);
    }
  });
});
