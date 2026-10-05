import { describe, it, expect } from "vitest";
import { MIN_PAYABLE_KRW, appliesToType, describeDiscount, discountFor, normalizeCode } from "../src/modules/coupon/coupon.rules";
import { couponSchema } from "../src/modules/coupon/coupon.schema";
import { permissionsFor } from "../src/common/permissions";

describe("coupon arithmetic", () => {
  it("takes a percentage off the total, rounding the discount down", () => {
    expect(discountFor(350_000, "PERCENT", 10)).toBe(35_000);
    expect(discountFor(333_333, "PERCENT", 10)).toBe(33_333);
  });
  it("takes a fixed amount off", () => {
    expect(discountFor(350_000, "FIXED", 50_000)).toBe(50_000);
  });
  it("never leaves less than the minimum payable", () => {
    expect(discountFor(120_000, "FIXED", 500_000)).toBe(120_000 - MIN_PAYABLE_KRW);
    expect(discountFor(120_000, "PERCENT", 99)).toBe(Math.floor(120_000 * 0.99));
    expect(120_000 - discountFor(120_000, "PERCENT", 99)).toBeGreaterThanOrEqual(MIN_PAYABLE_KRW);
  });
  it("is zero when there is no coupon or nothing to take off", () => {
    expect(discountFor(350_000, null, null)).toBe(0);
    expect(discountFor(350_000, "PERCENT", 0)).toBe(0);
    expect(discountFor(MIN_PAYABLE_KRW, "FIXED", 500)).toBe(0);
    expect(discountFor(350_000, "BOGUS", 10)).toBe(0);
  });
  it("normalises codes and describes discounts", () => {
    expect(normalizeCode("  spring 25 ")).toBe("SPRING25");
    expect(describeDiscount("PERCENT", 10)).toBe("10% off");
    expect(describeDiscount("FIXED", 5000)).toBe("₩5,000 off");
  });
  it("applies by registration type", () => {
    expect(appliesToType("ALL", "SPECIAL")).toBe(true);
    expect(appliesToType("REGULAR", "REGULAR")).toBe(true);
    expect(appliesToType("REGULAR", "SPECIAL")).toBe(false);
  });
});

describe("coupon validation", () => {
  const ok = { code: "spring25", discountType: "PERCENT", value: 10 };
  it("upper-cases the code and defaults to all registrations", () => {
    const c = couponSchema.parse(ok);
    expect(c.code).toBe("SPRING25");
    expect(c.appliesTo).toBe("ALL");
  });
  it("keeps a percentage below 100", () => {
    expect(couponSchema.safeParse({ ...ok, value: 100 }).success).toBe(false);
    expect(couponSchema.safeParse({ ...ok, value: 99 }).success).toBe(true);
  });
  it("allows large fixed amounts", () => {
    expect(couponSchema.safeParse({ ...ok, discountType: "FIXED", value: 50_000 }).success).toBe(true);
  });
  it("rejects odd codes, a bad type and an end date before the start", () => {
    expect(couponSchema.safeParse({ ...ok, code: "a b!" }).success).toBe(false);
    expect(couponSchema.safeParse({ ...ok, discountType: "HALF" }).success).toBe(false);
    expect(couponSchema.safeParse({ ...ok, validFrom: "2026-10-10", validUntil: "2026-10-01" }).success).toBe(false);
  });
  it("treats a blank usage limit as unlimited", () => {
    expect(couponSchema.parse({ ...ok, maxUses: "" }).maxUses).toBeNull();
    expect(couponSchema.parse({ ...ok, maxUses: "50" }).maxUses).toBe(50);
  });
});

describe("coupon permission", () => {
  it("belongs to office admins, not IT support", () => {
    expect(permissionsFor("ADMIN_SUPPORT")).toContain("coupons:manage");
    expect(permissionsFor("SUPER_ADMIN")).toContain("coupons:manage");
    expect(permissionsFor("IT_SUPPORT")).not.toContain("coupons:manage");
  });
});
