import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { CouponService } from "./coupon.service";
import { couponSchema, couponUpdateSchema } from "./coupon.schema";
import { CurrentActor, RequirePermission, Roles } from "../../common/decorators/actor.decorator";
import { ADMIN_ROLES } from "../../common/constants";
import type { Actor } from "../../common/actor";

const id = z.coerce.number().int().positive();

@Roles(...ADMIN_ROLES)
@Controller("coupons")
export class CouponController {
  constructor(private readonly coupons: CouponService) {}

  @RequirePermission("coupons:manage") @Get()
  list() { return this.coupons.list(); }

  @RequirePermission("coupons:manage") @Post()
  create(@Body() b: unknown, @CurrentActor() actor: Actor) { return this.coupons.create(couponSchema.parse(b), actor); }

  @RequirePermission("coupons:manage") @Patch(":id")
  update(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.coupons.update(id.parse(raw), couponUpdateSchema.parse(b), actor);
  }

  @RequirePermission("coupons:manage") @Delete(":id")
  remove(@Param("id") raw: string, @CurrentActor() actor: Actor) { return this.coupons.remove(id.parse(raw), actor); }
}
