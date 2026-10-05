import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { conflict, notFound, unprocessable } from "../../common/errors/app-error";
import type { Actor } from "../../common/actor";
import { appliesToType, normalizeCode } from "./coupon.rules";
import type { CouponInput, CouponUpdate } from "./coupon.schema";

/** One answer for every way a code can fail, so the form cannot be used to probe which codes exist. */
const NOT_VALID = "This coupon code is not valid for this registration.";

@Injectable()
export class CouponService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Applications that hold the coupon, not counting ones the office rejected (their use is released). */
  private usedBy(couponId: number) {
    return this.prisma.applicationForm.count({ where: { couponId, status: { not: "REJECTED" } } });
  }

  async list() {
    const rows = await this.prisma.coupon.findMany({ orderBy: { id: "desc" } });
    const counts = await this.prisma.applicationForm.groupBy({
      by: ["couponId"],
      where: { couponId: { not: null }, status: { not: "REJECTED" } },
      _count: { _all: true },
    });
    return rows.map((c) => ({ ...c, used: counts.find((x) => x.couponId === c.id)?._count._all ?? 0 }));
  }

  async create(input: CouponInput, actor: Actor) {
    try {
      const coupon = await this.prisma.coupon.create({ data: this.data(input) });
      await this.audit.record(actor.userId, "COUPON_CREATE", "Coupon", coupon.id, coupon.code);
      return coupon;
    } catch (e) {
      throw this.codeClash(e);
    }
  }

  async update(id: number, input: CouponUpdate, actor: Actor) {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) throw notFound("Coupon");
    try {
      const coupon = await this.prisma.coupon.update({ where: { id }, data: this.data(input) });
      await this.audit.record(actor.userId, "COUPON_EDIT", "Coupon", id, coupon.code);
      return coupon;
    } catch (e) {
      throw this.codeClash(e);
    }
  }

  /** A coupon that has been redeemed is kept (deactivated) so applications still show where their discount came from. */
  async remove(id: number, actor: Actor) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw notFound("Coupon");
    const redeemed = await this.prisma.applicationForm.count({ where: { couponId: id } });
    if (redeemed > 0) {
      await this.prisma.coupon.update({ where: { id }, data: { active: false } });
      await this.audit.record(actor.userId, "COUPON_DEACTIVATE", "Coupon", id, coupon.code);
      return { ok: true, deactivated: true };
    }
    await this.prisma.coupon.delete({ where: { id } });
    await this.audit.record(actor.userId, "COUPON_DELETE", "Coupon", id, coupon.code);
    return { ok: true, deactivated: false };
  }

  /**
   * The coupon a code refers to, if it can be used now for this kind of registration. Throws one
   * generic error for unknown, inactive, expired, wrong-type and used-up alike.
   */
  async resolve(rawCode: string, registrationType: string, now = new Date()) {
    const coupon = await this.prisma.coupon.findUnique({ where: { code: normalizeCode(rawCode) } });
    if (
      !coupon ||
      !coupon.active ||
      !appliesToType(coupon.appliesTo, registrationType) ||
      (coupon.validFrom && coupon.validFrom > now) ||
      (coupon.validUntil && coupon.validUntil < now)
    ) {
      throw unprocessable(NOT_VALID);
    }
    if (coupon.maxUses !== null && (await this.usedBy(coupon.id)) >= coupon.maxUses) {
      throw unprocessable(NOT_VALID);
    }
    return coupon;
  }

  private data(input: Partial<CouponInput>): Prisma.CouponUncheckedCreateInput {
    return input as Prisma.CouponUncheckedCreateInput;
  }

  private codeClash(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return conflict("A coupon with that code already exists.");
    }
    return e;
  }
}
