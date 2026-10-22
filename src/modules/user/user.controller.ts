import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { clientIp } from "../../common/client-ip";
import { UserService } from "./user.service";
import { CurrentActor, RequirePermission } from "../../common/decorators/actor.decorator";
import type { Actor } from "../../common/actor";

const createUser = z.object({
  loginId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  email: z.string().email().nullish(),
  role: z.string(),
  classLevel: z.string().optional(),
  designation: z.string().optional(),
  /** Super admin only: open an account in another institute. */
  instituteId: z.coerce.number().int().positive().optional(),
});
const changePassword = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10),
});
const idParam = z.coerce.number().int().positive();

@Controller("users")
export class UserController {
  constructor(private readonly users: UserService) {}

  @RequirePermission("users:manage")
  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.users.list(actor);
  }

  @RequirePermission("users:manage")
  @Post()
  create(@Body() body: unknown, @CurrentActor() actor: Actor, @Req() req: Request) {
    return this.users.create(createUser.parse(body), actor, clientIp(req));
  }

  @RequirePermission("users:manage")
  @Post(":id/reset-password")
  reset(@Param("id") raw: string, @CurrentActor() actor: Actor, @Req() req: Request) {
    return this.users.resetPassword(idParam.parse(raw), actor, clientIp(req));
  }

  @RequirePermission("users:manage")
  @Patch(":id/active")
  setActive(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() actor: Actor, @Req() req: Request) {
    const { active } = z.object({ active: z.boolean() }).parse(body);
    return this.users.setActive(idParam.parse(raw), active, actor, clientIp(req));
  }

  /**
   * Any signed-in user: you may always change your own password. The response carries a fresh
   * `token` and `refreshToken`; every session issued before the change stops working.
   */
  @Post("me/change-password")
  changeOwn(@Body() body: unknown, @CurrentActor() actor: Actor, @Req() req: Request) {
    const { currentPassword, newPassword } = changePassword.parse(body);
    return this.users.changeOwnPassword(actor, currentPassword, newPassword, clientIp(req));
  }
}
