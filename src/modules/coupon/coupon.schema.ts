import { z } from "zod";
import { COUPON_APPLIES_TO, DISCOUNT_TYPES, normalizeCode } from "./coupon.rules";

const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const optDate = z
  .string()
  .optional()
  .nullable()
  .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), "Invalid date")
  .transform((v) => (v ? new Date(v) : null));

const base = z.object({
  code: z
    .string()
    .transform(normalizeCode)
    .pipe(z.string().min(3, "At least 3 characters.").max(30).regex(/^[A-Z0-9_-]+$/, "Letters, numbers, - and _ only.")),
  description: optText(200),
  discountType: z.enum(DISCOUNT_TYPES),
  value: z.coerce.number().int().positive(),
  appliesTo: z.enum(COUPON_APPLIES_TO).default("ALL"),
  maxUses: z.coerce.number().int().positive().optional().nullable().or(z.literal("").transform(() => null)),
  validFrom: optDate,
  validUntil: optDate,
  active: z.boolean().default(true),
});

/** A percentage must leave something to pay, so it stops short of 100. */
const checks = <T extends { discountType: string; value: number; validFrom: Date | null; validUntil: Date | null }>(
  v: T,
  ctx: z.RefinementCtx,
) => {
  if (v.discountType === "PERCENT" && v.value > 99) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage must be between 1 and 99." });
  }
  if (v.validFrom && v.validUntil && v.validUntil < v.validFrom) {
    ctx.addIssue({ code: "custom", path: ["validUntil"], message: "The end date is before the start date." });
  }
};

export const couponSchema = base.superRefine(checks);
export const couponUpdateSchema = base.partial().superRefine((v, ctx) => {
  if (v.discountType === "PERCENT" && v.value !== undefined && v.value > 99) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage must be between 1 and 99." });
  }
  if (v.validFrom && v.validUntil && v.validUntil < v.validFrom) {
    ctx.addIssue({ code: "custom", path: ["validUntil"], message: "The end date is before the start date." });
  }
});

export type CouponInput = z.infer<typeof couponSchema>;
export type CouponUpdate = z.infer<typeof couponUpdateSchema>;
