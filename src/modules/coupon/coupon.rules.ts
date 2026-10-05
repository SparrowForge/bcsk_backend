/**
 * Coupon arithmetic, kept free of the database so the payment and admission services (and the
 * tests) share one definition of what a coupon is worth.
 */

export const DISCOUNT_TYPES = ["PERCENT", "FIXED"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const COUPON_APPLIES_TO = ["ALL", "REGULAR", "SPECIAL", "RE_ADMISSION"] as const;
export type CouponAppliesTo = (typeof COUPON_APPLIES_TO)[number];

/**
 * A coupon never takes the payable below this. The card gateway rejects a zero-won order and a
 * zero-won bank transfer has nothing to verify, so a 100%-style coupon would strand the family
 * at the payment step. If the school wants free places, that is an admission decision.
 */
export const MIN_PAYABLE_KRW = 1000;

/** Codes are case-insensitive to the family and stored upper-case. */
export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");

/** What `value` off a total comes to, never more than leaves MIN_PAYABLE_KRW payable. */
export function discountFor(total: number, type: string | null | undefined, value: number | null | undefined): number {
  if ((type !== "PERCENT" && type !== "FIXED") || !value || value <= 0 || total <= MIN_PAYABLE_KRW) return 0;
  const raw = type === "PERCENT" ? Math.floor((total * value) / 100) : value;
  return Math.max(0, Math.min(raw, total - MIN_PAYABLE_KRW));
}

export const appliesToType = (appliesTo: string, registrationType: string) =>
  appliesTo === "ALL" || appliesTo === registrationType;

/** "10% off" / "₩5,000 off". */
export function describeDiscount(type: string, value: number): string {
  return type === "PERCENT" ? `${value}% off` : `₩${value.toLocaleString("en-US")} off`;
}
