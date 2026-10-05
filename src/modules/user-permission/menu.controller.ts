import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { MenuService, menuSchema, menuUpdateSchema } from "./menu.service";
import { CurrentActor, RequirePermission, Roles } from "../../common/decorators/actor.decorator";
import { ADMIN_ROLES } from "../../common/constants";
import type { Actor } from "../../common/actor";

const id = z.coerce.number().int().positive();

/** Menu entry. Super admin only (`permissions:manage`). */
@Roles(...ADMIN_ROLES)
@Controller("menus")
export class MenuController {
  constructor(private readonly menus: MenuService) {}

  @RequirePermission("permissions:manage") @Get()
  list() { return this.menus.list(); }

  @RequirePermission("permissions:manage") @Post()
  create(@Body() b: unknown, @CurrentActor() actor: Actor) { return this.menus.create(menuSchema.parse(b), actor); }

  @RequirePermission("permissions:manage") @Patch(":id")
  update(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.menus.update(id.parse(raw), menuUpdateSchema.parse(b), actor);
  }

  @RequirePermission("permissions:manage") @Delete(":id")
  remove(@Param("id") raw: string, @CurrentActor() actor: Actor) { return this.menus.remove(id.parse(raw), actor); }
}
