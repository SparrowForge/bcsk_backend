import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { LeaveService } from "./leave.service";
import { TransferService } from "./transfer.service";
import { clearanceSchema, decisionSchema, leaveSettingsSchema, statusFilter } from "./application.schema";
import { CurrentActor, RequirePermission, Roles } from "../../common/decorators/actor.decorator";
import { ADMIN_ROLES } from "../../common/constants";
import { clientIp } from "../../common/client-ip";
import type { Actor } from "../../common/actor";

const id = z.coerce.number().int().positive();

/**
 * Leave and transfer on the admin panel. The Head Master decides both (`leave:decide`,
 * `transfer:decide`); the office clears transfers (`transfer:verify`).
 */
@Roles(...ADMIN_ROLES)
@Controller()
export class ApplicationController {
  constructor(
    private readonly leave: LeaveService,
    private readonly transfers: TransferService,
  ) {}

  @RequirePermission("leave:review") @Get("leave")
  leaveList(@Query() q: unknown, @CurrentActor() a: Actor) { return this.leave.manageList(a, statusFilter.parse(q).status); }

  @RequirePermission("leave:decide") @Post("leave/:id/decide")
  decideLeave(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    const { decision, note } = decisionSchema.parse(b);
    return this.leave.decide(a, id.parse(raw), decision, note, clientIp(r));
  }

  @RequirePermission("institute:manage") @Patch("leave/settings")
  leaveSettings(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.leave.setTeacherMaxDays(a, leaveSettingsSchema.parse(b).leaveTeacherMaxDays, clientIp(r));
  }

  @RequirePermission("transfer:verify") @Get("transfers")
  transferList(@Query() q: unknown, @CurrentActor() a: Actor) { return this.transfers.list(a, statusFilter.parse(q).status); }

  @RequirePermission("transfer:verify") @Post("transfers/:id/verify")
  verifyTransfer(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.transfers.verify(a, id.parse(raw), clearanceSchema.parse(b), clientIp(r));
  }

  @RequirePermission("transfer:decide") @Post("transfers/:id/decide")
  decideTransfer(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    const { decision, note } = decisionSchema.parse(b);
    return this.transfers.decide(a, id.parse(raw), decision, note, clientIp(r));
  }
}
