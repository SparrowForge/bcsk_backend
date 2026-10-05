import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { UserPermissionService } from "./user-permission.service";
import { CurrentActor, RequirePermission } from "../../common/decorators/actor.decorator";
import type { Actor } from "../../common/actor";
import { MENU_FLAGS } from "../../common/menu-permissions";

const id = z.coerce.number().int().positive();
const userIds = z.array(id).min(1).max(100);
const flags = z.object(Object.fromEntries(MENU_FLAGS.map((f) => [f, z.boolean().optional()])) as Record<(typeof MENU_FLAGS)[number], z.ZodOptional<z.ZodBoolean>>);
const saveBody = z.object({ userIds, grid: z.record(z.string(), flags) });

@Controller("user-permissions")
export class UserPermissionController {
  constructor(private readonly svc: UserPermissionService) {}

  @RequirePermission("permissions:manage") @Get("menus")
  menus() { return this.svc.catalog(); }

  @RequirePermission("permissions:manage") @Get("users")
  users() { return this.svc.users(); }

  @RequirePermission("permissions:manage") @Get("users/:id")
  forUser(@Param("id") raw: string) { return this.svc.forUser(id.parse(raw)); }

  @RequirePermission("permissions:manage") @Get("roles/:role")
  forRole(@Param("role") role: string) { return this.svc.forRole(role); }

  @RequirePermission("permissions:manage") @Put()
  save(@Body() b: unknown, @CurrentActor() actor: Actor) {
    const { userIds: ids, grid } = saveBody.parse(b);
    return this.svc.save(ids, grid, actor);
  }

  @RequirePermission("permissions:manage") @Post("clear")
  clear(@Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.svc.clear(z.object({ userIds }).parse(b).userIds, actor);
  }
}
